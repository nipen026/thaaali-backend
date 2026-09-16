const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || 'THAAALI <onboarding@resend.dev>';
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

const BRAND = { ink: '#1a1512', saffron: '#FF6B00', saffronDark: '#C2410C', muted: '#6b6560', border: '#eee5db' };

function verificationEmailHtml({ name, verifyUrl }) {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f6f1ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f1ea;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid ${BRAND.border};">
            <tr>
              <td style="background:${BRAND.saffron};padding:28px 32px;">
                <span style="font-size:20px;font-weight:800;letter-spacing:.02em;color:#ffffff;">THAAALI</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px;">
                <h1 style="margin:0 0 16px;font-size:20px;font-weight:800;color:${BRAND.ink};">Verify your email address</h1>
                <p style="margin:0 0 20px;font-size:14.5px;line-height:1.6;color:${BRAND.ink};">
                  Hi ${escapeHtml(name)},
                </p>
                <p style="margin:0 0 24px;font-size:14.5px;line-height:1.6;color:${BRAND.ink};">
                  Thanks for signing up for THAAALI. Confirm your email address to finish setting up your restaurant
                  or hotel account — it only takes one click.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                  <tr>
                    <td style="border-radius:10px;background:${BRAND.saffron};">
                      <a href="${verifyUrl}" style="display:inline-block;padding:13px 28px;font-size:14.5px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
                        Verify Email Address
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:12.5px;line-height:1.6;color:${BRAND.muted};">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 24px;font-size:12.5px;line-height:1.6;word-break:break-all;">
                  <a href="${verifyUrl}" style="color:${BRAND.saffronDark};">${verifyUrl}</a>
                </p>
                <p style="margin:0;font-size:12.5px;line-height:1.6;color:${BRAND.muted};">
                  This link expires in 24 hours. If you didn't create a THAAALI account, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid ${BRAND.border};">
                <p style="margin:0;font-size:11.5px;color:${BRAND.muted};">
                  THAAALI — Restaurant &amp; Hotel Management System
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function verificationEmailText({ name, verifyUrl }) {
  return `Hi ${name},

Thanks for signing up for THAAALI. Confirm your email address to finish setting up your restaurant or hotel account:

${verifyUrl}

This link expires in 24 hours. If you didn't create a THAAALI account, you can safely ignore this email.

— THAAALI · Restaurant & Hotel Management System`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendVerificationEmail({ to, name, token }) {
  const verifyUrl = `${APP_URL}/verify-email?token=${token}`;
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — logging verification link instead of sending:\n  ${to} → ${verifyUrl}`);
    return;
  }
  await resend.emails.send({
    from: FROM,
    to,
    subject: 'Verify your email for THAAALI',
    html: verificationEmailHtml({ name, verifyUrl }),
    text: verificationEmailText({ name, verifyUrl }),
  });
}

module.exports = { sendVerificationEmail };
