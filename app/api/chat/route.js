import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { detectSource } from "../../../lib/agent/registry.js";
import { buildOnboardingPrompt } from "../../../lib/prompts/onboarding.js";
import { buildStandardPrompt } from "../../../lib/prompts/standard.js";
import { loadSkill } from "../../../lib/prompts/loader.js";
import { buildVisitorPrompt } from "../../../lib/prompts/visitor.js";
import { extractPublicSections, extractVoiceAndStyle } from "../../../lib/taste-profile/parse.js";
import { extractRecCapture, validateRecContext } from "../../../lib/chat/rec-extraction.js";
import { getSubscribedRecs } from "../../../lib/chat/network-context.js";
import { getInviterContext } from "../../../lib/chat/inviter-context.js";
import { URL_REGEX, normalizeUrls, findRecentUrl, isTasteReadIntent, parseContentForTasteRead, buildAgentUrlNotes, distillForReinjection, buildRecFileContextBlock, truncateOnBoundary } from "../../../lib/chat/link-parsing.js";
import { buildMediaEmbedBlocks } from "../../../lib/chat/media-embeds.js";
import { uploadArtifact } from "../../../lib/rec-files/artifact.js";
import { ingestChatParsedBlocks } from "../../../lib/chat/chat-parse-ingest.js";
import { CURATOR_STATS_TOOL, handleCuratorStatsTool } from "../../../lib/chat/stats-tool.js";
import { isFeatureEnabled } from "../../../lib/features.js";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    "anthropic-no-log": "true"
  }
});

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Global system prompt ceiling ──
// Final safety net against compounded injection: linkContextBlock (40K),
// rec_files re-injection (40K), taste-read re-injection (40K), plus base
// prompt + recs list + taste profile. Any single path is capped, but their
// sum can overflow. Cap the total before sending to Anthropic.
// Claude Sonnet 4 accepts ~200K tokens (~800K chars) but we leave ample
// headroom for messages + response.
const SYSTEM_PROMPT_HARD_CAP = 180000;

function enforceSystemPromptCap(systemPrompt, context) {
  if (systemPrompt.length <= SYSTEM_PROMPT_HARD_CAP) {
    return systemPrompt;
  }
  const overflow = systemPrompt.length - SYSTEM_PROMPT_HARD_CAP;
  console.error(`[SYSTEM_PROMPT_OVERFLOW] length=${systemPrompt.length} cap=${SYSTEM_PROMPT_HARD_CAP} overflow=${overflow} profileId=${context?.profileId || 'unknown'} tasteReadUrl=${context?.tasteReadUrl || 'none'} parsedBlocks=${context?.parsedBlocksCount || 0}`);
  // Truncate from the END (most recent injections are appended last — these
  // are the taste-read re-injection and per-turn link content).
  const truncated = systemPrompt.slice(0, SYSTEM_PROMPT_HARD_CAP);
  return truncated + '\n\n[SYSTEM PROMPT TRUNCATED DUE TO LENGTH — some context was dropped. Acknowledge what you have and be honest if you cannot answer fully.]';
}

export async function POST(request) {
  try {
    const {
      message, isVisitor, curatorName, curatorHandle, curatorBio,
      profileId, recommendations, history,
      generateOpening, image, conversationId,
    } = await request.json();

    if (!message && !generateOpening && !image) {
      return NextResponse.json({ message: "No message provided" }, { status: 400 });
    }

    // Deploy 3: detect "Do a Read on <url>" trigger from the taste_read action button
    const tasteReadMatch = message && message.match(/^Do a Read on (https?:\/\/\S+)/i);
    const tasteReadUrl = tasteReadMatch ? tasteReadMatch[1] : null;

    const recCount = recommendations ? recommendations.length : 0;
    const hasBio = curatorBio && curatorBio.trim() !== '';

    // Detect mode: onboarding until 3+ recs AND bio, then standard
    const isOnboarding = !isVisitor && (recCount < 3 || !hasBio);

    const sb = getSupabaseAdmin();

    let aiProfile = 'stable';
    if (profileId) {
      try {
        const { data: profileRow } = await sb
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
    }
    console.log(`[AI_PROFILE] route=chat profileId=${profileId} aiProfile=${aiProfile}`);

    let scopedConversationId = null;
    if (!isVisitor && profileId && conversationId) {
      try {
        const lensConversationsEnabled = await isFeatureEnabled(sb, profileId, 'lens_conversations_v1');
        if (lensConversationsEnabled) {
          const { data: conversationRow, error: conversationErr } = await sb
            .from('lens_conversations')
            .select('id')
            .eq('id', conversationId)
            .eq('profile_id', profileId)
            .maybeSingle();
          if (conversationErr) {
            console.error('[LENS_CONVERSATION_VERIFY_ERROR]', conversationErr.message);
            return NextResponse.json({ message: "Conversation not available" }, { status: 500 });
          } else if (conversationRow?.id) {
            scopedConversationId = conversationRow.id;
          } else {
            console.error(`[LENS_CONVERSATION_VERIFY_ERROR] conversation not found profileId=${profileId} conversationId=${conversationId}`);
            return NextResponse.json({ message: "Conversation not found" }, { status: 403 });
          }
        }
      } catch (err) {
        console.error('[LENS_CONVERSATION_VERIFY_ERROR]', err?.message || err);
        return NextResponse.json({ message: "Conversation not available" }, { status: 500 });
      }
    }

    // ── Link parsing (curator modes only, not visitor, not opening generation) ──
    let linkContextBlock = "";
    let agentNotes = [];
    let parsedLinkBlocks = [];
    let originalParsedContentLength = 0;
    let linkContextCapped = false;

    if (!isVisitor && profileId && !generateOpening) {
      // Detect URLs in message and parse ALL synchronously before calling Claude (cap at 3 links)
      // Normalize bare domains (Safari strips https:// when copying from address bar)
      if (message) {
        const normalizedMessage = normalizeUrls(message);
        const urls = (normalizedMessage.match(URL_REGEX) || []).slice(0, 3);

        // Parse all URLs concurrently for speed
        const parseResults = await Promise.all(
          urls.map(async (url) => {
            const parsed = await parseContentForTasteRead(url);
            return { url, ...parsed };
          })
        );

        for (const result of parseResults) {
          if (result.quality === 'full' || result.quality === 'partial') {
            parsedLinkBlocks.push({
              url: result.url,
              metadata: result.metadata,
              content: result.content,
              quality: result.quality,
              sourceType: result.sourceType,
              parseTimeMs: result.parseTimeMs,
            });
            agentNotes.push({ url: result.url, type: "link_parsed", sourceType: result.sourceType });
          } else {
            agentNotes.push({ url: result.url, type: "link_parse_failed", sourceType: result.sourceType, error: result.error });
            // Track failed parses for logging too
            parsedLinkBlocks.push({
              url: result.url,
              quality: 'failed',
              sourceType: result.sourceType,
              parseTimeMs: result.parseTimeMs,
              error: result.error,
            });
          }
        }
      }

      // Add URL-specific notes for this message
      const urlNotes = buildAgentUrlNotes(agentNotes);
      if (urlNotes) linkContextBlock += urlNotes;

      // ── Hard cap on total parsed content injected into system prompt ──
      const linkContentCap = tasteReadUrl ? 100000 : 40000;
      originalParsedContentLength = parsedLinkBlocks.reduce((sum, b) => sum + (b.content?.length || 0), 0);
      linkContextCapped = originalParsedContentLength > linkContentCap;
      if (linkContextCapped) {
        console.warn(`[LINK_CONTEXT_CAPPED] original_length=${originalParsedContentLength} capped_to=${linkContentCap} blocks=${parsedLinkBlocks.length}`);
        const ratio = linkContentCap / originalParsedContentLength;
        for (const block of parsedLinkBlocks) {
          if (block.content) {
            const allowance = Math.floor(block.content.length * ratio);
            block.content = block.content.slice(0, allowance) + '\n\n[content truncated due to length]';
          }
        }
      }

      // Inject parsed link content into prompt with quality signals
      for (const block of parsedLinkBlocks) {
        const meta = block.metadata || {};
        if (block.quality === 'full') {
          linkContextBlock += `\n\n=== PARSED LINK CONTENT (${block.url}) ===
Quality: FULL -- you have the complete content. Reference it specifically.
${meta.title ? `Title: ${meta.title}` : ''}
${meta.providerName || meta.source ? `Provider: ${meta.providerName || meta.source}` : ''}
${meta.author ? `Author: ${meta.author}` : ''}

${block.content}
=== END PARSED CONTENT ===`;
        } else if (block.quality === 'partial') {
          linkContextBlock += `\n\n=== PARSED LINK CONTENT (${block.url}) ===
Quality: PARTIAL -- you have some content but not everything.
Name the specific items you can see. Acknowledge you have a sample, not the full content.
${meta.title ? `Title: ${meta.title}` : ''}
${meta.providerName || meta.source ? `Provider: ${meta.providerName || meta.source}` : ''}
${meta.author ? `Author: ${meta.author}` : ''}

${block.content}
=== END PARSED CONTENT ===`;
        }
      }

      // Bug 2: detect URLs already attempted in the last 10 history messages so we
      // don't ask the curator to "try pasting again" on a URL that already failed once.
      const priorUrlSet = new Set();
      if (Array.isArray(history)) {
        for (const h of history.slice(-10)) {
          const txt = h?.text || "";
          const matches = txt.match(URL_REGEX) || [];
          for (const u of matches) priorUrlSet.add(u);
        }
      }

      // Add explicit FAILED blocks for URLs that couldn't be parsed
      let anyFailedThisTurn = false;
      for (const note of agentNotes) {
        if (note.type === 'link_parse_failed') {
          anyFailedThisTurn = true;
          if (priorUrlSet.has(note.url)) {
            linkContextBlock += `\n\n[Previously attempted URL: ${note.url} — parse failed. Do not ask the curator to try again. Acknowledge you cannot access this source and move on.]`;
          } else {
            linkContextBlock += `\n\n=== LINK PARSE FAILED (${note.url}) ===
You could NOT access the full content of this link. Acknowledge only the title and platform if visible from the URL itself, and state that you couldn't access the full content. Do NOT describe or summarize what's in it. Do NOT ask the curator to paste it or tell you what it contains. Keep it to ONE sentence. The curator already has action buttons to choose what to do next.
=== END ===`;
          }
        }
      }
      if (anyFailedThisTurn) {
        linkContextBlock += `\n\nFAILED PARSE RULE: If a link could not be parsed, say so once clearly and do not ask the curator to paste it again.`;
      }

      // ── Fire-and-forget: write each parsed URL to dropped_links ──
      if (parsedLinkBlocks.length > 0) {
        const blocksToLog = parsedLinkBlocks.slice();
        (async () => {
          for (const block of blocksToLog) {
            try {
              const meta = block.metadata || {};
              const qualityLabel = block.quality === 'full' ? 'FULL' : block.quality === 'partial' ? 'PARTIAL' : 'FAILED';
              const { error } = await sb.from('dropped_links').insert({
                profile_id: profileId,
                url: block.url,
                title: meta.title || null,
                platform: meta.providerName || meta.source || block.sourceType || null,
                parse_quality: qualityLabel,
                parsed_metadata: block.metadata || null,
              });
              if (error) console.error('[DROPPED_LINKS_WRITE]', error.message);
            } catch (err) {
              console.error('[DROPPED_LINKS_WRITE]', err?.message || err);
            }
          }
        })();
      }
    }

    // ── Taste read turn: emit a taste_read_card block and short-circuit ──
    // No inline Claude call; the client fetches /api/taste-read on mount using
    // the parsed_content payload below. Replaces the v1 observation flow.
    if (tasteReadUrl && !isVisitor) {
      const parsedBlock = parsedLinkBlocks.find(b => b.url === tasteReadUrl && b.quality !== 'failed');

      const cardBlocks = [];
      if (parsedBlock?.content) {
        const meta = parsedBlock.metadata || {};
        const header = [
          meta.title ? `Title: ${meta.title}` : null,
          meta.providerName || meta.source ? `Provider: ${meta.providerName || meta.source}` : null,
          meta.author ? `Author: ${meta.author}` : null,
        ].filter(Boolean).join('\n');
        const parsedContentPayload = header ? `${header}\n\n${parsedBlock.content}` : parsedBlock.content;

        cardBlocks.push({
          type: 'taste_read_card',
          data: {
            parsed_content: parsedContentPayload,
            source_url: tasteReadUrl,
            rec_file_id: null,
          },
        });
      } else {
        cardBlocks.push({
          type: 'text',
          data: { content: "I couldn't read that link. Paste the content or tell me about it and I'll do the read from there." },
        });
      }

      // Persist parsed_content on the user's latest message (same as normal path),
      // best-effort and non-blocking on failure.
      if (profileId && parsedBlock?.content) {
        try {
          let latestUserMsgQuery = sb
            .from('chat_messages')
            .select('id')
            .eq('profile_id', profileId)
            .eq('role', 'user')
            .order('created_at', { ascending: false })
            .limit(1);
          if (scopedConversationId) latestUserMsgQuery = latestUserMsgQuery.eq('conversation_id', scopedConversationId);
          const { data: latestUserMsg } = await latestUserMsgQuery.single();
          if (latestUserMsg) {
            await sb.from('chat_messages').update({
              parsed_content: [{
                url: parsedBlock.url,
                content: parsedBlock.content,
                metadata: parsedBlock.metadata,
                quality: parsedBlock.quality,
                sourceType: parsedBlock.sourceType,
              }],
            }).eq('id', latestUserMsg.id);
          }
        } catch (e) {
          console.error('[TASTE_READ_CARD] parsed_content persist failed:', e?.message || e);
        }
      }

      console.log(`[TASTE_READ_CARD] profileId=${profileId} url=${tasteReadUrl} parsed=${!!parsedBlock?.content}`);
      return NextResponse.json({ message: '', blocks: cardBlocks });
    }

    // ── Re-inject parsed content from recent messages for follow-up turns ──
    // If the current message has no URLs but a recent message has parsed_content,
    // re-inject it so the AI can continue discussing the link accurately.
    // Only look within the last 5 messages (if the link is older, conversation moved on).
    const hasNewParsedContent = parsedLinkBlocks.some(b => b.quality !== 'failed');
    // Skip on taste read turns — the parsed content is already injected directly
    // via the TASTE READ REQUEST block; re-injecting prior context degrades the read.
    if (!isVisitor && profileId && !generateOpening && !hasNewParsedContent && !tasteReadUrl) {
      try {
        let recentMsgsQuery = sb
          .from('chat_messages')
          .select('rec_refs')
          .eq('profile_id', profileId)
          .order('created_at', { ascending: false })
          .limit(5);
        if (scopedConversationId) recentMsgsQuery = recentMsgsQuery.eq('conversation_id', scopedConversationId);
        const { data: recentMsgs } = await recentMsgsQuery;

        if (recentMsgs) {
          const msgWithContent = recentMsgs.find(m =>
            Array.isArray(m.rec_refs) && m.rec_refs.length > 0
          );

          if (msgWithContent) {
            const hasRecRefs = Array.isArray(msgWithContent.rec_refs) && msgWithContent.rec_refs.length > 0;

            if (hasRecRefs) {
              // New path: fetch rec_files rows and build structured blocks
              const idsToFetch = msgWithContent.rec_refs.slice(0, 2);
              const { data: recFileRows, error: recFilesErr } = await sb
                .from('rec_files')
                .select('id, body_md, work, source')
                .in('id', idsToFetch);

              if (recFilesErr) {
                console.error('[chat-route] rec_files re-injection fetch error:', recFilesErr.message);
              } else if (recFileRows?.length > 0) {
                const REC_FILES_CONTEXT_CAP = 40000;
                let recFilesContextTotal = 0;
                let injected = 0;
                const injectedBlocks = [];
                for (let i = 0; i < recFileRows.length; i++) {
                  const row = recFileRows[i];
                  const block = buildRecFileContextBlock(row, { bodyMdCap: 8000 });
                  if (recFilesContextTotal + block.length > REC_FILES_CONTEXT_CAP) {
                    console.log('[REC_FILES_REINJECTION] Global 40K cap hit, stopping at N blocks', {
                      injected,
                      skipped: recFileRows.length - injected,
                      totalChars: recFilesContextTotal,
                    });
                    break;
                  }
                  injectedBlocks.push(block);
                  recFilesContextTotal += block.length;
                  injected += 1;
                }
                if (injectedBlocks.length > 0) {
                  linkContextBlock += injectedBlocks.join('\n\n');
                }
                console.log('[chat-route] re-injection via rec_refs:', idsToFetch, { injected, totalChars: recFilesContextTotal });
              }
            }
          }
        }
      } catch (err) {
        console.error('[PARSED_CONTENT_REINJECTION_ERROR]', err.message);
      }
    }

    // Build the recommendations context.
    // Taste read turns get an empty context — the read must be a pure analysis
    // of the submitted content, with no awareness of the curator's other recs.
    const curHandle = curatorHandle?.replace('@', '') || '';
    // CHAT-VERBOSITY fix: strip recs context on URL-drop turns. The model produces
    // comparative essays weaving the URL into the curator's existing recs list when
    // both are injected. URL-drop turns get a focused, action-oriented response;
    // conversational turns (no URL parsed this turn) keep the full recs context.
    const isUrlDropTurn = parsedLinkBlocks.length > 0;
    const recsContext = (tasteReadUrl || isUrlDropTurn)
      ? ""
      : (recommendations && recommendations.length > 0
        ? `\n\nCRITICAL: Only reference recommendations that appear in the CURRENT RECOMMENDATIONS LIST below. If something was discussed in previous chat messages but is NOT in the current list, the curator has deleted it. Never mention it, never reference it, pretend it never existed. The current list is the ONLY source of truth for what the curator recommends.\n\nCURRENT RECOMMENDATIONS LIST (${recommendations.length} total):\n${recommendations.map(r => {
            const recLink = r.slug ? ` [REC_LINK: /${curHandle}/${r.slug}]` : "";
            return `- ${r.title} [${r.category}] (added: ${r.date || 'unknown'}) — ${r.context || "No context"} (tags: ${(r.tags || []).join(", ")})${recLink}`;
          }).join("\n")}`
        : "\n\nNo recommendations captured yet.");

    // Build the system prompt based on mode
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const dateHeader = `Today is ${today}. Use this when the curator references "this year," "lately," "recent," or asks about timing.\n\n`;

    let systemPrompt;
    let inviterCtx = { inviterName: null, inviterHandle: null, inviterNote: null };
    if (isVisitor) {
      // Visitor AI personality is driven by the curator's taste profile markdown.
      // Public sections ground the AI in the curator's taste; the Voice & Style
      // section tells it how to speak. If no profile exists, fall back to a
      // neutral default — style_summary column was dropped 2026-04-15.
      let styleBlock = "";
      if (profileId) {
        try {
          const { data: tasteProfile } = await sb
            .from("taste_profiles")
            .select("content")
            .eq("profile_id", profileId)
            .single();
          const publicSections = extractPublicSections(tasteProfile?.content);
          const voice = extractVoiceAndStyle(tasteProfile?.content);
          if (publicSections) {
            styleBlock += `\n\n=== CURATOR TASTE PROFILE ===\n${publicSections}\n=== END ===`;
          }
          if (voice) {
            styleBlock += `\n\n=== VOICE & STYLE ===\nWhen responding, speak in the voice described below:\n${voice}\n=== END ===`;
          }
        } catch (err) {
          console.error("[VISITOR_TASTE_PROFILE_FETCH_ERROR]", err?.message || err);
        }
      }
      systemPrompt = buildVisitorPrompt({ curatorName, styleBlock, recsContext, aiProfile });
    } else if (isOnboarding && profileId) {
      // Fetch taste profile for injection. Skip on URL-drop turns (CHAT-VERBOSITY).
      let tasteProfileBlock = '';
      if (!isUrlDropTurn) {
        try {
          const { data: tasteProfile } = await sb
            .from('taste_profiles')
            .select('content')
            .eq('profile_id', profileId)
            .single();
          if (tasteProfile?.content) {
            tasteProfileBlock = `\n\n=== CURATOR REFERENCE DOCUMENT ===
The following document was generated separately to summarize this curator's recs and patterns. Use it as factual reference: who they are, what they have saved, what domains they cover, how they communicate.
Do NOT mirror its verdict-shaped voice in your responses. Do NOT restate its thesis at them. The document is for your context only. Your responses follow the charter and skill files, not the document's voice.

${tasteProfile.content}

=== END REFERENCE DOCUMENT ===`;
          }
        } catch (err) {
          console.error('Failed to fetch taste profile:', err);
        }
      }

      inviterCtx = await getInviterContext(profileId);
      // Taste read turns: skip network context — pure content analysis only.
      const onboardingNetworkContext = (profileId && !tasteReadUrl) ? await getSubscribedRecs(profileId) : '';
      systemPrompt = dateHeader + buildOnboardingPrompt({
        curatorName,
        inviterName: inviterCtx.inviterName,
        inviterHandle: inviterCtx.inviterHandle,
        inviterNote: inviterCtx.inviterNote,
        tasteProfileBlock,
        networkContext: onboardingNetworkContext,
        aiProfile,
      }) + recsContext + linkContextBlock;
    } else {
      // Fetch taste profile for injection. Skip on URL-drop turns (CHAT-VERBOSITY).
      let tasteProfileBlock = '';
      if (!isUrlDropTurn) {
        try {
          const { data: tasteProfile } = await sb
            .from('taste_profiles')
            .select('content')
            .eq('profile_id', profileId)
            .single();
          if (tasteProfile?.content) {
            tasteProfileBlock = `\n\n=== CURATOR REFERENCE DOCUMENT ===
The following document was generated separately to summarize this curator's recs and patterns. Use it as factual reference: who they are, what they have saved, what domains they cover, how they communicate.
Do NOT mirror its verdict-shaped voice in your responses. Do NOT restate its thesis at them. The document is for your context only. Your responses follow the charter and skill files, not the document's voice.

${tasteProfile.content}

=== END REFERENCE DOCUMENT ===`;
          }
        } catch (err) {
          console.error('Failed to fetch taste profile:', err);
        }
      }

      // Taste read turns: skip network context — pure content analysis only.
      const networkContext = (profileId && !tasteReadUrl) ? await getSubscribedRecs(profileId) : '';
      systemPrompt = dateHeader + buildStandardPrompt({
        curatorName,
        curatorHandle: curatorHandle || '',
        curatorProfile: { bio: curatorBio, location: '' },
        networkContext,
        tasteProfileBlock,
        aiProfile,
      }) + recsContext + linkContextBlock;
    }

    // Link drop acknowledgment: when a curator drops a link, do not analyze it
    // unsolicited — wait for them to choose an action via the buttons.
    const hasSuccessfulParse = parsedLinkBlocks.some(b => b.quality === 'full' || b.quality === 'partial');
    if (hasSuccessfulParse && !tasteReadUrl && !generateOpening && !isVisitor) {
      systemPrompt += `\n\n=== LINK DROPPED — ACKNOWLEDGMENT ONLY ===
The curator just dropped a link. Do NOT analyze it, interpret it, summarize its themes, or connect it to their taste or existing recommendations.
Your ONLY job right now is to acknowledge what you can see:
- State the title and author/publication
- State what you have access to: full article, partial content (X of Y items), or just the landing page
- Do not editorialize, do not offer opinions, do not make connections
- Keep it to 1-2 sentences maximum
The curator will choose what to do with it via the action buttons.
=== END ===`;
    }

    // Handle opening message generation (no user message yet)
    if (generateOpening) {
      const openingMessages = [
        { role: "user", content: "Generate your opening message now. Follow the OPENING MESSAGE instructions exactly — use the inviter name, inviter note, and curator name provided in your system prompt. Output only the opening message, nothing else." },
      ];

      try {
        systemPrompt = enforceSystemPromptCap(systemPrompt, { profileId, tasteReadUrl, parsedBlocksCount: parsedLinkBlocks.length });
        console.log('[CHAT_PROMPT_DEBUG_SENTINEL] site=opening reached pre-claude-call, env.DEBUG_CHAT_PROMPT=' + String(process.env.DEBUG_CHAT_PROMPT));
        if (process.env.DEBUG_CHAT_PROMPT === '1') {
          const _debugTurnId = Math.random().toString(36).slice(2, 10);
          const _debugPrompt = systemPrompt || '';
          const _debugSite = 'opening';
          const _debugMsgs = openingMessages;
          console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] system prompt length: ${_debugPrompt.length}`);
          console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] messages count: ${_debugMsgs?.length || 0}`);
          console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] last 2 messages: ${JSON.stringify(_debugMsgs?.slice(-2) || [], null, 2)}`);
          const _chunkSize = 3000;
          const _totalChunks = Math.ceil(_debugPrompt.length / _chunkSize) || 1;
          for (let i = 0; i < _totalChunks; i++) {
            const _chunk = _debugPrompt.slice(i * _chunkSize, (i + 1) * _chunkSize);
            console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] prompt chunk ${i + 1}/${_totalChunks}:\n${_chunk}`);
          }
        }
        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 400,
          system: systemPrompt,
          messages: openingMessages,
        });

        const aiMessage = response.content[0]?.text || "Hey! I'm here to learn what you're into. What's something you wish more people knew about?";
        return NextResponse.json({ message: aiMessage });
      } catch (openingErr) {
        console.error(`[OPENING_API_ERROR] status=${openingErr.status || 'unknown'} type=${openingErr.error?.type || 'unknown'} profileId=${profileId} message=${openingErr.message}`);
        console.error(`[OPENING_FALLBACK] profileId=${profileId} inviterName=${!!inviterCtx.inviterName} error=${openingErr.message}`);
        const name = curatorName?.split(' ')[0] || curatorName || 'there';
        const fallbackMessage = inviterCtx.inviterName
          ? `Hi — ${inviterCtx.inviterName} brought you into Curators. What kinds of things do you love recommending?`
          : `Hey ${name}! I'm your Lens. I'm here to learn what you're into and help you capture it.\n\nWhat's something you've been recommending to everyone lately?`;
        return NextResponse.json({ message: fallbackMessage });
      }
    }

    // Current rec titles for filtering
    const currentTitles = new Set((recommendations || []).map(r => r.title));

    // Build messages array from history, stripping deleted rec references
    const messages = [];

    // ── Server-side history fetch for replay (replaces client `history` for rehydration) ──
    // Ignores client-supplied history; pulls authoritative rows from DB.
    // Capped at 2 rehydrated images per request to bound prompt size.
    let serverHistory = [];
    if (profileId) {
      try {
        let historyQuery = sb
          .from('chat_messages')
          .select('id, role, text, captured_rec, meta, created_at')
          .eq('profile_id', profileId)
          .order('created_at', { ascending: false })
          .limit(10);
        if (scopedConversationId) historyQuery = historyQuery.eq('conversation_id', scopedConversationId);
        const { data: rows, error: histErr } = await historyQuery;

        if (histErr) {
          console.error('[HISTORY_FETCH_ERROR]', histErr.message);
        } else if (rows) {
          // Reverse to chronological order for replay
          serverHistory = rows.slice().reverse();
        }
      } catch (err) {
        console.error('[HISTORY_FETCH_ERROR] catch', err?.message || err);
      }
    }

    // Identify the 2 most recent user rows that carry image artifacts (for rehydration cap).
    const imageBearingRowIds = serverHistory
      .filter(r => r.role === 'user' && r.meta?.imageRecCandidate?.sha256)
      .slice(-2)
      .map(r => r.id);

    let imagesRehydrated = 0;

    for (const msg of serverHistory) {
      let text = msg.text || "";

      // Captured rec stale check (existing behavior, ported to server rows)
      if (msg.captured_rec && !currentTitles.has(msg.captured_rec)) {
        text = text.replace(/📍 Adding:.*$/ms, '[A recommendation was captured here but has since been removed by the curator.]');
      }

      const hasImage = msg.role === 'user' && msg.meta?.imageRecCandidate?.sha256;
      const shouldRehydrate = hasImage && imageBearingRowIds.includes(msg.id);

      if (shouldRehydrate) {
        try {
          const { data: blob, error: dlErr } = await sb
            .storage
            .from('artifacts')
            .download(msg.meta.imageRecCandidate.artifactPath);

          if (dlErr || !blob) {
            console.error('[IMAGE_REHYDRATE_ERROR]', dlErr?.message || 'no blob', 'rowId=', msg.id);
            text = text ? `${text} [an earlier image was shared, no longer in context]` : '[an earlier image was shared, no longer in context]';
            if (text.trim()) {
              messages.push({ role: 'user', content: text });
            }
            continue;
          }

          const arrayBuf = await blob.arrayBuffer();
          const base64 = Buffer.from(arrayBuf).toString('base64');

          messages.push({
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: msg.meta.imageRecCandidate.mimeType, data: base64 } },
              ...(text.trim() ? [{ type: 'text', text }] : []),
            ],
          });
          imagesRehydrated++;
          console.log('[IMAGE_REHYDRATE] rowId=', msg.id, 'sha=', msg.meta.imageRecCandidate.sha256, 'count=', imagesRehydrated);
          continue;
        } catch (err) {
          console.error('[IMAGE_REHYDRATE_ERROR] catch', err?.message || err, 'rowId=', msg.id);
          text = text ? `${text} [an earlier image was shared, no longer in context]` : '[an earlier image was shared, no longer in context]';
          if (text.trim()) {
            messages.push({ role: 'user', content: text });
          }
          continue;
        }
      }

      // Image in row but outside the rehydration cap — stub
      if (hasImage && !shouldRehydrate) {
        text = text ? `${text} [an earlier image was shared, no longer in context]` : '[an earlier image was shared, no longer in context]';
      }

      if (!text.trim()) continue;

      if (msg.role === 'user') {
        messages.push({ role: 'user', content: text });
      } else if (msg.role === 'ai' || msg.role === 'assistant') {
        messages.push({ role: 'assistant', content: text });
      }
    }

    // Add a reminder of current recs right before the user's message
    if (recommendations && recommendations.length > 0) {
      const titleList = recommendations.map(r => r.title).join(", ");
      messages.push({ role: "user", content: `REMINDER: My current recommendations are ONLY: ${titleList}. Do not reference anything not on this list.` });
      messages.push({ role: "assistant", content: "Understood. I'll only reference your current recommendations." });
    }

    // Add the current message — no metadata injection, URL is in the message text
    let currentMessageText = message || "What's this?";

    if (image && image.base64 && image.mimeType) {
      // Strip data URI prefix — Claude expects raw base64
      const base64Data = image.base64.replace(/^data:image\/[^;]+;base64,/, "");
      messages.push({
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mimeType, data: base64Data } },
          { type: "text", text: currentMessageText },
        ],
      });
    } else {
      messages.push({ role: "user", content: currentMessageText });
    }

    // Ensure messages alternate properly (Claude requires this)
    const cleanedMessages = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const prev = cleanedMessages[cleanedMessages.length - 1];
      if (prev && prev.role === msg.role) {
        // Merge consecutive same-role messages (skip if either is multimodal array content)
        if (Array.isArray(prev.content) || Array.isArray(msg.content)) {
          cleanedMessages.push({ ...msg });
          continue;
        }
        prev.content += "\n" + msg.content;
      } else {
        cleanedMessages.push({ ...msg });
      }
    }

    // Ensure first message is from user
    if (cleanedMessages.length > 0 && cleanedMessages[0].role !== "user") {
      cleanedMessages.shift();
    }

    // ── Taste read on previous link: curator says "read those links" without pasting a new URL ──
    let hasLinkContent = parsedLinkBlocks.length > 0;

    if (!isVisitor && !generateOpening && message && !hasLinkContent && isTasteReadIntent(message)) {
      const tasteReadStart = Date.now();
      const recentUrl = findRecentUrl(history, null);

      if (recentUrl) {
        const parsed = await parseContentForTasteRead(recentUrl.url);
        const durationMs = Date.now() - tasteReadStart;

        if (parsed.quality === 'failed') {
          systemPrompt += `\n\n=== LINK PARSE FAILED (${recentUrl.url}) ===\nThe curator asked for a taste read but parsing failed: ${parsed.error}\nYou could NOT read this link. Do NOT describe, summarize, or reference its contents.\nTell the curator honestly: "I couldn't read that link. Can you paste the content or tell me about it?"\n=== END ===`;
          console.error(`[TASTE_READ_TIMING] url=${recentUrl.url} parser=${parsed.parserName} duration_ms=${durationMs} status=error`);
          // Track failed parse
          parsedLinkBlocks.push({ url: recentUrl.url, quality: 'failed', sourceType: parsed.sourceType, parseTimeMs: durationMs, error: parsed.error });
        } else {
          hasLinkContent = true;
          const meta = parsed.metadata;
          const qualityLabel = parsed.quality === 'full' ? 'FULL' : 'PARTIAL';
          const qualityNote = parsed.quality === 'full'
            ? 'you have the complete content. Reference it specifically.'
            : 'you have some content but not everything. Name the specific items you can see.';
          const tasteReadContent = truncateOnBoundary(parsed.content, 40000);
          if (parsed.content.length > 40000) {
            console.log(`[TASTE_READ_REINJECTION] Capped content from ${parsed.content.length} to ${tasteReadContent.length} chars`);
          }
          systemPrompt += `\n\n=== PARSED LINK CONTENT (${recentUrl.url}) ===
Quality: ${qualityLabel} -- ${qualityNote}
The curator wants you to engage with this link they shared earlier.
Title: ${meta.title || 'Unknown'}
Provider: ${meta.providerName || meta.source || 'Unknown'}
Author: ${meta.author || 'Unknown'}

${tasteReadContent}
=== END PARSED CONTENT ===`;

          parsedLinkBlocks.push({ url: recentUrl.url, quality: parsed.quality, metadata: parsed.metadata, content: parsed.content, sourceType: parsed.sourceType, parseTimeMs: durationMs });
          console.log(`[TASTE_READ_TIMING] url=${recentUrl.url} parser=${parsed.parserName} quality=${parsed.quality} duration_ms=${durationMs} status=success`);
          if (durationMs > 45000) {
            console.warn(`[TASTE_READ_SLOW] url=${recentUrl.url} parser=${parsed.parserName} duration_ms=${durationMs} -- approaching Vercel timeout`);
          }
        }
      }
    }

    const maxTokens = hasLinkContent ? 1000 : 600;
    const isCuratorStandardMode = !isVisitor && !isOnboarding && !!profileId;
    const toolsParam = isCuratorStandardMode ? { tools: [CURATOR_STATS_TOOL] } : {};

    let response;
    const apiStart = Date.now();
    try {
      systemPrompt = enforceSystemPromptCap(systemPrompt, { profileId, tasteReadUrl, parsedBlocksCount: parsedLinkBlocks.length });
      console.log('[CHAT_PROMPT_DEBUG_SENTINEL] site=main reached pre-claude-call, env.DEBUG_CHAT_PROMPT=' + String(process.env.DEBUG_CHAT_PROMPT));
      if (process.env.DEBUG_CHAT_PROMPT === '1') {
        console.error('[CHAT_PROMPT_DEBUG_ERRLEVEL] main site debug block entered');
        const _debugTurnId = Math.random().toString(36).slice(2, 10);
        const _debugPrompt = systemPrompt || '';
        const _debugSite = 'main';
        const _debugMsgs = cleanedMessages;
        console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] system prompt length: ${_debugPrompt.length}`);
        console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] messages count: ${_debugMsgs?.length || 0}`);
        console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] last 2 messages: ${JSON.stringify(_debugMsgs?.slice(-2) || [], null, 2)}`);
        const _chunkSize = 3000;
        const _totalChunks = Math.ceil(_debugPrompt.length / _chunkSize) || 1;
        for (let i = 0; i < _totalChunks; i++) {
          const _chunk = _debugPrompt.slice(i * _chunkSize, (i + 1) * _chunkSize);
          console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] prompt chunk ${i + 1}/${_totalChunks}:\n${_chunk}`);
        }
      }
      response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: cleanedMessages,
        ...toolsParam,
      });

      // Tool-use loop: curator-only, one hop. If the AI called get_curator_stats,
      // run the handler, feed the tool_result back, and get the final text response.
      if (response.stop_reason === 'tool_use' && isCuratorStandardMode) {
        const toolUseBlock = response.content.find(b => b.type === 'tool_use');
        if (toolUseBlock && toolUseBlock.name === 'get_curator_stats') {
          console.log(`[CURATOR_STATS] tool invoked profileId=${profileId}`);
          const toolResult = await handleCuratorStatsTool(sb, profileId);

          const toolLoopMessages = [
            ...cleanedMessages,
            { role: "assistant", content: response.content },
            {
              role: "user",
              content: [{
                type: "tool_result",
                tool_use_id: toolUseBlock.id,
                content: JSON.stringify(toolResult),
              }],
            },
          ];

          systemPrompt = enforceSystemPromptCap(systemPrompt, { profileId, tasteReadUrl, parsedBlocksCount: parsedLinkBlocks.length });
          console.log('[CHAT_PROMPT_DEBUG_SENTINEL] site=tool_loop reached pre-claude-call, env.DEBUG_CHAT_PROMPT=' + String(process.env.DEBUG_CHAT_PROMPT));
          if (process.env.DEBUG_CHAT_PROMPT === '1') {
            const _debugTurnId = Math.random().toString(36).slice(2, 10);
            const _debugPrompt = systemPrompt || '';
            const _debugSite = 'tool_loop';
            const _debugMsgs = toolLoopMessages;
            console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] system prompt length: ${_debugPrompt.length}`);
            console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] messages count: ${_debugMsgs?.length || 0}`);
            console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] last 2 messages: ${JSON.stringify(_debugMsgs?.slice(-2) || [], null, 2)}`);
            const _chunkSize = 3000;
            const _totalChunks = Math.ceil(_debugPrompt.length / _chunkSize) || 1;
            for (let i = 0; i < _totalChunks; i++) {
              const _chunk = _debugPrompt.slice(i * _chunkSize, (i + 1) * _chunkSize);
              console.log(`[CHAT_PROMPT_DEBUG turn=${_debugTurnId} site=${_debugSite}] prompt chunk ${i + 1}/${_totalChunks}:\n${_chunk}`);
            }
          }
          response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: toolLoopMessages,
            tools: [CURATOR_STATS_TOOL],
          });
        }
      }
    } catch (apiError) {
      const durationMs = Date.now() - apiStart;
      const isTimeout = apiError.status === 408 || apiError.error?.type === 'timeout' || /timeout/i.test(apiError.message);

      if (isTimeout) {
        console.error(`[CHAT_API_TIMEOUT] duration_ms=${durationMs} profileId=${profileId} mode=${isVisitor ? 'visitor' : isOnboarding ? 'onboarding' : 'standard'}`);
      }
      console.error(`[CHAT_API_ERROR] status=${apiError.status || 'unknown'} type=${apiError.error?.type || 'unknown'} message=${apiError.message} duration_ms=${durationMs} profileId=${profileId} systemPromptLength=${systemPrompt.length} messagesCount=${cleanedMessages.length} parsedContentOriginalLength=${originalParsedContentLength} capFired=${linkContextCapped} systemPromptCapFired=${systemPrompt.includes('[SYSTEM PROMPT TRUNCATED DUE TO LENGTH')}`);

      const friendlyMessage = "I'm having trouble thinking right now. Give me a moment and try again.";
      return NextResponse.json({
        message: friendlyMessage,
        blocks: [{ type: "text", data: { content: friendlyMessage } }],
      });
    }

    // After tool-use, response.content may have non-text blocks first. Find the text block.
    let aiMessage = (response.content.find(b => b.type === 'text')?.text) || "Sorry, I couldn't generate a response.";

    // ── Extract and process feedback if present ──
    const feedbackMatch = aiMessage.match(/\[FEEDBACK\]([\s\S]*?)\[\/FEEDBACK\]/);
    if (feedbackMatch) {
      try {
        const feedback = JSON.parse(feedbackMatch[1].trim());

        // Save to feedback table
        const { error: fbError } = await sb.from('feedback').insert({
          profile_id: profileId,
          handle: curatorHandle || null,
          original_message: feedback.message,
          summary: feedback.type ? `[${feedback.type}] ${feedback.summary}` : feedback.summary,
        });
        if (fbError) {
          console.error('[FEEDBACK_DB_ERROR]', fbError.message);
        }

        // Send email notification to founder
        try {
          const { resend } = await import('../../../lib/resend.js');
          await resend.emails.send({
            from: 'Curators <noreply@curators.com>',
            to: process.env.FEEDBACK_EMAIL || 'shamal@curators.com',
            subject: `[Feedback] ${feedback.type}: ${feedback.summary}`,
            text: `Feedback from ${curatorName} (@${curatorHandle}):\n\n"${feedback.message}"\n\nType: ${feedback.type}\nSummary: ${feedback.summary}`,
          });
        } catch (emailErr) {
          console.error('[FEEDBACK_EMAIL_ERROR]', emailErr.message);
        }

        console.log(`[FEEDBACK_CAPTURED] profile=${profileId} type=${feedback.type} summary=${feedback.summary}`);
      } catch (parseErr) {
        console.error('[FEEDBACK_PARSE_ERROR]', parseErr.message);
      }

      // Strip the [FEEDBACK] block from the visible message
      aiMessage = aiMessage.replace(/\[FEEDBACK\][\s\S]*?\[\/FEEDBACK\]/, '').trim();
    }

    if (profileId) {
      console.log('TRACKING: sent a message, profileId:', profileId);
      const { error: trackingError } = await sb.from('profiles').update({
        last_seen_at: new Date().toISOString(),
        last_action: 'sent a message',
        last_action_at: new Date().toISOString()
      }).eq('id', profileId);
      if (trackingError) console.error('TRACKING ERROR:', trackingError);
    }

    // ── Feature B: persist image to artifacts + infer metadata for save prompt ──
    let imageRecCandidate = null;
    if (image && image.base64 && image.mimeType && profileId && !isVisitor) {
      try {
        // (a) Decode base64 to bytes and upload to artifacts bucket
        const rawBase64 = image.base64.replace(/^data:image\/[^;]+;base64,/, "");
        const imageBytes = Buffer.from(rawBase64, "base64");
        const artifactResult = await uploadArtifact(sb, profileId, imageBytes, image.mimeType);

        // (b) Generate signed URL for preview (1 hour expiry)
        let signedUrl = null;
        const { data: signedData, error: signedErr } = await sb
          .storage
          .from("artifacts")
          .createSignedUrl(artifactResult.path, 3600);
        if (signedErr) {
          console.error(`[CHAT_API_ERROR] feature_b_signed_url error=${signedErr.message} profileId=${profileId}`);
        } else {
          signedUrl = signedData.signedUrl;
        }

        // (c) Second Claude call to infer rec metadata from the image
        if (signedUrl) {
          const inferBase64 = rawBase64;
          const inferMessages = [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: image.mimeType, data: inferBase64 } },
                ...(message ? [{ type: "text", text: message }] : []),
              ],
            },
          ];

          const inferResponse = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 400,
            system: `You are extracting recommendation metadata from an image a curator just shared. Respond with ONLY a JSON object, no prose, no markdown fences:\n{"title": "<short title, max 60 chars>", "category": "<one of: watch, listen, read, visit, get, wear, play, other>", "suggested_why": "<one sentence describing what makes this save-worthy, max 140 chars>"}\nIf the image is not save-worthy as a recommendation (e.g. a screenshot of an error, a blank image, a personal photo with no recommendation context), respond with: {"skip": true}`,
            messages: inferMessages,
          });

          const inferText = (inferResponse.content[0]?.text || "").trim();
          // (d) Parse JSON — strip markdown fences if present
          const cleanedInfer = inferText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
          try {
            const inferred = JSON.parse(cleanedInfer);
            if (!inferred.skip && inferred.title && inferred.category) {
              // (e) Build imageRecCandidate
              imageRecCandidate = {
                sha256: artifactResult.sha256,
                artifactRef: artifactResult.ref,
                artifactPath: artifactResult.path,  // for signed URL regeneration on DB reload
                signedUrl,
                mimeType: image.mimeType,
                sizeBytes: imageBytes.length,
                inferred: {
                  title: inferred.title,
                  category: inferred.category,
                  suggested_why: inferred.suggested_why || "",
                },
              };
            }
          } catch (parseErr) {
            console.error(`[CHAT_API_ERROR] feature_b_infer_parse error=${parseErr.message} raw=${cleanedInfer.substring(0, 200)} profileId=${profileId}`);
          }
        }
      } catch (featureBErr) {
        console.error(`[CHAT_API_ERROR] feature_b_pipeline error=${featureBErr.message} profileId=${profileId}`);
      }
    }

    // ── Build content blocks ──
    const detectedUrls = message ? (normalizeUrls(message).match(URL_REGEX) || []) : [];

    let mediaEmbeds = [];
    if (!isVisitor && !generateOpening && detectedUrls.length > 0) {
      mediaEmbeds = await buildMediaEmbedBlocks(detectedUrls, parsedLinkBlocks);
    }

    const blocks = [];
    blocks.push(...mediaEmbeds);

    // Extract rec capture from AI text
    let recCapture = extractRecCapture(aiMessage);

    // Validate context against actual curator messages — prevents hallucinated context
    if (recCapture) {
      validateRecContext(recCapture, history, message);
    }

    // Strip [REC]...[/REC] from the text block content so it doesn't render as raw JSON
    const cleanedAiMessage = aiMessage.replace(/\[REC\][\s\S]*?\[\/REC\]/, '').trim();

    blocks.push({ type: "text", data: { content: cleanedAiMessage } });

    // Feature C: emit save prompt buttons when a fresh URL was parsed successfully.
    // One button per successfully parsed URL (typically 1, capped at 3 URLs per message
    // by the existing URL regex slice). Skip on failed parses — nothing to save.
    // Skip if the AI already captured a rec in this turn (recCapture is set) — no
    // need to double up the save prompt.
    // Suppress on follow-on turns triggered by the action buttons themselves —
    // raw action strings or the taste_read injected prompt. Otherwise we re-emit
    // the buttons and create a tap loop.
    const incomingMsg = (message || "").trim();
    const isFollowOnFromButtons =
      incomingMsg.startsWith("discuss_link:") ||
      incomingMsg.startsWith("taste_read:");

    // Show buttons on ANY URL drop — including failed parses. The curator can
    // still choose to save it as a rec or attempt a taste read (which will
    // honestly report no content) or just talk about it.
    if (parsedLinkBlocks.length > 0 && !recCapture && !isFollowOnFromButtons) {
      const firstUrl = parsedLinkBlocks[0].url;
      blocks.push({
        type: "action_buttons",
        data: {
          prompt: "What do you want to do with this link?",
          options: [
            {
              label: "Save as Recommendation",
              action: `save_rec_from_chat:${firstUrl}`,
              style: "primary",
            },
            {
              label: "Add to Record",
              action: `taste_read:${firstUrl}`,
              style: "secondary",
            },
            {
              label: "Just talk about it",
              action: `discuss_link:${firstUrl}`,
              style: "secondary",
            },
          ],
        },
      });
    }

    // Feature B: emit save prompt buttons when an image was persisted and inference succeeded.
    // Image candidate wins over recCapture -- if Claude emitted a rogue [REC] from the image,
    // suppress it so we don't double-save. The action button is the canonical save path for images.
    if (imageRecCandidate) {
      recCapture = null;
    }

    // Skip if Feature C already emitted action_buttons (hasNewParsedContent).
    if (imageRecCandidate && !hasNewParsedContent) {
      blocks.push({
        type: "action_buttons",
        data: {
          prompt: "Want to add this to your archive?",
          options: [
            {
              label: "Save as a Recommendation",
              action: `save_image_rec:${imageRecCandidate.sha256}`,
              style: "primary",
            },
            {
              label: "Not Now",
              action: "skip_save",
            },
          ],
        },
      });
    }

    if (recCapture) {
      // Server-side fallback: if Claude forgot to include the curator's pasted URL, inject it
      if ((!recCapture.links || recCapture.links.length === 0) && detectedUrls.length > 0) {
        recCapture.links = detectedUrls.map(url => {
          let label = '';
          try { label = new URL(url).hostname.replace('www.', ''); } catch { label = 'Link'; }
          return { url, label, type: 'website' };
        });
      }
      blocks.push({
        type: "rec_capture",
        data: recCapture
      });
    }

    // ── Log link parse results (awaited -- fire-and-forget drops on Vercel Lambda shutdown) ──
    if (parsedLinkBlocks.length > 0 && profileId) {
      const HONEST_PHRASES = ["couldn't read", "can't read", "couldn't access", "can't access", "unable to read", "couldn't open", "paste the text", "paste the content", "tell me about it", "tell me what"];
      const aiLower = aiMessage.toLowerCase();

      const logInserts = parsedLinkBlocks.map(block => {
        const aiAcknowledgedFailure = block.quality === 'failed'
          ? HONEST_PHRASES.some(p => aiLower.includes(p))
          : null;

        return sb.from('link_parse_log').insert({
          profile_id: profileId,
          url: block.url,
          source_type: block.sourceType || 'unknown',
          parse_quality: block.quality,
          content_length: block.content?.length || 0,
          parse_time_ms: block.parseTimeMs || null,
          error_message: block.error || null,
          ai_response_excerpt: aiMessage.substring(0, 500),
          ai_acknowledged_failure: aiAcknowledgedFailure,
          metadata: block.metadata || null,
        });
      });

      const logResults = await Promise.all(logInserts);
      for (const { error } of logResults) {
        if (error) console.error('[LINK_PARSE_LOG_ERROR]', error.message);
      }
    }

    // ── Persist parsed content on the user's most recent chat_messages row ──
    // Done server-side with service role key (bypasses RLS -- frontend update silently fails)
    const parsedContentForStorage = parsedLinkBlocks
      .filter(b => b.quality !== 'failed')
      .map(b => ({ url: b.url, content: b.content, metadata: b.metadata, quality: b.quality, sourceType: b.sourceType }));

    let parsedContentMessageId = null;
    if (parsedContentForStorage.length > 0 && profileId) {
      try {
        let latestUserMsgQuery = sb
          .from('chat_messages')
          .select('id')
          .eq('profile_id', profileId)
          .eq('role', 'user')
          .order('created_at', { ascending: false })
          .limit(1);
        if (scopedConversationId) latestUserMsgQuery = latestUserMsgQuery.eq('conversation_id', scopedConversationId);
        const { data: latestUserMsg } = await latestUserMsgQuery.single();

        if (latestUserMsg) {
          parsedContentMessageId = latestUserMsg.id;
          const { error: updateErr } = await sb
            .from('chat_messages')
            .update({ parsed_content: parsedContentForStorage })
            .eq('id', latestUserMsg.id);
          if (updateErr) {
            console.error('[PARSED_CONTENT_SAVE_ERROR]', updateErr.message);
          } else {
            console.log(`[PARSED_CONTENT_SAVED] msgId=${latestUserMsg.id} blocks=${parsedContentForStorage.length}`);
          }
        }
      } catch (err) {
        console.error('[PARSED_CONTENT_SAVE_ERROR]', err.message);
      }
    }

    // ── Persist image artifact pointers on the latest user row for history rehydration ──
    if (imageRecCandidate && profileId) {
      try {
        let latestUserRowQuery = sb
          .from('chat_messages')
          .select('id, meta')
          .eq('profile_id', profileId)
          .eq('role', 'user')
          .order('created_at', { ascending: false })
          .limit(1);
        if (scopedConversationId) latestUserRowQuery = latestUserRowQuery.eq('conversation_id', scopedConversationId);
        const { data: latestUserRow, error: findErr } = await latestUserRowQuery.maybeSingle();

        if (findErr) {
          console.error('[IMAGE_META_PERSIST_ERROR] find', findErr.message);
        } else if (latestUserRow) {
          const mergedMeta = {
            ...(latestUserRow.meta || {}),
            imageRecCandidate: {
              sha256: imageRecCandidate.sha256,
              artifactPath: imageRecCandidate.artifactPath,
              mimeType: imageRecCandidate.mimeType,
            },
          };
          const { error: updateErr } = await sb
            .from('chat_messages')
            .update({ meta: mergedMeta })
            .eq('id', latestUserRow.id);
          if (updateErr) {
            console.error('[IMAGE_META_PERSIST_ERROR] update', updateErr.message);
          } else {
            console.log('[IMAGE_META_PERSIST] success rowId=', latestUserRow.id, 'sha=', imageRecCandidate.sha256);
          }
        }
      } catch (err) {
        console.error('[IMAGE_META_PERSIST_ERROR] catch', err?.message || err);
      }
    }

    // Write rec_files rows for chat-parsed URLs and populate rec_refs
    // Awaited but capped at 2s — Vercel kills unawaited async work after response returns
    if (profileId && parsedContentForStorage.length > 0 && parsedContentMessageId) {
      try {
        await Promise.race([
          (async () => {
            const recFileIds = await ingestChatParsedBlocks(parsedContentForStorage, profileId, curHandle);
            if (recFileIds.length > 0) {
              const { data: msgRow, error: fetchErr } = await sb
                .from('chat_messages')
                .select('rec_refs')
                .eq('id', parsedContentMessageId)
                .maybeSingle();

              if (fetchErr) {
                console.error('[chat-parse-ingest] rec_refs fetch error:', fetchErr.message);
                return;
              }

              const existing = Array.isArray(msgRow?.rec_refs) ? msgRow.rec_refs : [];
              const merged = [...new Set([...existing, ...recFileIds])];

              const { error: updateErr } = await sb
                .from('chat_messages')
                .update({ rec_refs: merged })
                .eq('id', parsedContentMessageId);

              if (updateErr) {
                console.error('[chat-parse-ingest] rec_refs update error:', updateErr.message);
              } else {
                console.log('[chat-parse-ingest] rec_refs written:', merged, { messageId: parsedContentMessageId });
              }
            }
          })(),
          new Promise(resolve => setTimeout(resolve, 2000))
        ]);
      } catch (err) {
        console.error('[chat-parse-ingest] ingest block failed:', err.message);
      }
    }

    return NextResponse.json({
      message: aiMessage,
      blocks: blocks,
      captured_rec: recCapture || undefined,
      // Feature C: return parsed_content so the frontend can look up parsed data
      // when the curator taps "Save as a Recommendation" from a chat action button.
      parsed_content: parsedContentForStorage.length > 0 ? parsedContentForStorage : undefined,
      // Feature B: return imageRecCandidate so the frontend can look up inferred metadata
      // when the curator taps "Save as a Recommendation" from an image action button.
      image_rec_candidate: imageRecCandidate || undefined,
    });
  } catch (error) {
    console.error("Chat API error:", error?.message || error);
    console.error("Chat API stack:", error?.stack || "no stack");
    return NextResponse.json(
      { message: "Sorry, I'm having trouble right now. Try again in a moment." },
      { status: 500 }
    );
  }
}
