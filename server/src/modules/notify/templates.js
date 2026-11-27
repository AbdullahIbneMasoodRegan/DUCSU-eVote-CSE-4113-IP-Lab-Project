// M1 — email templates in English and Bangla (FR-17).
//
// Each template returns a small structure:
//   { subject, heading, paragraphs: [], highlight?, button?: { label, url }, note? }
// render() turns it into a plain-text body and a designed HTML body, so every
// email looks the same and the two versions never disagree.
// lang 'both' puts Bangla first and English below it (used for bulk emails,
// since we do not know each voter's preferred language).

const SIGN = { en: '— DUCSU Election Commission', bn: '— ডাকসু নির্বাচন কমিশন' };

/** "25 Nov 2026, 1:44 pm" in Dhaka time. */
export function dhakaTime(iso, lang = 'en') {
  return new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export const templates = {
  otp: {
    en: ({ name, code, minutes }) => ({
      subject: `Your DUCSU eVote login code: ${code}`,
      heading: `Hello ${name},`,
      paragraphs: ['Your one-time login code is:'],
      highlight: code,
      note:
        `It expires in ${minutes} minutes and can be used once. If you did not try to log in, ` +
        'you can ignore this email. Never share this code with anyone, including candidates or EC staff.',
    }),
    bn: ({ name, code, minutes }) => ({
      subject: `আপনার ডাকসু ই-ভোট লগইন কোড: ${code}`,
      heading: `প্রিয় ${name},`,
      paragraphs: ['আপনার এককালীন লগইন কোড:'],
      highlight: code,
      note:
        `কোডটি ${minutes} মিনিটের মধ্যে মেয়াদোত্তীর্ণ হবে এবং একবারই ব্যবহার করা যাবে। আপনি লগইন করার চেষ্টা না করে থাকলে ` +
        'এই ইমেইলটি উপেক্ষা করুন। এই কোড কাউকে, এমনকি প্রার্থী বা নির্বাচন কমিশনের কর্মীকেও জানাবেন না।',
    }),
  },

  votingOpen: {
    en: ({ name, title, endsAt, url }) => ({
      subject: `Voting is open: ${title}`,
      heading: `Hello ${name},`,
      paragraphs: [
        `Voting for ${title} is now open.`,
        `You can vote until ${dhakaTime(endsAt, 'en')} (Dhaka time). Log in with your registration number; ` +
          'a one-time code will be sent to this email address.',
        'Your vote is secret: the system stores no link between you and your ballot.',
      ],
      button: { label: 'Vote now', url: `${url}/login` },
    }),
    bn: ({ name, title, endsAt, url }) => ({
      subject: `ভোটগ্রহণ শুরু হয়েছে: ${title}`,
      heading: `প্রিয় ${name},`,
      paragraphs: [
        `${title}-এর ভোটগ্রহণ এখন চলছে।`,
        `আপনি ${dhakaTime(endsAt, 'bn')} (ঢাকা সময়) পর্যন্ত ভোট দিতে পারবেন। আপনার রেজিস্ট্রেশন নম্বর দিয়ে লগইন করুন; ` +
          'এই ইমেইল ঠিকানায় একটি এককালীন কোড পাঠানো হবে।',
        'আপনার ভোট গোপন: আপনার সঙ্গে আপনার ব্যালটের কোনো সংযোগ সিস্টেমে রাখা হয় না।',
      ],
      button: { label: 'এখনই ভোট দিন', url: `${url}/login` },
    }),
  },

  reminder: {
    en: ({ name, title, endsAt, url }) => ({
      subject: `Reminder: voting closes at ${dhakaTime(endsAt, 'en')}`,
      heading: `Hello ${name},`,
      paragraphs: [
        `You have not voted yet in ${title}.`,
        `Voting closes at ${dhakaTime(endsAt, 'en')} (Dhaka time). It takes about five minutes.`,
      ],
      button: { label: 'Vote now', url: `${url}/login` },
      note: 'You are receiving this because the voter list shows you have not voted. Nobody can see how you vote.',
    }),
    bn: ({ name, title, endsAt, url }) => ({
      subject: `স্মরণ করিয়ে দেওয়া: ভোটগ্রহণ শেষ হবে ${dhakaTime(endsAt, 'bn')}`,
      heading: `প্রিয় ${name},`,
      paragraphs: [
        `আপনি এখনো ${title}-এ ভোট দেননি।`,
        `ভোটগ্রহণ শেষ হবে ${dhakaTime(endsAt, 'bn')} (ঢাকা সময়)। ভোট দিতে প্রায় পাঁচ মিনিট লাগে।`,
      ],
      button: { label: 'এখনই ভোট দিন', url: `${url}/login` },
      note: 'ভোটার তালিকা অনুযায়ী আপনি এখনো ভোট দেননি, তাই এই ইমেইল পাঠানো হয়েছে। আপনি কাকে ভোট দেন তা কেউ দেখতে পারে না।',
    }),
  },

  resultsPublished: {
    en: ({ name, title, url }) => ({
      subject: `Results published: ${title}`,
      heading: `Hello ${name},`,
      paragraphs: [
        `The Election Commission has published the results of ${title}.`,
        'You can also check that your receipt code is in the public receipt list.',
      ],
      button: { label: 'See the results', url: `${url}/results` },
    }),
    bn: ({ name, title, url }) => ({
      subject: `ফলাফল প্রকাশিত: ${title}`,
      heading: `প্রিয় ${name},`,
      paragraphs: [
        `নির্বাচন কমিশন ${title}-এর ফলাফল প্রকাশ করেছে।`,
        'আপনার রসিদ কোডটি প্রকাশ্য রসিদ তালিকায় আছে কিনা তাও যাচাই করতে পারেন।',
      ],
      button: { label: 'ফলাফল দেখুন', url: `${url}/results` },
    }),
  },
};

/** Sample data for the EC preview page. */
export const SAMPLE_DATA = {
  otp: { name: 'Rahim Uddin', code: '482913', minutes: 5 },
  votingOpen: { name: 'Rahim Uddin', title: 'DUCSU Election 2026-2027', endsAt: '2026-11-27T10:00:00Z' },
  reminder: { name: 'Rahim Uddin', title: 'DUCSU Election 2026-2027', endsAt: '2026-11-27T10:00:00Z' },
  resultsPublished: { name: 'Rahim Uddin', title: 'DUCSU Election 2026-2027' },
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function toText(m, lang) {
  return [
    m.heading,
    '',
    ...m.paragraphs.flatMap((p) => [p, '']),
    ...(m.highlight ? [`    ${m.highlight}`, ''] : []),
    ...(m.button ? [`${m.button.label}: ${m.button.url}`, ''] : []),
    ...(m.note ? [m.note, ''] : []),
    SIGN[lang],
  ].join('\n');
}

function toHtmlBlock(m, lang) {
  const e = escapeHtml;
  return [
    `<p style="margin:0 0 12px;font-size:16px;font-weight:600">${e(m.heading)}</p>`,
    ...m.paragraphs.map((p) => `<p style="margin:0 0 12px">${e(p)}</p>`),
    m.highlight
      ? `<p style="margin:16px 0;font-size:30px;font-weight:700;letter-spacing:6px;color:#0f5c39">${e(m.highlight)}</p>`
      : '',
    m.button
      ? `<p style="margin:20px 0"><a href="${e(m.button.url)}" style="display:inline-block;background:#0f5c39;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:6px">${e(m.button.label)}</a></p>`
      : '',
    m.note ? `<p style="margin:0 0 12px;font-size:13px;color:#475569">${e(m.note)}</p>` : '',
    `<p style="margin:16px 0 0;color:#334155">${e(SIGN[lang])}</p>`,
  ].join('');
}

function layout(blocks, lang) {
  const sep = '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">';
  return (
    `<!doctype html><html lang="${lang === 'en' ? 'en' : 'bn'}"><body style="margin:0;background:#f1f5f9">` +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;overflow:hidden;font-family:\'Hind Siliguri\',system-ui,-apple-system,\'Segoe UI\',sans-serif;font-size:15px;line-height:1.6;color:#0f172a">' +
    '<tr><td style="background:#0f5c39;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:700">DUCSU eVote · ডাকসু ই-ভোট</td></tr>' +
    `<tr><td style="padding:24px">${blocks.join(sep)}</td></tr>` +
    '<tr><td style="padding:12px 24px;background:#f8fafc;font-size:12px;color:#64748b">Dhaka University Central Students\' Union · ঢাকা বিশ্ববিদ্যালয় কেন্দ্রীয় ছাত্র সংসদ</td></tr>' +
    '</table></td></tr></table></body></html>'
  );
}

/** -> { subject, text, html }. lang: 'en' | 'bn' | 'both'. */
export function render(template, data, lang = 'en') {
  const t = templates[template];
  if (!t) throw new Error(`notify: unknown template "${template}"`);
  const langs = lang === 'both' ? ['bn', 'en'] : [t[lang] ? lang : 'en'];
  const parts = langs.map((l) => ({ l, m: t[l](data) }));
  return {
    subject: parts.map((p) => p.m.subject).join(' | '),
    text: parts.map((p) => toText(p.m, p.l)).join('\n\n----------\n\n'),
    html: layout(
      parts.map((p) => toHtmlBlock(p.m, p.l)),
      lang,
    ),
  };
}
