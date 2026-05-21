'use client'

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { siteUrl } from "@/lib/site-url"
import { T, F, S } from "@/lib/constants"

const input = {
  width: "100%", padding: "12px 16px", borderRadius: 8,
  border: `1.5px solid ${T.bdr}`, background: T.s2, color: T.ink,
  fontSize: 15, fontFamily: F, outline: "none",
}

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: siteUrl('/reset-password'),
      })
      if (resetErr) throw resetErr
      setSent(true)
    } catch (err) {
      setError(err.message || "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <span style={{ fontFamily: S, fontSize: 28, color: T.acc, fontWeight: 400 }}>curators</span>
        </div>

        {sent ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: F, fontSize: 16, color: T.ink, marginBottom: 12 }}>Check your email for a reset link.</div>
            <div style={{ fontFamily: F, fontSize: 13, color: T.ink3 }}>If you don't see it, check your spam folder.</div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontFamily: F, fontSize: 14, color: T.ink2, marginBottom: 4 }}>
              Enter your email and we'll send you a link to reset your password.
            </div>
            <div>
              <label style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", display: "block", marginBottom: 6 }}>Email</label>
              <input
                type="email" name="email" autoComplete="email"
                value={email} onChange={e => setEmail(e.target.value)}
                required style={input}
              />
            </div>

            {error && <div style={{ fontFamily: F, fontSize: 13, color: "#EF4444", lineHeight: 1.4 }}>{error}</div>}

            <button type="submit" disabled={loading} style={{
              width: "100%", padding: 14, borderRadius: 8, border: "none",
              background: T.acc, color: T.accText, fontSize: 15, fontWeight: 600,
              fontFamily: F, cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1, marginTop: 4,
            }}>{loading ? "Sending..." : "Send reset link"}</button>
          </form>
        )}

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <button onClick={() => router.push("/login")} style={{ background: "none", border: "none", color: T.ink3, fontFamily: F, fontSize: 13, cursor: "pointer" }}>Back to login</button>
        </div>
      </div>
    </div>
  )
}
