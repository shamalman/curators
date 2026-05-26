'use client'

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { T, W, V, F, S, MN, CAT } from "@/lib/constants";
import { useCurator } from "@/context/CuratorContext";
import { supabase } from "@/lib/supabase";
import CaptureCard from "./CaptureCard";
import ProfileCaptureCard from "./ProfileCaptureCard";
import QuickCaptureChip from "./QuickCaptureChip";
import QuickCaptureSheet from "./QuickCaptureSheet";
import FeedbackChip from "./FeedbackChip";
import FeedbackSheet from "./FeedbackSheet";
import AIResponseThumbs from "./AIResponseThumbs";
import ErrorBoundary from "../shared/ErrorBoundary";
import FeedUserBubble from "../feed/FeedUserBubble";
import FeedBlockGroup from "../feed/FeedBlockGroup";
import FeedLegacyBubble from "../feed/FeedLegacyBubble";
import { fetchLinkMetadata } from "@/lib/links/fetchLinkMetadata";

const linkStyle = {
  color: T.acc, textDecoration: "underline",
  textUnderlineOffset: 2, cursor: "pointer",
};

const parseLinks = (text) => {
  const parts = text.split(/(\[.*?\]\(.*?\))/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(.*?)\]\((.*?)\)$/);
    if (!match) return part;
    const [, label, href] = match;
    if (href.startsWith("/")) {
      return <Link key={i} href={href} style={linkStyle}>{label}</Link>;
    }
    return <a key={i} href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>{label}</a>;
  });
};

const renderMd = (text) => text.split("\n").map((line, i) => {
  const b = line.replace(/\*\*(.*?)\*\*/g, '<b_mark>$1</b_mark>');
  const segments = b.split(/(<b_mark>.*?<\/b_mark>)/g);
  const content = segments.map((seg, j) => {
    const boldMatch = seg.match(/^<b_mark>(.*?)<\/b_mark>$/);
    if (boldMatch) return <strong key={j}>{parseLinks(boldMatch[1])}</strong>;
    return <span key={j}>{parseLinks(seg)}</span>;
  });
  return <div key={i} style={{ marginBottom: line === "" ? 8 : 2 }}>{content}</div>;
});

const isSpecificLink = (url) => {
  try {
    const u = new URL(url);
    const p = u.pathname.replace(/\/+$/, '');
    // Root domain with no path and no meaningful query params → not specific
    if (!p && !u.search) return false;
    // Search/browse/explore pages → not specific
    if (/^\/(search|browse|explore|discover|results|home)(\/|$)/i.test(u.pathname)) return false;
    // Channel/user/profile pages → not specific
    if (/^\/(channel|c|user|@[^/]*)(\/[^/]*)?$/i.test(u.pathname)) return false;
    // Category/genre landing pages → not specific
    if (/^\/(category|genre)(\/[^/]*)?$/i.test(u.pathname)) return false;
    // Root domain with only a search query (no real path) → not specific
    if (!p && u.search && !u.searchParams.has('v') && !u.searchParams.has('id')) return false;
    // Has a real path or content query params → specific
    return true;
  } catch { return false; }
};

const hasValidLink = (links) => (links || []).some(l => isSpecificLink(l.url));

export default function ChatView({ variant }) {
  const router = useRouter();
  const {
    profile, setProfile, profileId, isFirstTime, tasteItems, messages, setMessages, dbLoaded, prevMsgCount,
    lensConversationsEnabled, lensConversations, activeLensConversationId, loadLensConversationMessages,
    createLensConversation, startNewLensConversation,
    addRec, saveMsgToDb, saveProfileFromChat, isOwner, signalCount,
  } = useCurator();
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [pendingLink, setPendingLink] = useState(null);
  const [editingCapture, setEditingCapture] = useState(null);
  const [captureLinkInputs, setCaptureLinkInputs] = useState({});
  const [silentByMsgIndex, setSilentByMsgIndex] = useState({});
  const [pendingImage, setPendingImage] = useState(null);
  const imageInputRef = useRef(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const chatEnd = useRef(null);
  const chatScrollRef = useRef(null);
  const shouldScroll = useRef(false);
  const isBackNav = useRef(messages.length > 0);
  const nudgeTimer = useRef(null);
  const typedSinceSave = useRef(false);
  const tappedActionsByMsgId = useRef(new Map());
  const isWaitingForResponse = useRef(false);
  // Bug 1: scope draftWhyFromConversation to messages added in the current session,
  // not historical chat loaded from the DB on mount.
  const sessionStartIndexRef = useRef(0);
  const sessionStartCapturedRef = useRef(false);

  const [isDesktop, setIsDesktop] = useState(false);

  // Quick capture state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [feedbackSheetOpen, setFeedbackSheetOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [lastRecVisibility, setLastRecVisibility] = useState('public');
  // Feature C: prefill data for QuickCaptureSheet when opened from a chat action button
  const [sheetPrefillData, setSheetPrefillData] = useState(null);
  // Day 2: AI response ratings (staging users only)
  const [ratingsByMessageId, setRatingsByMessageId] = useState({});
  const handleRatingChange = useCallback((msgId, newRating) => {
    setRatingsByMessageId(prev => ({ ...prev, [msgId]: newRating }));
  }, []);

  const isCurator = variant === "curator";
  const items = tasteItems;
  const n = items.length;
  const cats = [...new Set(items.map(i => i.category))];
  const showLensCanvas = isCurator && lensConversationsEnabled && messages.length === 0 && !typing && input.length === 0 && !pendingImage;

  const ensureLensConversation = useCallback(async ({ title = null } = {}) => {
    if (!lensConversationsEnabled) return null;
    if (activeLensConversationId) return activeLensConversationId;
    const created = await createLensConversation?.({ title });
    return created?.id || null;
  }, [activeLensConversationId, createLensConversation, lensConversationsEnabled]);

  useEffect(() => { return () => { if (nudgeTimer.current) clearTimeout(nudgeTimer.current); }; }, []);

  // Bug 1: capture session-start index once, when the initial DB load completes.
  useEffect(() => {
    if (dbLoaded && !sessionStartCapturedRef.current) {
      sessionStartIndexRef.current = messages.length;
      sessionStartCapturedRef.current = true;
    }
  }, [dbLoaded, messages.length]);

  // Day 2: hydrate AI response ratings for staging users. Fetch unseen AI-message
  // IDs; store null markers for unrated messages so we don't refetch them.
  useEffect(() => {
    if (profile?.aiProfile !== 'staging') return;
    const aiMsgIds = messages
      .filter(m => m.role === 'ai' && m.id)
      .map(m => m.id);
    const newIds = aiMsgIds.filter(id => !(id in ratingsByMessageId));
    if (newIds.length === 0) return;

    (async () => {
      try {
        const res = await fetch(`/api/ai-response-ratings?message_ids=${newIds.join(',')}`);
        if (!res.ok) return;
        const { ratings } = await res.json();
        setRatingsByMessageId(prev => {
          const next = { ...prev, ...(ratings || {}) };
          for (const id of newIds) {
            if (!(id in next)) next[id] = null;
          }
          return next;
        });
      } catch (err) {
        console.error('[AI_THUMBS_LOAD_ERROR]', err?.message || err);
      }
    })();
  }, [profile?.aiProfile, messages, ratingsByMessageId]);

  // Fetch curator's last rec visibility to default the quick capture sheet
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('recommendations')
          .select('visibility')
          .eq('profile_id', profileId)
          .order('created_at', { ascending: false })
          .limit(1);
        if (cancelled) return;
        if (error) {
          console.error('Failed to fetch last rec visibility:', error);
          return;
        }
        if (data && data[0]?.visibility) setLastRecVisibility(data[0].visibility);
      } catch (err) {
        console.error('Failed to fetch last rec visibility:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  // Quick capture save handler — called by QuickCaptureSheet
  const handleQuickCaptureSaved = async (newItem) => {
    try {
      const conversationId = await ensureLensConversation({ title: newItem?.title || "Recommendation" });
      const saved = await addRec(newItem);
      const recFileId = saved?.rec_file_id || null;
      const recRefs = recFileId ? [recFileId] : [];
      // Close sheet
      setSheetOpen(false);
      setSheetPrefillData(null);
      // Toast: matches existing in-chat pattern (insert a system AI message)
      const toastText = `\u2713 Saved "${saved.title}".`;
      setMessages(prev => [...prev, { role: "ai", text: toastText }]);
      saveMsgToDb("ai", toastText, null, null, recRefs, null, conversationId);
      // Trigger taste profile regen (mirrors line ~501 from in-chat path)
      const recCount = items.length + 1;
      if (recCount >= 3) {
        fetch('/api/generate-taste-profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ profileId }),
        }).catch(err => console.error('Taste profile regen failed:', err));
      }
      // Scroll to bottom
      shouldScroll.current = true;
      setTimeout(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), 50);

      // Post-save taste reflection. Mirrors handleSaveCapture pattern.
      // 1-second delay (quick capture is an explicit form submit, not mid-conversation).
      // Cancelled if curator starts typing in the chat input.
      typedSinceSave.current = false;
      if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
      const savedRec = {
        title: saved.title,
        category: saved.category || 'other',
        context: saved.context || ''
      };
      // Use [saved, ...items] so the just-saved rec is in the payload the AI sees.
      const recsForPrompt = [saved, ...items].map(item => ({
        title: item.title,
        category: item.category,
        context: item.context,
        tags: item.tags,
        date: item.date,
        slug: item.slug,
      }));
      nudgeTimer.current = setTimeout(async () => {
        if (typedSinceSave.current) return;
        setTyping(true);
        try {
          const reflectionMsg = `[SYSTEM: A rec was just saved. Respond with a brief acknowledgment plus exactly one short follow-up question. Hard constraints:

- Max 2 sentences total.
- Exactly one question mark.
- No verdicts about the curator. Do not characterize what they like, hide, hoard, sit on, keep to themselves, gravitate toward, or are drawn to. Do not describe their taste in any form.
- No synthesis across multiple recs. Do not reference other things they have saved.
- No padding with examples that are not in the saved rec content.
- No em dashes.

Pick ONE of these four follow-up moves, and bias AWAY from move A (it tends to feel like drilling):

A. ADJACENT (same domain, different item): only if the curator has shown clear engagement in this exact lane in the last 2 turns. Example: they just saved a restaurant and have been actively talking about restaurants. "Anywhere else lately worth a save?"

B. CROSS-CONTEXT (different city, different category, different mood): preferred default. Move them out of the lane they just finished. If they saved a Chicago restaurant, ask about food in another city OR food of a different vibe OR something completely outside food. "What about other cities, anywhere you have eaten lately that stuck?" "Outside food, anything else been on your mind to save?"

C. SPECIFIC-CALLBACK to a detail in the curator's own why for THIS rec: only when their why contained a concrete hook you can point at without paraphrasing. Quote or near-quote their detail.

D. NETWORK SURFACE (offer to show recs from their subscriptions): only when the network context block contains at least one rec from a curator they subscribe to that is plausibly relevant to what they just saved or to their stated interests. Phrase as an offer, never as a verdict. "Want to see what [Curator Name] has been saving lately?" Use the actual curator name from the network context. If no relevant subscribed rec is in context, do not use this move.

BANNED phrasings (do not produce any sentence matching these patterns):
- "What other [X] have you been keeping to yourself"
- "What else are you sitting on"
- "What are you holding back"
- "What's hiding in your [X]"
- "What's the [X] you have not told anyone about"
- Any phrasing that implies the curator hoards, hides, gatekeeps, or has secrets.

If you cannot produce a clean 2-sentence response that satisfies all constraints, produce only a one-sentence acknowledgment with no question. Silence is better than a banned pattern.]`;
          const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: reflectionMsg,
              curatorName: profile.name,
              curatorHandle: profile.handle?.replace('@', ''),
              curatorBio: profile.bio || '',
              profileId,
              conversationId,
              recommendations: recsForPrompt,
              linkMetadata: null,
              history: messages.filter(m => !m.type).slice(-10),
            }),
          });
          if (!res.ok) throw new Error(`Chat route returned ${res.status}`);
          const data = await res.json();
          setTyping(false);
          if (typedSinceSave.current) return;
          let text = data.message || '';
          text = text.replace(/\[REC\][\s\S]*?\[\/REC\]/, '').trim();
          if (!text) return;
          setMessages(prev => [...prev, { role: "ai", text, blocks: data.blocks || null, interactions: [] }]);
          saveMsgToDb("ai", text, null, data.blocks, recRefs, null, conversationId);
        } catch (err) {
          console.error('Quick capture taste reflection error:', err);
          setTyping(false);
          // Silent failure. The rec is saved, the toast is shown. Reflection is enhancement, not dependency.
        }
      }, 1000);

      return saved;
    } catch (err) {
      console.error('Quick capture save failed in ChatView:', err);
      throw err;
    }
  };

  // Image handling — resize to max 1600px longest edge, re-encode as JPEG
  // to stay well under Vercel's 4.5MB serverless body limit.
  const handleImageFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 15 * 1024 * 1024) return; // 15MB raw file cap (post-resize will be ~500KB-1MB)

    const MAX_EDGE = 1600;
    const JPEG_QUALITY = 0.85;

    try {
      // Load file into an HTMLImageElement via object URL
      const objectUrl = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image decode failed"));
        el.src = objectUrl;
      });

      // Compute resized dimensions preserving aspect ratio
      let { width, height } = img;
      if (width > MAX_EDGE || height > MAX_EDGE) {
        if (width >= height) {
          height = Math.round(height * (MAX_EDGE / width));
          width = MAX_EDGE;
        } else {
          width = Math.round(width * (MAX_EDGE / height));
          height = MAX_EDGE;
        }
      }

      // Draw to canvas and re-encode as JPEG
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);

      const base64 = canvas.toDataURL("image/jpeg", JPEG_QUALITY);

      setPendingImage({
        base64,
        mimeType: "image/jpeg",
        fileName: file.name.replace(/\.[^.]+$/, "") + ".jpg",
        previewUrl: base64,
      });
    } catch (err) {
      console.error("[IMAGE_RESIZE_ERROR]", err?.message || err);
      // HEIC/HEIF can't be decoded by <img> in Chrome/Firefox (Safari works).
      // Give the curator a clear reason instead of a silent failure.
      const isHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      if (isHeic) {
        alert("This browser can't read HEIC images. Open this page in Safari, or convert the image to JPEG or PNG first.");
        return;
      }
      alert("Couldn't process this image. Try a different file or convert to JPEG.");
    }
  };

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setIsDesktop(mq.matches);
    const handler = (e) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Visitor opening message
  useEffect(() => {
    if (!isCurator && profile && dbLoaded && messages.length === 0) {
      // Top content-type tags by volume
      const CONTENT_TYPE_TAGS = ["album","song","podcast","playlist","mix","ep","audiobook","book","article","substack","essay","newsletter","blog post","paper","film","series","documentary","short film","anime","standup special","restaurant","bar","cafe","hotel","park","museum","city","neighborhood","app","tool","gadget","gear","product","software","clothing","shoes","accessories","fashion","beauty","game","sport","activity","hobby","videogame","boardgame"];
      const tagCounts = {};
      items.forEach(item => {
        (item.tags || []).forEach(tag => {
          const t = tag.toLowerCase();
          if (CONTENT_TYPE_TAGS.includes(t)) {
            tagCounts[t] = (tagCounts[t] || 0) + 1;
          }
        });
      });
      const topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([t]) => t + "s");
      const catStr = topTags.length === 0 ? "their favorites"
        : topTags.length === 1 ? topTags[0]
        : topTags.length === 2 ? `${topTags[0]} and ${topTags[1]}`
        : `${topTags[0]}, ${topTags[1]}, and ${topTags[2]}`;

      const styleLine = `Ask me anything about ${profile.name}'s perspective.`;

      setMessages([{ role: "ai", text: `I'm ${profile.name}'s Lens AI, trained on recommendations and inferences across ${catStr}. ${styleLine}` }]);
    }
  }, [isCurator, profile, dbLoaded]);

  // Auto-scroll
  useEffect(() => {
    if (messages.length > prevMsgCount.current || typing) {
      shouldScroll.current = true;
      prevMsgCount.current = messages.length;
    }
    if (shouldScroll.current) {
      chatEnd.current?.scrollIntoView({ behavior: "smooth" });
      shouldScroll.current = false;
    }
  }, [messages, typing]);

  // Save chat scroll position before navigating away via internal links
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const handleClick = (e) => {
      const link = e.target.closest("a[href^='/']");
      if (link && el) {
        sessionStorage.setItem("chatScrollPos", String(el.scrollTop));
      }
    };
    el.addEventListener("click", handleClick);
    return () => el.removeEventListener("click", handleClick);
  }, []);

  // Auto-scroll on initial load (skip + restore position if returning via back navigation)
  useEffect(() => {
    if (dbLoaded && messages.length > 0) {
      if (isBackNav.current) {
        const saved = sessionStorage.getItem("chatScrollPos");
        if (saved != null && chatScrollRef.current) {
          setTimeout(() => { chatScrollRef.current.scrollTop = parseInt(saved, 10); }, 80);
        }
        sessionStorage.removeItem("chatScrollPos");
      } else {
        setTimeout(() => chatEnd.current?.scrollIntoView({ behavior: "instant" }), 100);
      }
    }
    isBackNav.current = false;
  }, [dbLoaded]);

  // Opening prompts for curator chat
  const openingGenerated = useRef(false);
  useEffect(() => {
    if (!dbLoaded || !isCurator || !profile) return;
    if (lensConversationsEnabled) return;
    if (messages.length > 0) return;

    // First-time curator: generate personalized AI opening via API
    if (isFirstTime && !openingGenerated.current) {
      openingGenerated.current = true;
      setTyping(true);
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generateOpening: true,
          curatorName: profile.name,
          curatorHandle: profile.handle?.replace('@', ''),
          curatorBio: profile.bio || '',
          profileId,
          recommendations: [],
        }),
      })
        .then(r => r.json())
        .then(data => {
          setTyping(false);
          const text = data.message;
          setMessages([{ role: "ai", text }]);
          saveMsgToDb("ai", text);
        })
        .catch(() => {
          setTyping(false);
          const name = profile.name?.split(' ')[0] || profile.name;
          setMessages([{ role: "ai", text: `Hey ${name}! I'm your personal taste AI — I'm here to capture what you love and help you share it.\n\nWhat's something you've been recommending to everyone lately?` }]);
        });
      return;
    }

    // Returning curator: standard opening
    const openingPrompts = [
      "What's something you're enjoying that you want to capture and share?",
      "What have you been recommending to people lately?",
      "Anything new you've discovered that deserves a spot in your collection?",
      "What's something you keep telling people about?",
    ];
    const randomPrompt = openingPrompts[Math.floor(Math.random() * openingPrompts.length)];
    const openingMessage = n < 10
      ? `You've got ${n} recommendations so far.\n\n${randomPrompt}`
      : `${n} recs and counting.\n\n${randomPrompt}`;
    setMessages([{ role: "ai", text: openingMessage }]);
  }, [dbLoaded]);


  const send = async (overrideMsg) => {
    const msg = typeof overrideMsg === "object" && overrideMsg !== null
      ? (overrideMsg.message || "")
      : (overrideMsg || input.trim());
    const visibleMsg = typeof overrideMsg === "object" && overrideMsg !== null
      ? (overrideMsg.displayText || msg)
      : msg;
    if (!msg && !pendingImage) return;
    const imageToSend = pendingImage;
    const conversationId = await ensureLensConversation({
      title: visibleMsg ? visibleMsg.slice(0, 80) : (imageToSend ? "Image conversation" : null),
    });
    shouldScroll.current = true;
    setMessages(m => [...m, { role: "user", text: visibleMsg || (imageToSend ? "[sent an image]" : ""), imagePreview: imageToSend?.previewUrl || null }]);
    saveMsgToDb("user", visibleMsg || "[sent an image]", null, null, [], null, conversationId);
    setInput("");
    setPendingImage(null);
    setTyping(true);
    isWaitingForResponse.current = true;

    const isVis = !isCurator;

    const urlMatch = msg.match(/https?:\/\/[^\s]+/);
    let linkMetadata = null;

    if (urlMatch && !isVis) {
      try {
        const meta = await fetchLinkMetadata(urlMatch[0], profileId);
        linkMetadata = meta ? { url: meta.url, title: meta.title, source: meta.type } : null;
        if (linkMetadata) setPendingLink(linkMetadata);
      } catch (e) {
        console.log('Could not fetch link metadata');
      }
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          isVisitor: isVis,
          curatorName: profile.name,
          curatorHandle: profile.handle?.replace('@', ''),
          curatorBio: profile.bio || '',
          profileId,
          conversationId,
          recommendations: items.map(item => ({
            title: item.title, category: item.category,
            context: item.context, tags: item.tags, date: item.date,
            slug: item.slug,
          })),
          linkMetadata,
          history: messages.filter(m => !m.type).slice(-10),
          ...(imageToSend ? { image: { base64: imageToSend.base64, mimeType: imageToSend.mimeType } } : {}),
        }),
      });

      const data = await response.json();
      setTyping(false);
      isWaitingForResponse.current = false;

      let text = data.message || '';
      // Strip [REC]...[/REC] if present
      text = text.replace(/\[REC\][\s\S]*?\[\/REC\]/, '').trim();
      if (!text) text = ' ';

      // Parse and submit feedback capture blocks
      const feedbackMatch = text.match(/\n?FEEDBACK_CAPTURE:(\{[\s\S]*\})\s*$/);
      if (feedbackMatch) {
        text = text.replace(/\n?FEEDBACK_CAPTURE:\{[\s\S]*\}\s*$/, '').trim();
        try {
          const feedbackData = JSON.parse(feedbackMatch[1]);
          fetch('/api/feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              profileId,
              handle: profile.handle?.replace('@', ''),
              originalMessage: feedbackData.originalMessage,
              elaboration: feedbackData.elaboration,
              summary: feedbackData.summary,
            }),
          }).catch(err => console.error('Feedback submit error:', err));
        } catch (e) {
          console.error('Failed to parse feedback JSON:', e);
        }
      }

      const isProfileDraft = text.includes('\u{1F4CB} PROFILE DRAFT') || text.includes('PROFILE DRAFT');

      // Check server-extracted rec first, fall back to emoji parsing
      let capturedRec = data.captured_rec || null;
      let capturedProfile = null;

      if (isProfileDraft) {
        const nameMatch = text.match(/name:\s*(.+)/i);
        const locationMatch = text.match(/location:\s*(.+)/i);
        const bioMatch = text.match(/bio:\s*([\s\S]*?)(?:\n---|\n📋|$)/i);
        capturedProfile = {
          name: nameMatch ? nameMatch[1].trim() : profile.name,
          location: locationMatch ? locationMatch[1].trim() : '',
          bio: bioMatch ? bioMatch[1].trim() : '',
        };
      }

      const imageCandidate = data.image_rec_candidate || null;
      setMessages(m => [...m, { role: "ai", text, capturedRec, capturedProfile, blocks: data.blocks || null, interactions: [], parsed_content: data.parsed_content || null, image_rec_candidate: imageCandidate }]);
      // Bug 3 fix: persist imageRecCandidate in meta jsonb for DB reload hydration
      // Deploy 3: merge taste-read meta from server (taste_read_observation, taste_read_url)
      const serverMeta = data.meta || null;
      let metaForDb = null;
      if (imageCandidate || serverMeta) {
        metaForDb = {
          ...(imageCandidate ? { imageRecCandidate: imageCandidate } : {}),
          ...(serverMeta || {}),
        };
      }
      const savedId = await saveMsgToDb("ai", text, capturedRec, data.blocks, [], metaForDb, conversationId);
      if (savedId) {
        setMessages(m => m.map((msg, idx) => idx === m.length - 1 && msg.role === "ai" && !msg.id ? { ...msg, id: savedId } : msg));
      }
    } catch (error) {
      console.error('Chat error:', error);
      setTyping(false);
      isWaitingForResponse.current = false;
      const errorText = "Sorry, I'm having trouble connecting right now. Try again in a moment.";
      setMessages(m => [...m, { role: "ai", text: errorText }]);
      saveMsgToDb("ai", errorText, null, null, [], null, conversationId);
    }
  };

  // Feature C: draft a "why" from the curator's own words in the conversation.
  // Look for the user message that contained the URL (or a recent user message
  // with evaluative text). Extract verbatim. If no evaluative text found,
  // return empty string and let the curator type their own.
  const draftWhyFromConversation = (targetUrl) => {
    if (!messages || messages.length === 0) return "";
    const sessionStart = sessionStartIndexRef.current;
    for (let i = messages.length - 1; i >= sessionStart && i >= messages.length - 6; i--) {
      const m = messages[i];
      if (m.role !== "user") continue;
      const text = (m.text || "").trim();
      if (!text) continue;
      // Skip if the message is just the URL itself (no commentary)
      const textWithoutUrl = text.replace(targetUrl, "").trim();
      // Skip if the remaining text is itself a URL
      if (/^https?:\/\/\S+$/.test(textWithoutUrl)) continue;
      if (textWithoutUrl.length < 15) continue;
      // Skip meta actions / button responses
      if (textWithoutUrl.startsWith("save_rec_from_chat") || textWithoutUrl.startsWith("save_rec_from_taste_read") || textWithoutUrl === "skip_save") continue;
      // Skip known action confirmation strings injected by the system
      if (textWithoutUrl === "Added to my Taste File." || textWithoutUrl === "Added to my Taste File") continue;
      if (textWithoutUrl.startsWith("Do a Read on ")) continue;
      if (textWithoutUrl.length < 20 && /\.$/.test(textWithoutUrl)) continue;
      if (/^(Added|Saved|Done|Got it|Skip|Keep exploring)[\.\!]?$/i.test(textWithoutUrl)) continue;
      // Got something substantive — return verbatim, truncated to 200 chars
      if (textWithoutUrl.length <= 200) return textWithoutUrl;
      const sliced = textWithoutUrl.slice(0, 200);
      const lastSpace = sliced.lastIndexOf(" ");
      return (lastSpace > 160 ? sliced.slice(0, lastSpace) : sliced) + "\u2026";
    }
    return "";
  };

  // TODO: unify handleSaveFromChat + handleSaveImageFromChat into a single
  // saveCandidate abstraction if a third save-from-chat path is added.
  // Current parallel handlers are intentional — premature abstraction worse
  // than a third copy that reveals the real shared shape. (April 10, 2026)
  //
  // Feature C: handle the "Save as a Recommendation" action button tap from chat.
  // Opens QuickCaptureSheet prefilled with the URL, parsed content, and a
  // draft "why" extracted from the curator's own conversation words.
  const handleSaveFromChat = (url, { skipWhyDraft = false, createdVia = "chat_save_from_url" } = {}) => {
    let parsedPayload = null;
    let title = "";
    let thumbnail_url = null;
    let provider = null;

    // Walk backwards through messages looking for parsed_content that matches this URL.
    // parsed_content is stashed on the AI message from the chat API response.
    let matchedBlock = null;
    for (let i = messages.length - 1; i >= 0 && i >= messages.length - 10; i--) {
      const m = messages[i];
      if (!m.parsed_content || !Array.isArray(m.parsed_content)) continue;
      const match = m.parsed_content.find(block => block.url === url);
      if (match) {
        matchedBlock = match;
        parsedPayload = {
          body_md: match.content || "",
          body_truncated: false,
          body_original_length: (match.content || "").length,
          canonical_url: match.url,
          site_name: match.metadata?.providerName || null,
          author: match.metadata?.author || null,
          authors: match.metadata?.author ? [match.metadata.author] : [],
          published_at: match.metadata?.publishedTime || null,
          lang: "en",
          word_count: (match.content || "").split(/\s+/).filter(Boolean).length,
          media_type: "text/html",
          artifact_sha256: null,
          artifact_ref: null,
          extraction_mode: "parsed",
          extractor: "chat-parse@v1",
          title: match.metadata?.title || "",
          image_url: match.metadata?.thumbnailUrl || null,
        };
        title = match.metadata?.title || "";
        thumbnail_url = match.metadata?.thumbnailUrl || null;
        provider = match.metadata?.providerName || null;
        break;
      }
    }

    // Save-from-TasteReadCard passes skipWhyDraft: the taste read context is
    // not the curator's why. Let QCS open with a blank context field.
    const why = skipWhyDraft ? "" : draftWhyFromConversation(url);

    setSheetPrefillData({
      mode: "url",
      url: url,
      title: title,
      category: "",
      context: why,
      parsedPayload: parsedPayload || undefined,
      thumbnail_url: thumbnail_url,
      provider: provider,
      createdViaOverride: createdVia,
    });
    setSheetOpen(true);
  };

  // TODO: unify handleSaveFromChat + handleSaveImageFromChat into a single
  // saveCandidate abstraction if a third save-from-chat path is added.
  // Current parallel handlers are intentional — premature abstraction worse
  // than a third copy that reveals the real shared shape. (April 10, 2026)
  //
  // Feature B: handle the "Save as a Recommendation" action button tap for images.
  // Opens QuickCaptureSheet in upload mode prefilled with inferred metadata + signed URL.
  // Bug 3 fix: if signedUrl is missing (DB-reload path), regenerate via /api/recs/sign-artifact.
  const handleSaveImageFromChat = async (sha256) => {
    // Walk backwards through messages looking for image_rec_candidate matching this sha256.
    for (let i = messages.length - 1; i >= 0 && i >= messages.length - 10; i--) {
      const m = messages[i];
      if (!m.image_rec_candidate || m.image_rec_candidate.sha256 !== sha256) continue;
      const candidate = m.image_rec_candidate;

      let previewUrl = candidate.signedUrl || null;

      // DB-reload path: signedUrl was not persisted, regenerate on demand
      if (!previewUrl && candidate.artifactPath && profileId) {
        try {
          const res = await fetch("/api/recs/sign-artifact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profileId, artifactPath: candidate.artifactPath }),
          });
          if (res.ok) {
            const { signedUrl } = await res.json();
            previewUrl = signedUrl;
          } else {
            console.error(`[FEATURE_B] sign-artifact failed status=${res.status}`);
          }
        } catch (err) {
          console.error(`[FEATURE_B] sign-artifact error=${err.message}`);
        }
      }

      setSheetPrefillData({
        mode: "upload",
        artifactSha256: candidate.sha256,
        artifactRef: candidate.artifactRef,
        signedUrl: previewUrl,
        mimeType: candidate.mimeType,
        sizeBytes: candidate.sizeBytes,
        title: candidate.inferred.title,
        category: candidate.inferred.category,
        context: candidate.inferred.suggested_why,
        createdViaOverride: "chat_save_from_image",
      });
      setSheetOpen(true);
      return;
    }
    console.warn(`[FEATURE_B] imageRecCandidate not found for sha256=${sha256}`);
  };

  const handleInteraction = async (messageId, blockIndex, action) => {
    const interaction = { block_index: blockIndex, action, interacted_at: new Date().toISOString() };
    // Optimistic update — match by id if available, otherwise grey out the last AI message with blocks
    setMessages(prev => prev.map(msg => {
      if (messageId && msg.id === messageId) {
        return { ...msg, interactions: [...(msg.interactions || []), interaction] };
      }
      if (!messageId && msg.role === "ai" && msg.blocks && msg.blocks.length > 0 && !(msg.interactions || []).length) {
        return { ...msg, interactions: [interaction] };
      }
      return msg;
    }));
    // Resolve the DB id if we don't have one
    let dbId = messageId;
    if (!dbId && profileId) {
      try {
        const { data: recent } = await supabase
          .from('chat_messages')
          .select('id')
          .eq('profile_id', profileId)
          .eq('role', 'assistant')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        dbId = recent?.id;
      } catch (err) {
        console.error('Failed to resolve message id for interaction:', err);
      }
    }
    if (!dbId) return;
    // Persist via server API (bypasses RLS — no UPDATE policy on chat_messages)
    try {
      await fetch('/api/chat/interaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: dbId, interaction }),
      });
    } catch (err) {
      console.error('Failed to save interaction:', err);
    }
  };

  const handleSaveProfile = async (profileData, msgIndex) => {
    await saveProfileFromChat(profileData);
    setMessages(prev => [
      ...prev.map((m, idx) => idx === msgIndex ? { ...m, profileSaved: true } : m),
      { role: "ai", text: "\u2713 Profile saved. Looking good!" },
    ]);
    saveMsgToDb("ai", "\u2713 Profile saved. Looking good!");
  };

  const handleSaveCapture = async (capturedRec, msgIndex) => {
    if (!capturedRec?.title) return;
    const newItem = {
      id: Date.now(),
      slug: capturedRec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title: capturedRec.title,
      category: capturedRec.category || "other",
      context: capturedRec.context || '',
      tags: capturedRec.tags || [],
      date: new Date().toISOString().split("T")[0],
      visibility: "public",
      revision: 1,
      earnableMode: "none",
      links: (() => {
        // Priority: editing card links > inline link input > pending link > AI-parsed links
        // If editingCapture exists, always use its links (even if empty — user may have removed all)
        if (editingCapture) return editingCapture.links || [];
        const inlineLink = captureLinkInputs[msgIndex]?.trim();
        if (inlineLink && /^https?:\/\//.test(inlineLink)) {
          let label = 'Link';
          try { label = new URL(inlineLink).hostname.replace('www.', ''); } catch {}
          return [{ url: inlineLink, label, type: 'website' }];
        }
        if (pendingLink) return [{ type: pendingLink.source?.toLowerCase() || "website", url: pendingLink.url, label: pendingLink.title }];
        return capturedRec.links || [];
      })(),
      revisions: [{ rev: 1, date: new Date().toISOString().split("T")[0], change: "Created" }],
      createdVia: "chat_rec_block",
      silent: silentByMsgIndex[msgIndex] === true,
    };
    let savedFromAddRec;
    try {
      savedFromAddRec = await addRec(newItem);
    } catch (err) {
      console.error('In-chat capture save failed:', err);
      const errorText = `Couldn't save "${newItem.title}". Try again.`;
      setMessages(prev => [...prev, { role: "ai", text: errorText }]);
      saveMsgToDb("ai", errorText);
      return;
    }
    // Immediate toast
    setMessages(prev => [...prev.map((m, idx) => idx === msgIndex ? { ...m, saved: true, savedLinks: newItem.links } : m), { role: "ai", text: "\u2713 Saved." }]);
    saveMsgToDb("ai", "\u2713 Saved.");

    // Schedule post-save taste reflection after 3s (cancelled if curator starts typing)
    typedSinceSave.current = false;
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    const recCount = items.length + 1; // includes the one just saved
    const savedRec = { title: capturedRec.title, category: capturedRec.category || 'other', context: capturedRec.context || '' };
    // Use [savedFromAddRec, ...items] so the just-saved rec is in the payload the AI sees.
    const recsForPrompt = [savedFromAddRec, ...items].map(item => ({
      title: item.title,
      category: item.category,
      context: item.context,
      tags: item.tags,
      date: item.date,
      slug: item.slug,
    }));
    nudgeTimer.current = setTimeout(async () => {
      if (typedSinceSave.current) return;
      setTyping(true);
      try {
        const reflectionMsg = `[SYSTEM: A rec was just saved. Respond with a brief acknowledgment plus exactly one short follow-up question. Hard constraints:

- Max 2 sentences total.
- Exactly one question mark.
- No verdicts about the curator. Do not characterize what they like, hide, hoard, sit on, keep to themselves, gravitate toward, or are drawn to. Do not describe their taste in any form.
- No synthesis across multiple recs. Do not reference other things they have saved.
- No padding with examples that are not in the saved rec content.
- No em dashes.

Pick ONE of these four follow-up moves, and bias AWAY from move A (it tends to feel like drilling):

A. ADJACENT (same domain, different item): only if the curator has shown clear engagement in this exact lane in the last 2 turns. Example: they just saved a restaurant and have been actively talking about restaurants. "Anywhere else lately worth a save?"

B. CROSS-CONTEXT (different city, different category, different mood): preferred default. Move them out of the lane they just finished. If they saved a Chicago restaurant, ask about food in another city OR food of a different vibe OR something completely outside food. "What about other cities, anywhere you have eaten lately that stuck?" "Outside food, anything else been on your mind to save?"

C. SPECIFIC-CALLBACK to a detail in the curator's own why for THIS rec: only when their why contained a concrete hook you can point at without paraphrasing. Quote or near-quote their detail.

D. NETWORK SURFACE (offer to show recs from their subscriptions): only when the network context block contains at least one rec from a curator they subscribe to that is plausibly relevant to what they just saved or to their stated interests. Phrase as an offer, never as a verdict. "Want to see what [Curator Name] has been saving lately?" Use the actual curator name from the network context. If no relevant subscribed rec is in context, do not use this move.

BANNED phrasings (do not produce any sentence matching these patterns):
- "What other [X] have you been keeping to yourself"
- "What else are you sitting on"
- "What are you holding back"
- "What's hiding in your [X]"
- "What's the [X] you have not told anyone about"
- Any phrasing that implies the curator hoards, hides, gatekeeps, or has secrets.

If you cannot produce a clean 2-sentence response that satisfies all constraints, produce only a one-sentence acknowledgment with no question. Silence is better than a banned pattern.]`;
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: reflectionMsg,
            curatorName: profile.name,
            curatorHandle: profile.handle?.replace('@', ''),
            curatorBio: profile.bio || '',
            profileId,
            conversationId: activeLensConversationId,
            recommendations: recsForPrompt,
            linkMetadata: null,
            history: messages.filter(m => !m.type).slice(-10),
          }),
        });
        const data = await res.json();
        setTyping(false);
        if (typedSinceSave.current) return;
        let text = data.message || '';
        text = text.replace(/\[REC\][\s\S]*?\[\/REC\]/, '').trim();
        if (!text) text = ' ';
        setMessages(prev => [...prev, { role: "ai", text, blocks: data.blocks || null, interactions: [] }]);
        saveMsgToDb("ai", text, null, data.blocks, [], null, activeLensConversationId);
      } catch (err) {
        console.error('Taste reflection error:', err);
        setTyping(false);
      }
    }, 3000);

    // Regenerate taste profile on every rec save past threshold (fire and forget)
    if (recCount >= 3) {
      fetch('/api/generate-taste-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      }).catch(() => {});
    }

    setPendingLink(null);
    setEditingCapture(null);
    setCaptureLinkInputs(prev => { const next = { ...prev }; delete next[msgIndex]; return next; });
    setSilentByMsgIndex(prev => { const next = { ...prev }; delete next[msgIndex]; return next; });
  };

  const handleAddLink = async () => {
    const url = prompt("Paste a link:");
    if (!url) return;
    try {
      const meta = await fetchLinkMetadata(url, profileId);
      const type = meta?.type || "website";
      const label = meta?.title || url;
      setEditingCapture(p => ({ ...p, links: [...(p.links || []), { type, url, label }] }));
    } catch (e) {
      setEditingCapture(p => ({ ...p, links: [...(p.links || []), { type: "website", url, label: url }] }));
    }
  };

  const handleRemoveLink = (linkIndex) => {
    setEditingCapture(p => {
      const updated = (p.links || []).filter((_, idx) => idx !== linkIndex);
      return { ...p, links: updated };
    });
    setPendingLink(null);
  };

  const openLensConversation = async (conversationId) => {
    setHistoryOpen(false);
    setInput("");
    setPendingImage(null);
    await loadLensConversationMessages?.(conversationId);
  };

  const resetLensConversation = () => {
    setHistoryOpen(false);
    setInput("");
    setPendingImage(null);
    setPendingLink(null);
    setEditingCapture(null);
    startNewLensConversation?.();
  };

  const startRecommendationCoaching = () => {
    send({
      displayText: "Help me write a Recommendation",
      message: `Help me write a Recommendation. Take the lead like a concise editor. First ask me for the thing I want to recommend, what kind of thing it is, and why it stuck with me. If I already provide a title, link, photo, or rough thought, turn it into a short Recommendation draft with:

1. Title
2. Category
3. Why I recommend it
4. Optional tags

Keep it conversational. Ask one useful question at a time. Do not use em dashes.`,
    });
  };

  // ── CURATOR CHAT ──
  if (isCurator) {
    const newRequests = []; // placeholder for requests integration
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, width: "100%" }}>
        {/* Workspace header */}
        <div style={{ flexShrink: 0, borderBottom: `1px solid ${W.bdr}`, background: W.bg }}>
        <div style={{ padding: isDesktop ? "16px 20px" : "8px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 700, margin: "0 auto", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: isDesktop ? 10 : 8 }}>
            <div style={{ width: isDesktop ? 34 : 28, height: isDesktop ? 34 : 28, borderRadius: isDesktop ? 10 : 8, background: W.accentSoft, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${W.accent}30` }}>
              <span style={{ fontSize: isDesktop ? 13 : 11, fontWeight: 700, color: W.accent, fontFamily: F }}>C</span>
            </div>
            <div>
              <div style={{ fontFamily: F, fontSize: isDesktop ? 16 : 14, color: T.ink, fontWeight: 700, lineHeight: 1, letterSpacing: "-.02em" }}>Lens</div>
              <div style={{ fontSize: 10, color: T.ink3, fontFamily: MN, fontWeight: 400, marginTop: 2 }}>{n} recs {"\u00B7"} {cats.length} categories</div>
            </div>
          </div>
          {lensConversationsEnabled ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setHistoryOpen(v => !v)} style={{ border: `1px solid ${W.bdr}`, background: "transparent", color: T.ink2, borderRadius: 999, padding: "6px 10px", fontFamily: F, fontSize: 12, cursor: "pointer" }}>History</button>
              {messages.length > 0 && (
                <button onClick={resetLensConversation} style={{ border: `1px solid ${W.bdr}`, background: W.s, color: T.ink2, borderRadius: 999, padding: "6px 10px", fontFamily: F, fontSize: 12, cursor: "pointer" }}>New conversation</button>
              )}
            </div>
          ) : (
            isDesktop && <div style={{ fontSize: 10, color: T.ink3, fontFamily: MN }}>{n} recs</div>
          )}
        </div>
        </div>
        {historyOpen && lensConversationsEnabled && (
          <div style={{ flexShrink: 0, borderBottom: `1px solid ${W.bdr}`, background: W.s }}>
            <div style={{ maxWidth: 700, margin: "0 auto", padding: "10px 16px", display: "grid", gap: 6 }}>
              {(lensConversations || []).length === 0 ? (
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>No conversations yet.</div>
              ) : (lensConversations || []).map(c => (
                <button key={c.id} onClick={() => openLensConversation(c.id)} style={{ width: "100%", textAlign: "left", border: `1px solid ${W.bdr}`, background: c.id === activeLensConversationId ? W.s2 : "transparent", color: T.ink, borderRadius: 8, padding: "9px 10px", fontFamily: F, cursor: "pointer" }}>
                  <div style={{ fontSize: 13, fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "Lens conversation"}</div>
                  <div style={{ fontSize: 10, color: T.ink3, marginTop: 2 }}>{c.last_message_at ? new Date(c.last_message_at).toLocaleDateString() : ""}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, background: W.bg }}>
          <div ref={chatScrollRef} onScroll={() => { const el = chatScrollRef.current; if (el) setShowScrollBtn(el.scrollTop < el.scrollHeight - el.clientHeight - 100); }} style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", overscrollBehavior: "none", minHeight: 0, touchAction: "pan-y" }}>
            <div style={{ maxWidth: 700, margin: "0 auto", padding: "12px 16px" }}>
            <ErrorBoundary>
            {showLensCanvas && (
              <div style={{ minHeight: isDesktop ? "calc(100vh - 285px)" : "calc(100vh - 245px)", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: isDesktop ? "72px 0 18px" : "44px 0 14px" }}>
                <div style={{ display: "grid", gap: isDesktop ? 22 : 18, width: "100%", maxWidth: 430, paddingBottom: isDesktop ? 16 : 10 }}>
                  <button onClick={() => setSheetOpen(true)} style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", color: T.ink, padding: 0, fontFamily: F, fontSize: isDesktop ? 20 : 18, cursor: "pointer", display: "flex", alignItems: "center", gap: 18 }}>
                    <span style={{ width: 30, height: 30, color: T.acc, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                    </span>
                    <span>Recommendation</span>
                  </button>
                  <button onClick={startRecommendationCoaching} style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", color: T.ink, padding: 0, fontFamily: F, fontSize: isDesktop ? 20 : 18, cursor: "pointer", display: "flex", alignItems: "center", gap: 18 }}>
                    <span style={{ width: 30, height: 30, color: T.ink2, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </span>
                    <span>Help me write a Recommendation</span>
                  </button>
                  <button onClick={() => router.push('/me/taste')} style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", color: T.ink, padding: 0, fontFamily: F, fontSize: isDesktop ? 20 : 18, cursor: "pointer", display: "flex", alignItems: "center", gap: 18 }}>
                    <span style={{ width: 30, height: 30, color: T.ink2, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5Z" /><path d="M8 7h6" /><path d="M8 11h5" /></svg>
                    </span>
                    <span>Review my Record</span>
                  </button>
                  <button onClick={() => setFeedbackSheetOpen(true)} style={{ width: "100%", textAlign: "left", border: "none", background: "transparent", color: T.ink2, padding: 0, fontFamily: F, fontSize: isDesktop ? 18 : 16, cursor: "pointer", display: feedbackSheetOpen ? "none" : "flex", alignItems: "center", gap: 18 }}>
                    <span style={{ width: 30, height: 30, color: T.ink2, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
                    </span>
                    <span>Give feedback</span>
                  </button>
                </div>
              </div>
            )}
            {messages.map((msg, i) => {
              // Request alert card
              if (msg.type === "requestAlert") {
                return (
                  <div key={i} className="fu" style={{ marginBottom: 12, animationDelay: `${i * .03}s` }}>
                    <button onClick={() => router.push('/find/review')} style={{
                      width: "100%", padding: "16px", borderRadius: 16, border: `1px solid ${W.bdr}`,
                      background: W.s, cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 14,
                    }}>
                      <div style={{ width: 40, height: 40, borderRadius: 12, background: "#EF444418", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: 18 }}>{"\uD83D\uDCE9"}</span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontFamily: F, fontSize: 14, fontWeight: 700, color: T.ink }}>{msg.count} new request{msg.count !== 1 ? "s" : ""}</div>
                        <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>
                          {newRequests.slice(0, 2).map(r => r.from).join(", ")}{newRequests.length > 2 ? ` +${newRequests.length - 2} more` : ""} {"\u2014"} tap to review
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ minWidth: 22, height: 22, borderRadius: 11, background: "#EF4444", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>{msg.count}</span>
                        <span style={{ color: T.ink3, fontSize: 14 }}>{"\u203A"}</span>
                      </div>
                    </button>
                  </div>
                );
              }
              // Gratuity card
              if (msg.type === "gratuity") {
                const gc = CAT[msg.recCategory] || CAT.other;
                return (
                  <div key={i} className="fu" style={{ marginBottom: 12, animationDelay: `${i * .03}s` }}>
                    <div style={{
                      padding: "18px", borderRadius: 16,
                      background: `linear-gradient(135deg, #6BAA8E10, ${W.s})`,
                      border: `1px solid #6BAA8E30`,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#6BAA8E18", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <span style={{ fontSize: 16 }}>{"\u2615"}</span>
                          </div>
                          <div>
                            <div style={{ fontFamily: F, fontSize: 13, fontWeight: 700, color: T.ink }}>{msg.from}</div>
                            <div style={{ fontFamily: F, fontSize: 10, color: T.ink3, marginTop: 1 }}>{msg.time}</div>
                          </div>
                        </div>
                        <div style={{ padding: "6px 14px", borderRadius: 10, background: "#6BAA8E20", border: `1px solid #6BAA8E30` }}>
                          <span style={{ fontFamily: MN, fontSize: 16, fontWeight: 700, color: "#6BAA8E" }}>{"$"}{msg.amount}</span>
                        </div>
                      </div>
                      {msg.message && (
                        <div style={{ padding: "12px 16px", borderRadius: 12, background: W.s, border: `1px solid ${W.bdr}`, marginBottom: 10 }}>
                          <p style={{ fontFamily: F, fontSize: 13, color: T.ink, lineHeight: 1.55, fontStyle: "italic" }}>"{msg.message}"</p>
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 12 }}>{gc.emoji}</span>
                        <span style={{ fontFamily: F, fontSize: 11, color: T.ink3 }}>For <span style={{ fontWeight: 600, color: T.ink2 }}>{msg.recTitle}</span></span>
                      </div>
                    </div>
                  </div>
                );
              }
              // User message
              if (msg.role === "user") {
                return (
                  <div key={i} className="fu" style={{ animationDelay: `${i * .03}s` }}>
                    <FeedUserBubble text={msg.text} imagePreview={msg.imagePreview} />
                  </div>
                );
              }
              // AI message with blocks → full-width feed rendering
              if (msg.role === "ai" && msg.blocks && msg.blocks.length > 0) {
                return (
                  <div key={i} className="fu" style={{ animationDelay: `${i * .03}s` }}>
                    <FeedBlockGroup
                      blocks={msg.blocks}
                      interactions={msg.interactions || []}
                      messageId={msg.id}
                      tappedActions={msg.id ? Array.from(tappedActionsByMsgId.current.get(msg.id) || []) : []}
                      onSendMessage={(action) => {
                        // Deploy 2: discuss_link — silent meta-action. Must fire BEFORE
                        // any other branch so the action string can never leak to send().
                        if (typeof action === "string" && action.startsWith("discuss_link:")) {
                          const url = action.slice("discuss_link:".length);
                          fetch("/api/dropped-links/mark-action", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url, action: "discussed" }),
                          }).catch(() => {});
                          return;
                        }
                        // Deploy 2: taste_read — substitute a natural-language prompt for the raw action string
                        if (typeof action === "string" && action.startsWith("taste_read:")) {
                          const url = action.slice("taste_read:".length);
                          fetch("/api/dropped-links/mark-action", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url, action: "taste_read" }),
                          }).catch(() => {});
                          send(`Do a Read on ${url}`);
                          return;
                        }
                        // Feature B: intercept save-image-rec actions before they hit send()
                        if (typeof action === "string" && action.startsWith("save_image_rec:")) {
                          const sha = action.slice("save_image_rec:".length);
                          handleSaveImageFromChat(sha);
                          return;
                        }
                        // Feature C: intercept save-from-chat actions before they hit send()
                        if (typeof action === "string" && action.startsWith("save_rec_from_chat:")) {
                          const url = action.slice("save_rec_from_chat:".length);
                          handleSaveFromChat(url);
                          return;
                        }
                        // TasteReadCard footer: same save flow but skip the
                        // conversational why-draft (taste read text is not the why).
                        if (typeof action === "string" && action.startsWith("save_rec_from_taste_read:")) {
                          const url = action.slice("save_rec_from_taste_read:".length);
                          handleSaveFromChat(url, { skipWhyDraft: true, createdVia: "chat_save_from_taste_read" });
                          return;
                        }
                        if (action === "skip_save") {
                          // No-op — interaction tracking via onInteraction handles button state
                          return;
                        }
                        send(action);
                      }}
                      onInteraction={(msgId, blockIdx, act) => {
                        // Bug 3: track by DB message ID, not array index — indices shift when history loads.
                        // Per-action set so siblings stay live; only the tapped option disables.
                        if (msg.id) {
                          let set = tappedActionsByMsgId.current.get(msg.id);
                          if (!set) {
                            set = new Set();
                            tappedActionsByMsgId.current.set(msg.id, set);
                          }
                          set.add(act);
                        }
                        handleInteraction(msgId, blockIdx, act);
                      }}
                    />
                    {profile?.aiProfile === "staging" && msg.id && (
                      <AIResponseThumbs
                        messageId={msg.id}
                        initialRating={ratingsByMessageId[msg.id] || null}
                        onRatingChange={handleRatingChange}
                      />
                    )}
                    {msg.capturedRec && !msg.saved && !items.some(r => r.title?.toLowerCase() === msg.capturedRec.title?.toLowerCase()) && !editingCapture && (
                      <div style={{ marginTop: 8, padding: 12, borderRadius: 12, border: "1px solid " + T.bdr, background: T.s }}>
                        <div style={{ fontSize: 11, fontFamily: F, fontWeight: 600, color: CAT[msg.capturedRec.category]?.color || T.ink3, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                          {CAT[msg.capturedRec.category]?.emoji || "◆"} {msg.capturedRec.category}{msg.capturedRec.content_type ? ` · ${msg.capturedRec.content_type}` : ""}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, fontFamily: F, color: T.ink, marginBottom: 4 }}>{msg.capturedRec.title}</div>
                        {msg.capturedRec.context && (
                          <div style={{ fontSize: 13, fontFamily: F, color: T.ink2, fontStyle: "italic", marginBottom: 6 }}>"{msg.capturedRec.context}"</div>
                        )}
                        {msg.capturedRec.tags?.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                            {msg.capturedRec.tags.map((tag, t) => (
                              <span key={t} style={{ fontSize: 11, fontFamily: F, padding: "2px 8px", borderRadius: 10, background: "#1e1b18", color: T.ink3 }}>{tag}</span>
                            ))}
                          </div>
                        )}
                        {!hasValidLink(msg.capturedRec.links) && !(pendingLink && isSpecificLink(pendingLink.url)) && (
                          <input
                            value={captureLinkInputs[i] || ''}
                            onChange={e => setCaptureLinkInputs(prev => ({ ...prev, [i]: e.target.value }))}
                            placeholder="Add a link (optional)"
                            style={{
                              width: "100%", padding: "8px 12px", borderRadius: 8, marginBottom: 8,
                              border: "1px solid " + T.bdr, fontSize: 13, fontFamily: F,
                              background: W.aiBub, color: T.ink, outline: "none",
                            }}
                            onFocus={e => e.target.style.borderColor = W.accent}
                            onBlur={e => e.target.style.borderColor = W.bdr}
                          />
                        )}
                        {profile?.isTester === true && (
                          <div style={{ marginBottom: 10 }}>
                            <label style={{
                              display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
                            }}>
                              <input
                                type="checkbox"
                                checked={silentByMsgIndex[i] === true}
                                onChange={(e) => setSilentByMsgIndex(prev => ({ ...prev, [i]: e.target.checked }))}
                                style={{ marginTop: 2, accentColor: T.ink3, cursor: "pointer" }}
                              />
                              <span>
                                <span style={{ fontFamily: F, fontSize: 13, color: T.ink2 }}>Save silently (don't notify subscribers)</span>
                                <span style={{ display: "block", fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 2, lineHeight: 1.4 }}>
                                  Rec still saves and appears in subscriber feeds — only suppresses the email alert.
                                </span>
                              </span>
                            </label>
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => handleSaveCapture(msg.capturedRec, i)} style={{
                            padding: "8px 16px", borderRadius: 10, border: "none",
                            background: T.acc, color: "#fff", fontSize: 13, fontWeight: 600,
                            cursor: "pointer", fontFamily: F
                          }}>Save</button>
                          <button onClick={() => setEditingCapture({ ...msg.capturedRec, msgIndex: i })} style={{
                            padding: "8px 16px", borderRadius: 10, border: "1px solid " + T.bdr,
                            background: T.s, color: T.ink, fontSize: 13, fontWeight: 500,
                            cursor: "pointer", fontFamily: F
                          }}>Edit</button>
                        </div>
                      </div>
                    )}
                    {editingCapture && editingCapture.msgIndex === i && (
                      <CaptureCard
                        capture={editingCapture}
                        onUpdate={setEditingCapture}
                        onSave={() => handleSaveCapture(editingCapture, editingCapture.msgIndex)}
                        onCancel={() => setEditingCapture(null)}
                        pendingLink={pendingLink}
                        onRemoveLink={handleRemoveLink}
                        onAddLink={handleAddLink}
                      />
                    )}
                    {(() => {
                      const savedLinks = msg.savedLinks || (msg.capturedRec && items.find(r => r.title?.toLowerCase() === msg.capturedRec.title?.toLowerCase())?.links);
                      const isSaved = msg.saved || (msg.capturedRec && items.some(r => r.title?.toLowerCase() === msg.capturedRec.title?.toLowerCase()));
                      return isSaved && savedLinks?.length > 0 ? (
                        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, color: T.ink3 }}>{"\uD83D\uDD17"}</span>
                          <a href={savedLinks[0].url} target="_blank" rel="noopener noreferrer" style={{
                            fontSize: 12, color: T.ink3, fontFamily: F, textDecoration: "underline",
                            textUnderlineOffset: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200,
                          }}>{savedLinks[0].label || savedLinks[0].url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}</a>
                        </div>
                      ) : null;
                    })()}
                    {msg.capturedProfile && !msg.profileSaved && (
                      <ProfileCaptureCard
                        profile={msg.capturedProfile}
                        onSave={(data) => handleSaveProfile(data, i)}
                        onDismiss={() => setMessages(prev => prev.map((m, idx) => idx === i ? { ...m, profileSaved: true } : m))}
                      />
                    )}
                    {msg.profileSaved && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#6BAA8E", fontFamily: F, fontWeight: 600 }}>{"\u2713"} Profile saved</div>
                    )}
                  </div>
                );
              }
              // AI message without blocks → legacy bubble
              if (msg.role === "ai") {
                return (
                  <div key={i} className="fu" style={{ animationDelay: `${i * .03}s` }}>
                    <FeedLegacyBubble text={msg.text} imagePreview={msg.imagePreview} />
                    {profile?.aiProfile === "staging" && msg.id && (
                      <AIResponseThumbs
                        messageId={msg.id}
                        initialRating={ratingsByMessageId[msg.id] || null}
                        onRatingChange={handleRatingChange}
                      />
                    )}
                    {msg.capturedRec && !msg.saved && !items.some(r => r.title?.toLowerCase() === msg.capturedRec.title?.toLowerCase()) && !editingCapture && (
                      <div style={{ marginTop: 8, padding: 12, borderRadius: 12, border: "1px solid " + T.bdr, background: T.s }}>
                        <div style={{ fontSize: 11, fontFamily: F, fontWeight: 600, color: CAT[msg.capturedRec.category]?.color || T.ink3, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
                          {CAT[msg.capturedRec.category]?.emoji || "◆"} {msg.capturedRec.category}{msg.capturedRec.content_type ? ` · ${msg.capturedRec.content_type}` : ""}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 600, fontFamily: F, color: T.ink, marginBottom: 4 }}>{msg.capturedRec.title}</div>
                        {msg.capturedRec.context && (
                          <div style={{ fontSize: 13, fontFamily: F, color: T.ink2, fontStyle: "italic", marginBottom: 6 }}>"{msg.capturedRec.context}"</div>
                        )}
                        {msg.capturedRec.tags?.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
                            {msg.capturedRec.tags.map((tag, t) => (
                              <span key={t} style={{ fontSize: 11, fontFamily: F, padding: "2px 8px", borderRadius: 10, background: "#1e1b18", color: T.ink3 }}>{tag}</span>
                            ))}
                          </div>
                        )}
                        {!hasValidLink(msg.capturedRec.links) && !(pendingLink && isSpecificLink(pendingLink.url)) && (
                          <input
                            value={captureLinkInputs[i] || ''}
                            onChange={e => setCaptureLinkInputs(prev => ({ ...prev, [i]: e.target.value }))}
                            placeholder="Add a link (optional)"
                            style={{
                              width: "100%", padding: "8px 12px", borderRadius: 8, marginBottom: 8,
                              border: "1px solid " + T.bdr, fontSize: 13, fontFamily: F,
                              background: W.aiBub, color: T.ink, outline: "none",
                            }}
                            onFocus={e => e.target.style.borderColor = W.accent}
                            onBlur={e => e.target.style.borderColor = W.bdr}
                          />
                        )}
                        {profile?.isTester === true && (
                          <div style={{ marginBottom: 10 }}>
                            <label style={{
                              display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer",
                            }}>
                              <input
                                type="checkbox"
                                checked={silentByMsgIndex[i] === true}
                                onChange={(e) => setSilentByMsgIndex(prev => ({ ...prev, [i]: e.target.checked }))}
                                style={{ marginTop: 2, accentColor: T.ink3, cursor: "pointer" }}
                              />
                              <span>
                                <span style={{ fontFamily: F, fontSize: 13, color: T.ink2 }}>Save silently (don't notify subscribers)</span>
                                <span style={{ display: "block", fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 2, lineHeight: 1.4 }}>
                                  Rec still saves and appears in subscriber feeds — only suppresses the email alert.
                                </span>
                              </span>
                            </label>
                          </div>
                        )}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={() => handleSaveCapture(msg.capturedRec, i)} style={{
                            padding: "8px 16px", borderRadius: 10, border: "none",
                            background: T.acc, color: "#fff", fontSize: 13, fontWeight: 600,
                            cursor: "pointer", fontFamily: F
                          }}>Save</button>
                          <button onClick={() => setEditingCapture({ ...msg.capturedRec, msgIndex: i })} style={{
                            padding: "8px 16px", borderRadius: 10, border: "1px solid " + T.bdr,
                            background: T.s, color: T.ink, fontSize: 13, fontWeight: 500,
                            cursor: "pointer", fontFamily: F
                          }}>Edit</button>
                        </div>
                      </div>
                    )}
                    {editingCapture && editingCapture.msgIndex === i && (
                      <CaptureCard
                        capture={editingCapture}
                        onUpdate={setEditingCapture}
                        onSave={() => handleSaveCapture(editingCapture, editingCapture.msgIndex)}
                        onCancel={() => setEditingCapture(null)}
                        pendingLink={pendingLink}
                        onRemoveLink={handleRemoveLink}
                        onAddLink={handleAddLink}
                      />
                    )}
                    {(() => {
                      const savedLinks = msg.savedLinks || (msg.capturedRec && items.find(r => r.title?.toLowerCase() === msg.capturedRec.title?.toLowerCase())?.links);
                      const isSaved = msg.saved || (msg.capturedRec && items.some(r => r.title?.toLowerCase() === msg.capturedRec.title?.toLowerCase()));
                      return isSaved && savedLinks?.length > 0 ? (
                        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 12, color: T.ink3 }}>{"\uD83D\uDD17"}</span>
                          <a href={savedLinks[0].url} target="_blank" rel="noopener noreferrer" style={{
                            fontSize: 12, color: T.ink3, fontFamily: F, textDecoration: "underline",
                            textUnderlineOffset: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200,
                          }}>{savedLinks[0].label || savedLinks[0].url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 30)}</a>
                        </div>
                      ) : null;
                    })()}
                    {msg.capturedProfile && !msg.profileSaved && (
                      <ProfileCaptureCard
                        profile={msg.capturedProfile}
                        onSave={(data) => handleSaveProfile(data, i)}
                        onDismiss={() => setMessages(prev => prev.map((m, idx) => idx === i ? { ...m, profileSaved: true } : m))}
                      />
                    )}
                    {msg.profileSaved && (
                      <div style={{ marginTop: 8, fontSize: 12, color: "#6BAA8E", fontFamily: F, fontWeight: 600 }}>{"\u2713"} Profile saved</div>
                    )}
                  </div>
                );
              }
              return null;
            })}
            </ErrorBoundary>
            {typing && <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 12 }}>
              <div style={{ padding: "14px 18px", background: W.aiBub, borderRadius: "20px 20px 20px 6px", border: `1px solid ${W.bdr}` }}><span className="dt" /><span className="dt" style={{ animationDelay: ".2s" }} /><span className="dt" style={{ animationDelay: ".4s" }} /></div>
            </div>}
            <div ref={chatEnd} />
            {showScrollBtn && <button onClick={() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); setShowScrollBtn(false); }} style={{ position: "sticky", bottom: 8, left: "50%", transform: "translateX(-50%)", width: 36, height: 36, borderRadius: 18, background: W.s2, border: "1px solid " + W.bdr, color: T.ink2, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.3)", zIndex: 10 }}>{"\u2193"}</button>}
            </div>
          </div>
          <div style={{ padding: "10px 16px 12px", flexShrink: 0, minWidth: 0, maxWidth: 700, margin: "0 auto", width: "100%", boxSizing: "border-box", overflow: "hidden" }}>
            <div style={{ display: "flex", flexDirection: "row", gap: 8, marginBottom: 8, minWidth: 0, flexWrap: "nowrap" }}>
              <QuickCaptureChip
                visible={!showLensCanvas && input.length === 0 && !sheetOpen && !feedbackSheetOpen && !pendingImage}
                onTap={() => setSheetOpen(true)}
              />
              <FeedbackChip
                visible={!showLensCanvas && input.length === 0 && !sheetOpen && !feedbackSheetOpen && !pendingImage}
                onTap={() => setFeedbackSheetOpen(true)}
              />
            </div>
            {pendingImage && (
              <div style={{ marginBottom: 8, display: "inline-flex", position: "relative" }}>
                <img src={pendingImage.previewUrl} alt="" style={{ height: 60, borderRadius: 10, border: `1px solid ${T.bdr}`, display: "block" }} />
                <button onClick={() => setPendingImage(null)} style={{
                  position: "absolute", top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
                  background: T.ink3, color: T.bg, border: "none", fontSize: 12, fontWeight: 700,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>&times;</button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
              <textarea value={input} onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; if (e.target.value) { typedSinceSave.current = true; if (nudgeTimer.current) { clearTimeout(nudgeTimer.current); nudgeTimer.current = null; } } }} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); e.target.style.height = 'auto'; } }}
                onPaste={e => { const file = e.clipboardData?.files?.[0]; if (file && file.type.startsWith('image/')) { e.preventDefault(); handleImageFile(file); } }}
                placeholder="Drop a rec or ask anything..."
                rows={1}
                style={{ flex: 1, minWidth: 0, padding: "14px 18px", borderRadius: 24, border: `1.5px solid ${W.inputBdr}`, fontSize: 15, fontFamily: F, outline: "none", background: W.inputBg, color: T.ink, resize: "none", lineHeight: "1.4", boxSizing: "border-box" }}
                onFocus={e => e.target.style.borderColor = W.accent} onBlur={e => e.target.style.borderColor = W.inputBdr}
              />
              <input ref={imageInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { handleImageFile(e.target.files?.[0]); e.target.value = ''; }} />
              <button onClick={() => imageInputRef.current?.click()} style={{ width: 46, height: 46, borderRadius: 23, border: "none", background: "transparent", color: T.ink3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="14" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/></svg>
              </button>
              <button onClick={() => send()} style={{ width: 46, height: 46, borderRadius: 23, border: "none", background: (input.trim() || pendingImage) ? T.acc : W.bdr, color: (input.trim() || pendingImage) ? T.accText : T.ink3, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .2s", flexShrink: 0, fontWeight: 600 }}>{"\u2191"}</button>
            </div>
          </div>
        </div>
        <QuickCaptureSheet
          isOpen={sheetOpen}
          onClose={() => {
            setSheetOpen(false);
            setSheetPrefillData(null);
          }}
          onSaved={handleQuickCaptureSaved}
          defaultVisibility={lastRecVisibility}
          isDesktop={isDesktop}
          profileId={profileId}
          initialData={sheetPrefillData}
        />
        <FeedbackSheet
          isOpen={feedbackSheetOpen}
          onClose={() => setFeedbackSheetOpen(false)}
          profileId={profileId}
          handle={profile?.handle?.replace('@', '')}
          isDesktop={isDesktop}
        />
      </div>
    );
  }

  // ── VISITOR CHAT ──
  if (!profile) return null;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, background: V.bg }}>
      {/* Branded header with curator identity */}
      <div style={{ padding: isOwner ? "12px 20px 12px" : "48px 20px 12px", background: V.bg, flexShrink: 0, borderBottom: `1px solid ${V.bdr}` }}>
        {!isOwner && (
          <div style={{ marginBottom: 14 }}>
            <button onClick={() => router.back()} style={{
              background: "none", border: "none", cursor: "pointer", padding: 0,
              display: "flex", alignItems: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 14, background: `linear-gradient(145deg, ${T.s2}, ${T.s})`, border: `1.5px solid ${V.bdr}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: S, fontSize: 20, color: T.acc, fontWeight: 400 }}>{profile.name[0]}</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: S, fontSize: 17, color: T.ink, fontWeight: 400, lineHeight: 1 }}>{profile.name}'s AI</div>
            <div style={{ fontSize: 11, color: T.ink3, fontFamily: F, marginTop: 3, display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 5, height: 5, borderRadius: 3, background: T.acc, animation: "breathe 3s ease-in-out infinite" }} />
              Trained on {n} personal recommendations{signalCount > 0 ? ` and ${signalCount} signals` : ""}
            </div>
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", minHeight: 0 }}>
        {messages.map((msg, i) => (
          <div key={i} className="fu" style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", marginBottom: 14, animationDelay: `${i * .03}s` }}>
            {msg.role === "ai" && (
              <div style={{ width: 26, height: 26, borderRadius: 9, background: `linear-gradient(145deg, ${T.s2}, ${T.s})`, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 8, marginTop: 2, flexShrink: 0 }}>
                <span style={{ fontFamily: S, fontSize: 13, color: T.acc, fontWeight: 400 }}>{profile.name[0]}</span>
              </div>
            )}
            <div style={{
              maxWidth: "82%", padding: msg.role === "user" ? "12px 16px" : "14px 18px",
              borderRadius: msg.role === "user" ? "20px 20px 6px 20px" : "20px 20px 20px 6px",
              background: msg.role === "user" ? V.userBub : V.aiBub,
              color: msg.role === "user" ? V.userTxt : T.ink,
              fontSize: 14, lineHeight: 1.55, fontFamily: F,
              fontWeight: msg.role === "user" ? 500 : 400,
              border: "none",
              boxShadow: msg.role === "user" ? "none" : `inset 0 0 0 1px ${V.bdr}`,
              overflowWrap: "break-word", wordBreak: "break-word",
            }}>{msg.role === "ai" ? renderMd(msg.text) : msg.text}</div>
          </div>
        ))}
        {typing && <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 14 }}>
          <div style={{ width: 26, height: 26, borderRadius: 9, background: `linear-gradient(145deg, ${T.s2}, ${T.s})`, display: "flex", alignItems: "center", justifyContent: "center", marginRight: 8, marginTop: 2, flexShrink: 0 }}>
            <span style={{ fontFamily: S, fontSize: 13, color: T.acc, fontWeight: 400 }}>{profile.name[0]}</span>
          </div>
          <div style={{ padding: "14px 18px", background: V.aiBub, borderRadius: "20px 20px 20px 6px", boxShadow: `inset 0 0 0 1px ${V.bdr}` }}><span className="dt" /><span className="dt" style={{ animationDelay: ".2s" }} /><span className="dt" style={{ animationDelay: ".4s" }} /></div>
        </div>}
        <div ref={chatEnd} />
      </div>
      <div style={{ padding: "4px 16px 6px", display: "flex", gap: 6, overflowX: "auto", flexShrink: 0, maxWidth: "100%" }}>
        {[
          { label: "\uD83D\uDCFA Watch", prompt: "What do they recommend I watch?" },
          { label: "\uD83C\uDFA7 Listen", prompt: "What do they recommend I listen to?" },
          { label: "\uD83D\uDCC4 Read", prompt: "What do they recommend I read?" },
          { label: "\uD83D\uDCCD Visit", prompt: "Where do they recommend I visit?" },
        ].map(chip => (
          <button key={chip.label} onClick={() => setInput(chip.prompt)} style={{
            padding: "8px 14px", borderRadius: 20, border: `1px solid ${V.chipBdr}`, background: V.chip,
            fontSize: 12, color: T.ink2, cursor: "pointer", fontFamily: F, whiteSpace: "nowrap", flexShrink: 0, fontWeight: 500,
          }}>{chip.label}</button>
        ))}
      </div>
      <div style={{ padding: "10px 16px", paddingBottom: "max(12px, env(safe-area-inset-bottom, 12px))", flexShrink: 0, background: V.bg }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <textarea value={input} onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); e.target.style.height = 'auto'; } }}
            placeholder={`Ask ${profile.name} anything...`}
            rows={1}
            style={{ flex: 1, padding: "14px 18px", borderRadius: 24, border: `1.5px solid ${V.inputBdr}`, fontSize: 15, fontFamily: F, outline: "none", background: V.inputBg, color: T.ink, resize: "none", lineHeight: "1.4" }}
            onFocus={e => e.target.style.borderColor = T.acc} onBlur={e => e.target.style.borderColor = V.inputBdr}
          />
          <button onClick={() => send()} style={{ width: 46, height: 46, borderRadius: 23, border: "none", background: input.trim() ? T.acc : V.bdr, color: input.trim() ? T.accText : T.ink3, fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .2s", flexShrink: 0, fontWeight: 600 }}>{"\u2191"}</button>
        </div>
      </div>
    </div>
  );
}
