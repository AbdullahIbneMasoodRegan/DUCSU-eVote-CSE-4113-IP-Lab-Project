// M1 — mailer (frozen signature):
//
//   await notify.send({ to, template, data, lang })
//
// Transports (MAIL_TRANSPORT):
//   console — development default: prints the email so nobody needs SMTP
//   memory  — test default: keeps emails in notify.outbox for assertions
//   brevo   — real email through Brevo's HTTPS API (free: 300 emails/day).
//             Works on hosts that block outgoing SMTP ports. Needs
//             BREVO_API_KEY and a MAIL_FROM address verified in Brevo.
//   smtp    — real email through any SMTP server (Gmail app password, Brevo SMTP)
//
// With a real transport (brevo/smtp), addresses on reserved test domains
// (.test, .example, .invalid, .localhost — the seeded dummy voters) are never
// sent: the email is printed to the log instead, like the console transport.
// Real people get real email while dummy voters still work in demos, and no
// bounces eat into the daily email quota. send() then resolves { skipped: true }.
import nodemailer from 'nodemailer';
import config from '../../core/config.js';
import logger from '../../core/logger.js';
import { render } from './templates.js';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost']);
const outbox = [];
let smtp;

export function isReservedAddress(address) {
  const tld = String(address).trim().toLowerCase().split('.').pop();
  return RESERVED_TLDS.has(tld);
}

function printToLog(msg, reason) {
  console.log(
    `\n----- EMAIL (${reason}) -----\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n-------------------------------------\n`,
  );
}

function smtpTransport() {
  if (!smtp) {
    const { host, port, user, pass } = config.mail.smtp;
    if (!host) throw new Error('SMTP_HOST is not set (MAIL_TRANSPORT=smtp)');
    smtp = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: user ? { user, pass } : undefined,
    });
  }
  return smtp;
}

async function sendViaBrevo(msg) {
  const res = await fetch(BREVO_URL, {
    method: 'POST',
    headers: {
      'api-key': config.mail.brevo.apiKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: config.mail.fromAddress,
      to: [{ email: msg.to }],
      subject: msg.subject,
      textContent: msg.text,
      htmlContent: msg.html,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Brevo explains the problem (bad key, unverified sender, quota) in the body.
    let detail = '';
    try {
      const body = await res.json();
      detail = body.message ?? body.code ?? '';
    } catch {
      /* no JSON body */
    }
    throw new Error(`Brevo rejected the email (HTTP ${res.status}) ${detail}`.trim());
  }
}

async function send({ to, template, data = {}, lang = 'en' }) {
  const msg = { to, ...render(template, data, lang) };
  const transport = config.mail.transport;

  if ((transport === 'brevo' || transport === 'smtp') && isReservedAddress(to)) {
    printToLog(msg, 'test address, not sent');
    return { skipped: true };
  }

  switch (transport) {
    case 'memory':
      outbox.push({ ...msg, template, data, lang });
      return {};
    case 'console':
      printToLog(msg, 'console transport');
      return {};
    case 'brevo':
      await sendViaBrevo(msg);
      logger.info('email sent', { template, transport: 'brevo' });
      return {};
    case 'smtp':
      await smtpTransport().sendMail({ from: config.mail.from, ...msg });
      logger.info('email sent', { template, transport: 'smtp' });
      return {};
    default:
      throw new Error(`notify: unknown transport ${transport}`);
  }
}

export const notify = { send, outbox, isReservedAddress };
export default notify;
