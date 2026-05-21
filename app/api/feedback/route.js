import { createClient } from '@supabase/supabase-js';
import { resend } from '@/lib/resend';
import { sha256 } from '@/lib/rec-files/hash';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(req) {
  const { profileId, handle, originalMessage, elaboration, summary, screenshot_base64, screenshot_mime_type } = await req.json();

  const { data: inserted, error } = await supabase
    .from('feedback')
    .insert({
      profile_id: profileId,
      handle,
      original_message: originalMessage,
      elaboration: elaboration || null,
      summary: summary || null,
    })
    .select('id')
    .single();

  if (error) {
    console.error('FEEDBACK DB ERROR:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  const feedbackId = inserted.id;
  let screenshotPath = null;

  // Optional screenshot upload. Never blocks feedback submission.
  if (screenshot_base64 && screenshot_mime_type) {
    try {
      const bytes = Buffer.from(screenshot_base64, 'base64');
      const hash = sha256(bytes);
      const uploadPath = `feedback/${feedbackId}/${hash}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('artifacts')
        .upload(uploadPath, bytes, {
          contentType: screenshot_mime_type,
          upsert: false,
        });
      if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) {
        console.error('[FEEDBACK_SCREENSHOT_UPLOAD_ERROR]', uploadError.message);
      } else {
        const { error: updateError } = await supabase
          .from('feedback')
          .update({ screenshot_path: uploadPath })
          .eq('id', feedbackId);
        if (updateError) {
          console.error('[FEEDBACK_SCREENSHOT_UPLOAD_ERROR]', `row update failed: ${updateError.message}`);
        } else {
          screenshotPath = uploadPath;
          console.log('[FEEDBACK_SCREENSHOT_UPLOADED]', screenshotPath);
        }
      }
    } catch (err) {
      console.error('[FEEDBACK_SCREENSHOT_UPLOAD_ERROR]', err?.message || err);
    }
  }

  // Build signed URL for the email (7-day TTL). Null if no screenshot or URL generation fails.
  let screenshotSignedUrl = null;
  if (screenshotPath) {
    try {
      const { data: signedData, error: signedError } = await supabase.storage
        .from('artifacts')
        .createSignedUrl(screenshotPath, 60 * 60 * 24 * 7);
      if (signedError) {
        console.error('[FEEDBACK_SIGNED_URL_ERROR]', signedError.message);
      } else {
        screenshotSignedUrl = signedData.signedUrl;
      }
    } catch (err) {
      console.error('[FEEDBACK_SIGNED_URL_ERROR]', err?.message || err);
    }
  }

  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 're_placeholder') {
    try {
      const screenshotLine = screenshotSignedUrl ? `Screenshot: ${screenshotSignedUrl}\n\n` : '';
      await resend.emails.send({
        from: 'Curators <noreply@curators.com>',
        to: process.env.FEEDBACK_EMAIL,
        subject: `Feedback from @${handle}`,
        text: `Handle: @${handle}\n\n${screenshotLine}Summary: ${summary}\n\nOriginal message: ${originalMessage}\n\nElaboration: ${elaboration || 'None provided'}\n\nTimestamp: ${new Date().toISOString()}`,
      });
    } catch (emailError) {
      console.error('FEEDBACK EMAIL ERROR:', emailError);
    }
  }

  return Response.json({ success: true });
}
