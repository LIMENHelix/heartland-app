/* ==========================================================================
   Heartland API — one Vercel serverless function behind /api/*.

     /api/admin/*   coordinator API, session-cookie auth
     /api/p/*       patient API, bearer token issued at enrolment

   Static surfaces (/app, /console) are served straight from public/.
   ========================================================================== */
"use strict";

const crypto = require("crypto");
const db = require("../lib/db");
const push = require("../lib/push");
const voice = require("../lib/voice");

/* ==========================================================================
   VAPID keys, generated once and kept in the database so they survive redeploys.
   Losing them invalidates every existing push subscription.
   ========================================================================== */

let vapidPromise = null;
function getVapid() {
  if (vapidPromise) return vapidPromise;
  vapidPromise = (async function () {
    let pub = await db.getSetting("vapid_public");
    let priv = await db.getSetting("vapid_private");
    if (!pub || !priv) {
      // Race-safe: whichever lambda inserts first wins, and both read that pair back.
      const k = push.generateVapidKeys();
      priv = await db.setSettingIfAbsent("vapid_private", k.privateKey);
      pub = priv === k.privateKey
        ? await db.setSettingIfAbsent("vapid_public", k.publicKey)
        : await db.getSetting("vapid_public");
      if (!pub || !priv) throw new Error("Could not establish VAPID keys.");
      console.log("VAPID key pair established.");
    }
    return {
      publicKey: pub, privateKey: priv,
      subject: process.env.HMH_VAPID_SUBJECT || "mailto:care@heartlandmenshealth.com"
    };
  })().catch(function (e) { vapidPromise = null; throw e; });
  return vapidPromise;
}

/* ==========================================================================
   Helpers
   ========================================================================== */

function send(res, status, obj, extraHeaders) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(function (k) { res.setHeader(k, extraHeaders[k]); });
  }
  res.end(JSON.stringify(obj));
}

/* Vercel usually parses JSON for us, but not for every content type. */
function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try { return Promise.resolve(JSON.parse(req.body)); } catch (e) { return Promise.resolve({}); }
  }
  return new Promise(function (resolve) {
    let size = 0;
    const chunks = [];
    req.on("data", function (c) {
      size += c.length;
      if (size > 512 * 1024) { req.destroy(); resolve({}); return; }
      chunks.push(c);
    });
    req.on("end", function () {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { resolve({}); }
    });
    req.on("error", function () { resolve({}); });
  });
}

function cookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(function (part) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80)
         || "article-" + Date.now();
}

/* On Vercel everything is https, so the session cookie is always Secure. */
function sessionCookie(token, maxAge) {
  return "hmh_session=" + token + "; HttpOnly; SameSite=Strict; Path=/; Max-Age=" + maxAge +
         (process.env.HMH_INSECURE_COOKIE ? "" : "; Secure");
}

async function requireCoordinator(req, res) {
  const user = await db.sessionUser(cookies(req).hmh_session);
  if (!user) { send(res, 401, { error: "Sign in to continue." }); return null; }
  return user;
}

function url(req) { return new URL(req.url, "http://localhost"); }

/* Only an admin manages the team. A coordinator running their own panel must
   not be able to create accounts, change roles, or reset someone's password. */
async function requireAdmin(req, res) {
  const user = await db.sessionUser(cookies(req).hmh_session);
  if (!user) { send(res, 401, { error: "Sign in to continue." }); return null; }
  if (user.role !== "admin") {
    send(res, 403, { error: "Only an administrator can manage the team." });
    return null;
  }
  return user;
}

/* A coordinator sees their own panel. An admin sees everyone, and can narrow to
   one coordinator. This is enforced in SQL rather than by hiding rows in the
   browser, so an unassigned patient is visible to admins only and never leaks
   sideways between coordinators. */
function panelScope(user, wanted) {
  if (user.role !== "admin") return { sql: " WHERE coordinator_id = $1", vals: [user.id] };
  const id = Number(wanted);
  if (wanted === "mine") return { sql: " WHERE coordinator_id = $1", vals: [user.id] };
  if (wanted === "unassigned") return { sql: " WHERE coordinator_id IS NULL", vals: [] };
  if (id > 0) return { sql: " WHERE coordinator_id = $1", vals: [id] };
  return { sql: "", vals: [] };
}

/* Every write against one patient checks this. Reads are scoped by panelScope;
   writes have to be checked per row, because the id arrives in the body. */
async function ownsPatient(user, patientId) {
  if (user.role === "admin") return true;
  const r = await db.one("SELECT 1 AS ok FROM patients WHERE id = $1 AND coordinator_id = $2",
                         [patientId, user.id]);
  return !!r;
}

/* Passwords a human has to read aloud once. Same alphabet as the enrolment
   code: no 0/O or 1/I/L to mishear. */
function tempPassword() {
  const A = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const b = crypto.randomBytes(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += A[b[i] % A.length];
  return s.slice(0, 5) + "-" + s.slice(5);
}

async function patientFromToken(req) {
  const auth = req.headers.authorization || "";
  const token = auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "";
  if (!token) return null;
  const row = await db.one(`
    SELECT p.* FROM patients p
      JOIN patient_tokens t ON t.patient_id = p.id
     WHERE t.token = $1 AND t.revoked_at IS NULL`, [token]);
  if (!row) return null;
  await db.q("UPDATE patient_tokens SET last_used_at = $1 WHERE token = $2", [Date.now(), token]);
  return row;
}

/* Everything clinical goes through here. A man who has signed up but has not
   been confirmed as a patient holds a perfectly valid session and still must
   not see a single thing about anyone's treatment, so the check is on the
   status and not merely on the token. */
async function requirePatient(req, res) {
  const row = await patientFromToken(req);
  if (!row) { send(res, 401, { error: "Not enrolled." }); return null; }
  if (row.account_status === "pending") {
    send(res, 403, { error: "pending", pending: true });
    return null;
  }
  if (row.account_status === "rejected") {
    send(res, 403, { error: "This account is not active. Please call the clinic." });
    return null;
  }
  return row;
}

/* ==========================================================================
   Push delivery
   ========================================================================== */

async function pushToPatient(patientId, payload) {
  const vapid = await getVapid();
  const devices = await db.q("SELECT * FROM devices WHERE patient_id = $1 AND active = 1", [patientId]);
  if (!devices.length) return { sent: 0, failed: 0, noDevice: true };

  let sent = 0, failed = 0;
  for (const d of devices) {
    try {
      const r = await push.sendNotification(
        { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
        payload, vapid, { ttl: 86400 * 3, urgency: "normal" });
      if (r.ok) {
        sent++;
        await db.q("UPDATE devices SET last_ok_at = $1 WHERE id = $2", [Date.now(), d.id]);
      } else {
        failed++;
        // 404/410 mean the browser threw the subscription away.
        if (r.gone) await db.q("UPDATE devices SET active = 0 WHERE id = $1", [d.id]);
        else console.warn("push failed", d.id, r.status, String(r.body).slice(0, 200));
      }
    } catch (e) {
      failed++;
      console.warn("push error", d.id, e.message);
    }
  }
  return { sent: sent, failed: failed };
}

/* The lock screen is not a private place. Everything clinical stays behind
   auth inside the app; the notification itself is deliberately vague. */
function notificationPayload(msg) {
  return {
    title: "Heartland",
    body: msg.kind === "refill" ? "A refill reminder from your care team"
        : msg.kind === "marketing" ? "An update from Heartland"
        : "A message from your care team",
    tag: "hmh-msg-" + msg.id,
    url: "/app/?m=" + msg.id
  };
}

/* ==========================================================================
   The patient's own view, built once.

   The console can show a coordinator exactly what a patient sees. That is only
   worth having if it is the SAME view: a preview assembled separately drifts
   from the real thing within a release or two and then it is quietly lying
   about somebody's treatment. So both the patient route and the preview route
   call this.
   ========================================================================== */

async function homePayload(p) {
    const unread = await db.one(
      "SELECT COUNT(*)::int AS n FROM message_targets WHERE patient_id = $1 AND read_at IS NULL", [p.id]);
    const now = Date.now();
    const labs = db.labStatus(p, now);
    const renewalAt = db.renewalDate(p);

    /* A lab date that has passed but is still recent is worth surfacing: the app
       cannot know whether the draw actually happened, so it prompts rather than
       assumes. Beyond 45 days it stops nagging and just shows the next one. */
    const missed = labs && labs.previous && labs.previous.daysAgo <= 45 ? labs.previous : null;

    /* The patient's point of contact. If nobody is assigned, or they have no
       direct line recorded, the app shows NO phone button at all rather than
       falling back to a general number. */
    let coordinator = null;
    if (p.coordinator_id) {
      const c = await db.one(
        "SELECT name, phone, title, contact_email FROM coordinators WHERE id = $1 AND active = 1",
        [p.coordinator_id]);
      if (c && (c.phone || c.contact_email)) {
        coordinator = { name: c.name, phone: c.phone || null,
                        email: c.contact_email || null, title: c.title || null };
      }
    }

    const payDue = db.nextPaymentDue(p.payment_due_day, now);

  return {
      coordinator: coordinator,
      textLine: db.TEXT_LINE,
      vitality: (function () {
        /* The coordinator's choice ALWAYS wins. Points are display only and can
           never silently promote or demote someone; if thresholds are ever
           configured they only fill in a tier nobody has set by hand. */
        const t = db.vitalityTier(p.vitality_status) || db.vitalityFromPoints(p.vitality_points);
        if (!t) return null;
        return {
          label: t.label,
          tierNumber: t.n,
          discount: t.discount,
          points: db.n(p.vitality_points),
          trial: t.trial,
          treatments: t.treatments,
          universal: db.VITALITY_UNIVERSAL,
          footnote: db.VITALITY_FOOTNOTE,
          progress: db.vitalityProgress(t, p.vitality_points),
          ladder: db.VITALITY_TIERS.map(function (x) {
            return { label: x.label, discount: x.discount, current: x.key === t.key,
                     earned: x.n <= t.n };
          })
        };
      })(),
      payment: (p.payment_amount || p.lender_name || payDue) ? {
        amount: p.payment_amount || null,
        dueAt: payDue,
        dueInDays: payDue == null ? null : db.daysBetween(payDue, now),
        lender: p.lender_name || null,
        lenderPhone: p.lender_phone || null,
        lenderUrl: p.lender_url || null
      } : null,
      firstName: p.first_name,
      protocol: p.protocol,
      clinic: p.clinic,
      supplyLeft: db.supplyLeft(p, now),
      lastVisitAt: db.n(p.last_visit_at),
      startDate: db.n(p.start_date),
      agreementMonths: db.n(p.agreement_months),
      renewalAt: renewalAt,
      renewalInDays: renewalAt == null ? null : db.daysBetween(renewalAt, now),
      labs: labs ? { next: labs.next, missed: missed } : null,
      unread: unread ? unread.n : 0
  };
}

async function threadFor(patientId) {
  const rows = await db.q(`
    SELECT m.id, m.title, m.body, m.kind, m.article_id, m.sent_at,
           m.direction, t.read_at
      FROM message_targets t JOIN messages m ON m.id = t.message_id
     WHERE t.patient_id = $1 AND m.direction = 'out'
    UNION ALL
    SELECT m.id, m.title, m.body, m.kind, m.article_id, m.sent_at,
           m.direction, m.sent_at AS read_at
      FROM messages m
     WHERE m.direction = 'in' AND m.from_patient_id = $1
     ORDER BY sent_at DESC LIMIT 200`, [patientId]);
  rows.forEach(function (r) { r.sent_at = db.n(r.sent_at); r.read_at = db.n(r.read_at); });
  return rows;
}

/* ==========================================================================
   Routes
   ========================================================================== */

const routes = {

  /* ---------------- coordinator auth ---------------- */

  "POST /api/admin/login": async function (req, res) {
    const b = await readBody(req);
    const row = await db.one("SELECT * FROM coordinators WHERE email = $1 AND active = 1",
                             [String(b.email || "").toLowerCase().trim()]);
    // Same message either way: do not confirm which accounts exist.
    if (!row || !db.verifyPassword(String(b.password || ""), row.pass_hash, row.pass_salt)) {
      return send(res, 401, { error: "That email and password do not match." });
    }
    const token = await db.createSession(row.id);
    send(res, 200, { ok: true, name: row.name, role: row.role },
         { "Set-Cookie": sessionCookie(token, 12 * 3600) });
  },

  "POST /api/admin/logout": async function (req, res) {
    await db.destroySession(cookies(req).hmh_session);
    send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
  },

  "GET /api/admin/me": async function (req, res) {
    const u = await db.sessionUser(cookies(req).hmh_session);
    if (!u) return send(res, 401, { error: "Not signed in." });
    send(res, 200, { user: u });
  },

  /* Lists the console needs, served from the same constants the app uses. */
  "GET /api/admin/lists": async function (req, res) {
    if (!await requireCoordinator(req, res)) return;
    send(res, 200, {
      vitalityTiers: db.VITALITY_TIERS,
      vitalityUniversal: db.VITALITY_UNIVERSAL,
      lenders: db.LENDERS,
      textLine: db.TEXT_LINE,
      salesforceBase: (await db.getSetting("salesforce_base")) || null
    });
  },

  "GET /api/admin/coordinators": async function (req, res) {
    if (!await requireCoordinator(req, res)) return;
    send(res, 200, { coordinators: await db.q(
      "SELECT id, name, email, phone, title, contact_email FROM coordinators WHERE active = 1 ORDER BY name") });
  },

  "POST /api/admin/me-update": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    const sets = [], vals = [];
    if (b.name) { vals.push(String(b.name).trim()); sets.push("name = $" + vals.length); }
    ["phone", "title", "contact_email"].forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(b, k)) {
        vals.push(b[k] || null); sets.push(k + " = $" + vals.length);
      }
    });
    if (sets.length) {
      vals.push(u.id);
      await db.q("UPDATE coordinators SET " + sets.join(", ") + " WHERE id = $" + vals.length, vals);
    }
    send(res, 200, { ok: true });
  },

  /* ---------------- the team ----------------
     A clinic running a hundred coordinators needs the accounts to be
     administered from inside the console, not by someone editing the database.
     Everything here is admin only. */

  "GET /api/admin/team": async function (req, res) {
    const u = await requireAdmin(req, res); if (!u) return;
    const rows = await db.q(`
      SELECT c.id, c.name, c.email, c.phone, c.title, c.contact_email, c.role,
             c.active, c.created_at,
             (SELECT COUNT(*) FROM patients p WHERE p.coordinator_id = c.id) AS patients,
             (SELECT COUNT(*) FROM patients p WHERE p.coordinator_id = c.id
                AND p.enrolled_at IS NOT NULL) AS enrolled,
             (SELECT MAX(s.created_at) FROM sessions s WHERE s.coordinator_id = c.id) AS last_login
        FROM coordinators c ORDER BY c.active DESC, c.name`);
    rows.forEach(function (r) {
      r.patients = Number(r.patients); r.enrolled = Number(r.enrolled);
      r.active = Number(r.active); r.last_login = db.n(r.last_login);
    });
    const un = await db.one("SELECT COUNT(*) AS n FROM patients WHERE coordinator_id IS NULL");
    send(res, 200, { team: rows, unassigned: Number(un.n), me: u.id });
  },

  /* Create or update one account. On create the temp password comes back once
     and is never retrievable again: it is stored only as a salted hash. */
  "POST /api/admin/team-save": async function (req, res) {
    const u = await requireAdmin(req, res); if (!u) return;
    const b = await readBody(req);
    const email = String(b.email || "").toLowerCase().trim();
    const name = String(b.name || "").trim();
    if (!name) return send(res, 400, { error: "A name is required." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return send(res, 400, { error: "That is not a valid email address." });
    }
    const role = b.role === "admin" ? "admin" : "coordinator";
    const clash = await db.one("SELECT id FROM coordinators WHERE email = $1", [email]);

    if (b.id) {
      if (clash && Number(clash.id) !== Number(b.id)) {
        return send(res, 409, { error: "Another account already uses that email." });
      }
      /* Never let the last admin demote or deactivate themselves out of the
         console: it would lock the team page for everyone. */
      const active = b.active === 0 || b.active === false ? 0 : 1;
      if (Number(b.id) === u.id && (role !== "admin" || !active)) {
        const others = await db.one(
          "SELECT COUNT(*) AS n FROM coordinators WHERE role = 'admin' AND active = 1 AND id <> $1", [u.id]);
        if (Number(others.n) === 0) {
          return send(res, 400, { error: "You are the only administrator. Promote someone else first." });
        }
      }
      await db.q(`UPDATE coordinators SET name=$1, email=$2, phone=$3, title=$4,
                    contact_email=$5, role=$6, active=$7 WHERE id=$8`,
        [name, email, b.phone || null, b.title || null, b.contact_email || null,
         role, active, b.id]);
      return send(res, 200, { ok: true, id: Number(b.id) });
    }

    if (clash) return send(res, 409, { error: "An account already uses that email." });
    const pw = tempPassword();
    const h = db.hashPassword(pw);   // returns { hash, salt }
    const row = await db.one(`
      INSERT INTO coordinators (email, name, pass_hash, pass_salt, role, active,
                                created_at, phone, title, contact_email)
      VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9) RETURNING id`,
      [email, name, h.hash, h.salt, role, Date.now(),
       b.phone || null, b.title || null, b.contact_email || null]);
    send(res, 200, { ok: true, id: Number(row.id), password: pw });
  },

  "POST /api/admin/team-password": async function (req, res) {
    const u = await requireAdmin(req, res); if (!u) return;
    const b = await readBody(req);
    const row = await db.one("SELECT id FROM coordinators WHERE id = $1", [b.id]);
    if (!row) return send(res, 404, { error: "No such account." });
    const pw = tempPassword();
    const h = db.hashPassword(pw);
    await db.q("UPDATE coordinators SET pass_hash=$1, pass_salt=$2 WHERE id=$3",
               [h.hash, h.salt, b.id]);
    /* Signing them out everywhere is the point of a reset. */
    await db.q("DELETE FROM sessions WHERE coordinator_id = $1", [b.id]);
    send(res, 200, { ok: true, password: pw });
  },

  /* Hand a whole panel to someone else in one move: the case when a
     coordinator leaves, or a caseload gets rebalanced. */
  "POST /api/admin/team-reassign": async function (req, res) {
    const u = await requireAdmin(req, res); if (!u) return;
    const b = await readBody(req);
    const to = await db.one("SELECT id, name FROM coordinators WHERE id = $1 AND active = 1", [b.to]);
    if (!to) return send(res, 404, { error: "That coordinator is not active." });
    const r = b.from === "unassigned"
      ? await db.q("UPDATE patients SET coordinator_id=$1, updated_at=$2 WHERE coordinator_id IS NULL RETURNING id",
                   [to.id, Date.now()])
      : await db.q("UPDATE patients SET coordinator_id=$1, updated_at=$2 WHERE coordinator_id=$3 RETURNING id",
                   [to.id, Date.now(), b.from]);
    send(res, 200, { ok: true, moved: r.length, to: to.name });
  },

  /* Anyone can change their own password. Previously only an admin could reset
     somebody else's, which meant a hundred coordinators all had to ask one
     person, and that person had to be told the new value. */
  "POST /api/admin/me-password": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    const current = String(b.current || "");
    const next = String(b.next || "");

    const row = await db.one("SELECT pass_hash, pass_salt FROM coordinators WHERE id = $1", [u.id]);
    if (!row || !db.verifyPassword(current, row.pass_hash, row.pass_salt)) {
      return send(res, 403, { error: "That is not your current password." });
    }
    /* Length beats composition rules: "Passw0rd!" satisfies every symbol rule
       and is worthless. Twelve characters of anything is not. */
    if (next.length < 12) {
      return send(res, 400, { error: "Use at least 12 characters. A short phrase you will remember is fine." });
    }
    if (next === current) {
      return send(res, 400, { error: "That is the password you already have." });
    }
    const h = db.hashPassword(next);
    await db.q("UPDATE coordinators SET pass_hash = $1, pass_salt = $2 WHERE id = $3",
               [h.hash, h.salt, u.id]);

    /* Every other session ends, because changing a password is what you do
       when you think somebody else might have it. This one survives so the
       change does not throw you out of the screen you are standing on. */
    const keep = cookies(req).hmh_session;
    const gone = await db.q(
      "DELETE FROM sessions WHERE coordinator_id = $1 AND token <> $2 RETURNING token",
      [u.id, keep]);
    send(res, 200, { ok: true, signedOutElsewhere: gone.length });
  },

  /* Counts only, so an open console can check for new work every half minute
     without running the seven queries a full load costs. A hundred consoles
     polling the real endpoints would be a hundred times that, every 30s, all
     day. This is four COUNT(*)s. */
  "GET /api/admin/pulse": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const scope = panelScope(u, url(req).searchParams.get("panel"));
    const pWhere = scope.sql ? scope.sql.replace(" WHERE ", " AND p.") : "";

    const questions = await db.one(`
      SELECT COUNT(*)::int AS n FROM messages m
        JOIN patients p ON p.id = m.from_patient_id
       WHERE m.direction = 'in'
         AND NOT EXISTS (SELECT 1 FROM messages r
                          WHERE r.reply_to = m.id AND r.direction = 'out')` + pWhere,
      scope.vals);
    const checkins = await db.one(`
      SELECT COUNT(*)::int AS n FROM checkins c
        JOIN patients p ON p.id = c.patient_id
       WHERE c.level <> 'ok' AND c.seen_at IS NULL` + pWhere, scope.vals);
    const signups = await db.one(
      "SELECT COUNT(*)::int AS n FROM patients WHERE account_status = 'pending'");
    const latest = await db.one(`
      SELECT MAX(m.sent_at) AS t FROM messages m
        JOIN patients p ON p.id = m.from_patient_id
       WHERE m.direction = 'in'` + pWhere, scope.vals);

    send(res, 200, {
      questions: questions.n, checkins: checkins.n, signups: signups.n,
      latest: db.n(latest && latest.t)
    });
  },

  /* ---------------- retention board ---------------- */

  "GET /api/admin/board": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const scope = panelScope(u, url(req).searchParams.get("panel"));
    send(res, 200, {
      board: await db.retentionBoard(null, scope),
      thresholds: db.THRESHOLDS
    });
  },

  /* ---------------- patients ---------------- */

  "GET /api/admin/patients": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const scope = panelScope(u, url(req).searchParams.get("panel"));
    /* Pending sign-ups are not on anybody's panel yet, so they are handled in
       their own view and kept out of the working list. */
    const where = scope.sql
      ? scope.sql + " AND COALESCE(account_status,'') <> 'pending'"
      : " WHERE COALESCE(account_status,'') <> 'pending'";
    const rows = await db.q(
      "SELECT * FROM patients" + where + " ORDER BY last_name, first_name", scope.vals);
    /* Postgres returns BIGINT as a STRING. new Date("88016400000") is not an
       epoch, it is an Invalid Date, and anything downstream that formats it
       throws. Normalise here so no consumer has to remember. */
    rows.forEach(function (r) { db.PATIENT_TIMES.forEach(function (k) { r[k] = db.n(r[k]); }); });
    send(res, 200, { patients: rows });
  },

  "POST /api/admin/patients": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    if (!b.first_name || !b.last_name) {
      return send(res, 400, { error: "First and last name are required." });
    }
    const now = Date.now();
    /* A patient belongs to whoever created them unless an admin says otherwise.
       Nobody starts life unassigned, because an unassigned patient has no one
       answering their messages. */
    const owner = (u.role === "admin" && b.coordinator_id) ? b.coordinator_id : u.id;
    const row = await db.one(`
      INSERT INTO patients (first_name, last_name, email, phone, clinic, protocol,
                            last_visit_at, supply_started_at, supply_days, renewal_due_at,
                            status, notes, date_of_birth, start_date, agreement_months, addons,
                            coordinator_id, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [String(b.first_name).trim(), String(b.last_name).trim(), b.email || null, b.phone || null,
       b.clinic || null, b.protocol || null, b.last_visit_at || null, b.supply_started_at || null,
       b.supply_days || null, b.renewal_due_at || null, b.status || "active", b.notes || null,
       b.date_of_birth || null, b.start_date || null, b.agreement_months || null, b.addons || null,
       owner, now, now]);
    send(res, 200, { id: row.id });
  },

  "POST /api/admin/patient-update": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    if (!b.id) return send(res, 400, { error: "Missing patient id." });
    if (!await ownsPatient(u, b.id)) {
      return send(res, 403, { error: "That patient is on another coordinator's panel." });
    }
    /* Moving a patient between coordinators is an admin action. A coordinator
       cannot quietly hand their panel to someone else or take one. */
    if (u.role !== "admin") delete b.coordinator_id;
    const allowed = ["first_name", "last_name", "email", "phone", "clinic", "protocol",
                     "last_visit_at", "supply_started_at", "supply_days", "renewal_due_at",
                     "status", "pinned", "notes",
                     "date_of_birth", "start_date", "agreement_months", "addons",
                     "coordinator_id", "vitality_status", "vitality_points", "salesforce_id",
                     "shot_day", "shot_hour", "glp1_eligible",
                     "lender_name", "lender_phone",
                     "lender_url", "payment_amount", "payment_due_day"];
    const sets = [], vals = [];
    allowed.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(b, k)) {
        vals.push(b[k]);
        sets.push(k + " = $" + vals.length);
      }
    });
    if (!sets.length) return send(res, 400, { error: "Nothing to update." });
    vals.push(Date.now());  sets.push("updated_at = $" + vals.length);
    vals.push(b.id);
    await db.q("UPDATE patients SET " + sets.join(", ") + " WHERE id = $" + vals.length, vals);
    send(res, 200, { ok: true });
  },

  /* One-time enrolment link the coordinator texts or reads to the patient. */
  "POST /api/admin/enroll-link": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    const p = await db.one("SELECT * FROM patients WHERE id = $1", [b.id]);
    if (!p) return send(res, 404, { error: "No such patient." });
    if (!await ownsPatient(u, p.id)) {
      return send(res, 403, { error: "That patient is on another coordinator's panel." });
    }
    const token = crypto.randomBytes(24).toString("base64url");
    const now = Date.now();

    /* A short code, either read aloud at the appointment or texted to him
       later. No 0/O or 1/I/L, so it cannot be misheard or mistyped.

       Three days, not two hours. Single use is what actually protects this:
       six characters of a 31-letter alphabet is ~887 million combinations and
       the code dies the moment it is used. A two-hour window only guaranteed
       that a code sent on a Friday afternoon was dead before he read it. */
    const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    let code = null;
    for (let attempt = 0; attempt < 8 && !code; attempt++) {
      const bytes = crypto.randomBytes(6);
      let candidate = "";
      for (let i = 0; i < 6; i++) candidate += ALPHABET[bytes[i] % ALPHABET.length];
      const clash = await db.one(
        "SELECT 1 FROM enroll_tokens WHERE code = $1 AND used_at IS NULL AND expires_at > $2",
        [candidate, now]);
      if (!clash) code = candidate;
    }
    if (!code) return send(res, 500, { error: "Could not generate a code. Try again." });

    const TTL = 72 * 3600 * 1000;
    await db.q(`INSERT INTO enroll_tokens (token, patient_id, created_at, expires_at, code)
                VALUES ($1,$2,$3,$4,$5)`, [token, p.id, now, now + TTL, code]);
    send(res, 200, { token: token, code: code, path: "/app/?enroll=" + token,
                     expiresAt: now + TTL, expiresInHours: 72,
                     firstName: p.first_name, phone: p.phone || null });
  },

  /* ---------------- the direct line, clinic side ---------------- */

  "GET /api/admin/inbox": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const scope = panelScope(u, url(req).searchParams.get("panel"));
    const rows = await db.q(`
      SELECT m.id, m.body, m.sent_at, m.from_patient_id, m.reply_to,
             p.first_name, p.last_name, p.phone, p.email, p.clinic, p.coordinator_id,
             (SELECT COUNT(*)::int FROM messages r
               WHERE r.reply_to = m.id AND r.direction = 'out') AS answered
        FROM messages m JOIN patients p ON p.id = m.from_patient_id
       WHERE m.direction = 'in'`
       + scope.sql.replace(" WHERE ", " AND p.").replace("coordinator_id", "coordinator_id")
       + ` ORDER BY m.sent_at DESC LIMIT 100`, scope.vals);
    rows.forEach(function (r) { r.sent_at = db.n(r.sent_at); });
    send(res, 200, { questions: rows });
  },

  "POST /api/admin/patient-delete": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    if (!b.id) return send(res, 400, { error: "Missing patient id." });
    if (!await ownsPatient(u, b.id)) {
      return send(res, 403, { error: "That patient is on another coordinator's panel." });
    }
    const gone = await db.one("SELECT * FROM patients WHERE id = $1", [b.id]);
    if (!gone) return send(res, 404, { error: "No such patient." });

    /* Write the audit row FIRST. If the delete then fails, an extra line in a
       log is harmless; a delete with no record of it is not. */
    const cCount = await db.one("SELECT COUNT(*)::int AS n FROM checkins WHERE patient_id = $1", [b.id]);
    const mCount = await db.one(
      "SELECT COUNT(*)::int AS n FROM messages WHERE from_patient_id = $1", [b.id]);
    await db.q(`INSERT INTO deletions (patient_id, first_name, last_name, email, phone,
                  deleted_by, deleted_by_name, at, had_checkins, had_messages)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [gone.id, gone.first_name, gone.last_name, gone.email, gone.phone,
       u.id, u.name, Date.now(), cCount.n, mCount.n]);

    /* His messages would otherwise survive him as orphans, invisible in the UI
       and sitting in the table forever. */
    await db.q("DELETE FROM message_targets WHERE message_id IN (SELECT id FROM messages WHERE from_patient_id = $1)", [b.id]);
    await db.q("DELETE FROM messages WHERE from_patient_id = $1", [b.id]);
    // the rest cascades: tokens, devices, events, check-ins, logs
    await db.q("DELETE FROM patients WHERE id = $1", [b.id]);
    send(res, 200, { ok: true });
  },


  /* ---------------- check-ins, clinic side ----------------
     Open means nobody has looked at it yet. Urgent sorts to the top. */

  "GET /api/admin/checkins": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const scope = panelScope(u, url(req).searchParams.get("panel"));
    const where = scope.sql ? scope.sql.replace(" WHERE ", " AND p.") : "";
    const rows = await db.q(`
      SELECT c.*, p.first_name, p.last_name, p.phone, p.email, p.clinic,
             p.coordinator_id, p.salesforce_id
        FROM checkins c JOIN patients p ON p.id = c.patient_id
       WHERE c.level <> 'ok'` + where + `
       ORDER BY (c.seen_at IS NULL) DESC,
                CASE c.level WHEN 'urgent' THEN 0 ELSE 1 END,
                c.at DESC
       LIMIT 100`, scope.vals);
    rows.forEach(function (r) { r.at = db.n(r.at); r.seen_at = db.n(r.seen_at); });
    send(res, 200, { checkins: rows, symptoms: db.SYMPTOMS,
                     fields: db.CHECKIN_FIELDS, scaleMax: db.SCALE_MAX });
  },

  "POST /api/admin/checkin-seen": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    const c = await db.one("SELECT patient_id FROM checkins WHERE id = $1", [b.id]);
    if (!c) return send(res, 404, { error: "No such check-in." });
    if (!await ownsPatient(u, c.patient_id)) {
      return send(res, 403, { error: "That patient is on another coordinator's panel." });
    }
    await db.q("UPDATE checkins SET seen_at = $1, seen_by = $2 WHERE id = $3",
               [Date.now(), u.id, b.id]);
    send(res, 200, { ok: true });
  },

  /* One patient's fortnight: what he reported, ate and did. */
  "GET /api/admin/patient-checkins": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const id = Number(url(req).searchParams.get("id"));
    if (!await ownsPatient(u, id)) {
      return send(res, 403, { error: "That patient is on another coordinator's panel." });
    }
    const rows = await db.q(
      "SELECT * FROM checkins WHERE patient_id = $1 ORDER BY at DESC LIMIT 30", [id]);
    const logs = await db.q(
      "SELECT * FROM logs WHERE patient_id = $1 ORDER BY at DESC LIMIT 60", [id]);
    rows.forEach(function (r) { r.at = db.n(r.at); });
    logs.forEach(function (r) { r.at = db.n(r.at); });
    /* How many of the last 14 days he actually recorded. A trend built on
       three entries is not a trend, and the coordinator should be able to
       see that before reading anything into the numbers. */
    const cutoff = Date.now() - 14 * db.DAY;
    const logged = rows.filter(function (r) { return r.at >= cutoff; }).length;
    send(res, 200, { checkins: rows, logs: logs, trend: db.checkinTrend(rows),
                     symptoms: db.SYMPTOMS, fields: db.CHECKIN_FIELDS,
                     scaleMax: db.SCALE_MAX,
                     adherence: { logged: logged, of: 14 } });
  },


  /* ---------------- new sign-ups ----------------

     Everyone who created an account that did not match a record. Every one of
     them is waiting, and none of them can see anything until somebody here
     says who they are. Deliberately NOT panel-scoped: an unclaimed sign-up
     belongs to nobody yet, so scoping it by coordinator would hide it from
     everyone and leave the man waiting forever. */

  "GET /api/admin/signups": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const rows = await db.q(`
      SELECT id, first_name, last_name, email, phone, date_of_birth, signed_up_at
        FROM patients WHERE account_status = 'pending'
       ORDER BY signed_up_at`);
    rows.forEach(function (r) {
      r.signed_up_at = db.n(r.signed_up_at);
      r.date_of_birth = db.n(r.date_of_birth);
    });

    /* For each one, records that look like they could be the same man, so a
       coordinator is choosing from a shortlist rather than searching. */
    for (const r of rows) {
      const near = await db.q(`
        SELECT id, first_name, last_name, phone, date_of_birth, clinic, protocol
          FROM patients
         WHERE pass_hash IS NULL AND id <> $1 AND lower(last_name) = $2
         ORDER BY last_name, first_name LIMIT 5`, [r.id, String(r.last_name).toLowerCase()]);
      near.forEach(function (c) { c.date_of_birth = db.n(c.date_of_birth); });
      r.possibleMatches = near;
    }
    send(res, 200, { signups: rows, textLine: db.TEXT_LINE });
  },

  /* Three outcomes, and the destructive one is the one that keeps the row.
     Deleting a rejected sign-up would let the same details be submitted again
     five minutes later with nobody the wiser. */
  "POST /api/admin/signup-decide": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    const now = Date.now();
    const signup = await db.one(
      "SELECT * FROM patients WHERE id = $1 AND account_status = 'pending'", [b.id]);
    if (!signup) return send(res, 404, { error: "That sign-up is no longer waiting." });

    if (b.decision === "reject") {
      await db.q(`UPDATE patients SET account_status = 'rejected', approved_at = $1,
                    approved_by = $2, updated_at = $1 WHERE id = $3`, [now, u.id, signup.id]);
      /* Whatever they are holding stops working immediately. */
      await db.q("UPDATE patient_tokens SET revoked_at = $1 WHERE patient_id = $2 AND revoked_at IS NULL",
                 [now, signup.id]);
      return send(res, 200, { ok: true, decision: "rejected" });
    }

    if (b.decision === "link") {
      const target = await db.one(
        "SELECT * FROM patients WHERE id = $1 AND pass_hash IS NULL", [b.targetId]);
      if (!target) return send(res, 404, { error: "That record is not available to link." });

      /* The account moves ONTO the existing record, so his history, his plan
         and his coordinator all survive.

         Order matters. One email address can only belong to one account, so
         the duplicate row has to be gone BEFORE the target takes its email,
         or the two collide and the whole thing rolls back. Move his session
         first, then drop the row, then hand its details to the record. */
      await db.q("UPDATE patient_tokens SET patient_id = $1 WHERE patient_id = $2",
                 [target.id, signup.id]);
      await db.q("DELETE FROM patients WHERE id = $1", [signup.id]);
      await db.q(`UPDATE patients SET
                    first_name = $1, email = $2,
                    phone = COALESCE(NULLIF($3,''), phone),
                    date_of_birth = COALESCE($4, date_of_birth),
                    pass_hash = $5, pass_salt = $6, account_status = 'active',
                    signed_up_at = $7, approved_at = $8, approved_by = $9,
                    enrolled_at = COALESCE(enrolled_at, $8), updated_at = $8
                  WHERE id = $10`,
        [signup.first_name, signup.email, signup.phone || "", db.n(signup.date_of_birth),
         signup.pass_hash, signup.pass_salt, db.n(signup.signed_up_at), now, u.id, target.id]);
      await db.recordEvent(target.id, "signup_linked", String(u.id));
      return send(res, 200, { ok: true, decision: "linked", patientId: target.id });
    }

    /* approve: he is real and there was no earlier record. Keep the row and
       put him on the deciding coordinator's panel so somebody owns him. */
    await db.q(`UPDATE patients SET account_status = 'active', approved_at = $1,
                  approved_by = $2, enrolled_at = COALESCE(enrolled_at, $1),
                  coordinator_id = COALESCE(coordinator_id, $2), updated_at = $1
                WHERE id = $3`, [now, u.id, signup.id]);
    await db.recordEvent(signup.id, "signup_approved", String(u.id));
    send(res, 200, { ok: true, decision: "approved", patientId: signup.id });
  },

  /* He forgot it and rang the clinic. Shown once, and he must replace it. */
  "POST /api/admin/patient-password": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    if (!await ownsPatient(u, b.id)) {
      return send(res, 403, { error: "That patient is on another coordinator's panel." });
    }
    const row = await db.one("SELECT id, email, pass_hash FROM patients WHERE id = $1", [b.id]);
    if (!row) return send(res, 404, { error: "No such patient." });
    if (!row.pass_hash) {
      return send(res, 400, { error: "This patient has not created an account yet." });
    }
    const pw = tempPassword();
    const h = db.hashPassword(pw);
    await db.q(`UPDATE patients SET pass_hash = $1, pass_salt = $2, must_change_password = 1,
                  failed_logins = 0, locked_until = NULL WHERE id = $3`, [h.hash, h.salt, b.id]);
    /* Signing every device out is the point: he may be ringing because he lost
       the phone the app was on. */
    await db.q("UPDATE patient_tokens SET revoked_at = $1 WHERE patient_id = $2 AND revoked_at IS NULL",
               [Date.now(), b.id]);
    send(res, 200, { ok: true, password: pw, email: row.email });
  },


  /* ---------------- looking into a patient's app ----------------

     Everything he sees, assembled by the same code that serves him. Read only:
     there is no way from here to record a check-in as him, mark his messages
     read, or send anything in his name. Opening it does not touch his record,
     so his "last seen" stays honest. */

  "GET /api/admin/patient-view": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const id = Number(url(req).searchParams.get("id"));
    if (!await ownsPatient(u, id)) {
      return send(res, 403, { error: "That patient is on another coordinator's panel." });
    }
    const p = await db.one("SELECT * FROM patients WHERE id = $1", [id]);
    if (!p) return send(res, 404, { error: "No such patient." });

    const home = await homePayload(p);
    const thread = await threadFor(p.id);
    const checkins = await db.q(
      "SELECT * FROM checkins WHERE patient_id = $1 ORDER BY at DESC LIMIT 30", [p.id]);
    const logs = await db.q(
      "SELECT * FROM logs WHERE patient_id = $1 ORDER BY at DESC LIMIT 30", [p.id]);
    checkins.forEach(function (r) { r.at = db.n(r.at); });
    logs.forEach(function (r) { r.at = db.n(r.at); });

    /* Whether he can actually open the app at all, which is the first thing a
       coordinator wants to know when he says he cannot see something. */
    const devices = await db.one(
      "SELECT COUNT(*)::int AS n FROM devices WHERE patient_id = $1 AND active = 1", [id]);
    const tokens = await db.one(
      "SELECT COUNT(*)::int AS n FROM patient_tokens WHERE patient_id = $1 AND revoked_at IS NULL", [id]);

    send(res, 200, {
      home: home,
      thread: thread,
      checkins: checkins,
      logs: logs,
      fields: db.CHECKIN_FIELDS,
      scaleMax: db.SCALE_MAX,
      access: {
        hasAccount: !!p.pass_hash,
        accountStatus: p.account_status || null,
        signedInDevices: tokens.n,
        notificationsOn: devices.n > 0,
        enrolledAt: db.n(p.enrolled_at),
        lastSeenAt: db.n(p.last_seen_at),
        email: p.email || null
      }
    });
  },


  /* ==========================================================================
     The free app  (/api/f/*)

     No account, no sign-in, no PHI. A phone generates a random key, keeps it,
     and sends it with every request. That key identifies a device so a reminder
     can reach it; it identifies nobody. Anyone can call these, which is fine,
     because the worst a stranger can do with someone else's key is change the
     time their own breakfast reminder fires.
     ========================================================================== */

  "POST /api/f/hello": async function (req, res) {
    const b = await readBody(req);
    const key = String(b.key || "").trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) return send(res, 400, { error: "bad key" });
    const now = Date.now();

    let row = await db.one("SELECT * FROM installs WHERE device_key = $1", [key]);
    if (!row) {
      row = await db.one(`INSERT INTO installs (device_key, goals, times, tz_offset, created_at, last_seen_at, opens)
                          VALUES ($1,'[]','{}',$2,$3,$3,1) RETURNING *`,
        [key, Number(b.tz) || 0, now]);
    } else {
      await db.q("UPDATE installs SET last_seen_at = $1, opens = opens + 1, tz_offset = $2 WHERE id = $3",
                 [now, Number(b.tz) || 0, row.id]);
    }

    const live = await db.one(
      "SELECT id, title, body, cta FROM specials WHERE live = 1 ORDER BY updated_at DESC NULLS LAST, id DESC");

    send(res, 200, {
      goals: JSON.parse(row.goals || "[]"),
      times: JSON.parse(row.times || "{}"),
      slots: db.DAILY_SLOTS.map(function (x) {
        return { key: x.key, goal: x.goal, label: x.label, def: x.def };
      }),
      special: live || null,
      textLine: db.TEXT_LINE,
      isNew: db.n(row.created_at) === now
    });
  },

  "POST /api/f/prefs": async function (req, res) {
    const b = await readBody(req);
    const row = await db.one("SELECT id FROM installs WHERE device_key = $1", [String(b.key || "")]);
    if (!row) return send(res, 404, { error: "unknown install" });
    const okGoals = ["eat", "train", "sleep", "water"];
    const goals = (Array.isArray(b.goals) ? b.goals : []).filter(function (g) { return okGoals.indexOf(g) !== -1; });
    const times = {};
    db.DAILY_SLOTS.forEach(function (sl) {
      const v = (b.times || {})[sl.key];
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ""))) times[sl.key] = v;
    });
    await db.q("UPDATE installs SET goals = $1, times = $2, tz_offset = $3, last_seen_at = $4 WHERE id = $5",
      [JSON.stringify(goals), JSON.stringify(times), Number(b.tz) || 0, Date.now(), row.id]);
    send(res, 200, { ok: true, goals: goals, times: times });
  },

  "GET /api/f/config": async function (req, res) {
    const v = await getVapid();
    send(res, 200, { vapidPublicKey: v.publicKey });
  },

  "POST /api/f/subscribe": async function (req, res) {
    const b = await readBody(req);
    const row = await db.one("SELECT id FROM installs WHERE device_key = $1", [String(b.key || "")]);
    if (!row) return send(res, 404, { error: "unknown install" });
    const sub = b.subscription || {};
    if (!sub.endpoint || !sub.keys) return send(res, 400, { error: "bad subscription" });
    await db.q(`INSERT INTO install_devices (install_id, endpoint, p256dh, auth, active, created_at)
                VALUES ($1,$2,$3,$4,1,$5)
                ON CONFLICT (endpoint) DO UPDATE SET install_id = EXCLUDED.install_id,
                  p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, active = 1`,
      [row.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now()]);
    send(res, 200, { ok: true });
  },

  /* The one moment anything personal is taken, and only because he typed it in
     to be contacted about something he tapped. */
  "POST /api/f/lead": async function (req, res) {
    const b = await readBody(req);
    const phone = String(b.phone || "").trim();
    const email = String(b.email || "").trim();
    if (db.phoneKey(phone).length < 10 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return send(res, 400, { error: "Give a mobile number or an email so we can reach you." });
    }
    const inst = await db.one("SELECT id FROM installs WHERE device_key = $1", [String(b.key || "")]);
    const now = Date.now();
    await db.q(`INSERT INTO leads (install_id, name, phone, email, about, note, status, at, updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,'new',$7,$7)`,
      [inst ? inst.id : null, String(b.name || "").trim().slice(0, 120), phone, email,
       String(b.about || "").slice(0, 120), String(b.note || "").slice(0, 600), now]);
    send(res, 200, { ok: true });
  },

  /* ---------------- the free app, clinic side ---------------- */

  "GET /api/admin/daily": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const now = Date.now(), DAY = db.DAY;
    const installs = await db.one("SELECT COUNT(*)::int AS n FROM installs");
    const active7 = await db.one("SELECT COUNT(*)::int AS n FROM installs WHERE last_seen_at > $1", [now - 7 * DAY]);
    const pushable = await db.one(
      "SELECT COUNT(DISTINCT install_id)::int AS n FROM install_devices WHERE active = 1");
    const leads = await db.q("SELECT * FROM leads ORDER BY (status = 'new') DESC, at DESC LIMIT 100");
    leads.forEach(function (r) { r.at = db.n(r.at); r.updated_at = db.n(r.updated_at); });
    const specials = await db.q("SELECT * FROM specials ORDER BY live DESC, id DESC LIMIT 30");
    specials.forEach(function (r) { r.pushed_at = db.n(r.pushed_at); });
    /* Reminders are only worth anything if the schedule is actually running.
       Show the last few runs and how far apart they were, so a stalled cron is
       visible here rather than discovered by a man who stopped being nudged. */
    const runs = await db.q(
      "SELECT at, result FROM cron_runs WHERE job = 'daily-reminders' ORDER BY at DESC LIMIT 12");
    runs.forEach(function (r) { r.at = db.n(r.at); });
    let gapMin = null;
    if (runs.length > 1) {
      const gaps = [];
      for (let i = 0; i < runs.length - 1; i++) gaps.push(runs[i].at - runs[i + 1].at);
      gaps.sort(function (a, b) { return a - b; });
      gapMin = Math.round(gaps[Math.floor(gaps.length / 2)] / 60000);
    }
    send(res, 200, {
      counts: { installs: installs.n, active7: active7.n, pushable: pushable.n,
                newLeads: leads.filter(function (l) { return l.status === "new"; }).length },
      leads: leads, specials: specials,
      cron: { lastRun: runs.length ? runs[0].at : null, runs: runs.length, everyMinutes: gapMin }
    });
  },

  "POST /api/admin/lead-status": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    const ok = ["new", "contacted", "booked", "closed"];
    if (ok.indexOf(b.status) === -1) return send(res, 400, { error: "Unknown status." });
    await db.q("UPDATE leads SET status = $1, claimed_by = $2, note = COALESCE($3, note), updated_at = $4 WHERE id = $5",
      [b.status, u.id, b.note === undefined ? null : String(b.note).slice(0, 600), Date.now(), b.id]);
    send(res, 200, { ok: true });
  },

  "POST /api/admin/special-save": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    if (!b.title || !b.body) return send(res, 400, { error: "A title and body are required." });
    const now = Date.now();
    if (b.id) {
      await db.q("UPDATE specials SET title=$1, body=$2, cta=$3, live=$4, updated_at=$5 WHERE id=$6",
        [b.title, b.body, b.cta || null, b.live ? 1 : 0, now, b.id]);
      /* Only one can be the live one, or the app has to guess. */
      if (b.live) await db.q("UPDATE specials SET live = 0 WHERE id <> $1", [b.id]);
      return send(res, 200, { id: Number(b.id) });
    }
    const row = await db.one(`INSERT INTO specials (title, body, cta, live, created_by, created_at, updated_at)
                              VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
      [b.title, b.body, b.cta || null, b.live ? 1 : 0, u.id, now]);
    if (b.live) await db.q("UPDATE specials SET live = 0 WHERE id <> $1", [row.id]);
    send(res, 200, { id: row.id });
  },

  /* Pushing a special is REACH: it lands on every phone that installed this.
     Rate-limited to once a day, because the fastest way to lose an audience is
     to notify it twice on a Tuesday. */
  "POST /api/admin/special-push": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    const sp = await db.one("SELECT * FROM specials WHERE id = $1", [b.id]);
    if (!sp) return send(res, 404, { error: "No such special." });

    const now = Date.now();
    const recent = await db.one(
      "SELECT MAX(pushed_at) AS t FROM specials WHERE pushed_at IS NOT NULL");
    const last = db.n(recent && recent.t);
    if (last && now - last < 20 * 3600 * 1000) {
      return send(res, 429, {
        error: "A special already went out in the last 20 hours. Two in a day is how people turn notifications off." });
    }

    const devices = await db.q("SELECT * FROM install_devices WHERE active = 1");
    const vapid = await getVapid();
    let sent = 0, failed = 0;
    for (const d of devices) {
      try {
        const r = await push.sendNotification(
          { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
          { title: sp.title, body: sp.body, tag: "hmh-special-" + sp.id, url: "/daily/?s=" + sp.id },
          vapid, { ttl: 86400 * 2, urgency: "normal" });
        if (r.ok) sent++; else { failed++; if (r.gone) await db.q("UPDATE install_devices SET active = 0 WHERE id = $1", [d.id]); }
      } catch (e) { failed++; }
    }
    await db.q("UPDATE specials SET pushed_at = $1, live = 1, updated_at = $1 WHERE id = $2", [now, sp.id]);
    await db.q("UPDATE specials SET live = 0 WHERE id <> $1", [sp.id]);
    send(res, 200, { sent: sent, failed: failed, of: devices.length });
  },

  /* ---------------- the free app's reminders ----------------

     Called on a schedule. Works out whose chosen time falls inside the window
     this run covers, and pushes once. reminder_log makes a second run in the
     same window a no-op, so the schedule can be as eager as it likes. */

  "GET /api/cron/daily-reminders": async function (req, res) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    if (!secret) return send(res, 503, { error: "CRON_SECRET is not configured." });
    if (auth !== "Bearer " + secret) return send(res, 401, { error: "Not authorized." });

    const now = Date.now();
    const windowMin = Number(url(req).searchParams.get("window")) || 20;
    const rows = await db.q(`
      SELECT i.* FROM installs i
       WHERE EXISTS (SELECT 1 FROM install_devices d WHERE d.install_id = i.id AND d.active = 1)`);

    const vapid = await getVapid();
    let sent = 0, skipped = 0, failed = 0;

    for (const inst of rows) {
      let goals = [], times = {};
      try { goals = JSON.parse(inst.goals || "[]"); } catch (e) {}
      try { times = JSON.parse(inst.times || "{}"); } catch (e) {}
      const hm = db.localHM(now, inst.tz_offset);
      const day = db.dayKey(now, inst.tz_offset);

      for (const slot of db.slotsForGoals(goals)) {
        const at = times[slot.key] || slot.def;
        if (!db.slotIsDue(at, hm, windowMin)) continue;

        const already = await db.one(
          "SELECT 1 AS x FROM reminder_log WHERE install_id = $1 AND slot = $2 AND day = $3",
          [inst.id, slot.key, day]);
        if (already) { skipped++; continue; }
        await db.q("INSERT INTO reminder_log (install_id, slot, day, at) VALUES ($1,$2,$3,$4)",
                   [inst.id, slot.key, day, now]);

        const devices = await db.q(
          "SELECT * FROM install_devices WHERE install_id = $1 AND active = 1", [inst.id]);
        for (const d of devices) {
          try {
            const copy = voice.freeMessage(slot.key, day, inst.device_key);
            const r = await push.sendNotification(
              { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
              { title: copy.title, body: copy.body, tag: "hmh-" + slot.key, url: "/daily/" },
              vapid, { ttl: 3600 * 6, urgency: "normal" });
            if (r.ok) sent++; else { failed++; if (r.gone) await db.q("UPDATE install_devices SET active = 0 WHERE id = $1", [d.id]); }
          } catch (e) { failed++; }
        }
      }
    }
    const out = { installs: rows.length, sent: sent, skipped: skipped, failed: failed, window: windowMin };
    await db.q("INSERT INTO cron_runs (job, at, ms, result) VALUES ($1,$2,$3,$4)",
               ["daily-reminders", now, Date.now() - now, JSON.stringify(out)]);
    send(res, 200, out);
  },


  /* ---------------- what a patient's phone says ----------------

     Shot day, labs, running low, renewal. Everything the clinic would ring
     about if it had the hours, said once, at a civilised time.

     Each patient carries a small map of slot -> day, so a nudge fires once
     however often this runs, and so a man is never told two things at once:
     the first thing that applies wins and the rest wait for tomorrow. Being
     nagged four times before breakfast is how notifications get switched off.  */

  "GET /api/cron/patient-nudges": async function (req, res) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    if (!secret) return send(res, 503, { error: "CRON_SECRET is not configured." });
    if (auth !== "Bearer " + secret) return send(res, 401, { error: "Not authorized." });

    const now = Date.now();
    const DAY = db.DAY;
    const rows = await db.q(`
      SELECT p.* FROM patients p
       WHERE p.status = 'active'
         AND COALESCE(p.account_status,'') <> 'pending'
         AND EXISTS (SELECT 1 FROM devices d WHERE d.patient_id = p.id AND d.active = 1)`);

    const vapid = await getVapid();
    let sent = 0, considered = 0, quiet = 0;

    for (const p of rows) {
      const off = 300;                       /* the clinic's metro, one timezone */
      const hm = db.localHM(now, off);
      const day = db.dayKey(now, off);
      /* One window a day, late morning. Nobody wants a nudge at 4am. */
      if (!db.slotIsDue("10:00", hm, 60)) continue;
      considered++;

      let fired = {};
      try { fired = JSON.parse(p.last_nudge || "{}"); } catch (e) {}

      /* Ordered by what ignoring it actually costs. The things that STOP
         treatment outright come before the things that merely degrade it: a
         missed renewal ends the plan, overdue labs only mean the dose is
         guesswork for another week. */
      const supply = db.supplyLeft(p, now);
      const labs = db.labStatus(p, now);
      const renewAt = db.renewalDate(p);
      const renewIn = renewAt == null ? null : db.daysBetween(renewAt, now);
      const dow = new Date(now - off * 60000).getUTCDay();
      const shotDay = p.shot_day === null || p.shot_day === undefined ? null : Number(p.shot_day);

      const candidates = [];
      /* today only, and the whole point of the app */
      if (shotDay !== null && dow === shotDay) candidates.push("shot_today");
      if (shotDay !== null && dow === (shotDay + 6) % 7) candidates.push("shot_tomorrow");
      /* treatment stops */
      if (supply !== null && supply <= 0) candidates.push("supply_out");
      if (renewIn !== null && renewIn <= 7 && renewIn >= 0) candidates.push("renewal_now");
      /* treatment degrades */
      if (supply !== null && supply > 0 && supply <= 7) candidates.push("supply_low");
      /* Nothing records that a draw actually happened, so a lab date that has
         passed stays "overdue" for ever and the app would nag about it until
         the man turns notifications off. A visit logged since the date is the
         best evidence available that he came in, so treat it as done. */
      const visitAt = db.n(p.last_visit_at);
      const labDue = labs && labs.previous ? labs.previous.at : null;
      const labSeen = labDue !== null && visitAt && visitAt >= labDue;
      if (!labSeen && labs && labs.previous && labs.previous.daysAgo > 14) candidates.push("labs_overdue");
      else if (!labSeen && labs && labs.previous && labs.previous.daysAgo >= 0) candidates.push("labs_due");
      /* worth knowing, not urgent */
      if (renewIn !== null && renewIn <= 30 && renewIn > 7) candidates.push("renewal_soon");

      const slot = candidates.filter(function (k) { return fired[k] !== day; })[0];
      if (!slot) { quiet++; continue; }

      const copy = voice.patientMessage(slot, day, String(p.id));
      if (!copy) continue;

      const r = await pushToPatient(p.id, {
        title: copy.title, body: copy.body, tag: "hmh-" + slot, url: "/app/"
      });
      if (r.sent) sent++;
      fired[slot] = day;
      await db.q("UPDATE patients SET last_nudge = $1 WHERE id = $2",
                 [JSON.stringify(fired), p.id]);
    }

    const out = { patients: rows.length, considered: considered, sent: sent, nothingToSay: quiet };
    await db.q("INSERT INTO cron_runs (job, at, ms, result) VALUES ($1,$2,$3,$4)",
               ["patient-nudges", now, Date.now() - now, JSON.stringify(out)]);
    send(res, 200, out);
  },

  /* ---------------- the evening nudge ----------------

     A daily habit that nobody prompts lasts about a week. Vercel calls this
     once a night; it pushes only to men who have a device, have not opted out,
     and have not already recorded today.

     The notification text carries nothing clinical. A lock screen is not a
     private place, and "time for your check-in" is as far as this goes. */

  "GET /api/cron/checkin-reminder": async function (req, res) {
    /* Vercel signs its cron calls with this header. Without the secret set the
       route refuses outright rather than running open to the internet. */
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization || "";
    if (!secret) return send(res, 503, { error: "CRON_SECRET is not configured." });
    if (auth !== "Bearer " + secret) return send(res, 401, { error: "Not authorized." });

    const now = Date.now();
    /* Everything here is in one metro, so the clinic's own day is the right
       day. Computed through Intl so daylight saving is handled for us. */
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date(now));

    const due = await db.q(`
      SELECT p.id, p.first_name
        FROM patients p
       WHERE p.status = 'active'
         AND p.enrolled_at IS NOT NULL
         AND COALESCE(p.checkin_reminders, 1) = 1
         AND COALESCE(p.reminded_on, '') <> $1
         AND EXISTS (SELECT 1 FROM devices d WHERE d.patient_id = p.id AND d.active = 1)
         AND NOT EXISTS (SELECT 1 FROM checkins c WHERE c.patient_id = p.id AND c.day = $1)`,
      [day]);

    let sent = 0, failed = 0;
    for (const p of due) {
      const copy = voice.patientMessage("checkin", day, String(p.id));
      const r = await pushToPatient(p.id, {
        title: copy.title, body: copy.body,
        tag: "hmh-checkin-" + day, url: "/app/?screen=you"
      });
      if (r.sent) sent++; else failed++;
      /* Stamped whether or not the push landed, so a man with a dead
         subscription is not retried all night. */
      await db.q("UPDATE patients SET reminded_on = $1 WHERE id = $2", [day, p.id]);
    }
    const out = { day: day, due: due.length, sent: sent, failed: failed };
    await db.q("INSERT INTO cron_runs (job, at, ms, result) VALUES ($1,$2,$3,$4)",
               ["checkin-reminder", now, Date.now() - now, JSON.stringify(out)]);
    send(res, 200, out);
  },

  /* Who was removed, by whom, and when. Admin only: it is the one record that
     outlives a patient and it should not be quietly editable or browsable by
     everyone. */
  "GET /api/admin/deletions": async function (req, res) {
    const u = await requireAdmin(req, res); if (!u) return;
    const rows = await db.q("SELECT * FROM deletions ORDER BY at DESC LIMIT 200");
    rows.forEach(function (r) { r.at = db.n(r.at); });
    send(res, 200, { deletions: rows });
  },

  /* ---------------- articles ---------------- */

  "GET /api/admin/articles": async function (req, res) {
    if (!await requireCoordinator(req, res)) return;
    send(res, 200, { articles: await db.q("SELECT * FROM articles ORDER BY updated_at DESC") });
  },

  "POST /api/admin/article-save": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    if (!b.title || !b.body) return send(res, 400, { error: "A title and body are required." });
    const now = Date.now();
    if (b.id) {
      await db.q(`UPDATE articles SET title=$1, summary=$2, body=$3, category=$4,
                  published=$5, citations=$6, topics=$7, updated_at=$8 WHERE id=$9`,
        [b.title, b.summary || null, b.body, b.category || null, b.published ? 1 : 0,
         b.citations || null, b.topics || null, now, b.id]);
      return send(res, 200, { id: b.id });
    }
    let slug = slugify(b.title), n = 1;
    while (await db.one("SELECT 1 FROM articles WHERE slug = $1", [slug])) {
      slug = slugify(b.title) + "-" + (++n);
    }
    const row = await db.one(`
      INSERT INTO articles (title, slug, summary, body, category, published, author_id,
                            created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [b.title, slug, b.summary || null, b.body, b.category || null,
       b.published ? 1 : 0, u.id, now, now]);
    send(res, 200, { id: row.id, slug: slug });
  },

  "POST /api/admin/article-delete": async function (req, res) {
    if (!await requireCoordinator(req, res)) return;
    const b = await readBody(req);
    await db.q("DELETE FROM articles WHERE id = $1", [b.id]);
    send(res, 200, { ok: true });
  },

  /* ---------------- messages ---------------- */

  "GET /api/admin/messages": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    /* An admin sees every send; a coordinator sees their own. Broadcast copy
       is not private, but who sent what to whom is a management view. */
    const scoped = u.role === "admin" ? "" : " WHERE m.created_by = " + Number(u.id);
    send(res, 200, { messages: await db.q(`
      SELECT m.*,
             (SELECT COUNT(*) FROM message_targets t WHERE t.message_id = m.id) AS targets,
             (SELECT COUNT(*) FROM message_targets t WHERE t.message_id = m.id AND t.read_at IS NOT NULL) AS reads
        FROM messages m` + scoped + ` ORDER BY m.created_at DESC LIMIT 100`) });
  },

  "POST /api/admin/message-send": async function (req, res) {
    const u = await requireCoordinator(req, res); if (!u) return;
    const b = await readBody(req);
    if (!b.title || !b.body) return send(res, 400, { error: "A title and body are required." });

    const kind = ["treatment", "refill", "marketing"].indexOf(b.kind) === -1 ? "treatment" : b.kind;

    /* "Everyone" means everyone on YOUR panel unless you are an admin. A
       coordinator broadcasting to the whole clinic by accident is exactly the
       failure a hundred-coordinator deployment cannot afford. */
    const scope = panelScope(u, b.panel);
    let ids = [];
    if (b.audience === "all") {
      ids = (await db.q("SELECT id FROM patients WHERE status = 'active'"
              + scope.sql.replace(" WHERE ", " AND "), scope.vals)).map(function (r) { return r.id; });
    } else if (b.audience === "flagged") {
      ids = (await db.retentionBoard(null, scope)).filter(function (p) { return p.level !== "ok"; })
              .map(function (p) { return p.id; });
    } else {
      ids = (b.patientIds || []).map(Number).filter(Boolean);
      if (u.role !== "admin" && ids.length) {
        const mine = await db.q("SELECT id FROM patients WHERE coordinator_id = $1", [u.id]);
        const ok = new Set(mine.map(function (r) { return Number(r.id); }));
        const blocked = ids.filter(function (i) { return !ok.has(Number(i)); });
        if (blocked.length) {
          return send(res, 403, { error: "That list includes patients on another coordinator's panel." });
        }
      }
    }
    if (!ids.length) return send(res, 400, { error: "No recipients matched." });

    const now = Date.now();
    const msg = await db.one(`
      INSERT INTO messages (title, body, article_id, kind, audience, created_by,
                            created_at, sent_at, direction, reply_to)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'out',$9) RETURNING id`,
      [b.title, b.body, b.article_id || null, kind, b.audience || "one", u.id, now, now,
       b.reply_to || null]);
    const messageId = msg.id;

    for (const pid of ids) {
      await db.q("INSERT INTO message_targets (message_id, patient_id) VALUES ($1,$2)",
                 [messageId, pid]);
    }

    // Deliver. A patient with no device still gets the message in their inbox.
    const payload = notificationPayload({ id: messageId, kind: kind });
    let pushed = 0, noDevice = 0;
    for (const pid of ids) {
      const r = await pushToPatient(pid, payload);
      if (r.noDevice) noDevice++; else if (r.sent) pushed++;
      await db.q(`UPDATE message_targets SET pushed_at = $1, push_status = $2
                  WHERE message_id = $3 AND patient_id = $4`,
        [now, r.noDevice ? "no-device" : (r.sent ? "sent" : "failed"), messageId, pid]);
    }
    send(res, 200, { id: messageId, recipients: ids.length, pushed: pushed, noDevice: noDevice });
  },

  /* ==========================================================================
     Patient API
     ========================================================================== */

  "GET /api/p/config": async function (req, res) {
    const v = await getVapid();
    send(res, 200, { vapidPublicKey: v.publicKey });
  },

  /* Exchange the single-use setup link for a durable, revocable device token. */
  "POST /api/p/enroll": async function (req, res) {
    const b = await readBody(req);
    const row = await db.one("SELECT * FROM enroll_tokens WHERE token = $1", [b.token || ""]);
    if (!row) return send(res, 404, { error: "That setup link is not valid." });
    const now = Date.now();
    if (Number(row.expires_at) < now) {
      return send(res, 410, { error: "That setup link has expired. Ask the clinic for a new one." });
    }
    if (row.used_at) {
      return send(res, 409, { error: "That setup link has already been used. Ask the clinic for a new one." });
    }
    await db.q("UPDATE enroll_tokens SET used_at = $1 WHERE token = $2", [now, row.token]);

    const deviceToken = crypto.randomBytes(32).toString("base64url");
    await db.q(`INSERT INTO patient_tokens (token, patient_id, created_at, last_used_at)
                VALUES ($1,$2,$3,$4)`, [deviceToken, row.patient_id, now, now]);
    await db.q(`UPDATE patients SET enrolled_at = COALESCE(enrolled_at, $1), last_seen_at = $2
                WHERE id = $3`, [now, now, row.patient_id]);
    const p = await db.one("SELECT first_name FROM patients WHERE id = $1", [row.patient_id]);
    send(res, 200, { token: deviceToken, firstName: p.first_name });
  },

  /* Redeem the short code the coordinator read out. Same single-use rules as
     the link; this just makes it typeable in the room. */
  "POST /api/p/enroll-code": async function (req, res) {
    const b = await readBody(req);
    const raw = String(b.code || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (raw.length !== 6) return send(res, 400, { error: "That code should be six characters." });

    const now = Date.now();
    const row = await db.one(
      "SELECT * FROM enroll_tokens WHERE code = $1 AND used_at IS NULL AND expires_at > $2",
      [raw, now]);
    if (!row) return send(res, 404, { error: "That code is not valid, or it has already been used." });

    await db.q("UPDATE enroll_tokens SET used_at = $1 WHERE token = $2", [now, row.token]);
    const deviceToken = crypto.randomBytes(32).toString("base64url");
    await db.q(`INSERT INTO patient_tokens (token, patient_id, created_at, last_used_at)
                VALUES ($1,$2,$3,$4)`, [deviceToken, row.patient_id, now, now]);
    await db.q(`UPDATE patients SET enrolled_at = COALESCE(enrolled_at, $1), last_seen_at = $2
                WHERE id = $3`, [now, now, row.patient_id]);
    const p = await db.one("SELECT first_name FROM patients WHERE id = $1", [row.patient_id]);
    send(res, 200, { token: deviceToken, firstName: p.first_name });
  },

  "GET /api/p/home": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    await db.recordEvent(p.id, "open");
    send(res, 200, await homePayload(p));
  },

  "GET /api/p/messages": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    send(res, 200, { messages: await threadFor(p.id) });
  },

  "POST /api/p/message-read": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    await db.q(`UPDATE message_targets SET read_at = $1
                WHERE patient_id = $2 AND message_id = $3 AND read_at IS NULL`,
      [Date.now(), p.id, b.id]);
    await db.recordEvent(p.id, "message_read", String(b.id));
    send(res, 200, { ok: true });
  },

  /* The direct line: a patient question lands in the coordinator inbox. */
  "POST /api/p/ask": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    const body = String(b.body || "").trim();
    if (!body) return send(res, 400, { error: "Write your question first." });
    if (body.length > 4000) return send(res, 400, { error: "That message is too long." });

    const now = Date.now();
    const row = await db.one(`
      INSERT INTO messages (title, body, kind, audience, direction, from_patient_id,
                            created_at, sent_at)
      VALUES ($1,$2,'treatment','one','in',$3,$4,$5) RETURNING id`,
      ["Question from " + p.first_name + " " + p.last_name, body, p.id, now, now]);
    await db.recordEvent(p.id, "asked", String(row.id));
    send(res, 200, { id: row.id });
  },

  "GET /api/p/articles": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const rows = await db.q(`
      SELECT id, title, slug, summary, category, updated_at
        FROM articles WHERE published = 1 ORDER BY updated_at DESC`);
    rows.forEach(function (r) { r.updated_at = db.n(r.updated_at); });
    send(res, 200, { articles: rows });
  },

  "POST /api/p/article": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    const a = await db.one("SELECT * FROM articles WHERE id = $1 AND published = 1", [b.id]);
    if (!a) return send(res, 404, { error: "That article is no longer available." });
    await db.recordEvent(p.id, "article_read", String(a.id));
    send(res, 200, { article: a });
  },

  /* ---------------- PubMed ----------------
     Proxied through the server so the browser never talks to NCBI directly:
     keeps the patient's search terms off a third party's logs with their IP,
     and avoids CORS. NCBI asks callers to identify themselves via tool/email. */

  "POST /api/p/studies": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    const term = String(b.q || "").trim().slice(0, 200);
    if (!term) return send(res, 400, { error: "Type something to search for." });

    const ident = "tool=heartland-patient-app&email=" +
      encodeURIComponent(process.env.HMH_NCBI_EMAIL || "care@heartlandmenshealth.com");
    const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";

    try {
      const searchUrl = base + "esearch.fcgi?db=pubmed&retmode=json&retmax=20&sort=relevance&" +
        ident + "&term=" + encodeURIComponent(term);
      const sr = await fetch(searchUrl, { signal: AbortSignal.timeout(9000) });
      if (!sr.ok) throw new Error("search " + sr.status);
      const sj = await sr.json();
      const ids = (sj.esearchresult && sj.esearchresult.idlist) || [];
      if (!ids.length) return send(res, 200, { studies: [], total: 0 });

      const sumUrl = base + "esummary.fcgi?db=pubmed&retmode=json&" + ident +
        "&id=" + ids.join(",");
      const ur = await fetch(sumUrl, { signal: AbortSignal.timeout(9000) });
      if (!ur.ok) throw new Error("summary " + ur.status);
      const uj = await ur.json();
      const r = uj.result || {};

      const studies = ids.map(function (id) {
        const d = r[id];
        if (!d) return null;
        const authors = (d.authors || []).map(function (a) { return a.name; });
        return {
          pmid: id,
          title: d.title || "Untitled",
          journal: d.fulljournalname || d.source || "",
          year: (d.pubdate || "").slice(0, 4),
          authors: authors.length > 3 ? authors.slice(0, 3).join(", ") + " et al." : authors.join(", "),
          url: "https://pubmed.ncbi.nlm.nih.gov/" + id + "/"
        };
      }).filter(Boolean);

      await db.recordEvent(p.id, "studies_search", term.slice(0, 80));
      send(res, 200, { studies: studies, total: Number(sj.esearchresult.count || studies.length) });
    } catch (e) {
      console.warn("pubmed", e.message);
      send(res, 502, { error: "PubMed is not responding right now. Try again in a moment." });
    }
  },


  /* ---------------- how he is doing ----------------
     The check-in, the meal and training log, and his own trend. */

  "GET /api/p/checkin": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const off = Number(url(req).searchParams.get("tz") || 0);
    const today = db.dayKey(Date.now(), off);
    const rows = await db.q(
      "SELECT * FROM checkins WHERE patient_id = $1 ORDER BY at DESC LIMIT 30", [p.id]);
    const logs = await db.q(
      "SELECT * FROM logs WHERE patient_id = $1 ORDER BY at DESC LIMIT 40", [p.id]);
    rows.forEach(function (r) { r.at = db.n(r.at); });
    logs.forEach(function (r) { r.at = db.n(r.at); });
    /* What he is struggling with, and something worth reading about it. The
       app never has to guess which article is relevant: the article carries
       the topic and the check-in field names it. */
    const latest = rows[0] || null;
    const low = latest ? db.lowFields(latest, 4) : [];
    let reading = [];
    if (low.length) {
      const wanted = low.map(function (f) { return f.topic; });
      const arts = await db.q(
        "SELECT id, title, slug, summary, topics FROM articles WHERE published = 1");
      /* The FIRST topic on an article is what it is primarily about; the rest
         are things it also touches. Rank on that, or a man who says his
         strength is 3 gets handed the GLP-1 article because it happens to
         mention muscle. Never point at the same article twice. */
      const rank = function (a, topic) {
        let t = [];
        try { t = JSON.parse(a.topics || "[]"); } catch (e) { return -1; }
        const i = t.indexOf(topic);
        return i === -1 ? -1 : (i === 0 ? 2 : 1);
      };
      const used = {};
      reading = wanted.map(function (topic) {
        const hit = arts
          .map(function (a) { return { a: a, r: rank(a, topic) }; })
          .filter(function (x) { return x.r > 0 && !used[x.a.id]; })
          .sort(function (x, y) { return y.r - x.r; })[0];
        if (!hit) return null;
        used[hit.a.id] = true;
        const f = low.filter(function (x) { return x.topic === topic; })[0];
        return { topic: topic, label: f.label, value: f.value,
                 id: hit.a.id, title: hit.a.title, summary: hit.a.summary };
      }).filter(Boolean).slice(0, 3);
    }

    send(res, 200, {
      today: rows.filter(function (r) { return r.day === today; })[0] || null,
      history: rows,
      trend: db.checkinTrend(rows),
      logs: logs,
      fields: db.CHECKIN_FIELDS,
      scaleMax: db.SCALE_MAX,
      reminders: Number(p.checkin_reminders) === 0 ? 0 : 1,
      low: low,
      reading: reading,
      symptoms: db.SYMPTOMS,
      /* Whatever else happens, these are always on the screen. */
      help: {
        crisis: { label: "Suicide and Crisis Lifeline", value: "988",
                  note: "Call or text, any hour" },
        emergency: { label: "Emergency", value: "911" },
        priapism: { label: "Erection lasting 4 hours or more", value: "844-981-4996" }
      }
    });
  },

  "POST /api/p/checkin": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    const off = Number(b.tz || 0);
    const now = Date.now();
    const day = db.dayKey(now, off);

    const clamp = function (v) {
      const x = Math.round(Number(v));
      return x >= 1 && x <= db.SCALE_MAX ? x : null;
    };
    const known = db.SYMPTOMS.map(function (x) { return x.key; });
    const ticked = (Array.isArray(b.symptoms) ? b.symptoms : [])
      .filter(function (k) { return known.indexOf(k) !== -1; });
    const note = String(b.note || "").slice(0, 4000);

    const entry = { symptoms: ticked, note: note };
    db.FIELD_KEYS.forEach(function (k) { entry[k] = clamp(b[k]); });
    const answered = db.FIELD_KEYS.some(function (k) { return entry[k] !== null; });
    if (!answered && !ticked.length && !note) {
      return send(res, 400, { error: "Nothing to record yet." });
    }

    const recent = await db.q(
      "SELECT level FROM checkins WHERE patient_id = $1 AND day <> $2 ORDER BY at DESC LIMIT 2",
      [p.id, day]);
    const g = db.gradeCheckin(entry, recent);

    /* What was already logged today, so editing an entry does not send the
       coordinator the same alert again. */
    const before = await db.one(
      "SELECT level, note FROM checkins WHERE patient_id = $1 AND day = $2", [p.id, day]);

    const row = await db.one(`
      INSERT INTO checkins (patient_id, at, day, energy, mood, sleep, libido,
                            strength, cognitive, symptoms, note, score, level,
                            reasons, scale_max)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      ON CONFLICT (patient_id, day) DO UPDATE SET
        at = EXCLUDED.at, energy = EXCLUDED.energy, mood = EXCLUDED.mood,
        sleep = EXCLUDED.sleep, libido = EXCLUDED.libido,
        strength = EXCLUDED.strength, cognitive = EXCLUDED.cognitive,
        symptoms = EXCLUDED.symptoms, note = EXCLUDED.note,
        score = EXCLUDED.score, level = EXCLUDED.level, reasons = EXCLUDED.reasons,
        scale_max = EXCLUDED.scale_max, seen_at = NULL, seen_by = NULL
      RETURNING id`,
      [p.id, now, day, entry.energy, entry.mood, entry.sleep, entry.libido,
       entry.strength, entry.cognitive,
       JSON.stringify(ticked), note, g.score, g.level, JSON.stringify(g.reasons),
       db.SCALE_MAX]);

    await db.recordEvent(p.id, "checkin", g.level);

    /* A rough or urgent day reaches the coordinator as a question in their
       inbox, carrying his words unaltered. Nothing is summarised, because a
       paraphrase is exactly where the signal would get lost. */
    /* Notify on the first flag of the day, when it gets WORSE, or when he has
       written something different. Re-saving the same rough day should not
       land in the inbox five times: an alert that cries wolf gets ignored,
       and this one cannot afford to be. */
    const RANK = { ok: 0, rough: 1, urgent: 2 };
    const worse = !before || RANK[g.level] > RANK[before.level || "ok"];
    const changed = before && String(before.note || "") !== note;
    if (g.level !== "ok" && (worse || changed)) {
      const lines = [];
      lines.push("Daily check-in \u2014 " + (g.level === "urgent" ? "NEEDS ATTENTION" : "rough day"));
      const nums = db.CHECKIN_FIELDS.map(function (f) {
        return entry[f.key] === null ? null
             : f.label + " " + entry[f.key] + "/" + db.SCALE_MAX;
      }).filter(Boolean).join("  \u00b7  ");
      if (nums) lines.push(nums);
      if (g.reasons.length) lines.push("Flagged: " + g.reasons.join("; "));
      if (note) lines.push("\nHis words: \u201c" + note + "\u201d");

      const msg = await db.one(`
        INSERT INTO messages (title, body, kind, audience, created_at, sent_at,
                              direction, from_patient_id)
        VALUES ($1,$2,'treatment','one',$3,$3,'in',$4) RETURNING id`,
        ["Check-in from " + p.first_name + " " + p.last_name +
          (g.level === "urgent" ? " \u2014 needs attention" : ""),
         lines.join("\n"), now, p.id]);
      await db.recordEvent(p.id, "checkin_flagged", String(msg.id));
    }

    send(res, 200, {
      id: row.id, level: g.level, score: g.score, reasons: g.reasons,
      low: db.lowFields(entry, 4),
      /* What he must see NOW, on his own screen, without waiting for anyone. */
      urgent: g.red.map(function (x) { return { label: x.label, advice: x.advice }; }),
      crisisText: db.textFlagsCrisis(note)
    });
  },

  "POST /api/p/log": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    const kind = b.kind === "training" ? "training" : "meal";
    const body = String(b.body || "").trim().slice(0, 600);
    if (!body) return send(res, 400, { error: "Say what it was." });
    const now = Number(b.at) || Date.now();
    const detail = {};
    if (kind === "meal") {
      if (b.portion) detail.portion = String(b.portion).slice(0, 40);
      if (b.sat) detail.sat = String(b.sat).slice(0, 40);
    } else {
      if (b.minutes) detail.minutes = Math.max(0, Math.min(600, Math.round(Number(b.minutes)) || 0));
      if (b.intensity) detail.intensity = String(b.intensity).slice(0, 40);
    }
    const row = await db.one(`
      INSERT INTO logs (patient_id, at, day, kind, body, detail)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [p.id, now, db.dayKey(now, Number(b.tz || 0)), kind, body, JSON.stringify(detail)]);
    await db.recordEvent(p.id, "log_" + kind, String(row.id));
    send(res, 200, { id: row.id });
  },


  /* ---------------- signing up and signing in ----------------

     He creates the account. He picks the password. Nothing is texted to him
     and there is nothing for a coordinator to read out.

     What he cannot do is see anything until the clinic knows who he is. */

  "POST /api/p/register": async function (req, res) {
    const b = await readBody(req);
    const first = String(b.first_name || "").trim();
    const last = String(b.last_name || "").trim();
    const email = String(b.email || "").toLowerCase().trim();
    const phone = String(b.phone || "").trim();
    const dob = Number(b.date_of_birth) || null;
    const password = String(b.password || "");

    if (!first || !last) return send(res, 400, { error: "Please give your first and last name." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return send(res, 400, { error: "That does not look like an email address." });
    }
    if (db.phoneKey(phone).length < 10) {
      return send(res, 400, { error: "Please give a 10-digit mobile number." });
    }
    if (!dob) return send(res, 400, { error: "Please give your date of birth." });
    if (password.length < 8) {
      return send(res, 400, { error: "Your password needs at least 8 characters." });
    }

    /* Same message whichever it is, so this cannot be used to find out who
       already has an account here. */
    const taken = await db.one(
      "SELECT id FROM patients WHERE lower(email) = $1 AND pass_hash IS NOT NULL", [email]);
    if (taken) {
      return send(res, 409, { error: "There is already an account for that email. Try signing in instead." });
    }

    const now = Date.now();
    const h = db.hashPassword(password);
    const claim = { last_name: last, date_of_birth: dob, phone: phone };

    /* Does he match a record the clinic already typed, that nobody has
       claimed? Last name, date of birth and phone must ALL agree. */
    const candidates = await db.q(
      "SELECT * FROM patients WHERE pass_hash IS NULL AND lower(last_name) = $1",
      [last.toLowerCase()]);
    const hit = candidates.filter(function (c) { return db.samePatient(c, claim); })[0];

    let id, status;
    if (hit) {
      status = "active";
      id = hit.id;
      await db.q(`UPDATE patients SET first_name = $1, email = $2, pass_hash = $3, pass_salt = $4,
                    account_status = 'active', signed_up_at = $5, approved_at = $5,
                    enrolled_at = COALESCE(enrolled_at, $5), last_seen_at = $5, updated_at = $5
                  WHERE id = $6`,
        [first, email, h.hash, h.salt, now, id]);
    } else {
      status = "pending";
      const row = await db.one(`
        INSERT INTO patients (first_name, last_name, email, phone, date_of_birth,
                              status, pass_hash, pass_salt, account_status,
                              signed_up_at, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,'active',$6,$7,'pending',$8,$8,$8) RETURNING id`,
        [first, last, email, phone, dob, h.hash, h.salt, now]);
      id = row.id;
    }

    const token = crypto.randomBytes(32).toString("base64url");
    await db.q(`INSERT INTO patient_tokens (token, patient_id, created_at, last_used_at)
                VALUES ($1,$2,$3,$3)`, [token, id, now]);
    await db.recordEvent(id, "signed_up", status);
    send(res, 200, { token: token, firstName: first, status: status });
  },

  "POST /api/p/login": async function (req, res) {
    const b = await readBody(req);
    const email = String(b.email || "").toLowerCase().trim();
    const password = String(b.password || "");
    const now = Date.now();

    const row = await db.one(
      "SELECT * FROM patients WHERE lower(email) = $1 AND pass_hash IS NOT NULL", [email]);
    /* Identical response whether the address is unknown or the password is
       wrong. Anything else tells a stranger which of your patients is here. */
    const nope = function () {
      return send(res, 401, { error: "That email and password do not match." });
    };
    if (!row) return nope();

    const until = db.lockState(row, now);
    if (until) {
      return send(res, 429, {
        error: "Too many tries. Try again in " +
               Math.ceil((until - now) / 60000) + " minutes, or call the clinic." });
    }

    if (!db.verifyPassword(password, row.pass_hash, row.pass_salt)) {
      const fails = Number(row.failed_logins || 0) + 1;
      await db.q("UPDATE patients SET failed_logins = $1, locked_until = $2 WHERE id = $3",
        [fails, fails >= db.LOCK_AFTER ? now + db.LOCK_MS : null, row.id]);
      return nope();
    }

    await db.q(`UPDATE patients SET failed_logins = 0, locked_until = NULL, last_seen_at = $1
                WHERE id = $2`, [now, row.id]);
    const token = crypto.randomBytes(32).toString("base64url");
    await db.q(`INSERT INTO patient_tokens (token, patient_id, created_at, last_used_at)
                VALUES ($1,$2,$3,$3)`, [token, row.id, now]);
    send(res, 200, {
      token: token, firstName: row.first_name,
      status: row.account_status || "active",
      mustChangePassword: Number(row.must_change_password) === 1
    });
  },

  /* Where a pending account lands. Deliberately says nothing about anybody. */
  "GET /api/p/status": async function (req, res) {
    const row = await patientFromToken(req);
    if (!row) return send(res, 401, { error: "Not signed in." });
    send(res, 200, {
      firstName: row.first_name,
      status: row.account_status || "active",
      mustChangePassword: Number(row.must_change_password) === 1,
      textLine: db.TEXT_LINE
    });
  },

  "POST /api/p/password": async function (req, res) {
    const row = await patientFromToken(req);
    if (!row) return send(res, 401, { error: "Not signed in." });
    const b = await readBody(req);
    const next = String(b.next || "");
    /* A man on a temporary password the clinic read to him is allowed to
       replace it without repeating it back. Everyone else proves the old one. */
    if (Number(row.must_change_password) !== 1) {
      if (!db.verifyPassword(String(b.current || ""), row.pass_hash, row.pass_salt)) {
        return send(res, 403, { error: "That is not your current password." });
      }
    }
    if (next.length < 8) return send(res, 400, { error: "Use at least 8 characters." });
    const h = db.hashPassword(next);
    await db.q(`UPDATE patients SET pass_hash = $1, pass_salt = $2, must_change_password = 0,
                  failed_logins = 0, locked_until = NULL WHERE id = $3`,
      [h.hash, h.salt, row.id]);
    send(res, 200, { ok: true });
  },

  "POST /api/p/reminders": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    await db.q("UPDATE patients SET checkin_reminders = $1 WHERE id = $2",
               [b.on ? 1 : 0, p.id]);
    send(res, 200, { ok: true, on: b.on ? 1 : 0 });
  },

  "POST /api/p/log-delete": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    await db.q("DELETE FROM logs WHERE id = $1 AND patient_id = $2", [b.id, p.id]);
    send(res, 200, { ok: true });
  },

  "POST /api/p/subscribe": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    if (!b.endpoint || !b.keys || !b.keys.p256dh || !b.keys.auth) {
      return send(res, 400, { error: "Incomplete subscription." });
    }
    await db.q(`
      INSERT INTO devices (patient_id, endpoint, p256dh, auth, user_agent, created_at, active)
      VALUES ($1,$2,$3,$4,$5,$6,1)
      ON CONFLICT (endpoint) DO UPDATE SET
        patient_id = EXCLUDED.patient_id, p256dh = EXCLUDED.p256dh,
        auth = EXCLUDED.auth, active = 1`,
      [p.id, b.endpoint, b.keys.p256dh, b.keys.auth,
       String(req.headers["user-agent"] || "").slice(0, 200), Date.now()]);
    send(res, 200, { ok: true });
  },

  "POST /api/p/unsubscribe": async function (req, res) {
    const p = await requirePatient(req, res); if (!p) return;
    const b = await readBody(req);
    await db.q("UPDATE devices SET active = 0 WHERE endpoint = $1 AND patient_id = $2",
               [b.endpoint || "", p.id]);
    send(res, 200, { ok: true });
  }
};

/* ==========================================================================
   Handler
   ========================================================================== */

module.exports = async function handler(req, res) {
  let pathname;
  try {
    pathname = new URL(req.url, "http://localhost").pathname;
  } catch (e) {
    return send(res, 400, { error: "Bad request." });
  }

  const key = req.method + " " + pathname;
  const route = routes[key];

  if (!route) return send(res, 404, { error: "No such endpoint." });

  try {
    await route(req, res);
  } catch (e) {
    console.error(req.method, pathname, e);
    if (!res.headersSent) send(res, 500, { error: "Something went wrong on our end." });
  }
};

module.exports.routes = routes;
module.exports.pushToPatient = pushToPatient;
module.exports.getVapid = getVapid;
