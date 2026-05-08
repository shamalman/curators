// app/api/recs/upload-artifact/route.js
//
// Thin upload endpoint: stores image bytes in the artifacts bucket and returns
// the resulting sha256 + ref. Performs no DB writes — no recommendations row,
// no rec_files row, no link_parse_log entry.
//
// Used by QuickCaptureSheet's CASE C (link + image override) where the rec
// itself is created by the link path and only the artifact identifiers are
// needed to redirect the link's thumbnail to the curator's image.
//
// CASE B (image-only, no link) still goes through /api/recs/upload because it
// needs the synthesized parsedPayload + capture log for the upload-driven rec.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { uploadArtifact } from "@/lib/rec-files/artifact";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
]);

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB

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
    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "invalid multipart form data" }, { status: 400 });
    }

    const file = formData.get("file");
    const profileId = formData.get("profileId");

    if (!profileId || typeof profileId !== "string") {
      return NextResponse.json({ error: "profileId is required" }, { status: 400 });
    }
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    // Verify the authenticated user owns the profileId being written under.
    const admin = getSupabaseAdmin();
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .select("id, auth_user_id")
      .eq("id", profileId)
      .single();

    if (profileErr || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }
    if (profile.auth_user_id !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const mimeType = file.type || "";
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: `file type ${mimeType || "unknown"} not supported (allowed: PNG, JPEG, WebP, HEIC)` },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "file is empty" }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: `file too large (${file.size} bytes, max ${MAX_FILE_BYTES})` },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    let artifactResult;
    try {
      artifactResult = await uploadArtifact(admin, profileId, bytes, mimeType);
    } catch (err) {
      console.error("[UPLOAD_ARTIFACT_ENDPOINT_ERROR]", err?.message || err);
      return NextResponse.json(
        { error: "failed to store file", detail: err?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      artifact_sha256: artifactResult.sha256,
      artifact_ref: artifactResult.ref,
      mime_type: mimeType,
      size_bytes: file.size,
    });
  } catch (error) {
    console.error("[UPLOAD_ARTIFACT_ROUTE_ERROR]", error?.message || error);
    return NextResponse.json(
      { error: "upload-artifact failed", detail: error?.message },
      { status: 500 }
    );
  }
}
