'use client'

import { useState, useRef, useEffect } from "react";
import { T, F } from "@/lib/constants";
import Sheet from "@/components/ui/Sheet";

export default function FeedbackSheet({ isOpen, onClose, profileId, handle, isDesktop }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const textareaRef = useRef(null);
  // Day 3: optional screenshot attachment
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotError, setScreenshotError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen]);

  function handleClose() {
    if (saving) return;
    if (text.trim() && !done) {
      if (!window.confirm('Discard feedback?')) return;
    }
    setText('');
    setError(null);
    setDone(false);
    setScreenshot(null);
    setScreenshotError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  }

  async function handleScreenshotFile(file) {
    setScreenshotError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setScreenshotError('Must be an image.');
      return;
    }

    const MAX_EDGE = 1600;
    const JPEG_QUALITY = 0.85;
    const MAX_BASE64_SIZE = 5.5 * 1024 * 1024; // ~4MB of bytes after base64 overhead

    try {
      const objectUrl = URL.createObjectURL(file);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('image decode failed'));
        el.src = objectUrl;
      });

      let { width, height } = img;
      if (width > MAX_EDGE || height > MAX_EDGE) {
        if (width >= height) {
          height = Math.round(height * (MAX_EDGE / width));
          width = MAX_EDGE;
        } else {
          width = Math.round(width * (MAX_EDGE / height));
          height = MAX_EDGE;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(objectUrl);

      const base64 = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

      if (base64.length > MAX_BASE64_SIZE) {
        setScreenshotError('Image too large even after resize. Try a smaller screenshot.');
        return;
      }

      setScreenshot({ base64, mimeType: 'image/jpeg' });
    } catch (err) {
      console.error('[FEEDBACK_SCREENSHOT_RESIZE_ERROR]', err?.message || err);
      const isHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
      setScreenshotError(isHeic ? 'HEIC/HEIF not supported. Try JPG or PNG.' : 'Could not process image.');
    }
  }

  function handleRemoveScreenshot() {
    setScreenshot(null);
    setScreenshotError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleSubmit() {
    if (!text.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const body = {
        profileId,
        handle,
        originalMessage: text.trim(),
        elaboration: null,
        summary: null,
      };
      if (screenshot) {
        body.screenshot_base64 = screenshot.base64.replace(/^data:image\/jpeg;base64,/, '');
        body.screenshot_mime_type = screenshot.mimeType;
      }
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to send');
      setDone(true);
      setTimeout(() => {
        setText('');
        setScreenshot(null);
        setScreenshotError(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setDone(false);
        onClose();
      }, 1200);
    } catch (e) {
      setError('Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      isOpen={isOpen}
      onClose={handleClose}
      title="Share feedback"
      bodyPadding={isDesktop ? "24px" : "20px 16px 32px"}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {done ? (
          <div style={{ color: T.acc, fontSize: 14, textAlign: 'center', padding: '16px 0' }}>
            Thanks — got it.
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="What's on your mind? Bug, idea, reaction — anything."
              style={{
                background: T.bg,
                border: `1px solid ${T.bdr}`,
                borderRadius: 10,
                padding: '12px 14px',
                color: T.ink,
                fontSize: 16,
                fontFamily: F,
                resize: 'none',
                minHeight: 120,
                outline: 'none',
                width: '100%',
                boxSizing: 'border-box',
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => { handleScreenshotFile(e.target.files?.[0]); }}
            />
            {!screenshot ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  background: 'transparent',
                  border: `1px solid ${T.bdr}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  color: T.ink3,
                  fontSize: 12,
                  fontFamily: F,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  alignSelf: 'flex-start',
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="6" width="20" height="14" rx="2"/>
                  <circle cx="12" cy="13" r="4"/>
                  <path d="M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2"/>
                </svg>
                Attach screenshot (optional)
              </button>
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px',
                borderRadius: 8,
                background: T.s2,
                alignSelf: 'flex-start',
                fontSize: 12, fontFamily: F, color: T.ink,
              }}>
                <span>Screenshot attached {"✓"}</span>
                <button
                  type="button"
                  onClick={handleRemoveScreenshot}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: T.ink3,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontFamily: F,
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  Remove
                </button>
              </div>
            )}
            {screenshotError && (
              <div style={{ color: '#e05c5c', fontSize: 12 }}>{screenshotError}</div>
            )}
            {error && (
              <div style={{ color: '#e05c5c', fontSize: 12 }}>{error}</div>
            )}
            <button
              onClick={handleSubmit}
              disabled={!text.trim() || saving}
              style={{
                background: text.trim() && !saving ? T.acc : T.s2,
                color: text.trim() && !saving ? '#fff' : T.ink3,
                border: 'none',
                borderRadius: 10,
                padding: '12px 0',
                fontSize: 14,
                fontWeight: 600,
                cursor: text.trim() && !saving ? 'pointer' : 'not-allowed',
                fontFamily: F,
                transition: 'background 150ms ease',
              }}
            >
              {saving ? 'Sending...' : 'Send feedback'}
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
