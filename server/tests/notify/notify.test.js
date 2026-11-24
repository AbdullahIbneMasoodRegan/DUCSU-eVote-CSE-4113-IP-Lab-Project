// M1 — FR-17 mailer: the Brevo HTTPS transport (fetch mocked, no real email sent).
import { describe, it, expect, vi, afterEach } from 'vitest';
import config, { loadConfig, parseAddress } from '../../src/core/config.js';
import notify from '../../src/modules/notify/index.js';

const original = structuredClone(config.mail);

function useBrevo() {
  config.mail.transport = 'brevo';
  config.mail.brevo = { apiKey: 'xkeysib-test' };
  config.mail.fromAddress = { name: 'DUCSU eVote', email: 'ec@example.com' };
}

afterEach(() => {
  Object.assign(config.mail, structuredClone(original));
  vi.unstubAllGlobals();
});

describe('Brevo transport', () => {
  it('posts the rendered email to the Brevo API', async () => {
    useBrevo();
    const fetchMock = vi.fn(async () => new Response('{"messageId":"x"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await notify.send({
      to: 'voter@example.com',
      template: 'otp',
      data: { name: 'Rahim', code: '123456', minutes: 5 },
      lang: 'bn',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(opts.headers['api-key']).toBe('xkeysib-test');
    const body = JSON.parse(opts.body);
    expect(body.sender).toEqual({ name: 'DUCSU eVote', email: 'ec@example.com' });
    expect(body.to).toEqual([{ email: 'voter@example.com' }]);
    expect(body.subject).toContain('123456');
    expect(body.subject).toContain('ডাকসু');
    expect(body.htmlContent).toContain('123456');
  });

  it("reports Brevo's error message without leaking the API key", async () => {
    useBrevo();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"code":"unauthorized","message":"Key not found"}', { status: 401 })),
    );
    const err = await notify
      .send({ to: 'v@example.com', template: 'otp', data: { name: 'R', code: '1', minutes: 5 } })
      .catch((e) => e);
    expect(err.message).toMatch(/HTTP 401.*Key not found/);
    expect(err.message).not.toContain('xkeysib');
  });
});

describe('mail configuration', () => {
  const base = { DATABASE_URL: 'postgres://x/y', OTP_SECRET: 'a-long-enough-secret' };

  it('parses MAIL_FROM', () => {
    expect(parseAddress('DUCSU eVote <a@b.com>')).toEqual({ name: 'DUCSU eVote', email: 'a@b.com' });
    expect(parseAddress('"EC Office" <ec@du.ac.bd>')).toEqual({ name: 'EC Office', email: 'ec@du.ac.bd' });
    expect(parseAddress('a@b.com')).toEqual({ name: 'DUCSU eVote', email: 'a@b.com' });
    expect(parseAddress('not an address')).toBeNull();
  });

  it('refuses to start with brevo but no API key or sender', () => {
    expect(() => loadConfig({ ...base, MAIL_TRANSPORT: 'brevo', MAIL_FROM: 'a@b.com' })).toThrow(
      /BREVO_API_KEY/,
    );
    expect(() =>
      loadConfig({ ...base, MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'k', MAIL_FROM: 'nope' }),
    ).toThrow(/MAIL_FROM/);
    const c = loadConfig({ ...base, MAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.com' });
    expect(c.mail.transport).toBe('brevo');
  });

  it('treats a blank MAIL_FROM as the default', () => {
    expect(loadConfig({ ...base, MAIL_FROM: '' }).mail.from).toContain('DUCSU eVote');
  });
});
