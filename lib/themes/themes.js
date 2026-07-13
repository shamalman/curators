// ── Design-lab theme registry ──
//
// Each theme overrides the --cp-* CSS custom properties that lib/constants.js
// (T / W / V / F / S / MN) reads via var(..., <fallback>). A theme is applied
// ONLY under ?theme=<id> or the ?designlab=1 switcher — see
// components/theme/ThemeProvider.jsx. With no theme active, tokens fall back to
// their production hex and the app renders exactly as today.
//
// To add a token: add the --cp-* key to EVERY theme's cssVars (keep the key set
// identical across all themes) and add the matching var() in lib/constants.js.
//
// Fonts: `fonts` maps to --cp-font-display / --cp-font-text / --cp-font-mono.
// `googleFontsHref`, when set, is injected as a <link> ONLY while that theme is
// active, so alternate font weights never load on a normal page view. Leave it
// null for themes that reuse the fonts already loaded in app/layout.js.

export const DEFAULT_THEME_ID = "paper-ink";

// Canonical key order — every theme's cssVars must define exactly these keys.
export const CSS_VAR_KEYS = [
  // Base theme (T)
  "--cp-t-bg", "--cp-t-bg2", "--cp-t-s", "--cp-t-s2", "--cp-t-s3",
  "--cp-t-ink", "--cp-t-ink2", "--cp-t-ink3",
  "--cp-t-bdr", "--cp-t-acc", "--cp-t-accText", "--cp-t-accSoft",
  // Curator workspace (W)
  "--cp-w-bg", "--cp-w-s", "--cp-w-s2", "--cp-w-bdr",
  "--cp-w-aiBub", "--cp-w-aiBdr", "--cp-w-aiBdrSoft",
  "--cp-w-userBub", "--cp-w-userTxt",
  "--cp-w-accent", "--cp-w-accentSoft",
  "--cp-w-chip", "--cp-w-chipBdr", "--cp-w-inputBg", "--cp-w-inputBdr",
  // Visitor AI (V)
  "--cp-v-bg", "--cp-v-s", "--cp-v-bdr",
  "--cp-v-aiBub", "--cp-v-userBub", "--cp-v-userTxt",
  "--cp-v-chip", "--cp-v-chipBdr", "--cp-v-inputBg", "--cp-v-inputBdr",
];

// Build a cssVars object with every canonical key set to `value` (used to seed
// blank placeholder themes so their key set matches paper-ink exactly).
function blankVars(value) {
  const out = {};
  for (const k of CSS_VAR_KEYS) out[k] = value;
  return out;
}

export const THEMES = [
  {
    id: "paper-ink",
    name: "Paper & Ink",
    cssVars: {
      // Base theme (T)
      "--cp-t-bg": "#131210", "--cp-t-bg2": "#1A1714", "--cp-t-s": "#201D18", "--cp-t-s2": "#2A2620", "--cp-t-s3": "#332F28",
      "--cp-t-ink": "#E8E2D6", "--cp-t-ink2": "#A09888", "--cp-t-ink3": "#6B6258",
      "--cp-t-bdr": "#302B25", "--cp-t-acc": "#D4956B", "--cp-t-accText": "#131210", "--cp-t-accSoft": "#D4956B20",
      // Curator workspace (W)
      "--cp-w-bg": "#101214", "--cp-w-s": "#181B20", "--cp-w-s2": "#1F2329", "--cp-w-bdr": "#262B33",
      "--cp-w-aiBub": "#181B20", "--cp-w-aiBdr": "#3B7BF6", "--cp-w-aiBdrSoft": "#3B7BF620",
      "--cp-w-userBub": "#D4956B", "--cp-w-userTxt": "#101214",
      "--cp-w-accent": "#6B9EC2", "--cp-w-accentSoft": "#6B9EC220",
      "--cp-w-chip": "#181B20", "--cp-w-chipBdr": "#262B33", "--cp-w-inputBg": "#181B20", "--cp-w-inputBdr": "#262B33",
      // Visitor AI (V)
      "--cp-v-bg": "#151310", "--cp-v-s": "#1E1A15", "--cp-v-bdr": "#302A22",
      "--cp-v-aiBub": "#1E1A15", "--cp-v-userBub": "#A09888", "--cp-v-userTxt": "#151310",
      "--cp-v-chip": "#1E1A15", "--cp-v-chipBdr": "#302A22", "--cp-v-inputBg": "#1E1A15", "--cp-v-inputBdr": "#302A22",
    },
    fonts: {
      display: "'Newsreader',serif",
      text: "'Manrope',sans-serif",
      mono: "'JetBrains Mono',monospace",
    },
    // Already loaded in app/layout.js — no extra <link> needed.
    googleFontsHref: null,
  },

  // ── Placeholders — fill in later. Same keys as paper-ink; blank/TODO values.
  {
    id: "theme-2",
    name: "Theme 2 (TODO)",
    cssVars: blankVars("/* TODO */"),
    fonts: { display: "", text: "", mono: "" },
    googleFontsHref: null,
  },
  {
    id: "theme-3",
    name: "Theme 3 (TODO)",
    cssVars: blankVars("/* TODO */"),
    fonts: { display: "", text: "", mono: "" },
    googleFontsHref: null,
  },
  {
    id: "theme-4",
    name: "Theme 4 (TODO)",
    cssVars: blankVars("/* TODO */"),
    fonts: { display: "", text: "", mono: "" },
    googleFontsHref: null,
  },
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || null;
}
