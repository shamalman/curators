'use client'

import { useState, useEffect, useRef } from "react";
import { T, F, CAT, CATEGORIES } from "@/lib/constants";
import { useCurator } from "@/context/CuratorContext";

function makeLinkId() {
  return `lnk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isValidHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function TagsInput({ tags, setTags, tagInput, setTagInput, saving }) {
  const handleTagKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const val = tagInput.replace(/,/g, "").trim();
      if (val && !tags.includes(val)) {
        setTags([...tags, val]);
      }
      setTagInput("");
    }
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Tags</div>
      <input
        value={tagInput}
        onChange={(e) => setTagInput(e.target.value)}
        onKeyDown={handleTagKeyDown}
        placeholder="Add a tag..."
        disabled={saving}
        style={{
          width: "100%", padding: "12px 14px", borderRadius: 10,
          border: `1px solid ${T.bdr}`, fontSize: 14, fontFamily: F,
          background: T.bg, color: T.ink, outline: "none", boxSizing: "border-box",
        }}
      />
      {tags.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {tags.map((tag, i) => (
            <span key={i} style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 16, padding: "4px 10px", fontSize: 13, color: "rgba(255,255,255,0.8)", fontFamily: F,
            }}>
              {tag}
              <button
                type="button"
                onClick={() => setTags(tags.filter((_, j) => j !== i))}
                disabled={saving}
                style={{
                  background: "none", border: "none", color: "rgba(255,255,255,0.4)",
                  cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1, fontFamily: F,
                }}
              >×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkRow({ link, onUrlChange, onParse, onRemove }) {
  // Parsed-display state
  if (link.parsed) {
    const displayTitle = link.title || hostnameOf(link.url);
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        border: `1px solid ${T.bdr}`, borderRadius: 10, background: T.bg, marginBottom: 8,
      }}>
        {link.thumbnail_url ? (
          <img src={link.thumbnail_url} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 36, height: 36, borderRadius: 6, background: T.s2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, fontFamily: F, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayTitle}</div>
          {link.provider && <div style={{ fontSize: 11, color: T.ink3, fontFamily: F }}>{link.provider}</div>}
        </div>
        <button onClick={onRemove} style={{
          width: 24, height: 24, borderRadius: 12, border: "none", background: T.s2,
          color: T.ink3, fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}>×</button>
      </div>
    );
  }

  // Input state (empty or parsing)
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <input
        value={link.url}
        readOnly={link.parsing}
        onChange={(e) => onUrlChange(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData?.getData("text") || "";
          if (pasted && isValidHttpUrl(pasted.trim())) {
            // Defer to allow value update first, then parse
            setTimeout(() => onParse(pasted.trim()), 200);
          }
        }}
        onBlur={() => {
          const trimmed = link.url.trim();
          if (trimmed && isValidHttpUrl(trimmed)) {
            onParse(trimmed);
          }
        }}
        placeholder="Paste a URL"
        style={{
          flex: 1, padding: "10px 12px", borderRadius: 10,
          border: `1px solid ${T.bdr}`, fontSize: 14, fontFamily: F,
          background: T.bg, color: T.ink, outline: "none",
        }}
      />
      {link.parsing && (
        <div style={{
          width: 16, height: 16, borderRadius: 8,
          border: `2px solid ${T.bdr}`, borderTopColor: T.acc,
          animation: "qcSpin 700ms linear infinite",
        }} />
      )}
      <button onClick={onRemove} style={{
        width: 28, height: 28, borderRadius: 14, border: "none", background: T.s2,
        color: T.ink3, fontSize: 14, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}>×</button>
    </div>
  );
}

export default function QuickCaptureSheet({ isOpen, onClose, onSaved, defaultVisibility, isDesktop, profileId, initialData = null }) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [category, setCategory] = useState(null);
  const [links, setLinks] = useState([]);
  const [visibility, setVisibility] = useState(defaultVisibility || "public");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const titleInputRef = useRef(null);

  // Deploy 3: multi-mode capture
  const [captureMode, setCaptureMode] = useState("url"); // 'url' | 'paste' | 'upload'

  // Paste mode state
  const [pasteText, setPasteText] = useState("");
  const [pasteWhy, setPasteWhy] = useState("");

  // Upload mode state
  const [uploadFile, setUploadFile] = useState(null); // File object
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadWhy, setUploadWhy] = useState("");
  const uploadInputRef = useRef(null);

  // Feature B: pre-uploaded artifact state (from chat image save)
  const [preUploadedArtifact, setPreUploadedArtifact] = useState(null); // { sha256, ref, mimeType, sizeBytes }

  // Per-save silent flag — power-user escape hatch to skip subscriber emails.
  // Resets on every sheet open (see useEffect below). Never persists.
  const [silentSave, setSilentSave] = useState(false);
  const { profile } = useCurator();
  const showSilentToggle = profile?.isTester === true;

  // Reset state when sheet opens, OR prefill from initialData if provided
  useEffect(() => {
    if (isOpen) {
      setTitle(initialData?.title || "");
      setContext(initialData?.context || "");
      setCategory(initialData?.category || null);
      setTags(initialData?.tags || []);
      setTagInput("");
      setVisibility(defaultVisibility || "public");
      setSaving(false);
      setError(null);
      setSilentSave(false); // always reset — sticky silent would be a footgun

      // Deploy 3: reset multi-mode capture state — honor initialData.mode
      setCaptureMode(initialData?.mode || "url");

      // Paste mode state
      setPasteText("");
      setPasteWhy("");

      // Upload mode state
      setUploadFile(null);
      if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
      setUploadPreviewUrl(null);
      setUploadTitle("");
      setUploadCategory("");
      setUploadWhy("");
      setPreUploadedArtifact(null);

      // Feature B: Upload mode prefill — from chat image save.
      // Prefill upload title/category/why from inferred metadata, set preview
      // from signed URL, stash artifact identifiers for JSON save path.
      if (initialData?.mode === "upload" && initialData?.artifactSha256) {
        setUploadTitle(initialData.title || "");
        setUploadCategory(initialData.category || "");
        setUploadWhy(initialData.context || "");
        setUploadPreviewUrl(initialData.signedUrl || null);
        setPreUploadedArtifact({
          sha256: initialData.artifactSha256,
          ref: initialData.artifactRef,
          mimeType: initialData.mimeType,
          sizeBytes: initialData.sizeBytes,
        });
        setLinks([]);
      // Feature C: URL mode prefill — if initialData has a URL, seed the links array
      // with a pre-parsed entry so the sheet shows the parsed card immediately
      // and the save path has a ready-to-use parsedPayload.
      } else if (initialData?.mode === "url" && initialData?.url && initialData?.parsedPayload) {
        setLinks([{
          id: makeLinkId(),
          url: initialData.url,
          parsing: false,
          parsed: true,
          title: initialData.title || initialData.parsedPayload.title || "",
          thumbnail_url: initialData.thumbnail_url || null,
          provider: initialData.provider || initialData.parsedPayload.site_name || null,
          parsedPayload: initialData.parsedPayload,
        }]);
      } else {
        setLinks([{ id: makeLinkId(), url: "", parsing: false, parsed: false, title: null, thumbnail_url: null, provider: null }]);
      }

      // Autofocus title after a tick
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [isOpen]); // NOTE: intentionally NOT including initialData in deps — we only apply it on open

  if (!isOpen) return null;

  const isDirty = title.trim() !== "" || context.trim() !== "" || category !== null || links.some(l => l.url);

  const handleCancel = () => {
    if (isDirty) {
      if (!window.confirm("Discard this rec?")) return;
    }
    onClose();
  };

  const addLinkRow = () => {
    setLinks(prev => [...prev, { id: makeLinkId(), url: "", parsing: false, parsed: false, title: null, thumbnail_url: null, provider: null }]);
  };

  const updateLinkUrl = (linkId, url) => {
    setLinks(prev => prev.map(l => l.id === linkId ? { ...l, url } : l));
  };

  const removeLink = (linkId) => {
    setLinks(prev => {
      const filtered = prev.filter(l => l.id !== linkId);
      return filtered.length === 0 ? [{ id: makeLinkId(), url: "", parsing: false, parsed: false, title: null, thumbnail_url: null, provider: null }] : filtered;
    });
  };

  const parseLink = async (linkId, url) => {
    // Snapshot whether this is the first link BEFORE we mutate state
    const isFirstLink = links[0]?.id === linkId;

    setLinks(prev => prev.map(l => l.id === linkId ? { ...l, url, parsing: true, parsed: false } : l));

    try {
      const res = await fetch("/api/recs/parse-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, profileId }),
      });

      if (!res.ok) {
        throw new Error(`parse-link returned ${res.status}`);
      }

      const data = await res.json();

      setLinks(prev => prev.map(l => l.id === linkId ? {
        ...l,
        url,
        parsing: false,
        parsed: true,
        title: data.title,
        thumbnail_url: data.thumbnail_url,
        provider: data.provider,
        // Deploy 2a: parsed content for future rec_files dual-write
        parsedPayload: {
          body_md: data.body_md || "",
          body_truncated: data.body_truncated || false,
          body_original_length: data.body_original_length || 0,
          canonical_url: data.canonical_url || null,
          site_name: data.site_name || null,
          author: data.author || null,
          authors: data.authors || [],
          published_at: data.published_at || null,
          lang: data.lang || null,
          word_count: data.word_count || 0,
          media_type: data.media_type || null,
          artifact_sha256: data.artifact_sha256 || null,
          artifact_ref: data.artifact_ref || null,
          extraction_mode: data.extraction_mode || "parsed",
          extractor: data.extractor || null,
          image_url: data.image_url || data.thumbnail_url || null,
        },
      } : l));

      // Auto-fill rule: only first link, only empty fields
      if (isFirstLink && data.parsed_successfully) {
        if (title.trim() === "" && data.title) setTitle(data.title);
        if (category === null && data.category) setCategory(data.category);
      }
    } catch (err) {
      console.error("Quick capture link parse failed:", err);
      setLinks(prev => prev.map(l => l.id === linkId ? {
        ...l,
        url,
        parsing: false,
        parsed: true,
        title: null,
        thumbnail_url: null,
        provider: null,
      } : l));
    }
  };

  const handleAddAnotherLink = () => {
    addLinkRow();
  };

  // Initialize first link row lazily on first focus of "Add link" affordance
  const ensureFirstLinkRow = () => {
    if (links.length === 0) addLinkRow();
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);

    try {
      // Build canonical link objects {url, type, label}
      const linksForDb = links
        .filter(l => l.url && l.parsed)
        .map(l => ({
          url: l.url,
          type: (l.provider || "website").toLowerCase().replace(/\s+/g, "_"),
          label: l.title || hostnameOf(l.url),
        }));

      // Deploy 2a: pass parsed payload for the first parsed link (if any)
      // through to addRec. addRec ignores it in this deploy; Deploy 2b will
      // wire it into the rec_files dual-write.
      const firstParsedLink = links.find(l => l.parsed && l.parsedPayload);

      const newItem = {
        title: title.trim(),
        category: category || "other",
        context: context.trim(),
        tags,
        links: linksForDb,
        visibility,
        date: new Date().toISOString().split("T")[0],
        revision: 1,
        revisions: [{ rev: 1, date: new Date().toISOString().split("T")[0], change: "Created" }],
        parsedPayload: firstParsedLink?.parsedPayload || null,
        createdVia: initialData?.createdViaOverride || "quick_capture_url",
        silent: silentSave,
      };

      const saved = await onSaved(newItem);
      // onSaved is responsible for closing the sheet on success.
      // If it threw or returned falsy, surface an error and re-enable.
      if (!saved) {
        throw new Error("Couldn't save. Try again.");
      }
    } catch (err) {
      console.error("Quick capture save failed:", err);
      setError(err.message || "Couldn't save. Try again.");
      setSaving(false);
    }
  };

  // Deploy 3: paste mode save handler
  const handlePasteSave = async () => {
    if (!pasteText || pasteText.trim().length < 20) {
      setError("Paste too short — at least 20 characters needed.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/recs/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body_text: pasteText,
          profileId,
          // Let AI infer title/category if curator didn't set them on the sheet
          title: title || undefined,
          category: category || undefined,
          why: pasteWhy.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Paste failed (${res.status})`);
      }
      const data = await res.json();

      // Resolve "why" with this priority:
      // 1. Curator-typed pasteWhy (explicit intent wins)
      // 2. AI-inferred why from the endpoint (when inference ran)
      // 3. Text preview fallback — first ~200 chars of paste (last resort
      //    so curation.why is never null on pastes; Taste File needs signal)
      let finalWhy = pasteWhy.trim();
      if (!finalWhy) finalWhy = data.why || "";
      if (!finalWhy) {
        const trimmedPaste = pasteText.trim();
        const preview = trimmedPaste.slice(0, 200);
        finalWhy = preview.length === trimmedPaste.length
          ? preview
          : preview + "…";
      }

      // Build newItem in the shape addRec expects — same as URL path.
      // IMPORTANT: date/revision/revisions fields must be set or RecDetail
      // will show "Added Invalid Date" in-session (the DB load path derives
      // date from created_at on refresh, but in-memory state needs it
      // explicit). Match the URL path exactly.
      const nowIso = new Date().toISOString();
      const todayYmd = nowIso.split("T")[0];
      const newItem = {
        title: data.title,
        category: data.category,
        context: finalWhy,
        tags: tags.length > 0 ? tags : (data.tags || []),
        links: [], // paste has no links
        visibility: visibility || defaultVisibility || "public",
        date: todayYmd,
        revision: 1,
        revisions: [{ rev: 1, date: todayYmd, change: "Created" }],
        parsedPayload: data.parsedPayload,
        createdVia: initialData?.createdViaOverride || "quick_capture_paste",
        silent: silentSave,
      };

      const saved = await onSaved(newItem);
      if (!saved) throw new Error("Save failed");
      // Reset will happen via onClose → useEffect
    } catch (err) {
      console.error("[QUICK_CAPTURE_PASTE_ERROR]", err);
      setError(err.message || "Paste save failed");
      setSaving(false);
    }
  };

  // Deploy 3: upload mode save handler
  const handleUploadSave = async () => {
    // Feature B: pre-uploaded artifact path (from chat image save) — no file needed
    if (!preUploadedArtifact && !uploadFile) {
      setError("Choose a file to upload.");
      return;
    }
    if (!uploadTitle || uploadTitle.trim().length === 0) {
      setError("Title is required for uploads.");
      return;
    }
    if (!uploadCategory) {
      setError("Category is required for uploads.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let res;
      if (preUploadedArtifact) {
        // Feature B: JSON path — artifact already uploaded from chat route
        res = await fetch("/api/recs/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profileId,
            artifactSha256: preUploadedArtifact.sha256,
            artifactRef: preUploadedArtifact.ref,
            mimeType: preUploadedArtifact.mimeType,
            sizeBytes: preUploadedArtifact.sizeBytes,
            title: uploadTitle.trim(),
            category: uploadCategory,
            why: uploadWhy || "",
            tags,
          }),
        });
      } else {
        // Existing multipart path — fresh file upload
        const formData = new FormData();
        formData.append("file", uploadFile);
        formData.append("profileId", profileId);
        formData.append("title", uploadTitle.trim());
        formData.append("category", uploadCategory);
        if (uploadWhy) formData.append("why", uploadWhy);

        res = await fetch("/api/recs/upload", {
          method: "POST",
          body: formData,
        });
      }
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();

      // Match URL path — set date/revision/revisions so RecDetail renders
      // correctly in-session (DB load path self-heals on refresh, but
      // in-memory state needs these explicit).
      const nowIso = new Date().toISOString();
      const todayYmd = nowIso.split("T")[0];
      const newItem = {
        title: data.title,
        category: data.category,
        context: uploadWhy || "",
        tags: tags.length > 0 ? tags : (data.tags || []),
        links: [],
        visibility: visibility || defaultVisibility || "public",
        date: todayYmd,
        revision: 1,
        revisions: [{ rev: 1, date: todayYmd, change: "Created" }],
        parsedPayload: data.parsedPayload,
        createdVia: initialData?.createdViaOverride || "quick_capture_upload",
        silent: silentSave,
      };

      const saved = await onSaved(newItem);
      if (!saved) throw new Error("Save failed");
    } catch (err) {
      console.error("[QUICK_CAPTURE_UPLOAD_ERROR]", err);
      setError(err.message || "Upload save failed");
      setSaving(false);
    }
  };

  // Deploy 3: upload file picker change handler
  const handleUploadFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Only image files are supported.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("File too large — max 5MB.");
      return;
    }
    setUploadFile(file);
    if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
    setUploadPreviewUrl(URL.createObjectURL(file));
    setError(null);
  };

  const firstLinkAddedOrParsed = links.some(l => l.parsed);
  const hasAnyEmptyLinkInput = links.some(l => !l.parsed);

  const silentToggleJsx = showSilentToggle ? (
    <div style={{ marginBottom: 14 }}>
      <label style={{
        display: "flex", alignItems: "flex-start", gap: 10, cursor: saving ? "default" : "pointer",
      }}>
        <input
          type="checkbox"
          checked={silentSave}
          onChange={(e) => setSilentSave(e.target.checked)}
          disabled={saving}
          style={{ marginTop: 2, accentColor: T.ink3, cursor: saving ? "default" : "pointer" }}
        />
        <span>
          <span style={{ fontFamily: F, fontSize: 13, color: T.ink2 }}>Save silently (don't notify subscribers)</span>
          <span style={{ display: "block", fontFamily: F, fontSize: 11, color: T.ink3, marginTop: 2, lineHeight: 1.4 }}>
            Rec still saves and appears in subscriber feeds — only suppresses the email alert.
          </span>
        </span>
      </label>
    </div>
  ) : null;

  // Sheet positioning: bottom sheet on mobile, centered on desktop
  const sheetStyle = isDesktop
    ? {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(560px, 92vw)",
        maxHeight: "88dvh",
        background: T.bg2,
        border: `0.5px solid ${T.bdr}`,
        borderRadius: 16,
        padding: 20,
        overflowY: "auto",
        zIndex: 101,
      }
    : {
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        background: T.bg2,
        borderTop: `0.5px solid ${T.bdr}`,
        borderRadius: "16px 16px 0 0",
        padding: 16,
        maxHeight: "92dvh",
        overflowY: "auto",
        zIndex: 101,
      };

  return (
    <>
      <style>{`@keyframes qcSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      {/* Backdrop */}
      <div
        onClick={handleCancel}
        style={{
          position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.55)", zIndex: 100,
        }}
      />
      <div style={sheetStyle}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: T.ink, fontFamily: F }}>Recommend something great</div>
            <div style={{ fontSize: 12, color: T.ink3, fontFamily: F, marginTop: 2 }}>Share what you love. Add a link if you have one.</div>
          </div>
          <button
            onClick={handleCancel}
            aria-label="Close"
            style={{
              width: 44, height: 44, borderRadius: 22, border: "none", background: "transparent",
              color: T.ink3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, marginRight: -8, marginTop: -8,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        {/* Deploy 3: capture mode tabs — hidden when prefilled from chat image save */}
        <div style={{ display: preUploadedArtifact ? "none" : "flex", gap: 0, borderBottom: `1px solid ${T.bdr}`, marginBottom: 16 }}>
          {[
            { key: "url", label: "URL" },
            { key: "paste", label: "Paste text" },
            { key: "upload", label: "Upload image" },
          ].map((tab) => {
            const active = captureMode === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => { setCaptureMode(tab.key); setError(null); }}
                style={{
                  flex: 1, padding: "10px 8px", border: "none",
                  background: "transparent",
                  color: active ? T.ink : T.ink3,
                  fontFamily: F, fontSize: 13, fontWeight: active ? 600 : 500,
                  cursor: "pointer",
                  borderBottom: active ? `2px solid ${T.acc}` : "2px solid transparent",
                  marginBottom: -1,
                  transition: "color .15s, border-color .15s",
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ── URL MODE ── */}
        {captureMode === "url" && (
          <>
            {/* Link (primary) */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Link</div>
              {links[0] && (
                <LinkRow
                  key={links[0].id}
                  link={links[0]}
                  onUrlChange={(url) => updateLinkUrl(links[0].id, url)}
                  onParse={(url) => parseLink(links[0].id, url)}
                  onRemove={() => removeLink(links[0].id)}
                />
              )}
            </div>

            {/* Title */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Title</div>
              <input
                ref={titleInputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What is it?"
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 10,
                  border: `1px solid ${T.bdr}`, fontSize: 15, fontFamily: F,
                  background: T.bg, color: T.ink, outline: "none", boxSizing: "border-box",
                }}
              />
            </div>

            {/* Context */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Why you're recommending it</div>
              <textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="A line or two in your words..."
                rows={3}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 10,
                  border: `1px solid ${T.bdr}`, fontSize: 14, fontFamily: F,
                  background: T.bg, color: T.ink, outline: "none", resize: "vertical",
                  boxSizing: "border-box", lineHeight: 1.4,
                }}
              />
            </div>

            {/* Additional Links */}
            {links.length > 1 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Additional links</div>
                {links.slice(1).map((link) => (
                  <LinkRow
                    key={link.id}
                    link={link}
                    onUrlChange={(url) => updateLinkUrl(link.id, url)}
                    onParse={(url) => parseLink(link.id, url)}
                    onRemove={() => removeLink(link.id)}
                  />
                ))}
              </div>
            )}
            {firstLinkAddedOrParsed && !hasAnyEmptyLinkInput && (
              <button onClick={handleAddAnotherLink} style={{
                width: "100%", padding: "8px 12px", borderRadius: 10, marginBottom: 14,
                border: `1px dashed ${T.bdr}`, background: "transparent",
                color: T.ink3, fontSize: 12, fontFamily: F, cursor: "pointer",
              }}>
                + Add another link
              </button>
            )}

            {/* Category */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, fontFamily: F }}>Category</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", rowGap: 8 }}>
                {CATEGORIES.map((cat) => {
                  const selected = category === cat;
                  const catColor = CAT[cat]?.color || T.acc;
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      style={{
                        padding: "6px 11px", borderRadius: 999,
                        border: selected ? "none" : `1px solid ${T.bdr}`,
                        background: selected ? catColor : T.bg,
                        color: selected ? "#fff" : T.ink2,
                        fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: F,
                        textTransform: "capitalize", whiteSpace: "nowrap",
                      }}
                    >
                      {CAT[cat]?.label || cat}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tags */}
            <TagsInput tags={tags} setTags={setTags} tagInput={tagInput} setTagInput={setTagInput} saving={saving} />

            {/* Visibility */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 12, background: T.s, border: `1px solid ${T.bdr}`, marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>{visibility === "public" ? "Public" : "Private"}</div>
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>{visibility === "public" ? "Shared with your subscribers and visitors" : "Only you and your AI can see this"}</div>
              </div>
              <button onClick={() => setVisibility(v => v === "public" ? "private" : "public")} style={{
                width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                background: visibility === "public" ? "#6BAA8E" : T.bdr, transition: "background .2s",
                flexShrink: 0,
              }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: visibility === "public" ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </button>
            </div>

            {error && (
              <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "#CC665820", color: "#CC6658", fontSize: 13, fontFamily: F }}>
                {error}
              </div>
            )}

            {silentToggleJsx}

            <button
              onClick={handleSave}
              disabled={!title.trim() || saving}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 12, border: "none",
                background: (!title.trim() || saving) ? T.s2 : T.acc,
                color: (!title.trim() || saving) ? T.ink3 : T.accText,
                fontSize: 14, fontWeight: 600, cursor: (!title.trim() || saving) ? "default" : "pointer",
                fontFamily: F,
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        )}

        {/* ── PASTE MODE ── */}
        {captureMode === "paste" && (
          <>
            {/* Paste textarea */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Paste your writeup</div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste a writeup, review, or recommendation from your notes..."
                rows={8}
                disabled={saving}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 10,
                  border: `1px solid ${T.bdr}`, fontSize: 14, fontFamily: F,
                  background: T.bg, color: T.ink, outline: "none", resize: "vertical",
                  boxSizing: "border-box", lineHeight: 1.45, minHeight: 160,
                }}
              />
              <div style={{ fontSize: 11, color: T.ink3, fontFamily: F, marginTop: 6 }}>
                {pasteText.length} characters · AI will infer title, category, and why
              </div>
            </div>

            {/* Optional title */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Title <span style={{ color: T.ink3, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional — AI will suggest)</span></div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Leave blank for AI to infer"
                disabled={saving}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 10,
                  border: `1px solid ${T.bdr}`, fontSize: 15, fontFamily: F,
                  background: T.bg, color: T.ink, outline: "none", boxSizing: "border-box",
                }}
              />
            </div>

            {/* Why (optional — falls back to AI inference or text preview) */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Why <span style={{ color: T.ink3, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional — AI will fill if blank)</span></div>
              <textarea
                value={pasteWhy}
                onChange={(e) => setPasteWhy(e.target.value)}
                placeholder="A line or two in your words..."
                rows={3}
                disabled={saving}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 10,
                  border: `1px solid ${T.bdr}`, fontSize: 14, fontFamily: F,
                  background: T.bg, color: T.ink, outline: "none", resize: "vertical",
                  boxSizing: "border-box", lineHeight: 1.4,
                }}
              />
            </div>

            {/* Optional category */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, fontFamily: F }}>Category <span style={{ color: T.ink3, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", rowGap: 8 }}>
                {CATEGORIES.map((cat) => {
                  const selected = category === cat;
                  const catColor = CAT[cat]?.color || T.acc;
                  return (
                    <button
                      key={cat}
                      onClick={() => setCategory(selected ? null : cat)}
                      disabled={saving}
                      style={{
                        padding: "6px 11px", borderRadius: 999,
                        border: selected ? "none" : `1px solid ${T.bdr}`,
                        background: selected ? catColor : T.bg,
                        color: selected ? "#fff" : T.ink2,
                        fontSize: 12, fontWeight: 500, cursor: saving ? "default" : "pointer", fontFamily: F,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {CAT[cat]?.label || cat}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tags */}
            <TagsInput tags={tags} setTags={setTags} tagInput={tagInput} setTagInput={setTagInput} saving={saving} />

            {/* Visibility */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 12, background: T.s, border: `1px solid ${T.bdr}`, marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>{visibility === "public" ? "Public" : "Private"}</div>
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>{visibility === "public" ? "Shared with your subscribers and visitors" : "Only you and your AI can see this"}</div>
              </div>
              <button onClick={() => setVisibility(v => v === "public" ? "private" : "public")} style={{
                width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                background: visibility === "public" ? "#6BAA8E" : T.bdr, transition: "background .2s",
                flexShrink: 0,
              }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: visibility === "public" ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </button>
            </div>

            {error && (
              <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "#CC665820", color: "#CC6658", fontSize: 13, fontFamily: F }}>
                {error}
              </div>
            )}

            {silentToggleJsx}

            <button
              onClick={handlePasteSave}
              disabled={pasteText.trim().length < 20 || saving}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 12, border: "none",
                background: (pasteText.trim().length < 20 || saving) ? T.s2 : T.acc,
                color: (pasteText.trim().length < 20 || saving) ? T.ink3 : T.accText,
                fontSize: 14, fontWeight: 600,
                cursor: (pasteText.trim().length < 20 || saving) ? "default" : "pointer",
                fontFamily: F,
              }}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </>
        )}

        {/* ── UPLOAD MODE ── */}
        {captureMode === "upload" && (
          <>
            {/* File picker — hidden when prefilled from chat image save (preUploadedArtifact) */}
            <div style={{ marginBottom: 14 }}>
              {!preUploadedArtifact && (
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                  onChange={handleUploadFileChange}
                  style={{ display: "none" }}
                  disabled={saving}
                />
              )}
              {!uploadPreviewUrl ? (
                <button
                  type="button"
                  onClick={() => uploadInputRef.current?.click()}
                  disabled={saving}
                  style={{
                    width: "100%", minHeight: 160, borderRadius: 12,
                    border: `1px dashed ${T.bdr}`, background: T.bg,
                    color: T.ink3, fontFamily: F, fontSize: 13,
                    cursor: saving ? "default" : "pointer",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6,
                  }}
                >
                  <div style={{ color: T.ink2, fontSize: 14 }}>Tap to choose an image</div>
                  <div style={{ color: T.ink3, fontSize: 11 }}>PNG, JPEG, WebP, HEIC · max 5MB</div>
                </button>
              ) : (
                <div style={{ position: "relative" }}>
                  <img
                    src={uploadPreviewUrl}
                    alt="Upload preview"
                    style={{
                      width: "100%", maxHeight: 260, objectFit: "contain",
                      background: T.bg, borderRadius: 12, border: `1px solid ${T.bdr}`, display: "block",
                    }}
                  />
                  {preUploadedArtifact && (
                    <div style={{ textAlign: "center", marginTop: 6, fontSize: 11, fontFamily: F, color: T.ink3 }}>Image ready to save</div>
                  )}
                  {!preUploadedArtifact && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadFile(null);
                        if (uploadPreviewUrl) URL.revokeObjectURL(uploadPreviewUrl);
                        setUploadPreviewUrl(null);
                      }}
                      disabled={saving}
                      style={{
                        position: "absolute", top: 8, right: 8,
                        width: 28, height: 28, borderRadius: 14,
                        border: "none", background: "rgba(0,0,0,0.65)", color: "#fff",
                        fontSize: 14, cursor: saving ? "default" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >×</button>
                  )}
                </div>
              )}
            </div>

            {/* Upload title */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Title *</div>
              <input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="What is this? (e.g. Caribou — Midnight)"
                disabled={saving}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 10,
                  border: `1px solid ${T.bdr}`, fontSize: 15, fontFamily: F,
                  background: T.bg, color: T.ink, outline: "none", boxSizing: "border-box",
                }}
              />
            </div>

            {/* Upload why */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6, fontFamily: F }}>Why <span style={{ color: T.ink3, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>(optional)</span></div>
              <textarea
                value={uploadWhy}
                onChange={(e) => setUploadWhy(e.target.value)}
                placeholder="What makes this special?"
                rows={3}
                disabled={saving}
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 10,
                  border: `1px solid ${T.bdr}`, fontSize: 14, fontFamily: F,
                  background: T.bg, color: T.ink, outline: "none", resize: "vertical",
                  boxSizing: "border-box", lineHeight: 1.4,
                }}
              />
            </div>

            {/* Upload category */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8, fontFamily: F }}>Category *</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", rowGap: 8 }}>
                {CATEGORIES.map((cat) => {
                  const selected = uploadCategory === cat;
                  const catColor = CAT[cat]?.color || T.acc;
                  return (
                    <button
                      key={cat}
                      onClick={() => setUploadCategory(cat)}
                      disabled={saving}
                      style={{
                        padding: "6px 11px", borderRadius: 999,
                        border: selected ? "none" : `1px solid ${T.bdr}`,
                        background: selected ? catColor : T.bg,
                        color: selected ? "#fff" : T.ink2,
                        fontSize: 12, fontWeight: 500, cursor: saving ? "default" : "pointer", fontFamily: F,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {CAT[cat]?.label || cat}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tags */}
            <TagsInput tags={tags} setTags={setTags} tagInput={tagInput} setTagInput={setTagInput} saving={saving} />

            {/* Visibility */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: 12, background: T.s, border: `1px solid ${T.bdr}`, marginBottom: 18 }}>
              <div>
                <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>{visibility === "public" ? "Public" : "Private"}</div>
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>{visibility === "public" ? "Shared with your subscribers and visitors" : "Only you and your AI can see this"}</div>
              </div>
              <button onClick={() => setVisibility(v => v === "public" ? "private" : "public")} style={{
                width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                background: visibility === "public" ? "#6BAA8E" : T.bdr, transition: "background .2s",
                flexShrink: 0,
              }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: visibility === "public" ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </button>
            </div>

            {error && (
              <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "#CC665820", color: "#CC6658", fontSize: 13, fontFamily: F }}>
                {error}
              </div>
            )}

            {silentToggleJsx}

            <button
              onClick={handleUploadSave}
              disabled={(!uploadFile && !preUploadedArtifact) || !uploadTitle.trim() || !uploadCategory || saving}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 12, border: "none",
                background: ((!uploadFile && !preUploadedArtifact) || !uploadTitle.trim() || !uploadCategory || saving) ? T.s2 : T.acc,
                color: ((!uploadFile && !preUploadedArtifact) || !uploadTitle.trim() || !uploadCategory || saving) ? T.ink3 : T.accText,
                fontSize: 14, fontWeight: 600,
                cursor: ((!uploadFile && !preUploadedArtifact) || !uploadTitle.trim() || !uploadCategory || saving) ? "default" : "pointer",
                fontFamily: F,
              }}
            >
              {saving ? "Uploading..." : "Save"}
            </button>
          </>
        )}
      </div>
    </>
  );
}
