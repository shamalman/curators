"use client";

// ── Design-lab ThemeProvider (dev/preview only) ──
//
// Activates ONLY when the URL has ?theme=<id> or ?designlab=1. With neither,
// this renders null and runs no effects, so production is byte-identical to
// today (T/W/V tokens resolve to their var() fallbacks).
//
// When active it sets data-theme="<id>" on <html> and injects a <style> that
// defines the theme's --cp-* overrides + font vars. Blank/TODO placeholder
// values are skipped, so an unfilled theme leaves the production fallbacks in
// place instead of rendering garbage. Alternate fonts (googleFontsHref) load
// via an injected <link> only while that theme is active — never on a normal
// page view.

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { THEMES, getTheme, DEFAULT_THEME_ID } from "@/lib/themes/themes";

const STYLE_EL_ID = "cp-theme-vars";
const FONT_EL_ID = "cp-theme-font";

// A value is "real" (safe to apply) when it's a non-empty, non-TODO string.
function isRealValue(v) {
  return typeof v === "string" && v.trim() !== "" && !v.includes("TODO");
}

function buildThemeCss(theme) {
  const decls = [];
  for (const [key, val] of Object.entries(theme.cssVars || {})) {
    if (isRealValue(val)) decls.push(`${key}:${val};`);
  }
  const fonts = theme.fonts || {};
  if (isRealValue(fonts.display)) decls.push(`--cp-font-display:${fonts.display};`);
  if (isRealValue(fonts.text)) decls.push(`--cp-font-text:${fonts.text};`);
  if (isRealValue(fonts.mono)) decls.push(`--cp-font-mono:${fonts.mono};`);
  if (!decls.length) return "";
  return `[data-theme="${theme.id}"]{${decls.join("")}}`;
}

function applyTheme(themeId) {
  const theme = getTheme(themeId);
  const html = document.documentElement;
  if (!theme) return;

  html.setAttribute("data-theme", theme.id);

  let styleEl = document.getElementById(STYLE_EL_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_EL_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = buildThemeCss(theme);

  // Alternate font <link> — only while a theme that needs one is active.
  const existingFont = document.getElementById(FONT_EL_ID);
  if (theme.googleFontsHref) {
    if (existingFont) {
      if (existingFont.getAttribute("href") !== theme.googleFontsHref) {
        existingFont.setAttribute("href", theme.googleFontsHref);
      }
    } else {
      const link = document.createElement("link");
      link.id = FONT_EL_ID;
      link.rel = "stylesheet";
      link.href = theme.googleFontsHref;
      document.head.appendChild(link);
    }
  } else if (existingFont) {
    existingFont.remove();
  }
}

function clearTheme() {
  document.documentElement.removeAttribute("data-theme");
  document.getElementById(STYLE_EL_ID)?.remove();
  document.getElementById(FONT_EL_ID)?.remove();
}

export default function ThemeProvider() {
  const searchParams = useSearchParams();
  const designlab = searchParams.get("designlab") === "1";
  const themeParam = searchParams.get("theme");
  const enabled = designlab || Boolean(themeParam);

  // Active theme: explicit ?theme= wins; otherwise default when in the lab.
  const initialId =
    (themeParam && getTheme(themeParam) ? themeParam : null) ||
    (designlab ? DEFAULT_THEME_ID : null);
  const [activeId, setActiveId] = useState(initialId);

  // Keep state in sync if the URL param changes (e.g. back/forward nav).
  useEffect(() => {
    setActiveId(initialId);
  }, [initialId]);

  useEffect(() => {
    if (!enabled || !activeId) {
      clearTheme();
      return;
    }
    applyTheme(activeId);
    return () => clearTheme();
  }, [enabled, activeId]);

  function selectTheme(id) {
    setActiveId(id);
    // Reflect selection in the URL without a full navigation.
    const params = new URLSearchParams(window.location.search);
    params.set("theme", id);
    params.set("designlab", "1");
    const next = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, "", next);
  }

  // Never render UI or run outside the lab — production stays untouched.
  if (!designlab) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 2147483647,
        background: "#0c0c0f",
        border: "1px solid #34343c",
        borderRadius: 12,
        padding: 12,
        width: 208,
        boxShadow: "0 8px 30px rgba(0,0,0,0.55)",
        fontFamily: "system-ui,-apple-system,sans-serif",
        color: "#e6e6ea",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#8a8a94",
          marginBottom: 8,
        }}
      >
        Design Lab
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {THEMES.map((t) => {
          const active = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTheme(t.id)}
              style={{
                textAlign: "left",
                cursor: "pointer",
                borderRadius: 8,
                padding: "8px 10px",
                fontSize: 13,
                lineHeight: 1.2,
                border: active ? "1px solid #6b9ec2" : "1px solid #2a2a31",
                background: active ? "#16222c" : "#141419",
                color: active ? "#dbeaf5" : "#c8c8d0",
              }}
            >
              {t.name}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "#5c5c66", marginTop: 8 }}>
        {activeId ? `data-theme="${activeId}"` : "no theme"}
      </div>
    </div>
  );
}
