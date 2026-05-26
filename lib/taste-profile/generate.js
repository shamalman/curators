import Anthropic from "@anthropic-ai/sdk";

function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-no-log": "true" },
  });
}

export async function generateTasteProfile(profileId, supabase) {
  // 1. Fetch curator's data
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, handle, name, bio, location')
    .eq('id', profileId)
    .single();

  if (!profile) throw new Error('Profile not found');

  const { data: recs, error: recsError } = await supabase
    .from('recommendations')
    .select('title, category, context, tags, created_at, rec_file_id')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: true });

  console.log('Taste profile generation - profileId:', profileId, 'recs found:', recs?.length || 0, 'error:', recsError?.message || 'none');

  // Confirmations fetched here (moved up from below) so the entry gate can
  // distinguish "no signal at all" from "subscriber-only" (zero recs but
  // confirmed Reads). The latter is a valid case and must reach the prompt builder.
  const { data: confirmations } = await supabase
    .from('taste_confirmations')
    .select('type, observation, source, created_at')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: true });

  if ((!recs || recs.length === 0) && (!confirmations || confirmations.length === 0)) {
    throw new Error(`No recs or confirmations to generate taste profile from (profileId: ${profileId}, error: ${recsError?.message || 'none'})`);
  }

  // Secondary fetch: enrich with rec_files structured data when available.
  // Null-safe — if this fails, we fall back to recommendations-only fields below.
  const recFileIds = recs.map(r => r.rec_file_id).filter(Boolean);
  let recFilesById = {};
  if (recFileIds.length > 0) {
    const { data: recFilesData, error: recFilesErr } = await supabase
      .from('rec_files')
      .select('id, work, curation, extraction, body_md')
      .in('id', recFileIds);

    if (recFilesErr) {
      console.warn('[taste-profile] rec_files secondary load failed, falling back to recommendations-only:', recFilesErr.message);
    } else if (recFilesData) {
      recFilesById = Object.fromEntries(recFilesData.map(rf => [rf.id, rf]));
    }
  }

  // Build the enriched view. Prefer structured rec_files fields when present;
  // fall back to legacy recommendations columns. Authored-mode rows with no
  // archived body are treated as unenriched (the rec_files row exists but
  // carries no signal beyond what the legacy columns already gave us).
  let enrichedCount = 0;
  const enrichedRecs = recs.map(r => {
    const rf = r.rec_file_id ? recFilesById[r.rec_file_id] : null;
    const skipEnrichment = !rf || (rf.extraction?.mode === 'authored' && !rf.body_md);
    if (skipEnrichment) {
      return {
        title: r.title,
        category: r.category,
        why: r.context || null,
        site_name: null,
        authors: [],
        tags: Array.isArray(r.tags) ? r.tags : [],
        conviction: null,
      };
    }
    enrichedCount++;
    const work = rf.work || {};
    const curation = rf.curation || {};
    return {
      title: work.title || r.title,
      category: r.category,
      why: curation.why || r.context || null,
      site_name: work.site_name || null,
      authors: Array.isArray(work.authors) ? work.authors : [],
      tags: Array.isArray(curation.tags) && curation.tags.length > 0
        ? curation.tags
        : (Array.isArray(r.tags) ? r.tags : []),
      conviction: curation.conviction || null,
    };
  });

  console.log('[taste-profile] enriched', enrichedCount, 'of', recs.length, 'recs from rec_files');

  // Two-step query for subscriptions (no join aliases)
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('curator_id')
    .eq('subscriber_id', profileId)
    .is('unsubscribed_at', null);

  const subscribedIds = (subs || []).map(s => s.curator_id);
  let subscriptions = [];
  if (subscribedIds.length > 0) {
    const { data: subProfiles } = await supabase
      .from('profiles')
      .select('id, handle, name')
      .in('id', subscribedIds);
    subscriptions = subProfiles || [];
  }

  const { data: existingProfile } = await supabase
    .from('taste_profiles')
    .select('version')
    .eq('profile_id', profileId)
    .single();

  // 2. Build the Claude prompt
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recentConfirmations = (confirmations || []).filter(c =>
    now - new Date(c.created_at).getTime() < NINETY_DAYS_MS
  );
  const olderConfirmations = (confirmations || []).filter(c =>
    now - new Date(c.created_at).getTime() >= NINETY_DAYS_MS
  );

  if (recs.length === 0 && (confirmations || []).length > 0) {
    console.log('[taste-profile] SUBSCRIBER-ONLY BRANCH activated', {
      profileId,
      handle: profile.handle,
      confirmationCount: (confirmations || []).length,
      subscriptionCount: subscriptions.length,
    });
  }

  const prompt = `You are generating a taste profile document for a curator on Curators. This document is read by AI systems and human visitors to understand this curator's taste. It is an interpretation, not a verdict. The verbatim record of every recommendation and confirmation lives elsewhere on a separate timeline page; this document does not need to repeat that ledger.

Generate a markdown document following the EXACT structure below. Only include sections where you have data. Do not invent or hallucinate information. Every claim you make must be traceable to a specific recommendation or confirmation in the source data.

CURATOR: ${profile.name} (@${profile.handle})
${profile.bio ? `BIO: ${profile.bio}` : ''}
${profile.location ? `LOCATION: ${profile.location}` : ''}

${enrichedRecs.length > 0 ? `THEIR RECOMMENDATIONS (${recs.length} total):
${enrichedRecs.map(r => {
  const head = [`- [${r.category}] ${r.title}`];
  if (r.authors.length > 0) head.push(`by ${r.authors.join(', ')}`);
  if (r.site_name) head.push(`(${r.site_name})`);
  let line = head.join(' ');
  line += ` — ${r.why || 'no context'}.`;
  if (r.tags.length > 0) line += ` Tags: ${r.tags.join(', ')}.`;
  if (r.conviction) line += ` Conviction: ${r.conviction}.`;
  return line;
}).join('\n')}` : ''}

${recentConfirmations.length > 0 ? `=== RECENT CONFIRMED READS (last 90 days, weight these heavily) ===
${recentConfirmations.map(c => `- [${c.type}] (${c.created_at})\n"${c.observation}"`).join('\n\n')}
=== END RECENT ===` : ''}

${olderConfirmations.length > 0 ? `=== LONG-STANDING CONFIRMED READS (older than 90 days, weight as background) ===
${olderConfirmations.map(c => `- [${c.type}] (${c.created_at})\n"${c.observation}"`).join('\n\n')}
=== END LONG-STANDING ===` : ''}

These confirmed Reads are interpretations the curator explicitly endorsed when reading articles, essays, or other content. They are first-class evidence about how the curator thinks, not supplementary to recommendations. The full verbatim record lives on a separate timeline page; you do NOT need to list them here. Use them as evidence to inform the sections below. When recent and long-standing Reads are in tension, prefer the recent. When they reinforce each other, treat that as a stable pattern.

INPUT WEIGHTING:
- Recommendations are the strongest signal. The curator vouched for these.
- Confirmed Reads are second-strongest. The curator endorsed these interpretations of content they read. Treat as first-class evidence, not supplementary.
- Subscriptions are the weakest signal. They indicate domain trust ("I find this curator interesting") not taste alignment ("my taste matches theirs"). Use subscriptions to inform domain context only. Do not generate interpretation about the curator from subscriptions alone.

${recs.length === 0 && (confirmations || []).length > 0 ? `SUBSCRIBER-ONLY BRANCH:
This curator has zero recommendations but has confirmed Reads. Ground Working Interpretation, Domains, and Patterns entirely in confirmed Read evidence. Subscriptions inform domain context only and should not generate interpretation on their own. Voice & Style may still be inferred from the language of confirmed Read interpretations.
` : ''}

${subscriptions.length > 0 ? `CURATORS THEY SUBSCRIBE TO:
${subscriptions.map(s => `- @${s.handle}`).join('\n')}` : ''}

Generate the taste profile markdown document with these sections:

# Taste Profile: @${profile.handle}

## Working Interpretation
[1-3 sentences. This is a provisional read on what the curator's recommendations and confirmations point toward, not a verdict. Frame it as current and revisable. Reference specific patterns from the data. If fewer than 3 recs AND fewer than 3 confirmed Reads, write "Building..." and skip to the next section. A curator with 3+ confirmed Reads has enough signal for a Working Interpretation even with zero recs. Do not write a sweeping pronouncement of identity. Stay grounded in what the data actually shows.]

## Domains
[Ranked by strength based on rec count and confirmation depth. For each domain: state the category, the specific angle visible in the data, and 1-2 patterns supported by named recs or confirmations. Cite at least one specific rec title or confirmation phrase per domain.]

## Patterns
[Cross-domain observations. What connects their recs across categories? Each pattern must be tied to specific evidence. If you cannot point to two or more recs or confirmations supporting a pattern, do not include it.]

## Voice & Style
[How they communicate based on their rec contexts. Are they precise or vibes-based? Casual or formal? Specific instructions or broad endorsements? Ground this in observable language patterns from the rec contexts, not impression.]

## Curators They Subscribe To
[List from the subscription data. This is a CONSUMPTION signal, not a TASTE signal. Keep it as a simple list.]

## Anti-Taste
[Only if there are confirmed corrections or anti-taste observations. Otherwise omit.]

## Stats
${recs.length > 0 ? `- ${recs.length} recommendations across ${[...new Set(recs.map(r => r.category))].length} categories
` : ''}- ${(confirmations || []).filter(c => c.type === 'taste_read_confirmed' || c.type === 'correction').length} Reads confirmed or corrected
- ${subscriptions.length} subscriptions
- Last updated: ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}

RULES:
- Never invent observations not supported by the data.
- Every claim must be traceable to a specific rec or confirmation. If you cannot cite evidence, do not write the claim.
- Do not render verdicts about who the curator is as a person. Describe what their curation pattern shows.
- Do not use em dashes. Do not use hyphens surrounded by spaces as substitute em dashes. Use periods, commas, semicolons, or parentheses.
- This rule applies to section headers and connectors. Do NOT write \`**Music** —\` or \`**Music** -\` as a header-to-content connector. Examples:

  DO NOT WRITE:
  **Music** — She gravitates toward indie folk with attention to lyric craft.
  **Music** - She gravitates toward indie folk with attention to lyric craft.

  INSTEAD WRITE:
  **Music**: She gravitates toward indie folk with attention to lyric craft.
  or
  **Music**

  She gravitates toward indie folk with attention to lyric craft.
- Be specific. Reference actual rec titles, authors, and confirmation phrases.
- Write the Working Interpretation in second person, addressed to the curator. Use "you" and "your", not the curator's name or third-person pronouns. Example: "You gravitate toward..." not "Shamal gravitates toward..." or "They gravitate toward...".
- Keep it concise. Under 500 words.
- Output ONLY the markdown document. No preamble, no explanation.`;

  // 3. Call Claude API
  const response = await getAnthropicClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawMarkdown = response.content[0].text;

  // LENS-005 (P1): server-side post-processing of Stats `Last updated:` line.
  // The model occasionally fabricates dates on thin-data profiles
  // (@bradbarrish v9 produced "December 2024" instead of injected "May 2026").
  // Authoritative date is the server-side value, not what the model wrote.
  // Single regex replacement; if the line is missing, inject before the upsert.
  const authoritativeDate = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const lastUpdatedRegex = /^- Last updated: .*$/m;
  let markdownContent;
  if (lastUpdatedRegex.test(rawMarkdown)) {
    const matchedLine = rawMarkdown.match(lastUpdatedRegex)[0];
    const expectedLine = `- Last updated: ${authoritativeDate}`;
    if (matchedLine !== expectedLine) {
      console.warn(`[LENS-005] Stats date drift detected for profileId=${profileId}: model wrote "${matchedLine}", overwriting with "${expectedLine}"`);
    }
    markdownContent = rawMarkdown.replace(lastUpdatedRegex, expectedLine);
  } else {
    // Model omitted the Last updated line entirely. Append to the Stats section
    // if present, otherwise append to the end of the document.
    console.warn(`[LENS-005] Stats Last updated line missing for profileId=${profileId}, injecting`);
    if (rawMarkdown.includes('## Stats')) {
      markdownContent = rawMarkdown.replace(/(## Stats[\s\S]*?)(\n## |$)/, `$1\n- Last updated: ${authoritativeDate}$2`);
    } else {
      markdownContent = rawMarkdown + `\n\n## Stats\n- Last updated: ${authoritativeDate}\n`;
    }
  }

  // 4. Upsert into taste_profiles
  const newVersion = (existingProfile?.version || 0) + 1;

  const { error } = await supabase
    .from('taste_profiles')
    .upsert({
      profile_id: profileId,
      content: markdownContent,
      version: newVersion,
      sources: {
        rec_count: recs.length,
        rec_files_enriched: enrichedCount,
        confirmation_count: confirmations?.length || 0,
        taste_read_confirmed_count: (confirmations || []).filter(c => c.type === 'taste_read_confirmed').length,
        taste_read_corrected_count: (confirmations || []).filter(c => c.type === 'correction').length,
        subscription_count: subscriptions.length,
        generated_from: 'rec_files+recommendations+subscriptions+confirmations',
      },
      generated_at: new Date().toISOString(),
    }, { onConflict: 'profile_id' });

  if (error) {
    console.error('Failed to save taste profile:', error);
    throw error;
  }

  return { content: markdownContent, version: newVersion };
}