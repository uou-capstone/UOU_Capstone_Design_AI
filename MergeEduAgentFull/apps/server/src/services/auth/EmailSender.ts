import { appConfig } from "../../config.js";

export interface VerificationEmailInput {
  to: string;
  displayName: string;
  code: string;
  expiresAt: string;
}

export interface EmailSender {
  readonly mode: "dev" | "smtp";
  readonly canDeliverToInbox: boolean;
  ensureReady?(): Promise<void>;
  sendVerificationCode(input: VerificationEmailInput): Promise<void>;
}

export class EmailSenderError extends Error {
  constructor(
    message: string,
    readonly code: "EMAIL_SENDER_NOT_CONFIGURED" | "EMAIL_SEND_FAILED"
  ) {
    super(message);
  }
}

export class DevEmailSender implements EmailSender {
  readonly mode = "dev" as const;
  readonly canDeliverToInbox = false;

  async sendVerificationCode(_input: VerificationEmailInput): Promise<void> {
    // Development mode exposes the code through AuthService only when explicitly enabled.
  }
}

export class SmtpEmailSender implements EmailSender {
  readonly mode = "smtp" as const;
  readonly canDeliverToInbox = true;

  async ensureReady(): Promise<void> {
    try {
      await (await this.createTransport()).verify();
    } catch (error) {
      if (error instanceof EmailSenderError) {
        throw error;
      }
      throw new EmailSenderError(
        error instanceof Error ? error.message : "SMTP 연결 확인에 실패했습니다.",
        "EMAIL_SEND_FAILED"
      );
    }
  }

  async sendVerificationCode(input: VerificationEmailInput): Promise<void> {
    const transporter = await this.createTransport();
    const expires = new Date(input.expiresAt).toLocaleString("ko-KR");
    const text = [
      `${input.displayName}님,`,
      "",
      "MergeEdu Agent 이메일 인증 코드입니다.",
      "",
      `인증 코드: ${input.code}`,
      `만료 시간: ${expires}`,
      "",
      "본인이 요청하지 않았다면 이 메일을 무시해 주세요."
    ].join("\n");

    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033">
        <p>${escapeHtml(input.displayName)}님,</p>
        <p>MergeEdu Agent 이메일 인증 코드입니다.</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:20px 0">${input.code}</p>
        <p>만료 시간: ${escapeHtml(expires)}</p>
        <p style="color:#64748b">본인이 요청하지 않았다면 이 메일을 무시해 주세요.</p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: appConfig.smtpFrom,
        to: input.to,
        subject: "MergeEdu 이메일 인증 코드",
        text,
        html
      });
    } catch (error) {
      throw new EmailSenderError(
        error instanceof Error ? error.message : "이메일 발송에 실패했습니다.",
        "EMAIL_SEND_FAILED"
      );
    }
  }

  private async createTransport(): Promise<{
    verify(): Promise<unknown>;
    sendMail(message: Record<string, unknown>): Promise<unknown>;
  }> {
    const missing = [
      ["SMTP_HOST", appConfig.smtpHost],
      ["SMTP_PORT", appConfig.smtpPort],
      ["SMTP_USER", appConfig.smtpUser],
      ["SMTP_PASS", appConfig.smtpPass],
      ["SMTP_FROM", appConfig.smtpFrom]
    ].filter(([, value]) => value === undefined || value === "");

    if (missing.length > 0) {
      throw new EmailSenderError(
        `SMTP 설정이 부족합니다: ${missing.map(([name]) => name).join(", ")}`,
        "EMAIL_SENDER_NOT_CONFIGURED"
      );
    }
    const nodemailer = await loadNodemailer();
    return nodemailer.createTransport({
      host: appConfig.smtpHost,
      port: appConfig.smtpPort,
      secure: appConfig.smtpSecure,
      auth: {
        user: appConfig.smtpUser,
        pass: appConfig.smtpPass
      },
      requireTLS: !appConfig.smtpSecure,
      tls: {
        rejectUnauthorized: true
      }
    });
  }
}

export function createEmailSender(): EmailSender {
  if (appConfig.authEmailDeliveryMode === "smtp") {
    return new SmtpEmailSender();
  }
  return new DevEmailSender();
}

async function loadNodemailer(): Promise<{
  createTransport(options: Record<string, unknown>): {
    verify(): Promise<unknown>;
    sendMail(message: Record<string, unknown>): Promise<unknown>;
  };
}> {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<any>;
  try {
    const mod = await dynamicImport("nodemailer");
    return mod.default ?? mod;
  } catch {
    throw new EmailSenderError(
      "SMTP 발송을 위해 nodemailer 패키지가 필요합니다. `npm install nodemailer` 후 다시 실행해 주세요.",
      "EMAIL_SENDER_NOT_CONFIGURED"
    );
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
