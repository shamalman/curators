"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { T, F, S } from "@/lib/constants"
import { useCurator } from "@/context/CuratorContext"

export default function FansView() {
  const router = useRouter()
  const { profileId, profile } = useCurator()
  const [subscribers, setSubscribers] = useState([])
  const [loaded, setLoaded] = useState(false)

  const handle = profile?.handle?.replace("@", "") || ""

  useEffect(() => {
    if (!profileId) return
    async function load() {
      const { data, error } = await supabase
        .from("subscribers")
        .select("email, subscribed_at")
        .eq("curator_id", profileId)
        .order("subscribed_at", { ascending: false })
      if (error) console.error("Failed to load subscribers:", error)
      if (data) setSubscribers(data)
      setLoaded(true)
    }
    load()
  }, [profileId])

  const fmtDate = (d) => {
    if (!d) return ""
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  const exportCSV = () => {
    const rows = [["email", "subscribed_at"]]
    subscribers.forEach(s => rows.push([s.email, s.subscribed_at || ""]))
    const csv = rows.map(r => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "subscribers.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div style={{ maxWidth: 700, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* Header */}
        <div style={{ padding: "52px 20px 0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <h2 style={{ fontFamily: S, fontSize: 28, color: T.ink, fontWeight: 400 }}>Fans</h2>
            {subscribers.length > 0 && (
              <button onClick={exportCSV} style={{
                background: "none", border: `1px solid ${T.bdr}`, borderRadius: 8,
                padding: "6px 14px", cursor: "pointer", fontFamily: F, fontSize: 12,
                fontWeight: 600, color: T.ink3,
              }}>Export CSV</button>
            )}
          </div>
          <p style={{ fontSize: 13, color: T.ink3, fontFamily: F, marginBottom: 16 }}>
            {loaded ? `${subscribers.length} subscriber${subscribers.length !== 1 ? "s" : ""}` : "Loading..."}
          </p>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px", WebkitOverflowScrolling: "touch" }}>
          {loaded && subscribers.length === 0 && (
            <div style={{ padding: "48px 20px" }}>
              {/* Primary section */}
              <p style={{ fontFamily: F, fontSize: 14, color: T.ink3, lineHeight: 1.6, marginBottom: 16 }}>
                No subscribers yet. Make recommendations, and people will discover you in the{" "}
                <span onClick={() => router.push("/find")} style={{ color: T.acc, cursor: "pointer", fontWeight: 600 }}>Network tab</span>.
              </p>
              <button onClick={() => router.push("/myai")} style={{
                background: T.acc, border: "none", borderRadius: 10, padding: "12px 20px",
                cursor: "pointer", fontFamily: F, fontSize: 13, fontWeight: 600, color: T.accText,
              }}>Make a recommendation</button>

              <div style={{ height: 1, background: T.bdr, margin: "28px 0" }} />

              {/* Secondary section */}
              <p style={{ fontFamily: F, fontSize: 14, color: T.ink3, lineHeight: 1.6, marginBottom: 16 }}>
                Know someone with great taste? Invite them to Curators.
              </p>
              <button onClick={() => router.push("/invite")} style={{
                background: "none", border: `1px solid ${T.bdr}`, borderRadius: 10, padding: "12px 20px",
                cursor: "pointer", fontFamily: F, fontSize: 13, fontWeight: 600, color: T.ink2,
              }}>Invite a curator</button>
            </div>
          )}

          {subscribers.map((sub, i) => (
            <div key={sub.email + i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 4px", borderBottom: `1px solid ${T.bdr}`,
            }}>
              <span style={{ fontFamily: F, fontSize: 14, color: T.ink, fontWeight: 500 }}>{sub.email}</span>
              <span style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>{fmtDate(sub.subscribed_at)}</span>
            </div>
          ))}
          <div style={{ height: 40 }} />
        </div>

      </div>
    </div>
  )
}
