import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { sendNewSubscriberEmail } from '@/lib/email/sendNewSubscriberEmail';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function POST(request) {
  try {
    // Session check — this endpoint is only callable by the authed subscriber
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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }

    const { curatorId, subscriberId } = await request.json();
    if (!curatorId || !subscriberId) {
      return new Response(JSON.stringify({ error: 'Missing curatorId or subscriberId' }), { status: 400 });
    }

    const supabase = getServiceClient();

    // Ownership check — caller must be the subscriber initiating the subscribe action
    const { data: callerProfile, error: callerErr } = await supabase
      .from('profiles')
      .select('id, handle')
      .eq('auth_user_id', session.user.id)
      .single();
    if (callerErr || !callerProfile || callerProfile.id !== subscriberId) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    const result = await sendNewSubscriberEmail({
      curatorId,
      subscriberId,
      supabaseAdmin: supabase,
    });

    if (!result.ok) {
      console.error('[notify/new-subscriber] error:', result.error, result.detail);
      const status = result.error === 'curator_not_found' ? 404 : 500;
      return new Response(JSON.stringify({ error: result.error }), { status });
    }

    if (result.skipped) {
      return new Response(JSON.stringify({ skipped: true, reason: result.reason }));
    }

    return new Response(JSON.stringify({ sent: true }));
  } catch (err) {
    console.error('New subscriber notification error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
}
