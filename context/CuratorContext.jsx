'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { VisitorContext } from "./VisitorContext";
import { ingestUrlCapture } from "../lib/rec-files/ingest.js";
import { extractImageUrl } from "../lib/agent/parsers/extract-image.js";

export const CuratorContext = createContext(null);

export function CuratorProvider({ children }) {
  const [profile, setProfile] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [tasteItems, setTasteItems] = useState([]);
  const [messages, setMessages] = useState([]);
  const [dbLoaded, setDbLoaded] = useState(false);
  const prevMsgCount = useRef(0);

  // Archive/remove state (moved from CuratorsApp)
  const [archived, setArchived] = useState({});
  const [removing, setRemoving] = useState(null);
  const [filterCat, setFilterCat] = useState(null);
  const [undoItem, setUndoItem] = useState(null);
  const undoTimer = useRef(null);

  // Subscription state
  const [mySubscriptions, setMySubscriptions] = useState([]);
  const [mySubscribers, setMySubscribers] = useState([]);
  const [mySubscriptionIds, setMySubscriptionIds] = useState(new Set());

  // Saved recs state
  const [savedRecIds, setSavedRecIds] = useState(new Set());

  // Load profile + recs + messages from Supabase
  const loadData = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setDbLoaded(true); return; }

      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("auth_user_id", user.id)
        .single();
      if (!prof) { setDbLoaded(true); return; }

      setProfileId(prof.id);
      console.log('TRACKING: app opened, profileId:', prof.id);
      const { error: trackingError } = await supabase.from('profiles').update({
        last_seen_at: new Date().toISOString()
      }).eq('id', prof.id);
      if (trackingError) console.error('TRACKING ERROR:', trackingError);
      setProfile({
        name: prof.name, handle: "@" + prof.handle,
        bio: prof.bio, location: prof.location || "",
        invitedBy: prof.invited_by || null,
        aiEnabled: prof.ai_enabled,
        aiProfile: prof.ai_profile || 'stable',
        isTester: prof.is_tester || false,
        acceptRequests: prof.accept_requests, showRecs: prof.show_recs,
        showSubscriptions: prof.show_subscriptions || false,
        showSubscribers: prof.show_subscribers || false,
        cryptoEnabled: prof.crypto_enabled, wallet: prof.wallet || "",
        walletFull: "",
        socialLinks: prof.social_links || {},
        subscribers: 0, subsEnabled: true,
        subsText: "Curated recs straight to your inbox. Only things worth your time.",
      });
      const { data: recs } = await supabase
        .from("recommendations")
        .select("*")
        .eq("profile_id", prof.id)
        .order("created_at", { ascending: false });

      // Deploy 3.2: secondary load from rec_files to get body_md and extraction
      // for paste/upload/URL recs. The rec_file_id on each recommendations row
      // links to the canonical rec_files row. If this secondary load fails or
      // returns nothing, items still render fine without body — this is additive.
      const recFileIds = (recs || [])
        .map(r => r.rec_file_id)
        .filter(Boolean);

      // Fire rec_files + chat_messages in parallel
      const [recFilesResult, msgsResult] = await Promise.all([
        recFileIds.length > 0
          ? supabase.from('rec_files').select('id, body_md, extraction, work, curation, curator_is_author, source').in('id', recFileIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.from('chat_messages').select('*').eq('profile_id', prof.id).order('created_at', { ascending: false }).limit(50)
      ]);

      if (recs && recs.length > 0) {
        let recFilesById = {};
        if (recFilesResult.error) {
          console.warn("[CONTEXT_LOAD] rec_files secondary load failed:", recFilesResult.error.message);
        } else if (recFilesResult.data) {
          recFilesById = Object.fromEntries(recFilesResult.data.map(rf => [rf.id, rf]));
        }

        setTasteItems(recs.map(r => {
          const recFile = r.rec_file_id ? recFilesById[r.rec_file_id] : null;
          return {
            id: r.id, profile_id: r.profile_id, slug: r.slug || r.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            title: r.title, category: r.category, context: r.context,
            tags: (r.tags && r.tags.length > 0) ? r.tags : (recFile?.curation?.tags || []),
            links: r.links || [], date: r.created_at?.split("T")[0],
            visibility: r.visibility || "public", revision: r.revision || 1,
            earnableMode: r.earnable_mode || "none",
            revisions: [{ rev: r.revision || 1, date: r.created_at?.split("T")[0], change: "Created" }],
            // body_md / extraction / work / curation from rec_files secondary load.
            // Null-safe — items without a rec_file_id or failed load render fine
            // without these fields; the UI just doesn't show the body section.
            body_md: recFile?.body_md || null,
            extraction: recFile?.extraction || null,
            work: recFile?.work || null,
            curation_block: recFile?.curation || null,
            curator_is_author: recFile?.curator_is_author || false,
            source_block: recFile?.source || null,
          };
        }));
      }

      const msgs = msgsResult.data;
      if (msgs && msgs.length > 0) {
        setMessages(msgs.reverse().map(m => ({ id: m.id, role: m.role === "assistant" ? "ai" : m.role, text: m.text, capturedRec: m.captured_rec, blocks: m.blocks || null, interactions: m.interactions || [], image_rec_candidate: m.meta?.imageRecCandidate || null })));
        prevMsgCount.current = msgs.length;
      }

      setDbLoaded(true);

      // Load subscriptions separately — non-blocking so core data loads even if table doesn't exist
      try {
        // My subscriptions (curators I follow)
        const { data: subRows } = await supabase
          .from("subscriptions").select("*")
          .eq("subscriber_id", prof.id).is("unsubscribed_at", null);
        if (subRows && subRows.length > 0) {
          const curatorIds = subRows.map(s => s.curator_id);
          const { data: curatorProfiles } = await supabase
            .from("profiles").select("id, name, handle, bio").in("id", curatorIds);
          const profileMap = {};
          (curatorProfiles || []).forEach(p => { profileMap[p.id] = p; });
          const merged = subRows.map(s => ({ ...s, curator: profileMap[s.curator_id] || null }));
          setMySubscriptions(merged);
          setMySubscriptionIds(new Set(curatorIds));
        } else {
          setMySubscriptions(subRows || []);
          setMySubscriptionIds(new Set());
        }

        // My subscribers (people following me)
        const { data: fanRows } = await supabase
          .from("subscriptions").select("*")
          .eq("curator_id", prof.id).is("unsubscribed_at", null);
        if (fanRows && fanRows.length > 0) {
          const subscriberIds = fanRows.map(s => s.subscriber_id);
          const { data: subProfiles } = await supabase
            .from("profiles").select("id, name, handle, bio").in("id", subscriberIds);
          const profileMap = {};
          (subProfiles || []).forEach(p => { profileMap[p.id] = p; });
          setMySubscribers(fanRows.map(s => ({ ...s, subscriber: profileMap[s.subscriber_id] || null })));
        } else {
          setMySubscribers(fanRows || []);
        }
      } catch (subErr) {
        console.warn("Failed to load subscriptions (table may not exist yet):", subErr);
      }

      // Load saved recs — non-blocking
      try {
        const { data: savedRows } = await supabase
          .from("saved_recs").select("recommendation_id").eq("user_id", prof.id);
        if (savedRows && savedRows.length > 0) {
          setSavedRecIds(new Set(savedRows.map(r => r.recommendation_id)));
        }
      } catch (e) { console.warn("Failed to load saved recs:", e); }
    } catch (err) {
      console.error("Failed to load from Supabase:", err);
      setDbLoaded(true);
    }
  }, []);

  // Load on mount
  useEffect(() => { loadData(); }, [loadData]);

  // Listen for auth state changes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') loadData();
      if (event === 'SIGNED_OUT') {
        setProfile(null);
        setProfileId(null);
        setTasteItems([]);
        setMessages([]);
        setMySubscriptions([]);
        setMySubscribers([]);
        setMySubscriptionIds(new Set());
        setSavedRecIds(new Set());
      }
    });
    return () => subscription.unsubscribe();
  }, [loadData]);

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/login';
  };

  const saveProfile = async () => {
    if (!profileId || !profile) return;
    try {
      const { error } = await supabase.from("profiles").update({
        name: profile.name,
        handle: profile.handle.replace("@", ""),
        bio: profile.bio,
        location: profile.location || "",
        ai_enabled: profile.aiEnabled,
        accept_requests: profile.acceptRequests,
        show_recs: profile.showRecs,
        show_subscriptions: profile.showSubscriptions || false,
        show_subscribers: profile.showSubscribers || false,
        crypto_enabled: profile.cryptoEnabled,
        wallet: profile.wallet || "",
        social_links: profile.socialLinks || {},
      }).eq("id", profileId);
      if (error) throw error;
      // Re-fetch profile from DB to ensure context is fully in sync
      const { data: prof } = await supabase
        .from("profiles").select("*").eq("id", profileId).single();
      if (prof) {
        setProfile({
          name: prof.name, handle: "@" + prof.handle,
          bio: prof.bio, location: prof.location || "",
            invitedBy: prof.invited_by || null,
          aiEnabled: prof.ai_enabled,
          aiProfile: prof.ai_profile || 'stable',
          isTester: prof.is_tester || false,
          acceptRequests: prof.accept_requests, showRecs: prof.show_recs,
          showSubscriptions: prof.show_subscriptions || false,
          showSubscribers: prof.show_subscribers || false,
          cryptoEnabled: prof.crypto_enabled, wallet: prof.wallet || "",
          walletFull: "",
          socialLinks: prof.social_links || {},
          subscribers: 0, subsEnabled: true,
          subsText: "Curated recs straight to your inbox. Only things worth your time.",
        });
      }
    } catch (err) { console.error("Failed to save profile:", err); }
  };

  const saveProfileFromChat = async ({ name, location, bio }) => {
    if (!profileId) return;
    try {
      const { error } = await supabase.from("profiles").update({
        name, location, bio,
      }).eq("id", profileId);
      if (error) throw error;
      // Re-fetch to sync all fields
      const { data: prof } = await supabase
        .from("profiles").select("*").eq("id", profileId).single();
      if (prof) {
        setProfile({
          name: prof.name, handle: "@" + prof.handle,
          bio: prof.bio, location: prof.location || "",
            invitedBy: prof.invited_by || null,
          aiEnabled: prof.ai_enabled,
          aiProfile: prof.ai_profile || 'stable',
          isTester: prof.is_tester || false,
          acceptRequests: prof.accept_requests, showRecs: prof.show_recs,
          showSubscriptions: prof.show_subscriptions || false,
          showSubscribers: prof.show_subscribers || false,
          cryptoEnabled: prof.crypto_enabled, wallet: prof.wallet || "",
          walletFull: "",
          socialLinks: prof.social_links || {},
          subscribers: 0, subsEnabled: true,
          subsText: "Curated recs straight to your inbox. Only things worth your time.",
        });
      }
    } catch (err) { console.error("Failed to save profile from chat:", err); }
  };

  const addRec = async (item) => {
    if (!item.slug) {
      item = { ...item, slug: item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') };
    }
    if (!profileId) {
      setTasteItems(prev => [item, ...prev]);
      return item;
    }
    const slug = item.slug || item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    item = { ...item };
    const { data, error } = await supabase.from("recommendations").insert({
      profile_id: profileId,
      title: item.title,
      category: item.category,
      context: item.context,
      tags: item.tags || [],
      links: item.links || [],
      slug,
      visibility: item.visibility || "public",
      status: "approved",
      revision: 1,
      earnable_mode: "none",
      created_via: item.createdVia || "unknown",
      image_url: extractImageUrl(item.parsedPayload),
    }).select().single();
    if (error) {
      console.error("Failed to save rec:", error);
      throw new Error(error.message || "Failed to save recommendation");
    }
    console.log('TRACKING: saved a rec, profileId:', profileId);
    const { error: trackingError } = await supabase.from('profiles').update({
      last_seen_at: new Date().toISOString(),
      last_action: 'saved a rec',
      last_action_at: new Date().toISOString()
    }).eq('id', profileId);
    if (trackingError) console.error('TRACKING ERROR:', trackingError);

    // Capture original chat-parse URL before re-parse may replace the payload
    const chatParseUrl = item.parsedPayload?.extractor === 'chat-parse@v1'
      ? item.parsedPayload.canonical_url
      : null;

    // If payload came from chat-parse, re-fetch the full article
    // before writing to rec_files. This ensures body_md is always
    // complete regardless of which UI surface triggered the save.
    if (item.parsedPayload?.extractor === 'chat-parse@v1') {
      try {
        const reParseRes = await fetch('/api/recs/parse-link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: item.parsedPayload.canonical_url }),
        });
        if (reParseRes.ok) {
          const reParseData = await reParseRes.json();
          if (reParseData.body_md) {
            item = {
              ...item,
              parsedPayload: {
                body_md: reParseData.body_md || "",
                body_truncated: reParseData.body_truncated || false,
                body_original_length: reParseData.body_original_length || 0,
                canonical_url: reParseData.canonical_url || item.parsedPayload.canonical_url,
                site_name: reParseData.site_name || null,
                author: reParseData.author || null,
                authors: reParseData.authors || [],
                published_at: reParseData.published_at || null,
                lang: reParseData.lang || null,
                word_count: reParseData.word_count || 0,
                media_type: reParseData.media_type || null,
                artifact_sha256: reParseData.artifact_sha256 || null,
                artifact_ref: reParseData.artifact_ref || null,
                extraction_mode: reParseData.extraction_mode || "parsed",
                extractor: reParseData.extractor || null,
                image_url: reParseData.image_url || reParseData.thumbnail_url || null,
              },
            };
          }
        }
      } catch (e) {
        console.warn('[rec-files] Re-parse failed, using chat-parse payload:', e.message);
      }
    }

    // Dual-write to rec_files. Runs AFTER the main insert. Failures are
    // logged, never thrown — the main save path must succeed regardless.
    let recFileId = null;
    try {
      if (item.parsedPayload) {
        // Promote path: if this came from a chat-parsed URL, promote the
        // existing rec_files row instead of creating a duplicate.
        if (chatParseUrl) {
          try {
            const promoteRes = await fetch('/api/recs/promote-chat-parse', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: chatParseUrl,
                curatorId: profileId,
                why: item.context,
                visibility: item.visibility || 'public',
                title: item.title,
                category: item.category,
                tags: item.tags || [],
              }),
            });
            const promoteData = await promoteRes.json();
            if (promoteData.promoted && promoteData.recFileId) {
              recFileId = promoteData.recFileId;
              const { error: linkError } = await supabase
                .from('recommendations')
                .update({ rec_file_id: recFileId })
                .eq('id', data.id);
              if (linkError) {
                console.warn('[rec-files] Failed to link recommendations.rec_file_id:', linkError.message);
              }
            }
          } catch (promoteErr) {
            console.warn('[rec-files] Promote fetch failed, falling through to ingest:', promoteErr.message);
          }
        }

        // Always create the canonical rec_files row via ingestUrlCapture.
        // If promote succeeded above, this overwrites recFileId with the
        // webpage@registry row, which is the canonical saved rec.
        const handleClean = (profile?.handle || '').replace(/^@/, '');
        const result = await ingestUrlCapture(supabase, {
          curatorId: profileId,
          curatorHandle: handleClean || null,
          parsedPayload: item.parsedPayload,
          curation: {
            title: item.title,
            category: item.category,
            context: item.context,
            tags: item.tags || [],
            visibility: item.visibility || 'public',
          },
        });
        if (result.success) {
          recFileId = result.recFileId;
          // Link the legacy recommendations row to the new rec_files row
          const { error: linkError } = await supabase
            .from('recommendations')
            .update({ rec_file_id: recFileId })
            .eq('id', data.id);
          if (linkError) {
            console.warn('[rec-files] Failed to link recommendations.rec_file_id:', linkError.message);
          }
        }
      }
    } catch (e) {
      console.error('[rec-files] Unexpected dual-write error:', e.message || e);
    }

    const saved = { ...item, id: data.id, rec_file_id: recFileId };

    // Fire-and-forget: notify subscribers
    if (data?.visibility === 'public' && data?.status === 'approved') {
      fetch('/api/notify/new-rec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recId: data.id, curatorId: profileId, silent: item.silent === true }),
      }).catch(err => console.error('[new-rec trigger] failed:', err));
    }

    setTasteItems(prev => [saved, ...prev]);
    return saved;
  };

  const deleteRec = async (id) => {
    const { error } = await supabase.from("recommendations").delete().eq("id", id);
    if (error) throw error;
    const { error: revErr } = await supabase.from("revisions").delete().eq("rec_id", id);
    if (revErr) throw revErr;
    if (profileId) {
      console.log('TRACKING: deleted a rec, profileId:', profileId);
      const { error: trackingError } = await supabase.from('profiles').update({
        last_seen_at: new Date().toISOString(),
        last_action: 'deleted a rec',
        last_action_at: new Date().toISOString()
      }).eq('id', profileId);
      if (trackingError) console.error('TRACKING ERROR:', trackingError);
    }
    setTasteItems(items => items.filter(i => i.id !== id));
  };

  const updateRec = async (updated) => {
    setTasteItems(items => items.map(i => i.id === updated.id ? updated : i));
    if (profileId) {
      const { data: updatedRows, error: updateError } = await supabase
        .from("recommendations")
        .update({
          title: updated.title, context: updated.context,
          tags: updated.tags, category: updated.category,
          links: updated.links, revision: updated.revision,
          visibility: updated.visibility,
        })
        .eq("id", updated.id)
        .select();
      if (updateError) console.error("[UPDATE_REC_ERROR]", updateError.message, updateError);
      else if (!updatedRows || updatedRows.length === 0) console.error("[UPDATE_REC_NO_ROWS]", "update matched 0 rows", updated.id);

      // Sync rec_files curation + work blocks to match edited values.
      // rec_file_id lives on the tasteItem — look it up from current state.
      if (updated.rec_file_id) {
        const now = new Date().toISOString();
        const { error: recFileErr } = await supabase
          .from("rec_files")
          .update({
            curation: {
              ...(updated.curation_block || {}),
              why: updated.context || null,
              tags: updated.tags || [],
              confirmed_at: now,
            },
            work: {
              ...(updated.work || {}),
              title: updated.title,
              category: updated.category,
            },
            visibility: {
              ...(updated.visibility_block || {}),
              level: updated.visibility === 'public' ? 'public' : 'taste-file-only',
              pool_eligible: true,
            },
            updated_at: now,
          })
          .eq("id", updated.rec_file_id);
        if (recFileErr) console.error("[UPDATE_REC_FILE_ERROR]", recFileErr.message, updated.rec_file_id);
        else console.log("[UPDATE_REC_FILE] synced rec_files curation+work for", updated.rec_file_id);
      }
    }
  };

  const saveMsgToDb = async (role, text, capturedRec, blocks, recRefs = [], metaPayload = null) => {
    if (!profileId) return null;
    try {
      const row = {
        profile_id: profileId,
        role: role === "ai" ? "assistant" : role,
        text,
        captured_rec: capturedRec || null,
        blocks: blocks || null,
        rec_refs: recRefs && recRefs.length > 0 ? recRefs : [],
      };
      // Bug 3 fix: persist imageRecCandidate in meta jsonb for DB reload hydration
      if (metaPayload) row.meta = metaPayload;
      const { data } = await supabase.from("chat_messages").insert(row).select('id').single();
      return data?.id || null;
    } catch (err) { console.error("Failed to save message:", err); return null; }
  };

  const refreshSubscriptions = useCallback(async () => {
    if (!profileId) return;
    try {
      const { data: subRows } = await supabase
        .from("subscriptions").select("*")
        .eq("subscriber_id", profileId).is("unsubscribed_at", null);
      if (subRows && subRows.length > 0) {
        const curatorIds = subRows.map(s => s.curator_id);
        const { data: curatorProfiles } = await supabase
          .from("profiles").select("id, name, handle, bio").in("id", curatorIds);
        const profileMap = {};
        (curatorProfiles || []).forEach(p => { profileMap[p.id] = p; });
        setMySubscriptions(subRows.map(s => ({ ...s, curator: profileMap[s.curator_id] || null })));
        setMySubscriptionIds(new Set(curatorIds));
      } else {
        setMySubscriptions(subRows || []);
        setMySubscriptionIds(new Set());
      }

      const { data: fanRows } = await supabase
        .from("subscriptions").select("*")
        .eq("curator_id", profileId).is("unsubscribed_at", null);
      if (fanRows && fanRows.length > 0) {
        const subscriberIds = fanRows.map(s => s.subscriber_id);
        const { data: subProfiles } = await supabase
          .from("profiles").select("id, name, handle, bio").in("id", subscriberIds);
        const profileMap = {};
        (subProfiles || []).forEach(p => { profileMap[p.id] = p; });
        setMySubscribers(fanRows.map(s => ({ ...s, subscriber: profileMap[s.subscriber_id] || null })));
      } else {
        setMySubscribers(fanRows || []);
      }
    } catch (err) {
      console.warn("Failed to refresh subscriptions:", err);
    }
  }, [profileId]);

  const subscribe = async (curatorId) => {
    if (!profileId) return;
    try {
      // Check if a row already exists (possibly with unsubscribed_at set)
      const { data: existing } = await supabase.from("subscriptions")
        .select("*")
        .eq("subscriber_id", profileId)
        .eq("curator_id", curatorId)
        .limit(1)
        .maybeSingle();
      if (existing) {
        // Re-subscribe: clear unsubscribed_at
        await supabase.from("subscriptions")
          .update({ unsubscribed_at: null })
          .eq("id", existing.id);
      } else {
        // New subscription
        await supabase.from("subscriptions").insert({
          subscriber_id: profileId,
          curator_id: curatorId,
        });
      }
      setMySubscriptionIds(prev => new Set([...prev, curatorId]));
      // Notify curator of new subscriber (fire and forget)
      fetch('/api/notify/new-subscriber', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ curatorId, subscriberId: profileId }),
      }).catch(() => {});
      // Refresh to get full data with profiles
      await refreshSubscriptions();
    } catch (err) { console.error("Failed to subscribe:", err); }
  };

  const unsubscribe = async (curatorId) => {
    if (!profileId) return;
    try {
      const { error } = await supabase.from("subscriptions")
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq("subscriber_id", profileId)
        .eq("curator_id", curatorId)
        .is("unsubscribed_at", null);
      if (error) throw error;
      setMySubscriptions(prev => prev.filter(s => s.curator_id !== curatorId));
      setMySubscriptionIds(prev => { const next = new Set(prev); next.delete(curatorId); return next; });
      setMySubscribers(prev => prev.filter(s => s.subscriber_id !== curatorId));
    } catch (err) { console.error("Failed to unsubscribe:", err); }
  };

  const saveRec = useCallback(async (recId) => {
    if (!profileId) return;
    setSavedRecIds(prev => new Set([...prev, recId]));
    try {
      const { data: existing } = await supabase.from("saved_recs")
        .select("id").eq("user_id", profileId).eq("recommendation_id", recId)
        .limit(1).maybeSingle();
      if (!existing) {
        const { error: insertErr } = await supabase.from("saved_recs")
          .insert({ user_id: profileId, recommendation_id: recId });
        if (insertErr) {
          setSavedRecIds(prev => { const next = new Set(prev); next.delete(recId); return next; });
        }
      }
    } catch (err) {
      setSavedRecIds(prev => { const next = new Set(prev); next.delete(recId); return next; });
    }
  }, [profileId]);

  const unsaveRec = useCallback(async (recId) => {
    if (!profileId) return;
    setSavedRecIds(prev => { const next = new Set(prev); next.delete(recId); return next; });
    try {
      await supabase.from("saved_recs").delete()
        .eq("user_id", profileId).eq("recommendation_id", recId);
    } catch (err) {
      setSavedRecIds(prev => new Set([...prev, recId]));
    }
  }, [profileId]);

  const removeItem = async (id) => {
    if (!window.confirm("\u26A0\uFE0F DELETE RECOMMENDATION\n\nThis will permanently delete this recommendation and cannot be undone. Are you sure?")) return;
    setRemoving(id);
    try {
      await deleteRec(id);
      setArchived(prev => { const next = { ...prev }; delete next[id]; return next; });
    } catch (err) {
      console.error("Delete failed:", err);
      alert("Failed to delete recommendation. Please try again.");
    }
    setRemoving(null);
  };

  const undoArchive = () => {
    if (undoItem) {
      setArchived(prev => { const next = { ...prev }; delete next[undoItem.id]; return next; });
      setUndoItem(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
    }
  };

  const restoreItem = (id) => {
    setArchived(prev => { const next = { ...prev }; delete next[id]; return next; });
    if (filterCat === "archived") {
      if (Object.keys(archived).length <= 1) setFilterCat(null);
    }
    if (profileId) {
      supabase.from("recommendations").update({ status: "approved" }).eq("id", id).catch(console.error);
    }
  };

  const toggleVisibility = (id) => {
    setTasteItems(items => items.map(i =>
      i.id === id ? { ...i, visibility: i.visibility === "public" ? "private" : "public" } : i
    ));
  };

  // First-time curator: 0 recs and no bio yet
  const isFirstTime = dbLoaded && tasteItems.length === 0 && (!profile?.bio || profile.bio.trim() === '' || profile.bio.startsWith('[note'));

  return (
    <CuratorContext.Provider value={{
      profile, setProfile,
      profileId,
      isFirstTime,
      tasteItems, setTasteItems,
      messages, setMessages,
      dbLoaded,
      prevMsgCount,
      addRec,
      deleteRec,
      updateRec,
      saveProfile,
      saveProfileFromChat,
      saveMsgToDb,
      archived, setArchived,
      removing, setRemoving,
      filterCat, setFilterCat,
      undoItem, setUndoItem,
      removeItem,
      restoreItem,
      undoArchive,
      toggleVisibility,
      logout,
      mySubscriptions, mySubscribers, mySubscriptionIds,
      subscribe, unsubscribe, refreshSubscriptions,
      savedRecIds, saveRec, unsaveRec,
      isOwner: true,
    }}>
      {children}
    </CuratorContext.Provider>
  );
}

export function useCurator() {
  // Both contexts are always called (rules of hooks) — one will be null
  const curator = useContext(CuratorContext);
  const visitor = useContext(VisitorContext);
  // Prefer visitor when both present — on /[handle] routes, logged-in users
  // have CuratorProvider (for shell nav) + VisitorProvider (for viewed profile data)
  const ctx = visitor || curator;
  if (!ctx) throw new Error("useCurator must be used within CuratorProvider or VisitorProvider");
  return ctx;
}
