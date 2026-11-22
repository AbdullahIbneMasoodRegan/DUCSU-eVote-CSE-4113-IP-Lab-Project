// M2 — seed election with 28 DUCSU central posts (dummy data only).
// Idempotent: safe to run multiple times without duplicates.

export const POSITIONS_DATA = [
  { order: 1, en: 'Vice-President (VP)', bn: 'সহ-সভাপতি (ভিপি)', max: 1 },
  { order: 2, en: 'General Secretary (GS)', bn: 'সাধারণ সম্পাদক (জিএস)', max: 1 },
  { order: 3, en: 'Assistant General Secretary (AGS)', bn: 'সহ-সাধারণ সম্পাদক (এজিএস)', max: 1 },
  { order: 4, en: 'Liberation War & Democratic Movement Secretary', bn: 'মুক্তিযুদ্ধ ও গণতান্ত্রিক আন্দোলন সম্পাদক', max: 1 },
  { order: 5, en: 'Common Room & Cafeteria Secretary', bn: 'কমনরুম ও ক্যাফেটেরিয়া সম্পাদক', max: 1 },
  { order: 6, en: 'International Affairs Secretary', bn: 'আন্তর্জাতিক বিষয়ক সম্পাদক', max: 1 },
  { order: 7, en: 'Literature & Publication Secretary', bn: 'সাহিত্য ও প্রকাশনা সম্পাদক', max: 1 },
  { order: 8, en: 'Cultural Affairs Secretary', bn: 'সাংস্কৃতিক সম্পাদক', max: 1 },
  { order: 9, en: 'Sports Affairs Secretary', bn: 'ক্রীড়া সম্পাদক', max: 1 },
  { order: 10, en: "Students' Transport Secretary", bn: 'ছাত্র পরিবহন সম্পাদক', max: 1 },
  { order: 11, en: 'Social Services Secretary', bn: 'সমাজসেবা সম্পাদক', max: 1 },
  { order: 12, en: 'Research & Innovation Secretary', bn: 'গবেষণা ও উদ্ভাবন সম্পাদক', max: 1 },
  { order: 13, en: 'Information Technology Secretary', bn: 'তথ্যপ্রযুক্তি সম্পাদক', max: 1 },
  { order: 14, en: 'Career & Skill Development Secretary', bn: 'কর্মসংস্থান ও দক্ষতা উন্নয়ন সম্পাদক', max: 1 },
  { order: 15, en: 'Health & Environment Secretary', bn: 'স্বাস্থ্য ও পরিবেশ সম্পাদক', max: 1 },
  { order: 16, en: 'Executive Member 1', bn: 'সদস্য ১', max: 1 },
  { order: 17, en: 'Executive Member 2', bn: 'সদস্য ২', max: 1 },
  { order: 18, en: 'Executive Member 3', bn: 'সদস্য ৩', max: 1 },
  { order: 19, en: 'Executive Member 4', bn: 'সদস্য ৪', max: 1 },
  { order: 20, en: 'Executive Member 5', bn: 'সদস্য ৫', max: 1 },
  { order: 21, en: 'Executive Member 6', bn: 'সদস্য ৬', max: 1 },
  { order: 22, en: 'Executive Member 7', bn: 'সদস্য ৭', max: 1 },
  { order: 23, en: 'Executive Member 8', bn: 'সদস্য ৮', max: 1 },
  { order: 24, en: 'Executive Member 9', bn: 'সদস্য ৯', max: 1 },
  { order: 25, en: 'Executive Member 10', bn: 'সদস্য ১০', max: 1 },
  { order: 26, en: 'Executive Member 11', bn: 'সদস্য ১১', max: 1 },
  { order: 27, en: 'Executive Member 12', bn: 'সদস্য ১২', max: 1 },
  { order: 28, en: 'Executive Member 13', bn: 'সদস্য ১৩', max: 1 },
];

export default async function seed({ query, withTransaction }) {
  const runner = withTransaction || (async (fn) => fn({ query }));

  await runner(async (client) => {
    // 1. Ensure primary election row exists
    const electionTitle = 'DUCSU Election 2026-2027';
    let { rows } = await client.query('SELECT id FROM elections WHERE title = $1 LIMIT 1', [electionTitle]);

    let electionId;
    if (rows.length === 0) {
      // Starts tomorrow, ends 3 days later, dispute period 7 days after ends_at
      const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
      const disputeEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

      const insertRes = await client.query(
        `INSERT INTO elections (title, starts_at, ends_at, dispute_period_ends_at)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [electionTitle, startsAt, endsAt, disputeEndsAt]
      );
      electionId = insertRes.rows[0].id;
    } else {
      electionId = rows[0].id;
    }

    // 2. Insert or update 28 positions
    for (const pos of POSITIONS_DATA) {
      await client.query(
        `INSERT INTO positions (election_id, name_en, name_bn, display_order, max_selections)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (election_id, display_order)
         DO UPDATE SET name_en = EXCLUDED.name_en, name_bn = EXCLUDED.name_bn, max_selections = EXCLUDED.max_selections`,
        [electionId, pos.en, pos.bn, pos.order, pos.max]
      );
    }
  });
}
