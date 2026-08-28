/**
 * Mail transports.
 *
 * The worker talks to this interface and nothing else, so the send path is
 * identical whether messages go to disk or to Postfix. That matters: it means
 * the code you test locally is the code that runs in production, with one
 * environment variable different.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface OutgoingMessage {
  to: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  returnPath: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
}

export interface SendResult {
  messageId: string;
  response: string;
  queueId?: string;
}

export interface Transport {
  readonly name: string;
  readonly isReal: boolean;
  verify(): Promise<{ ok: boolean; detail: string }>;
  send(msg: OutgoingMessage): Promise<SendResult>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ sink */

/**
 * Writes each message to disk as a .eml file instead of sending it.
 *
 * Lets a full campaign run end to end with no mail server: the queue is
 * claimed, messages are rendered, results are recorded, pacing and limits
 * apply. The only thing that does not happen is delivery.
 *
 * The .eml files open in Apple Mail, so you can read exactly what a recipient
 * would have received.
 */
export class SinkTransport implements Transport {
  readonly name = "local sink (writes files, sends nothing)";
  readonly isReal = false;
  private dir: string;
  private count = 0;

  constructor(dir = path.join(process.cwd(), "outbox")) {
    this.dir = dir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async verify() {
    return { ok: true, detail: `Writing to ${this.dir}` };
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const id = `${Date.now()}.${crypto.randomBytes(6).toString("hex")}@sink.local`;
    const boundary = `----=_Part_${crypto.randomBytes(8).toString("hex")}`;

    const eml = [
      `Return-Path: <${msg.returnPath}>`,
      `From: ${msg.fromName} <${msg.fromEmail}>`,
      `To: ${msg.to}`,
      `Reply-To: ${msg.replyTo}`,
      `Subject: ${msg.subject}`,
      `Message-ID: <${id}>`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      ...Object.entries(msg.headers).map(([k, v]) => `${k}: ${v}`),
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      ``,
      msg.text,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      ``,
      msg.html,
      ``,
      `--${boundary}--`,
      ``,
    ].join("\r\n");

    const safe = msg.to.replace(/[^\w.@-]/g, "_");
    const file = path.join(this.dir, `${String(++this.count).padStart(5, "0")}_${safe}.eml`);
    await fs.promises.writeFile(file, eml, "utf8");

    // A small delay so pacing behaves like a real SMTP conversation rather
    // than completing instantly and hiding timing bugs.
    await new Promise((r) => setTimeout(r, 40));

    return { messageId: id, response: `250 Written to ${path.basename(file)}` };
  }

  async close() {
    if (this.count > 0) {
      console.log(`\n  ${this.count} messages written to ${this.dir}`);
    }
  }
}

/* ------------------------------------------------------------------ smtp */

/**
 * Hands messages to Postfix on the OVH server over authenticated submission.
 *
 * One connection, reused. No pooling beyond that: the pacing is deliberate and
 * concurrency would defeat it.
 */
export class SmtpTransport implements Transport {
  readonly name: string;
  readonly isReal = true;
  private transporter: import("nodemailer").Transporter | null = null;
  private config: {
    host: string; port: number; user: string; pass: string;
  };

  constructor(config: { host: string; port: number; user: string; pass: string }) {
    this.config = config;
    this.name = `Postfix at ${config.host}:${config.port}`;
  }

  private async get() {
    if (this.transporter) return this.transporter;
    const nodemailer = await import("nodemailer");
    const create = (nodemailer.default ?? nodemailer).createTransport;
    this.transporter = create({
      host: this.config.host,
      port: this.config.port,
      secure: false,
      requireTLS: true,
      auth: { user: this.config.user, pass: this.config.pass },
      tls: { minVersion: "TLSv1.2" },
      pool: false,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 60_000,
    } as import("nodemailer").TransportOptions);
    return this.transporter;
  }

  async verify() {
    try {
      const t = await this.get();
      await t.verify();
      return { ok: true, detail: `Connected to ${this.config.host}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async send(msg: OutgoingMessage): Promise<SendResult> {
    const t = await this.get();
    const info = await t.sendMail({
      from: { name: msg.fromName, address: msg.fromEmail },
      to: msg.to,
      replyTo: msg.replyTo,
      // VERP: the bounce comes back to an address that names this exact send.
      envelope: { from: msg.returnPath, to: msg.to },
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      headers: msg.headers,
    });

    // Postfix returns "250 2.0.0 Ok: queued as ABC123". That queue id is what
    // ties this message to its line in the mail log.
    const queueId = /queued as (\S+)/i.exec(info.response ?? "")?.[1];
    return {
      messageId: info.messageId ?? "",
      response: info.response ?? "250 accepted",
      queueId,
    };
  }

  async close() {
    this.transporter?.close();
  }
}

/* --------------------------------------------------------------- factory */

export function makeTransport(): Transport {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  if (host && user && pass) {
    return new SmtpTransport({
      host, user, pass, port: Number(process.env.SMTP_PORT ?? 587),
    });
  }
  return new SinkTransport();
}
