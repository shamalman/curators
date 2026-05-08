// hooks/useLensInsights.js
//
// Debounced client hook for /api/recs/lens-insights. Returns the full
// forward-compatible envelope so future insight surfaces (category nudge,
// network echoes, subscriber relevance, similar recs) can subscribe without
// re-plumbing the hook call.

import { useEffect, useRef, useState } from "react";

const EMPTY = {
  suggestedTags: [],
  suggestedCategory: null,
  networkEchoes: null,
  subscriberRelevance: null,
  similarRecs: null,
};

const DEBOUNCE_MS = 500;

function useDebouncedValue(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function hasMeaningfulContext({ title, writeup, link }) {
  // Don't fire on empty modals. Require any one of:
  //   - a parsed link
  //   - a non-trivial title
  //   - a writeup of >20 chars
  if (link && (link.parsedPayload?.body_md || link.parsedPayload?.canonical_url)) return true;
  if (title && title.trim().length >= 3) return true;
  if (writeup && writeup.trim().length >= 20) return true;
  return false;
}

export function useLensInsights({ profileId, title, writeup, link, existingTags }) {
  const [insights, setInsights] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const requestSeqRef = useRef(0);

  // Debounce the typed inputs. link and existingTags are event-driven
  // (only change on attach/remove or chip tap) so they don't need debounce.
  const debouncedTitle = useDebouncedValue(title, DEBOUNCE_MS);
  const debouncedWriteup = useDebouncedValue(writeup, DEBOUNCE_MS);

  const existingTagsKey = JSON.stringify(existingTags || []);

  useEffect(() => {
    if (!profileId) return;
    const ctx = { title: debouncedTitle, writeup: debouncedWriteup, link };
    if (!hasMeaningfulContext(ctx)) {
      setInsights(EMPTY);
      return;
    }

    const seq = ++requestSeqRef.current;
    setLoading(true);

    fetch("/api/recs/lens-insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profileId,
        title: debouncedTitle,
        writeup: debouncedWriteup,
        link: link ? { url: link.url, parsedPayload: link.parsedPayload } : null,
        existingTags,
      }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (seq !== requestSeqRef.current) return; // newer request superseded
        setInsights(data?.insights || EMPTY);
      })
      .catch((err) => {
        if (seq !== requestSeqRef.current) return;
        console.error("[useLensInsights] fetch failed:", err?.message || err);
        setInsights(EMPTY);
      })
      .finally(() => {
        if (seq === requestSeqRef.current) setLoading(false);
      });
    // existingTagsKey lets the hook re-fire when tags change (e.g. after a
    // suggestion chip is tapped); link is referenced by identity since
    // attachUrl creates a new object on each attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, debouncedTitle, debouncedWriteup, link, existingTagsKey]);

  return { insights, loading };
}
