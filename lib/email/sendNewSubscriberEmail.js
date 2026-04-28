import { resend } from '@/lib/resend';
import { generateEmailToken } from '@/lib/email-tokens';
import { newSubscriberEmail } from '@/lib/email-templates';

// Sends the "you have a new subscriber" email to a curator. Caller supplies a
// service-role supabase client. Never throws; returns a result object.
//
// Returns:
//   { ok: true, sent: true }
//   { ok: true, skipped: true, reason: 'notifications_disabled' }
//   { ok: false, error, detail? }
export async function sendNewSubscriberEmail({ curatorId, subscriberId, supabaseAdmin }) {
  const sb = supabaseAdmin;

  const { data: curator, error: curatorErr } = await sb
    .from('profiles')
    .select('id, name, handle, auth_user_id, new_subscriber_email_enabled')
    .eq('id', curatorId)
    .single();

  if (curatorErr || !curator) {
    return { ok: false, error: 'curator_not_found', detail: curatorErr?.message };
  }

  if (curator.new_subscriber_email_enabled === false) {
    return { ok: true, skipped: true, reason: 'notifications_disabled' };
  }

  const { data: { user }, error: authErr } = await sb.auth.admin.getUserById(curator.auth_user_id);
  if (authErr || !user?.email) {
    return { ok: false, error: 'curator_email_unavailable', detail: authErr?.message };
  }

  const { data: subscriber } = await sb
    .from('profiles')
    .select('id, name, handle')
    .eq('id', subscriberId)
    .single();

  const subscriberName = subscriber?.name || 'Someone';
  const subscriberHandle = subscriber?.handle || null;

  const { count: subscriberCount } = await sb
    .from('subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('curator_id', curatorId)
    .is('unsubscribed_at', null);

  const unsubToken = await generateEmailToken(curator.id, 'unsubscribe', { type: 'new_subscriber_email' });
  const unsubscribeUrl = `https://curators.ai/api/email-action?token=${unsubToken}`;

  const { subject, html, text } = newSubscriberEmail({
    subscriberName,
    subscriberHandle,
    subscriberCount: subscriberCount || 0,
    unsubscribeUrl,
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
    type: 'new_subscriber',
    recipient_id: curator.id,
    recipient_email: user.email,
    curator_id: subscriberId,
  });

  return { ok: true, sent: true };
}
