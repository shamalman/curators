'use client'

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import ArtifactImage from "./ArtifactImage";
import MediaEmbed from "./MediaEmbed";
import { supabase } from "@/lib/supabase";
import { T, F, S, MN, CAT, DEFAULT_TIERS, DEFAULT_BUNDLES, LICENSE_TYPES } from "@/lib/constants";
import { useCurator } from "@/context/CuratorContext";
import { fetchLinkMetadata } from "@/lib/links/fetchLinkMetadata";
import LinkDisplay from "@/components/shared/LinkDisplay";
import ValidationSheet from "@/components/payouts/ValidationSheet";
import { hasFeature } from "@/lib/features";

// Source types whose body_md is just metadata restated, not substantive prose.
// For these, the Archived Source section adds no information beyond what's
// already in the rec card, so we hide it.
const THIN_SOURCE_TYPES = new Set([
  "spotify",
  "apple-music",
  "youtube",
  "soundcloud",
  "letterboxd",
  "goodreads",
  "google-maps",
  "twitter",
]);

// Helper to auto-linkify URLs in text
function Linkify({ text, style }) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    urlRegex.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" style={{ ...style, color: "#6BAA8E", textDecoration: "underline" }}>{part}</a>
    ) : <span key={i}>{part}</span>
  );
}

function ArchivedSource({ body_md, slug, title, profileId, sourceType, lossy }) {
  const [open, setOpen] = useState(false);
  if (!body_md) return null;

  // Hide for lossy-backfilled recs — body_md is synthesized from title + category +
  // context + links (all already shown in the rec card), not real archived content.
  if (lossy) {
    return null;
  }

  // Hide for media embed source types — body_md is just restated metadata.
  if (sourceType && THIN_SOURCE_TYPES.has(String(sourceType).toLowerCase())) {
    return null;
  }

  const handleDownload = () => {
    const filename = (slug || title || 'rec').replace(/[^a-z0-9-]/gi, '-') + '.md';
    const blob = new Blob([body_md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ marginTop: 20, marginBottom: 16 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "12px 16px", background: T.s, border: `1px solid ${T.bdr}`,
          borderRadius: open ? "12px 12px 0 0" : 12, cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", fontFamily: F }}>
          Archived Source
        </span>
        <span style={{ fontSize: 11, color: T.ink3 }}>{open ? "\u25B2" : "\u25BC"}</span>
      </button>
      {open && (
        <div style={{
          border: `1px solid ${T.bdr}`, borderTop: "none",
          borderRadius: "0 0 12px 12px", background: T.s,
        }}>
          <div style={{
            maxHeight: 400, overflowY: "auto", padding: "12px 16px",
            fontFamily: F, fontSize: 14, color: T.ink, lineHeight: 1.55,
          }}>
            <ReactMarkdown
              urlTransform={(url) => {
                // Allow artifact:// URLs through to the custom img renderer.
                if (url && url.startsWith("artifact://")) return url;
                // Default sanitization for everything else (block javascript:, data:, etc).
                return defaultUrlTransform(url);
              }}
              components={{
                img: ({ src, alt }) => <ArtifactImage src={src} alt={alt} profileId={profileId} />,
              }}
            >{body_md}</ReactMarkdown>
          </div>
          <div style={{ padding: "8px 16px 12px", borderTop: `1px solid ${T.bdr}` }}>
            <button
              onClick={handleDownload}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8, border: `1px solid ${T.bdr}`,
                background: T.bg, color: T.ink2, fontSize: 11, fontWeight: 600,
                cursor: "pointer", fontFamily: F,
              }}
            >
              Download .md
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const fmtDateFull = (d) => {
  if (!d) return "";
  // Accept either YYYY-MM-DD (10 chars — append T00:00:00 for local tz)
  // or a full ISO timestamp already (pass through directly).
  const dateStr = typeof d === "string" && d.length === 10 ? d + "T00:00:00" : d;
  const parsed = new Date(dateStr);
  if (isNaN(parsed)) return "";
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function formatValidatedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ── Curator Item Detail ── */
export function CuratorRecDetail({ slug }) {
  const router = useRouter();
  const { profile, tasteItems, updateRec, archived, removeItem, restoreItem, toggleVisibility } = useCurator();

  const selectedItem = tasteItems.find(i => i.slug === slug || i.id === slug);

  // Local state for editing
  const [editingItem, setEditingItem] = useState(null);
  const [editVisibility, setEditVisibility] = useState("public");
  const [itemCopied, setItemCopied] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const commitTag = (raw) => {
    const cleaned = (raw || "").replace(/,/g, "").trim();
    if (!cleaned) return;
    setEditingItem(p => {
      if (!p) return p;
      if ((p.tags || []).includes(cleaned)) return p;
      return { ...p, tags: [...(p.tags || []), cleaned] };
    });
    setTagInput("");
  };

  const handleTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "") {
      setEditingItem(p => p ? { ...p, tags: (p.tags || []).slice(0, -1) } : p);
    }
  };

  const removeTag = (idx) => {
    setEditingItem(p => p ? { ...p, tags: (p.tags || []).filter((_, i) => i !== idx) } : p);
  };

  // Local earnings config (defaults)
  const [itemSubOnly, setItemSubOnly] = useState({ 10: true, 5: true });
  const [itemTiers, setItemTiers] = useState({ 10: ["plus", "pro"], 5: ["pro"] });
  const [itemInBundle, setItemInBundle] = useState({ 1: true, 3: true, 6: true });
  const [itemBundles, setItemBundles] = useState({ 1: ["b1"], 3: ["b1"], 6: ["b1"] });
  const [itemLicensable, setItemLicensable] = useState({ 2: true, 3: true, 11: true });
  const [itemLicense, setItemLicense] = useState({ 2: { types: ["digital", "social"], floor: 150 }, 3: { types: ["social"], floor: 250 }, 11: { types: ["digital"], floor: 100 } });
  const [itemTipEnabled, setItemTipEnabled] = useState({ 1: true, 2: true, 4: true });
  const [itemTipConfig, setItemTipConfig] = useState({ 1: { suggested: 5, min: 1, max: 100 }, 2: { suggested: 3, min: 1, max: 50 }, 4: { suggested: 3, min: 1, max: 100 } });
  const [bundles, setBundles] = useState(DEFAULT_BUNDLES);
  const [newBundleName, setNewBundleName] = useState("");

  if (!selectedItem) return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <div style={{ fontSize: 28, opacity: 0.3 }}>🔍</div>
      <div style={{ fontFamily: F, fontSize: 15, color: T.ink3 }}>Rec not found</div>
      <button onClick={() => router.back()} style={{ background: "none", border: "none", color: T.acc, fontSize: 14, fontFamily: F, fontWeight: 600, cursor: "pointer" }}>← Go back</button>
    </div>
  );

  const c = CAT[selectedItem.category] || CAT.other;
  const isPublic = selectedItem.visibility === "public";
  const itemSlug = selectedItem.slug || selectedItem.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const url = `https://curators.ai/${profile.handle.replace("@", "")}/${itemSlug}`;
  const isSubOnly = !!itemSubOnly[selectedItem.id];
  const isInBundle = !!itemInBundle[selectedItem.id];
  const isLicensable = !!itemLicensable[selectedItem.id];
  const isTipEnabled = !!itemTipEnabled[selectedItem.id];
  const tipConf = itemTipConfig[selectedItem.id] || { suggested: 5, min: 1, max: 100 };
  const tiers = itemTiers[selectedItem.id] || [];
  const bndls = itemBundles[selectedItem.id] || [];
  const lic = itemLicense[selectedItem.id] || { types: [], floor: 100 };
  const hasAnyEarning = isSubOnly || isInBundle || isLicensable || isTipEnabled;
  const isEditing = !!editingItem;

  const saveItemEdit = async () => {
    if (!editingItem) return;
    const newRev = (selectedItem.revision || 1) + 1;
    const newRevisions = [
      { rev: newRev, date: new Date().toISOString().split("T")[0], change: "Updated context and tags" },
      ...(selectedItem.revisions || []),
    ];
    const updated = { ...selectedItem, title: editingItem.title, context: editingItem.context, tags: editingItem.tags, category: editingItem.category, links: editingItem.links || [], visibility: editVisibility, revision: newRev, revisions: newRevisions };
    setEditingItem(null);
    await updateRec(updated);
  };

  const copyLink = (s) => {
    const copyUrl = `https://curators.ai/${profile.handle.replace("@", "")}/${s}`;
    if (navigator.clipboard) navigator.clipboard.writeText(copyUrl);
    setItemCopied(true);
    setTimeout(() => setItemCopied(false), 2000);
  };

  const toggleItemTier = (id, tierId) => {
    setItemTiers(prev => {
      const current = prev[id] || [];
      return { ...prev, [id]: current.includes(tierId) ? current.filter(t => t !== tierId) : [...current, tierId] };
    });
  };

  const toggleItemBundle = (id, bundleId) => {
    setItemBundles(prev => {
      const current = prev[id] || [];
      return { ...prev, [id]: current.includes(bundleId) ? current.filter(b => b !== bundleId) : [...current, bundleId] };
    });
  };

  const addBundle = () => {
    if (!newBundleName.trim()) return;
    const id = "b" + Date.now();
    setBundles(prev => [...prev, { id, name: newBundleName.trim(), count: 0, price: 0 }]);
    setNewBundleName("");
  };

  const toggleLicenseType = (id, typeId) => {
    setItemLicense(prev => {
      const current = prev[id] || { types: [], floor: 100 };
      const types = current.types.includes(typeId) ? current.types.filter(t => t !== typeId) : [...current.types, typeId];
      return { ...prev, [id]: { ...current, types } };
    });
  };

  const setLicenseFloor = (id, floor) => {
    setItemLicense(prev => {
      const current = prev[id] || { types: [], floor: 100 };
      return { ...prev, [id]: { ...current, floor: parseInt(floor) || 0 } };
    });
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div style={{ maxWidth: 700, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
      <div style={{ padding: "52px 20px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <button onClick={() => router.back()} style={{
          background: "none", border: "none", cursor: "pointer", padding: 0,
          display: "flex", alignItems: "center",
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        {!isEditing && (
          <button onClick={() => { setEditingItem({ title: selectedItem.title, context: selectedItem.context, tags: [...(selectedItem.tags || [])], category: selectedItem.category, links: [...(selectedItem.links || [])] }); setEditVisibility(selectedItem.visibility || "public"); }} style={{
            background: T.s, border: "1px solid " + T.bdr, borderRadius: 10, padding: "6px 14px",
            cursor: "pointer", fontFamily: F, fontSize: 12, fontWeight: 600, color: T.ink2,
          }}>Edit</button>
        )}
        {isEditing && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setEditingItem(null)} style={{ background: "none", border: "1px solid " + T.bdr, borderRadius: 10, padding: "6px 14px", cursor: "pointer", fontFamily: F, fontSize: 12, fontWeight: 600, color: T.ink3 }}>Cancel</button>
            <button onClick={saveItemEdit} style={{ background: T.acc, border: "none", borderRadius: 10, padding: "6px 14px", cursor: "pointer", fontFamily: F, fontSize: 12, fontWeight: 700, color: T.accText }}>Save</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 20px 40px", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", minHeight: 0 }}>
        <div className="fu">

          {/* Category + visibility badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: c.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{c.emoji}</div>
            <span style={{ fontSize: 12, fontWeight: 600, color: c.color, fontFamily: F }}>{c.label}</span>
            <span style={{ fontSize: 10, fontWeight: 600, color: isPublic ? "#6BAA8E" : T.ink3, background: isPublic ? "#6BAA8E15" : T.s2, padding: "3px 10px", borderRadius: 6, fontFamily: F }}>
              {isPublic ? "\u25CF Public" : "\u25CB Private"}
            </span>
            <span style={{ fontSize: 10, color: T.ink3, fontFamily: MN }}>rev {selectedItem.revision || 1}</span>
          </div>

          {/* Title */}
          {isEditing ? (
            <input value={editingItem.title} onChange={e => setEditingItem(p => ({ ...p, title: e.target.value }))}
              style={{ fontFamily: S, fontSize: 28, color: T.ink, fontWeight: 400, lineHeight: 1.2, marginBottom: 6, width: "100%", background: T.s, border: `1.5px solid ${T.bdr}`, borderRadius: 10, padding: "10px 14px", outline: "none" }}
            />
          ) : (
            <h1 style={{ fontFamily: S, fontSize: 28, color: T.ink, fontWeight: 400, lineHeight: 1.2, marginBottom: 6 }}>{selectedItem.title}</h1>
          )}

          {/* Date + URL */}
          <div style={{ fontSize: 12, color: T.ink3, fontFamily: F, marginBottom: 6 }}>Added {fmtDateFull(selectedItem.date)}</div>
          <button onClick={() => copyLink(slug)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
            background: T.s, border: "1px solid " + T.bdr, cursor: "pointer", marginBottom: 20,
          }}>
            <span style={{ fontSize: 11, color: T.ink3, fontFamily: MN }}>{url}</span>
            <span style={{ fontSize: 10, color: itemCopied ? "#6BAA8E" : T.acc, fontFamily: F, fontWeight: 600 }}>{itemCopied ? "\u2713 Copied" : "Copy"}</span>
          </button>

          {/* Your take */}
          <div style={{ padding: "16px 18px", background: T.s, borderRadius: 14, border: "1px solid " + T.bdr, marginBottom: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, fontFamily: F }}>Your take</div>
            {isEditing ? (
              <textarea value={editingItem.context} onChange={e => setEditingItem(p => ({ ...p, context: e.target.value }))} rows={3}
                style={{ fontFamily: F, fontSize: 15, lineHeight: 1.6, color: T.ink, width: "100%", background: T.bg, border: `1.5px solid ${T.bdr}`, borderRadius: 10, padding: "10px 14px", outline: "none", resize: "none" }}
              />
            ) : (
              <p style={{ fontFamily: F, fontSize: 15, lineHeight: 1.6, color: T.ink, whiteSpace: "pre-line" }}><Linkify text={selectedItem.context} style={{ fontFamily: F, fontSize: 15 }} /></p>
            )}
          </div>

          {!isEditing && (
            <MediaEmbed
              extractor={selectedItem.extraction?.extractor}
              sourceUrl={selectedItem.links?.[0]?.url || selectedItem.source_block?.url}
            />
          )}

          {/* Links */}
          {!isEditing && selectedItem.links?.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10, fontFamily: F }}>Links</div>
              <LinkDisplay links={selectedItem.links} />
            </div>
          )}

          <ArchivedSource body_md={selectedItem.body_md} slug={selectedItem.slug} title={selectedItem.title} profileId={selectedItem.profile_id} sourceType={selectedItem.extraction?.extractor?.split("@")[0]} lossy={selectedItem.extraction?.lossy} />

          {/* Tags */}
          {!isEditing && selectedItem.tags?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
              {selectedItem.tags.map(tag => <span key={tag} style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, background: T.s, color: T.ink2, border: "1px solid " + T.bdr, fontFamily: F }}>{tag}</span>)}
            </div>
          )}
          {isEditing && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, fontFamily: F }}>Category</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["watch", "listen", "read", "visit", "get", "wear", "play", "other"].map(cat => (
                  <button key={cat} onClick={() => setEditingItem(p => ({ ...p, category: cat }))}
                    style={{
                      padding: "8px 14px", borderRadius: 10, border: editingItem.category === cat ? "none" : "1px solid " + T.bdr,
                      background: editingItem.category === cat ? T.acc : T.s, color: editingItem.category === cat ? "#fff" : T.ink2,
                      fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: F, textTransform: "capitalize"
                    }}>{cat}</button>
                ))}
              </div>
            </div>
          )}
          {isEditing && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 12, background: T.s, border: `1px solid ${T.bdr}`, marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>{editVisibility === "public" ? "Public" : "Private"}</div>
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>{editVisibility === "public" ? "Shared with your subscribers and visitors" : "Only you and your AI can see this"}</div>
              </div>
              <button onClick={() => setEditVisibility(v => v === "public" ? "private" : "public")} style={{
                width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                background: editVisibility === "public" ? "#6BAA8E" : T.bdr, transition: "background .2s",
              }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: editVisibility === "public" ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </button>
            </div>
          )}
          {isEditing && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, fontFamily: F }}>Tags</div>
              {editingItem.tags?.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  {editingItem.tags.map((tag, i) => (
                    <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 12px", borderRadius: 8, fontSize: 12, background: T.s, color: T.ink2, border: "1px solid " + T.bdr, fontFamily: F }}>
                      {tag}
                      <button type="button" onClick={() => removeTag(i)} style={{ background: "none", border: "none", color: T.ink3, cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <input value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => commitTag(tagInput)}
                placeholder="Type a tag, press enter or comma"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${T.bdr}`, fontSize: 13, fontFamily: F, outline: "none", background: T.s, color: T.ink }}
              />
            </div>
          )}
          {isEditing && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, fontFamily: F }}>Links</div>
              {editingItem.links?.map((link, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                  <input value={link.url} onChange={e => {
                    const newLinks = [...editingItem.links];
                    newLinks[i] = { ...newLinks[i], url: e.target.value };
                    setEditingItem(p => ({ ...p, links: newLinks }));
                  }}
                    placeholder="URL"
                    style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1.5px solid " + T.bdr, fontSize: 13, fontFamily: F, outline: "none", background: T.s, color: T.ink }}
                  />
                  <button onClick={() => {
                    const newLinks = editingItem.links.filter((_, idx) => idx !== i);
                    setEditingItem(p => ({ ...p, links: newLinks }));
                  }} style={{
                    padding: "10px 12px", borderRadius: 10, border: "1px solid " + T.bdr,
                    background: T.s, color: T.ink3, fontSize: 12, cursor: "pointer", fontFamily: F
                  }}>{"\u2715"}</button>
                </div>
              ))}
              <button onClick={async () => {
                const url = prompt("Paste a link:");
                if (!url) return;
                try {
                  const meta = await fetchLinkMetadata(url, profile?.id);
                  const type = meta?.type || "website";
                  const label = meta?.title || url;
                  setEditingItem(p => ({ ...p, links: [...(p.links || []), { type, url, label }] }));
                } catch (e) {
                  const newLink = { type: "website", url, label: url };
                  setEditingItem(p => ({ ...p, links: [...(p.links || []), newLink] }));
                }
              }} style={{
                padding: "10px 14px", borderRadius: 10, border: "1.5px dashed " + T.bdr,
                background: "transparent", color: T.ink2, fontSize: 13, cursor: "pointer", fontFamily: F,
                width: "100%", textAlign: "center"
              }}>+ Add link</button>
            </div>
          )}
          {isEditing && (
            <div style={{ marginTop: 12 }}>
              {!!archived[selectedItem.id] ? (
                <button onClick={() => restoreItem(selectedItem.id)} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "1px solid #6BAA8E30", background: "#6BAA8E10", color: "#6BAA8E", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Restore to taste</button>
              ) : (
                <button onClick={() => removeItem(selectedItem.id)} style={{ width: "100%", padding: "14px", borderRadius: 14, border: "1px solid #EF444430", background: "none", color: "#EF4444", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: F }}>Delete Recommendation</button>
              )}
            </div>
          )}

          {/* Settings section */}
          {!isEditing && (
            <>
              {/* TODO: Unhide when earnings features are real */}
              {false && <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", fontFamily: F }}>Earnings</div>
                {hasAnyEarning && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#6BAA8E", fontFamily: F, background: "#6BAA8E15", padding: "3px 10px", borderRadius: 6 }}>
                    {[isSubOnly && "Subscriber", isInBundle && "Bundle", isLicensable && "License", isTipEnabled && "Tips"].filter(Boolean).join(" \u00B7 ")}
                  </span>
                )}
              </div>

              {/* Tips & Donations */}
              <div style={{ background: T.s, borderRadius: 14, border: `1px solid ${isTipEnabled ? "#6BAA8E40" : T.bdr}`, marginBottom: 10, overflow: "hidden", transition: "border-color .2s" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>Tips & Donations</div>
                    <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 2 }}>Let people express their gratitude</div>
                  </div>
                  <button onClick={() => setItemTipEnabled(p => ({ ...p, [selectedItem.id]: !p[selectedItem.id] }))} style={{
                    width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                    background: isTipEnabled ? "#6BAA8E" : T.bdr, transition: "background .2s",
                  }}>
                    <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: isTipEnabled ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </button>
                </div>
                {isTipEnabled && (
                  <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.bdr}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12, marginTop: 12, fontFamily: F }}>
                      Suggested tip
                    </div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                      {[1, 3, 5, 10, 25].map(amt => (
                        <button key={amt} onClick={() => setItemTipConfig(p => ({ ...p, [selectedItem.id]: { ...(p[selectedItem.id] || tipConf), suggested: amt } }))} style={{
                          flex: 1, padding: "10px 0", borderRadius: 10, textAlign: "center",
                          border: tipConf.suggested === amt ? `2px solid #6BAA8E` : `1.5px solid ${T.bdr}`,
                          background: tipConf.suggested === amt ? "#6BAA8E15" : T.bg,
                          color: tipConf.suggested === amt ? "#6BAA8E" : T.ink2,
                          fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: MN,
                        }}>
                          {"$"}{amt}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: T.ink3, fontFamily: F, textTransform: "uppercase", letterSpacing: ".06em" }}>Range</span>
                      <span style={{ fontSize: 12, color: T.ink2, fontFamily: MN }}>{"$"}{tipConf.min} – {"$"}{tipConf.max}</span>
                    </div>
                    <div style={{ position: "relative", height: 32, marginBottom: 8 }}>
                      <div style={{ position: "absolute", top: 14, left: 0, right: 0, height: 4, borderRadius: 2, background: T.bdr }} />
                      <div style={{
                        position: "absolute", top: 14, height: 4, borderRadius: 2, background: "#6BAA8E",
                        left: `${(tipConf.min / 100) * 100}%`, right: `${100 - (tipConf.max / 100) * 100}%`,
                      }} />
                      <input type="range" min="1" max="100" value={tipConf.max}
                        onChange={e => setItemTipConfig(p => ({ ...p, [selectedItem.id]: { ...(p[selectedItem.id] || tipConf), max: parseInt(e.target.value) } }))}
                        style={{ position: "absolute", top: 4, width: "100%", opacity: 0, cursor: "pointer", height: 24 }}
                      />
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, marginTop: 14, fontFamily: F }}>
                      Accept via
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <div style={{ flex: 1, padding: "10px 12px", borderRadius: 10, background: T.acc + "12", border: `1px solid ${T.acc}40`, display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14 }}>💳</span>
                        <span style={{ fontFamily: F, fontSize: 12, fontWeight: 600, color: T.ink }}>Card</span>
                      </div>
                      {profile.cryptoEnabled && (
                        <div style={{ flex: 1, padding: "10px 12px", borderRadius: 10, background: "#6B9EC212", border: `1px solid #6B9EC240`, display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 14 }}>⛓</span>
                          <span style={{ fontFamily: F, fontSize: 12, fontWeight: 600, color: T.ink }}>Crypto</span>
                        </div>
                      )}
                    </div>
                    {!profile.cryptoEnabled && (
                      <p style={{ fontSize: 10, color: T.ink3, fontFamily: F, marginTop: 8 }}>Enable crypto in Profile → Edit to accept crypto tips</p>
                    )}
                  </div>
                )}
              </div>

              {/* Subscriber Only */}
              <div style={{ background: T.s, borderRadius: 14, border: `1px solid ${isSubOnly ? "#6BAA8E40" : T.bdr}`, marginBottom: 10, overflow: "hidden", transition: "border-color .2s" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>Subscriber Only</div>
                    <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 2 }}>Restrict to specific tiers</div>
                  </div>
                  <button onClick={() => setItemSubOnly(p => ({ ...p, [selectedItem.id]: !p[selectedItem.id] }))} style={{
                    width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                    background: isSubOnly ? "#6BAA8E" : T.bdr, transition: "background .2s",
                  }}>
                    <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: isSubOnly ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </button>
                </div>
                {isSubOnly && (
                  <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.bdr}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10, marginTop: 12, fontFamily: F }}>
                      Which tiers can see this?
                    </div>
                    {DEFAULT_TIERS.map(tier => {
                      const checked = tiers.includes(tier.id);
                      return (
                        <button key={tier.id} onClick={() => toggleItemTier(selectedItem.id, tier.id)} style={{
                          display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px",
                          background: checked ? `${tier.color}12` : T.bg, borderRadius: 10, border: `1px solid ${checked ? tier.color + "40" : T.bdr}`,
                          cursor: "pointer", marginBottom: 6, textAlign: "left",
                        }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? tier.color : T.ink3}`,
                            background: checked ? tier.color : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            {checked && <span style={{ color: "#fff", fontSize: 11, fontWeight: 700 }}>✓</span>}
                          </div>
                          <span style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: T.ink }}>{tier.name}</span>
                          <span style={{ fontFamily: MN, fontSize: 11, color: T.ink3, marginLeft: "auto" }}>{tier.price > 0 ? `$${tier.price}/mo` : "Free"}</span>
                        </button>
                      );
                    })}
                    {tiers.length === 0 && <div style={{ fontSize: 11, color: T.acc, fontFamily: F, marginTop: 2 }}>Select at least one tier</div>}
                    <p style={{ fontSize: 10, color: T.ink3, fontFamily: F, marginTop: 6 }}>Manage tiers in Profile → Edit</p>
                  </div>
                )}
              </div>

              {/* Bundle */}
              <div style={{ background: T.s, borderRadius: 14, border: `1px solid ${isInBundle ? "#6BAA8E40" : T.bdr}`, marginBottom: 10, overflow: "hidden", transition: "border-color .2s" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>Bundle</div>
                    <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 2 }}>Add to a sellable recommendation pack</div>
                  </div>
                  <button onClick={() => setItemInBundle(p => ({ ...p, [selectedItem.id]: !p[selectedItem.id] }))} style={{
                    width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                    background: isInBundle ? "#6BAA8E" : T.bdr, transition: "background .2s",
                  }}>
                    <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: isInBundle ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </button>
                </div>
                {isInBundle && (
                  <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.bdr}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10, marginTop: 12, fontFamily: F }}>
                      Add to bundles
                    </div>
                    {bundles.map(bundle => {
                      const inBundle = bndls.includes(bundle.id);
                      return (
                        <button key={bundle.id} onClick={() => toggleItemBundle(selectedItem.id, bundle.id)} style={{
                          display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px",
                          background: inBundle ? T.acc + "12" : T.bg, borderRadius: 10,
                          border: `1px solid ${inBundle ? T.acc + "40" : T.bdr}`,
                          cursor: "pointer", marginBottom: 6, textAlign: "left",
                        }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: 4, border: `2px solid ${inBundle ? T.acc : T.ink3}`,
                            background: inBundle ? T.acc : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            {inBundle && <span style={{ color: T.accText, fontSize: 11, fontWeight: 700 }}>✓</span>}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: T.ink }}>{bundle.name}</div>
                            <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 1 }}>{bundle.count} recs{bundle.price > 0 ? ` · $${bundle.price}` : ""}</div>
                          </div>
                        </button>
                      );
                    })}
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <input value={newBundleName} onChange={e => setNewBundleName(e.target.value)}
                        placeholder="New bundle name..." onKeyDown={e => e.key === "Enter" && addBundle()}
                        style={{ flex: 1, padding: "9px 12px", borderRadius: 8, border: `1.5px solid ${T.bdr}`, fontSize: 12, fontFamily: F, outline: "none", background: T.bg, color: T.ink }}
                      />
                      <button onClick={addBundle} style={{
                        padding: "9px 14px", borderRadius: 8, border: "none",
                        background: newBundleName.trim() ? T.acc : T.bdr, color: newBundleName.trim() ? T.accText : T.ink3,
                        fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: F, whiteSpace: "nowrap",
                      }}>+ Create</button>
                    </div>
                    <p style={{ fontSize: 10, color: T.ink3, fontFamily: F, marginTop: 6 }}>Manage bundles in Taste → Bundles</p>
                  </div>
                )}
              </div>

              {/* License */}
              <div style={{ background: T.s, borderRadius: 14, border: `1px solid ${isLicensable ? "#6BAA8E40" : T.bdr}`, marginBottom: 16, overflow: "hidden", transition: "border-color .2s" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>License</div>
                    <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 2 }}>Allow brands to license this rec</div>
                  </div>
                  <button onClick={() => setItemLicensable(p => ({ ...p, [selectedItem.id]: !p[selectedItem.id] }))} style={{
                    width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                    background: isLicensable ? "#6BAA8E" : T.bdr, transition: "background .2s",
                  }}>
                    <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: isLicensable ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                  </button>
                </div>
                {isLicensable && (
                  <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.bdr}` }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10, marginTop: 12, fontFamily: F }}>
                      Usage rights
                    </div>
                    {LICENSE_TYPES.map(type => {
                      const checked = lic.types.includes(type.id);
                      return (
                        <button key={type.id} onClick={() => toggleLicenseType(selectedItem.id, type.id)} style={{
                          display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px",
                          background: checked ? T.acc + "12" : T.bg, borderRadius: 10,
                          border: `1px solid ${checked ? T.acc + "40" : T.bdr}`,
                          cursor: "pointer", marginBottom: 6, textAlign: "left",
                        }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: 4, border: `2px solid ${checked ? T.acc : T.ink3}`,
                            background: checked ? T.acc : "transparent",
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            {checked && <span style={{ color: T.accText, fontSize: 11, fontWeight: 700 }}>✓</span>}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: T.ink }}>{type.label}</div>
                            <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 1 }}>{type.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, marginTop: 14, fontFamily: F }}>
                      Minimum price
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: F, fontSize: 16, color: T.ink2, fontWeight: 600 }}>$</span>
                      <input value={lic.floor} onChange={e => setLicenseFloor(selectedItem.id, e.target.value)}
                        type="number" min="0" step="50"
                        style={{ width: 100, padding: "10px 12px", borderRadius: 8, border: `1.5px solid ${T.bdr}`, fontSize: 14, fontFamily: MN, outline: "none", background: T.bg, color: T.ink, textAlign: "right" }}
                      />
                      <span style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>per use</span>
                    </div>
                    <p style={{ fontSize: 10, color: T.ink3, fontFamily: F, marginTop: 8, lineHeight: 1.5 }}>
                      Brands request through your profile. Review in Lens → Requests.
                    </p>
                  </div>
                )}
              </div>

              {/* On-chain rec / wallet */}
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10, fontFamily: F }}>On-chain</div>
              <div style={{
                background: T.s, borderRadius: 14, border: "1px solid " + T.bdr,
                marginBottom: 16, overflow: "hidden",
              }}>
                <div style={{ padding: "16px", display: "flex", alignItems: "center", gap: 12, borderBottom: profile.cryptoEnabled ? `1px solid ${T.bdr}` : "none" }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "#6B9EC215", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 16 }}>⛓</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontFamily: F, fontSize: 13, fontWeight: 600, color: T.ink }}>Proof of Taste</div>
                    <div style={{ fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 1 }}>
                      This rec will be timestamped on-chain
                    </div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#6B9EC2", fontFamily: MN, background: "#6B9EC215", padding: "3px 8px", borderRadius: 6 }}>Soon</span>
                </div>
                {profile.cryptoEnabled && (
                  <div style={{ padding: "12px 16px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Wallet receiving address</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: T.bg, borderRadius: 8, border: "1px solid " + T.bdr }}>
                      <span style={{ fontSize: 12, color: T.ink2, fontFamily: MN, flex: 1 }}>{profile.wallet}</span>
                      <span style={{ fontSize: 10, color: T.ink3, fontFamily: F }}>From profile</span>
                    </div>
                    <p style={{ fontSize: 10, color: T.ink3, fontFamily: F, marginTop: 6 }}>
                      Tips, licensing payments, and donations route to this wallet. Change in Profile → Edit.
                    </p>
                  </div>
                )}
              </div>
              </>}

              {/* Version history */}
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10, fontFamily: F }}>Version History</div>
              <div style={{ background: T.s, borderRadius: 14, border: "1px solid " + T.bdr, overflow: "hidden", marginBottom: 20 }}>
                <button onClick={() => setShowHistory(!showHistory)} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
                  padding: "13px 16px", background: "transparent", border: "none", cursor: "pointer",
                }}>
                  <span style={{ fontFamily: F, fontSize: 13, fontWeight: 500, color: T.ink }}>
                    {selectedItem.revision || 1} revision{(selectedItem.revision || 1) !== 1 ? "s" : ""}
                  </span>
                  <span style={{ fontSize: 12, color: T.ink3, transform: showHistory ? "rotate(180deg)" : "rotate(0)", transition: "transform .2s" }}>▾</span>
                </button>
                {showHistory && selectedItem.revisions?.map((rev, i) => (
                  <div key={rev.rev} style={{
                    display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 16px",
                    borderTop: `1px solid ${T.bdr}`,
                  }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, paddingTop: 2 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 4, background: i === 0 ? T.acc : T.ink3 }} />
                      {i < selectedItem.revisions.length - 1 && <div style={{ width: 1, height: 24, background: T.bdr, marginTop: 2 }} />}
                    </div>
                    <div>
                      <div style={{ fontFamily: F, fontSize: 12, fontWeight: 600, color: i === 0 ? T.ink : T.ink2 }}>
                        v{rev.rev} — {rev.change}
                      </div>
                      <div style={{ fontFamily: MN, fontSize: 10, color: T.ink3, marginTop: 2 }}>{fmtDateFull(rev.date)}</div>
                    </div>
                  </div>
                ))}
              </div>

            </>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}

/* ── Visitor Item Detail ── */
export function VisitorRecDetail({ slug }) {
  const router = useRouter();
  const { profile, tasteItems } = useCurator();

  const selectedItem = tasteItems.find(i => i.slug === slug);

  const [linkCopied, setLinkCopied] = useState(false);
  const [tipExpanded, setTipExpanded] = useState(false);
  const [tipAmount, setTipAmount] = useState(null);
  const [tipSent, setTipSent] = useState(false);
  const [tipMessage, setTipMessage] = useState("");
  const [showValidationSheet, setShowValidationSheet] = useState(false);
  const [viewerProfile, setViewerProfile] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(true);
  const [existingValidation, setExistingValidation] = useState(null);
  const [validationFetched, setValidationFetched] = useState(false);
  const [showValidatedModal, setShowValidatedModal] = useState(false);
  const [existingThreadId, setExistingThreadId] = useState(null);
  const [showRetractConfirm, setShowRetractConfirm] = useState(false);
  const [retracting, setRetracting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (cancelled) return;
        if (!user) {
          setViewerProfile(null);
          setViewerLoading(false);
          return;
        }
        const { data } = await supabase
          .from('profiles')
          .select('id, handle, is_tester, feature_flags')
          .eq('auth_user_id', user.id)
          .single();
        if (!cancelled) {
          setViewerProfile(data || null);
          setViewerLoading(false);
        }
      } catch {
        if (!cancelled) {
          setViewerProfile(null);
          setViewerLoading(false);
        }
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!viewerProfile?.id || !selectedItem?.id) {
      setValidationFetched(true);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('validations')
          .select('id, verbatim_text, created_at, retracted_at')
          .eq('subscriber_id', viewerProfile.id)
          .eq('rec_id', selectedItem.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.error('[VALIDATION_VISITOR_FETCH_ERROR]', error.message);
          setExistingValidation(null);
        } else {
          setExistingValidation(data || null);
          if (data && selectedItem?.profile_id) {
            const { data: threadRow } = await supabase
              .from('threads')
              .select('id')
              .or(`and(subscriber_id.eq.${viewerProfile.id},curator_id.eq.${selectedItem.profile_id}),and(curator_id.eq.${viewerProfile.id},subscriber_id.eq.${selectedItem.profile_id})`)
              .maybeSingle();
            if (!cancelled && threadRow) setExistingThreadId(threadRow.id);
          }
        }
        setValidationFetched(true);
      } catch (e) {
        if (!cancelled) {
          console.error('[VALIDATION_VISITOR_FETCH_ERROR]', e?.message);
          setValidationFetched(true);
        }
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [viewerProfile?.id, selectedItem?.id]);

  async function handleVisitorRetract() {
    if (!existingValidation?.id || retracting) return;
    setRetracting(true);
    try {
      const res = await fetch(`/api/validations/${existingValidation.id}/retract`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setExistingValidation((prev) => prev ? { ...prev, retracted_at: data.retracted_at } : prev);
        setShowRetractConfirm(false);
      } else {
        console.error("[VALIDATION_RETRACT_FAILED]", data);
      }
    } catch (e) {
      console.error("[VALIDATION_RETRACT_ERROR]", e);
    } finally {
      setRetracting(false);
    }
  }

  // Local earnings config defaults (mock data)
  const [itemLicensable] = useState({ 2: true, 3: true, 11: true });
  const [itemLicense] = useState({ 2: { types: ["digital", "social"], floor: 150 }, 3: { types: ["social"], floor: 250 }, 11: { types: ["digital"], floor: 100 } });
  const [itemTipEnabled] = useState({ 1: true, 2: true, 4: true });
  const [itemTipConfig] = useState({ 1: { suggested: 5, min: 1, max: 100 }, 2: { suggested: 3, min: 1, max: 50 }, 4: { suggested: 3, min: 1, max: 100 } });
  const [itemBundlesMap] = useState({ 1: ["b1"], 3: ["b1"], 6: ["b1"] });
  const [bundles] = useState(DEFAULT_BUNDLES);

  if (!selectedItem || !profile) return null;

  const c = CAT[selectedItem.category] || CAT.other;
  const itemSlug = selectedItem.slug || selectedItem.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const url = `https://curators.ai/${profile.handle.replace("@", "")}/${itemSlug}`;

  const isViewerOwner = viewerProfile?.id === profile?.id;
  const canShowValidate = !viewerLoading && !isViewerOwner;

  const handleValidateTap = async () => {
    // Force-refresh auth state to ensure session is propagated to Supabase REST layer
    const { data: { user: liveUser } } = await supabase.auth.getUser();

    if (!liveUser) {
      const redirect = encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname : '/');
      window.location.href = `/login?redirect=${redirect}`;
      return;
    }

    // Re-resolve viewer profile in case the deferred fetch hasn't completed
    let resolvedViewer = viewerProfile;
    if (!resolvedViewer) {
      const { data } = await supabase
        .from('profiles')
        .select('id, handle, is_tester, feature_flags')
        .eq('auth_user_id', liveUser.id)
        .single();
      resolvedViewer = data || null;
    }

    if (!resolvedViewer) {
      alert('Could not load your profile. Reload the page and try again.');
      return;
    }

    // Resolve curator id from the rec itself (profile.id is not set on visitor profile object)
    const curatorId = selectedItem?.profile_id;
    if (!curatorId) {
      console.error('[VALIDATION_VISITOR_NO_CURATOR_ID]', { selectedItem });
      alert('Could not identify the curator for this rec. Reload the page and try again.');
      return;
    }

    // Own-rec carve-out
    if (resolvedViewer.id === curatorId) {
      return;
    }

    const isViewerTester = resolvedViewer.is_tester === true;
    const flagOn = (resolvedViewer.feature_flags || {}).payout_validation === true;
    if (!isViewerTester || !flagOn) {
      alert('Validation is in private testing.');
      return;
    }

    // Subscription check using fresh auth context
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('subscriber_id', resolvedViewer.id)
      .eq('curator_id', curatorId)
      .is('unsubscribed_at', null)
      .maybeSingle();

    if (subErr) {
      console.error('[VALIDATION_VISITOR_SUB_CHECK_ERROR]', subErr.message);
      alert('Could not check subscription. Reload the page and try again.');
      return;
    }
    if (!sub) {
      alert(`Subscribe to @${profile.handle.replace('@', '')} to validate this rec.`);
      return;
    }

    setShowValidationSheet(true);
  };
  const bndls = itemBundlesMap[selectedItem.id] || [];
  const recBundles = bundles.filter(b => bndls.includes(b.id));
  const fmtPhone = (p) => p ? p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div style={{ maxWidth: 700, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
      <div style={{ padding: "52px 20px 10px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <button onClick={() => { if (navigator.clipboard) { navigator.clipboard.writeText(url); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); } }} style={{ background: T.s, border: "1px solid " + T.bdr, borderRadius: 10, padding: "6px 14px", cursor: "pointer", fontFamily: MN, fontSize: 10, color: linkCopied ? "#6BAA8E" : T.ink3 }}>
          {linkCopied ? "\u2713 Copied" : "Copy link"}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 40px", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", minHeight: 0 }}>
        <div className="fu">
          {/* Curator attribution */}
          <button onClick={() => router.push(`/${profile.handle.replace("@", "")}`)} style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 20,
            background: "none", border: "none", cursor: "pointer", padding: 0,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: `linear-gradient(145deg, ${T.s2}, ${T.s})`,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}>
              <span style={{ fontFamily: S, fontSize: 15, color: T.acc, fontWeight: 400 }}>{profile.name[0]}</span>
            </div>
            <span style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>{profile.name}</span>
            <span style={{ fontSize: 13, color: T.ink3, fontFamily: F }}>·</span>
            <span style={{ fontSize: 13, color: T.ink3, fontFamily: F }}>@{profile.handle.replace("@", "")}</span>
          </button>

          {/* Category + date */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, background: c.bg,
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26,
              border: `1px solid ${c.color}20`,
            }}>{c.emoji}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: c.color, fontFamily: F }}>{c.label}</div>
              <div style={{ fontSize: 11, color: T.ink3, fontFamily: F, marginTop: 2 }}>Recommended {fmtDateFull(selectedItem.date)}</div>
            </div>
          </div>

          {/* Title */}
          <h1 style={{ fontFamily: S, fontSize: 32, color: T.ink, fontWeight: 400, lineHeight: 1.15, marginBottom: 20 }}>{selectedItem.title}</h1>

          {/* Context */}
          <div style={{
            padding: "20px 22px", background: T.s, borderRadius: 16,
            border: "1px solid " + T.bdr, marginBottom: 20,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10, fontFamily: F }}>Why {profile.name} recommends this</div>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: T.ink, fontFamily: F, fontWeight: 500, whiteSpace: "pre-line" }}>
              <Linkify text={selectedItem.context} style={{ fontSize: 17, fontFamily: F }} />
            </p>
          </div>

          {canShowValidate && validationFetched && !existingValidation && (
            <button
              onClick={handleValidateTap}
              style={{
                width: '100%', padding: '12px 14px', marginBottom: 20,
                background: 'transparent', color: T.ink2,
                border: '1px solid ' + T.bdr, borderRadius: 12,
                fontFamily: F, fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}
            >Validate this Rec</button>
          )}

          {canShowValidate && validationFetched && existingValidation && (
            <button
              onClick={() => setShowValidatedModal(true)}
              style={{
                width: '100%', padding: '12px 14px', marginBottom: 20,
                background: 'transparent', color: T.ink3,
                border: '1px solid ' + T.bdr, borderRadius: 12,
                fontFamily: F, fontSize: 14, fontWeight: 600,
                cursor: 'pointer',
              }}
            >Validated · {formatValidatedAt(existingValidation.created_at)}</button>
          )}

          <MediaEmbed
            extractor={selectedItem.extraction?.extractor}
            sourceUrl={selectedItem.links?.[0]?.url || selectedItem.source_block?.url}
          />

          {/* Links */}
          {selectedItem.links?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10, fontFamily: F }}>Links</div>
              <LinkDisplay links={selectedItem.links} />
            </div>
          )}

          <ArchivedSource body_md={selectedItem.body_md} slug={selectedItem.slug} title={selectedItem.title} profileId={selectedItem.profile_id} sourceType={selectedItem.extraction?.extractor?.split("@")[0]} lossy={selectedItem.extraction?.lossy} />

          {/* Tags */}
          {selectedItem.tags?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
              {selectedItem.tags.map(tag => (
                <span key={tag} style={{ padding: "6px 14px", borderRadius: 10, fontSize: 12, background: T.s, color: T.ink2, border: "1px solid " + T.bdr, fontFamily: F }}>{tag}</span>
              ))}
            </div>
          )}

          {/* Website + Phone */}
          {(selectedItem.website || selectedItem.phone) && (
            <div style={{ background: T.s, borderRadius: 14, border: "1px solid " + T.bdr, marginBottom: 24, overflow: "hidden" }}>
              {selectedItem.website && (
                <a href={selectedItem.website} target="_blank" rel="noopener noreferrer" style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                  textDecoration: "none", borderBottom: selectedItem.phone ? `1px solid ${T.bdr}` : "none",
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: T.s2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 14 }}>🌐</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, fontFamily: F }}>Website</div>
                    <div style={{ fontSize: 11, color: T.acc, fontFamily: F, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedItem.website.replace(/^https?:\/\/(www\.)?/, "")}</div>
                  </div>
                  <span style={{ color: T.ink3, fontSize: 12 }}>↗</span>
                </a>
              )}
              {selectedItem.phone && (
                <a href={`tel:${selectedItem.phone}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", textDecoration: "none" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: T.s2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 14 }}>📞</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, fontFamily: F }}>Call</div>
                    <div style={{ fontSize: 12, color: T.acc, fontFamily: MN, marginTop: 1 }}>{fmtPhone(selectedItem.phone)}</div>
                  </div>
                </a>
              )}
            </div>
          )}

          {/* TODO: Unhide when earnings features are real */}
          {false && recBundles.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10, fontFamily: F }}>Also in</div>
              {recBundles.map(bundle => (
                <div key={bundle.id} style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                  background: T.s, borderRadius: 12, border: "1px solid " + T.bdr, marginBottom: 6,
                }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: T.accSoft, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 13 }}>📦</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, fontFamily: F }}>{bundle.name}</div>
                    <div style={{ fontSize: 11, color: T.ink3, fontFamily: F, marginTop: 1 }}>{bundle.count} recs{bundle.price > 0 ? ` · $${bundle.price}` : ""}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TODO: Unhide when earnings features are real */}
          {false && !!itemTipEnabled[selectedItem.id] && !tipSent && (
            <div style={{ marginTop: 20, marginBottom: 8 }}>
              {!tipExpanded ? (
                <button onClick={() => { setTipExpanded(true); setTipAmount(itemTipConfig[selectedItem.id]?.suggested || 5); }} style={{
                  width: "100%", padding: "20px 22px", borderRadius: 18,
                  border: `1.5px solid ${T.acc}35`,
                  background: `linear-gradient(135deg, ${T.accSoft}, ${T.s})`,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 14,
                  transition: "all .2s",
                  boxShadow: `0 2px 16px ${T.acc}12`,
                }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 14,
                    background: `linear-gradient(135deg, ${T.acc}25, #6BAA8E20)`,
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <span style={{ fontSize: 22 }}>☕</span>
                  </div>
                  <div style={{ flex: 1, textAlign: "left" }}>
                    <div style={{ fontSize: 15, color: T.ink, fontFamily: F, fontWeight: 700, lineHeight: 1.2 }}>This helped? Give thanks.</div>
                    <div style={{ fontSize: 12, color: T.ink3, fontFamily: F, marginTop: 3 }}>Express your gratitude.</div>
                  </div>
                  <span style={{ fontSize: 16, color: T.acc, fontWeight: 600 }}>→</span>
                </button>
              ) : (
                <div className="fu" style={{ padding: "28px 22px", borderRadius: 20, background: T.s, border: "1px solid " + T.bdr }}>
                  <div style={{ textAlign: "center", marginBottom: 20 }}>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>☕</div>
                    <div style={{ fontFamily: F, fontSize: 16, fontWeight: 700, color: T.ink, lineHeight: 1.3 }}>
                      Thank {profile.name} for this rec
                    </div>
                  </div>
                  <div style={{ marginBottom: 24 }}>
                    <textarea value={tipMessage} onChange={e => setTipMessage(e.target.value)}
                      placeholder="What did you like about this recommendation?"
                      rows={3}
                      style={{
                        width: "100%", padding: "16px 18px", borderRadius: 16,
                        border: `1.5px solid ${T.bdr}`, fontSize: 15, fontFamily: F,
                        outline: "none", resize: "none", background: T.bg, color: T.ink,
                        lineHeight: 1.55, transition: "border-color .2s",
                      }}
                      onFocus={e => e.target.style.borderColor = T.acc}
                      onBlur={e => e.target.style.borderColor = T.bdr}
                    />
                    <div style={{ fontSize: 10, color: T.ink3, fontFamily: F, marginTop: 6 }}>
                      {profile.name} will see your note with this rec
                    </div>
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, fontFamily: F, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>
                    Attach a tip
                  </div>
                  <div style={{ textAlign: "center", marginBottom: 4 }}>
                    <div style={{ fontFamily: MN, fontSize: 40, fontWeight: 700, color: T.ink, lineHeight: 1, letterSpacing: "-0.03em" }}>
                      {"$"}{tipAmount}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 24, marginTop: 12 }}>
                    {[3, 5, 10, 25].map(amt => (
                      <button key={amt} onClick={() => setTipAmount(amt)} style={{
                        flex: 1, padding: "10px 0", borderRadius: 12, textAlign: "center",
                        border: tipAmount === amt ? `2px solid ${T.acc}` : `1.5px solid ${T.bdr}`,
                        background: tipAmount === amt ? T.accSoft : "transparent",
                        color: tipAmount === amt ? T.acc : T.ink3,
                        fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: MN,
                        transition: "all .12s",
                      }}>
                        {"$"}{amt}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setTipSent(true)} style={{
                    width: "100%", padding: "16px", borderRadius: 14, border: "none",
                    background: T.acc, color: T.accText,
                    fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: F,
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}>
                    Send {"$"}{tipAmount} ☕
                  </button>
                  <button onClick={() => { setTipExpanded(false); setTipAmount(null); }} style={{
                    width: "100%", background: "none", border: "none", padding: "10px 0 0",
                    cursor: "pointer", fontSize: 12, color: T.ink3, fontFamily: F,
                  }}>Maybe later</button>
                </div>
              )}
            </div>
          )}

          {/* TODO: Unhide when earnings features are real */}
          {false && tipSent && (
            <div className="fu" style={{
              marginTop: 20, marginBottom: 8, padding: "22px 20px", borderRadius: 16,
              background: "#6BAA8E12", border: `1px solid #6BAA8E30`,
              textAlign: "center",
            }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>🎉</div>
              <div style={{ fontFamily: F, fontSize: 15, fontWeight: 700, color: "#6BAA8E" }}>{"$"}{tipAmount} sent!</div>
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 4 }}>{profile.name} will see your message with this rec</div>
            </div>
          )}

          {/* TODO: Unhide when earnings features are real */}
          {false && <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${T.bdr}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 12, opacity: .4 }}>⛓</span>
              <span style={{ fontSize: 10, color: T.ink3, fontFamily: MN, fontWeight: 500 }}>On-chain</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
              <span style={{
                padding: "4px 10px", borderRadius: 6, fontSize: 10, fontFamily: MN,
                background: T.s, border: "1px solid " + T.bdr, color: T.ink3,
              }}>Timestamped · Rev {selectedItem.revision || 1}</span>
              {!!itemLicensable[selectedItem.id] && (
                <span style={{
                  padding: "4px 10px", borderRadius: 6, fontSize: 10, fontFamily: MN,
                  background: T.s, border: "1px solid " + T.bdr, color: T.ink3,
                }}>Licensable</span>
              )}
              {profile.cryptoEnabled && (
                <span style={{
                  padding: "4px 10px", borderRadius: 6, fontSize: 10, fontFamily: MN,
                  background: T.s, border: "1px solid " + T.bdr, color: T.ink3,
                }}>{profile.wallet}</span>
              )}
            </div>
            <div style={{ height: 20 }} />
          </div>}
        </div>
      </div>
      </div>
      {showValidationSheet && viewerProfile && (
        <ValidationSheet
          rec={selectedItem}
          curator={profile}
          onClose={() => setShowValidationSheet(false)}
          onSuccess={(data) => {
            setExistingValidation({
              id: data?.validation_id,
              verbatim_text: data?.verbatim_text || '',
              created_at: new Date().toISOString(),
              retracted_at: null,
            });
          }}
        />
      )}
      {showValidatedModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }}
          onClick={() => setShowValidatedModal(false)}
        />
      )}
      {showValidatedModal && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 360, maxWidth: '92vw',
          background: T.bg, borderRadius: 14,
          border: '1px solid ' + T.bdr,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          padding: '20px 22px', zIndex: 1000, fontFamily: F,
        }}>
          <div style={{ fontSize: 11, color: T.ink3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, fontWeight: 700 }}>
            Your validation
          </div>
          <div style={{
            fontSize: 14, color: T.ink, marginBottom: 14, lineHeight: 1.5,
            padding: '10px 12px', background: T.s, border: '1px solid ' + T.bdr,
            borderRadius: 8, whiteSpace: 'pre-wrap',
          }}>
            {existingValidation?.verbatim_text || '(no text available)'}
          </div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 12, fontFamily: F }}>
            {existingValidation?.retracted_at
              ? `Retracted ${formatValidatedAt(existingValidation.retracted_at)}.`
              : `Sent ${formatValidatedAt(existingValidation?.created_at)}.`}
          </div>
          {existingThreadId && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              <a
                href={`/subs?segment=messages&thread=${existingThreadId}`}
                style={{ fontFamily: F, fontSize: 13, color: T.acc, textDecoration: "none", fontWeight: 600 }}
              >
                Open thread →
              </a>
              {!existingValidation?.retracted_at && (
                <button
                  onClick={() => setShowRetractConfirm(true)}
                  style={{
                    background: "transparent", border: "none", padding: 0, cursor: "pointer",
                    fontFamily: F, fontSize: 12, color: T.ink2, textAlign: "left",
                  }}
                >
                  Retract validation
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => setShowValidatedModal(false)}
            style={{
              width: '100%', padding: '10px', fontFamily: F, fontSize: 14, fontWeight: 600,
              background: T.acc, color: T.accText,
              border: 'none', borderRadius: 10, cursor: 'pointer',
            }}
          >Close</button>
        </div>
      )}
      {showRetractConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1001 }}
          onClick={() => !retracting && setShowRetractConfirm(false)}
        />
      )}
      {showRetractConfirm && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 340, maxWidth: '92vw',
          background: T.bg, borderRadius: 14,
          border: '1px solid ' + T.bdr,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          padding: '20px 22px', zIndex: 1002, fontFamily: F,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 8 }}>
            Retract this validation?
          </div>
          <div style={{ fontSize: 13, color: T.ink2, marginBottom: 16, lineHeight: 1.4 }}>
            Your note stays in the thread but will be marked as retracted. Allocation for this rec is removed.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowRetractConfirm(false)}
              disabled={retracting}
              style={{
                flex: 1, padding: '10px', fontFamily: F, fontSize: 13, fontWeight: 600,
                background: T.acc, color: T.accText, border: 'none', borderRadius: 10, cursor: 'pointer',
              }}
            >Cancel</button>
            <button
              onClick={handleVisitorRetract}
              disabled={retracting}
              style={{
                flex: 1, padding: '10px', fontFamily: F, fontSize: 13, fontWeight: 600,
                background: 'transparent', color: T.ink2, border: `1px solid ${T.bdr}`, borderRadius: 10,
                cursor: retracting ? 'default' : 'pointer',
              }}
            >{retracting ? "Retracting..." : "Retract"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Network/Saved Rec Detail (viewing another curator's rec) ── */
export function NetworkRecDetail({ slug }) {
  const router = useRouter();
  const { profile, profileId, savedRecIds, saveRec, unsaveRec, mySubscriptionIds, subscribe } = useCurator();
  const [rec, setRec] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showValidationSheet, setShowValidationSheet] = useState(false);
  const [existingValidation, setExistingValidation] = useState(null); // { id, created_at } or null
  const [validationFetched, setValidationFetched] = useState(false);
  const [showValidatedModal, setShowValidatedModal] = useState(false);
  const [existingThreadId, setExistingThreadId] = useState(null);
  const [showRetractConfirm, setShowRetractConfirm] = useState(false);
  const [retracting, setRetracting] = useState(false);

  async function handleNetworkRetract() {
    if (!existingValidation?.id || retracting) return;
    setRetracting(true);
    try {
      const res = await fetch(`/api/validations/${existingValidation.id}/retract`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok) {
        setExistingValidation((prev) => prev ? { ...prev, retracted_at: data.retracted_at } : prev);
        setShowRetractConfirm(false);
      } else {
        console.error("[VALIDATION_RETRACT_FAILED]", data);
      }
    } catch (e) {
      console.error("[VALIDATION_RETRACT_ERROR]", e);
    } finally {
      setRetracting(false);
    }
  }

  useEffect(() => {
    async function load() {
      // Two-step queries (no join aliases). Try slug first, then id.
      const bySlug = await supabase
        .from("recommendations")
        .select("*")
        .eq("slug", slug)
        .eq("status", "approved")
        .eq("visibility", "public")
        .limit(1)
        .maybeSingle();
      if (bySlug.error) console.warn("[NetworkRecDetail] slug lookup failed:", bySlug.error.message);

      let data = bySlug.data;
      if (!data) {
        const byId = await supabase
          .from("recommendations")
          .select("*")
          .eq("id", slug)
          .eq("visibility", "public")
          .limit(1)
          .maybeSingle();
        if (byId.error) console.warn("[NetworkRecDetail] id lookup failed:", byId.error.message);
        data = byId.data;
      }

      if (!data) {
        setRec(null);
        setLoading(false);
        return;
      }

      // Two-step profile lookup (no join alias)
      const profileRes = await supabase
        .from("profiles")
        .select("id, name, handle")
        .eq("id", data.profile_id)
        .maybeSingle();
      if (profileRes.error) console.warn("[NetworkRecDetail] profile lookup failed:", profileRes.error.message);
      data.curator = profileRes.data || null;

      // Secondary rec_files load — null-safe. If it fails or returns nothing,
      // the rec still renders normally without body_md.
      if (data.rec_file_id) {
        const recFileRes = await supabase
          .from("rec_files")
          .select("id, body_md, extraction, work, curation, curator_is_author, source")
          .eq("id", data.rec_file_id)
          .maybeSingle();
        if (recFileRes.error) {
          console.warn("[NetworkRecDetail] rec_files secondary load failed:", recFileRes.error.message);
        } else if (recFileRes.data) {
          data.body_md = recFileRes.data.body_md || null;
          data.extraction = recFileRes.data.extraction || null;
          data.work = recFileRes.data.work || null;
          data.curation_block = recFileRes.data.curation || null;
          data.curator_is_author = recFileRes.data.curator_is_author || false;
          data.source_block = recFileRes.data.source || null;
        }
      }

      setRec(data);
      setLoading(false);
    }
    load();
  }, [slug]);

  useEffect(() => {
    if (loading || !rec?.id || !profileId) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase
          .from('validations')
          .select('id, verbatim_text, created_at, retracted_at')
          .eq('subscriber_id', profileId)
          .eq('rec_id', rec.id)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          console.error('[VALIDATION_FETCH_ERROR]', error.message);
          setExistingValidation(null);
        } else {
          setExistingValidation(data || null);
          if (data && rec?.profile_id) {
            const { data: threadRow } = await supabase
              .from('threads')
              .select('id')
              .or(`and(subscriber_id.eq.${profileId},curator_id.eq.${rec.profile_id}),and(curator_id.eq.${profileId},subscriber_id.eq.${rec.profile_id})`)
              .maybeSingle();
            if (!cancelled && threadRow) setExistingThreadId(threadRow.id);
          }
        }
        setValidationFetched(true);
      } catch (e) {
        if (!cancelled) {
          console.error('[VALIDATION_FETCH_ERROR]', e?.message);
          setValidationFetched(true);
        }
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [loading, rec?.id, profileId]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 13, color: T.ink3, fontFamily: F }}>Loading...</div>
      </div>
    );
  }

  if (!rec) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
        <div style={{ fontSize: 28, opacity: 0.3 }}>{"\uD83D\uDD0D"}</div>
        <div style={{ fontFamily: F, fontSize: 15, color: T.ink3 }}>Rec not found</div>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", color: T.acc, fontSize: 14, fontFamily: F, fontWeight: 600, cursor: "pointer" }}>{"\u2190"} Go back</button>
      </div>
    );
  }

  const c = CAT[rec.category] || CAT.other;
  const curator = rec.curator || {};
  const isBookmarked = savedRecIds.has(rec.id);
  const isSubscribed = curator.id ? mySubscriptionIds.has(curator.id) : false;
  const item = { ...rec, date: rec.created_at?.split("T")[0] };

  const canShowValidate =
    profile?.isTester === true &&
    hasFeature(profile, 'payout_validation') &&
    curator?.id !== profileId &&
    isSubscribed;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div style={{ maxWidth: 700, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>
        {/* Header */}
        <div style={{ padding: "52px 20px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
            </svg>
          </button>
          {/* Bookmark button */}
          <button onClick={() => isBookmarked ? unsaveRec(rec.id) : saveRec(rec.id)} style={{
            width: 36, height: 36, borderRadius: 10, border: "1px solid " + T.bdr,
            background: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 14 14" fill={isBookmarked ? T.acc : "none"} stroke={isBookmarked ? T.acc : T.ink3} strokeWidth="1.5">
              <path d="M3 1.5h8a.5.5 0 0 1 .5.5v10.5L7 9.5 2.5 12.5V2a.5.5 0 0 1 .5-.5z" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "8px 20px 40px", WebkitOverflowScrolling: "touch", overscrollBehavior: "contain", minHeight: 0 }}>
          <div className="fu">
            {/* Curator attribution */}
            <div onClick={() => router.push(`/${curator.handle}`)} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
              background: T.s, borderRadius: 14, border: "1px solid " + T.bdr,
              marginBottom: 20, cursor: "pointer",
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 12, background: T.accSoft,
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                <span style={{ fontFamily: S, fontSize: 17, color: T.acc, fontWeight: 400 }}>
                  {curator.name?.[0] || "?"}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>{curator.name}</div>
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>@{curator.handle}</div>
              </div>
              {!isSubscribed && curator.id && curator.id !== profileId && (
                <button onClick={(e) => { e.stopPropagation(); subscribe(curator.id); }} style={{
                  padding: "7px 14px", borderRadius: 8, border: "none",
                  background: T.acc, color: T.accText,
                  fontSize: 12, fontWeight: 600, fontFamily: F, cursor: "pointer", flexShrink: 0,
                }}>Subscribe</button>
              )}
              {isSubscribed && (
                <span style={{ fontSize: 11, color: T.ink3, fontFamily: F, fontWeight: 500 }}>Subscribed</span>
              )}
            </div>

            {/* Category + date */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 16, background: c.bg,
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26,
                border: `1px solid ${c.color}20`,
              }}>{c.emoji}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: c.color, fontFamily: F }}>{c.label}</div>
                <div style={{ fontSize: 11, color: T.ink3, fontFamily: F, marginTop: 2 }}>Recommended {fmtDateFull(item.date)}</div>
              </div>
            </div>

            {/* Title */}
            <h1 style={{ fontFamily: S, fontSize: 28, color: T.ink, fontWeight: 400, lineHeight: 1.2, marginBottom: 20 }}>{rec.title}</h1>

            {/* Context */}
            {rec.context && (
              <div style={{
                padding: "20px 22px", background: T.s, borderRadius: 16,
                border: "1px solid " + T.bdr, marginBottom: 20,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10, fontFamily: F }}>
                  Why {curator.name} recommends this
                </div>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: T.ink, fontFamily: F, whiteSpace: "pre-line" }}>
                  <Linkify text={rec.context} style={{ fontSize: 15, fontFamily: F }} />
                </p>
              </div>
            )}

            {canShowValidate && validationFetched && !existingValidation && (
              <button
                onClick={() => setShowValidationSheet(true)}
                style={{
                  width: '100%', padding: '12px 14px', marginBottom: 20,
                  background: 'transparent', color: T.ink2,
                  border: '1px solid ' + T.bdr, borderRadius: 12,
                  fontFamily: F, fontSize: 14, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >Validate this Rec</button>
            )}

            {canShowValidate && validationFetched && existingValidation && (
              <button
                onClick={() => setShowValidatedModal(true)}
                style={{
                  width: '100%', padding: '12px 14px', marginBottom: 20,
                  background: 'transparent', color: T.ink3,
                  border: '1px solid ' + T.bdr, borderRadius: 12,
                  fontFamily: F, fontSize: 14, fontWeight: 600,
                  cursor: 'pointer',
                }}
              >Validated · {formatValidatedAt(existingValidation.created_at)}</button>
            )}

            <MediaEmbed
              extractor={rec.extraction?.extractor}
              sourceUrl={rec.links?.[0]?.url || rec.source_block?.url}
            />

            {/* Links */}
            {rec.links?.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10, fontFamily: F }}>Links</div>
                <LinkDisplay links={rec.links} />
              </div>
            )}

            <ArchivedSource body_md={rec.body_md} slug={rec.slug} title={rec.title} profileId={rec.profile_id} sourceType={rec.extraction?.extractor?.split("@")[0]} lossy={rec.extraction?.lossy} />

            {/* Tags */}
            {rec.tags?.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
                {rec.tags.map(tag => (
                  <span key={tag} style={{ padding: "6px 14px", borderRadius: 10, fontSize: 12, background: T.s, color: T.ink2, border: "1px solid " + T.bdr, fontFamily: F }}>{tag}</span>
                ))}
              </div>
            )}

          </div>
        </div>
      </div>
      {showValidationSheet && (
        <ValidationSheet
          rec={rec}
          curator={curator}
          onClose={() => setShowValidationSheet(false)}
          onSuccess={(data) => {
            setExistingValidation({
              id: data?.validation_id,
              verbatim_text: data?.verbatim_text || '',
              created_at: new Date().toISOString(),
              retracted_at: null,
            });
          }}
        />
      )}
      {showValidatedModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }}
          onClick={() => setShowValidatedModal(false)}
        />
      )}
      {showValidatedModal && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 360, maxWidth: '92vw',
          background: T.bg, borderRadius: 14,
          border: '1px solid ' + T.bdr,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          padding: '20px 22px', zIndex: 1000, fontFamily: F,
        }}>
          <div style={{ fontSize: 11, color: T.ink3, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8, fontWeight: 700 }}>
            Your validation
          </div>
          <div style={{
            fontSize: 14, color: T.ink, marginBottom: 14, lineHeight: 1.5,
            padding: '10px 12px', background: T.s, border: '1px solid ' + T.bdr,
            borderRadius: 8, whiteSpace: 'pre-wrap',
          }}>
            {existingValidation?.verbatim_text || '(no text available)'}
          </div>
          <div style={{ fontSize: 12, color: T.ink3, marginBottom: 12, fontFamily: F }}>
            {existingValidation?.retracted_at
              ? `Retracted ${formatValidatedAt(existingValidation.retracted_at)}.`
              : `Sent ${formatValidatedAt(existingValidation?.created_at)}.`}
          </div>
          {existingThreadId && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
              <a
                href={`/subs?segment=messages&thread=${existingThreadId}`}
                style={{ fontFamily: F, fontSize: 13, color: T.acc, textDecoration: "none", fontWeight: 600 }}
              >
                Open thread →
              </a>
              {!existingValidation?.retracted_at && (
                <button
                  onClick={() => setShowRetractConfirm(true)}
                  style={{
                    background: "transparent", border: "none", padding: 0, cursor: "pointer",
                    fontFamily: F, fontSize: 12, color: T.ink2, textAlign: "left",
                  }}
                >
                  Retract validation
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => setShowValidatedModal(false)}
            style={{
              width: '100%', padding: '10px', fontFamily: F, fontSize: 14, fontWeight: 600,
              background: T.acc, color: T.accText,
              border: 'none', borderRadius: 10, cursor: 'pointer',
            }}
          >Close</button>
        </div>
      )}
      {showRetractConfirm && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1001 }}
          onClick={() => !retracting && setShowRetractConfirm(false)}
        />
      )}
      {showRetractConfirm && (
        <div style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 340, maxWidth: '92vw',
          background: T.bg, borderRadius: 14,
          border: '1px solid ' + T.bdr,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          padding: '20px 22px', zIndex: 1002, fontFamily: F,
        }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 8 }}>
            Retract this validation?
          </div>
          <div style={{ fontSize: 13, color: T.ink2, marginBottom: 16, lineHeight: 1.4 }}>
            Your note stays in the thread but will be marked as retracted. Allocation for this rec is removed.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowRetractConfirm(false)}
              disabled={retracting}
              style={{
                flex: 1, padding: '10px', fontFamily: F, fontSize: 13, fontWeight: 600,
                background: T.acc, color: T.accText, border: 'none', borderRadius: 10, cursor: 'pointer',
              }}
            >Cancel</button>
            <button
              onClick={handleNetworkRetract}
              disabled={retracting}
              style={{
                flex: 1, padding: '10px', fontFamily: F, fontSize: 13, fontWeight: 600,
                background: 'transparent', color: T.ink2, border: `1px solid ${T.bdr}`, borderRadius: 10,
                cursor: retracting ? 'default' : 'pointer',
              }}
            >{retracting ? "Retracting..." : "Retract"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
