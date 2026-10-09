import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import type { OutboxEntry } from "../../shared/strategy";
import { readJson, SerialQueue, writeJsonAtomic } from "./store";

export type MailTransportKind = OutboxEntry["transport"];
export interface MailMessage {
  subject: string;
  text: string;
  html: string;
}
export interface MailResult {
  status: "sent" | "failed" | "disabled";
  error?: string;
}
export interface Mailer {
  /** A transport is selected and at least one recipient is set. */
  configured: boolean;
  transport: MailTransportKind;
  send(message: MailMessage): Promise<MailResult>;
}
interface Transporter {
  sendMail(message: unknown): Promise<unknown>;
}
export interface MailerDeps {
  createTransport?: (options: unknown) => Transporter;
}

export const DEFAULT_MAIL_FROM = "msite signals <signals@finance.nphunter.net>";
export const DEFAULT_PUBLIC_BASE_URL = "https://finance.nphunter.net";

const emailPattern = /[^\s<>()[\]"',;:]+@[^\s<>()[\]"',;:]+/g;
const credentialUrl = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi;
const awsKey = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;

/**
 * Removes anything that could identify a recipient or authenticate a sender:
 * every e-mail address, URL userinfo, AWS key ids and the configured secrets
 * themselves (SMTP_URL and its decoded user and password).
 */
export function redact(text: string, secrets: string[] = []) {
  let out = text;
  for (const secret of secrets
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length))
    out = out.split(secret).join("[redacted]");
  return out
    .replace(credentialUrl, "$1[redacted]@")
    .replace(emailPattern, "[address]")
    .replace(awsKey, "[redacted]")
    .slice(0, 300);
}

function smtpSecrets(url: string | undefined) {
  if (!url) return [];
  const secrets = [url];
  try {
    const parsed = new URL(url);
    for (const part of [parsed.username, parsed.password])
      if (part) secrets.push(part, decodeURIComponent(part));
  } catch {
    // An unparseable URL is still redacted verbatim above.
  }
  return secrets;
}

/**
 * Transport chosen by environment only; recipients and credentials never come
 * from config files or the API. MAIL_TRANSPORT=ses sends through SES v2 with
 * the instance-role credentials, smtp through SMTP_URL; anything else is off.
 */
export function createMailer(
  env: NodeJS.ProcessEnv,
  deps: MailerDeps = {},
): Mailer {
  const mode = env.MAIL_TRANSPORT?.trim().toLowerCase();
  const smtpUrl = env.SMTP_URL?.trim();
  const transport: MailTransportKind =
    mode === "ses" ? "ses" : mode === "smtp" && smtpUrl ? "smtp" : "none";
  const to = (env.ALERT_EMAIL_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const from = env.MAIL_FROM?.trim() || DEFAULT_MAIL_FROM;
  const configured = transport !== "none" && to.length > 0;
  const secrets = [...to, from, ...smtpSecrets(smtpUrl)];
  const create =
    deps.createTransport ??
    ((options: unknown) =>
      nodemailer.createTransport(
        options as Parameters<typeof nodemailer.createTransport>[0],
      ));
  let transporter: Transporter | null = null;
  const connect = () =>
    (transporter ??= create(
      transport === "ses"
        ? {
            SES: {
              sesClient: new SESv2Client({
                region: env.AWS_REGION?.trim() || "us-east-1",
              }),
              SendEmailCommand,
            },
          }
        : smtpUrl,
    ));
  return {
    configured,
    transport,
    async send(message) {
      if (!configured) return { status: "disabled" };
      try {
        await connect().sendMail({ from, to, ...message });
        return { status: "sent" };
      } catch (e) {
        const text = e instanceof Error ? e.message : String(e);
        return { status: "failed", error: redact(text || "Send failed", secrets) };
      }
    },
  };
}

const OUTBOX_LIMIT = 200;
const outboxKinds = new Set<OutboxEntry["kind"]>(["signals", "report", "failure", "test"]);
const isEntries = (v: unknown): v is OutboxEntry[] => Array.isArray(v);

/** Delivery log in `<dir>/outbox.json`, newest first; it never holds addresses. */
export class Outbox {
  private queue = new SerialQueue();
  private file: string;
  constructor(dir: string) {
    this.file = join(dir, "outbox.json");
  }
  async list(): Promise<OutboxEntry[]> {
    return (await readJson(this.file, isEntries)) ?? [];
  }
  record(entry: OutboxEntry): Promise<OutboxEntry> {
    // Rebuild from known fields so an address smuggled into any field (or an
    // extra `to` property) can never reach the file or the public API.
    const clean: OutboxEntry = {
      id: entry.id,
      createdAt: entry.createdAt,
      kind: outboxKinds.has(entry.kind) ? entry.kind : "test",
      subject: redact(entry.subject),
      status: entry.status,
      transport: entry.transport,
      ...(entry.error ? { error: redact(entry.error) } : {}),
    };
    return this.queue.run(async () => {
      const entries = await this.list();
      await writeJsonAtomic(
        this.file,
        [clean, ...entries.filter((e) => e.id !== clean.id)].slice(0, OUTBOX_LIMIT),
      );
      return clean;
    });
  }
}

/** Sends one rendered message and records the outcome, whatever it was. */
export async function deliver(
  mailer: Mailer,
  outbox: Outbox,
  kind: OutboxEntry["kind"],
  message: MailMessage,
  now: () => Date = () => new Date(),
): Promise<OutboxEntry> {
  const result = await mailer.send(message);
  return outbox.record({
    id: randomUUID(),
    createdAt: now().toISOString(),
    kind,
    subject: message.subject,
    status: result.status,
    transport: mailer.transport,
    ...(result.error ? { error: result.error } : {}),
  });
}
