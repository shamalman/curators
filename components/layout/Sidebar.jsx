'use client'

import { usePathname, useRouter } from "next/navigation";
import { useContext } from "react";
import { T, F, S } from "@/lib/constants";
import { CuratorContext } from "@/context/CuratorContext";

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useContext(CuratorContext);

  const handle = profile?.handle?.replace("@", "") || "";

  const nav = [
    { id: "ask", icon: "\u25C8", label: "Lens", path: "/myai" },
    { id: "me", icon: "\u25A2", label: "Me", path: "/me" },
    { id: "find", icon: "\u2316", label: "Find", path: "/find" },
    { id: "subs", icon: "\u2661", label: "Subs", path: "/subs" },
  ];

  const isActive = (item) => {
    if (item.id === "find") return pathname.startsWith("/find");
    if (item.id === "ask") return pathname.startsWith("/myai");
    if (item.id === "subs") return pathname.startsWith("/subs");
    if (item.id === "me") return pathname.startsWith("/me") || (handle && pathname === "/" + handle);
    return false;
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, bottom: 0, width: 220,
      background: T.bg, borderRight: `1px solid ${T.bdr}`,
      display: "flex", flexDirection: "column", zIndex: 100,
    }}>
      {/* Logo */}
      <div style={{ padding: "24px 20px", flexShrink: 0 }}>
        <span style={{ fontFamily: S, fontSize: 20, color: T.acc, fontWeight: 400 }}>curators</span>
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "0 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        {nav.map(item => (
          <div key={item.id}>
            <button
              onClick={() => router.push(item.path)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "10px 12px", borderRadius: 8, border: "none",
                background: isActive(item) ? T.accSoft : "transparent",
                color: isActive(item) ? T.acc : T.ink3,
                fontFamily: F, fontSize: 14, fontWeight: 500,
                cursor: "pointer", textAlign: "left",
                transition: "background .15s",
              }}
              onMouseEnter={e => { if (!isActive(item)) e.currentTarget.style.background = T.s; }}
              onMouseLeave={e => { if (!isActive(item)) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 16, lineHeight: 1, width: 20, textAlign: "center" }}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          </div>
        ))}
      </nav>

      {/* Invite + Settings + Feedback (admin) */}
      <div style={{ padding: "8px 12px 16px", borderTop: `1px solid ${T.bdr}`, flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {/* Feedback nav hidden — route /admin/feedback still works directly
        {profile?.handle?.replace("@", "") === "shamal" && (
          <button
            onClick={() => router.push("/admin/feedback")}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "10px 12px", borderRadius: 8, border: "none",
              background: pathname.startsWith("/admin/feedback") ? T.accSoft : "transparent",
              color: pathname.startsWith("/admin/feedback") ? T.acc : T.ink3,
              fontFamily: F, fontSize: 14, fontWeight: 500,
              cursor: "pointer", textAlign: "left",
              transition: "background .15s",
            }}
            onMouseEnter={e => { if (!pathname.startsWith("/admin/feedback")) e.currentTarget.style.background = T.s; }}
            onMouseLeave={e => { if (!pathname.startsWith("/admin/feedback")) e.currentTarget.style.background = "transparent"; }}
          >
            <span style={{ fontSize: 16, lineHeight: 1, width: 20, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <span>Feedback</span>
          </button>
        )}
        */}
        <button
          onClick={() => router.push("/invite")}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 8, border: "none",
            background: pathname.startsWith("/invite") ? T.accSoft : "transparent",
            color: pathname.startsWith("/invite") ? T.acc : T.ink3,
            fontFamily: F, fontSize: 14, fontWeight: 500,
            cursor: "pointer", textAlign: "left",
            transition: "background .15s",
          }}
          onMouseEnter={e => { if (!pathname.startsWith("/invite")) e.currentTarget.style.background = T.s; }}
          onMouseLeave={e => { if (!pathname.startsWith("/invite")) e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ fontSize: 16, lineHeight: 1, width: 20, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </span>
          <span>Invite</span>
        </button>
        <button
          onClick={() => router.push("/settings")}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", borderRadius: 8, border: "none",
            background: pathname.startsWith("/settings") ? T.accSoft : "transparent",
            color: pathname.startsWith("/settings") ? T.acc : T.ink3,
            fontFamily: F, fontSize: 14, fontWeight: 500,
            cursor: "pointer", textAlign: "left",
            transition: "background .15s",
          }}
          onMouseEnter={e => { if (!pathname.startsWith("/settings")) e.currentTarget.style.background = T.s; }}
          onMouseLeave={e => { if (!pathname.startsWith("/settings")) e.currentTarget.style.background = "transparent"; }}
        >
          <span style={{ fontSize: 16, lineHeight: 1, width: 20, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </span>
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
