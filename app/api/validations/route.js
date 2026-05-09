import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasFeature } from "@/lib/features";
import { sendValidationReceivedEmail } from "@/lib/email/sendValidationReceivedEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// POST /api/validations
// Body: { rec_id, verbatim_text, sent_to_curator, posted_publicly }
// Returns: { validation_id, comment_id }
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const user = await getAuthUser(cookieStore);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { rec_id, verbatim_text } = body;
    const sent_to_curator = body.sent_to_curator !== false;
    const posted_publicly = body.posted_publicly !== false;

    if (!rec_id || typeof rec_id !== "string") {
      return NextResponse.json({ error: "rec_id required" }, { status: 400 });
    }
    if (!verbatim_text || typeof verbatim_text !== "string" || !verbatim_text.trim()) {
      return NextResponse.json({ error: "verbatim_text required" }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Resolve subscriber profile
    const { data: subscriberProfile, error: subErr } = await admin
      .from("profiles")
      .select("id, handle")
      .eq("auth_user_id", user.id)
      .single();
    if (subErr || !subscriberProfile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    // Resolve rec and curator
    const { data: rec, error: recErr } = await admin
      .from("recommendations")
      .select("id, profile_id")
      .eq("id", rec_id)
      .single();
    if (recErr || !rec) {
      return NextResponse.json({ error: "Rec not found" }, { status: 404 });
    }
    const curatorId = rec.profile_id;

    // Block self-validation
    if (curatorId === subscriberProfile.id) {
      return NextResponse.json({ error: "Cannot validate own rec" }, { status: 400 });
    }

    // Confirm subscription is active
    const { data: sub, error: subFetchErr } = await admin
      .from("subscriptions")
      .select("id")
      .eq("subscriber_id", subscriberProfile.id)
      .eq("curator_id", curatorId)
      .is("unsubscribed_at", null)
      .maybeSingle();
    if (subFetchErr) {
      console.error("[VALIDATION_SUB_CHECK_ERROR]", subFetchErr.message);
      return NextResponse.json({ error: "Subscription check failed" }, { status: 500 });
    }
    if (!sub) {
      return NextResponse.json({ error: "Not subscribed to curator" }, { status: 403 });
    }

    // Block duplicate non-retracted validation
    const { data: existing, error: existingErr } = await admin
      .from("validations")
      .select("id, retracted_at")
      .eq("subscriber_id", subscriberProfile.id)
      .eq("rec_id", rec_id)
      .maybeSingle();
    if (existingErr) {
      console.error("[VALIDATION_EXISTING_CHECK_ERROR]", existingErr.message);
      return NextResponse.json({ error: "Existing-validation check failed" }, { status: 500 });
    }
    if (existing && !existing.retracted_at) {
      return NextResponse.json({ error: "Already validated" }, { status: 409 });
    }

    // 1. Insert validation row (source of truth, money-attached)
    const { data: validation, error: insErr } = await admin
      .from("validations")
      .insert({
        subscriber_id: subscriberProfile.id,
        curator_id: curatorId,
        rec_id,
        verbatim_text: verbatim_text.trim(),
        sent_to_curator,
        posted_publicly,
      })
      .select("id")
      .single();
    if (insErr || !validation) {
      console.error("[VALIDATION_INSERT_ERROR]", insErr?.message || "no row returned");
      return NextResponse.json({ error: "Validation write failed" }, { status: 500 });
    }

    // 2. Insert comment if posted_publicly
    let commentId = null;
    if (posted_publicly) {
      const { data: comment, error: cmtErr } = await admin
        .from("comments")
        .insert({
          profile_id: subscriberProfile.id,
          rec_id,
          body: verbatim_text.trim(),
          validation_id: validation.id,
        })
        .select("id")
        .single();
      if (cmtErr) {
        console.error("[VALIDATION_COMMENT_WRITE_FAILED]", cmtErr.message);
      } else {
        commentId = comment?.id || null;
      }
    }

    // 3. Insert taste_confirmations row for subscriber's Record
    // Best-effort: log and continue on failure. Record regen is idempotent.
    const { error: confErr } = await admin
      .from("taste_confirmations")
      .insert({
        profile_id: subscriberProfile.id,
        type: "validation_given",
        observation: verbatim_text.trim(),
        source: `validation:${validation.id}`,
      });
    if (confErr) {
      console.error("[VALIDATION_RECORD_WRITE_FAILED]", confErr.message);
    }

    // 4. Thread message + email (best-effort, gated by feature flags).
    if (sent_to_curator === true) {
      // Subscriber's payout_threads flag gates the thread substrate write.
      const { data: subForFlags } = await admin
        .from("profiles")
        .select("id, feature_flags")
        .eq("id", subscriberProfile.id)
        .single();

      if (subForFlags && hasFeature(subForFlags, "payout_threads")) {
        try {
          // Find or create thread (atomic upsert on unique pair).
          const { data: thread, error: threadErr } = await admin
            .from("threads")
            .upsert(
              {
                subscriber_id: subscriberProfile.id,
                curator_id: curatorId,
                last_message_at: new Date().toISOString(),
              },
              { onConflict: "subscriber_id,curator_id" }
            )
            .select("id")
            .single();

          if (threadErr || !thread) {
            console.error("[VALIDATION_THREAD_WRITE_FAILED]", threadErr?.message || "no thread returned");
          } else {
            const { error: msgErr } = await admin
              .from("thread_messages")
              .insert({
                thread_id: thread.id,
                sender_id: subscriberProfile.id,
                body: verbatim_text.trim(),
                validation_id: validation.id,
              });

            if (msgErr) {
              console.error("[VALIDATION_THREAD_WRITE_FAILED]", msgErr.message);
            }
          }
        } catch (err) {
          console.error("[VALIDATION_THREAD_WRITE_FAILED]", err?.message || err);
        }
      }

      // Curator's payout_email flag is checked inside the helper.
      try {
        const emailResult = await sendValidationReceivedEmail({
          validationId: validation.id,
          supabaseAdmin: admin,
        });
        if (!emailResult.ok && !emailResult.skipped) {
          console.error("[VALIDATION_EMAIL_FAILED]", emailResult.error, emailResult.detail);
        }
      } catch (err) {
        console.error("[VALIDATION_EMAIL_FAILED]", err?.message || err);
      }
    }

    console.log("[VALIDATION_CREATED]", {
      validationId: validation.id,
      subscriberId: subscriberProfile.id,
      curatorId,
      recId: rec_id,
      commentId,
    });

    return NextResponse.json({
      validation_id: validation.id,
      comment_id: commentId,
    });
  } catch (err) {
    console.error("[VALIDATION_ROUTE_ERROR]", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
