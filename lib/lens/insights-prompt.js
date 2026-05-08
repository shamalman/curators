// lib/lens/insights-prompt.js
//
// Lens insights generator. v1 surfaces tag suggestions only; the returned
// envelope reserves slots for forthcoming insight surfaces (category nudge,
// network echoes, subscriber relevance, similar recs) so the API contract
// stays stable as those land.
//
// Mirrors the paste-route Claude pattern:
//   - claude-sonnet-4-5-20250929
//   - prompt-based JSON (no response_format / tool use)
//   - defensive code-fence strip + JSON.parse
//   - never throws to the caller; returns a default envelope on failure
//
// Adds the anthropic-no-log header from the taste-profile pattern because
// the curator's in-progress writeup is pre-save private content.

import Anthropic from "@anthropic-ai/sdk";

function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-no-log": "true" },
  });
}

const TAG_PROMPT_PREAMBLE = `You are Lens, an assistant helping a curator finalize a recommendation. Your job here is narrow: suggest 3-5 short, useful tags that describe the recommended item. Do not suggest tags about the curator's mood, the act of recommending, or generic words like "interesting" or "good".

Tag rules:
- Lowercase, trimmed
- Each tag is 1-3 words max, ≤40 characters
- Tags describe the WORK or its qualities — genre, theme, mood, era, format, regional origin, technique. Not metadata fields like "spotify" or "youtube" (the curator already knows the source).
- Don't repeat tags the curator has already added (case-insensitive).
- Don't restate the item's title or category as a tag.

Respond ONLY with JSON matching this exact shape, no prose, no markdown fences, no code blocks:
{"suggestedTags": ["tag one", "tag two", "tag three"]}

If you can't suggest anything useful with the given context, respond with: {"suggestedTags": []}
`;

function buildTagPromptInput({ title, writeup, link, existingTags }) {
  const lines = [];
  if (title?.trim()) lines.push(`Title: ${title.trim()}`);
  if (link) {
    if (link.parsedPayload?.site_name) lines.push(`Source: ${link.parsedPayload.site_name}`);
    if (link.parsedPayload?.canonical_url) lines.push(`URL: ${link.parsedPayload.canonical_url}`);
    if (Array.isArray(link.parsedPayload?.authors) && link.parsedPayload.authors.length > 0) {
      lines.push(`Authors: ${link.parsedPayload.authors.slice(0, 3).join(", ")}`);
    }
    if (link.parsedPayload?.body_md) {
      const excerpt = String(link.parsedPayload.body_md).trim().slice(0, 1500);
      if (excerpt) lines.push(`Body excerpt:\n${excerpt}`);
    }
  }
  if (writeup?.trim()) lines.push(`Curator's writeup:\n${writeup.trim().slice(0, 600)}`);
  if (existingTags?.length) lines.push(`Already added (do NOT repeat): ${existingTags.join(", ")}`);
  return lines.join("\n\n");
}

function normalizeTags(rawTags, existingTags = []) {
  if (!Array.isArray(rawTags)) return [];
  const taken = new Set(existingTags.map((t) => String(t).toLowerCase().trim()));
  const out = [];
  const seen = new Set();
  for (const raw of rawTags) {
    if (typeof raw !== "string") continue;
    const norm = raw.trim().toLowerCase().slice(0, 40);
    if (!norm) continue;
    if (taken.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
    if (out.length >= 5) break;
  }
  return out;
}

const EMPTY_ENVELOPE = {
  suggestedTags: [],
  suggestedCategory: null,
  networkEchoes: null,
  subscriberRelevance: null,
  similarRecs: null,
};

export async function generateLensInsights({ title, writeup, link, existingTags }) {
  const envelope = { ...EMPTY_ENVELOPE };

  const promptInput = buildTagPromptInput({ title, writeup, link, existingTags });
  if (!promptInput.trim()) return envelope;

  try {
    const response = await getAnthropicClient().messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 300,
      messages: [
        { role: "user", content: `${TAG_PROMPT_PREAMBLE}\n\nContext:\n${promptInput}` },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock) return envelope;

    const raw = textBlock.text.trim();
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned);

    envelope.suggestedTags = normalizeTags(parsed.suggestedTags, existingTags);
  } catch (err) {
    console.error("[LENS_INSIGHTS_ERROR]", err?.message || err);
    // swallow — return whatever we've accumulated (default empty envelope)
  }

  return envelope;
}
