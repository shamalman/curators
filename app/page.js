'use client'

import { useState } from "react"
import { useRouter } from "next/navigation"
import { T, F, S } from "@/lib/constants"

export default function SplashPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Something went wrong")
      setSubmitted(true)
    } catch (err) {
      setError(err.message || "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: "100vh", background: T.bg,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "40px 24px",
    }}>
      <div style={{ width: "100%", maxWidth: 480, textAlign: "center" }}>
        {/* Logo */}
        <div style={{ marginBottom: 48 }}>
          <span style={{ fontFamily: S, fontSize: 24, color: T.acc, fontWeight: 400 }}>Curators</span>
        </div>

        {/* Headline */}
        <h1 style={{
          fontFamily: S, fontSize: 36, fontWeight: 400, color: T.ink,
          margin: "0 0 36px", lineHeight: 1.2,
        }}>For the Love of<br />Human Curation.</h1>

        {/* Waitlist form */}
        {submitted ? (
          <div style={{
            padding: "16px 20px", borderRadius: 12, background: T.accSoft,
            fontFamily: F, fontSize: 15, color: T.acc, fontWeight: 600,
          }}>You're on the list.</div>
        ) : (
          <form onSubmit={handleSubmit} style={{
            display: "flex", gap: 10, maxWidth: 400, margin: "0 auto",
          }}>
            <input
              type="email" required
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@email.com"
              style={{
                flex: 1, padding: "10px 14px", borderRadius: 8,
                border: `1.5px solid ${T.bdr}`, background: T.s2, color: T.ink,
                fontSize: 14, fontFamily: F, outline: "none",
                minWidth: 0,
              }}
            />
            <button type="submit" disabled={loading} style={{
              padding: "10px 18px", borderRadius: 8, border: "none",
              background: T.acc, color: T.accText, fontSize: 14, fontWeight: 600,
              fontFamily: F, cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1, whiteSpace: "nowrap", flexShrink: 0,
            }}>{loading ? "..." : "Get Early Access"}</button>
          </form>
        )}

        {error && (
          <div style={{ marginTop: 12, fontFamily: F, fontSize: 13, color: "#EF4444" }}>{error}</div>
        )}

        {/* Auth links */}
        <div style={{ marginTop: 40, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
          <span style={{ fontFamily: F, fontSize: 14, color: T.ink3 }}>
            Already have an invite?{" "}
            <button onClick={() => router.push("/signup")} style={{
              background: "none", border: "none", color: T.acc, fontFamily: F,
              fontSize: 14, fontWeight: 600, cursor: "pointer", padding: 0,
            }}>Sign up &rarr;</button>
          </span>
          <button onClick={() => router.push("/login")} style={{
            background: "none", border: "none", color: T.ink2, fontFamily: F,
            fontSize: 13, cursor: "pointer", padding: 0,
          }}>Log in</button>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        position: "absolute", bottom: 24, left: 0, right: 0, textAlign: "center",
        fontFamily: F, fontSize: 12, color: T.ink3,
      }}>&copy; 2026 Curators</div>
    </div>
  )
}
