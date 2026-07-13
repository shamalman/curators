// app/api/recs/paste/route.js
//
// Paste capture endpoint. Accepts raw text from the curator (a writeup
// from their Notes app, a draft review, a quoted passage). Synthesizes
// a parsedPayload envelope matching the shape parse-link returns, so
// the QuickCaptureSheet's existing save flow handles it transparently.
//
// If the curator didn't provide title/category, calls Claude to infer
// title + category + tags + a short "why" from the pasted text in a
// single round-trip (no preview step). The curator sees the saved rec
// with inferred fields and can edit them later via rec detail.
//
// extraction.mode: 'pasted'
// curator_is_author: true (curator wrote the paste, even if it quotes others)
// provenance.source_type: 'firsthand' (default)
// source block: omitted entirely — paste has no URL and no artifact

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { CATEGORIES as VALID_CATEGORIES } from "@/lib/constants";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
}

// Hard limits — enforced server-side regardless of client
const MIN_PASTE_LENGTH = 20;          // under this, reject as accidental
const MAX_PASTE_LENGTH = 500_000;     // ~500KB of text — generous, per spec

/**
 * Infer title + category + tags + why from pasted text using Claude.
 * Returns { title, category, tags, why } or null on failure.
 * Never throws — failures fall back to client-provided values or defaults.
 */
async function inferPasteMetadata(text) {
  try {
    const preview = text.slice(0, 3000); // cap input to Claude
    const response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: `You are helping a curator save a recommendation to their personal archive. They pasted the following text. Your job is to structure it into fields -- NOT to rewrite or polish the curator's words.

Extract these fields:

1. **title** (max 80 chars): Identify what is being recommended -- the name of the work, place, product, or item the curator is pointing at. NOT a description of the paste itself. Example: if the paste is a review of "The Master and Margarita", the title is "The Master and Margarita" -- not "A review of The Master and Margarita".

2. **category** (one of: ${VALID_CATEGORIES.join(", ")}): Which category best fits. If unsure, use "other".

3. **tags** (up to 5, each max 40 chars): Short descriptive tags that describe the work.

4. **why** (max 200 chars): THIS IS CRITICAL. The curator's voice must be preserved.
   - FIRST, look for a sentence in the pasted text that serves as "why the curator recommends this." This is usually the most emphatic or evaluative sentence.
   - If such a sentence exists, EXTRACT IT VERBATIM -- copy the curator's exact words, character-for-character, without rewriting, paraphrasing, polishing, or "improving" them.
   - Do NOT swap "Best" for "Exceptional". Do NOT swap "I've had in ages" for "I've ever had". Do NOT change tense, verb choice, punctuation, or word order.
   - The curator's voice is part of their taste signal. Paraphrasing destroys it.
   - If the pasted text has NO sentence that serves as a why (e.g., it's a pure factual description), then and only then synthesize a minimal placeholder -- but prefer to return an empty string "" for why if nothing clearly qualifies.
   - If you must truncate an extracted sentence to fit under 200 chars, truncate at a word boundary and append an ellipsis character "...".

Respond ONLY with JSON matching this exact shape, no prose, no markdown fences, no code blocks:
{"title": "...", "category": "...", "tags": ["...", "..."], "why": "..."}

The category MUST be one of the values listed above.

Pasted text:
${preview}`
        }
      ]
    });

    const textBlock = response.content.find(b => b.type === "text");
    if (!textBlock) return null;

    const raw = textBlock.text.trim();
    // Strip any accidental markdown fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!parsed.title || !parsed.category) return null;
    if (!VALID_CATEGORIES.includes(parsed.category)) parsed.category = "other";
    if (!Array.isArray(parsed.tags)) parsed.tags = [];

    return {
      title: String(parsed.title).slice(0, 80),
      category: parsed.category,
      tags: parsed.tags.slice(0, 5).map(t => String(t).slice(0, 40)),
      why: parsed.why ? String(parsed.why).slice(0, 200) : '',
    };
  } catch (err) {
    console.error("[PASTE_INFER_ERROR]", err?.message || err);
    return null;
  }
}

export async function POST(request) {
  const startedAt = Date.now();
  try {
    const body = await request.json();
    const {
      body_text,          // required — the pasted text
      profileId,          // required — for logging/attribution
      title: userTitle,   // optional — curator-provided, skip AI infer if set
      category: userCategory, // optional — must be in VALID_CATEGORIES
      tags: userTags,     // optional — array of strings
    } = body;

    // Validation
    if (!body_text || typeof body_text !== "string") {
      return NextResponse.json({ error: "body_text is required" }, { status: 400 });
    }
    if (!profileId) {
      return NextResponse.json({ error: "profileId is required" }, { status: 400 });
    }
    const trimmed = body_text.trim();
    if (trimmed.length < MIN_PASTE_LENGTH) {
      return NextResponse.json(
        { error: `paste too short (minimum ${MIN_PASTE_LENGTH} characters)` },
        { status: 400 }
      );
    }
    if (trimmed.length > MAX_PASTE_LENGTH) {
      return NextResponse.json(
        { error: `paste too long (maximum ${MAX_PASTE_LENGTH} characters)` },
        { status: 400 }
      );
    }

    // AI inference (only if curator didn't provide title OR category)
    let inferredTitle = null;
    let inferredCategory = null;
    let inferredTags = [];
    let inferredWhy = '';
    if (!userTitle || !userCategory) {
      const inferred = await inferPasteMetadata(trimmed);
      if (inferred) {
        inferredTitle = inferred.title;
        inferredCategory = inferred.category;
        inferredTags = inferred.tags;
        inferredWhy = inferred.why || '';
      }
    }

    const finalTitle = userTitle || inferredTitle || "Untitled paste";
    let finalCategory = userCategory || inferredCategory || "other";
    if (!VALID_CATEGORIES.includes(finalCategory)) finalCategory = "other";
    const finalTags = Array.isArray(userTags) && userTags.length > 0
      ? userTags
      : inferredTags;

    // Build parsedPayload envelope matching parse-link shape so the client's
    // existing save flow handles it transparently. Note: no canonical_url
    // means buildRecFileRow.source will be null, which is correct for pastes.
    //
    // curator_is_author and source_type are stuffed onto the envelope so
    // buildRecFileRow's parsedPayload-fallback picks them up without needing
    // changes to ingestUrlCapture or addRec.
    const parsedPayload = {
      body_md: trimmed,
      body_truncated: false,
      body_original_length: trimmed.length,
      canonical_url: null,        // no URL → no source block
      site_name: null,
      author: null,
      authors: [],
      published_at: null,
      lang: "en",
      word_count: trimmed.split(/\s+/).filter(Boolean).length,
      media_type: null,
      artifact_sha256: null,      // no artifact for pastes
      artifact_ref: null,
      extraction_mode: "pasted",
      extractor: "paste@v1",
      title: finalTitle,
      image_url: null,  // paste mode has no image
      // Overrides for buildRecFileRow (picked up via parsedPayload fallback)
      curator_is_author: true,
      source_type: "firsthand",
    };

    // Log the paste event for observability (reuses link_parse_log schema).
    try {
      const sb = getSupabaseAdmin();
      const { error: logErr } = await sb.from("link_parse_log").insert({
        profile_id: profileId,
        url: null,
        source_type: "paste",
        parse_quality: "full",
        content_length: trimmed.length,
        parse_time_ms: Date.now() - startedAt,
        error_message: null,
        ai_response_excerpt: null,
        ai_acknowledged_failure: null,
        metadata: {
          surface: "paste_capture",
          title: finalTitle,
          word_count: parsedPayload.word_count,
          ai_inferred: Boolean(inferredTitle || inferredCategory),
        },
      });
      if (logErr) console.error("[PASTE_LOG_ERROR]", logErr.message);
    } catch (e) {
      // Non-fatal — logging failure shouldn't block save
      console.error("[PASTE_LOG_ERROR]", e?.message || e);
    }

    // Response shape mirrors parse-link for client compatibility
    return NextResponse.json({
      parsed_successfully: true,
      title: finalTitle,
      category: finalCategory,
      tags: finalTags,
      why: inferredWhy,            // AI-inferred curator voice why; '' if user supplied title+category
      thumbnail_url: null,
      provider: "paste",
      parsedPayload,
      ai_inferred: Boolean(inferredTitle || inferredCategory),
    });
  } catch (error) {
    console.error("[PASTE_ROUTE_ERROR]", error?.message || error);
    return NextResponse.json(
      { error: "paste capture failed", detail: error?.message },
      { status: 500 }
    );
  }
}
