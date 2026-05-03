'use client'

import { useEffect, useRef, useState } from "react";
import { T, F } from "@/lib/constants";

// Module-level render-speed cache. Keyed by source_url::rec_file_id. Server is
// the source of truth (taste_reads table); this cache avoids re-fetching across
// remount within a single page session. On page reload the cache is empty and
// the card hydrates from the server.
const cache = new Map();

function cacheKey(source_url, rec_file_id) {
  return `${source_url || ""}::${rec_file_id || ""}`;
}

function writeCache(key, patch) {
  const prev = cache.get(key) || {};
  cache.set(key, { ...prev, ...patch });
}

function writeInferenceState(key, inferenceId, state) {
  const entry = cache.get(key);
  if (!entry) return;
  const states = { ...(entry.states || {}), [inferenceId]: state };
  cache.set(key, { ...entry, states });
}

function writeRefinedText(key, inferenceId, text) {
  const entry = cache.get(key);
  if (!entry) return;
  const refined_texts = { ...(entry.refined_texts || {}), [inferenceId]: text };
  cache.set(key, { ...entry, refined_texts });
}

function writeFlag(key, name, value) {
  const entry = cache.get(key);
  if (!entry) return;
  cache.set(key, { ...entry, [name]: value });
}

const ACCENT = T.acc;
const CONFIRMED_BG = "#5E9E8218";
const CONFIRMED_FG = "#5E9E82";
const REFINED_BG = "#4B92CC18";
const REFINED_FG = "#4B92CC";
const IGNORED_BG = T.s2;
const IGNORED_FG = T.ink3;

export default function TasteReadCard({ data, onSendMessage }) {
  const parsed_content = data?.parsed_content || "";
  const source_url = data?.source_url || null;
  const rec_file_id = data?.rec_file_id || null;
  const key = cacheKey(source_url, rec_file_id);

  const cached = cache.get(key);
  const [loading, setLoading] = useState(!cached || !cached.inferences);
  const [error, setError] = useState(null);
  const [extraction, setExtraction] = useState(cached?.extraction || "");
  const [inferences, setInferences] = useState(cached?.inferences || []);
  const [states, setStates] = useState(cached?.states || {});
  const [refinedTexts, setRefinedTexts] = useState(cached?.refined_texts || {});
  const [drafts, setDrafts] = useState({});
  const [collapsed, setCollapsed] = useState(cached?.collapsed === true);
  const [dismissed, setDismissed] = useState(cached?.dismissed === true);
  const [done, setDone] = useState(cached?.done === true);
  const hydratedRef = useRef(false);

  // Fire-and-forget PATCH to server for UI state. No revert on failure — cache
  // + local state stay optimistic. Server re-hydrates on next mount.
  const patchState = (patch) => {
    if (!source_url && !rec_file_id) return;
    (async () => {
      try {
        await fetch("/api/taste-read/state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source_url, rec_file_id, ...patch }),
        });
      } catch {}
    })();
  };

  // Hydrate on mount: cache → GET → POST (if 404). Cache hit skips all network.
  useEffect(() => {
    if (cached?.inferences) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    (async () => {
      try {
        // Try GET first — cheap, avoids shipping parsed_content if the row exists.
        const params = new URLSearchParams();
        if (source_url) params.set("source_url", source_url);
        if (rec_file_id) params.set("rec_file_id", rec_file_id);
        const getRes = await fetch(`/api/taste-read?${params.toString()}`);

        let payload;
        if (getRes.ok) {
          payload = await getRes.json();
        } else if (getRes.status === 404) {
          // Not persisted yet — generate via POST.
          if (!parsed_content) {
            throw new Error("No parsed content and no persisted read");
          }
          const postRes = await fetch("/api/taste-read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parsed_content, source_url, rec_file_id }),
          });
          if (!postRes.ok) {
            const j = await postRes.json().catch(() => ({}));
            throw new Error(j.error || `Read failed (${postRes.status})`);
          }
          payload = await postRes.json();
        } else {
          const j = await getRes.json().catch(() => ({}));
          throw new Error(j.error || `Hydrate failed (${getRes.status})`);
        }

        writeCache(key, {
          extraction: payload.extraction,
          inferences: payload.inferences,
          states: payload.states,
          refined_texts: payload.refined_texts,
          collapsed: payload.collapsed,
          dismissed: payload.dismissed,
          done: payload.done,
        });
        setExtraction(payload.extraction);
        setInferences(payload.inferences);
        setStates(payload.states || {});
        setRefinedTexts(payload.refined_texts || {});
        setCollapsed(!!payload.collapsed);
        setDismissed(!!payload.dismissed);
        setDone(!!payload.done);
        setLoading(false);
      } catch (e) {
        setError(e.message || "Couldn't read this.");
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setInferenceStateLocal = (id, newState) => {
    setStates(prev => {
      const next = { ...prev, [id]: newState };
      writeInferenceState(key, id, newState);
      return next;
    });
  };

  const setRefinedLocal = (id, text) => {
    setRefinedTexts(prev => {
      const next = { ...prev, [id]: text };
      writeRefinedText(key, id, text);
      return next;
    });
  };

  // Any undo while the card is "done" also flips done back to false so the
  // card becomes live again. Card stays expanded (collapsed does not change).
  const undoMayReviveDone = () => {
    if (done) {
      setDone(false);
      writeFlag(key, "done", false);
      return { done: false };
    }
    return {};
  };

  const onConfirm = async (inf) => {
    setInferenceStateLocal(inf.id, "pending");
    try {
      const res = await fetch("/api/taste-read/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inference_text: inf.text, source_url, rec_file_id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error();
      setInferenceStateLocal(inf.id, "confirmed");
      patchState({ states: { [inf.id]: "confirmed" } });
    } catch {
      setInferenceStateLocal(inf.id, "idle");
    }
  };

  const onRefineStart = (id) => {
    setInferenceStateLocal(id, "refining");
  };

  const onRefineCancel = (id) => {
    setDrafts(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setInferenceStateLocal(id, "idle");
  };

  const onRefineSave = async (inf) => {
    const refined = (drafts[inf.id] || "").trim();
    if (!refined) return;
    setInferenceStateLocal(inf.id, "pending");
    try {
      const res = await fetch("/api/taste-read/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          original_inference_text: inf.text,
          refined_text: refined,
          source_url,
          rec_file_id,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error();
      setRefinedLocal(inf.id, refined);
      setInferenceStateLocal(inf.id, "refined");
      patchState({ states: { [inf.id]: "refined" }, refined_texts: { [inf.id]: refined } });
      setDrafts(prev => {
        const next = { ...prev };
        delete next[inf.id];
        return next;
      });
    } catch {
      setInferenceStateLocal(inf.id, "refining");
    }
  };

  const onIgnore = async (inf) => {
    setInferenceStateLocal(inf.id, "pending");
    try {
      const res = await fetch("/api/taste-read/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inference_text: inf.text, source_url, rec_file_id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error();
      setInferenceStateLocal(inf.id, "ignored");
      patchState({ states: { [inf.id]: "ignored" } });
    } catch {
      setInferenceStateLocal(inf.id, "idle");
    }
  };

  const onUndoConfirm = async (inf) => {
    setInferenceStateLocal(inf.id, "idle");
    const donePatch = undoMayReviveDone();
    try {
      const res = await fetch("/api/taste-read/confirm", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inference_text: inf.text, source_url, rec_file_id }),
      });
      if (!res.ok) throw new Error();
      patchState({ states: { [inf.id]: "idle" }, ...donePatch });
    } catch {
      setInferenceStateLocal(inf.id, "confirmed");
      if (donePatch.done === false) {
        setDone(true);
        writeFlag(key, "done", true);
      }
    }
  };

  const onUndoRefine = async (inf) => {
    const refined = refinedTexts[inf.id] || "";
    setInferenceStateLocal(inf.id, "idle");
    const donePatch = undoMayReviveDone();
    try {
      const res = await fetch("/api/taste-read/refine", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refined_text: refined, source_url, rec_file_id }),
      });
      if (!res.ok) throw new Error();
      patchState({ states: { [inf.id]: "idle" }, ...donePatch });
    } catch {
      setInferenceStateLocal(inf.id, "refined");
      if (donePatch.done === false) {
        setDone(true);
        writeFlag(key, "done", true);
      }
    }
  };

  const onUndoIgnore = async (inf) => {
    setInferenceStateLocal(inf.id, "idle");
    const donePatch = undoMayReviveDone();
    try {
      const res = await fetch("/api/taste-read/ignore", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inference_text: inf.text, source_url, rec_file_id }),
      });
      if (!res.ok) throw new Error();
      patchState({ states: { [inf.id]: "idle" }, ...donePatch });
    } catch {
      setInferenceStateLocal(inf.id, "ignored");
      if (donePatch.done === false) {
        setDone(true);
        writeFlag(key, "done", true);
      }
    }
  };

  const onClickDone = () => {
    setDone(true);
    setCollapsed(true);
    writeFlag(key, "done", true);
    writeFlag(key, "collapsed", true);
    patchState({ done: true, collapsed: true });
  };

  const onClickDismiss = () => {
    setDismissed(true);
    writeFlag(key, "dismissed", true);
    patchState({ dismissed: true });
  };

  const onClickExpand = () => {
    setCollapsed(false);
    writeFlag(key, "collapsed", false);
    patchState({ collapsed: false });
  };

  const onSaveAsRec = () => {
    if (!source_url || !onSendMessage) return;
    onSendMessage(`save_rec_from_taste_read:${source_url}`);
  };

  // ── Render ──

  const containerStyle = {
    borderRadius: 14,
    border: `1px solid ${T.bdr}`,
    background: T.s,
    overflow: "hidden",
    marginBottom: 4,
  };

  if (dismissed) return null;

  if (loading) {
    return (
      <div style={containerStyle}>
        <div style={{ height: 3, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}80)` }} />
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 14, height: 14, borderRadius: 7,
            border: `2px solid ${T.bdr}`, borderTopColor: ACCENT,
            animation: "qcSpin 700ms linear infinite",
          }} />
          <span style={{ fontFamily: F, fontSize: 13, color: T.ink2 }}>
            Reading the piece.
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div style={{ height: 3, background: T.ink3 }} />
        <div style={{ padding: "14px 16px", fontFamily: F, fontSize: 13, color: T.ink2 }}>
          Couldn't read this. {error}
        </div>
      </div>
    );
  }

  const counts = inferences.reduce((acc, inf) => {
    const st = states[inf.id] || "idle";
    if (st === "confirmed") acc.confirmed += 1;
    else if (st === "refined") acc.refined += 1;
    else if (st === "ignored") acc.ignored += 1;
    else acc.unresolved += 1;
    return acc;
  }, { confirmed: 0, refined: 0, ignored: 0, unresolved: 0 });

  const anyResolved = counts.confirmed + counts.refined + counts.ignored > 0;
  const allResolved = inferences.length > 0 && counts.unresolved === 0;

  // Collapsed summary view (default when done=true)
  if (collapsed) {
    const parts = [];
    if (counts.confirmed) parts.push(`${counts.confirmed} confirmed`);
    if (counts.refined) parts.push(`${counts.refined} refined`);
    if (counts.ignored) parts.push(`${counts.ignored} ignored`);
    const summary = parts.join(", ") || "resolved";

    return (
      <div
        onClick={onClickExpand}
        style={{
          ...containerStyle,
          cursor: "pointer",
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{
          fontFamily: F, fontSize: 11, fontWeight: 700,
          letterSpacing: "0.06em", textTransform: "uppercase", color: ACCENT,
        }}>
          READ
        </span>
        <span style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>·</span>
        <span style={{ fontFamily: F, fontSize: 12, color: T.ink2 }}>{summary}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: F, fontSize: 11, color: T.ink3 }}>Tap to expand</span>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT}80)` }} />

      {/* Header */}
      <div style={{
        padding: "10px 16px",
        borderBottom: `1px solid ${ACCENT}15`,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        <span style={{
          fontFamily: F, fontSize: 11, fontWeight: 700,
          letterSpacing: "0.06em", textTransform: "uppercase", color: ACCENT,
        }}>
          READ
        </span>
      </div>

      {/* Extraction */}
      {extraction && (
        <div style={{
          padding: "14px 16px 12px",
          fontFamily: F,
          fontSize: 14,
          color: T.ink,
          lineHeight: 1.55,
          borderBottom: `1px solid ${T.bdr}`,
        }}>
          {extraction}
        </div>
      )}

      {/* Inferences */}
      <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {inferences.map((inf) => {
          const st = states[inf.id] || "idle";

          if (st === "ignored") {
            const preview = inf.text.length > 60 ? inf.text.slice(0, 60) + "…" : inf.text;
            return (
              <div key={inf.id} style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 8, background: IGNORED_BG,
                fontFamily: F, fontSize: 12, color: IGNORED_FG,
              }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Ignored: {preview}
                </span>
                <button
                  onClick={() => onUndoIgnore(inf)}
                  style={{
                    background: "none", border: "none", color: ACCENT,
                    fontSize: 12, fontFamily: F, cursor: "pointer", padding: 0,
                  }}
                >
                  Undo
                </button>
              </div>
            );
          }

          if (st === "confirmed") {
            return (
              <div key={inf.id} style={{
                padding: "12px 14px", borderRadius: 10,
                background: CONFIRMED_BG, border: `1px solid ${CONFIRMED_FG}30`,
              }}>
                <div style={{ fontFamily: F, fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>
                  {inf.text}
                </div>
                <div style={{ fontFamily: F, fontSize: 11, color: CONFIRMED_FG, marginTop: 6, fontWeight: 600 }}>
                  Saved to your Record
                  <span style={{ color: T.ink3, fontWeight: 400 }}> · </span>
                  <button
                    onClick={() => onUndoConfirm(inf)}
                    style={{
                      background: "none", border: "none", color: ACCENT,
                      fontSize: 11, fontFamily: F, fontWeight: 600,
                      cursor: "pointer", padding: 0,
                    }}
                  >
                    Undo
                  </button>
                </div>
              </div>
            );
          }

          if (st === "refined") {
            return (
              <div key={inf.id} style={{
                padding: "12px 14px", borderRadius: 10,
                background: REFINED_BG, border: `1px solid ${REFINED_FG}30`,
              }}>
                <div style={{ fontFamily: F, fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>
                  {refinedTexts[inf.id] || inf.text}
                </div>
                <div style={{ fontFamily: F, fontSize: 11, color: REFINED_FG, marginTop: 6, fontWeight: 600 }}>
                  Saved your correction
                  <span style={{ color: T.ink3, fontWeight: 400 }}> · </span>
                  <button
                    onClick={() => onUndoRefine(inf)}
                    style={{
                      background: "none", border: "none", color: ACCENT,
                      fontSize: 11, fontFamily: F, fontWeight: 600,
                      cursor: "pointer", padding: 0,
                    }}
                  >
                    Undo
                  </button>
                </div>
              </div>
            );
          }

          if (st === "refining") {
            const draft = drafts[inf.id] ?? "";
            return (
              <div key={inf.id} style={{
                padding: "12px 14px", borderRadius: 10,
                background: T.bg, border: `1px solid ${T.bdr}`,
              }}>
                <div style={{ fontFamily: F, fontSize: 12.5, color: T.ink3, marginBottom: 8, lineHeight: 1.45 }}>
                  {inf.text}
                </div>
                <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, marginBottom: 4, fontStyle: "italic" }}>
                  e.g. Closer to: you notice...
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDrafts(prev => ({ ...prev, [inf.id]: e.target.value }))}
                  autoFocus
                  rows={3}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "8px 10px", borderRadius: 8,
                    border: `1px solid ${T.bdr}`, background: T.s2,
                    color: T.ink, fontFamily: F, fontSize: 13,
                    outline: "none", resize: "vertical",
                  }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    onClick={() => onRefineSave(inf)}
                    disabled={!(drafts[inf.id] || "").trim()}
                    style={{
                      padding: "6px 12px", borderRadius: 16, border: "none",
                      background: ACCENT, color: T.accText,
                      fontFamily: F, fontSize: 12, fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Save correction
                  </button>
                  <button
                    onClick={() => onRefineCancel(inf.id)}
                    style={{
                      padding: "6px 12px", borderRadius: 16,
                      border: `1px solid ${T.bdr}`, background: "transparent",
                      color: T.ink2, fontFamily: F, fontSize: 12, cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          }

          // idle or pending
          const pending = st === "pending";

          // In done mode, idle inferences render dimmed with no action buttons.
          // (Shouldn't happen in normal flow — Done only appears when allResolved —
          // but defensively covered.)
          if (done) {
            return (
              <div key={inf.id} style={{
                padding: "12px 14px", borderRadius: 10,
                background: T.bg, border: `1px solid ${T.bdr}`,
                opacity: 0.5,
              }}>
                <div style={{ fontFamily: F, fontSize: 13.5, color: T.ink2, lineHeight: 1.5 }}>
                  {inf.text}
                </div>
              </div>
            );
          }

          return (
            <div key={inf.id} style={{
              padding: "12px 14px", borderRadius: 10,
              background: T.bg, border: `1px solid ${T.bdr}`,
              opacity: pending ? 0.6 : 1,
            }}>
              <div style={{ fontFamily: F, fontSize: 13.5, color: T.ink, lineHeight: 1.5 }}>
                {inf.text}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => onConfirm(inf)}
                  disabled={pending}
                  style={{
                    padding: "6px 12px", borderRadius: 16, border: "none",
                    background: ACCENT, color: T.accText,
                    fontFamily: F, fontSize: 12, fontWeight: 600,
                    cursor: pending ? "default" : "pointer",
                  }}
                >
                  Confirm
                </button>
                <button
                  onClick={() => onRefineStart(inf.id)}
                  disabled={pending}
                  style={{
                    padding: "6px 12px", borderRadius: 16,
                    border: `1px solid ${T.bdr}`, background: "transparent",
                    color: T.ink, fontFamily: F, fontSize: 12,
                    cursor: pending ? "default" : "pointer",
                  }}
                >
                  Refine
                </button>
                <button
                  onClick={() => onIgnore(inf)}
                  disabled={pending}
                  style={{
                    padding: "6px 12px", borderRadius: 16,
                    border: `1px solid ${T.bdr}`, background: "transparent",
                    color: T.ink3, fontFamily: F, fontSize: 12,
                    cursor: pending ? "default" : "pointer",
                  }}
                >
                  Ignore
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{
        borderTop: `1px solid ${T.bdr}`,
        padding: "10px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}>
        {source_url && onSendMessage && (
          <button
            onClick={onSaveAsRec}
            style={{
              padding: "6px 12px", borderRadius: 16, border: "none",
              background: ACCENT, color: T.accText,
              fontFamily: F, fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            + Save as a Recommendation
          </button>
        )}
        <span style={{ flex: 1 }} />
        {/* Done button: only in live mode, only when every inference is resolved */}
        {!done && allResolved && (
          <button
            onClick={onClickDone}
            style={{
              padding: "6px 12px", borderRadius: 16,
              border: `1px solid ${T.bdr}`, background: "transparent",
              color: T.ink, fontFamily: F, fontSize: 12, cursor: "pointer",
            }}
          >
            Done
          </button>
        )}
        {/* Dismiss button: only in live mode, only when nothing is resolved */}
        {!done && !anyResolved && (
          <button
            onClick={onClickDismiss}
            style={{
              padding: "6px 12px", borderRadius: 16,
              border: `1px solid ${T.bdr}`, background: "transparent",
              color: T.ink3, fontFamily: F, fontSize: 12, cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
