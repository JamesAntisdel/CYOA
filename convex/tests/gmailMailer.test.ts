// Gmail SMTP magic-link sender (convex/betterAuth/emailNode.ts).
//
// Drives `deliverMagicLinkViaGmail` with an INJECTED transport factory (a stand
// -in for nodemailer.createTransport) so the SMTP config + message shape are
// asserted without opening a socket or loading the nodemailer module.

import { describe, expect, it, vi } from "vitest";

import { deliverMagicLinkViaGmail, gmailConfigFromEnv } from "../betterAuth/emailNode";

describe("gmailConfigFromEnv", () => {
  it("returns null unless both user and app password are present", () => {
    expect(gmailConfigFromEnv({})).toBeNull();
    expect(gmailConfigFromEnv({ GMAIL_USER: "bot@gmail.com" })).toBeNull();
    expect(gmailConfigFromEnv({ GMAIL_APP_PASSWORD: "pw" })).toBeNull();
  });

  it("strips spaces from the app password and defaults From to GMAIL_USER", () => {
    expect(gmailConfigFromEnv({ GMAIL_USER: "bot@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" })).toEqual({
      user: "bot@gmail.com",
      pass: "abcdefghijklmnop",
      from: "bot@gmail.com",
    });
  });

  it("honors AUTH_EMAIL_FROM over GMAIL_USER for the From address", () => {
    expect(
      gmailConfigFromEnv({ GMAIL_USER: "bot@gmail.com", GMAIL_APP_PASSWORD: "pw", AUTH_EMAIL_FROM: "hi@unwritten.app" }),
    ).toMatchObject({ from: "hi@unwritten.app" });
  });
});

describe("deliverMagicLinkViaGmail", () => {
  it("throws when Gmail is not configured", async () => {
    await expect(deliverMagicLinkViaGmail({}, { email: "r@x.com", url: "https://x/v" }, vi.fn())).rejects.toThrow(
      /gmail_smtp_not_configured/,
    );
  });

  it("builds the STARTTLS transport and sends the rendered message", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "1" });
    const createTransport = vi.fn().mockReturnValue({ sendMail });

    await deliverMagicLinkViaGmail(
      { GMAIL_USER: "bot@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop", AUTH_EMAIL_SUBJECT: "Sign in" },
      { email: "reader@x.com", url: "https://x/verify?token=abc" },
      createTransport,
    );

    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: "bot@gmail.com", pass: "abcdefghijklmnop" },
    });

    const message = sendMail.mock.calls[0]![0];
    expect(message).toMatchObject({
      from: "bot@gmail.com",
      to: "reader@x.com",
      subject: "Sign in",
    });
    expect(message.text).toContain("https://x/verify?token=abc");
    expect(message.html).toContain("https://x/verify?token=abc");
  });
});
