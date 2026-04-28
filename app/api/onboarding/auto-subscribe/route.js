import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendNewSubscriberEmail } from "@/lib/email/sendNewSubscriberEmail";

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only fire notification emails when the upsert represents a real state transition.
// 'exists' means the row was already active — the curator was notified previously.
const SHOULD_EMAIL = new Set(["created", "reactivated", "exists_race"]);

// Insert (or reactivate) a single subscription row. New rows are tagged source='invite';
// reactivation preserves the original source so a manual sub re-activated via invite keeps
// its provenance.
async function upsertInviteSubscription(sb, { subscriberId, curatorId }) {
  const { data: existing, error: existingErr } = await sb
    .from("subscriptions")
    .select("id, unsubscribed_at")
    .eq("subscriber_id", subscriberId)
    .eq("curator_id", curatorId)
    .maybeSingle();

  if (existingErr) {
    return { ok: false, error: "existing_lookup", detail: existingErr.message };
  }

  if (existing) {
    if (existing.unsubscribed_at) {
      const { error: reactivateErr } = await sb
        .from("subscriptions")
        .update({ unsubscribed_at: null, subscribed_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (reactivateErr) return { ok: false, error: "reactivate", detail: reactivateErr.message };
      return { ok: true, result: "reactivated" };
    }
    return { ok: true, result: "exists" };
  }

  const { error: insertErr } = await sb
    .from("subscriptions")
    .insert({
      subscriber_id: subscriberId,
      curator_id: curatorId,
      subscribed_at: new Date().toISOString(),
      digest_frequency: "weekly",
      source: "invite",
    });

  if (insertErr) {
    if (insertErr.code === "23505") return { ok: true, result: "exists_race" };
    return { ok: false, error: "insert", code: insertErr.code, detail: insertErr.message };
  }

  return { ok: true, result: "created" };
}

export async function POST(req) {
  try {
    const { profileId, inviterId } = await req.json();

    // Soft-skip when there is no inviter (legacy seed codes have created_by=null).
    if (inviterId == null) {
      console.log(`[AUTO_SUBSCRIBE_NULL_INVITER] profileId=${profileId}`);
      return NextResponse.json({ success: true, skipped: true, reason: "no_inviter" });
    }

    if (!profileId || !UUID_RE.test(profileId) || !UUID_RE.test(inviterId)) {
      console.error(`[AUTO_SUBSCRIBE] result=bad_request profileId=${profileId} inviterId=${inviterId}`);
      return NextResponse.json({ ok: false, error: "invalid_ids" }, { status: 400 });
    }

    if (profileId === inviterId) {
      console.error(`[AUTO_SUBSCRIBE] result=self_subscribe profileId=${profileId}`);
      return NextResponse.json({ ok: false, error: "self_subscribe" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();

    // Defense check — confirm profile.invited_by actually equals the claimed inviterId.
    const { data: profile, error: profileErr } = await sb
      .from("profiles")
      .select("invited_by")
      .eq("id", profileId)
      .maybeSingle();

    if (profileErr) {
      console.error(`[AUTO_SUBSCRIBE] result=profile_lookup_error profileId=${profileId} error=${profileErr.message}`);
      return NextResponse.json({ ok: false, error: "profile_lookup" }, { status: 500 });
    }
    if (!profile) {
      console.error(`[AUTO_SUBSCRIBE] result=profile_not_found profileId=${profileId}`);
      return NextResponse.json({ ok: false, error: "profile_not_found" }, { status: 404 });
    }
    if (profile.invited_by !== inviterId) {
      console.error(`[AUTO_SUBSCRIBE] result=mismatch profileId=${profileId} claimed=${inviterId} actual=${profile.invited_by}`);
      return NextResponse.json({ ok: false, error: "inviter_mismatch" }, { status: 403 });
    }

    // Row 1: invitee → inviter (forward).
    const fwd = await upsertInviteSubscription(sb, { subscriberId: profileId, curatorId: inviterId });
    if (!fwd.ok) {
      console.error(`[AUTO_SUBSCRIBE] direction=forward result=${fwd.error} profileId=${profileId} inviterId=${inviterId} code=${fwd.code || ""} detail=${fwd.detail || ""}`);
      return NextResponse.json({ ok: false, error: fwd.error }, { status: 500 });
    }
    console.log(`[AUTO_SUBSCRIBE] direction=forward result=${fwd.result} profileId=${profileId} inviterId=${inviterId}`);

    // Row 2: inviter → invitee (reverse).
    const rev = await upsertInviteSubscription(sb, { subscriberId: inviterId, curatorId: profileId });
    let bothDirections = true;
    if (!rev.ok) {
      bothDirections = false;
      console.error(`[AUTO_SUBSCRIBE_REVERSE_FAIL] profileId=${profileId} inviterId=${inviterId} forward_result=${fwd.result} reverse_error=${rev.error} code=${rev.code || ""} detail=${rev.detail || ""}`);
    } else {
      console.log(`[AUTO_SUBSCRIBE] direction=reverse result=${rev.result} profileId=${profileId} inviterId=${inviterId}`);
    }

    // Fire notification emails — non-blocking on failures. Only email when the upsert
    // represents a real state transition (created / reactivated / exists_race), not when
    // the row was already active. If the reverse write failed, we don't email the invitee
    // because there's no row to back it up.
    const emailJobs = [];
    if (SHOULD_EMAIL.has(fwd.result)) {
      emailJobs.push({
        direction: "to_inviter",
        task: () => sendNewSubscriberEmail({ curatorId: inviterId, subscriberId: profileId, supabaseAdmin: sb }),
      });
    } else {
      console.log(`[AUTO_SUBSCRIBE_EMAIL_SKIP] direction=to_inviter profileId=${profileId} inviterId=${inviterId} reason=already_subscribed`);
    }
    if (bothDirections && SHOULD_EMAIL.has(rev.result)) {
      emailJobs.push({
        direction: "to_invitee",
        task: () => sendNewSubscriberEmail({ curatorId: profileId, subscriberId: inviterId, supabaseAdmin: sb }),
      });
    } else if (bothDirections) {
      console.log(`[AUTO_SUBSCRIBE_EMAIL_SKIP] direction=to_invitee profileId=${profileId} inviterId=${inviterId} reason=already_subscribed`);
    }

    const settled = await Promise.allSettled(emailJobs.map(j => j.task()));
    settled.forEach((r, i) => {
      const direction = emailJobs[i].direction;
      if (r.status === "rejected") {
        console.error(`[AUTO_SUBSCRIBE_EMAIL_FAIL] direction=${direction} profileId=${profileId} inviterId=${inviterId} error=${r.reason?.message || r.reason}`);
      } else if (!r.value.ok) {
        console.error(`[AUTO_SUBSCRIBE_EMAIL_FAIL] direction=${direction} profileId=${profileId} inviterId=${inviterId} error=${r.value.error} detail=${r.value.detail || ""}`);
      } else if (r.value.skipped) {
        console.log(`[AUTO_SUBSCRIBE_EMAIL_SKIP] direction=${direction} profileId=${profileId} inviterId=${inviterId} reason=${r.value.reason}`);
      } else {
        console.log(`[AUTO_SUBSCRIBE_EMAIL_SENT] direction=${direction} profileId=${profileId} inviterId=${inviterId}`);
      }
    });

    return NextResponse.json({ success: true, both_directions: bothDirections });
  } catch (err) {
    console.error(`[AUTO_SUBSCRIBE] result=unexpected error=${err.message}`);
    return NextResponse.json({ ok: false, error: "unexpected" }, { status: 500 });
  }
}
