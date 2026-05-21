import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { resend } from '@/lib/resend';
import { generateEmailToken } from '@/lib/email-tokens';
import { newRecEmail } from '@/lib/email-templates';
import { siteUrl } from '@/lib/site-url';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    // Session check — this endpoint is only callable by an authed curator
    const cookieStore = cookies();
    const authedSupabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll() { /* no-op: route handler, response cookies unused */ },
        },
      }
    );
    const { data: { session } } = await authedSupabase.auth.getSession();
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { recId, curatorId, silent } = await request.json();

    if (!recId || !curatorId) {
      return Response.json({ error: 'recId and curatorId required' }, { status: 400 });
    }

    // Ownership check — caller must be the curator whose save this notifies for
    const { data: callerProfile, error: callerErr } = await supabase
      .from('profiles')
      .select('id, handle')
      .eq('auth_user_id', session.user.id)
      .single();
    if (callerErr || !callerProfile || callerProfile.id !== curatorId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Per-save silent flag — curator opted out of subscriber notifications for this rec
    if (silent === true) {
      console.log('[NOTIFY_SKIPPED]', { recId, curatorId, reason: 'silent_flag' });
      return Response.json({ skipped: true, reason: 'silent' }, { status: 200 });
    }

    // Fetch the rec
    const { data: rec, error: recError } = await supabase
      .from('recommendations')
      .select('id, title, context, category, slug, visibility, status')
      .eq('id', recId)
      .single();

    if (recError || !rec) {
      return Response.json({ error: 'Rec not found' }, { status: 404 });
    }

    // Only send for public approved recs
    if (rec.visibility !== 'public' || rec.status !== 'approved') {
      return Response.json({ skipped: true, reason: 'not public/approved' });
    }

    // Fetch curator profile
    const { data: curator, error: curatorError } = await supabase
      .from('profiles')
      .select('id, name, handle')
      .eq('id', curatorId)
      .single();

    if (curatorError || !curator) {
      return Response.json({ error: 'Curator not found' }, { status: 404 });
    }

    // Fetch active subscribers (exclude the curator themselves)
    const { data: subscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('subscriber_id')
      .eq('curator_id', curatorId)
      .is('unsubscribed_at', null)
      .neq('subscriber_id', curatorId);

    if (subsError) {
      console.error('[new-rec] subscriptions fetch error:', subsError);
      return Response.json({ error: 'Failed to fetch subscriptions' }, { status: 500 });
    }

    if (!subscriptions || subscriptions.length === 0) {
      return Response.json({ sent: 0, reason: 'no active subscribers' });
    }

    const subscriberIds = subscriptions.map(s => s.subscriber_id);

    // Fetch subscriber profiles with new_rec_email_enabled = true
    const { data: subscribers, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, handle, auth_user_id')
      .in('id', subscriberIds)
      .eq('new_rec_email_enabled', true);

    if (profilesError) {
      console.error('[new-rec] profiles fetch error:', profilesError);
      return Response.json({ error: 'Failed to fetch subscriber profiles' }, { status: 500 });
    }

    if (!subscribers || subscribers.length === 0) {
      return Response.json({ sent: 0, reason: 'all subscribers opted out' });
    }

    // Build rec URL
    const cleanHandle = (curator.handle || '').replace(/^@/, '');
    const recUrl = siteUrl(`/${cleanHandle}/${rec.slug}`);

    // Map category to label
    const categoryLabels = {
      music: 'Listen',
      podcast: 'Listen',
      film: 'Watch',
      tv: 'Watch',
      video: 'Watch',
      book: 'Read',
      article: 'Read',
      restaurant: 'Eat',
      place: 'Visit',
      product: 'Buy',
    };
    const categoryLabel = rec.category ? (categoryLabels[rec.category.toLowerCase()] || rec.category) : null;

    // Send emails
    let sentCount = 0;
    const errors = [];

    for (const subscriber of subscribers) {
      try {
        // Look up email via auth admin
        const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(subscriber.auth_user_id);
        if (authError || !authUser?.user?.email) {
          console.error(`[new-rec] no email for subscriber ${subscriber.id}:`, authError);
          errors.push({ subscriberId: subscriber.id, error: 'no email' });
          continue;
        }

        const recipientEmail = authUser.user.email;

        // Generate unsubscribe token
        const token = await generateEmailToken(subscriber.id, 'unsubscribe', { type: 'new_rec_email' });
        const unsubUrl = siteUrl(`/api/email-action?token=${token}`);

        // Build email
        const { subject, html, text } = newRecEmail({
          curatorDisplayName: curator.name || null,
          curatorHandle: cleanHandle,
          recTitle: rec.title,
          category: categoryLabel,
          why: rec.context || '',
          recUrl,
          unsubUrl,
        });

        // Send
        const { error: sendError } = await resend.emails.send({
          from: 'Curators <notifications@curators.com>',
          to: recipientEmail,
          subject,
          html,
          text,
          headers: {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });

        if (sendError) {
          console.error(`[new-rec] send error for ${recipientEmail}:`, sendError);
          errors.push({ subscriberId: subscriber.id, error: sendError.message });
          continue;
        }

        // Log to notification_log
        await supabase.from('notification_log').insert({
          type: 'new_rec_realtime',
          recipient_id: subscriber.id,
          recipient_email: recipientEmail,
          curator_id: curatorId,
          rec_ids: [rec.id],
          sent_at: new Date().toISOString(),
          status: 'sent',
        });

        sentCount++;
      } catch (err) {
        console.error(`[new-rec] unexpected error for subscriber ${subscriber.id}:`, err);
        errors.push({ subscriberId: subscriber.id, error: err.message });
      }
    }

    return Response.json({ sent: sentCount, errors: errors.length > 0 ? errors : undefined });

  } catch (err) {
    console.error('[new-rec] route error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
