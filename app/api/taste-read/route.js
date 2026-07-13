import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadSkill } from "../../../lib/prompts/loader.js";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: { "anthropic-no-log": "true" },
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

function stripFences(text) {
  return String(text || "")
    .replace(/^\s*```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

// Apply the (profile_id, source_url, rec_file_id) lookup match. Matches the
// partial unique indexes on taste_reads: one on (profile_id, rec_file_id)
// when rec_file_id IS NOT NULL, the other on (profile_id, source_url) when
// rec_file_id IS NULL.
function matchTasteRead(query, profileId, source_url, rec_file_id) {
  query = query.eq("profile_id", profileId);
  if (rec_file_id) {
    return query.eq("rec_file_id", rec_file_id);
  }
  return query.eq("source_url", source_url).is("rec_file_id", null);
}

function serializeRow(row) {
  if (!row) return null;
  return {
    extraction: row.extraction || "",
    inferences: Array.isArray(row.inferences) ? row.inferences : [],
    states: row.states || {},
    refined_texts: row.refined_texts || {},
    collapsed: !!row.collapsed,
    dismissed: !!row.dismissed,
    done: !!row.done,
  };
}

async function resolveProfileId(admin, authUserId) {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id")
    .eq("auth_user_id", authUserId)
    .single();
  if (error || !profile) return null;
  return profile.id;
}

export async function GET(request) {
  try {
    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const source_url = searchParams.get("source_url") || null;
    const rec_file_id = searchParams.get("rec_file_id") || null;
    if (!source_url && !rec_file_id) {
      return NextResponse.json({ error: "source_url or rec_file_id is required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const profileId = await resolveProfileId(admin, user.id);
    if (!profileId) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    let query = admin
      .from("taste_reads")
      .select("extraction, inferences, states, refined_texts, collapsed, dismissed, done");
    query = matchTasteRead(query, profileId, source_url, rec_file_id);
    const { data: row, error: selErr } = await query.maybeSingle();

    if (selErr) {
      console.error("[TASTE_READ_V2] GET select failed:", selErr.message);
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(serializeRow(row));
  } catch (err) {
    console.error("[TASTE_READ_V2] GET error:", err?.message || err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { parsed_content, source_url, rec_file_id } = await request.json();
    if (!parsed_content || typeof parsed_content !== "string") {
      return NextResponse.json({ error: "parsed_content is required" }, { status: 400 });
    }
    if (!source_url && !rec_file_id) {
      return NextResponse.json({ error: "source_url or rec_file_id is required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const profileId = await resolveProfileId(admin, user.id);
    if (!profileId) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    let aiProfile = 'stable';
    try {
      const { data: profileRow } = await admin
        .from('profiles')
        .select('ai_profile')
        .eq('id', profileId)
        .single();
      if (profileRow?.ai_profile === 'staging') {
        aiProfile = 'staging';
      }
    } catch (err) {
      console.error('[AI_PROFILE_FETCH_ERROR]', err?.message || err);
      // Fall through with default 'stable'
    }
    console.log(`[AI_PROFILE] route=taste-read profileId=${profileId} aiProfile=${aiProfile}`);

    // Check for an existing row first. If found, return it without hitting Claude.
    {
      let query = admin
        .from("taste_reads")
        .select("extraction, inferences, states, refined_texts, collapsed, dismissed, done");
      query = matchTasteRead(query, profileId, source_url, rec_file_id);
      const { data: existing, error: selErr } = await query.maybeSingle();
      if (selErr) {
        console.error("[TASTE_READ_V2] POST pre-check failed:", selErr.message);
      } else if (existing) {
        console.log(`[TASTE_READ_V2] cache hit profileId=${profileId} source_url=${source_url || "-"} rec_file_id=${rec_file_id || "-"}`);
        return NextResponse.json(serializeRow(existing));
      }
    }

    const skill = loadSkill("taste-read", aiProfile);
    const systemPrompt =
      skill +
      "\n\nPARSED CONTENT:\n" +
      parsed_content;

    const t0 = Date.now();
    const message = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      temperature: 0.7,
      system: systemPrompt,
      messages: [
        { role: "user", content: "Produce the taste read JSON for the parsed content above." },
      ],
    });
    const elapsedMs = Date.now() - t0;

    const raw = message.content[0]?.text || "";
    let parsed;
    try {
      parsed = JSON.parse(stripFences(raw));
    } catch (parseErr) {
      console.error("[TASTE_READ_V2] JSON parse failed:", parseErr.message, "raw:", raw.slice(0, 400));
      return NextResponse.json({ error: "Failed to parse taste read response" }, { status: 500 });
    }

    const extraction = typeof parsed.extraction === "string" ? parsed.extraction : "";
    const inferences = Array.isArray(parsed.inferences)
      ? parsed.inferences
          .filter(i => i && typeof i.text === "string" && i.text.trim())
          .map((i, idx) => ({ id: String(i.id ?? idx + 1), text: i.text.trim() }))
      : [];

    if (!extraction || inferences.length === 0) {
      console.error("[TASTE_READ_V2] empty or malformed payload:", JSON.stringify(parsed).slice(0, 400));
      return NextResponse.json({ error: "Malformed taste read response" }, { status: 500 });
    }

    const initialStates = Object.fromEntries(inferences.map(i => [i.id, "idle"]));

    // Insert. The partial unique indexes will raise 23505 on race; on conflict
    // re-SELECT and return the existing row.
    const { data: inserted, error: insErr } = await admin
      .from("taste_reads")
      .insert({
        profile_id: profileId,
        source_url: rec_file_id ? null : source_url,
        rec_file_id: rec_file_id || null,
        extraction,
        inferences,
        states: initialStates,
        refined_texts: {},
        collapsed: false,
        dismissed: false,
        done: false,
      })
      .select("extraction, inferences, states, refined_texts, collapsed, dismissed, done")
      .single();

    if (insErr && insErr.code === "23505") {
      let query = admin
        .from("taste_reads")
        .select("extraction, inferences, states, refined_texts, collapsed, dismissed, done");
      query = matchTasteRead(query, profileId, source_url, rec_file_id);
      const { data: existing } = await query.maybeSingle();
      if (existing) {
        console.log(`[TASTE_READ_V2] race-resolved to existing row profileId=${profileId}`);
        return NextResponse.json(serializeRow(existing));
      }
    }

    if (insErr) {
      console.error("[TASTE_READ_V2] insert failed:", insErr.message);
      return NextResponse.json({ error: "Persist failed" }, { status: 500 });
    }

    console.log(`[TASTE_READ_V2] generated profileId=${profileId} source_url=${source_url || "-"} rec_file_id=${rec_file_id || "-"} inferences=${inferences.length} elapsed_ms=${elapsedMs}`);
    return NextResponse.json(serializeRow(inserted));
  } catch (err) {
    console.error("[TASTE_READ_V2] POST error:", err?.message || err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
