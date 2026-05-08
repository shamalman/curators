// app/api/recs/lens-insights/route.js
//
// Forward-compatible insights endpoint for the Recommend modal. v1 returns
// AI-suggested tags; the envelope reserves null slots for upcoming insight
// surfaces (category nudge, network echoes, subscriber relevance, similar
// recs).
//
// The endpoint is purely advisory. Treat any failure as soft — return an
// empty envelope rather than 5xx so the modal stays useful when Claude or
// the network hiccups.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { generateLensInsights } from "@/lib/lens/insights-prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMPTY_ENVELOPE = {
  suggestedTags: [],
  suggestedCategory: null,
  networkEchoes: null,
  subscriberRelevance: null,
  similarRecs: null,
};

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getAuthUser(cookieStore) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const { profileId, title, writeup, link, existingTags } = body;
    if (!profileId || typeof profileId !== "string") {
      return NextResponse.json({ error: "profileId required." }, { status: 400 });
    }

    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    // Ownership: profiles.id !== auth.users.id in this schema; link them
    // through profiles.auth_user_id (same pattern as app/api/agent/submit).
    const admin = getSupabaseAdmin();
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id, auth_user_id")
      .eq("id", profileId)
      .single();
    if (profErr || !profile) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    if (profile.auth_user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    // Defensive size caps — never trust client input length.
    const safeInput = {
      title: typeof title === "string" ? title.slice(0, 200) : "",
      writeup: typeof writeup === "string" ? writeup.slice(0, 2000) : "",
      link: link && typeof link === "object" ? {
        url: typeof link.url === "string" ? link.url : null,
        parsedPayload: link.parsedPayload && typeof link.parsedPayload === "object"
          ? link.parsedPayload
          : null,
      } : null,
      existingTags: Array.isArray(existingTags)
        ? existingTags.filter((t) => typeof t === "string").slice(0, 20)
        : [],
    };

    const insights = await generateLensInsights(safeInput);
    return NextResponse.json({ insights });
  } catch (err) {
    console.error("[LENS_INSIGHTS_ROUTE_ERROR]", err?.message || err);
    // Fail soft — modal treats Lens output as decorative.
    return NextResponse.json({ insights: EMPTY_ENVELOPE });
  }
}
