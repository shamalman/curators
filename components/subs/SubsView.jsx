"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { T, F, S } from "@/lib/constants"
import { useCurator } from "@/context/CuratorContext"
import { hasFeature } from "@/lib/features"
import MessagesList from "@/components/messages/MessagesList"
import ThreadDetail from "@/components/messages/ThreadDetail"
import AllocationView from "@/components/payouts/AllocationView"

export default function SubsView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { profileId, profile, mySubscriptions, mySubscribers, refreshSubscriptions } = useCurator()

  const segment = searchParams.get("segment") || "subscriptions"
  const threadParam = searchParams.get("thread")
  const tab = segment
  const setTab = (next) => {
    if (next === "messages") {
      router.push("/subs?segment=messages")
    } else if (next === "subscribers") {
      router.push("/subs?segment=subscribers")
    } else if (next === "allocation") {
      router.push("/subs?segment=allocation")
    } else {
      router.push("/subs")
    }
  }

  const showMessagesTab = profile?.isTester === true && hasFeature(profile, "payout_messages_ui")
  const showAllocationTab = profile?.isTester === true && hasFeature(profile, "payout_allocation_ui")

  // Email subscribers (legacy)
  const [emailSubs, setEmailSubs] = useState([])
  const [emailLoaded, setEmailLoaded] = useState(false)

  const handle = profile?.handle?.replace("@", "") || ""

  // Refresh subscriptions from DB on mount
  useEffect(() => {
    if (refreshSubscriptions) refreshSubscriptions()
  }, [profileId, refreshSubscriptions])

  useEffect(() => {
    if (!profileId) return
    async function load() {
      const { data, error } = await supabase
        .from("subscribers")
        .select("email, subscribed_at")
        .eq("curator_id", profileId)
        .order("subscribed_at", { ascending: false })
      if (error) console.error("Failed to load email subscribers:", error)
      if (data) setEmailSubs(data)
      setEmailLoaded(true)
    }
    load()
  }, [profileId])

  const fmtDate = (d) => {
    if (!d) return ""
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  const exportCSV = () => {
    const rows = [["email", "subscribed_at"]]
    emailSubs.forEach(s => rows.push([s.email, s.subscribed_at || ""]))
    const csv = rows.map(r => r.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "subscribers.csv"
    a.click()
    URL.revokeObjectURL(url)
  }

  const getRecCount = (sub) => {
    const recs = sub.curator?.recommendations
    if (!recs || !recs.length) return 0
    return recs[0]?.count ?? 0
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <div style={{ maxWidth: 700, margin: "0 auto", width: "100%", display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* Header */}
        <div style={{ padding: "52px 20px 0", flexShrink: 0 }}>
          <h2 style={{ fontFamily: S, fontSize: 28, color: T.ink, fontWeight: 400, marginBottom: 16 }}>{tab === "messages" ? "Messages" : tab === "subscribers" ? "Subscribers" : tab === "allocation" ? "Allocation" : "Subscriptions"}</h2>

          {/* Segmented control */}
          <div style={{ display: "flex", gap: 2, background: T.s, borderRadius: 8, padding: 2, marginBottom: 16 }}>
            {[
              "subscriptions",
              "subscribers",
              ...(showMessagesTab ? ["messages"] : []),
              ...(showAllocationTab ? ["allocation"] : []),
            ].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                flex: 1, padding: "7px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                background: tab === t ? T.s2 : "transparent",
                color: tab === t ? T.ink : T.ink3,
                fontSize: 12, fontWeight: 600, fontFamily: F,
                transition: "background .15s, color .15s",
              }}>{t === "subscriptions" ? "Subscriptions" : t === "subscribers" ? "Subscribers" : t === "messages" ? "Messages" : "Allocation"}</button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 20px", WebkitOverflowScrolling: "touch" }}>

          {/* === Subscriptions tab === */}
          {tab === "subscriptions" && (
            <>
              {mySubscriptions.length > 0 && (
                <p style={{ fontSize: 13, color: T.ink3, fontFamily: F, marginBottom: 16 }}>
                  {`You subscribe to ${mySubscriptions.length} curator${mySubscriptions.length !== 1 ? "s" : ""}`}
                </p>
              )}

              {mySubscriptions.length === 0 && (
                <div style={{ padding: "48px 20px" }}>
                  <p style={{ fontFamily: F, fontSize: 14, color: T.ink3, lineHeight: 1.6, marginBottom: 16 }}>
                    You haven't subscribed to any curators yet. Browse the{" "}
                    <span onClick={() => router.push("/find")} style={{ color: T.acc, cursor: "pointer", fontWeight: 600 }}>Network tab</span>
                    {" "}to find curators you trust.
                  </p>
                  <button onClick={() => router.push("/find")} style={{
                    background: T.acc, border: "none", borderRadius: 10, padding: "12px 20px",
                    cursor: "pointer", fontFamily: F, fontSize: 13, fontWeight: 600, color: T.accText,
                  }}>Browse recommendations</button>

                  <div style={{ height: 1, background: T.bdr, margin: "28px 0" }} />

                  <p style={{ fontFamily: F, fontSize: 14, color: T.ink3, lineHeight: 1.6, marginBottom: 16 }}>
                    Know someone with great taste? Invite them to Curators.ai and subscribe to them.
                  </p>
                  <button onClick={() => router.push("/invite")} style={{
                    background: T.acc, border: "none", borderRadius: 10, padding: "12px 20px",
                    cursor: "pointer", fontFamily: F, fontSize: 13, fontWeight: 600, color: T.accText,
                  }}>Invite a curator</button>
                </div>
              )}

              {mySubscriptions.map((sub) => {
                const curator = sub.curator || {}
                const recCount = getRecCount(sub)
                return (
                  <div key={sub.id} onClick={() => router.push(`/${curator.handle}`)} style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "14px 4px",
                    borderBottom: `1px solid ${T.bdr}`, cursor: "pointer",
                  }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 12, background: T.accSoft,
                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                    }}>
                      <span style={{ fontFamily: S, fontSize: 17, color: T.acc, fontWeight: 400 }}>
                        {curator.name?.[0] || "?"}
                      </span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {curator.name}
                      </div>
                      <div style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>
                        @{curator.handle}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                      {recCount > 0 && (
                        <span style={{ fontFamily: F, fontSize: 11, color: T.ink3, background: T.s, borderRadius: 6, padding: "2px 7px" }}>
                          {recCount} rec{recCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      <span style={{ fontFamily: F, fontSize: 11, color: T.ink3 }}>
                        {fmtDate(sub.created_at)}
                      </span>
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {/* === Subscribers tab === */}
          {tab === "subscribers" && (
            <>
              <p style={{ fontSize: 13, color: T.ink3, fontFamily: F, marginBottom: 16 }}>
                {mySubscribers.length + emailSubs.length > 0
                  ? `${mySubscribers.length + emailSubs.length} subscriber${mySubscribers.length + emailSubs.length !== 1 ? "s" : ""}`
                  : emailLoaded ? "" : "Loading..."}
              </p>

              {/* In-network subscribers */}
              {mySubscribers.length > 0 && (
                <>
                  {mySubscribers.map((sub) => {
                    const subscriber = sub.subscriber || {}
                    return (
                      <div key={sub.id} onClick={() => router.push(`/${subscriber.handle}`)} style={{
                        display: "flex", alignItems: "center", gap: 12, padding: "14px 4px",
                        borderBottom: `1px solid ${T.bdr}`, cursor: "pointer",
                      }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 12, background: T.accSoft,
                          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        }}>
                          <span style={{ fontFamily: S, fontSize: 17, color: T.acc, fontWeight: 400 }}>
                            {subscriber.name?.[0] || "?"}
                          </span>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: F, fontSize: 14, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {subscriber.name}
                          </div>
                          <div style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>
                            @{subscriber.handle}
                          </div>
                        </div>
                        <span style={{ fontFamily: F, fontSize: 11, color: T.ink3 }}>
                          {fmtDate(sub.created_at)}
                        </span>
                      </div>
                    )
                  })}
                </>
              )}

              {/* Email subscribers section */}
              {emailSubs.length > 0 && (
                <>
                  <div style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "20px 0 8px", borderTop: mySubscribers.length > 0 ? `1px solid ${T.bdr}` : "none",
                    marginTop: mySubscribers.length > 0 ? 8 : 0,
                  }}>
                    <span style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em" }}>
                      Email subscribers
                    </span>
                    <button onClick={exportCSV} style={{
                      background: "none", border: `1px solid ${T.bdr}`, borderRadius: 8,
                      padding: "5px 12px", cursor: "pointer", fontFamily: F, fontSize: 11,
                      fontWeight: 600, color: T.ink3,
                    }}>Export CSV</button>
                  </div>
                  {emailSubs.map((sub, i) => (
                    <div key={sub.email + i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 4px", borderBottom: `1px solid ${T.bdr}`,
                    }}>
                      <span style={{ fontFamily: F, fontSize: 14, color: T.ink, fontWeight: 500 }}>{sub.email}</span>
                      <span style={{ fontFamily: F, fontSize: 12, color: T.ink3 }}>{fmtDate(sub.subscribed_at)}</span>
                    </div>
                  ))}
                </>
              )}

              {/* Empty state */}
              {emailLoaded && mySubscribers.length === 0 && emailSubs.length === 0 && (
                <div style={{ padding: "48px 20px" }}>
                  <p style={{ fontFamily: F, fontSize: 14, color: T.ink3, lineHeight: 1.6, marginBottom: 16 }}>
                    No subscribers yet. Make recommendations, and people will discover you in the{" "}
                    <span onClick={() => router.push("/find")} style={{ color: T.acc, cursor: "pointer", fontWeight: 600 }}>Network tab</span>.
                  </p>
                  <button onClick={() => router.push("/myai")} style={{
                    background: T.acc, border: "none", borderRadius: 10, padding: "12px 20px",
                    cursor: "pointer", fontFamily: F, fontSize: 13, fontWeight: 600, color: T.accText,
                  }}>Make a recommendation</button>

                  <div style={{ height: 1, background: T.bdr, margin: "28px 0" }} />

                  <p style={{ fontFamily: F, fontSize: 14, color: T.ink3, lineHeight: 1.6, marginBottom: 16 }}>
                    Know someone with great taste? Invite them to Curators.ai.
                  </p>
                  <button onClick={() => router.push("/invite")} style={{
                    background: T.acc, border: "none", borderRadius: 10, padding: "12px 20px",
                    cursor: "pointer", fontFamily: F, fontSize: 13, fontWeight: 600, color: T.accText,
                  }}>Invite a curator</button>
                </div>
              )}
            </>
          )}

          {/* === Messages tab === */}
          {tab === "messages" && showMessagesTab && (
            threadParam ? (
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", marginTop: -8 }}>
                <ThreadDetail
                  threadId={threadParam}
                  onBack={() => router.push("/subs?segment=messages")}
                />
              </div>
            ) : (
              <MessagesList
                onOpenThread={(id) => router.push(`/subs?segment=messages&thread=${id}`)}
              />
            )
          )}

          {/* === Allocation tab === */}
          {tab === "allocation" && showAllocationTab && (
            <AllocationView />
          )}

          <div style={{ height: 40 }} />
        </div>
      </div>
    </div>
  )
}
