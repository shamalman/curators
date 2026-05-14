import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hasFeature, isFeatureEnabled } from "@/lib/features";
import { sendValidationReceivedEmail } from "@/lib/email/sendValidationReceivedEmail";
import { calculateMonthlyEarnings } from "@/lib/allocation/calculate-earnings";
import { startOfMonthISO, startOfNextMonthISO } from "@/lib/allocation/calculate";

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
      .select("id, handle, is_tester")
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
      return NextResponse.json({ error: "Cannot cosign your own recommendation" }, { status: 400 });
    }

    // Cosign is in private testing: require is_tester + payout_validation flag.
    const flagEnabled = await isFeatureEnabled(admin, subscriberProfile.id, "payout_validation");
    if (subscriberProfile.is_tester !== true || !flagEnabled) {
      return NextResponse.json({ error: "not_enabled" }, { status: 403 });
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
      return NextResponse.json({ error: "Existing-cosign check failed" }, { status: 500 });
    }
    if (existing && !existing.retracted_at) {
      return NextResponse.json({ error: "Already cosigned" }, { status: 409 });
    }

    // Atomic dual-write: validation + comment (when posted_publicly) inside
    // a Postgres function. The function also best-effort writes the
    // taste_confirmations row (failure raised as a server-side warning,
    // does not roll back the validation).
    const { data: rpcResult, error: rpcError } = await admin.rpc(
      "create_validation_atomic",
      {
        p_subscriber_id: subscriberProfile.id,
        p_curator_id: curatorId,
        p_rec_id: rec_id,
        p_verbatim_text: verbatim_text.trim(),
        p_sent_to_curator: sent_to_curator,
        p_posted_publicly: posted_publicly,
      }
    );

    if (rpcError) {
      console.error("[VALIDATION_INSERT_ERROR]", rpcError.message || rpcError);
      return NextResponse.json({ error: "Cosign write failed" }, { status: 500 });
    }

    const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    const validationId = row?.validation_id;
    const commentId = row?.comment_id ?? null;

    if (!validationId) {
      console.error("[VALIDATION_INSERT_ERROR]", "no_validation_id_returned");
      return NextResponse.json({ error: "Cosign write failed" }, { status: 500 });
    }

    // 4. Thread message + email (best-effort, gated by feature flags).
    let thread = null;
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
          const { data: threadData, error: threadErr } = await admin
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

          if (threadErr || !threadData) {
            console.error("[VALIDATION_THREAD_WRITE_FAILED]", threadErr?.message || "no thread returned");
          } else {
            thread = threadData;
            const { error: msgErr } = await admin
              .from("thread_messages")
              .insert({
                thread_id: thread.id,
                sender_id: subscriberProfile.id,
                body: verbatim_text.trim(),
                validation_id: validationId,
              });

            if (msgErr) {
              console.error("[VALIDATION_THREAD_WRITE_FAILED]", msgErr.message);
            }
          }
        } catch (err) {
          console.error("[VALIDATION_THREAD_WRITE_FAILED]", err?.message || err);
        }
      }

      // Compute curator's current-month earnings (best-effort). A failure here
      // must NOT block the email send or fail the validation request.
      let curatorEarnings = null;
      try {
        const earningsNow = new Date();
        const earningsResult = await calculateMonthlyEarnings({
          curatorId,
          monthStart: startOfMonthISO(earningsNow),
          monthEnd: startOfNextMonthISO(earningsNow),
          supabase: admin,
        });
        curatorEarnings = earningsResult?.hero?.total_earnings || null;
      } catch (err) {
        console.error("[VALIDATION_EARNINGS_LOOKUP_FAILED]", err?.message || err);
      }

      // Curator's payout_email flag is checked inside the helper.
      try {
        const emailResult = await sendValidationReceivedEmail({
          validationId: validationId,
          threadId: thread?.id,
          supabaseAdmin: admin,
          curatorEarnings,
        });
        if (!emailResult.ok && !emailResult.skipped) {
          console.error("[VALIDATION_EMAIL_FAILED]", emailResult.error, emailResult.detail);
        }
      } catch (err) {
        console.error("[VALIDATION_EMAIL_FAILED]", err?.message || err);
      }
    }

    console.log("[VALIDATION_CREATED]", {
      validationId: validationId,
      subscriberId: subscriberProfile.id,
      curatorId,
      recId: rec_id,
      commentId,
    });

    return NextResponse.json({
      validation_id: validationId,
      comment_id: commentId,
      thread_id: thread?.id || null,
    });
  } catch (err) {
    console.error("[VALIDATION_ROUTE_ERROR]", err?.message || err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
