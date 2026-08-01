/* Demo data so the console has something to show.
   Every person below is invented. Do NOT run this against a real database.

   Usage:  vercel env pull .env.local   (once)
           npm run seed
*/
"use strict";

const loadEnv = require("./env");
const db = require("../lib/db");

const DAY = 86400000;

async function main() {
  const envFile = loadEnv();
  console.log(envFile ? "Loaded " + envFile : "No .env.local found; using the ambient environment.");

  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.error("\nNo Postgres connection string.");
    console.error("Run:  vercel env pull .env.local --scope limen-helix\n");
    process.exit(1);
  }

  await db.ensureSchema();
  console.log("Schema is up to date.");

  const existing = await db.one("SELECT COUNT(*)::int AS n FROM patients");
  if (existing.n > 0) {
    console.log("Database already has " + existing.n + " patients. Skipping seed.");
    console.log("To reseed, empty the tables first.");
    process.exit(0);
  }

  const now = Date.now();
  const ago = function (d) { return now - d * DAY; };

  /* ---- coordinator login ---- */
  const pw = db.hashPassword(process.env.HMH_SEED_PASSWORD || "heartland");
  await db.q(`INSERT INTO coordinators (email, name, pass_hash, pass_salt, role, created_at)
              VALUES ($1,$2,$3,$4,$5,$6)`,
    ["coordinator@heartlandmenshealth.com", "Pat Reyes", pw.hash, pw.salt, "admin", now]);

  /* ---- patients spanning every retention signal ---- */
  const yr = function (y, m, d) { return Date.parse(y + "-" + m + "-" + d + "T12:00:00"); };

  // first, last, email, phone, clinic, protocol, lastVisit, supplyStart, supplyDays,
  // renewalOverride, pinned, lastSeen, dob, startDate, agreementMonths, addons
  const rows = [
    ["Ray", "Whitaker", "ray.w@example.com", "816-555-0142", "North Kansas City",
     "Testosterone cypionate, weekly", ago(64), ago(96), 90, null, 1, ago(70),
     yr(1968, "04", "12"), ago(400), 12, "IntraPulse course"],
    // started 9 weeks ago: 8-week labs just came and went
    ["Dennis", "Kowalski", "dk@example.com", "913-555-0188", "Overland Park",
     "Testosterone cypionate, weekly", ago(28), ago(84), 90, null, 0, ago(3),
     yr(1974, "11", "02"), ago(63), 24, null],
    ["Marcus", "Bell", "mbell@example.com", "816-555-0119", "Independence",
     "Semaglutide, weekly", ago(45), ago(30), 84, ago(6), 0, ago(9),
     yr(1980, "06", "23"), ago(120), 12, "Low-T evaluation"],
    ["Tom", "Ferraro", "tferraro@example.com", "816-555-0107", "North Kansas City",
     "Tadalafil, as needed", ago(142), null, null, null, 0, ago(48),
     yr(1961, "02", "17"), ago(300), 12, null],
    // started 7 weeks ago: 8-week labs are a week away
    ["Alan", "Prieto", "aprieto@example.com", "913-555-0163", "Overland Park",
     "Testosterone cypionate, weekly", ago(12), ago(10), 90, null, 0, ago(1),
     yr(1977, "09", "05"), ago(49), 36, null],
    ["Greg", "Nunes", "gnunes@example.com", "913-555-0175", "Overland Park",
     "IntraPulse course", ago(21), null, null, null, 0, null,
     yr(1971, "12", "30"), ago(21), 12, "Testosterone therapy"],
    ["Victor", "Osei", "vosei@example.com", "816-555-0134", "Independence",
     "Semaglutide, weekly", ago(33), ago(50), 84, now + 9 * DAY, 0, ago(2),
     yr(1983, "03", "08"), ago(180), 24, null]
  ];

  for (const r of rows) {
    const seen = r[11];
    await db.q(`
      INSERT INTO patients (first_name, last_name, email, phone, clinic, protocol,
                            last_visit_at, supply_started_at, supply_days, renewal_due_at,
                            pinned, enrolled_at, last_seen_at,
                            date_of_birth, start_date, agreement_months, addons,
                            status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'active',$18,$19)`,
      [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10],
       seen ? seen - 5 * DAY : null, seen, r[12], r[13], r[14], r[15], now, now]);
  }

  /* ---- starter articles, drawn from what the clinic already publishes ---- */
  const articles = [
    ["What your $99 visit covers", "practical",
     "Exactly what you get, what to bring, and how payment works.",
     "Your office visit is $99. That covers a confidential consultation with a licensed Kansas or Missouri provider, a full diagnostic blood test including testosterone and PSA, and a test dose of medication if your provider advises it.\n\nBring your medical history and a list of everything you take, a driver's licence or government photo ID, and a payment method. Your partner is welcome if you want them there.\n\nWe do not process insurance in the clinic. We take Visa, MasterCard, American Express, personal cheque and cash, and many patients pay with an HSA. If you want to file a claim yourself, we will give you the documentation.\n\nHours are Monday to Friday, 8:30 AM to 5:00 PM. Walk-ins are welcome until 3:30 PM, but booking keeps your wait short."],

    ["Staying on schedule with testosterone therapy", "testosterone",
     "Why the timing matters more than the dose, and what to watch for.",
     "Testosterone therapy works on a rhythm. Skipping a week or stretching the gap does not just delay the benefit, it makes your levels swing, and the swing is what you feel as fatigue and mood changes.\n\nKeep your injections on the schedule your provider set. If you miss one, do not double up. Call the clinic and we will tell you how to get back on track.\n\nTell your provider if you notice blood pressure going up, prostate symptoms, hair loss, acne, mood swings, breast tenderness, or snoring getting worse. We watch your blood levels through treatment so we catch these early.\n\nFeatured therapies are compounded and have not been approved or evaluated for safety, effectiveness or quality by the FDA."],

    ["The first month on a GLP-1", "weight loss",
     "The side effects that settle, and the one thing that decides your result.",
     "Most men feel some nausea, burping, heartburn or a change in their stomach in the first few weeks on a GLP-1. It usually settles within the first month. Eat smaller meals, slow down, and stop when you are full rather than when the plate is empty.\n\nThe medication takes the edge off cravings. It does not replace food and movement, and the men who get the best results are the ones who use that easier window to change what they eat.\n\nDo not take a GLP-1 if you or your family have a history of medullary thyroid carcinoma or endocrine neoplasia syndrome type 2. Tell us about any stomach problems that do not settle.\n\nFeatured therapies are compounded and have not been approved or evaluated for safety, effectiveness or quality by the FDA."],

    ["What to do about a prolonged erection", "safety",
     "An erection lasting four hours or more is an emergency. Here is what to do.",
     "An erection that lasts four hours or more can cause permanent damage. It is a medical emergency and it needs treating the same day.\n\nCall the priapism line on 844-981-4996 straight away, or go to an emergency room. Do not wait to see if it resolves on its own.\n\nThis matters most if you use injection therapy. Talk to your provider about what to do before you need to know, not after."]
  ];

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const slug = a[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const at = now - (articles.length - i) * DAY;
    await db.q(`INSERT INTO articles (title, slug, summary, body, category, published, created_at, updated_at)
                VALUES ($1,$2,$3,$4,$5,1,$6,$7)`, [a[0], slug, a[2], a[3], a[1], at, at]);
  }

  /* Demo device tokens so the patient app can be opened without a setup link.
     Real patients get these by exchanging a single-use link. */
  const enrolled = await db.q("SELECT id, first_name FROM patients WHERE enrolled_at IS NOT NULL");
  for (const p of enrolled) {
    await db.q(`INSERT INTO patient_tokens (token, patient_id, created_at, last_used_at)
                VALUES ($1,$2,$3,$4)`, ["demo-" + p.first_name.toLowerCase(), p.id, now, now]);
  }

  console.log("Seeded " + rows.length + " patients, " + articles.length + " articles.");
  console.log("Console login: coordinator@heartlandmenshealth.com / " +
              (process.env.HMH_SEED_PASSWORD || "heartland"));
  console.log("Demo device token: demo-dennis");
  await db.getPool().end();
}

main().catch(function (e) { console.error(e); process.exit(1); });
