import { createClient } from '@supabase/supabase-js';
import { resend } from '@/lib/resend';
import { generateEmailToken } from '@/lib/email-tokens';
import { weeklyDigestEmail } from '@/lib/email-templates';
import { siteUrl } from '@/lib/site-url';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function GET(request) {
  // Verify request is from Vercel Cron
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = getServiceClient();
  const results = { sent: 0, skipped: 0, errors: 0 };

  try {
    // Get all profiles with weekly digest enabled
    const { data: profiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, name, handle, auth_user_id, created_at')
      .eq('weekly_digest_enabled', true);

    if (profErr) {
      console.error('Failed to fetch profiles:', profErr);
      return new Response(JSON.stringify({ error: 'Failed to fetch profiles' }), { status: 500 });
    }

    for (const profile of (profiles || [])) {
      try {
        // Idempotency check: skip if digest already sent in last 6 days
        const { data: recentDigest } = await supabase
          .from('notification_log')
          .select('id')
          .eq('recipient_id', profile.id)
          .eq('type', 'new_rec_digest')
          .gte('sent_at', new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1);

        if (recentDigest && recentDigest.length > 0) {
          console.log(`[DIGEST_SKIP] Already sent to @${profile.handle} (profile ${profile.id}) within 6 days`);
          results.skipped++;
          continue;
        }

        // Get active subscriptions
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('id, curator_id')
          .eq('subscriber_id', profile.id)
          .is('unsubscribed_at', null);

        if (!subs || subs.length === 0) {
          results.skipped++;
          continue;
        }

        const curatorIds = subs.map(s => s.curator_id);

        // Determine rec window: last successful digest send, or profile created_at, or 30 days ago
        const { data: lastSent } = await supabase
          .from('notification_log')
          .select('sent_at')
          .eq('recipient_id', profile.id)
          .eq('type', 'new_rec_digest')
          .eq('status', 'sent')
          .order('sent_at', { ascending: false })
          .limit(1);

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const sinceDate = lastSent?.[0]?.sent_at || profile.created_at || thirtyDaysAgo;

        // Get new recs from subscribed curators
        const { data: recs } = await supabase
          .from('recommendations')
          .select('id, title, context, category, tags, slug, profile_id, created_at')
          .in('profile_id', curatorIds)
          .eq('status', 'approved')
          .eq('visibility', 'public')
          .gt('created_at', sinceDate)
          .order('created_at', { ascending: false });

        if (!recs || recs.length === 0) {
          results.skipped++;
          continue;
        }

        // Get curator profiles for the recs
        const recCuratorIds = [...new Set(recs.map(r => r.profile_id))];
        const { data: curatorProfiles } = await supabase
          .from('profiles')
          .select('id, name, handle')
          .in('id', recCuratorIds);

        const curatorMap = {};
        (curatorProfiles || []).forEach(p => { curatorMap[p.id] = p; });

        // Get curator email
        const { data: { user } } = await supabase.auth.admin.getUserById(profile.auth_user_id);
        if (!user?.email) {
          console.error('No email for profile:', profile.id);
          results.errors++;
          continue;
        }

        // Generate unsubscribe token
        const unsubToken = await generateEmailToken(profile.id, 'unsubscribe', { type: 'weekly_digest' });
        const unsubscribeUrl = siteUrl(`/api/email-action?token=${unsubToken}`);

        // Generate save tokens for each rec
        const recsWithUrls = await Promise.all(recs.map(async (rec) => {
          const saveToken = await generateEmailToken(profile.id, 'save_rec', { rec_id: rec.id });
          const curator = curatorMap[rec.profile_id];
          return {
            title: rec.title,
            context: rec.context,
            category: rec.category,
            tags: rec.tags,
            slug: rec.slug,
            curatorName: curator?.name || 'Unknown',
            curatorHandle: curator?.handle || '',
            saveUrl: siteUrl(`/api/email-action?token=${saveToken}`),
          };
        }));

        // Build email
        const { subject, html, text } = weeklyDigestEmail({
          recs: recsWithUrls,
          subscribedCount: subs.length,
          unsubscribeUrl,
        });

        // Optimistic insert: log before send with status 'pending'
        const { data: logRow, error: logErr } = await supabase
          .from('notification_log')
          .insert({
            type: 'new_rec_digest',
            recipient_id: profile.id,
            recipient_email: user.email,
            rec_ids: recs.map(r => r.id),
            status: 'pending',
          })
          .select('id')
          .single();

        if (logErr) {
          console.error('Failed to create notification log:', logErr);
          results.errors++;
          continue;
        }

        // Send email
        const { error: sendErr } = await resend.emails.send({
          from: 'Curators <notifications@curators.com>',
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
          console.error('Failed to send digest to:', user.email, sendErr);
          await supabase
            .from('notification_log')
            .update({ status: 'failed' })
            .eq('id', logRow.id);
          results.errors++;
          continue;
        }

        // Mark as sent
        await supabase
          .from('notification_log')
          .update({ status: 'sent' })
          .eq('id', logRow.id);

        // Update last_notified_at on subscriptions
        const now = new Date().toISOString();
        await supabase
          .from('subscriptions')
          .update({ last_notified_at: now })
          .eq('subscriber_id', profile.id)
          .in('curator_id', curatorIds)
          .is('unsubscribed_at', null);

        results.sent++;
      } catch (err) {
        console.error('Digest error for profile:', profile.id, err);
        results.errors++;
      }
    }

    return new Response(JSON.stringify(results));
  } catch (err) {
    console.error('Weekly digest cron error:', err);
    return new Response(JSON.stringify({ error: 'Cron failed' }), { status: 500 });
  }
}
