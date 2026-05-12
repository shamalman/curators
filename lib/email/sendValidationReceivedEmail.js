import { resend } from '@/lib/resend';
import { generateEmailToken } from '@/lib/email-tokens';
import { validationReceivedEmail } from '@/lib/email-templates';

// Sends the "validation received" email to a curator. Caller supplies a
// service-role supabase client and the validation row id. Never throws;
// returns a result object.
//
// Returns:
//   { ok: true, sent: true }
//   { ok: true, skipped: true, reason: '...' }
//   { ok: false, error, detail? }
export async function sendValidationReceivedEmail({ validationId, threadId, supabaseAdmin, curatorEarnings }) {
  const sb = supabaseAdmin;

  const { data: validation, error: vErr } = await sb
    .from('validations')
    .select('id, subscriber_id, curator_id, rec_id, verbatim_text, sent_to_curator')
    .eq('id', validationId)
    .single();

  if (vErr || !validation) {
    return { ok: false, error: 'validation_not_found', detail: vErr?.message };
  }

  if (!validation.sent_to_curator) {
    return { ok: true, skipped: true, reason: 'not_sent_to_curator' };
  }

  const { data: curator, error: curatorErr } = await sb
    .from('profiles')
    .select('id, name, handle, auth_user_id, feature_flags, validation_received_email_enabled')
    .eq('id', validation.curator_id)
    .single();

  if (curatorErr || !curator) {
    return { ok: false, error: 'curator_not_found', detail: curatorErr?.message };
  }

  if (curator.feature_flags?.payout_email !== true) {
    return { ok: true, skipped: true, reason: 'payout_email_disabled' };
  }

  // Recipient opt-out preference. Column defaults to true; treat
  // explicit false as the only skip signal so a missing column (during
  // partial deploy) still sends.
  if (curator.validation_received_email_enabled === false) {
    return { ok: true, skipped: true, reason: 'pref_disabled' };
  }

  if (!curator.auth_user_id) {
    return { ok: false, error: 'curator_auth_user_id_missing' };
  }

  const { data: { user }, error: authErr } = await sb.auth.admin.getUserById(curator.auth_user_id);
  if (authErr || !user?.email) {
    return { ok: false, error: 'curator_email_unavailable', detail: authErr?.message };
  }

  const { data: subscriber, error: subErr } = await sb
    .from('profiles')
    .select('id, handle')
    .eq('id', validation.subscriber_id)
    .single();

  if (subErr || !subscriber) {
    return { ok: false, error: 'subscriber_not_found', detail: subErr?.message };
  }

  const { data: rec, error: recErr } = await sb
    .from('recommendations')
    .select('id, title, slug')
    .eq('id', validation.rec_id)
    .single();

  if (recErr || !rec) {
    return { ok: false, error: 'rec_not_found', detail: recErr?.message };
  }

  const recTitle = rec.title || '(untitled)';
  const recSource = '';
  const recUrl = threadId
    ? `https://curators.ai/subs?segment=messages&thread=${threadId}`
    : `https://curators.ai/${curator.handle}/${rec.slug}`;

  const unsubToken = await generateEmailToken(curator.id, 'unsubscribe', { type: 'validation_received_email' });
  const unsubscribeUrl = `https://curators.ai/api/email-action?token=${unsubToken}`;

  const { subject, html, text } = validationReceivedEmail({
    curatorHandle: curator.handle,
    subscriberHandle: subscriber.handle,
    verbatimText: validation.verbatim_text,
    recTitle,
    recSource,
    recUrl,
    unsubscribeUrl,
    curatorEarnings,
  });

  const { error: sendErr } = await resend.emails.send({
    from: 'Curators.AI <notifications@curators.ai>',
    to: user.email,
    subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  if (sendErr) {
    return { ok: false, error: 'send_failed', detail: sendErr.message };
  }

  await sb.from('notification_log').insert({
    type: 'validation_received',
    recipient_id: curator.id,
    recipient_email: user.email,
    curator_id: validation.subscriber_id,
  });

  return { ok: true, sent: true };
}
