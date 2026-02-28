import { Resend } from "resend";

const APP_NAME = "Budget Tracker";

let _resend: Resend | null = null;

const getResend = () => {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
};

const getFrom = () => {
  return process.env.EMAIL_FROM || `${APP_NAME} <noreply@resend.dev>`;
};

const getBaseUrl = () => {
  return process.env.NEXTAUTH_URL || "http://localhost:3000";
};

export const sendVerificationEmail = async (email: string, token: string) => {
  const verifyUrl = `${getBaseUrl()}/api/verify-email?token=${token}`;

  await getResend().emails.send({
    from: getFrom(),
    to: email,
    subject: `Verify your email — ${APP_NAME}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; color: #44403c; margin-bottom: 16px;">Verify your email</h1>
        <p style="font-size: 16px; color: #78716c; line-height: 1.5; margin-bottom: 24px;">
          Thanks for creating a ${APP_NAME} account. Click the button below to verify your email address.
        </p>
        <a href="${verifyUrl}" style="display: inline-block; background-color: #d97706; color: white; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 12px; font-size: 16px;">
          Verify Email
        </a>
        <p style="font-size: 14px; color: #a8a29e; margin-top: 24px; line-height: 1.5;">
          This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.
        </p>
      </div>
    `,
  });
};

export const sendPasswordResetEmail = async (email: string, token: string) => {
  const resetUrl = `${getBaseUrl()}/reset-password?token=${token}`;

  await getResend().emails.send({
    from: getFrom(),
    to: email,
    subject: `Reset your password — ${APP_NAME}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; color: #44403c; margin-bottom: 16px;">Reset your password</h1>
        <p style="font-size: 16px; color: #78716c; line-height: 1.5; margin-bottom: 24px;">
          We received a request to reset your ${APP_NAME} password. Click the button below to choose a new one.
        </p>
        <a href="${resetUrl}" style="display: inline-block; background-color: #d97706; color: white; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 12px; font-size: 16px;">
          Reset Password
        </a>
        <p style="font-size: 14px; color: #a8a29e; margin-top: 24px; line-height: 1.5;">
          This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.
        </p>
      </div>
    `,
  });
};
