function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function layout(
  title: string,
  introduction: string,
  action: string,
  url: string,
  details: Array<[string, string]> = [],
  note = '',
) {
  const safeTitle = escapeHtml(title)
  const safeIntroduction = escapeHtml(introduction)
  const safeUrl = escapeHtml(url)
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#eef1eb;font-family:Arial,sans-serif;color:#10251c">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:24px;overflow:hidden">
<tr><td style="background:#123d2d;padding:28px 32px;color:#fff"><strong style="font-size:20px">InvestFund</strong></td></tr>
<tr><td style="padding:36px 32px"><h1 style="margin:0 0 16px;font-size:28px">${safeTitle}</h1><p style="margin:0 0 28px;line-height:1.7;color:#54675f">${safeIntroduction}</p>
${details.length ? `<table role="presentation" width="100%" style="margin:0 0 28px;border-collapse:collapse">${details.map(([label, value]) => `<tr><td style="padding:8px;border-bottom:1px solid #eef1eb">${escapeHtml(label)}</td><td style="padding:8px;border-bottom:1px solid #eef1eb;word-break:break-word">${escapeHtml(value)}</td></tr>`).join('')}</table>` : ''}
${note ? `<p style="line-height:1.7;color:#54675f">${escapeHtml(note)}</p>` : ''}
<p style="margin:0 0 28px"><a href="${safeUrl}" style="display:inline-block;background:#d9ff71;color:#123d2d;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:14px">${escapeHtml(action)}</a></p>
<p style="margin:0;font-size:12px;line-height:1.6;color:#75837d">If the button does not open, copy this link:<br><span style="word-break:break-all">${safeUrl}</span></p></td></tr>
</table></td></tr></table></body></html>`
}

export function verificationEmail(
  displayName: string,
  url: string,
  expiryMinutes = 1440,
) {
  const introduction = `Hello ${displayName}, confirm your email address to finish setting up your InvestFund account. This link expires in ${expiryMinutes} minutes.`
  return {
    subject: 'Verify your InvestFund email address',
    textBody: `${introduction}\n\nVerify email: ${url}\n\nIf you did not create this account, you can ignore this message.`,
    htmlBody: layout(
      'Verify your email',
      introduction,
      'Verify email',
      url,
      [],
      'If you did not create this account, you can ignore this message.',
    ),
  }
}

export function passwordResetEmail(
  displayName: string,
  url: string,
  expiryMinutes = 30,
) {
  const introduction = `Hello ${displayName}, a password reset was requested for your InvestFund account. This link expires in ${expiryMinutes} minutes and can be used once.`
  return {
    subject: 'Reset your InvestFund password',
    textBody: `${introduction}\n\nReset password: ${url}\n\nIf you did not request this, you can ignore this message.`,
    htmlBody: layout(
      'Reset your password',
      introduction,
      'Reset password',
      url,
      [],
      'If you did not request this, you can ignore this message. Your password remains unchanged.',
    ),
  }
}

export function receiptEmail(input: {
  displayName: string
  title: string
  message: string
  details: Array<[string, string]>
  url: string
}) {
  const introduction = `Hello ${input.displayName}, ${input.message}`
  return {
    subject: `InvestFund: ${input.title}`,
    textBody: `${introduction}\n\n${input.details.map(([label, value]) => `${label}: ${value}`).join('\n')}\n\nOpen InvestFund: ${input.url}`,
    htmlBody: layout(
      input.title,
      introduction,
      'Open InvestFund',
      input.url,
      input.details,
    ),
  }
}
