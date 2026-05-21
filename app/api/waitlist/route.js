import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { resend } from "@/lib/resend";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request) {
  try {
    const { email } = await request.json();
    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const normalized = email.trim().toLowerCase();

    const { error: insertErr } = await sb
      .from("waitlist")
      .insert({ email: normalized });

    if (insertErr) {
      // Duplicate email — still a success from the user's perspective
      if (insertErr.code === "23505") {
        return NextResponse.json({ success: true });
      }
      throw insertErr;
    }

    // Send notification email (non-blocking — don't fail the request if this errors)
    try {
      await resend.emails.send({
        from: "noreply@curators.com",
        to: "shamal@gmail.com",
        subject: "New waitlist signup — Curators",
        text: `New email on the waitlist: ${normalized}\n\nSigned up at: ${new Date().toISOString()}`,
      });
    } catch (emailErr) {
      console.error("Resend email failed:", emailErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Waitlist error:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
