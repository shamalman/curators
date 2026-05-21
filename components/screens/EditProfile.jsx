'use client'

import { useRouter } from "next/navigation";
import { useContext } from "react";
import { T, F, S, MN, FEATURES } from "@/lib/constants";
import { CuratorContext } from "@/context/CuratorContext";
import { VisitorContext } from "@/context/VisitorContext";

const SOCIAL_PLATFORMS = [
  { key: "instagram", label: "Instagram", placeholder: "yourhandle" },
  { key: "spotify", label: "Spotify", placeholder: "yourhandle" },
  { key: "substack", label: "Substack", placeholder: "yourhandle" },
  { key: "x", label: "X", placeholder: "yourhandle" },
  { key: "threads", label: "Threads", placeholder: "yourhandle" },
  { key: "bluesky", label: "Bluesky", placeholder: "yourhandle" },
  { key: "website", label: "Website", placeholder: "https://yoursite.com" },
];

export default function EditProfile() {
  const router = useRouter();
  const { profile, setProfile, saveProfile, tasteItems } = useContext(CuratorContext);
  const visitor = useContext(VisitorContext);

  if (!profile) return null;

  const socialLinks = profile.socialLinks || {};

  const setSocialLink = (key, value) => {
    // Strip leading @ for handle-based platforms
    const cleaned = key !== "website" ? value.replace(/^@/, "") : value;
    setProfile(p => ({
      ...p,
      socialLinks: { ...p.socialLinks, [key]: cleaned },
    }));
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div style={{ maxWidth: 600, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ padding: "52px 20px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
        </button>
        <button onClick={async () => { await saveProfile(); if (visitor?.refresh) await visitor.refresh(); const h = profile.handle.replace("@", ""); router.push(`/${h}`); }} style={{ background: T.acc, border: "none", borderRadius: 10, padding: "8px 18px", cursor: "pointer", fontFamily: F, fontSize: 13, fontWeight: 700, color: T.accText }}>Save</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 24px 40px", WebkitOverflowScrolling: "touch" }}>
        <h2 style={{ fontFamily: S, fontSize: 26, color: T.ink, fontWeight: 400, marginBottom: 4 }}>Edit Profile</h2>
        <p style={{ fontSize: 13, color: T.ink3, fontFamily: F, lineHeight: 1.5, marginBottom: 28 }}>This is what visitors see on your public page.</p>

        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 76, height: 76, borderRadius: 22, margin: "0 auto 10px", background: T.s, border: `2px solid ${T.bdr}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <span style={{ fontFamily: S, fontSize: 30, color: T.acc }}>{(profile.name || '')[0]}</span>
          </div>
          <button style={{ background: "none", border: "none", color: T.acc, fontSize: 13, fontFamily: F, fontWeight: 600, cursor: "pointer" }}>Change photo</button>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", display: "block", marginBottom: 8 }}>Display name</label>
          <input value={profile.name} onChange={e => setProfile(p => ({ ...p, name: e.target.value.slice(0, 30) }))} maxLength={30} style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${T.bdr}`, fontSize: 15, fontFamily: F, outline: "none", background: T.s, color: T.ink }} />
          <p style={{ fontSize: 11, color: T.ink3, fontFamily: F, marginTop: 6, textAlign: "right" }}>{(profile.name || '').length}/30</p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", display: "block", marginBottom: 8 }}>Username</label>
          <input value={profile.handle} onChange={e => {
            const v = e.target.value.slice(0, 21); // +1 for @ prefix
            setProfile(p => ({ ...p, handle: v }));
          }} maxLength={21} style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${T.bdr}`, fontSize: 15, fontFamily: F, outline: "none", background: T.s, color: T.ink }} />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
            <p style={{ fontSize: 11, color: T.ink3, fontFamily: F }}>curators.com/{profile.handle.replace("@", "")}</p>
            <p style={{ fontSize: 11, color: T.ink3, fontFamily: F }}>{profile.handle.replace("@", "").length}/20</p>
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", display: "block", marginBottom: 8 }}>Bio</label>
          <textarea value={profile.bio || ''} onChange={e => setProfile(p => ({ ...p, bio: e.target.value }))} rows={3}
            style={{ width: "100%", padding: "14px 16px", borderRadius: 12, border: `1.5px solid ${T.bdr}`, fontSize: 14, fontFamily: F, outline: "none", resize: "none", background: T.s, color: T.ink, lineHeight: 1.6 }}
          />
          <p style={{ fontSize: 11, color: T.ink3, fontFamily: F, marginTop: 6, textAlign: "right" }}>{(profile.bio || '').length}/160</p>
        </div>

        {/* Section: Social Links */}
        {FEATURES.socialLinks && <>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10, fontFamily: F }}>Social Links</div>

        <div style={{ background: T.s, borderRadius: 14, border: "1px solid " + T.bdr, marginBottom: 16, overflow: "hidden" }}>
          {SOCIAL_PLATFORMS.map((platform, i) => (
            <div key={platform.key} style={{ padding: "12px 16px", borderTop: i > 0 ? `1px solid ${T.bdr}` : "none" }}>
              <label style={{ fontFamily: F, fontSize: 12, fontWeight: 600, color: T.ink, display: "block", marginBottom: 6 }}>{platform.label}</label>
              <input
                value={socialLinks[platform.key] || ""}
                onChange={e => setSocialLink(platform.key, e.target.value)}
                placeholder={platform.placeholder}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: `1.5px solid ${T.bdr}`, fontSize: 13, fontFamily: F, outline: "none", background: T.bg, color: T.ink }}
              />
            </div>
          ))}
        </div>
        </>}

        {/* Section: Profile display */}
        <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10, fontFamily: F }}>Profile Display</div>

        <div style={{ background: T.s, borderRadius: 14, border: "1px solid " + T.bdr, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>Show recommendations</div>
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>Display public recs on your profile</div>
            </div>
            <button onClick={() => setProfile(p => ({ ...p, showRecs: !p.showRecs }))} style={{
              width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
              background: profile.showRecs ? T.acc : T.bdr, transition: "background .2s",
            }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: profile.showRecs ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
          {!profile.showRecs && (
            <div style={{ padding: "0 16px 14px", borderTop: `1px solid ${T.bdr}` }}>
              <p style={{ fontSize: 12, color: T.ink2, fontFamily: F, marginTop: 12, lineHeight: 1.5 }}>
                Your profile will only show your bio, AI, and subscription options. Visitors can still ask your AI about your recs.
              </p>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", borderTop: `1px solid ${T.bdr}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>Show who I subscribe to</div>
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>Display on your public profile</div>
            </div>
            <button onClick={() => setProfile(p => ({ ...p, showSubscriptions: !p.showSubscriptions }))} style={{
              width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
              background: profile.showSubscriptions ? T.acc : T.bdr, transition: "background .2s",
            }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: profile.showSubscriptions ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px", borderTop: `1px solid ${T.bdr}` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>Show my subscribers</div>
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>Display on your public profile</div>
            </div>
            <button onClick={() => setProfile(p => ({ ...p, showSubscribers: !p.showSubscribers }))} style={{
              width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
              background: profile.showSubscribers ? T.acc : T.bdr, transition: "background .2s",
            }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: profile.showSubscribers ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
        </div>

        {/* Section: Interactions */}
        <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10, fontFamily: F }}>Interactions</div>

        <div style={{ background: T.s, borderRadius: 14, border: "1px solid " + T.bdr, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ padding: "16px", borderBottom: `1px solid ${T.bdr}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>Public AI access</div>
                <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>Let visitors chat with your taste AI</div>
              </div>
              <button onClick={() => setProfile(p => ({ ...p, aiEnabled: !p.aiEnabled }))} style={{
                width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
                background: profile.aiEnabled ? T.acc : T.bdr, transition: "background .2s",
              }}>
                <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: profile.aiEnabled ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </button>
            </div>
            <p style={{ fontSize: 11, color: T.ink3, fontFamily: F, marginTop: 8, lineHeight: 1.5 }}>
              Your AI becomes available to visitors once you have 5+ recommendations.{tasteItems.length < 5 ? ` You have ${tasteItems.length} so far.` : ''}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>Accept requests</div>
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>Let visitors request personal curations</div>
            </div>
            <button onClick={() => setProfile(p => ({ ...p, acceptRequests: !p.acceptRequests }))} style={{
              width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
              background: profile.acceptRequests ? T.acc : T.bdr, transition: "background .2s",
            }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: profile.acceptRequests ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
        </div>

        {/* Section: Wallet & Crypto */}
        <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 10, fontFamily: F }}>Wallet & Crypto</div>

        <div style={{ background: T.s, borderRadius: 14, border: "1px solid " + T.bdr, marginBottom: 16, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink }}>Accept crypto</div>
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>Enable tips and licensing payments in crypto</div>
            </div>
            <button onClick={() => setProfile(p => ({ ...p, cryptoEnabled: !p.cryptoEnabled }))} style={{
              width: 48, height: 28, borderRadius: 14, border: "none", cursor: "pointer", position: "relative",
              background: profile.cryptoEnabled ? T.acc : T.bdr, transition: "background .2s",
            }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, background: "#fff", position: "absolute", top: 3, left: profile.cryptoEnabled ? 23 : 3, transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </button>
          </div>
          {profile.cryptoEnabled && (
            <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.bdr}` }}>
              <label style={{ fontFamily: F, fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 8, marginTop: 12 }}>Wallet address</label>
              <input value={profile.walletFull} onChange={e => setProfile(p => ({ ...p, walletFull: e.target.value, wallet: e.target.value.slice(0, 6) + "..." + e.target.value.slice(-4) }))}
                placeholder="0x..."
                style={{ width: "100%", padding: "12px 14px", borderRadius: 10, border: `1.5px solid ${T.bdr}`, fontSize: 12, fontFamily: MN, outline: "none", background: T.bg, color: T.ink }}
              />
              <p style={{ fontSize: 10, color: T.ink3, fontFamily: F, marginTop: 8, lineHeight: 1.5 }}>
                This wallet receives all crypto payments across your recommendations — tips, licensing fees, and bundle purchases. One address, all recs.
              </p>
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                {["ETH", "USDC", "SOL"].map(chain => (
                  <div key={chain} style={{ padding: "6px 12px", borderRadius: 8, background: T.bg, border: "1px solid " + T.bdr, fontFamily: MN, fontSize: 11, color: T.ink2, fontWeight: 600 }}>{chain}</div>
                ))}
                <div style={{ padding: "6px 12px", borderRadius: 8, background: T.bg, border: `1px dashed ${T.bdr}`, fontFamily: F, fontSize: 11, color: T.ink3, cursor: "pointer" }}>+ More</div>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
