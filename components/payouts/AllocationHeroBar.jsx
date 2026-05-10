"use client";

import { T, F } from "@/lib/constants";

export default function AllocationHeroBar({ activity, floor, unallocated, total }) {
  const a = parseFloat(activity || "0");
  const f = parseFloat(floor || "0");
  const u = parseFloat(unallocated || "0");
  const t = parseFloat(total || "0") || (a + f + u);

  const aPct = t > 0 ? (a / t) * 100 : 0;
  const fPct = t > 0 ? (f / t) * 100 : 0;
  const uPct = t > 0 ? (u / t) * 100 : 0;

  return (
    <div data-mocked="true">
      {/* Stacked bar */}
      <div style={{
        display: "flex",
        height: 10,
        borderRadius: 5,
        overflow: "hidden",
        background: T.bdr,
        marginBottom: 12,
      }}>
        {aPct > 0 && (
          <div style={{ width: `${aPct}%`, background: T.acc }} />
        )}
        {fPct > 0 && (
          <div style={{ width: `${fPct}%`, background: T.ink3 }} />
        )}
        {uPct > 0 && (
          <div style={{ width: `${uPct}%`, background: T.bdr, opacity: 0.5 }} />
        )}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, fontFamily: F, fontSize: 11, color: T.ink2 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: T.acc, display: "inline-block" }} />
          Activity
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: T.ink3, display: "inline-block" }} />
          Floor
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: T.bdr, display: "inline-block", opacity: 0.5 }} />
          Unallocated
        </span>
      </div>
    </div>
  );
}
