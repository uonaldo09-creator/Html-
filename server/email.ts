import { logger } from "./logger";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@uninfo.in";

// If no real key is configured, make email sending a no-op and log a loud warning
if (!RESEND_API_KEY) {
  logger.warn("RESEND_API_KEY is not set. Verification emails are disabled until it is provided.");
}

/**
 * Sends a verification email to the user using Resend.
 * Defaults to "onboarding@resend.dev" to ensure sandboxed accounts can send/receive
 * during development and testing.
 */
export async function sendVerificationEmail(
  email: string,
  token: string,
  appUrl: string
): Promise<boolean> {
  const verifyUrl = `${appUrl}/verify-email?token=${token}`;

  logger.info({ email, verifyUrl }, `Attempting to send verification email via Resend. [TEST LINK FOR TESTING/DEVELOPMENT]: ${verifyUrl}`);

  const trySend = async (fromAddress: string): Promise<{ ok: boolean; data: any }> => {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `UniInfo <${fromAddress}>`,
          to: [email],
          subject: "Verify your email address - UniInfo Secure Portal",
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
              <h2 style="color: #1f2937; margin-bottom: 16px;">Welcome to UniInfo!</h2>
              <p style="color: #4b5563; line-height: 1.5; font-size: 16px;">
                Thank you for registering. Please verify your email address to unlock all premium features, verified reviews submission, and AI-powered university counseling.
              </p>
              <div style="margin: 24px 0;">
                <a href="${verifyUrl}" style="background-color: #c9a35c; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Verify Email Address
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                If the button doesn't work, copy and paste the following URL into your browser:
              </p>
              <p style="color: #ec4899; font-size: 14px; word-break: break-all;">
                ${verifyUrl}
              </p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
              <p style="color: #9ca3af; font-size: 12px;">
                This link is valid for 24 hours. If you did not register for a UniInfo account, please ignore this email.
              </p>
            </div>
          `,
        }),
      });

      const data = await response.json() as any;
      return { ok: response.ok, data };
    } catch (err: any) {
      return { ok: false, data: { message: err.message } };
    }
  };

  // Try original sender address
  let res = await trySend(EMAIL_FROM);

  // If first attempt fails (e.g. unverified domain validation_error) and sender is not already onboarding@resend.dev, retry with onboarding@resend.dev
  if (!res.ok && EMAIL_FROM !== "onboarding@resend.dev") {
    logger.warn({ email, originalError: res.data }, "Failed to send email with configured sender. Retrying with onboarding@resend.dev...");
    res = await trySend("onboarding@resend.dev");
  }

  if (!res.ok) {
    logger.error({ email, error: res.data }, "Failed to send email via Resend API on all attempts");
    return false;
  }

  logger.info({ email, id: res.data.id }, "Verification email sent successfully via Resend.");
  return true;
}
