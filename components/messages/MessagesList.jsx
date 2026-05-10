"use client";
import { useEffect, useState } from "react";
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

export default function MessagesList({ onOpenThread }) {
  const { profileId } = useCurator();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [iAmCurator, setIAmCurator] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: threads } = await supabase
        .from("threads")
        .select("id, subscriber_id, curator_id, last_message_at")
        .order("last_message_at", { ascending: false });

      if (!threads || threads.length === 0) {
        if (!cancelled) {
          setRows([]);
          setLoading(false);
        }
        return;
      }

      const otherIds = threads.map((t) =>
        t.subscriber_id === profileId ? t.curator_id : t.subscriber_id
      );
      const uniqueOther = Array.from(new Set(otherIds));
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, handle")
        .in("id", uniqueOther);
      const profMap = {};
      (profiles || []).forEach((p) => { profMap[p.id] = p; });

      const threadIds = threads.map((t) => t.id);
      const { data: lastMsgs } = await supabase
        .from("thread_messages")
        .select("id, thread_id, body, created_at")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: false });
      const latestByThread = {};
      (lastMsgs || []).forEach((m) => {
        if (!latestByThread[m.thread_id]) latestByThread[m.thread_id] = m;
      });

      const curatorThreads = threads.filter((t) => t.curator_id === profileId).length;
      const subscriberThreads = threads.filter((t) => t.subscriber_id === profileId).length;

      const built = threads.map((t) => {
        const otherId = t.subscriber_id === profileId ? t.curator_id : t.subscriber_id;
        const other = profMap[otherId] || { name: "Unknown", handle: "" };
        const last = latestByThread[t.id];
        return {
          id: t.id,
          other,
          lastBody: last?.body || "",
          lastAt: t.last_message_at,
        };
      });

      if (!cancelled) {
        setRows(built);
        setIAmCurator(curatorThreads >= subscriberThreads);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: T.ink3, fontFamily: F, fontSize: 13 }}>
        Loading messages...
      </div>
    );
  }

  if (rows.length === 0) {
    const copy = iAmCurator
      ? "No messages yet. When subscribers tell you about recs that landed, their notes will appear here."
      : "No messages yet. When you send a curator a note about a rec that landed, it'll appear here.";
    return (
      <div style={{ padding: "40px 24px", textAlign: "center", color: T.ink3, fontFamily: F, fontSize: 13, lineHeight: 1.5 }}>
        {copy}
      </div>
    );
  }

  return (
    <div>
      {rows.map((r) => (
        <div
          key={r.id}
          onClick={() => onOpenThread(r.id)}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "14px 4px",
            borderBottom: `1px solid ${T.bdr}`, cursor: "pointer",
          }}
        >
          <div style={{
            width: 40, height: 40, borderRadius: 12, background: T.accSoft,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span style={{ fontFamily: S, fontSize: 17, color: T.acc, fontWeight: 400 }}>
              {r.other.name?.[0] || "?"}
            </span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.other.name || `@${r.other.handle}`}
              </div>
              <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, flexShrink: 0 }}>
                {fmtRelative(r.lastAt)}
              </div>
            </div>
            <div style={{
              fontFamily: F, fontSize: 12, color: T.ink3,
              overflow: "hidden", textOverflow: "ellipsis",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
              marginTop: 2, lineHeight: 1.4,
            }}>
              {r.lastBody || "(no messages)"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
