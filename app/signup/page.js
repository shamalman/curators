'use client'

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { T, F, S } from "@/lib/constants"

const inputStyle = {
  width: "100%", padding: "12px 16px", borderRadius: 8,
  border: `1.5px solid ${T.bdr}`, background: T.s2, color: T.ink,
  fontSize: 15, fontFamily: F, outline: "none",
}

export default function SignupPage() {
  const router = useRouter()
  const [inviteCode, setInviteCode] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const pwValid = password.length >= 8

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError("")
    if (!pwValid) { setError("Password must be at least 8 characters"); return }
    setLoading(true)
    try {
      // Step 1: Validate invite code and fetch inviter info
      const code = inviteCode.trim().toUpperCase()
      const { data: invite, error: invErr } = await supabase
        .from("invite_codes")
        .select("id, created_by, inviter_note")
        .eq("code", code)
        .is("used_at", null)
        .is("revoked_at", null)
        .single()
      if (invErr || !invite) {
        console.error("Invite code validation failed:", invErr)
        throw new Error("Invalid or already used invite code")
      }

      // Step 2: Sign up via server-side API route (avoids trigger issues)
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const result = await res.json()
      if (!res.ok) {
        console.error("Signup API error:", result)
        const detail = result.details ? ` (${result.details})` : ""
        throw new Error((result.error || "Signup failed") + detail)
      }

      // Step 3: Sign in the newly created user on the client
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
      if (signInErr) {
        console.error("Auto sign-in failed:", signInErr)
        // Don't throw — account was created, just redirect to login
        router.push("/login")
        return
      }

      // Step 4: Mark invite code as used. TOCTOU guard — if the code was
      // revoked between Step 1 (validate) and here, the revoked_at filter
      // matches zero rows. Abort before any further side effects so the user
      // sees the same error as a fresh-invalid code.
      const { data: redeemed, error: updateErr } = await supabase
        .from("invite_codes")
        .update({ used_at: new Date().toISOString() })
        .eq("id", invite.id)
        .is("revoked_at", null)
        .select()
      if (updateErr) console.error("Failed to mark invite as used:", updateErr)
      if (!updateErr && (!redeemed || redeemed.length === 0)) {
        console.error("Invite redemption blocked: code revoked mid-flow", { inviteId: invite.id })
        await supabase.auth.signOut()
        throw new Error("Invalid or already used invite code")
      }

      // Store invite context for onboarding to set invited_by
      if (invite.created_by) {
        localStorage.setItem("invite_context", JSON.stringify({
          invite_id: invite.id,
          invited_by: invite.created_by,
          inviter_note: invite.inviter_note || null,
        }))
      }

      router.push("/onboarding")
    } catch (err) {
      console.error("Signup flow error:", err)
      setError(err.message || "Signup failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <span style={{ fontFamily: S, fontSize: 28, color: T.acc, fontWeight: 400 }}>curators</span>
          <div style={{ fontSize: 12, color: "#A09888", textAlign: "center", marginBottom: 24, fontFamily: F }}>Early access — invite only</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", display: "block", marginBottom: 6 }}>Invite code</label>
            <input
              type="text" name="invite" autoComplete="off"
              value={inviteCode} onChange={e => setInviteCode(e.target.value.toUpperCase())}
              required placeholder="XXXX-XXXX"
              style={{ ...inputStyle, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'JetBrains Mono',monospace" }}
            />
          </div>
          <div>
            <label style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", display: "block", marginBottom: 6 }}>Email</label>
            <input
              type="email" name="email" autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)}
              required style={inputStyle}
            />
          </div>
          <div>
            <label style={{ fontFamily: F, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: ".08em", display: "block", marginBottom: 6 }}>Password</label>
            <input
              type="password" name="password" autoComplete="new-password"
              value={password} onChange={e => setPassword(e.target.value)}
              required style={inputStyle}
            />
            {password.length > 0 && (
              <div style={{ fontFamily: F, fontSize: 11, marginTop: 6, color: pwValid ? "#6BAA8E" : "#EF4444" }}>
                {pwValid ? "\u2713 Looks good" : `${8 - password.length} more character${8 - password.length !== 1 ? "s" : ""} needed`}
              </div>
            )}
          </div>

          {error && <div style={{ fontFamily: F, fontSize: 13, color: "#EF4444", lineHeight: 1.4 }}>{error}</div>}

          <button type="submit" disabled={loading} style={{
            width: "100%", padding: 14, borderRadius: 8, border: "none",
            background: T.acc, color: T.accText, fontSize: 15, fontWeight: 600,
            fontFamily: F, cursor: loading ? "default" : "pointer",
            opacity: loading ? 0.6 : 1, marginTop: 4,
          }}>{loading ? "Creating account..." : "Sign up"}</button>
        </form>

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <span style={{ fontFamily: F, fontSize: 14, color: T.ink3 }}>Already have an account? </span>
          <button onClick={() => router.push("/login")} style={{ background: "none", border: "none", color: T.acc, fontFamily: F, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Log in</button>
        </div>
      </div>
    </div>
  )
}
