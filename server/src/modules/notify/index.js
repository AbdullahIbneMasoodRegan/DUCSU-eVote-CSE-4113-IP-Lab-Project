// M1 — mailer (frozen signature):
//
//   await notify.send({ to, template, data, lang })
//
// Transports (MAIL_TRANSPORT):
//   console — development default: prints the email so nobody needs SMTP
//   memory  — test default: keeps emails in notify.outbox for assertions
//   smtp    — production default: Nodemailer over Brevo / Gmail app password
import nodemailer from 'nodemailer';
import config from '../../core/config.js';
import logger from '../../core/logger.js';
import { render } from './templates.js';

const outbox = [];
let smtp;

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

async function send({ to, template, data = {}, lang = 'en' }) {
  const msg = { to, ...render(template, data, lang) };

  switch (config.mail.transport) {
    case 'memory':
      outbox.push({ ...msg, template, data, lang });
      return;
    case 'console':
      console.log(
        `\n----- EMAIL (console transport) -----\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n-------------------------------------\n`,
      );
      return;
    case 'smtp':
      await smtpTransport().sendMail({ from: config.mail.from, ...msg });
      logger.info('email sent', { template });
      return;
    default:
      throw new Error(`notify: unknown transport ${config.mail.transport}`);
  }
}

export const notify = { send, outbox };
export default notify;
