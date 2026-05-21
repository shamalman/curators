"use client";

import { useEffect, useState } from "react";
import { T, F, S } from "@/lib/constants";
import AllocationHeroBar from "./AllocationHeroBar";
import { formatDollar as fmtDollar } from "@/lib/format-money";

const SERIF_FAMILY = S;

export default function AllocationView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/allocation/preview", { credentials: "include" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) {
            setError(body?.error || `http_${res.status}`);
            setLoading(false);
          }
          return;
        }
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e?.message || "fetch_failed");
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "24px 0", color: T.ink3, fontFamily: F, fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "24px 0", color: T.ink3, fontFamily: F, fontSize: 13 }}>
        Could not load allocation preview.
      </div>
    );
  }

  if (!data) return null;

  const projected = data.is_projected === true;

  return (
    <div data-mocked={projected ? "true" : "false"} style={{ paddingTop: 4 }}>
      {/* Alpha banner */}
      {projected && (
        <div style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: `1.5px dashed ${T.bdr}`,
          background: T.s,
          color: T.ink2,
          fontFamily: F,
          fontSize: 12,
          lineHeight: 1.5,
          marginBottom: 20,
        }}>
          Projected (alpha). Your $15 subscription begins when Curators exits alpha. These numbers preview how it would currently allocate.
        </div>
      )}

      {/* Hero block */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontFamily: SERIF_FAMILY,
          fontSize: 44,
          color: T.ink,
          fontWeight: 400,
          lineHeight: 1.1,
        }}>
          {fmtDollar(data.hero.total)}
        </div>
        <div style={{
          fontFamily: F,
          fontSize: 11,
          color: T.ink3,
          marginTop: 4,
          marginBottom: 16,
        }}>
          to allocate this month · {data.days_remaining} days remaining
        </div>

        <AllocationHeroBar
          total={data.hero.total}
          activity={data.hero.activity}
          floor={data.hero.floor}
          unallocated={data.hero.unallocated}
        />
      </div>

      {/* Block A — Directed by activity */}
      <BlockHeader label="DIRECTED BY ACTIVITY" amount={data.hero.activity} />
      {data.activity.length === 0 ? (
        <div style={{
          padding: "12px 0",
          color: T.ink3,
          fontFamily: F,
          fontSize: 13,
        }}>
          No activity yet this cycle.
        </div>
      ) : (
        <div style={{ marginBottom: 24 }}>
          {data.activity.map(row => (
            <ActivityRow key={row.curator_id} row={row} />
          ))}
        </div>
      )}

      {/* Block B — Subscription floor */}
      <BlockHeader label="SUBSCRIPTION FLOOR" amount={data.floor.total} />
      {data.floor.active_curator_handles.length === 0 ? (
        <div style={{
          padding: "12px 0",
          color: T.ink3,
          fontFamily: F,
          fontSize: 13,
          marginBottom: 24,
        }}>
          No active curators in your subscriptions yet.
        </div>
      ) : (
        <FloorRow floor={data.floor} />
      )}

      {/* Block C — Unallocated */}
      <BlockHeader label="UNALLOCATED" amount={data.unallocated} />
      <div style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "10px 0",
        marginBottom: 24,
      }}>
        <div style={{ fontFamily: F, fontSize: 13, color: T.ink2 }}>
          No signal yet this cycle
        </div>
        <div style={{ fontFamily: F, fontSize: 11, color: T.ink3 }}>
          Cascades at month end
        </div>
      </div>

      {/* Footnote */}
      <div style={{
        padding: "12px 14px",
        borderRadius: 10,
        background: T.s,
        color: T.ink3,
        fontFamily: F,
        fontSize: 11,
        lineHeight: 1.6,
        marginBottom: 24,
      }}>
        <strong style={{ color: T.ink2, fontWeight: 600 }}>How this works.</strong>{" "}
        Your $10.50 follows what you do — what you cosign (60%), what you save (25%), and the active curators you've subscribed to (15%). Active curators are those who recommended at least once in the last 30 days. Unused tiers cascade at month end so nothing evaporates.
      </div>
    </div>
  );
}

function BlockHeader({ label, amount }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      borderTop: `1px solid ${T.bdr}`,
      paddingTop: 12,
      marginBottom: 4,
    }}>
      <span style={{
        fontFamily: F,
        fontSize: 10,
        letterSpacing: "0.08em",
        color: T.ink3,
        textTransform: "uppercase",
        fontWeight: 600,
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: SERIF_FAMILY,
        fontSize: 18,
        color: T.ink,
        fontWeight: 400,
      }}>
        {fmtDollar(amount)}
      </span>
    </div>
  );
}

function ActivityRow({ row }) {
  const signals = [];
  if (row.validations > 0) signals.push(`${row.validations} cosign${row.validations === 1 ? "" : "s"}`);
  if (row.saves > 0) signals.push(`${row.saves} save${row.saves === 1 ? "" : "s"}`);
  const summary = signals.join(" · ");

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 0",
    }}>
      <Avatar url={row.avatar_url} handle={row.handle} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: F,
          fontSize: 13,
          color: T.ink,
          fontWeight: 500,
        }}>
          @{row.handle}
        </div>
        <div style={{
          fontFamily: F,
          fontSize: 11,
          color: T.ink3,
          marginTop: 2,
        }}>
          {summary}
        </div>
      </div>
      <span style={{
        fontFamily: SERIF_FAMILY,
        fontSize: 16,
        color: T.acc,
        fontWeight: 400,
      }}>
        {fmtDollar(row.amount)}
      </span>
    </div>
  );
}

function FloorRow({ floor }) {
  const handles = floor.active_curator_handles;
  const handleList = handles.map(h => `@${h}`).join(", ");
  const count = handles.length;

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
      padding: "10px 0",
      marginBottom: 24,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: F,
          fontSize: 13,
          color: T.ink,
          fontWeight: 500,
        }}>
          Split across {count} active curator{count === 1 ? "" : "s"}
        </div>
        <div style={{
          fontFamily: F,
          fontSize: 11,
          color: T.ink2,
          marginTop: 2,
          lineHeight: 1.5,
        }}>
          {handleList}
        </div>
      </div>
      <span style={{
        fontFamily: SERIF_FAMILY,
        fontSize: 13,
        color: T.ink2,
        fontWeight: 400,
        whiteSpace: "nowrap",
      }}>
        {fmtDollar(floor.per_curator)} each
      </span>
    </div>
  );
}

function Avatar({ url, handle }) {
  const initial = (handle || "?").charAt(0).toUpperCase();
  if (url) {
    return (
      <img
        src={url}
        alt={handle}
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          objectFit: "cover",
          flexShrink: 0,
        }}
      />
    );
  }
  return (
    <div style={{
      width: 32,
      height: 32,
      borderRadius: 16,
      background: T.s2,
      color: T.ink2,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: F,
      fontSize: 13,
      fontWeight: 600,
      flexShrink: 0,
    }}>
      {initial}
    </div>
  );
}
