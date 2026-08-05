/* ==========================================================================
   Storage: Postgres (Neon on Vercel).

   PHI NOTE: this database holds patient names, contact details, treatment and
   message content. It is Protected Health Information. It must sit on hosting
   covered by a signed BAA before real patients go in. See README.md.

   Timestamps are milliseconds since epoch stored as BIGINT, so the retention
   arithmetic is plain JS Date maths everywhere.
   ========================================================================== */
"use strict";

const { Pool } = require("pg");
const crypto = require("crypto");

const DAY = 86400000;

/* ==========================================================================
   Clinic constants. One source of truth; the API serves these to both the
   console and the patient app so the two can never drift apart.
   ========================================================================== */

/* The Vitality Circle ladder, in order. Every patient sees their own rung and
   the discount that comes with it. */
/* Transcribed from the clinic's Vitality Circle card.

   How it works: 1 point per dollar spent, points accumulate for life across
   treatments, renewals and additional services, and a tier once earned is
   permanent -- nobody ever moves backward.

   minPoints is null until the clinic confirms the four thresholds; the photo
   of the card had them blown out by the flash and they must not be guessed.
   While null, the coordinator sets the tier by hand. */
const VITALITY_TIERS = [
  {
    key: "steel", n: 1, label: "Steel", discount: 5, minPoints: null,
    trial: null,
    treatments: null
  },
  {
    key: "titanium", n: 2, label: "Titanium", discount: 10, minPoints: null,
    trial: "3-month trial or 3 ESWT sessions",
    treatments: "Gonaderelin, Enclomiphene, Clomiphene, Lipo C, Amino Blend"
  },
  {
    key: "tungsten", n: 3, label: "Tungsten", discount: 15, minPoints: null,
    trial: "3-month trial or 6 ESWT sessions",
    treatments: "Tier 2 plus Sermorelin, CJC-1295, PDA, NAD+"
  },
  {
    key: "apex", n: 4, label: "Apex", discount: 25, minPoints: null,
    trial: "3-month trial or 12 ESWT sessions",
    treatments: "Tiers 2 and 3 plus Semaglutide, Tirzepatide"
  }
];

/* Benefits every tier gets. */
const VITALITY_UNIVERSAL = [
  "10% off Evexias nutraceuticals",
  "Referral gift: 10% off enrolment for any friend or family member, unlimited"
];

const VITALITY_FOOTNOTE =
  "An active treatment purchase of at least one year is required for the annual benefit. " +
  "Heartland Men's Health may change or modify the terms of the Vitality Circle at any time.";

/* Derive the tier from lifetime points once thresholds are known, otherwise
   fall back to whatever the coordinator set by hand. */
function vitalityFromPoints(points) {
  const p = Number(points);
  if (!p && p !== 0) return null;
  let hit = null;
  VITALITY_TIERS.forEach(function (t) {
    if (t.minPoints != null && p >= t.minPoints) hit = t;
  });
  return hit;
}

/* What a patient still needs for the next rung, when that is knowable. */
function vitalityProgress(tier, points) {
  const p = Number(points);
  if (!tier || !p) return null;
  const next = VITALITY_TIERS.filter(function (t) { return t.n === tier.n + 1; })[0];
  if (!next || next.minPoints == null) return null;
  return { nextLabel: next.label, nextDiscount: next.discount,
           pointsToGo: Math.max(0, next.minPoints - p), nextAt: next.minPoints };
}

function vitalityTier(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  return VITALITY_TIERS.filter(function (t) { return t.key === v || t.label.toLowerCase() === v; })[0] || null;
}

/* Patient financing partners the clinic works with. */
const LENDERS = ["Alphaeon", "HFA", "HFD", "Clarity Pay", "Covered Care", "Happen"];

/* The clinic text line. Everyone sees this one; it is not a coordinator's
   direct line and not the old switchboard. */
const TEXT_LINE = "913-431-2757";

/* Neon's pooled endpoint fronts PgBouncer, so one connection per warm lambda
   is the right shape. A bigger pool just burns Neon connection slots. */
let pool = null;
function getPool() {
  if (pool) return pool;
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL ||
              process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!raw) throw new Error("No Postgres connection string. Set DATABASE_URL.");

  /* Strip sslmode/channel_binding from the URL and state TLS explicitly instead.
     pg 8.13+ warns that its sslmode handling changes in a future major, and
     leaving it implicit would silently alter verification behaviour on upgrade.
     Neon presents a publicly trusted certificate, so verify it properly. */
  let url = raw;
  try {
    const u = new URL(raw);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("channel_binding");
    url = u.toString();
  } catch (e) { /* not a parseable URL: hand it to pg untouched */ }

  pool = new Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: { rejectUnauthorized: true }
  });
  pool.on("error", function (e) { console.error("pg pool error", e.message); });
  return pool;
}

async function q(text, params) {
  await ensureSchema();
  const res = await getPool().query(text, params || []);
  return res.rows;
}
async function one(text, params) {
  const rows = await q(text, params);
  return rows[0] || null;
}
/* Schema work itself must not await ensureSchema, or it deadlocks. */
async function raw(text, params) {
  const res = await getPool().query(text, params || []);
  return res.rows;
}

/* ==========================================================================
   Schema. Idempotent, run once per warm instance.
   ========================================================================== */

let schemaPromise = null;
function ensureSchema() {
  if (!schemaPromise) schemaPromise = migrate().catch(function (e) {
    schemaPromise = null;          // let the next request retry
    throw e;
  });
  return schemaPromise;
}

async function migrate() {
  await raw(`
    CREATE TABLE IF NOT EXISTS coordinators (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      pass_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'coordinator',
      active INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    )`);

  await raw(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      coordinator_id INTEGER NOT NULL REFERENCES coordinators(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    )`);

  await raw(`
    CREATE TABLE IF NOT EXISTS patients (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      clinic TEXT,
      protocol TEXT,
      last_visit_at BIGINT,
      supply_started_at BIGINT,
      supply_days INTEGER,
      renewal_due_at BIGINT,
      status TEXT NOT NULL DEFAULT 'active',
      pinned INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      enrolled_at BIGINT,
      last_seen_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`);

  await raw(`
    CREATE TABLE IF NOT EXISTS enroll_tokens (
      token TEXT PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      used_at BIGINT
    )`);

  /* The setup link is single use and short lived. Exchanging it mints a
     separate device token, so a link seen over someone's shoulder does not
     become permanent access to the record. */
  await raw(`
    CREATE TABLE IF NOT EXISTS patient_tokens (
      token TEXT PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      last_used_at BIGINT,
      revoked_at BIGINT
    )`);

  await raw(`
    CREATE TABLE IF NOT EXISTS devices (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      user_agent TEXT,
      created_at BIGINT NOT NULL,
      last_ok_at BIGINT,
      active INTEGER NOT NULL DEFAULT 1
    )`);

  await raw(`
    CREATE TABLE IF NOT EXISTS articles (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      summary TEXT,
      body TEXT NOT NULL,
      category TEXT,
      published INTEGER NOT NULL DEFAULT 0,
      author_id INTEGER REFERENCES coordinators(id),
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )`);

  await raw(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      article_id INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      kind TEXT NOT NULL DEFAULT 'treatment',
      audience TEXT NOT NULL DEFAULT 'one',
      created_by INTEGER REFERENCES coordinators(id),
      created_at BIGINT NOT NULL,
      sent_at BIGINT
    )`);

  await raw(`
    CREATE TABLE IF NOT EXISTS message_targets (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      pushed_at BIGINT,
      push_status TEXT,
      read_at BIGINT
    )`);

  await raw(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      ref TEXT,
      at BIGINT NOT NULL
    )`);

  /* How a man says he is doing, in his own words and on his own scale.
     Scores run 1 (bad) to 5 (good) so "low number = needs attention" holds
     across every field and the arithmetic never has to be reversed. */
  await raw(`
    CREATE TABLE IF NOT EXISTS checkins (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      at BIGINT NOT NULL,
      day TEXT NOT NULL,               -- YYYY-MM-DD in the patient's own timezone
      energy INTEGER, mood INTEGER, sleep INTEGER, libido INTEGER,
      strength INTEGER, cognitive INTEGER,
      symptoms TEXT,                   -- JSON array of ticked symptom keys
      note TEXT,                       -- his words, stored and shown verbatim
      score INTEGER,                   -- 0-100, higher is better
      level TEXT,                      -- ok | rough | urgent
      reasons TEXT,                    -- JSON array, why it landed at that level
      seen_at BIGINT,                  -- when a coordinator acknowledged it
      seen_by INTEGER,
      UNIQUE (patient_id, day)         -- one a day; a re-submit overwrites
    )`);

  /* Meals and training. Deliberately not a calorie database: a number nobody
     enters accurately is worse than a note somebody actually writes. */
  await raw(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      at BIGINT NOT NULL,
      day TEXT NOT NULL,
      kind TEXT NOT NULL,              -- meal | training
      body TEXT,                       -- what he ate, or what he did
      detail TEXT                      -- JSON: portion / minutes / intensity
    )`);

  /* Deleting a patient cascades his check-ins, logs, tokens and events away
     with him, which is correct and which also means that afterwards there is
     no trace of who he was or who removed him. This table is deliberately NOT
     keyed to patients, so it outlives them. Three demo records vanished once
     with no way to find out what had done it; that is not a position to be in
     with real patients. */
  await raw(`
    CREATE TABLE IF NOT EXISTS deletions (
      id SERIAL PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
      deleted_by INTEGER, deleted_by_name TEXT,
      at BIGINT NOT NULL,
      had_checkins INTEGER, had_messages INTEGER
    )`);

  /* ==========================================================================
     The free app.

     Anyone can install this. They are NOT patients, they hand over nothing to
     get it, and nothing clinical is ever stored against them. That is the whole
     point: no name, no date of birth, no treatment, so this side of the product
     carries no PHI at all and none of the constraints that come with it.

     An install is a random key the phone generates and keeps. It identifies a
     device so reminders can be sent to it, and it identifies nobody.
     ========================================================================== */
  await raw(`
    CREATE TABLE IF NOT EXISTS installs (
      id SERIAL PRIMARY KEY,
      device_key TEXT UNIQUE NOT NULL,
      goals TEXT,                    -- JSON array: eat | train | sleep | water
      times TEXT,                    -- JSON object of HH:MM per reminder
      tz_offset INTEGER,             -- minutes, so a nudge lands at HIS 8am
      created_at BIGINT NOT NULL,
      last_seen_at BIGINT,
      opens INTEGER NOT NULL DEFAULT 0
    )`);

  /* Push endpoints for the free app. Separate from `devices`, which belongs to
     patients: mixing them would be one query away from pushing clinical copy
     at somebody who is not a patient. */
  await raw(`
    CREATE TABLE IF NOT EXISTS install_devices (
      id SERIAL PRIMARY KEY,
      install_id INTEGER NOT NULL REFERENCES installs(id) ON DELETE CASCADE,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at BIGINT NOT NULL
    )`);

  /* The only place a name or number is ever taken, and only because he typed it
     into "text me about this". Deliberately its own table: an install stays
     anonymous even after somebody attached to it puts their number in. */
  await raw(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      install_id INTEGER REFERENCES installs(id) ON DELETE SET NULL,
      name TEXT, phone TEXT, email TEXT,
      about TEXT,                    -- what he tapped: a special, a consult
      note TEXT,
      status TEXT NOT NULL DEFAULT 'new',   -- new | contacted | booked | closed
      claimed_by INTEGER,
      at BIGINT NOT NULL,
      updated_at BIGINT
    )`);

  /* What the clinic is pushing this week. */
  await raw(`
    CREATE TABLE IF NOT EXISTS specials (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      cta TEXT,                      -- the button wording
      live INTEGER NOT NULL DEFAULT 0,
      pushed_at BIGINT,
      created_by INTEGER,
      created_at BIGINT NOT NULL,
      updated_at BIGINT
    )`);

  /* One row per reminder actually sent, so a phone is never nudged twice for
     the same slot on the same day however often the cron runs. */
  await raw(`
    CREATE TABLE IF NOT EXISTS reminder_log (
      install_id INTEGER NOT NULL REFERENCES installs(id) ON DELETE CASCADE,
      slot TEXT NOT NULL,
      day TEXT NOT NULL,
      at BIGINT NOT NULL,
      PRIMARY KEY (install_id, slot, day)
    )`);

  /* One row per scheduled run. Whether a cron is actually firing on the
     interval it claims is not something to take on trust from a config file,
     and when reminders silently stop this is the first place to look. */
  await raw(`
    CREATE TABLE IF NOT EXISTS cron_runs (
      id SERIAL PRIMARY KEY,
      job TEXT NOT NULL,
      at BIGINT NOT NULL,
      ms INTEGER,
      result TEXT
    )`);

  await raw(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);

  /* Additive migrations. Postgres supports IF NOT EXISTS on ADD COLUMN, so this
     is safe to run against a database that already holds patients. */
  const columns = [
    ["patients", "date_of_birth BIGINT"],
    ["patients", "start_date BIGINT"],            // drives labs AND renewal
    ["patients", "agreement_months INTEGER"],     // 12, 24 or 36
    ["patients", "addons TEXT"],                  // coordinator note: what they might add
    ["patients", "coordinator_id INTEGER"],       // their named point of contact
    ["patients", "vitality_status TEXT"],         // their Vitality Circle rung
    ["patients", "vitality_points INTEGER"],      // lifetime points = dollars invested
    ["patients", "lender_name TEXT"],
    ["patients", "lender_phone TEXT"],
    ["patients", "lender_url TEXT"],
    ["patients", "payment_amount TEXT"],
    ["patients", "payment_due_day INTEGER"],      // day of the month the payment lands
    ["coordinators", "phone TEXT"],               // their DIRECT line, shown to their patients
    ["coordinators", "title TEXT"],
    ["coordinators", "contact_email TEXT"],   // shown to patients, may differ from login
    ["articles", "citations TEXT"],           // JSON [{label,url}] of source references
    ["patients", "salesforce_id TEXT"],       // Salesforce Contact id, opens the record
    ["enroll_tokens", "code TEXT"],           // short code read aloud at the appointment
    ["messages", "direction TEXT NOT NULL DEFAULT 'out'"],  // 'out' clinic->patient, 'in' patient->clinic
    ["messages", "from_patient_id INTEGER"],
    ["messages", "reply_to INTEGER"],
    ["checkins", "strength INTEGER"],      // how strong he feels in the gym
    ["checkins", "cognitive INTEGER"],     // focus and clarity; "brain fog"
    /* Entries recorded before the scale moved to 1-10 are rewritten below, and
       this records which scale a row was captured on so the rewrite is a
       one-time, auditable event rather than a silent reinterpretation. */
    ["checkins", "scale_max INTEGER NOT NULL DEFAULT 10"],
    ["articles", "topics TEXT"],           // JSON array: which check-in fields it speaks to
    ["patients", "checkin_reminders INTEGER NOT NULL DEFAULT 1"],  // evening nudge, opt-out
    ["patients", "reminded_on TEXT"],      // last day key we nudged, so never twice
    /* 0=Sunday..6=Saturday. Weekly injections are the same day every week, and
       "shot day" is the single most useful thing this app can say. */
    ["patients", "shot_day INTEGER"],
    ["patients", "shot_hour TEXT"],        // HH:MM, his time
    ["patients", "glp1_eligible INTEGER NOT NULL DEFAULT 0"],
    ["patients", "last_nudge TEXT"],       // JSON: slot -> day key, so each fires once

    /* The patient now holds his own account. The row IS the account: there is
       no second table, so there is no way for an account and a record to drift
       apart or for one to exist without the other. */
    ["patients", "pass_hash TEXT"],
    ["patients", "pass_salt TEXT"],
    /* pending  -> signed up, waiting for a coordinator to confirm who he is.
                   Sees NOTHING clinical in this state.
       active   -> confirmed, either automatically or by hand.
       rejected -> not our patient. Kept, not deleted, so the same details
                   cannot simply be re-submitted to try again.
       null     -> a record a coordinator typed in that nobody has claimed. */
    ["patients", "account_status TEXT"],
    ["patients", "signed_up_at BIGINT"],
    ["patients", "approved_at BIGINT"],
    ["patients", "approved_by INTEGER"],
    ["patients", "must_change_password INTEGER NOT NULL DEFAULT 0"],
    ["patients", "failed_logins INTEGER NOT NULL DEFAULT 0"],
    ["patients", "locked_until BIGINT"]
  ];
  for (const [table, def] of columns) {
    await raw("ALTER TABLE " + table + " ADD COLUMN IF NOT EXISTS " + def);
  }
  await raw(`CREATE INDEX IF NOT EXISTS idx_messages_inbound
             ON messages(direction, created_at) WHERE direction = 'in'`);

  await raw(`CREATE INDEX IF NOT EXISTS idx_targets_patient ON message_targets(patient_id)`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_targets_message ON message_targets(message_id)`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_events_patient ON events(patient_id, at)`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_devices_patient ON devices(patient_id)`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_enroll_code ON enroll_tokens(code)`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_checkins_patient ON checkins(patient_id, at DESC)`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_checkins_open
             ON checkins(level, at DESC) WHERE seen_at IS NULL`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_logs_patient ON logs(patient_id, at DESC)`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_cron_runs ON cron_runs(job, at DESC)`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_leads_open ON leads(at DESC) WHERE status = 'new'`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_install_devices ON install_devices(install_id) WHERE active = 1`);
  /* One account per email address, but only among rows that actually have an
     account: a coordinator can still type two records with no email at all. */
  await raw(`CREATE UNIQUE INDEX IF NOT EXISTS idx_patient_email
             ON patients (lower(email)) WHERE pass_hash IS NOT NULL`);
  await raw(`CREATE INDEX IF NOT EXISTS idx_patient_pending
             ON patients (signed_up_at DESC) WHERE account_status = 'pending'`);

  /* The scale moved from 1-5 to 1-10. Old rows are converted once, in place,
     with the linear map 1->1, 5->10, and stamped so it cannot happen twice.
     Rescaling on read instead would mean every consumer had to remember to do
     it, and one that forgot would silently halve a man's numbers. */
  await raw(`
    UPDATE checkins SET
      energy    = CASE WHEN energy    IS NULL THEN NULL ELSE ROUND(1 + (energy    - 1) * 9.0 / 4.0) END,
      mood      = CASE WHEN mood      IS NULL THEN NULL ELSE ROUND(1 + (mood      - 1) * 9.0 / 4.0) END,
      sleep     = CASE WHEN sleep     IS NULL THEN NULL ELSE ROUND(1 + (sleep     - 1) * 9.0 / 4.0) END,
      libido    = CASE WHEN libido    IS NULL THEN NULL ELSE ROUND(1 + (libido    - 1) * 9.0 / 4.0) END,
      scale_max = 10
    WHERE scale_max = 5`);
}



/* ==========================================================================
   Patient accounts.

   A man signs himself up and picks his own password. The question that decides
   everything else is how the app knows he is actually a Heartland patient,
   because the failure here is not a junk row in a list: it is a stranger's
   login attached to a real man's treatment record.

   So a new sign-up reaches nothing clinical until it is confirmed, and there
   are only two ways to be confirmed:

     - his last name, date of birth and phone all match a record the clinic
       already typed in, and that record has no account on it yet. Three
       independent facts, one of which the clinic never publishes. That is
       enough to link him with nobody in the loop.

     - a coordinator looks at him and says yes.

   Matching on name alone, or name and date of birth, would not be enough:
   both are guessable for a man you know, and the prize is his medical record.
   ========================================================================== */

/* Digits only, so 816-555-0142, (816) 555 0142 and 8165550142 all compare
   equal. Last ten digits, so a leading 1 does not break the match. */
function phoneKey(v) {
  const d = String(v || "").replace(/[^0-9]/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

/* The calendar day, ignoring what time of day was stored and which timezone
   the browser was in when it was typed. */
function dobKey(v) {
  const t = n(v);
  if (!t) return "";
  return new Date(t).toISOString().slice(0, 10);
}

function samePatient(record, claim) {
  if (!record || !claim) return false;
  const lastOk = String(record.last_name || "").trim().toLowerCase() ===
                 String(claim.last_name || "").trim().toLowerCase();
  const dobOk = !!dobKey(record.date_of_birth) &&
                dobKey(record.date_of_birth) === dobKey(claim.date_of_birth);
  const phoneOk = phoneKey(record.phone).length >= 10 &&
                  phoneKey(record.phone) === phoneKey(claim.phone);
  return lastOk && dobOk && phoneOk;
}

/* Five wrong passwords buys a fifteen-minute wait. Enough to make guessing
   pointless, short enough that a man who mistyped his own is not stuck. */
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;

function lockState(row, now) {
  const until = n(row.locked_until);
  return until && until > (now || Date.now()) ? until : null;
}


/* ==========================================================================
   The free app's reminders.

   Every slot a phone can ask for, with a default time and the words that go on
   the lock screen. Nothing here is clinical or personal: it is the same nudge
   for everybody, so it can be written once and it can never leak anything.
   ========================================================================== */

const DAILY_SLOTS = [
  { key: "breakfast", goal: "eat",   label: "Breakfast",     def: "07:30",
    title: "Breakfast", body: "Get protein in early. It makes the rest of the day easier." },
  { key: "lunch",     goal: "eat",   label: "Lunch",         def: "12:30",
    title: "Lunch",     body: "Eat properly now and you will not raid the cupboard at four." },
  { key: "dinner",    goal: "eat",   label: "Dinner",        def: "18:30",
    title: "Dinner",    body: "Protein, something green, and stop when you are full." },
  { key: "train",     goal: "train", label: "Training",      def: "17:30",
    title: "Time to train", body: "Forty minutes. Walking counts." },
  { key: "winddown",  goal: "sleep", label: "Wind down",     def: "21:30",
    title: "Start winding down", body: "Screens off soon. Sleep is where most of your testosterone is made." },
  { key: "wake",      goal: "sleep", label: "Wake",          def: "06:30",
    title: "Same time every day", body: "A steady wake time does more for your sleep than a steady bedtime." },
  { key: "creatine",  goal: "train", label: "Creatine",      def: "09:00",
    title: "Creatine", body: "Five grams. Did you take it?" },
  { key: "water",     goal: "water", label: "Water",         def: "10:00",
    title: "Water", body: "Have a glass now. Most men read tired when they are just dry." },
  { key: "steps",     goal: "water", label: "Move",          def: "15:00",
    title: "Get up and move", body: "Ten minutes on your feet. That is the whole ask." }
];

function slotsForGoals(goals) {
  const want = Array.isArray(goals) ? goals : [];
  return DAILY_SLOTS.filter(function (s) { return want.indexOf(s.goal) !== -1; });
}

/* His local clock, from the offset his phone reported. */
function localHM(now, tzOffsetMinutes) {
  const d = new Date(n(now) - (Number(tzOffsetMinutes) || 0) * 60000);
  return d.toISOString().slice(11, 16);
}

/* Is his chosen time inside the window this run covers? The window matters:
   a cron that fires every 15 minutes must not miss a 07:30 because it woke at
   07:31, and must not fire it twice. */
function slotIsDue(hhmm, nowHM, windowMinutes) {
  const toMin = function (s) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(s || ""));
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const want = toMin(hhmm), now = toMin(nowHM);
  if (want === null || now === null) return false;
  let diff = now - want;
  if (diff < -720) diff += 1440;      /* wrapped midnight */
  if (diff > 720) diff -= 1440;
  return diff >= 0 && diff < (windowMinutes || 20);
}

/* ==========================================================================
   Check-ins: scoring, and the symptoms that must not wait for a coordinator.

   The whole point of this feature is the day a man says he feels terrible.
   Two rules follow from that, and both are deliberate:

   1. NOTHING SUMMARISES HIS WORDS. The note is stored and displayed verbatim,
      everywhere. A paraphrase that turns "I can barely get out of bed" into
      "reports low energy" is how a real signal gets lost.
   2. THE DANGEROUS ANSWERS DO NOT ROUTE THROUGH A HUMAN AT ALL. A coordinator
      is not on duty at 2am. Anything on RED below puts the emergency number in
      front of him immediately, on his own screen, and ALSO flags the clinic.
      Waiting for a callback is not an acceptable response to chest pain.

   A provider should review this symptom list before it goes in front of
   patients. The routing is mine; the clinical judgement about what belongs on
   it is not.
   ========================================================================== */

/* The six things a man is asked about, in the order they appear. Each names
   the article topic that speaks to it, so a low score can point at something
   worth reading rather than just sitting there as a bad number. */
const SCALE_MAX = 10;
const CHECKIN_FIELDS = [
  { key: "energy",    label: "Energy",     topic: "energy" },
  { key: "mood",      label: "Mood",       topic: "mood" },
  { key: "sleep",     label: "Sleep",      topic: "sleep" },
  { key: "libido",    label: "Sex drive",  topic: "libido" },
  { key: "strength",  label: "Strength",   topic: "strength" },
  { key: "cognitive", label: "Focus",      topic: "cognitive" }
];
const FIELD_KEYS = CHECKIN_FIELDS.map(function (f) { return f.key; });

/* Every BIGINT column on a patient. Postgres hands these back as strings and
   every one of them ends up in a Date somewhere. */
const PATIENT_TIMES = ["date_of_birth", "start_date", "renewal_due_at",
  "last_visit_at", "supply_started_at", "enrolled_at", "last_seen_at",
  "created_at", "updated_at", "signed_up_at", "approved_at", "locked_until"];

const SYMPTOMS = [
  /* ---- RED: act now, do not wait for the clinic ---- */
  { key: "chest",     label: "Chest pain, pressure, or trouble breathing",
    red: true,  advice: "Call 911 or go to an emergency room now. Do not drive yourself." },
  { key: "stroke",    label: "Sudden weakness or numbness on one side, or trouble speaking",
    red: true,  advice: "Call 911 now. This is time-critical." },
  { key: "priapism",  label: "An erection that has lasted 4 hours or more",
    red: true,  advice: "This is an emergency. Call 844-981-4996 now, or go to an emergency room. Waiting can cause permanent damage." },
  { key: "clot",      label: "Pain, swelling or redness in one calf",
    red: true,  advice: "Be seen today. Call the clinic, and go to urgent care or an emergency room if you cannot reach us." },
  { key: "harm",      label: "Thoughts of harming yourself",
    red: true,  advice: "Call or text 988 now to reach the Suicide and Crisis Lifeline, any hour. If you are in immediate danger, call 911. You do not have to wait for an appointment for this." },

  /* ---- AMBER: your coordinator should know ---- */
  { key: "site",      label: "Injection site is hot, swollen or painful" },
  { key: "breast",    label: "Breast tenderness or swelling" },
  { key: "swelling",  label: "Ankles or hands swelling up" },
  { key: "headache",  label: "Headaches that are new or worse" },
  { key: "nausea",    label: "Nausea or vomiting that is not settling" },
  { key: "mood",      label: "Mood swings or irritability that are not like me" },
  { key: "sleepapnea",label: "Snoring badly, or waking up gasping" },
  { key: "acne",      label: "Acne or oily skin getting worse" }
];

function symptom(key) {
  return SYMPTOMS.filter(function (s) { return s.key === key; })[0] || null;
}

/* Free text is a BACKSTOP, not the mechanism. The checkbox is what the app
   acts on. This exists because a man in trouble is more likely to type it than
   to tick a box about it, and missing that costs more than a false alarm. */
const CRISIS_PHRASES = [
  "kill myself", "killing myself", "end my life", "ending my life",
  "want to die", "wanna die", "better off dead", "not worth living",
  "suicidal", "suicide", "hurt myself", "harm myself", "end it all"
];

function textFlagsCrisis(note) {
  const t = String(note || "").toLowerCase();
  return CRISIS_PHRASES.some(function (p) { return t.indexOf(p) !== -1; });
}

/* 0-100, higher is better. Only the fields he answered count, so a partial
   check-in is not punished for being partial. */
function checkinScore(c) {
  const vals = FIELD_KEYS
    .map(function (k) { return n(c[k]); })
    .filter(function (v) { return v >= 1 && v <= SCALE_MAX; });
  if (!vals.length) return null;
  const mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  return Math.round(((mean - 1) / (SCALE_MAX - 1)) * 100);
}

/* Which of the six he is struggling with, worst first. Drives what he is
   pointed at to read, and what a coordinator opens the conversation with. */
function lowFields(c, threshold) {
  const cut = threshold || 4;
  return CHECKIN_FIELDS
    .map(function (f) { return { key: f.key, label: f.label, topic: f.topic, value: n(c[f.key]) }; })
    .filter(function (x) { return x.value >= 1 && x.value <= cut; })
    .sort(function (a, b) { return a.value - b.value; });
}

/* Returns { level, reasons, red } where red is the list of symptoms that need
   an answer on his screen right now. `recent` is his previous check-ins,
   newest first, so a run of bad days escalates even when no single day does. */
function gradeCheckin(c, recent) {
  const reasons = [];
  const ticked = Array.isArray(c.symptoms) ? c.symptoms
               : (function () { try { return JSON.parse(c.symptoms || "[]"); } catch (e) { return []; } })();

  const red = ticked.map(symptom).filter(function (s) { return s && s.red; });
  const amber = ticked.map(symptom).filter(function (s) { return s && !s.red; });

  red.forEach(function (s) { reasons.push(s.label); });
  if (textFlagsCrisis(c.note)) {
    reasons.push("Wrote something that reads as a crisis");
  }
  amber.forEach(function (s) { reasons.push(s.label); });

  const score = checkinScore(c);
  /* 3 or below on a 1-10 scale. Not "below average": a man who says 3 out of
     10 is telling you something, and it should not need a second signal to be
     taken seriously. */
  const low = lowFields(c, 3);
  low.forEach(function (f) { reasons.push(f.label + " is at rock bottom"); });

  /* Three rough days running is a different thing from one bad Tuesday. */
  const prior = (recent || []).slice(0, 2)
    .filter(function (r) { return r.level === "rough" || r.level === "urgent"; }).length;
  const streak = prior >= 2 && (score !== null && score <= 40);
  if (streak) reasons.push("Third rough day in a row");

  let level = "ok";
  if (score !== null && score <= 40) level = "rough";
  /* One field at rock bottom flags on its own. Averaging is exactly how a man
     who is fine at everything except sleeping, or except his head, gets missed:
     four good numbers drown the one that matters. */
  if (low.length) level = "rough";
  if (amber.length) level = "rough";
  if (streak) level = "urgent";
  if (red.length || textFlagsCrisis(c.note)) level = "urgent";

  return { score: score, level: level, reasons: reasons, red: red };
}

/* The 7-day mean against the 7 before it, per field. Returned to the patient
   as his own trend and to the coordinator as the shape of the last fortnight. */
function checkinTrend(rows) {
  const fields = FIELD_KEYS;
  const recent = rows.slice(0, 7), before = rows.slice(7, 14);
  const mean = function (list, k) {
    const v = list.map(function (r) { return n(r[k]); }).filter(function (x) { return x >= 1; });
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  };
  const out = {};
  fields.forEach(function (k) {
    const a = mean(recent, k), b = mean(before, k);
    out[k] = {
      now: a === null ? null : Math.round(a * 10) / 10,
      was: b === null ? null : Math.round(b * 10) / 10,
      delta: (a === null || b === null) ? null : Math.round((a - b) * 10) / 10
    };
  });
  return out;
}

/* The patient's own local day, so "today" means his today and not UTC's. */
function dayKey(ts, offsetMinutes) {
  const d = new Date(n(ts) - (Number(offsetMinutes) || 0) * 60000);
  return d.toISOString().slice(0, 10);
}

/* ==========================================================================
   Settings (VAPID keys live here so they survive redeploys)
   ========================================================================== */

async function getSetting(key) {
  const r = await one("SELECT value FROM settings WHERE key = $1", [key]);
  return r ? r.value : null;
}
async function setSetting(key, value) {
  await q(`INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
}

/* First writer wins, and everyone reads back the winner. Used for the VAPID keys:
   two cold-start lambdas racing to generate them must converge on one pair, or
   push subscriptions taken against the loser would silently stop working. */
async function setSettingIfAbsent(key, value) {
  await q(`INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO NOTHING`, [key, value]);
  return await getSetting(key);
}

/* ==========================================================================
   Passwords + sessions
   ========================================================================== */

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString("hex");
  return { hash: crypto.scryptSync(password, s, 64).toString("hex"), salt: s };
}
function verifyPassword(password, hash, salt) {
  const h = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, "hex");
  return h.length === known.length && crypto.timingSafeEqual(h, known);
}

const SESSION_MS = 12 * 3600 * 1000;

async function createSession(coordinatorId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  await q(`INSERT INTO sessions (token, coordinator_id, created_at, expires_at)
           VALUES ($1, $2, $3, $4)`, [token, coordinatorId, now, now + SESSION_MS]);
  return token;
}

async function sessionUser(token) {
  if (!token) return null;
  const row = await one(`
    SELECT c.id, c.email, c.name, c.role, s.expires_at
      FROM sessions s JOIN coordinators c ON c.id = s.coordinator_id
     WHERE s.token = $1 AND c.active = 1`, [token]);
  if (!row) return null;
  if (Number(row.expires_at) < Date.now()) {
    await q("DELETE FROM sessions WHERE token = $1", [token]);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

async function destroySession(token) {
  if (token) await q("DELETE FROM sessions WHERE token = $1", [token]);
}
async function purgeExpiredSessions() {
  await q("DELETE FROM sessions WHERE expires_at < $1", [Date.now()]);
}

/* ==========================================================================
   Retention engine

   Four signals, exactly the ones the clinic asked for. Each produces a plain
   sentence a coordinator can act on. Nothing here decides anything clinical;
   it ranks who to phone today.
   ========================================================================== */

const THRESHOLDS = {
  supplyWarnDays: 10,      // flag when this much medication or less is left
  visitStaleDays: 90,      // flag when the last visit was this long ago
  quietDays: 21,           // flag when the app has not been opened this long
  renewalWarnDays: 14,     // flag when the renewal date is this close
  labWarnDays: 14          // flag when the next scheduled lab draw is this close
};

function daysBetween(a, b) { return Math.floor((a - b) / DAY); }

/* Calendar-accurate month arithmetic. Clamps to the end of a short month, so a
   start date of 31 Aug + 6 months lands on 28/29 Feb rather than spilling into March. */
function addMonths(ts, months) {
  const d = new Date(ts);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d.getTime();
}

/* ==========================================================================
   Lab schedule

   The clinic's rule, entered once as a start date and computed forever after:
     labs at 8 weeks, then 4 weeks after that, then every 6 months.
   ========================================================================== */

function labSchedule(startDate, howMany) {
  const start = n(startDate);
  if (!start) return [];
  const out = [];
  const first = start + 56 * DAY;              // 8 weeks
  const second = first + 28 * DAY;             // 4 weeks after the first
  out.push({ n: 1, at: first, label: "8-week labs" });
  out.push({ n: 2, at: second, label: "12-week labs" });
  let cur = second;
  for (let i = 3; i <= (howMany || 16); i++) {
    cur = addMonths(cur, 6);                   // every 6 months thereafter
    out.push({ n: i, at: cur, label: "6-month labs" });
  }
  return out;
}

/* Next lab due, plus the most recent one already past (which may have been missed,
   since the app does not know whether a draw actually happened). */
function labStatus(p, now) {
  const t = now || Date.now();
  const sched = labSchedule(p.start_date);
  if (!sched.length) return null;
  let next = null, previous = null;
  for (const s of sched) {
    if (s.at >= startOfDayTs(t)) { next = s; break; }
    previous = s;
  }
  return {
    next: next ? { at: next.at, label: next.label, n: next.n, inDays: daysBetween(next.at, t) } : null,
    previous: previous ? { at: previous.at, label: previous.label, n: previous.n,
                           daysAgo: daysBetween(t, previous.at) } : null
  };
}

function startOfDayTs(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }

/* Financing payments run monthly on a fixed day. Given that day, work out the
   next one due. Clamps to the last day of a short month, so a 31st payment
   lands on the 28th in February rather than skipping it. */
function nextPaymentDue(day, now) {
  const d = Number(day);
  if (!d || d < 1 || d > 31) return null;
  const t = now || Date.now();
  const today = new Date(t); today.setHours(0, 0, 0, 0);

  function onMonth(offset) {
    const x = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    x.setDate(Math.min(d, last));
    x.setHours(12, 0, 0, 0);
    return x.getTime();
  }
  const thisMonth = onMonth(0);
  return thisMonth >= today.getTime() ? thisMonth : onMonth(1);
}

/* Renewal: an explicit date always wins, otherwise it is the agreement length
   (12, 24 or 36 months) measured from the start date. */
function renewalDate(p) {
  const explicit = n(p.renewal_due_at);
  if (explicit) return explicit;
  const start = n(p.start_date), months = n(p.agreement_months);
  if (!start || !months) return null;
  return addMonths(start, months);
}

/* pg returns BIGINT as a string to avoid precision loss; coerce at the edge. */
function n(v) { return v == null ? null : Number(v); }

function scorePatient(p, now) {
  const t = now || Date.now();
  const reasons = [];
  let score = 0;

  const supplyStart = n(p.supply_started_at);
  const supplyDays = n(p.supply_days);
  const renewal = renewalDate(p);
  const lastVisit = n(p.last_visit_at);
  const enrolled = n(p.enrolled_at);
  const lastSeen = n(p.last_seen_at);

  if (Number(p.pinned)) {
    reasons.push({ code: "pinned", level: "flag", text: "Pinned by a coordinator" });
    score += 1000;
  }

  // 1. medication running out
  if (supplyStart && supplyDays) {
    const left = daysBetween(supplyStart + supplyDays * DAY, t);
    if (left < 0) {
      reasons.push({ code: "supply_out", level: "urgent",
        text: "Out of medication " + Math.abs(left) + (Math.abs(left) === 1 ? " day" : " days") + " ago" });
      score += 600 + Math.min(Math.abs(left), 60);
    } else if (left <= THRESHOLDS.supplyWarnDays) {
      reasons.push({ code: "supply_low", level: "warn",
        text: left === 0 ? "Medication runs out today"
                         : "Medication runs out in " + left + (left === 1 ? " day" : " days") });
      score += 400 + (THRESHOLDS.supplyWarnDays - left) * 5;
    }
  }

  // 2. labs, computed from the start date: 8 weeks, +4 weeks, then every 6 months
  const labs = labStatus(p, t);
  if (labs) {
    if (labs.previous && labs.previous.daysAgo <= 45) {
      reasons.push({ code: "labs_missed", level: "warn",
        text: labs.previous.label + " were due " + labs.previous.daysAgo +
              (labs.previous.daysAgo === 1 ? " day" : " days") + " ago" });
      score += 350;
    } else if (labs.next && labs.next.inDays <= THRESHOLDS.labWarnDays) {
      reasons.push({ code: "labs_soon", level: "info",
        text: labs.next.inDays === 0 ? labs.next.label + " due today"
              : labs.next.label + " due in " + labs.next.inDays +
                (labs.next.inDays === 1 ? " day" : " days") });
      score += 180;
    }
  }

  // 3. renewal: explicit date, or the agreement length from the start date
  if (renewal) {
    const left = daysBetween(renewal, t);
    if (left < 0) {
      reasons.push({ code: "renewal_past", level: "urgent",
        text: "Renewal was due " + Math.abs(left) + (Math.abs(left) === 1 ? " day" : " days") + " ago" });
      score += 500;
    } else if (left <= THRESHOLDS.renewalWarnDays) {
      reasons.push({ code: "renewal_soon", level: "warn",
        text: "Renewal due in " + left + (left === 1 ? " day" : " days") });
      score += 300;
    }
  }

  // 3. time since last visit
  if (lastVisit) {
    const since = daysBetween(t, lastVisit);
    if (since >= THRESHOLDS.visitStaleDays) {
      reasons.push({ code: "visit_stale", level: "warn", text: "No visit in " + since + " days" });
      score += 200 + Math.min(since - THRESHOLDS.visitStaleDays, 120);
    }
  } else {
    reasons.push({ code: "no_visit", level: "info", text: "No visit on record" });
    score += 60;
  }

  // 4. gone quiet in the app (only meaningful once they have enrolled)
  if (enrolled) {
    const quiet = daysBetween(t, lastSeen || enrolled);
    if (quiet >= THRESHOLDS.quietDays) {
      reasons.push({ code: "quiet", level: "info",
        text: "Has not opened the app in " + quiet + " days" });
      score += 100 + Math.min(quiet - THRESHOLDS.quietDays, 60);
    }
  } else {
    reasons.push({ code: "not_enrolled", level: "info", text: "Has not set up the app" });
    score += 40;
  }

  const level = reasons.some(function (r) { return r.level === "urgent"; }) ? "urgent"
              : reasons.some(function (r) { return r.level === "warn"; }) ? "warn"
              : reasons.length ? "info" : "ok";

  return { score: score, reasons: reasons, level: level };
}

function supplyLeft(p, now) {
  const s = n(p.supply_started_at), d = n(p.supply_days);
  if (!s || !d) return null;
  return daysBetween(s + d * DAY, now || Date.now());
}

/* `scope` comes from the API's panelScope(): a coordinator sees their own
   panel, an admin sees everyone. Scoping in SQL rather than filtering the
   result keeps one coordinator's patients out of another's response body. */
async function retentionBoard(now, scope) {
  const t = now || Date.now();
  const where = scope && scope.sql ? scope.sql.replace(" WHERE ", " AND ") : "";
  /* A sign-up nobody has confirmed yet is not a patient to work: he belongs in
     the sign-up queue, not on today's call list. */
  const rows = await q(
    "SELECT * FROM patients WHERE status = 'active'" +
    " AND COALESCE(account_status,'') <> 'pending'" + where,
    (scope && scope.vals) || []);
  return rows.map(function (p) {
    const s = scorePatient(p, t);
    return {
      id: p.id,
      name: p.first_name + " " + p.last_name,
      first_name: p.first_name, last_name: p.last_name,
      clinic: p.clinic, protocol: p.protocol,
      coordinatorId: n(p.coordinator_id),
      phone: p.phone, email: p.email,
      pinned: !!Number(p.pinned),
      enrolled: !!n(p.enrolled_at),
      supplyLeft: supplyLeft(p, t),
      lastVisitAt: n(p.last_visit_at),
      lastSeenAt: n(p.last_seen_at),
      startDate: n(p.start_date),
      agreementMonths: n(p.agreement_months),
      renewalAt: renewalDate(p),
      labs: labStatus(p, t),
      addons: p.addons || null,
      score: s.score, reasons: s.reasons, level: s.level
    };
  }).sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); });
}

async function recordEvent(patientId, kind, ref) {
  const now = Date.now();
  await q("INSERT INTO events (patient_id, kind, ref, at) VALUES ($1,$2,$3,$4)",
          [patientId, kind, ref || null, now]);
  await q("UPDATE patients SET last_seen_at = $1 WHERE id = $2", [now, patientId]);
}

module.exports = {
  q, one, raw, ensureSchema, getPool, DAY, THRESHOLDS, n,
  getSetting, setSetting, setSettingIfAbsent,
  hashPassword, verifyPassword,
  createSession, sessionUser, destroySession, purgeExpiredSessions,
  scorePatient, supplyLeft, retentionBoard, recordEvent, daysBetween,
  addMonths, labSchedule, labStatus, renewalDate, nextPaymentDue,
  SYMPTOMS, symptom, checkinScore, gradeCheckin, checkinTrend, dayKey, textFlagsCrisis,
  CHECKIN_FIELDS, FIELD_KEYS, SCALE_MAX, lowFields,
  PATIENT_TIMES,
  DAILY_SLOTS, slotsForGoals, localHM, slotIsDue,
  phoneKey, dobKey, samePatient, lockState, LOCK_AFTER, LOCK_MS,
  VITALITY_TIERS, VITALITY_UNIVERSAL, VITALITY_FOOTNOTE,
  vitalityTier, vitalityFromPoints, vitalityProgress, LENDERS, TEXT_LINE
};
