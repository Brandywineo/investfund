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
<p style="margin:0 0 28px"><a href="${safeUrl}" style="display:inline-block;background:#d9ff71;color:#123d2d;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:14px">${escapeHtml(action)}</a></p>
<p style="margin:0;font-size:12px;line-height:1.6;color:#75837d">If the button does not open, copy this link:<br><span style="word-break:break-all">${safeUrl}</span></p></td></tr>
</table></td></tr></table></body></html>`
}

export function verificationEmail(displayName: string, url: string) {
  const introduction = `Hello ${displayName}, confirm your email address to finish setting up your InvestFund account. This link expires in 24 hours.`
  return {
    subject: 'Verify your InvestFund email address',
    textBody: `${introduction}\n\nVerify email: ${url}\n\nIf you did not create this account, you can ignore this message.`,
    htmlBody: layout('Verify your email', introduction, 'Verify email', url),
  }
}

export function passwordResetEmail(displayName: string, url: string) {
  const introduction = `Hello ${displayName}, a password reset was requested for your InvestFund account. This link expires in 30 minutes and can be used once.`
  return {
    subject: 'Reset your InvestFund password',
    textBody: `${introduction}\n\nReset password: ${url}\n\nIf you did not request this, you can ignore this message.`,
    htmlBody: layout(
      'Reset your password',
      introduction,
      'Reset password',
      url,
    ),
  }
}

export function passwordChangedEmail(displayName: string) {
  const introduction = `Hello ${displayName}, your InvestFund password was changed successfully. If you did not make this change, contact support immediately.`
  return {
    subject: 'Your InvestFund password was changed',
    textBody: introduction,
    htmlBody: `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;background:#eef1eb;padding:32px;color:#10251c"><div style="max-width:560px;margin:auto;background:white;padding:32px;border-radius:24px"><h1>Password changed</h1><p style="line-height:1.7">${escapeHtml(introduction)}</p></div></body></html>`,
  }
}
