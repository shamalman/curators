"use client"

import { useState, useEffect, useContext } from "react"
import { useRouter } from "next/navigation"
import { T, F, S, MN } from "@/lib/constants"
import { supabase } from "@/lib/supabase"
import { CuratorContext } from "@/context/CuratorContext"

function Toggle({ on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      style={{
        width: 44, height: 24, borderRadius: 12, border: "none",
        background: on ? T.acc : T.s2, cursor: "pointer",
        position: "relative", transition: "background .2s", flexShrink: 0,
      }}
    >
      <div style={{
        width: 18, height: 18, borderRadius: 9,
        background: on ? "#fff" : T.ink3,
        position: "absolute", top: 3,
        left: on ? 23 : 3,
        transition: "left .2s, background .2s",
      }} />
    </button>
  )
}

export default function SettingsView() {
  const router = useRouter()
  const { profileId, setProfile, setTasteItems, setMessages } = useContext(CuratorContext)
  const [email, setEmail] = useState("")
  const [weeklyDigest, setWeeklyDigest] = useState(true)
  const [newSubscriber, setNewSubscriber] = useState(true)
  const [newRec, setNewRec] = useState(true)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [resetInput, setResetInput] = useState("")
  const [resetting, setResetting] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user?.email) setEmail(data.user.email)
    })
  }, [])

  // Load notification preferences from profile
  useEffect(() => {
    if (!profileId) return
    supabase
      .from("profiles")
      .select("weekly_digest_enabled, new_subscriber_email_enabled, new_rec_email_enabled")
      .eq("id", profileId)
      .single()
      .then(({ data }) => {
        if (data) {
          setWeeklyDigest(data.weekly_digest_enabled !== false)
          setNewSubscriber(data.new_subscriber_email_enabled !== false)
          setNewRec(data.new_rec_email_enabled !== false)
        }
        setPrefsLoaded(true)
      })
      .catch((err) => {
        console.error("Failed to load notification prefs:", err)
        setPrefsLoaded(true)
      })
  }, [profileId])

  const toggleWeeklyDigest = async () => {
    const next = !weeklyDigest
    setWeeklyDigest(next)
    const { error } = await supabase
      .from("profiles")
      .update({ weekly_digest_enabled: next })
      .eq("id", profileId)
    if (error) {
      console.error("Failed to update weekly_digest_enabled:", error)
      setWeeklyDigest(!next)
    }
  }

  const toggleNewSubscriber = async () => {
    const next = !newSubscriber
    setNewSubscriber(next)
    const { error } = await supabase
      .from("profiles")
      .update({ new_subscriber_email_enabled: next })
      .eq("id", profileId)
    if (error) {
      console.error("Failed to update new_subscriber_email_enabled:", error)
      setNewSubscriber(!next)
    }
  }

  const toggleNewRec = async () => {
    const next = !newRec
    setNewRec(next)
    const { error } = await supabase
      .from("profiles")
      .update({ new_rec_email_enabled: next })
      .eq("id", profileId)
    if (error) {
      console.error("Failed to update new_rec_email_enabled:", error)
      setNewRec(!next)
    }
  }

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut()
    } catch (err) {
      console.error("Sign out error:", err)
    }
    window.location.href = "/login"
  }

  const settingRow = (label, desc, right) => (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "14px 0", borderBottom: `1px solid ${T.bdr}`,
    }}>
      <div style={{ flex: 1, minWidth: 0, marginRight: 12 }}>
        <div style={{ fontFamily: F, fontSize: 14, color: T.ink, fontWeight: 500 }}>{label}</div>
        {desc && <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginTop: 2 }}>{desc}</div>}
      </div>
      {right}
    </div>
  )

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div style={{ maxWidth: 700, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", flex: 1, overflow: "auto", minHeight: 0 }}>

        {/* Header with back button */}
        <div style={{ padding: "52px 20px 0", flexShrink: 0 }}>
          <div style={{ marginBottom: 16 }}>
            <button onClick={() => router.back()} style={{
              background: "none", border: "none", cursor: "pointer", padding: 0,
              display: "flex", alignItems: "center",
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.ink3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
          <h2 style={{ fontFamily: S, fontSize: 28, color: T.ink, fontWeight: 400, marginBottom: 24 }}>Settings</h2>
        </div>

        <div style={{ padding: "0 20px", paddingBottom: 60 }}>

          {/* Notifications */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Notifications
            </div>
            {settingRow("Weekly digest", "New recs from curators you subscribe to",
              <Toggle on={weeklyDigest} onToggle={toggleWeeklyDigest} />
            )}
            {settingRow("New subscriber", "When someone subscribes to you",
              <Toggle on={newSubscriber} onToggle={toggleNewSubscriber} />
            )}
            {settingRow("New rec", "When curators you subscribe to save a new rec",
              <Toggle on={newRec} onToggle={toggleNewRec} />
            )}
          </div>

          {/* Account */}
          <div>
            <div style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Account
            </div>
            {settingRow("Email", email || "...", null)}
            {settingRow("Password", null,
              <button style={{
                background: "none", border: `1px solid ${T.bdr}`, borderRadius: 8,
                padding: "6px 14px", cursor: "pointer", fontFamily: F, fontSize: 12,
                fontWeight: 600, color: T.ink3,
              }}>Change</button>
            )}
            {settingRow("Export data", "Download all your recommendations",
              <button style={{
                background: "none", border: `1px solid ${T.bdr}`, borderRadius: 8,
                padding: "6px 14px", cursor: "pointer", fontFamily: F, fontSize: 12,
                fontWeight: 600, color: T.ink3,
              }}>Export</button>
            )}
            <div style={{ paddingTop: 24 }}>
              <button
                onClick={handleLogout}
                style={{
                  width: "100%", padding: "12px 0", borderRadius: 8,
                  border: `1px solid ${T.bdr}`, background: "none",
                  fontFamily: F, fontSize: 14, fontWeight: 600, color: "#E85C5C",
                  cursor: "pointer",
                }}
              >
                Log out
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div style={{ marginTop: 32 }}>
            <div style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: "#E85C5C", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
              Danger Zone
            </div>
            <div style={{
              padding: "16px", borderRadius: 10,
              border: "1px solid rgba(232, 92, 92, 0.3)", background: "rgba(232, 92, 92, 0.05)",
            }}>
              <div style={{ fontFamily: F, fontSize: 14, color: T.ink, fontWeight: 500, marginBottom: 4 }}>
                Reset account
              </div>
              <div style={{ fontFamily: F, fontSize: 12, color: T.ink3, marginBottom: 12 }}>
                Wipe all recs, chat history, and agent data. Returns you to onboarding mode. Your account and handle stay intact.
              </div>
              <button
                onClick={() => setShowResetModal(true)}
                style={{
                  padding: "8px 16px", borderRadius: 8,
                  border: "1px solid #E85C5C", background: "none",
                  fontFamily: F, fontSize: 13, fontWeight: 600, color: "#E85C5C",
                  cursor: "pointer",
                }}
              >
                Reset account...
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.7)", display: "flex",
          alignItems: "center", justifyContent: "center", padding: 20,
        }}
          onClick={() => { if (!resetting) { setShowResetModal(false); setResetInput(""); } }}
        >
          <div
            style={{
              background: T.s2, borderRadius: 16, padding: 24,
              maxWidth: 400, width: "100%",
              border: `1px solid ${T.bdr}`,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontFamily: F, fontSize: 16, fontWeight: 600, color: "#E85C5C", marginBottom: 8 }}>
              Reset your account?
            </div>
            <div style={{ fontFamily: F, fontSize: 13, color: T.ink3, lineHeight: 1.5, marginBottom: 16 }}>
              This will permanently delete all your recommendations, chat messages, agent jobs, and taste analysis. Your account, handle, and subscriptions will remain.
            </div>
            <div style={{ fontFamily: F, fontSize: 13, color: T.ink, marginBottom: 8 }}>
              Type <span style={{ fontFamily: MN, fontWeight: 600, color: "#E85C5C" }}>RESET</span> to confirm:
            </div>
            <input
              type="text"
              value={resetInput}
              onChange={e => setResetInput(e.target.value)}
              placeholder="RESET"
              autoFocus
              style={{
                width: "100%", padding: "10px 12px", borderRadius: 8,
                border: `1px solid ${T.bdr}`, background: T.bg,
                fontFamily: MN, fontSize: 14, color: T.ink,
                outline: "none", boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button
                onClick={() => { setShowResetModal(false); setResetInput(""); }}
                disabled={resetting}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8,
                  border: `1px solid ${T.bdr}`, background: "none",
                  fontFamily: F, fontSize: 13, fontWeight: 600, color: T.ink3,
                  cursor: resetting ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (resetInput !== "RESET") return;
                  setResetting(true);
                  try {
                    const res = await fetch("/api/account/reset", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ profileId }),
                    });
                    if (!res.ok) throw new Error("Reset failed");
                    // Clear context state
                    setTasteItems([]);
                    setMessages([]);
                    setProfile(prev => prev ? { ...prev, bio: null, location: "" } : prev);
                    setShowResetModal(false);
                    setResetInput("");
                    router.push("/myai");
                  } catch (err) {
                    console.error("Account reset error:", err);
                    alert("Reset failed. Please try again.");
                  } finally {
                    setResetting(false);
                  }
                }}
                disabled={resetInput !== "RESET" || resetting}
                style={{
                  flex: 1, padding: "10px 0", borderRadius: 8,
                  border: "none",
                  background: resetInput === "RESET" ? "#E85C5C" : "rgba(232, 92, 92, 0.3)",
                  fontFamily: F, fontSize: 13, fontWeight: 600, color: "#fff",
                  cursor: resetInput === "RESET" && !resetting ? "pointer" : "not-allowed",
                  opacity: resetting ? 0.6 : 1,
                }}
              >
                {resetting ? "Resetting..." : "Reset account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
