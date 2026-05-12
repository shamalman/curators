import { createClient } from '@supabase/supabase-js';
import { validateEmailToken, markTokenUsed } from '@/lib/email-tokens';

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return Response.redirect('https://curators.ai', 302);
  }

  const supabase = getServiceClient();

  // Try each action type
  for (const action of ['unsubscribe', 'save_rec', 'update_settings']) {
    const tokenData = await validateEmailToken(token, action);
    if (!tokenData) continue;

    try {
      switch (action) {
        case 'unsubscribe': {
          const { type } = tokenData.payload || {};
          if (type === 'new_subscriber_email') {
            await supabase
              .from('profiles')
              .update({ new_subscriber_email_enabled: false })
              .eq('id', tokenData.profile_id);
          } else if (type === 'weekly_digest') {
            await supabase
              .from('profiles')
              .update({ weekly_digest_enabled: false })
              .eq('id', tokenData.profile_id);
          } else if (type === 'new_rec_email') {
            await supabase
              .from('profiles')
              .update({ new_rec_email_enabled: false })
              .eq('id', tokenData.profile_id);
          } else if (type === 'validation_received_email') {
            await supabase
              .from('profiles')
              .update({ validation_received_email_enabled: false })
              .eq('id', tokenData.profile_id);
          }
          await markTokenUsed(tokenData.id);
          return Response.redirect('https://curators.ai/email/unsubscribed', 302);
        }

        case 'save_rec': {
          const { rec_id } = tokenData.payload || {};
          if (rec_id) {
            const { error } = await supabase.from('saved_recs').insert({
              profile_id: tokenData.profile_id,
              rec_id,
            });
            if (error && error.code !== '23505') {
              console.error('Failed to save rec:', error);
            }
          }
          await markTokenUsed(tokenData.id);
          return Response.redirect('https://curators.ai/email/saved', 302);
        }

        case 'update_settings': {
          const { column, value } = tokenData.payload || {};
          if (column && ['weekly_digest_enabled', 'new_subscriber_email_enabled'].includes(column)) {
            await supabase
              .from('profiles')
              .update({ [column]: value })
              .eq('id', tokenData.profile_id);
          }
          await markTokenUsed(tokenData.id);
          return Response.redirect('https://curators.ai/email/unsubscribed', 302);
        }
      }
    } catch (err) {
      console.error('Email action error:', err);
      return Response.redirect('https://curators.ai', 302);
    }
  }

  // Token not found or expired
  return Response.redirect('https://curators.ai', 302);
}

// Support POST for List-Unsubscribe-Post (RFC 8058 one-click)
export async function POST(request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  const supabase = getServiceClient();

  const tokenData = await validateEmailToken(token, 'unsubscribe');
  if (!tokenData) {
    return new Response('Invalid or expired token', { status: 400 });
  }

  const { type } = tokenData.payload || {};
  if (type === 'new_subscriber_email') {
    await supabase
      .from('profiles')
      .update({ new_subscriber_email_enabled: false })
      .eq('id', tokenData.profile_id);
  } else if (type === 'weekly_digest') {
    await supabase
      .from('profiles')
      .update({ weekly_digest_enabled: false })
      .eq('id', tokenData.profile_id);
  } else if (type === 'new_rec_email') {
    await supabase
      .from('profiles')
      .update({ new_rec_email_enabled: false })
      .eq('id', tokenData.profile_id);
  } else if (type === 'validation_received_email') {
    await supabase
      .from('profiles')
      .update({ validation_received_email_enabled: false })
      .eq('id', tokenData.profile_id);
  }

  await markTokenUsed(tokenData.id);
  return new Response('Unsubscribed', { status: 200 });
}
