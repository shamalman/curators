"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCurator } from "@/context/CuratorContext";
import { supabase } from "@/lib/supabase";
import { T, F, S } from "@/lib/constants";

function fmtRelative(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDayDivider(iso) {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msgDay = new Date(d);
  msgDay.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - msgDay) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function ThreadDetail({ threadId, onBack }) {
  const router = useRouter();
  const { profileId } = useCurator();
  const [loading, setLoading] = useState(true);
  const [thread, setThread] = useState(null);
  const [otherParticipant, setOtherParticipant] = useState(null);
  const [messages, setMessages] = useState([]);
  const [validations, setValidations] = useState({});
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!threadId || !profileId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);

      const { data: t, error: tErr } = await supabase
        .from("threads")
        .select("id, subscriber_id, curator_id, last_message_at, created_at")
        .eq("id", threadId)
        .single();
      if (tErr || !t) {
        if (!cancelled) {
          setError("Thread not found");
          setLoading(false);
        }
        return;
      }
      const otherId = t.subscriber_id === profileId ? t.curator_id : t.subscriber_id;

      const { data: other } = await supabase
        .from("profiles")
        .select("id, name, handle")
        .eq("id", otherId)
        .single();

      const { data: msgs } = await supabase
        .from("thread_messages")
        .select("id, sender_id, body, validation_id, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });

      const validationIds = (msgs || []).map((m) => m.validation_id).filter(Boolean);
      let validationMap = {};
      if (validationIds.length > 0) {
        const { data: vals } = await supabase
          .from("validations")
          .select("id, rec_id, retracted_at")
          .in("id", validationIds);
        const recIds = (vals || []).map((v) => v.rec_id).filter(Boolean);
        let recMap = {};
        if (recIds.length > 0) {
          const { data: recs } = await supabase
            .from("recommendations")
            .select("id, title, slug, profile_id")
            .in("id", recIds);
          const curatorIds = (recs || []).map((r) => r.profile_id).filter(Boolean);
          let handleMap = {};
          if (curatorIds.length > 0) {
            const { data: curators } = await supabase
              .from("profiles")
              .select("id, handle")
              .in("id", curatorIds);
            (curators || []).forEach((c) => { handleMap[c.id] = c.handle; });
          }
          (recs || []).forEach((r) => {
            recMap[r.id] = { ...r, curatorHandle: handleMap[r.profile_id] };
          });
        }
        (vals || []).forEach((v) => {
          validationMap[v.id] = { retracted_at: v.retracted_at, rec: recMap[v.rec_id] || null };
        });
      }

      if (cancelled) return;
      setThread(t);
      setOtherParticipant(other || null);
      setMessages(msgs || []);
      setValidations(validationMap);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [threadId, profileId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, loading]);

  async function handleSend() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || "Failed to send");
        setSending(false);
        return;
      }
      setDraft("");
      const { data: msgs } = await supabase
        .from("thread_messages")
        .select("id, sender_id, body, validation_id, created_at")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      setMessages(msgs || []);
    } catch (e) {
      setError(e?.message || "Send failed");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: T.ink3, fontFamily: F, fontSize: 13 }}>
        Loading thread...
      </div>
    );
  }
  if (error && !thread) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: T.ink3, fontFamily: F, fontSize: 13 }}>
        {error}
      </div>
    );
  }

  const items = [];
  let lastDay = null;
  (messages || []).forEach((m) => {
    const k = dayKey(m.created_at);
    if (k !== lastDay) {
      items.push({ kind: "divider", id: `d-${k}`, label: fmtDayDivider(m.created_at) });
      lastDay = k;
    }
    items.push({ kind: "message", ...m });
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "12px 20px", borderBottom: `1px solid ${T.bdr}`,
        background: T.bg, flexShrink: 0,
      }}>
        <button
          onClick={onBack}
          style={{
            background: "transparent", border: "none", padding: 4, cursor: "pointer",
            fontFamily: F, fontSize: 18, color: T.ink2,
          }}
          aria-label="Back"
        >{"←"}</button>
        <div
          onClick={() => otherParticipant?.handle && router.push(`/${otherParticipant.handle}`)}
          style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", flex: 1, minWidth: 0 }}
        >
          <div style={{
            width: 32, height: 32, borderRadius: 10, background: T.accSoft,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span style={{ fontFamily: S, fontSize: 14, color: T.acc, fontWeight: 400 }}>
              {otherParticipant?.name?.[0] || "?"}
            </span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink, lineHeight: 1.2 }}>
              {otherParticipant?.name || "Unknown"}
            </div>
            <div style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>
              {otherParticipant?.handle ? `@${otherParticipant.handle}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px" }}>
        {items.length === 0 && (
          <div style={{ textAlign: "center", color: T.ink3, fontFamily: F, fontSize: 13, padding: 40 }}>
            No messages yet.
          </div>
        )}
        {items.map((it) => {
          if (it.kind === "divider") {
            return (
              <div key={it.id} style={{
                textAlign: "center", margin: "16px 0",
                fontFamily: F, fontSize: 11, color: T.ink3,
                textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 600,
              }}>
                {it.label}
              </div>
            );
          }
          const isMine = it.sender_id === profileId;
          const v = it.validation_id ? validations[it.validation_id] : null;
          const isRetracted = v && v.retracted_at;
          return (
            <div key={it.id} style={{
              display: "flex", justifyContent: isMine ? "flex-end" : "flex-start",
              marginBottom: 12,
            }}>
              <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{
                  background: isMine ? T.acc : T.s,
                  color: isMine ? T.accText : T.ink,
                  padding: "10px 14px",
                  borderRadius: 14,
                  borderTopRightRadius: isMine ? 4 : 14,
                  borderTopLeftRadius: isMine ? 14 : 4,
                  fontFamily: F, fontSize: 14, lineHeight: 1.4,
                  whiteSpace: "pre-wrap",
                  opacity: isRetracted ? 0.55 : 1,
                }}>
                  {it.body}
                </div>
                {isRetracted && (
                  <div style={{
                    fontFamily: F, fontSize: 10, color: T.ink3,
                    textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700,
                    alignSelf: isMine ? "flex-end" : "flex-start",
                  }}>
                    Retracted
                  </div>
                )}
                {v?.rec && (
                  <div
                    onClick={() => router.push(`/${v.rec.curatorHandle}/${v.rec.slug}`)}
                    style={{
                      background: T.bg, border: `1px solid ${T.bdr}`, borderRadius: 10,
                      padding: "8px 12px", cursor: "pointer", alignSelf: isMine ? "flex-end" : "flex-start",
                      maxWidth: "100%",
                    }}
                  >
                    <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 700, marginBottom: 2 }}>
                      Rec
                    </div>
                    <div style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: T.ink, lineHeight: 1.3 }}>
                      {v.rec.title || "(untitled)"}
                    </div>
                    <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 2 }}>
                      @{v.rec.curatorHandle}
                    </div>
                  </div>
                )}
                <div style={{
                  fontFamily: F, fontSize: 10, color: T.ink3,
                  alignSelf: isMine ? "flex-end" : "flex-start",
                }}>
                  {fmtRelative(it.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        padding: "10px 16px 12px", flexShrink: 0,
        borderTop: `1px solid ${T.bdr}`, background: T.bg,
        display: "flex", gap: 8, alignItems: "flex-end",
      }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          placeholder="Write a reply..."
          style={{
            flex: 1, minWidth: 0, padding: "10px 14px",
            borderRadius: 18, border: `1.5px solid ${T.bdr}`,
            fontSize: 14, fontFamily: F, outline: "none",
            background: T.s, color: T.ink, resize: "none",
            lineHeight: 1.4, boxSizing: "border-box",
            maxHeight: 120,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          style={{
            width: 38, height: 38, borderRadius: 19, border: "none",
            background: draft.trim() && !sending ? T.acc : T.bdr,
            color: draft.trim() && !sending ? T.accText : T.ink3,
            fontSize: 16, cursor: draft.trim() && !sending ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontWeight: 600,
          }}
          aria-label="Send"
        >{"↑"}</button>
      </div>

      {error && (
        <div style={{
          padding: "6px 16px", color: "#c44", fontFamily: F, fontSize: 11,
          textAlign: "center", background: T.bg,
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
