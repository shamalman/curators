// Curators.AI email design system — single source of truth for all transactional email.
// Visual language: cream card on cream page, Newsreader serif for headlines, Manrope sans for UI,
// #D4956B accent, rounded 12px card. All templates return { subject, html, text } and MUST use
// emailShell + emailFooter.

const SERIF = "Newsreader, Georgia, 'Times New Roman', serif";
const SANS = "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const PAGE_BG = '#F5F2EC';
const CARD_BG = '#FAF8F3';
const INK = '#2C2C2A';
const INK2 = '#6B6B66';
const INK3 = '#888780';
const DIVIDER = '#D3D1C7';
const ACCENT = '#D4956B';
const CREAM = '#FAF8F3';

const CAT_COLORS = {
  watch: '#8E80B5', listen: '#4B92CC', read: '#CC6658', visit: '#5E9E82',
  get: '#C27850', wear: '#CC7090', play: '#D4B340', other: '#B08860',
};

const escapeHtml = (s) => s == null ? '' : String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const EMAIL_TOKENS = {
  SERIF, SANS, PAGE_BG, CARD_BG, INK, INK2, INK3, DIVIDER, ACCENT, CREAM, CAT_COLORS,
};

function emailWordmark() {
  return `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr><td style="font-family:${SERIF};font-size:13px;color:${INK2};letter-spacing:0.08em;text-transform:uppercase;">curators.ai</td></tr>
        </table>
        <div style="line-height:24px;font-size:0;">&nbsp;</div>`;
}

function emailFooter({ contextLine, unsubLabel = 'Unsubscribe', unsubUrl, settingsLabel = 'Notification settings', settingsUrl = 'https://curators.ai/settings' }) {
  return `
        <div style="line-height:32px;font-size:0;">&nbsp;</div>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr><td height="1" style="height:1px;line-height:1px;font-size:0;background-color:${DIVIDER};">&nbsp;</td></tr>
        </table>
        <div style="line-height:20px;font-size:0;">&nbsp;</div>
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr><td style="font-family:${SANS};font-size:12px;color:${INK3};line-height:1.6;">
            ${contextLine}
          </td></tr>
          <tr><td style="font-family:${SANS};font-size:12px;color:${INK3};line-height:1.6;">
            <a href="${escapeHtml(unsubUrl)}" style="color:${INK3};text-decoration:underline;">${escapeHtml(unsubLabel)}</a> · <a href="${escapeHtml(settingsUrl)}" style="color:${INK3};text-decoration:underline;">${escapeHtml(settingsLabel)}</a>
          </td></tr>
        </table>`;
}

function emailShell({ title, preheader, innerHtml }) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="color-scheme" content="light"/>
<meta name="supported-color-schemes" content="light"/>
<title>${escapeHtml(title)}</title>
<style>
  @media only screen and (max-width: 480px) {
    .card-pad { padding: 24px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE_BG};">${escapeHtml(preheader || '')}</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background:${PAGE_BG};">
  <tr><td align="center" style="padding:24px 16px;">
    <!--[if mso]>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="560" align="center"><tr><td>
    <![endif]-->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;">
      <tr><td class="card-pad" style="background:${CARD_BG};border-radius:12px;padding:32px;">
${emailWordmark()}
${innerHtml}
      </td></tr>
    </table>
    <!--[if mso]>
    </td></tr></table>
    <![endif]-->
  </td></tr>
</table>
</body>
</html>`;
}

function capWords(str, max) {
  if (!str || str.length <= max) return str || '';
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
}

function makePreheader(str, max = 90) {
  const normalized = (str || '').replace(/[\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  return capWords(normalized, max);
}

// ─────────────────────────────────────────────────────────────
// Template: New subscriber
// ─────────────────────────────────────────────────────────────

export function newSubscriberEmail({ subscriberName, subscriberHandle, subscriberCount, unsubscribeUrl }) {
  const hasProfile = !!subscriberHandle;
  const profileLink = hasProfile
    ? `
        <div style="line-height:12px;font-size:0;">&nbsp;</div>
        <p style="font-family:${SANS};font-size:14px;color:${INK2};line-height:1.6;margin:0;">
          They're a curator too. See what they recommend.<br/>
          <a href="https://curators.ai/${escapeHtml(subscriberHandle)}" style="color:${ACCENT};text-decoration:none;">curators.ai/${escapeHtml(subscriberHandle)}</a>
        </p>`
    : '';

  const subject = `${subscriberName} subscribed to you on Curators.AI`;
  const preheader = `You now have ${subscriberCount} subscriber${subscriberCount === 1 ? '' : 's'} on Curators.AI.`;

  const innerHtml = `
        <p style="font-family:${SERIF};font-size:22px;font-weight:500;color:${INK};line-height:1.35;margin:0;">
          ${escapeHtml(subscriberName)} just subscribed to you.
        </p>
        ${profileLink}
        <div style="line-height:24px;font-size:0;">&nbsp;</div>
        <p style="font-family:${SANS};font-size:14px;color:${INK2};line-height:1.6;margin:0;">
          You now have ${subscriberCount} subscriber${subscriberCount === 1 ? '' : 's'}.
        </p>
        ${emailFooter({
          contextLine: "You're receiving this because you're a curator on Curators.AI.",
          unsubUrl: unsubscribeUrl,
        })}`;

  const html = emailShell({ title: subject, preheader, innerHtml });

  const text = [
    `${subscriberName} just subscribed to you on Curators.AI`,
    '',
    hasProfile ? `See what they recommend: https://curators.ai/${subscriberHandle}` : '',
    hasProfile ? '' : null,
    `You now have ${subscriberCount} subscriber${subscriberCount === 1 ? '' : 's'}.`,
    '',
    '---',
    `Unsubscribe: ${unsubscribeUrl}`,
    `Notification settings: https://curators.ai/settings`,
  ].filter(l => l !== null).join('\n');

  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────
// Template: Weekly digest
// ─────────────────────────────────────────────────────────────

export function weeklyDigestEmail({ recs, subscribedCount, unsubscribeUrl }) {
  const rows = recs.map((rec, idx) => {
    const catColor = CAT_COLORS[rec.category] || CAT_COLORS.other;
    const contextSnippet = capWords(rec.context || '', 140);
    const recUrl = `https://curators.ai/${rec.curatorHandle}/${rec.slug}`;
    const isLast = idx === recs.length - 1;

    return `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr><td style="padding:20px 0;${isLast ? '' : `border-bottom:1px solid ${DIVIDER};`}">
            <div style="font-family:${SANS};font-size:12px;color:${INK2};line-height:1.5;">
              <span style="color:${INK};font-weight:500;">@${escapeHtml(rec.curatorHandle)}</span>
              <span style="color:${DIVIDER};"> · </span>
              <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:${catColor};text-transform:capitalize;">${escapeHtml(rec.category || 'other')}</span>
            </div>
            <div style="line-height:8px;font-size:0;">&nbsp;</div>
            <a href="${escapeHtml(recUrl)}" style="font-family:${SERIF};font-size:18px;font-weight:500;color:${INK};line-height:1.3;text-decoration:none;">${escapeHtml(rec.title)}</a>
            ${contextSnippet ? `
            <div style="line-height:8px;font-size:0;">&nbsp;</div>
            <table role="presentation" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td width="2" bgcolor="${ACCENT}" style="width:2px;min-width:2px;background-color:${ACCENT};line-height:1px;font-size:1px;">&nbsp;</td>
                <td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>
                <td style="font-family:${SERIF};font-style:italic;font-size:14px;line-height:1.55;color:${INK2};">${escapeHtml(contextSnippet)}</td>
              </tr>
            </table>` : ''}
            <div style="line-height:10px;font-size:0;">&nbsp;</div>
            <a href="${escapeHtml(recUrl)}" style="font-family:${SANS};font-size:13px;font-weight:500;color:${INK};text-decoration:none;border-bottom:1px solid ${INK};padding-bottom:2px;">Open recommendation →</a>
          </td></tr>
        </table>`;
  }).join('');

  const subject = `${recs.length} new recommendation${recs.length === 1 ? '' : 's'} this week`;
  const preheader = `From curators you subscribe to on Curators.AI.`;

  const innerHtml = `
        <p style="font-family:${SERIF};font-size:22px;font-weight:500;color:${INK};line-height:1.35;margin:0;">
          ${recs.length} new recommendation${recs.length === 1 ? '' : 's'} this week.
        </p>
        <div style="line-height:8px;font-size:0;">&nbsp;</div>
        <p style="font-family:${SANS};font-size:14px;color:${INK2};line-height:1.6;margin:0;">
          From curators you subscribe to on Curators.AI.
        </p>
        <div style="line-height:12px;font-size:0;">&nbsp;</div>
        ${rows}
        ${emailFooter({
          contextLine: `You're receiving this because you subscribe to ${subscribedCount} curator${subscribedCount === 1 ? '' : 's'} on Curators.AI.`,
          unsubUrl: unsubscribeUrl,
        })}`;

  const html = emailShell({ title: subject, preheader, innerHtml });

  const textLines = [
    subject,
    `From curators you subscribe to on Curators.AI.`,
    '',
  ];
  recs.forEach(rec => {
    textLines.push(`@${rec.curatorHandle} (${rec.category || 'other'}): ${rec.title}`);
    if (rec.context) textLines.push(`  "${capWords(rec.context, 140)}"`);
    textLines.push(`  https://curators.ai/${rec.curatorHandle}/${rec.slug}`);
    textLines.push('');
  });
  textLines.push('---');
  textLines.push(`Unsubscribe: ${unsubscribeUrl}`);
  textLines.push(`Notification settings: https://curators.ai/settings`);
  const text = textLines.join('\n');

  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────
// Template: Validation received (subscriber → curator, money-attached note)
// ─────────────────────────────────────────────────────────────

export function validationReceivedEmail({
  curatorHandle,
  subscriberHandle,
  verbatimText,
  recTitle,
  recSource,
  recUrl,
  unsubscribeUrl,
}) {
  const subject = `@${subscriberHandle} said this landed`;
  const preheader = makePreheader(verbatimText || `@${subscriberHandle} sent you a note about your recommendation.`, 90);

  const verbatimHtml = escapeHtml(verbatimText || '').replace(/\n/g, '<br/>');
  const aboutLine = `about: ${escapeHtml(recTitle || '(untitled)')}${recSource ? ` · ${escapeHtml(recSource)}` : ''}`;

  const innerHtml = `
        <p style="font-family:${SANS};font-size:15px;color:${INK2};line-height:1.5;margin:0;">
          Hi @${escapeHtml(curatorHandle)},
        </p>
        <div style="line-height:12px;font-size:0;">&nbsp;</div>
        <p style="font-family:${SANS};font-size:15px;color:${INK2};line-height:1.5;margin:0;">
          @${escapeHtml(subscriberHandle)} sent you a note about your recommendation.
        </p>

        <div style="line-height:24px;font-size:0;">&nbsp;</div>

        <table role="presentation" border="0" cellpadding="0" cellspacing="0">
          <tr>
            <td width="2" bgcolor="${ACCENT}" style="width:2px;min-width:2px;background-color:${ACCENT};line-height:1px;font-size:1px;">&nbsp;</td>
            <td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>
            <td style="font-family:${SERIF};font-style:italic;font-size:17px;line-height:1.55;color:${INK};">${verbatimHtml}</td>
          </tr>
        </table>

        <div style="line-height:20px;font-size:0;">&nbsp;</div>

        <p style="font-family:${SANS};font-size:13px;color:${INK3};line-height:1.5;margin:0;">
          ${aboutLine}
        </p>

        <div style="line-height:24px;font-size:0;">&nbsp;</div>

        <table role="presentation" border="0" cellpadding="0" cellspacing="0">
          <tr><td>
            <a href="${escapeHtml(recUrl)}" style="font-family:${SANS};font-size:14px;font-weight:500;color:${INK};text-decoration:none;border-bottom:1px solid ${INK};padding-bottom:2px;">Reply in Curators.AI →</a>
          </td></tr>
        </table>
        ${emailFooter({
          contextLine: `You're receiving this because @${escapeHtml(subscriberHandle)} validated one of your recs.`,
          unsubLabel: 'Manage notifications',
          unsubUrl: unsubscribeUrl,
        })}`;

  const html = emailShell({ title: subject, preheader, innerHtml });

  const text = [
    `Hi @${curatorHandle},`,
    '',
    `@${subscriberHandle} sent you a note about your recommendation.`,
    '',
    `"${verbatimText || ''}"`,
    '',
    `about: ${recTitle || '(untitled)'}${recSource ? ` · ${recSource}` : ''}`,
    '',
    `Reply in Curators.AI: ${recUrl}`,
    '',
    '---',
    `You're receiving this because @${subscriberHandle} validated one of your recs.`,
    `Manage notifications: ${unsubscribeUrl}`,
  ].join('\n');

  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────
// Template: Agent completion (NOT currently wired — design refreshed for future use)
// ─────────────────────────────────────────────────────────────

export function agentCompletionEmail({ curatorName, sourceType, unsubscribeUrl }) {
  const sourceName = sourceType === 'spotify' ? 'Spotify'
    : sourceType === 'apple_music' ? 'Apple Music'
    : sourceType === 'google_maps' ? 'Google Maps'
    : sourceType || 'your source';

  const subject = `Your AI finished studying your ${sourceName}`;
  const preheader = `Come see what your AI found.`;

  const innerHtml = `
        <p style="font-family:${SERIF};font-size:22px;font-weight:500;color:${INK};line-height:1.35;margin:0;">
          Your AI finished studying your ${escapeHtml(sourceName)}.
        </p>
        <div style="line-height:16px;font-size:0;">&nbsp;</div>
        <p style="font-family:${SANS};font-size:14px;color:${INK2};line-height:1.6;margin:0;">
          I went through everything and found some interesting patterns in your taste. Come see what I found.
        </p>
        <div style="line-height:24px;font-size:0;">&nbsp;</div>
        <a href="https://curators.ai/myai" style="font-family:${SANS};font-size:14px;font-weight:500;color:${INK};text-decoration:none;border-bottom:1px solid ${INK};padding-bottom:2px;">See what your AI found →</a>
        ${emailFooter({
          contextLine: "You're receiving this because you're a curator on Curators.AI.",
          unsubUrl: unsubscribeUrl || 'https://curators.ai/settings',
        })}`;

  const html = emailShell({ title: subject, preheader, innerHtml });

  const text = [
    subject,
    '',
    `I went through everything and found some interesting patterns in your taste. Come see what I found.`,
    '',
    `See what your AI found: https://curators.ai/myai`,
    '',
    '---',
    `Unsubscribe: ${unsubscribeUrl || 'https://curators.ai/settings'}`,
  ].join('\n');

  return { subject, html, text };
}

// ─────────────────────────────────────────────────────────────
// Template: New recommendation (real-time, per-save)
// ─────────────────────────────────────────────────────────────

export function newRecEmail({ curatorDisplayName, curatorHandle, recTitle, category, why, recUrl, unsubUrl }) {
  const displayNameValid = curatorDisplayName && String(curatorDisplayName).trim().length > 0;
  const displayForName = displayNameValid ? curatorDisplayName : `@${curatorHandle}`;

  let initials;
  if (displayNameValid) {
    const words = String(curatorDisplayName).trim().split(/\s+/);
    initials = words.length === 1
      ? words[0][0].toLowerCase()
      : (words[0][0] + words[words.length - 1][0]).toLowerCase();
  } else {
    initials = curatorHandle[0].toLowerCase();
  }

  const whyCapped = capWords(why || '', 600);
  const preheader = makePreheader(why || '', 90);
  const subject = `${displayForName} recommends ${recTitle}`;

  const categoryBlock = category ? `
              <tr><td style="font-family:${SANS};font-size:11px;color:${INK3};letter-spacing:0.12em;text-transform:uppercase;font-weight:500;">${escapeHtml(category)}</td></tr>
              <tr><td style="height:6px;line-height:6px;font-size:0;">&nbsp;</td></tr>` : '';

  const whyHtml = escapeHtml(whyCapped).replace(/\n/g, '<br/>');
  const whyBlock = whyCapped ? `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0">
          <tr>
            <td width="2" bgcolor="${ACCENT}" style="width:2px;min-width:2px;background-color:${ACCENT};line-height:1px;font-size:1px;">&nbsp;</td>
            <td width="14" style="width:14px;font-size:0;line-height:0;">&nbsp;</td>
            <td style="font-family:${SERIF};font-style:italic;font-size:16px;line-height:1.55;color:${INK};">${whyHtml}</td>
          </tr>
        </table>
        <div style="line-height:24px;font-size:0;">&nbsp;</div>` : '';

  const innerHtml = `
        <table role="presentation" border="0" cellpadding="0" cellspacing="0">
          <tr>
            <td width="32" height="32" align="center" valign="middle" style="width:32px;height:32px;background-color:${INK};color:${CREAM};border-radius:50%;font-family:${SANS};font-size:13px;font-weight:500;line-height:32px;text-align:center;mso-line-height-rule:exactly;">${escapeHtml(initials)}</td>
            <td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>
            <td valign="middle" style="font-family:${SANS};font-size:15px;line-height:1.4;color:${INK2};">
              <span style="color:${INK};font-weight:500;">${escapeHtml(displayForName)}</span> sent you a recommendation
            </td>
          </tr>
        </table>

        <div style="line-height:20px;font-size:0;">&nbsp;</div>

        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">${categoryBlock}
              <tr><td style="font-family:${SERIF};font-size:26px;font-weight:500;color:${INK};line-height:1.25;"><a href="${escapeHtml(recUrl)}" style="font-family:${SERIF};font-size:26px;font-weight:500;color:${INK};line-height:1.25;text-decoration:none;">${escapeHtml(recTitle)}</a></td></tr>
        </table>

        <div style="line-height:20px;font-size:0;">&nbsp;</div>
${whyBlock}
        <table role="presentation" border="0" cellpadding="0" cellspacing="0">
          <tr><td>
            <a href="${escapeHtml(recUrl)}" style="font-family:${SANS};font-size:14px;font-weight:500;color:${INK};text-decoration:none;border-bottom:1px solid ${INK};padding-bottom:2px;">Open recommendation →</a>
          </td></tr>
        </table>
        ${emailFooter({
          contextLine: `You get these because you subscribe to @${escapeHtml(curatorHandle)} on Curators.AI.`,
          unsubLabel: `Unsubscribe from @${curatorHandle}`,
          unsubUrl,
        })}`;

  const html = emailShell({ title: subject, preheader, innerHtml });

  const textLines = [
    `${displayForName} sent you a recommendation on Curators.AI`,
    '',
  ];
  if (category) textLines.push(category.toUpperCase());
  textLines.push(recTitle);
  textLines.push('');
  if (whyCapped) {
    textLines.push(`"${whyCapped}"`);
    textLines.push('');
  }
  textLines.push(`Open recommendation: ${recUrl}`);
  textLines.push('');
  textLines.push('---');
  textLines.push(`You get these because you subscribe to @${curatorHandle} on Curators.AI.`);
  textLines.push(`Unsubscribe: ${unsubUrl}`);
  textLines.push(`Notification settings: https://curators.ai/settings`);
  const text = textLines.join('\n');

  return { subject, html, text };
}
