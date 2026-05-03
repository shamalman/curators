'use client'

import { useState } from "react";
import { T, F } from "@/lib/constants";

export default function FeedActionButtons({ data, usedActions, onUse }) {
  const [tappedActions, setTappedActions] = useState(() => new Set());

  if (!data?.options || data.options.length === 0) return null;

  const isOptionUsed = (opt) =>
    (usedActions && usedActions.has(opt.action)) || tappedActions.has(opt.action);

  return (
    <div style={{ padding: "4px 0" }}>
      {data.prompt && (
        <div style={{ fontSize: 13, color: T.ink2, fontFamily: F, marginBottom: 8 }}>{data.prompt}</div>
      )}
      <div style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
      }}>
      {data.options.map((opt, i) => {
        const used = isOptionUsed(opt);
        return (
          <button
            key={i}
            disabled={used}
            onClick={() => {
              if (used) return;
              setTappedActions(prev => {
                const next = new Set(prev);
                next.add(opt.action);
                return next;
              });
              if (onUse) onUse(opt);
            }}
            style={{
              padding: "10px 18px",
              borderRadius: 22,
              fontSize: 13.5,
              fontWeight: 600,
              fontFamily: F,
              cursor: used ? "default" : "pointer",
              opacity: used ? 0.3 : 1,
              pointerEvents: used ? "none" : "auto",
              transition: "all .15s",
              ...(opt.style === "primary" ? {
                border: `1.5px solid ${T.acc}`,
                background: T.accSoft,
                color: T.acc,
              } : {
                border: `1px solid ${T.bdr}`,
                background: "transparent",
                color: T.ink2,
              }),
            }}
          >
            {opt.label}
          </button>
        );
      })}
      </div>
    </div>
  );
}
