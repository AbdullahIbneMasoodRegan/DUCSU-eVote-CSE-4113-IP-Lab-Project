// M1 — email templates, English and Bangla.
// Each template is (data) => ({ subject, text }). HTML is generated from text.
// Phase 2 adds: votingOpen, reminder, resultsPublished.

export const templates = {
  otp: {
    en: ({ name, code, minutes }) => ({
      subject: `Your DUCSU eVote login code: ${code}`,
      text:
        `Hello ${name},\n\n` +
        `Your one-time login code is: ${code}\n\n` +
        `It expires in ${minutes} minutes and can be used once.\n` +
        `If you did not try to log in, you can ignore this email. ` +
        `Never share this code with anyone, including candidates or EC staff.\n\n` +
        `— DUCSU Election Commission`,
    }),
    bn: ({ name, code, minutes }) => ({
      subject: `আপনার ডাকসু ই-ভোট লগইন কোড: ${code}`,
      text:
        `প্রিয় ${name},\n\n` +
        `আপনার এককালীন লগইন কোড: ${code}\n\n` +
        `কোডটি ${minutes} মিনিটের মধ্যে মেয়াদোত্তীর্ণ হবে এবং একবারই ব্যবহার করা যাবে।\n` +
        `আপনি লগইন করার চেষ্টা না করে থাকলে এই ইমেইলটি উপেক্ষা করুন। ` +
        `এই কোড কাউকে, এমনকি প্রার্থী বা নির্বাচন কমিশনের কর্মীকেও জানাবেন না।\n\n` +
        `— ডাকসু নির্বাচন কমিশন`,
    }),
  },
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function render(template, data, lang = 'en') {
  const t = templates[template];
  if (!t) throw new Error(`notify: unknown template "${template}"`);
  const { subject, text } = (t[lang] ?? t.en)(data);
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
  return { subject, text, html };
}
