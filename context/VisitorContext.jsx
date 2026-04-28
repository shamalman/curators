'use client'

import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabase";

export const VisitorContext = createContext(null);

export function VisitorProvider({ handle, children }) {
  const [profile, setProfile] = useState(null);
  const [profileId, setProfileId] = useState(null);
  const [tasteItems, setTasteItems] = useState([]);
  const [messages, setMessages] = useState([]);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [signalCount, setSignalCount] = useState(0);
  const prevMsgCount = useRef(0);

  const loadVisitorData = useCallback(async () => {
    if (!handle) return;
    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("*")
        .eq("handle", handle)
        .single();
      if (prof) {
        setProfileId(prof.id);
        setProfile({
          name: prof.name, handle: "@" + prof.handle,
          bio: prof.bio, aiEnabled: prof.ai_enabled,
          acceptRequests: prof.accept_requests, showRecs: prof.show_recs,
          showSubscriptions: prof.show_subscriptions || false,
          showSubscribers: prof.show_subscribers || false,
          cryptoEnabled: prof.crypto_enabled, wallet: prof.wallet || "",
          walletFull: "",
          socialLinks: prof.social_links || {},
          subscribers: 0, subsEnabled: true,
          subsText: "Curated recs straight to your inbox. Only things worth your time.",
        });

        // Check if logged-in user owns this profile + fetch recs in parallel
        const [authResult, recsResult] = await Promise.all([
          supabase.auth.getUser(),
          supabase.from("recommendations").select("*").eq("profile_id", prof.id).eq("visibility", "public").order("created_at", { ascending: false })
        ]);

        const { data: { user } } = authResult;
        if (user && prof.auth_user_id === user.id) {
          setIsOwner(true);
        }

        const recs = recsResult.data;
        if (recs && recs.length > 0) {
          const recFileIds = recs.map(r => r.rec_file_id).filter(Boolean);
          let recFilesById = {};
          if (recFileIds.length > 0) {
            const { data: recFilesData, error: recFilesErr } = await supabase
              .from("rec_files")
              .select("id, body_md, extraction, work, curation, curator_is_author, source")
              .in("id", recFileIds);
            if (recFilesErr) {
              console.warn("[VISITOR_CONTEXT_LOAD] rec_files secondary load failed:", recFilesErr.message);
            } else if (recFilesData) {
              recFilesById = Object.fromEntries(recFilesData.map(rf => [rf.id, rf]));
            }
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
              rec_file_id: r.rec_file_id || null,
              body_md: recFile?.body_md || null,
              extraction: recFile?.extraction || null,
              work: recFile?.work || null,
              curation_block: recFile?.curation || null,
              curator_is_author: recFile?.curator_is_author || false,
              source_block: recFile?.source || null,
            };
          }));
        }

        try {
          const sigRes = await fetch(`/api/visitor/signals?profile_id=${prof.id}`);
          if (sigRes.ok) {
            const sigData = await sigRes.json();
            setSignalCount(sigData.signal_count || 0);
          } else {
            console.warn("[VISITOR_SIGNALS_FETCH_ERROR] non-ok response:", sigRes.status);
          }
        } catch (sigErr) {
          console.warn("[VISITOR_SIGNALS_FETCH_ERROR]", sigErr);
        }
      }
      setDbLoaded(true);
    } catch (err) {
      console.error("Failed to load visitor data:", err);
      setDbLoaded(true);
    }
  }, [handle]);

  // Fetch profile + public recs by handle
  useEffect(() => {
    loadVisitorData();
  }, [loadVisitorData]);

  // No-op stubs for curator-only functions
  const addRec = async () => {};
  const deleteRec = async () => {};
  const updateRec = async () => {};
  const saveMsgToDb = async () => {};
  const removeItem = async () => {};
  const restoreItem = () => {};
  const undoArchive = () => {};
  const toggleVisibility = () => {};

  return (
    <VisitorContext.Provider value={{
      profile, setProfile,
      profileId,
      tasteItems, setTasteItems,
      messages, setMessages,
      dbLoaded,
      prevMsgCount,
      addRec,
      deleteRec,
      updateRec,
      saveMsgToDb,
      archived: {},
      setArchived: () => {},
      removing: null,
      setRemoving: () => {},
      filterCat: null,
      setFilterCat: () => {},
      undoItem: null,
      setUndoItem: () => {},
      removeItem,
      restoreItem,
      undoArchive,
      toggleVisibility,
      isOwner,
      signalCount,
      refresh: loadVisitorData,
    }}>
      {children}
    </VisitorContext.Provider>
  );
}
