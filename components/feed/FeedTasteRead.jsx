'use client'

import { T, F, CAT } from "@/lib/constants";

export default function FeedTasteRead({ data }) {
  if (!data) return null;

  const cat = CAT[data.category] || CAT.other;
  const color = cat.color;
  const emoji = cat.emoji;

  // Combine genres + moods as tags (genres first, then moods)
  const tags = [
    ...(Array.isArray(data.genres) ? data.genres : []),
    ...(Array.isArray(data.primary_moods) ? data.primary_moods : []),
  ];

  // Source + count label
  const sourceName = data.source?.name || data.source?.type || "";
  const countLabel = data.sample_size && data.total_items
    ? `${data.sample_size}/${data.total_items}`
    : data.sample_size
    ? `${data.sample_size}`
    : "";
  const sourceCountLabel = [sourceName, countLabel].filter(Boolean).join(" · ");

  return (
    <div style={{
      borderRadius: 14,
      border: `1px solid ${T.bdr}`,
      background: T.s,
      overflow: "hidden",
      marginBottom: 4,
    }}>
      {/* Color bar */}
      <div style={{
        height: 3,
        background: `linear-gradient(90deg, ${color}, ${color}80)`,
      }} />

      {/* Header */}
      <div style={{
        padding: "10px 16px",
        borderBottom: `1px solid ${color}15`,
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}>
        <span style={{ fontSize: 14 }}>{emoji}</span>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{
            fontFamily: F,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color,
          }}>
            READ
          </span>
          {data.duration_sec != null && (
            <span style={{
              fontFamily: F,
              fontSize: 10,
              color: T.ink3,
              marginTop: 1,
            }}>
              {data.duration_sec}s analysis
            </span>
          )}
        </div>
        {sourceCountLabel && (
          <span style={{
            fontFamily: F,
            fontSize: 11,
            color: T.ink3,
            marginLeft: "auto",
          }}>
            {sourceCountLabel}
          </span>
        )}
      </div>

      {/* Thesis */}
      {data.thesis && (
        <div style={{
          padding: "14px 16px 10px",
          fontFamily: F,
          fontSize: 14,
          color: T.ink,
          lineHeight: 1.55,
        }}>
          {data.thesis}
        </div>
      )}

      {/* Patterns */}
      {Array.isArray(data.patterns) && data.patterns.length > 0 && (
        <div style={{ padding: "0 16px 12px" }}>
          {data.patterns.map((p, i) => (
            <div key={i} style={{
              display: "flex",
              gap: 8,
              fontFamily: F,
              fontSize: 13.5,
              color: T.ink2,
              lineHeight: 1.45,
              marginBottom: i < data.patterns.length - 1 ? 4 : 0,
            }}>
              <span style={{
                color,
                fontWeight: 600,
                flexShrink: 0,
              }}>—</span>
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tags (genres + moods) */}
      {tags.length > 0 && (
        <div style={{
          padding: "0 16px 14px",
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
        }}>
          {tags.map((tag, i) => (
            <span key={i} style={{
              padding: "4px 11px",
              borderRadius: 14,
              fontFamily: F,
              fontSize: 12,
              fontWeight: 500,
              background: `${color}15`,
              color,
            }}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
