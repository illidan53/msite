import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import type { OutboxEntry } from "../../shared/strategy";
import { createMailer, deliver, DEFAULT_MAIL_FROM, Outbox, redact } from "./mailer";

const message = { subject: "[量化信号] 2026-10-07", text: "hi", html: "<p>hi</p>" };
const recipients = "ops@example.com, second@example.org";

function fakeTransport(sendMail: (message: unknown) => Promise<unknown> = async () => ({})) {
  const send = vi.fn(sendMail);
  const create = vi.fn((_options: unknown) => ({ sendMail: send }));
  return { create, send };
}

describe("mailer transport selection", () => {
  it("is disabled without a transport and never builds one", async () => {
    const fake = fakeTransport();
    const mailer = createMailer({ ALERT_EMAIL_TO: recipients }, { createTransport: fake.create });
    expect(mailer).toMatchObject({ configured: false, transport: "none" });
    expect(await mailer.send(message)).toEqual({ status: "disabled" });
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("needs recipients even when a transport is set", async () => {
    const fake = fakeTransport();
    const mailer = createMailer({ MAIL_TRANSPORT: "ses" }, { createTransport: fake.create });
    expect(mailer).toMatchObject({ configured: false, transport: "ses" });
    expect(await mailer.send(message)).toEqual({ status: "disabled" });
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("treats smtp without SMTP_URL as unconfigured", () => {
    const mailer = createMailer({ MAIL_TRANSPORT: "smtp", ALERT_EMAIL_TO: recipients });
    expect(mailer).toMatchObject({ configured: false, transport: "none" });
  });

  it("sends through SES v2 with the configured region and default sender", async () => {
    const fake = fakeTransport();
    const mailer = createMailer(
      { MAIL_TRANSPORT: " SES ", ALERT_EMAIL_TO: recipients, AWS_REGION: "eu-west-1" },
      { createTransport: fake.create },
    );
    expect(mailer).toMatchObject({ configured: true, transport: "ses" });
    expect(await mailer.send(message)).toEqual({ status: "sent" });
    expect(await mailer.send(message)).toEqual({ status: "sent" });
    expect(fake.create).toHaveBeenCalledTimes(1);
    const options = fake.create.mock.calls[0][0] as {
      SES: { sesClient: SESv2Client; SendEmailCommand: unknown };
    };
    expect(options.SES.sesClient).toBeInstanceOf(SESv2Client);
    expect(options.SES.SendEmailCommand).toBe(SendEmailCommand);
    expect(await options.SES.sesClient.config.region()).toBe("eu-west-1");
    expect(fake.send).toHaveBeenCalledWith({
      from: DEFAULT_MAIL_FROM,
      to: ["ops@example.com", "second@example.org"],
      ...message,
    });
  });

  it("defaults the SES region to us-east-1", async () => {
    const fake = fakeTransport();
    const mailer = createMailer(
      { MAIL_TRANSPORT: "ses", ALERT_EMAIL_TO: "a@example.com" },
      { createTransport: fake.create },
    );
    await mailer.send(message);
    const options = fake.create.mock.calls[0][0] as { SES: { sesClient: SESv2Client } };
    expect(await options.SES.sesClient.config.region()).toBe("us-east-1");
  });

  it("sends through SMTP_URL with a custom sender", async () => {
    const fake = fakeTransport();
    const url = "smtps://mailer:hunter22@smtp.example.net:465";
    const mailer = createMailer(
      { MAIL_TRANSPORT: "smtp", SMTP_URL: url, ALERT_EMAIL_TO: "a@example.com", MAIL_FROM: "x <x@example.net>" },
      { createTransport: fake.create },
    );
    expect(mailer).toMatchObject({ configured: true, transport: "smtp" });
    expect(await mailer.send(message)).toEqual({ status: "sent" });
    expect(fake.create).toHaveBeenCalledWith(url);
    expect(fake.send.mock.calls[0][0]).toMatchObject({ from: "x <x@example.net>", to: ["a@example.com"] });
  });

  it("reports failures without addresses or credentials", async () => {
    const fake = fakeTransport(async () => {
      throw new Error(
        "Invalid login for mailer / hunter22 at smtps://mailer:hunter22@smtp.example.net:465; " +
          "rejected <ops@example.com>, second@example.org; key AKIAABCDEFGHIJKLMNOP",
      );
    });
    const mailer = createMailer(
      {
        MAIL_TRANSPORT: "smtp",
        SMTP_URL: "smtps://mailer:hunter22@smtp.example.net:465",
        ALERT_EMAIL_TO: recipients,
      },
      { createTransport: fake.create },
    );
    const result = await mailer.send(message);
    expect(result.status).toBe("failed");
    for (const secret of ["hunter22", "ops@example.com", "second@example.org", "AKIAABCDEFGHIJKLMNOP", "mailer:"])
      expect(result.error).not.toContain(secret);
    expect(result.error).toContain("Invalid login");
  });

  it("reports a transport that cannot be built as a failed send", async () => {
    const mailer = createMailer(
      { MAIL_TRANSPORT: "ses", ALERT_EMAIL_TO: "a@example.com" },
      {
        createTransport: () => {
          throw new Error("no credentials for a@example.com");
        },
      },
    );
    expect(await mailer.send(message)).toEqual({
      status: "failed",
      error: "no credentials for [redacted]",
    });
  });

  it("redacts addresses, URL credentials and explicit secrets", () => {
    expect(redact("to a.b+c@x.io via https://u:p@h.io/x", ["topsecret"])).toBe(
      "to [address] via https://[redacted]@h.io/x",
    );
    expect(redact("token topsecret!", ["topsecret"])).toBe("token [redacted]!");
    expect(redact("x".repeat(500))).toHaveLength(300);
  });
});

describe("outbox", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "msite-outbox-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const entry = (i: number): OutboxEntry => ({
    id: `e${i}`,
    createdAt: new Date(Date.UTC(2026, 9, 8, 11, i)).toISOString(),
    kind: "signals",
    subject: `subject ${i}`,
    status: "sent",
    transport: "ses",
  });

  it("keeps the newest 200 entries, newest first", async () => {
    const outbox = new Outbox(dir);
    expect(await outbox.list()).toEqual([]);
    await Promise.all(Array.from({ length: 205 }, (_, i) => outbox.record(entry(i))));
    const list = await outbox.list();
    expect(list).toHaveLength(200);
    expect(list[0].id).toBe("e204");
    expect(list.at(-1)!.id).toBe("e5");
  });

  it("never stores addresses, even ones smuggled into an entry", async () => {
    const outbox = new Outbox(dir);
    const smuggled = {
      ...entry(1),
      subject: "for boss@example.com",
      status: "failed",
      error: "Message rejected: Email address is not verified: boss@example.com",
      to: ["boss@example.com"],
    } as OutboxEntry;
    const stored = await outbox.record(smuggled);
    expect(stored).not.toHaveProperty("to");
    const raw = await readFile(join(dir, "outbox.json"), "utf8");
    expect(raw).not.toContain("@");
    expect((await outbox.list())[0]).toMatchObject({
      subject: "for [address]",
      error: "Message rejected: Email address is not verified: [address]",
    });
  });

  it("delivers and records every outcome, including disabled sends", async () => {
    const outbox = new Outbox(dir);
    const now = () => new Date("2026-10-08T11:00:00Z");
    const disabled = await deliver(createMailer({}), outbox, "test", message, now);
    expect(disabled).toMatchObject({
      kind: "test",
      status: "disabled",
      transport: "none",
      createdAt: "2026-10-08T11:00:00.000Z",
      subject: message.subject,
    });
    const failing = createMailer(
      { MAIL_TRANSPORT: "ses", ALERT_EMAIL_TO: "a@example.com" },
      { createTransport: fakeTransport(async () => Promise.reject(new Error("Throttling"))).create },
    );
    const failed = await deliver(failing, outbox, "signals", message, now);
    expect(failed).toMatchObject({ status: "failed", error: "Throttling", transport: "ses" });
    expect((await outbox.list()).map((e) => e.status)).toEqual(["failed", "disabled"]);
  });
});
