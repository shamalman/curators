"use client";

import { useEffect, useState } from "react";
import { T, F, S } from "@/lib/constants";

// Bottom-sheet primitive shared by FeedbackSheet, QuickCaptureSheet, and
// ValidationSheet. Renders a fixed backdrop and a sheet container that is
// a centered modal on desktop and a bottom sheet on mobile. Title, subtitle,
// and footer slots are optional. The body is rendered as children with no
// padding by default; pass bodyPadding to override.
//
// Discard-guard logic stays in the parent. Pass an onClose handler that
// runs the dirty check before calling the actual close.
export default function Sheet({
  isOpen,
  onClose,
  title,
  subtitle,
  width = 480,
  bodyPadding = "16px 22px",
  background,
  children,
  footer = null,
}) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const bg = background || T.bg2;
  const hasHeader = Boolean(title || subtitle);

  const sheetStyle = isDesktop
    ? {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width,
        maxWidth: "92vw",
        maxHeight: "85vh",
        background: bg,
        borderRadius: 16,
        border: `1px solid ${T.bdr}`,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        fontFamily: F,
      }
    : {
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: "92dvh",
        background: bg,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        border: `1px solid ${T.bdr}`,
        borderBottom: "none",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        fontFamily: F,
        boxSizing: "border-box",
      };

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.5)",
          zIndex: 999,
        }}
      />
      <div style={sheetStyle}>
        {hasHeader && (
          <div
            style={{
              padding: "20px 22px 12px",
              borderBottom: `1px solid ${T.bdr}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {title && (
                <div
                  style={{
                    fontFamily: S,
                    fontSize: 22,
                    fontWeight: 500,
                    color: T.ink,
                    lineHeight: 1.2,
                  }}
                >
                  {title}
                </div>
              )}
              {subtitle && (
                <div
                  style={{
                    fontFamily: F,
                    fontSize: 13,
                    color: T.ink2,
                    marginTop: 4,
                  }}
                >
                  {subtitle}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: "none",
                border: "none",
                color: T.ink3,
                fontSize: 22,
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                fontFamily: F,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        )}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: bodyPadding,
            boxSizing: "border-box",
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: "12px 22px 18px",
              borderTop: `1px solid ${T.bdr}`,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
