import { Resend } from "resend";

const APP_NAME = "Budget Tracker";

const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

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

interface BillReminderItem {
  name: string;
  amount: string;
  category: string;
  dueDate: string;
  isOverdue: boolean;
  daysUntilDue: number;
  daysPastDue: number;
}

export const sendBillReminderEmail = async (email: string, bills: BillReminderItem[]) => {
  const subject = bills.length === 1
    ? `Bill reminder — ${APP_NAME}`
    : `${bills.length} bills need attention — ${APP_NAME}`;

  const billCards = bills.map((bill) => {
    const statusText = bill.isOverdue
      ? `${bill.daysPastDue} day${bill.daysPastDue !== 1 ? "s" : ""} overdue`
      : bill.daysUntilDue === 0
        ? "Due today"
        : bill.daysUntilDue === 1
          ? "Due tomorrow"
          : `Due in ${bill.daysUntilDue} days`;

    const statusColor = bill.isOverdue ? "#dc2626" : bill.daysUntilDue === 0 ? "#d97706" : "#78716c";

    return `
      <div style="padding: 12px 16px; border: 1px solid #e7e5e4; border-radius: 12px; margin-bottom: 8px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="vertical-align: top;">
              <p style="margin: 0; font-size: 15px; font-weight: 600; color: #44403c;">${escapeHtml(bill.name)}</p>
              <p style="margin: 2px 0 0; font-size: 13px; color: #a8a29e;">${escapeHtml(bill.category)} · ${escapeHtml(bill.dueDate)}</p>
            </td>
            <td style="vertical-align: top; text-align: right; white-space: nowrap;">
              ${bill.amount
                ? `<p style="margin: 0; font-size: 15px; font-weight: 600; color: #44403c;">${escapeHtml(bill.amount)}</p>`
                : `<p style="margin: 0; font-size: 13px; color: #a8a29e;">amount varies</p>`}
            </td>
          </tr>
        </table>
        <p style="margin: 8px 0 0; font-size: 13px; font-weight: 500; color: ${statusColor};">${statusText}</p>
      </div>
    `;
  }).join("");

  await getResend().emails.send({
    from: getFrom(),
    to: email,
    subject,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; color: #44403c; margin-bottom: 8px;">Bill Reminder</h1>
        <p style="font-size: 16px; color: #78716c; line-height: 1.5; margin-bottom: 24px;">
          You have ${bills.length === 1 ? "a bill" : `${bills.length} bills`} that need${bills.length === 1 ? "s" : ""} your attention.
        </p>
        ${billCards}
        <p style="font-size: 14px; color: #a8a29e; margin-top: 24px; line-height: 1.5;">
          Open ${APP_NAME} to pay, snooze, or skip these bills. You can disable email reminders in your profile settings.
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
