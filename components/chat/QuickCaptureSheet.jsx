'use client'

import { useState, useEffect, useRef, useMemo } from "react";
import { T, F, CAT, CATEGORIES } from "@/lib/constants";
import { useCurator } from "@/context/CuratorContext";

const URL_REGEX = /^https?:\/\/[^\s]+$/i;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_MIMES = "image/png,image/jpeg,image/webp,image/heic";

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

const todayYmd = () => new Date().toISOString().slice(0, 10);

function CategoryChip({ cat, selected, autoFilled, onClick, disabled }) {
  const catColor = CAT[cat]?.color || T.acc;
  const label = CAT[cat]?.label || cat;
  const baseStyle = {
    padding: "6px 11px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: F,
    cursor: disabled ? "default" : "pointer",
    whiteSpace: "nowrap",
    display: "inline-flex",
    alignItems: "center",
  };

  if (selected && autoFilled) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          ...baseStyle,
          background: T.accSoft,
          border: `1px dashed ${T.acc}`,
          color: T.acc,
        }}
      >
        {label}
        <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>✓</span>
      </button>
    );
  }

  if (selected) {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        style={{
          ...baseStyle,
          background: T.accSoft,
          border: `1px solid ${T.acc}`,
          color: T.acc,
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...baseStyle,
        background: "transparent",
        border: `1px solid ${T.bdr}`,
        color: T.ink2,
      }}
    >
      {label}
    </button>
  );
}

function TagsInput({ tags, setTags, tagInput, setTagInput, suggestions, onAcceptSuggestion, saving }) {
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
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: T.ink2, textTransform: "uppercase", letterSpacing: ".08em", fontFamily: F }}>Tags</span>
        <span style={{ fontSize: 11, color: T.ink3, fontFamily: F }}>Enter or comma to add more</span>
      </div>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
        background: T.bg2, border: `1px solid ${T.bdr}`, borderRadius: 8,
        padding: 10, minHeight: 44,
      }}>
        {tags.map((tag, i) => (
          <span key={i} style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: T.accSoft, border: `1px solid ${T.acc}`,
            borderRadius: 999, padding: "4px 10px", fontSize: 13, color: T.acc, fontFamily: F,
          }}>
            {tag}
            <button
              type="button"
              onClick={() => setTags(tags.filter((_, j) => j !== i))}
              disabled={saving}
              style={{
                background: "none", border: "none", color: T.acc,
                cursor: saving ? "default" : "pointer", padding: 0, fontSize: 14, lineHeight: 1, fontFamily: F, opacity: 0.7,
              }}
            >×</button>
          </span>
        ))}
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleTagKeyDown}
          placeholder={tags.length === 0 ? "Add a tag..." : ""}
          disabled={saving}
          style={{
            flex: 1, minWidth: 80, padding: "4px 0",
            border: "none", background: "transparent",
            fontSize: 14, fontFamily: F, color: T.ink, outline: "none",
          }}
        />
      </div>
      {suggestions.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
          <span style={{ fontSize: 11, color: T.ink3, fontFamily: F, textTransform: "uppercase", letterSpacing: ".08em" }}>Suggested:</span>
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onAcceptSuggestion(s)}
              disabled={saving}
              style={{
                background: "transparent",
                border: `1px dashed ${T.bdr}`,
                color: T.ink2,
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: 12,
                fontFamily: F,
                cursor: saving ? "default" : "pointer",
              }}
            >+ {s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function LinkCard({ link, onRemove, showImageOverride, onToggleImageOverride, saving }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 8,
      background: T.bg2, border: `1px solid ${T.bdr}`, borderRadius: 12,
      padding: 12, marginBottom: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {link.thumbnail ? (
          <img src={link.thumbnail} alt="" style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{ width: 48, height: 48, borderRadius: 6, background: T.s2, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, fontFamily: F, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {link.title || hostnameOf(link.url)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
            {link.source && (
              <span style={{
                background: T.s2, color: T.ink2, borderRadius: 4, padding: "2px 6px",
                fontSize: 11, fontFamily: F,
              }}>{link.source}</span>
            )}
            <span style={{ fontSize: 11, color: T.ink3, fontFamily: F, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
              {hostnameOf(link.url)}
            </span>
          </div>
        </div>
        <button
          onClick={onRemove}
          disabled={saving}
          aria-label="Remove link"
          style={{
            width: 28, height: 28, borderRadius: 14, border: "none", background: T.s2,
            color: T.ink3, fontSize: 14, cursor: saving ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}
        >×</button>
      </div>
      {showImageOverride && (
        <label style={{
          display: "flex", alignItems: "center", gap: 8,
          paddingTop: 8, borderTop: `1px solid ${T.bdr}`,
          cursor: saving ? "default" : "pointer",
        }}>
          <input
            type="checkbox"
            checked={!!link.useImageOverride}
            onChange={(e) => onToggleImageOverride(e.target.checked)}
            disabled={saving}
            style={{ accentColor: T.acc, cursor: saving ? "default" : "pointer" }}
          />
          <span style={{ fontSize: 12, color: T.ink2, fontFamily: F }}>Use uploaded image as thumbnail</span>
        </label>
      )}
    </div>
  );
}

function ImageCard({ image, isPrimary, deferredNote, onRemove, saving }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      background: T.bg2, border: `1px solid ${T.bdr}`, borderRadius: 12,
      padding: 12, marginBottom: 8,
    }}>
      <img
        src={image.previewUrl}
        alt=""
        style={{ width: 48, height: 48, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.ink, fontFamily: F, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {image.file?.name || "Uploaded image"}
        </div>
        <div style={{ fontSize: 11, color: T.ink3, fontFamily: F, marginTop: 4 }}>
          {isPrimary ? "Primary thumbnail" : (deferredNote || "")}
        </div>
      </div>
      <button
        onClick={onRemove}
        disabled={saving}
        aria-label="Remove image"
        style={{
          width: 28, height: 28, borderRadius: 14, border: "none", background: T.s2,
          color: T.ink3, fontSize: 14, cursor: saving ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        }}
      >×</button>
    </div>
  );
}

export default function QuickCaptureSheet({ isOpen, onClose, onSaved, defaultVisibility, isDesktop, profileId, initialData = null }) {
  // Unified curator-input state
  const [title, setTitle] = useState("");
  const [titleAutoFilled, setTitleAutoFilled] = useState(false);
  const [writeup, setWriteup] = useState("");
  const [category, setCategory] = useState(null);
  const [categoryAutoFilled, setCategoryAutoFilled] = useState(false);
  const [tags, setTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [visibility, setVisibility] = useState(defaultVisibility || "public");
  const [silentSave, setSilentSave] = useState(false);

  // Multi-attach
  const [attachedLinks, setAttachedLinks] = useState([]);
  const [attachedImages, setAttachedImages] = useState([]);

  // Inline link adder
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkInputValue, setLinkInputValue] = useState("");
  const [linkLoading, setLinkLoading] = useState(false);

  // Paste-to-writeup URL prompt
  const [pendingUrl, setPendingUrl] = useState(null);

  // UI state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const titleInputRef = useRef(null);
  const linkInputRef = useRef(null);
  const imageInputRef = useRef(null);

  const { profile } = useCurator();
  const showSilentToggle = profile?.isTester === true;

  // Reset state when sheet opens, OR prefill from initialData if provided
  useEffect(() => {
    if (!isOpen) return;

    // Revoke any blob URLs from previous session
    setAttachedImages((prev) => {
      prev.forEach((img) => { if (img.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl); });
      return [];
    });

    setTitle(initialData?.title || "");
    setTitleAutoFilled(false);
    setWriteup(initialData?.context || "");
    setCategory(initialData?.category || null);
    setCategoryAutoFilled(false);
    setTags(initialData?.tags || []);
    setTagInput("");
    setVisibility(defaultVisibility || "public");
    setSilentSave(false);
    setShowLinkInput(false);
    setLinkInputValue("");
    setLinkLoading(false);
    setPendingUrl(null);
    setSaving(false);
    setError(null);
    setAttachedLinks([]);

    // Pre-uploaded artifact (chat image-save handoff)
    if (initialData?.mode === "upload" && initialData?.artifactSha256) {
      setAttachedImages([{
        id: makeId("img"),
        file: null,
        previewUrl: initialData.signedUrl || null,
        sha256: initialData.artifactSha256,
        ref: initialData.artifactRef,
        mimeType: initialData.mimeType,
        sizeBytes: initialData.sizeBytes,
        uploaded: true,
      }]);
    } else if (initialData?.mode === "url" && initialData?.url && initialData?.parsedPayload) {
      // URL prefill (chat link-save handoff)
      setAttachedLinks([{
        id: makeId("lnk"),
        url: initialData.url,
        title: initialData.title || initialData.parsedPayload.title || hostnameOf(initialData.url),
        thumbnail: initialData.thumbnail_url || initialData.parsedPayload.image_url || null,
        source: initialData.provider || initialData.parsedPayload.site_name || hostnameOf(initialData.url),
        inferredCategory: initialData.category || null,
        parsedPayload: initialData.parsedPayload,
        useImageOverride: false,
      }]);
      if (initialData.title) setTitleAutoFilled(true);
      if (initialData.category) setCategoryAutoFilled(true);
    }

    setTimeout(() => titleInputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      attachedImages.forEach((img) => {
        if (img.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(img.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autofocus inline link input when opened
  useEffect(() => {
    if (showLinkInput) {
      setTimeout(() => linkInputRef.current?.focus(), 30);
    }
  }, [showLinkInput]);

  // Derived: tag suggestions from attached links' parsedPayloads
  const tagSuggestions = useMemo(() => {
    const out = new Set();
    const taken = new Set(tags.map((t) => t.toLowerCase()));
    for (const link of attachedLinks) {
      const pp = link.parsedPayload || {};
      const candidates = [
        pp.site_name,
        link.source,
        Array.isArray(pp.authors) ? pp.authors[0] : null,
      ];
      for (const raw of candidates) {
        if (!raw || typeof raw !== "string") continue;
        const norm = raw.trim().toLowerCase();
        if (!norm) continue;
        if (taken.has(norm)) continue;
        if (out.has(norm)) continue;
        out.add(norm);
      }
    }
    return Array.from(out).slice(0, 4);
  }, [attachedLinks, tags]);

  if (!isOpen) return null;

  const isDirty = title.trim() !== "" || writeup.trim() !== "" || category !== null || attachedLinks.length > 0 || attachedImages.length > 0;
  const canSave = title.trim() !== "" && writeup.trim() !== "" && !saving;

  const handleCancel = () => {
    if (isDirty && !saving) {
      if (!window.confirm("Discard this rec?")) return;
    }
    onClose();
  };

  // ── Link handlers ─────────────────────────────────────────────

  async function attachUrl(rawUrl) {
    const url = (rawUrl || "").trim();
    if (!isValidHttpUrl(url)) {
      setError("That doesn't look like a valid URL.");
      return;
    }
    setLinkLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/recs/parse-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, profileId }),
      });
      if (!res.ok) throw new Error(`parse-link returned ${res.status}`);
      const data = await res.json();

      const parsedPayload = {
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
      };

      const newLink = {
        id: makeId("lnk"),
        url,
        title: data.title || hostnameOf(url),
        thumbnail: data.thumbnail_url || null,
        source: data.provider || data.site_name || hostnameOf(url),
        inferredCategory: data.category || null,
        parsedPayload,
        useImageOverride: false,
      };

      setAttachedLinks((prev) => [...prev, newLink]);

      if ((!title.trim() || titleAutoFilled) && data.parsed_successfully && data.title) {
        setTitle(data.title);
        setTitleAutoFilled(true);
      }
      if (!category && data.category) {
        setCategory(data.category);
        setCategoryAutoFilled(true);
      }
      setShowLinkInput(false);
      setLinkInputValue("");
    } catch (err) {
      console.error("Quick capture link parse failed:", err);
      setError("Couldn't fetch that link. You can save anyway.");
    } finally {
      setLinkLoading(false);
    }
  }

  function removeLink(linkId) {
    setAttachedLinks((prev) => {
      const removed = prev.find((l) => l.id === linkId);
      const next = prev.filter((l) => l.id !== linkId);
      if (removed && titleAutoFilled && next.length === 0) {
        setTitle("");
        setTitleAutoFilled(false);
      }
      if (removed && categoryAutoFilled) {
        const stillHasCategory = next.some((l) => l.inferredCategory === category);
        if (!stillHasCategory) {
          setCategory(null);
          setCategoryAutoFilled(false);
        }
      }
      return next;
    });
  }

  function toggleLinkImageOverride(linkId, value) {
    setAttachedLinks((prev) => prev.map((l) => l.id === linkId ? { ...l, useImageOverride: value } : l));
  }

  // ── Image handlers ─────────────────────────────────────────────

  function handleImageFileChange(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = ""; // reset so same file can be re-picked
    if (files.length === 0) return;
    setError(null);

    const accepted = [];
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        setError("Only image files are supported.");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(`"${file.name}" is too large — max 5MB.`);
        continue;
      }
      accepted.push({
        id: makeId("img"),
        file,
        previewUrl: URL.createObjectURL(file),
        sha256: null,
        ref: null,
        mimeType: file.type,
        sizeBytes: file.size,
        uploaded: false,
      });
    }
    if (accepted.length > 0) {
      setAttachedImages((prev) => [...prev, ...accepted]);
    }
  }

  function removeImage(imageId) {
    setAttachedImages((prev) => {
      const removed = prev.find((i) => i.id === imageId);
      if (removed?.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter((i) => i.id !== imageId);
    });
  }

  // ── Writeup paste-to-link prompt ───────────────────────────────

  function handleWriteupPaste(e) {
    const pasted = (e.clipboardData?.getData("text") || "").trim();
    if (pasted && pasted.length < 500 && URL_REGEX.test(pasted)) {
      e.preventDefault();
      setPendingUrl(pasted);
    }
  }

  async function acceptPendingUrlAsLink() {
    const u = pendingUrl;
    setPendingUrl(null);
    if (u) await attachUrl(u);
  }

  function keepPendingUrlAsText() {
    if (pendingUrl) {
      setWriteup((prev) => (prev ? `${prev} ${pendingUrl}` : pendingUrl).trim());
    }
    setPendingUrl(null);
  }

  // ── Save logic ─────────────────────────────────────────────────

  function buildBaseItem({ parsedPayload, links, createdVia, contextOverride, tagsOverride }) {
    const today = todayYmd();
    return {
      title: title.trim(),
      category: category || "other",
      context: (contextOverride ?? writeup).trim(),
      tags: tagsOverride ?? tags,
      links: links || [],
      visibility,
      date: today,
      revision: 1,
      revisions: [{ rev: 1, date: today, change: "Created" }],
      parsedPayload: parsedPayload || null,
      createdVia: initialData?.createdViaOverride || createdVia,
      silent: silentSave,
    };
  }

  async function uploadOverrideImage(image) {
    // Storage-only upload: we just need the artifact sha + ref to splice into the
    // link's parsedPayload. No rec/file rows are created here — the link path
    // creates the rec.
    const fd = new FormData();
    fd.append("file", image.file);
    fd.append("profileId", profileId);

    const res = await fetch("/api/recs/upload-artifact", { method: "POST", body: fd });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Upload failed (${res.status})`);
    }
    return await res.json();
  }

  async function saveCaseUrl() {
    // CASE A or C: links present. First link drives metadata.
    let parsedPayload = { ...attachedLinks[0].parsedPayload };

    // CASE C: first link has image-override checked AND there is an image to use
    const overrideLink = attachedLinks.find((l) => l.useImageOverride);
    const overrideImage = attachedImages[0];
    if (overrideLink && overrideImage) {
      let sha;
      let ref;
      if (overrideImage.uploaded) {
        sha = overrideImage.sha256;
        ref = overrideImage.ref;
      } else {
        const uploaded = await uploadOverrideImage(overrideImage);
        sha = uploaded.artifact_sha256;
        ref = uploaded.artifact_ref;
      }
      if (sha) {
        // If the override is on a non-primary link, also reflect it on parsedPayload
        // since parsedPayload here is the FIRST link's payload.
        parsedPayload = { ...parsedPayload, image_url: `artifact://${sha}`, artifact_sha256: sha, artifact_ref: ref };
      }
    }

    const linksForDb = attachedLinks.map((l) => ({
      url: l.url,
      type: (l.source || "website").toLowerCase().replace(/\s+/g, "_"),
      label: l.title || hostnameOf(l.url),
    }));

    const item = buildBaseItem({
      parsedPayload,
      links: linksForDb,
      createdVia: "quick_capture_url",
    });
    return await onSaved(item);
  }

  async function saveCaseUpload() {
    // CASE B: image(s) only, no links. First image is primary; additional deferred.
    const primary = attachedImages[0];
    if (!primary) throw new Error("No image attached.");

    let parsedPayload;
    if (primary.uploaded) {
      // JSON path — pre-uploaded artifact
      const res = await fetch("/api/recs/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          artifactSha256: primary.sha256,
          artifactRef: primary.ref,
          mimeType: primary.mimeType,
          sizeBytes: primary.sizeBytes,
          title: title.trim(),
          category: category || "other",
          why: writeup.trim(),
          tags,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      parsedPayload = data.parsedPayload;
    } else {
      // Multipart path — fresh upload
      const fd = new FormData();
      fd.append("file", primary.file);
      fd.append("profileId", profileId);
      fd.append("title", title.trim());
      fd.append("category", category || "other");
      if (writeup) fd.append("why", writeup.trim());
      if (tags.length > 0) fd.append("tags", tags.join(","));

      const res = await fetch("/api/recs/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || `Upload failed (${res.status})`);
      }
      const data = await res.json();
      parsedPayload = data.parsedPayload;
    }

    const item = buildBaseItem({
      parsedPayload,
      links: [],
      createdVia: "quick_capture_upload",
    });
    return await onSaved(item);
  }

  async function saveCasePaste() {
    // CASE D: no attachments. Writeup-only. Inference fills in any blanks (category/tags).
    const res = await fetch("/api/recs/paste", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body_text: writeup.trim(),
        profileId,
        title: title.trim() || undefined,
        category: category || undefined,
        tags: tags.length > 0 ? tags : undefined,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `Paste save failed (${res.status})`);
    }
    const data = await res.json();

    const finalCategory = category || data.category || "other";
    const finalTags = tags.length > 0 ? tags : (data.tags || []);

    const item = buildBaseItem({
      parsedPayload: data.parsedPayload,
      links: [],
      createdVia: "quick_capture_paste",
      tagsOverride: finalTags,
    });
    item.category = finalCategory;
    return await onSaved(item);
  }

  async function handleSaveClick() {
    if (!canSave) return;
    setSaving(true);
    setError(null);

    try {
      const hasLinks = attachedLinks.length > 0;
      const hasImages = attachedImages.length > 0;

      let saved;
      if (hasLinks) {
        saved = await saveCaseUrl();
      } else if (hasImages) {
        saved = await saveCaseUpload();
      } else {
        saved = await saveCasePaste();
      }
      if (!saved) throw new Error("Couldn't save. Try again.");
    } catch (err) {
      console.error("[QUICK_CAPTURE_SAVE_ERROR]", err);
      setError(err.message || "Couldn't save. Try again.");
      setSaving(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  const sheetStyle = isDesktop
    ? {
        position: "fixed",
        top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(560px, 92vw)",
        maxHeight: "88dvh",
        background: T.s,
        border: `1px solid ${T.bdr}`,
        borderRadius: 16,
        padding: 28,
        overflowY: "auto",
        zIndex: 101,
        boxSizing: "border-box",
      }
    : {
        position: "fixed",
        left: 0, right: 0, bottom: 0,
        background: T.s,
        borderTop: `1px solid ${T.bdr}`,
        borderRadius: "16px 16px 0 0",
        padding: 20,
        maxHeight: "92dvh",
        overflowY: "auto",
        zIndex: 101,
        boxSizing: "border-box",
      };

  const sectionLabel = (text, optional) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 500, color: T.ink2, textTransform: "uppercase", letterSpacing: ".08em", fontFamily: F }}>
        {text}
        {optional?.required && <span style={{ color: T.acc, fontWeight: 600, fontSize: 12, marginLeft: 4 }}>*</span>}
      </span>
      {optional?.hint && (
        <span style={{ fontSize: 11, color: T.ink3, fontFamily: F }}>{optional.hint}</span>
      )}
    </div>
  );

  const titleHint = (() => {
    if (attachedLinks.length > 0 && titleAutoFilled) return "from link · edit if needed";
    if (attachedLinks.length > 0 && !title) return "auto-filled from link";
    return null;
  })();

  const writeupPlaceholder = (attachedLinks.length === 0 && attachedImages.length === 0)
    ? "What's good about it? Drop a thought, a paragraph, or a longer writeup..."
    : "A line or two on why this...";

  const categoryHint = (category && categoryAutoFilled) ? "· tap to change" : null;

  const showImageOverrideOnFirstLink = attachedLinks.length > 0 && attachedImages.length > 0;
  const firstLinkId = attachedLinks[0]?.id;

  return (
    <>
      <div
        onClick={handleCancel}
        style={{
          position: "fixed", inset: 0, background: "rgba(0, 0, 0, 0.55)", zIndex: 100,
        }}
      />
      <div style={sheetStyle}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, color: T.ink, fontFamily: F }}>Recommendation</div>
            <div style={{ fontSize: 12, color: T.ink3, fontFamily: F, marginTop: 4 }}>Everything you save is added to your Record</div>
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

        {/* Title (primary) — textarea with inline action row */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: T.ink2, textTransform: "uppercase", letterSpacing: ".08em", fontFamily: F }}>
              What you are recommending
              <span style={{ color: T.acc, fontWeight: 600, fontSize: 12, marginLeft: 4 }}>*</span>
            </span>
            {titleHint && (
              <span style={{ fontSize: 11, color: T.ink3, fontFamily: F }}>{titleHint}</span>
            )}
          </div>
          <div style={{ background: T.bg2, border: `1px solid ${T.bdr}`, borderRadius: 10, padding: 4 }}>
            <textarea
              ref={titleInputRef}
              value={title}
              onChange={(e) => { setTitle(e.target.value); setTitleAutoFilled(false); }}
              placeholder="Name what you're recommending"
              rows={2}
              disabled={saving}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                fontFamily: F, fontSize: 15, fontWeight: 500,
                color: T.ink,
                padding: "14px 16px 6px 16px",
                lineHeight: 1.5,
                outline: "none",
                resize: "vertical",
                minHeight: 60,
                boxSizing: "border-box",
                display: "block",
              }}
            />
            <div style={{ display: "flex", gap: 8, padding: "8px 12px 10px 12px" }}>
              <button
                type="button"
                onClick={() => { setShowLinkInput(true); setError(null); }}
                disabled={saving || showLinkInput}
                style={{
                  padding: "6px 12px",
                  background: "transparent",
                  border: `1px solid ${T.bdr}`,
                  borderRadius: 8,
                  color: T.ink2,
                  fontSize: 12, fontFamily: F, fontWeight: 500,
                  cursor: saving || showLinkInput ? "default" : "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                  opacity: showLinkInput ? 0.5 : 1,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.acc} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Link
              </button>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={saving}
                style={{
                  padding: "6px 12px",
                  background: "transparent",
                  border: `1px solid ${T.bdr}`,
                  borderRadius: 8,
                  color: T.ink2,
                  fontSize: 12, fontFamily: F, fontWeight: 500,
                  cursor: saving ? "default" : "pointer",
                  display: "inline-flex", alignItems: "center", gap: 6,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.acc} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                Image
              </button>
              <input
                ref={imageInputRef}
                type="file"
                accept={ACCEPTED_IMAGE_MIMES}
                multiple
                onChange={handleImageFileChange}
                style={{ display: "none" }}
                disabled={saving}
              />
            </div>
          </div>
        </div>

        {/* Attached items — unlabeled, conditional */}
        {(attachedLinks.length > 0 || attachedImages.length > 0 || showLinkInput) && (
          <div style={{ marginTop: 16 }}>
            {attachedLinks.map((link) => (
              <LinkCard
                key={link.id}
                link={link}
                onRemove={() => removeLink(link.id)}
                showImageOverride={showImageOverrideOnFirstLink && link.id === firstLinkId}
                onToggleImageOverride={(v) => toggleLinkImageOverride(link.id, v)}
                saving={saving}
              />
            ))}
            {attachedImages.map((image, idx) => (
              <ImageCard
                key={image.id}
                image={image}
                isPrimary={idx === 0 && !attachedLinks.length}
                deferredNote={idx > 0 ? "Only the first image is saved as the rec thumbnail right now." : null}
                onRemove={() => removeImage(image.id)}
                saving={saving}
              />
            ))}
            {showLinkInput && (
              <div style={{
                display: "flex", gap: 8, alignItems: "center",
                marginBottom: 8, padding: 8,
                background: T.bg2, border: `1px solid ${T.bdr}`, borderRadius: 8,
              }}>
                <input
                  ref={linkInputRef}
                  value={linkInputValue}
                  onChange={(e) => setLinkInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && URL_REGEX.test(linkInputValue.trim())) {
                      e.preventDefault();
                      attachUrl(linkInputValue.trim());
                    } else if (e.key === "Escape") {
                      setShowLinkInput(false);
                      setLinkInputValue("");
                    }
                  }}
                  placeholder="Paste or type a URL"
                  disabled={linkLoading || saving}
                  style={{
                    flex: 1, padding: "10px 12px", borderRadius: 6,
                    border: `1px solid ${T.bdr}`, fontSize: 14, fontFamily: F,
                    background: T.s, color: T.ink, outline: "none", minWidth: 0,
                  }}
                />
                {linkLoading ? (
                  <div style={{
                    width: 16, height: 16, borderRadius: 8,
                    border: `2px solid ${T.bdr}`, borderTopColor: T.acc,
                    animation: "qcSpin 700ms linear infinite",
                  }} />
                ) : (
                  <button
                    onClick={() => attachUrl(linkInputValue.trim())}
                    disabled={!URL_REGEX.test(linkInputValue.trim()) || saving}
                    style={{
                      padding: "8px 14px", borderRadius: 6, border: "none",
                      background: URL_REGEX.test(linkInputValue.trim()) ? T.acc : T.s2,
                      color: URL_REGEX.test(linkInputValue.trim()) ? T.accText : T.ink3,
                      fontSize: 13, fontFamily: F, fontWeight: 500,
                      cursor: URL_REGEX.test(linkInputValue.trim()) ? "pointer" : "default",
                    }}
                  >Add</button>
                )}
                <button
                  onClick={() => { setShowLinkInput(false); setLinkInputValue(""); }}
                  aria-label="Cancel"
                  style={{
                    width: 28, height: 28, borderRadius: 14, border: "none", background: "transparent",
                    color: T.ink3, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
                  }}
                >×</button>
              </div>
            )}
          </div>
        )}

        {/* Why */}
        <div style={{ marginBottom: 20, paddingTop: 20, borderTop: `1px solid ${T.bdr}` }}>
          {sectionLabel("Why you're recommending it", { required: true })}
          <textarea
            value={writeup}
            onChange={(e) => setWriteup(e.target.value)}
            onPaste={handleWriteupPaste}
            placeholder={writeupPlaceholder}
            disabled={saving}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 8,
              border: `1px solid ${T.bdr}`, fontSize: 15, fontFamily: F,
              background: T.bg2, color: T.ink, outline: "none", resize: "vertical",
              boxSizing: "border-box", lineHeight: 1.5, minHeight: 110,
            }}
          />

          {pendingUrl && (
            <div style={{
              marginTop: 10, padding: 12, borderRadius: 8,
              background: T.accSoft, border: `1px solid ${T.acc}`,
            }}>
              <div style={{ fontSize: 13, color: T.ink, fontFamily: F, marginBottom: 8 }}>
                Looks like a link. How should we add it?
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={acceptPendingUrlAsLink}
                  style={{
                    padding: "6px 12px", borderRadius: 6, border: "none",
                    background: T.acc, color: T.accText,
                    fontSize: 12, fontFamily: F, fontWeight: 500, cursor: "pointer",
                  }}
                >Attach as link</button>
                <button
                  onClick={keepPendingUrlAsText}
                  style={{
                    padding: "6px 12px", borderRadius: 6,
                    border: `1px solid ${T.acc}`, background: "transparent",
                    color: T.acc, fontSize: 12, fontFamily: F, fontWeight: 500, cursor: "pointer",
                  }}
                >Keep as text</button>
              </div>
            </div>
          )}
        </div>

        {/* Category */}
        <div style={{ marginBottom: 20, paddingTop: 20, borderTop: `1px solid ${T.bdr}` }}>
          {sectionLabel("Category", { hint: categoryHint })}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", rowGap: 8 }}>
            {CATEGORIES.map((cat) => (
              <CategoryChip
                key={cat}
                cat={cat}
                selected={category === cat}
                autoFilled={categoryAutoFilled && category === cat}
                onClick={() => {
                  setCategoryAutoFilled(false);
                  setCategory((prev) => (prev === cat ? null : cat));
                }}
                disabled={saving}
              />
            ))}
          </div>
        </div>

        {/* Tags */}
        <div style={{ paddingTop: 20, borderTop: `1px solid ${T.bdr}` }}>
          <TagsInput
            tags={tags}
            setTags={setTags}
            tagInput={tagInput}
            setTagInput={setTagInput}
            suggestions={tagSuggestions}
            onAcceptSuggestion={(s) => {
              if (!tags.includes(s)) setTags((prev) => [...prev, s]);
            }}
            saving={saving}
          />
        </div>

        {/* Public + Silent (no disclosure) */}
        <div style={{ marginTop: 24 }}>
          {/* Public toggle row */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", borderRadius: 12, background: T.bg2,
            border: `1px solid ${T.bdr}`, marginBottom: 12,
          }}>
            <div>
              <div style={{ fontFamily: F, fontWeight: 500, fontSize: 15, color: T.ink }}>Public</div>
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink2, marginTop: 2 }}>
                Shared with your subscribers and visitors
              </div>
            </div>
            <button
              onClick={() => setVisibility((v) => v === "public" ? "private" : "public")}
              disabled={saving}
              aria-label="Toggle public"
              style={{
                width: 48, height: 28, borderRadius: 14, border: "none",
                cursor: saving ? "default" : "pointer", position: "relative",
                background: visibility === "public" ? "#6BAA8E" : T.bdr,
                transition: "background .2s", flexShrink: 0,
              }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: 11, background: "#fff",
                position: "absolute", top: 3,
                left: visibility === "public" ? 23 : 3,
                transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </button>
          </div>

          {/* Silent (testers only) */}
          {showSilentToggle && (
            <label style={{
              display: "flex", alignItems: "flex-start", gap: 10,
              padding: "4px 4px 14px 4px",
              cursor: saving ? "default" : "pointer",
            }}>
              <input
                type="checkbox"
                checked={silentSave}
                onChange={(e) => setSilentSave(e.target.checked)}
                disabled={saving}
                style={{ marginTop: 2, accentColor: T.acc, cursor: saving ? "default" : "pointer" }}
              />
              <div>
                <div style={{ fontFamily: F, fontWeight: 500, fontSize: 14, color: T.ink }}>
                  Save silently (don't notify subscribers)
                </div>
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink2, marginTop: 2, lineHeight: 1.4 }}>
                  Rec still saves and appears in subscriber feeds. Only suppresses the email alert.
                </div>
              </div>
            </label>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{
            marginBottom: 12, padding: "10px 12px", borderRadius: 8,
            background: "#CC665820", color: "#CC6658", fontSize: 13, fontFamily: F,
          }}>
            {error}
          </div>
        )}

        {/* Save */}
        <button
          onClick={handleSaveClick}
          disabled={!canSave}
          style={{
            width: "100%", padding: "14px 16px", borderRadius: 12, border: "none",
            background: canSave ? T.acc : T.s2,
            color: canSave ? T.accText : T.ink3,
            fontSize: 14, fontWeight: 500, fontFamily: F,
            cursor: canSave ? "pointer" : "default",
          }}
        >
          {saving ? "Saving..." : "Save recommendation"}
        </button>
      </div>
      <style>{`@keyframes qcSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
