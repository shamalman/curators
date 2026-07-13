import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    "anthropic-no-log": "true",
  },
});

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getAuthUser(cookieStore) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { profileId } = await request.json();
    if (!profileId) {
      return Response.json({ error: "profileId is required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Validate profileId belongs to authenticated user
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id, auth_user_id")
      .eq("id", profileId)
      .single();

    if (profileErr || !profile || profile.auth_user_id !== user.id) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Fetch completed agent jobs for this profile
    const { data: jobs, error: jobsErr } = await admin
      .from("agent_jobs")
      .select("*")
      .eq("profile_id", profileId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false });

    if (jobsErr) {
      console.error("Taste read: failed to fetch jobs:", jobsErr);
      return Response.json({ error: "Failed to fetch agent jobs" }, { status: 500 });
    }

    if (!jobs || jobs.length === 0) {
      return Response.json({ tasteRead: null, candidateRecs: [], sourceCount: 0 });
    }

    // Collect all taste analyses and candidate recs across jobs
    const sourceBlocks = jobs.map(job => {
      const recs = job.extracted_recs?.candidate_recs || [];
      const topRecs = recs
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 10);

      return `SOURCE: ${job.source_type} (${job.source_url})
TASTE ANALYSIS: ${JSON.stringify(job.taste_analysis || {})}
ITEMS FOUND: ${recs.length}
TOP PICKS: ${JSON.stringify(topRecs)}`;
    }).join("\n\n");

    // All candidate recs across all jobs
    const allRecs = jobs.flatMap(job =>
      (job.extracted_recs?.candidate_recs || []).map(r => ({
        ...r,
        source: job.source_type,
      }))
    );

    const prompt = `You are synthesizing a taste profile for a new curator on Curators. You've analyzed their presence across multiple platforms. Here are the results:

${sourceBlocks}

YOUR JOB:
Generate a unified taste read — a 3-5 sentence paragraph that:
1. References specific things you found (not generic observations)
2. Identifies cross-platform patterns (their music taste matches their restaurant taste, etc.)
3. Proposes a thesis about their curatorial identity
4. Is written in second person, conversational tone ("You gravitate toward..." not "The curator tends to...")
5. Ends with a question that invites correction or confirmation

Also compile a unified list of candidate recommendations, ranked by confidence, deduplicated across sources.

Respond with JSON only, no markdown code fences:
{
  "taste_read": "Your 3-5 sentence taste read paragraph ending with a question",
  "candidate_recs": [
    {
      "title": "...",
      "category": "listen|watch|read|visit|get|wear|play|other",
      "context": "...",
      "tags": ["content-type", "tag1", "tag2"],
      "confidence": 0.8,
      "source": "spotify|apple_music|google_maps|etc"
    }
  ],
  "source_summary": {
    "platforms_analyzed": ["spotify", "google_maps"],
    "total_items_found": 85,
    "candidate_recs_extracted": 34
  }
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = message.content[0]?.text || "";
    let result;
    try {
      const cleaned = responseText.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Taste read: failed to parse Claude response:", parseErr);
      console.error("Raw response:", responseText.slice(0, 500));
      return Response.json({ error: "Failed to parse taste read" }, { status: 500 });
    }

    return Response.json({
      tasteRead: result.taste_read || null,
      candidateRecs: result.candidate_recs || [],
      sourceSummary: result.source_summary || {},
      sourceCount: jobs.length,
    });
  } catch (error) {
    console.error("Taste read error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
