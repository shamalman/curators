import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { detectSource, getParser } from "../../../../lib/agent/registry.js";
import { resend } from "../../../../lib/resend.js";
import { agentCompletionEmail } from "../../../../lib/email-templates.js";

export const maxDuration = 60;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    "anthropic-no-log": "true",
  },
});

// Robust JSON parsing — tries multiple strategies before giving up
function parseJsonResponse(text) {
  if (!text) return null;

  // Strategy 1: raw parse
  try { return JSON.parse(text); } catch {}

  // Strategy 2: strip markdown code fences
  try {
    const stripped = text.replace(/^```json?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    return JSON.parse(stripped);
  } catch {}

  // Strategy 3: extract first { ... } block
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  return null;
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

function formatItem(item, index) {
  const parts = [`${index + 1}.`];
  if (item.itemType) parts.push(`[${item.itemType}]`);
  if (item.title) parts.push(`"${item.title}"`);
  if (item.artist) parts.push(`by ${item.artist}`);
  if (item.showName) parts.push(`(show: ${item.showName})`);
  if (item.duration) {
    // duration could be seconds (number) or ISO 8601 string
    if (typeof item.duration === "number") {
      const mins = Math.round(item.duration / 60);
      if (mins > 0) parts.push(`[${mins}min]`);
    } else {
      parts.push(`[${item.duration}]`);
    }
  }
  if (item.description) parts.push(`— ${item.description.slice(0, 120)}`);
  return parts.join(" ");
}

function buildExtractionPrompt(sourceType, metadata, items) {
  // Webpage-specific prompt — articles, blog posts, gift guides, reviews
  if (sourceType === "webpage" || metadata.source === "webpage") {
    return `You are analyzing a webpage/article for a curator on Curators.AI. Your job is to understand what this content reveals about the curator's taste and identify any specific recommendations.

SOURCE INFO:
Title: ${metadata.title || "Unknown"}
URL: ${metadata.url}
Author: ${metadata.author || "Unknown"}
Site: ${metadata.providerName || "Unknown"}
Description: ${metadata.description || "None"}

ARTICLE CONTENT:
${items.map(item => item.text || item.title || "").join("\n\n")}

INSTRUCTIONS:
1. Read the article and understand what it's about
2. Identify any specific recommendations mentioned (products, restaurants, albums, books, places, shows, etc.)
3. For each recommendation found, extract it with context from the article
4. Generate a taste analysis — what does this article reveal about the author/curator's taste, style, and aesthetic?

EXTRACTION RULES:
- If the article is a SINGLE REVIEW (one album, one restaurant, one book), extract that as one candidate rec
- If the article is a LISTICLE or GIFT GUIDE, extract each recommended item separately
- If the article is an essay or opinion piece with no specific recs, return an empty candidate_recs array — the taste analysis is what matters
- For each rec, determine the correct category:
  - listen: songs, albums, podcasts, playlists, mixes, EPs, audiobooks
  - watch: films, series, documentaries, videos, anime, standup specials
  - read: books, articles, substacks, essays, newsletters, papers
  - visit: restaurants, bars, cafes, hotels, parks, museums, cities
  - get: apps, tools, gadgets, gear, products, software
  - wear: clothing, shoes, accessories, fashion, beauty
  - play: games, sports, activities, hobbies
  - other: anything that doesn't fit
- tags: MUST include one content-type tag first (album, restaurant, book, product, film, etc.) followed by descriptive tags
- context: Use the article's own words and perspective — what did the author say about this item?
- confidence: How clearly is this a genuine recommendation vs just a passing mention? (0.0–1.0)

PARTIAL DATA RULE:
If you only have a small sample of items from a larger source (e.g., 4 tracks from a 60-track playlist), you MUST:
- Name every specific track/artist/item you DO have — never generalize when you have specific data
- Acknowledge the sample size: "I could only access [N] tracks from your [total]-track playlist"
- Make observations based on the specific items, not generic genre descriptions
- Example: "From the 4 tracks I could see — Real Lies, Tchami, [etc.] — you're balancing scene pioneers with underground bootlegs" NOT "You have a refined ear for future house"

Respond with JSON only, no markdown code fences:
{
  "article_summary": "1-2 sentence summary of what the article is about",
  "candidate_recs": [
    {
      "title": "Name of recommended thing",
      "category": "listen|watch|read|visit|get|wear|play|other",
      "context": "Why they recommend it — use their words/perspective from the article",
      "tags": ["content-type-tag", "descriptive-tag-1", "descriptive-tag-2"],
      "confidence": 0.8
    }
  ],
  "taste_analysis": {
    "content_breakdown": {"get": 5, "listen": 2},
    "patterns": ["pattern 1", "pattern 2"],
    "primary_moods": ["mood 1", "mood 2"],
    "genres": [],
    "contexts": ["gifting", "lifestyle"],
    "taste_thesis": "2-3 sentence thesis about what this article reveals about the curator's taste. Reference actual items from the article. Avoid generic genre descriptors."
  }
}`;
  }

  // Default prompt for structured sources (Spotify, Apple Music, etc.)
  return `You are analyzing a source for a curator on Curators.AI. Your job is to figure out what each item actually IS, extract genuine recommendations, and analyze the curator's taste.

SOURCE INFO:
Platform: ${metadata.source || sourceType || "Unknown"}
Title: ${metadata.title || "Unknown"}
Type: ${metadata.resourceType || "unknown"}
URL: ${metadata.url}
Description: ${metadata.description || "None"}

ITEMS (${items.length} total):
${items.map((item, i) => formatItem(item, i)).join("\n")}

STEP 1 — IDENTIFY EACH ITEM:
A single source can contain mixed content. A Spotify playlist might have songs AND podcast episodes. A YouTube channel might have music videos AND cooking tutorials. For EACH item, determine:
- What it actually is: song, album, podcast, episode, video, film, article, restaurant, place, book, product, app, game, etc.
- Which Curators.AI category it belongs to: watch | listen | read | visit | get | wear | play | other
  - listen: songs, albums, podcasts, playlists, mixes, EPs, audiobooks
  - watch: films, series, documentaries, videos, anime, standup specials
  - read: books, articles, substacks, essays, newsletters, papers
  - visit: restaurants, bars, cafes, hotels, parks, museums, cities
  - get: apps, tools, gadgets, gear, products, software
  - wear: clothing, shoes, accessories, fashion, beauty
  - play: games, sports, activities, hobbies
  - other: anything that doesn't fit

STEP 2 — CONFIDENCE SCORING:
For each item, assign a confidence score (0.0–1.0) — does this feel like a genuine curated pick or filler?
- High (0.7–1.0): Deep cuts, specific choices, clear personal taste signal
- Medium (0.4–0.7): Popular but fits a coherent theme
- Low (0.0–0.4): Generic top hits, algorithmic filler, default content

STEP 3 — EXTRACT CANDIDATE RECS:
Focus on items with confidence >= 0.5. Each rec needs:
- A title (for music: "Artist — Song/Album", for podcasts: "Show Name — Episode", etc.)
- The correct category from the list above
- tags: MUST include one content-type tag first (song, album, podcast, film, restaurant, book, app, etc.) followed by descriptive tags (genre, mood, era, style). Examples:
  - Song: ["song", "indie-rock", "90s", "guitar"]
  - Podcast episode: ["podcast", "tech", "interview"]
  - Restaurant: ["restaurant", "japanese", "ramen", "casual"]
- A context sentence written as if the curator said it

STEP 4 — TASTE ANALYSIS:
Analyze what this collection reveals about the curator's taste. Be content-aware — if the source has mixed content, break it down:
- "Your Spotify is 80% ambient/jazz music and 20% tech podcasts"
- "Your YouTube is mostly cooking tutorials with some music videos mixed in"
Don't assume everything is the same type. Reflect the actual mix.

Respond with JSON only, no markdown code fences. Use this exact structure:
{
  "items_analyzed": [
    {
      "title": "item name",
      "creator": "artist/author/host/channel name or null",
      "detected_type": "song|episode|video|place|book|etc",
      "category": "listen|watch|read|visit|get|wear|play|other",
      "confidence": 0.8,
      "confidence_reason": "brief reason"
    }
  ],
  "candidate_recs": [
    {
      "title": "Formatted title",
      "category": "listen",
      "context": "Why this matters — written as if the curator said it",
      "tags": ["content-type-tag", "descriptive-tag-1", "descriptive-tag-2"],
      "confidence": 0.8,
      "source_position": 1
    }
  ],
  "taste_analysis": {
    "content_breakdown": {"listen": 15, "watch": 3, "read": 0},
    "patterns": ["pattern 1", "pattern 2"],
    "primary_moods": ["mood 1", "mood 2"],
    "genres": ["genre 1", "genre 2"],
    "contexts": ["when/where they consume this — commuting, cooking, etc."],
    "taste_thesis": "A 2-3 sentence thesis about this curator's taste across ALL content types found. Reference specific items from the actual mix of content. Avoid generic genre descriptors."
  }
}

PARTIAL DATA RULE:
If you only have a small sample of items from a larger source (e.g., 4 tracks from a 60-track playlist), you MUST:
- Name every specific track/artist/item you DO have — never generalize when you have specific data
- Acknowledge the sample size: "I could only access [N] tracks from your [total]-track playlist"
- Make observations based on the specific items, not generic genre descriptions
- Example: "From the 4 tracks I could see — Real Lies, Tchami, [etc.] — you're balancing scene pioneers with underground bootlegs" NOT "You have a refined ear for future house"`;
}

export async function POST(request) {
  const admin = getSupabaseAdmin();

  let jobId;
  try {
    const body = await request.json();
    jobId = body.jobId;
  } catch (err) {
    console.error("Process route: invalid request body:", err);
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!jobId) {
    return Response.json({ error: "jobId is required" }, { status: 400 });
  }

  // Fetch the job
  const { data: job, error: jobErr } = await admin
    .from("agent_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    console.error("Process route: job lookup error:", jobErr);
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status === "completed") {
    return Response.json({ message: "Job already completed" });
  }

  if (job.status === "processing") {
    return Response.json({ message: "Job already processing" });
  }

  // Mark as processing
  await admin
    .from("agent_jobs")
    .update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", jobId);

  try {
    // Detect parser from source URL
    const detection = detectSource(job.source_url);
    if (!detection.supported || !detection.parserName) {
      throw new Error(`No parser found for URL: ${job.source_url}`);
    }

    const parser = getParser(detection.parserName);
    if (!parser) {
      throw new Error(`Parser not found: ${detection.parserName}`);
    }

    // Parse the source URL
    const { metadata, items } = await parser.parse(job.source_url);

    // Store raw data
    await admin
      .from("agent_jobs")
      .update({ raw_data: { metadata, items, fetched_at: new Date().toISOString() } })
      .eq("id", jobId);

    // If we got no items, complete with empty results
    if (!items || items.length === 0) {
      await admin
        .from("agent_jobs")
        .update({
          status: "completed",
          extracted_recs: { candidate_recs: [], items_analyzed: [] },
          taste_analysis: { patterns: [], taste_thesis: "Not enough data to analyze taste." },
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      return Response.json({ status: "completed", recs: 0 });
    }

    // Send to Claude for extraction + taste analysis
    const prompt = buildExtractionPrompt(job.source_type, metadata, items);

    const message = await anthropic.messages.create({
      // Using Sonnet for speed (60s Vercel timeout). Switch to claude-opus-4-20250514 on Vercel Pro.
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    // Parse Claude's response
    const responseText = message.content[0]?.text || "";
    let analysis = parseJsonResponse(responseText);

    if (!analysis) {
      console.error("Process route: all JSON parse strategies failed");
      console.error("Raw response:", responseText.slice(0, 500));
      // Complete the job with empty results rather than failing
      analysis = {
        candidate_recs: [],
        items_analyzed: [],
        taste_analysis: { summary: "Analysis could not be parsed. Please try again." },
      };
    }

    // Update job with results
    const { error: updateErr } = await admin
      .from("agent_jobs")
      .update({
        status: "completed",
        extracted_recs: {
          candidate_recs: analysis.candidate_recs || [],
          items_analyzed: analysis.items_analyzed || [],
          article_summary: analysis.article_summary || null,
        },
        taste_analysis: analysis.taste_analysis || {},
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    if (updateErr) {
      console.error("Process route: failed to update job with results:", updateErr);
      throw new Error("Failed to save results");
    }

    // Check if curator has left — if so, log for future email notification
    try {
      const { data: profile } = await admin.from("profiles")
        .select("last_seen_at, name, auth_user_id")
        .eq("id", job.profile_id)
        .single();

      if (profile) {
        const lastSeen = profile.last_seen_at ? new Date(profile.last_seen_at) : null;
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

        if (!lastSeen || lastSeen < fiveMinAgo) {
          const { data: { user } } = await admin.auth.admin.getUserById(profile.auth_user_id);
          if (user?.email) {
            const html = agentCompletionEmail({
              curatorName: profile.name,
              sourceType: job.source_type,
            });
            const { error: sendErr } = await resend.emails.send({
              from: 'Curators.AI <notifications@curators.ai>',
              to: user.email,
              subject: 'Your AI finished studying your profiles',
              html,
            });
            if (sendErr) {
              console.error("Agent completion email send error:", sendErr);
            }
          }
        }
      }
    } catch (emailErr) {
      console.error("Failed to check/send agent completion email:", emailErr);
    }

    return Response.json({
      status: "completed",
      recs: (analysis.candidate_recs || []).length,
      tasteThesis: analysis.taste_analysis?.taste_thesis || null,
    });
  } catch (error) {
    console.error("Process route: job failed:", error);

    // Mark job as failed
    await admin
      .from("agent_jobs")
      .update({
        status: "failed",
        error_message: error.message || "Unknown error",
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return Response.json({ status: "failed", error: error.message }, { status: 500 });
  }
}
