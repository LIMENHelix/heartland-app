/* ==========================================================================
   Heartland coordinator console.
   Views: today's list (retention board), patients, compose, articles, sent.
   ========================================================================== */
(function () {
"use strict";

const DAY = 86400000;
let ME = null;
let VIEW = "board";
let BOARD = [];
let PATIENTS = [];
let ARTICLES = [];
let INBOX = [];
let COORDS = [];
let TEAM = [];
let CHECKINS = [];
let CK_SYMPTOMS = [];
let CK_FIELDS = [];
let SIGNUPS = [];
let CK_MAX = 10;
let UNASSIGNED = 0;
/* Which panel the console is looking at. A coordinator only ever has their
   own, so this is inert for them; an admin uses it to sit in someone's seat. */
let PANEL = "";
let LISTS = { vitalityTiers: [], lenders: [], textLine: "" };

/* ---- dom ---- */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
/* Opens the coordinator's own mail client (company email) with the patient
   addressed. Deliberately no PHI in the subject line: it travels in the clear
   through mail servers and shows in notification previews. */
/* The Call button hands the coordinator to Salesforce rather than a dialler,
   so the call gets logged where the rest of the record lives. Falls back to
   tel: only when Salesforce has not been configured. */
function salesforceHref(p) {
  var base = (LISTS && LISTS.salesforceBase) || "";
  if (!base) return null;
  base = base.replace(/\/+$/, "");
  if (p.salesforce_id) return base + "/lightning/r/Contact/" + encodeURIComponent(p.salesforce_id) + "/view";
  return base + "/lightning/o/Contact/home";
}

function callHref(p) {
  return salesforceHref(p) ||
    (p.phone ? "tel:" + String(p.phone).replace(/[^0-9+]/g, "") : null);
}

function mailto(email) {
  return "mailto:" + encodeURIComponent(email) +
         "?subject=" + encodeURIComponent("Heartland Men's Health");
}

function isAdmin() { return ME && ME.role === "admin"; }

/* Every scoped read carries the panel. Ignored by the server for anyone who is
   not an admin, so a coordinator cannot widen their own view by editing it. */
function scoped(path) {
  return PANEL && isAdmin() ? path + (path.indexOf("?") === -1 ? "?" : "&") + "panel=" + encodeURIComponent(PANEL) : path;
}

function panelName() {
  if (!PANEL) return "the whole clinic";
  if (PANEL === "unassigned") return "unassigned patients";
  if (PANEL === "mine") return "your panel";
  var c = COORDS.filter(function (x) { return String(x.id) === String(PANEL); })[0];
  return c ? c.name + "'s panel" : "one panel";
}

/* Sits above the board and the patient list for admins. A hundred coordinators
   is unreadable as one list; this is how you get to one of them. */
function panelBar() {
  if (!isAdmin()) return "";
  var opts = '<option value="">Whole clinic · ' + PATIENTS.length + '</option>' +
    '<option value="mine"' + (PANEL === "mine" ? " selected" : "") + '>My own panel</option>' +
    COORDS.map(function (c) {
      var n = TEAM.filter(function (t) { return t.id === c.id; })[0];
      return '<option value="' + c.id + '"' + (String(PANEL) === String(c.id) ? " selected" : "") + '>' +
             esc(c.name) + (n ? " · " + n.patients : "") + '</option>';
    }).join("") +
    (UNASSIGNED ? '<option value="unassigned"' + (PANEL === "unassigned" ? " selected" : "") +
       '>Unassigned · ' + UNASSIGNED + '</option>' : "");
  return '<div class="panelbar"><label class="panelbar__l" for="panelSel">Viewing</label>' +
         '<select class="select select--sm" id="panelSel">' + opts + '</select>' +
         (PANEL ? '<button class="btn btn--ghost btn--sm" data-act="panel-clear">Show everyone</button>' : "") +
         '</div>';
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* ---- api ---- */
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin"
  });
  if (res.status === 401 && ME) { ME = null; showLogin(); throw new Error("Signed out."); }
  const data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(function () { t.hidden = true; }, 3200);
}

/* ---- dates ---- */
function fmtDate(ts) {
  if (!ts) return "not set";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function daysSince(ts) { return Math.floor((Date.now() - ts) / DAY); }
function toDateInput(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function fromDateInput(v) { return v ? new Date(v + "T12:00:00").getTime() : null; }

/* ==========================================================================
   Auth
   ========================================================================== */

function showLogin() {
  $("#login").hidden = false;
  $("#shell").hidden = true;
}

async function boot() {
  try {
    const r = await api("/api/admin/me");
    ME = r.user;
    $("#login").hidden = true;
    $("#shell").hidden = false;
    $("#whoami").textContent = ME.name + (ME.role === "admin" ? " · administrator" : "");
    var teamBtn = $('.navbtn[data-view="team"]');
    if (teamBtn) teamBtn.hidden = !isAdmin();
    await refresh();
    render();
    PULSE = null;
    await pulse(true);
    startPulse();
  } catch (e) {
    showLogin();
  }
}

$("#loginForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  const err = $("#liErr");
  err.hidden = true;
  try {
    await api("/api/admin/login", {
      email: $("#liEmail").value.trim(),
      password: $("#liPass").value
    });
    $("#liPass").value = "";
    await boot();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$("#logout").addEventListener("click", async function () {
  stopPulse();
  await api("/api/admin/logout", {});
  ME = null;
  showLogin();
});


/* ==========================================================================
   Watching for new work.

   The console used to load once at sign-in and never look again, so a question
   that arrived while a coordinator sat looking at the screen simply never
   appeared. For something a patient is told is a direct line, that is the
   whole product failing quietly.

   It polls counts, not content, and only pays for a full reload when a count
   actually moves.
   ========================================================================== */

var PULSE = null;          /* last counts seen */
var pulseTimer = null;
var PULSE_MS = 30000;

/* Never redraw the screen out from under someone. Re-rendering while a modal
   is open, or while they are typing a reply, would throw away their work. */
function safeToRedraw() {
  if (!$("#modal").hidden) return false;
  var el = document.activeElement;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return false;
  if (VIEW === "compose" || VIEW === "me") return false;
  return true;
}

async function pulse(force) {
  if (!ME) return;
  let p;
  try { p = await api(scoped("/api/admin/pulse")); }
  catch (e) { return; }   /* offline or signed out; the next tick tries again */

  const changed = !PULSE ||
    p.questions !== PULSE.questions ||
    p.checkins !== PULSE.checkins ||
    p.signups !== PULSE.signups ||
    p.latest !== PULSE.latest;

  /* Badges update even when a redraw would be rude, so a coordinator mid-reply
     still sees that something new is waiting. */
  const qb = $("#navInboxCount"); if (qb) qb.textContent = p.questions ? String(p.questions) : "";
  const cb = $("#navCheckCount"); if (cb) cb.textContent = p.checkins ? String(p.checkins) : "";
  const sb = $("#navSignupCount"); if (sb) sb.textContent = p.signups ? String(p.signups) : "";

  const arrived = PULSE && p.questions > PULSE.questions;
  PULSE = p;
  if (!changed && !force) return;
  if (!safeToRedraw()) return;
  await refresh();
  render();
  if (arrived) toast("New question from a patient.");
}

function startPulse() {
  stopPulse();
  pulseTimer = setInterval(pulse, PULSE_MS);
  /* Coming back to the tab is the moment a coordinator most wants it current,
     and waiting up to 30 seconds for the timer is the wrong answer. */
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) pulse();
  });
  window.addEventListener("focus", function () { pulse(); });
}
function stopPulse() { if (pulseTimer) { clearInterval(pulseTimer); pulseTimer = null; } }

/* ==========================================================================
   Data
   ========================================================================== */

async function refresh() {
  const [b, p, a, i, k, su, c, L] = await Promise.all([
    api(scoped("/api/admin/board")),
    api(scoped("/api/admin/patients")),
    api("/api/admin/articles"),
    api(scoped("/api/admin/inbox")),
    api(scoped("/api/admin/checkins")),
    api("/api/admin/signups"),
    api("/api/admin/coordinators"),
    api("/api/admin/lists")
  ]);
  BOARD = b.board;
  PATIENTS = p.patients;
  ARTICLES = a.articles;
  INBOX = i.questions;
  CHECKINS = k.checkins;
  CK_SYMPTOMS = k.symptoms;
  CK_FIELDS = k.fields || [];
  CK_MAX = k.scaleMax || 10;
  SIGNUPS = su.signups;
  const suBadge = $("#navSignupCount");
  if (suBadge) suBadge.textContent = SIGNUPS.length ? String(SIGNUPS.length) : "";
  COORDS = c.coordinators;
  LISTS = L;
  if (isAdmin()) {
    try {
      const t = await api("/api/admin/team");
      TEAM = t.team; UNASSIGNED = t.unassigned;
    } catch (e) { TEAM = []; UNASSIGNED = 0; }
  }
  const waiting = INBOX.filter(function (x) { return !x.answered; }).length;
  const badge = $("#navInboxCount");
  if (badge) badge.textContent = waiting ? String(waiting) : "";
  const ckOpen = CHECKINS.filter(function (x) { return !x.seen_at; }).length;
  const ckBadge = $("#navCheckCount");
  if (ckBadge) ckBadge.textContent = ckOpen ? String(ckOpen) : "";
  const flagged = BOARD.filter(function (x) { return x.level === "urgent"; }).length;
  $("#navBoardCount").textContent = flagged ? String(flagged) : "";
}

/* ==========================================================================
   Views
   ========================================================================== */

function render() {
  $$(".navbtn").forEach(function (b) {
    b.classList.toggle("is-active", b.dataset.view === VIEW);
  });
  const m = $("#main");
  if (VIEW === "board") m.innerHTML = viewBoard();
  if (VIEW === "me") { m.innerHTML = viewMe(); wireMe(); }
  if (VIEW === "inbox") m.innerHTML = viewInbox();
  if (VIEW === "patients") m.innerHTML = viewPatients();
  if (VIEW === "compose") { m.innerHTML = viewCompose(); wireCompose(); }
  if (VIEW === "articles") m.innerHTML = viewArticles();
  if (VIEW === "signups") m.innerHTML = viewSignups();
  if (VIEW === "checkins") m.innerHTML = viewCheckins();
  if (VIEW === "team") { m.innerHTML = viewTeam(); wireTeam(); }
  if (VIEW === "sent") { m.innerHTML = '<div class="head"><h1 class="h1">Sent</h1></div><div id="sentBody" class="empty">Loading…</div>'; loadSent(); }
  window.scrollTo(0, 0);
}

/* ---------------- board ---------------- */

function viewBoard() {
  const urgent = BOARD.filter(function (p) { return p.level === "urgent"; });
  const warn = BOARD.filter(function (p) { return p.level === "warn"; });
  const info = BOARD.filter(function (p) { return p.level === "info"; });
  const ok = BOARD.filter(function (p) { return p.level === "ok"; });

  let h = '<div class="head"><div><p class="eyebrow">Retention</p><h1 class="h1">Today\'s list</h1></div>' +
          '<button class="btn btn--outline btn--sm" data-act="refresh">Refresh</button></div>';
  h += panelBar();

  h += '<div class="stats">' +
    stat(urgent.length, "need a call today", urgent.length ? "stat--urgent" : "") +
    stat(warn.length, "worth a nudge") +
    stat(BOARD.filter(function (p) { return !p.enrolled; }).length, "not set up") +
    stat(ok.length, "no flags") +
  "</div>";

  if (!BOARD.length) {
    return h + '<div class="card"><div class="empty">' +
      (PANEL ? "Nothing on " + esc(panelName()) + " right now."
             : "No active patients yet. Add one from the Patients tab.") + "</div></div>";
  }

  const groups = [
    ["Call today", urgent], ["Worth a nudge", warn],
    ["Keep an eye on", info], ["No flags", ok]
  ];

  groups.forEach(function (g) {
    if (!g[1].length) return;
    h += '<p class="eyebrow" style="margin-top:22px">' + esc(g[0]) + " · " + g[1].length + "</p>";
    h += '<div class="card card--flush">';
    g[1].forEach(function (p) { h += patientCard(p); });
    h += "</div>";
  });
  return h;
}

function patientCard(p) {
  let h = '<div class="pcard" data-level="' + esc(p.level) + '">';
  h += "<div><div class=\"pcard__name\">" + esc(p.name) +
       (p.pinned ? ' <span class="tagline tagline--warn">Pinned</span>' : "") + "</div>";
  h += '<div class="pcard__meta">' + esc(p.protocol || "No protocol recorded") +
       (p.clinic ? " · " + esc(p.clinic) : "") +
       (p.phone ? " · " + esc(p.phone) : "") + "</div>";
  if (p.reasons.length) {
    h += '<div class="pcard__reasons">';
    p.reasons.forEach(function (r) {
      const cls = r.level === "urgent" ? " tagline--urgent" : r.level === "warn" ? " tagline--warn" : "";
      h += '<span class="tagline' + cls + '"><span class="tagline__dot"></span>' + esc(r.text) + "</span>";
    });
    h += "</div>";
  }
  h += "</div>";
  h += '<div class="pcard__acts">';
  var ch = callHref(p);
  if (ch) h += '<a class="btn btn--outline btn--sm" href="' + esc(ch) + '"' +
    (salesforceHref(p) ? ' target="_blank" rel="noopener"' : "") + ">Call</a>";
  if (p.email) h += '<a class="btn btn--outline btn--sm" href="' + mailto(p.email) + '">Email</a>';
  h += '<button class="btn btn--outline btn--sm" data-act="message" data-id="' + p.id + '">Message</button>';
  h += '<button class="btn btn--outline btn--sm" data-act="edit" data-id="' + p.id + '">Open</button>';
  h += "</div></div>";
  return h;
}

function stat(n, l, cls) {
  return '<div class="stat ' + (cls || "") + '"><div class="stat__n">' + n +
         '</div><div class="stat__l">' + esc(l) + "</div></div>";
}

/* ---------------- patients ---------------- */

function viewPatients() {
  let h = '<div class="head"><div><p class="eyebrow">Records</p><h1 class="h1">Patients</h1></div>' +
          '<button class="btn btn--primary btn--sm" data-act="edit" data-id="new">Add a patient</button></div>';
  h += panelBar();

  h += '<div class="notice"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 2.5 3.5 5.5v4.2c0 3.6 2.6 6.6 6.5 7.8 3.9-1.2 6.5-4.2 6.5-7.8V5.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>' +
    "<p>These records are protected health information. Only enter what a coordinator needs to do their job, and sign out when you step away.</p></div>";

  if (!PATIENTS.length) {
    return h + '<div class="card"><div class="empty">' +
      (PANEL ? "No patients on " + esc(panelName()) + " yet." : "No patients yet.") + "</div></div>";
  }
  const waiting = PATIENTS.filter(function (p) { return !p.enrolled_at; });
  if (waiting.length) {
    h += '<div class="card card--flag"><p class="h3" style="margin:0 0 6px">' + waiting.length +
      (waiting.length === 1 ? " patient is not on the app yet" : " patients are not on the app yet") +
      "</p>" +
      '<p class="small muted" style="margin:0 0 12px">They see nothing, get no reminders, and cannot message you until they are set up.</p>' +
      '<div class="waitlist">' + waiting.map(function (p) {
        return '<div class="waitrow"><span>' + esc(p.first_name + " " + p.last_name) +
          (p.phone ? ' <span class="sub">' + esc(p.phone) + "</span>" : "") + "</span>" +
          '<button class="btn btn--primary btn--sm" data-act="setup" data-id="' + p.id +
          '">Get code</button></div>';
      }).join("") + "</div></div>";
  }

  h += '<div class="card card--flush">';
  PATIENTS.forEach(function (p) {
    h += '<button class="row row--btn" data-act="edit" data-id="' + p.id + '">' +
      '<div class="row__main"><div class="row__t">' + esc(p.first_name + " " + p.last_name) + "</div>" +
      '<div class="row__s">' + esc(p.protocol || "No protocol") +
      (p.clinic ? " · " + esc(p.clinic) : "") +
      " · last visit " + esc(fmtDate(p.last_visit_at)) + "</div></div>" +
      '<span class="tagline' + (p.enrolled_at ? "" : " tagline--wait") + '">' +
      (p.enrolled_at ? "On the app" : "Not set up") + "</span></button>";
    h += '<div class="rowacts"><button class="btn btn--outline btn--sm" data-act="pview" data-id="' +
      p.id + '">See his app</button>' +
      '<button class="btn btn--outline btn--sm" data-act="edit" data-id="' + p.id + '">Edit</button>' +
      '<button class="btn btn--ghost btn--sm" data-act="pdel" data-id="' + p.id + '">Delete</button></div>';
  });
  return h + "</div>";
}


/* ---------------- inbox: questions from patients ---------------- */

function viewMe() {
  const me = COORDS.filter(function (c) { return c.id === ME.id; })[0] || {};
  let h = '<div class="head"><div><p class="eyebrow">You</p><h1 class="h1">My details</h1></div></div>';
  h += '<div class="notice"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="7.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6.2v4.4M10 13.4v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
    "<p>This is exactly what your patients see in their app when you are their coordinator. Leave a field blank and that button simply does not appear for them.</p></div>";

  h += '<div class="card" style="max-width:560px">';
  h += field("Your name", '<input class="input" id="meName" value="' + esc(me.name || "") + '">' +
    '<span class="field__h">Shown as the heading of their care team card.</span>');
  h += field("How you are introduced", '<input class="input" id="meTitle" value="' + esc(me.title || "") + '" placeholder="Your patient coordinator">');
  h += field("Your direct line", '<input class="input" id="mePhone" value="' + esc(me.phone || "") + '" placeholder="913-555-0143">' +
    '<span class="field__h">Gives them a Call button. Never the clinic switchboard.</span>');
  h += field("Your email", '<input class="input" id="meEmail" type="email" value="' + esc(me.contact_email || me.email || "") + '">' +
    '<span class="field__h">Gives them an Email button that opens their own mail app addressed to you.</span>');
  h += '<button class="btn btn--primary btn--full" id="meSave">Save</button>';
  h += "</div>";

  h += '<div class="card" style="max-width:560px"><p class="h3">Your password</p>' +
    '<p class="small muted">You sign in as <strong>' + esc(ME.email) + "</strong>. " +
    "Changing that address is an administrator job; your password is yours.</p>";
  h += field("Current password",
    '<input class="input" id="pwCur" type="password" autocomplete="current-password">');
  h += field("New password",
    '<input class="input" id="pwNew" type="password" autocomplete="new-password">' +
    '<span class="field__h">At least 12 characters. A short phrase you will actually remember beats a scramble you write on a sticky note.</span>');
  h += field("New password again",
    '<input class="input" id="pwNew2" type="password" autocomplete="new-password">');
  h += '<p class="formerr" id="pwErr" hidden></p>';
  h += '<button class="btn btn--primary btn--full" id="pwSave">Change my password</button>';
  h += '<p class="field__h" style="margin-top:10px">Changing it signs you out on every other device. You stay signed in here.</p>';
  h += "</div>";
  return h;
}

function wireMe() {
  const btn = $("#meSave");
  if (!btn) return;
  btn.addEventListener("click", async function () {
    try {
      await api("/api/admin/me-update", {
        name: $("#meName").value.trim(),
        title: $("#meTitle").value.trim(),
        phone: $("#mePhone").value.trim(),
        contact_email: $("#meEmail").value.trim()
      });
      await refresh(); render(); toast("Saved.");
    } catch (e) { toast(e.message); }
  });

  const pw = $("#pwSave");
  if (pw) pw.addEventListener("click", async function () {
    const err = $("#pwErr");
    const cur = $("#pwCur").value, a = $("#pwNew").value, b = $("#pwNew2").value;
    const fail = function (m) { err.textContent = m; err.hidden = false; };
    err.hidden = true;
    if (!cur) return fail("Enter your current password.");
    if (a.length < 12) return fail("The new password needs at least 12 characters.");
    if (a !== b) return fail("The two new passwords do not match.");
    pw.disabled = true; pw.textContent = "Changing…";
    try {
      const r = await api("/api/admin/me-password", { current: cur, next: a });
      $("#pwCur").value = $("#pwNew").value = $("#pwNew2").value = "";
      toast(r.signedOutElsewhere
        ? "Password changed. Signed out on " + r.signedOutElsewhere + " other device" +
          (r.signedOutElsewhere === 1 ? "." : "s.")
        : "Password changed.");
    } catch (e) { fail(e.message); }
    finally { pw.disabled = false; pw.textContent = "Change my password"; }
  });
}

function viewInbox() {
  let h = '<div class="head"><div><p class="eyebrow">The direct line</p><h1 class="h1">Questions</h1></div>' +
          '<button class="btn btn--outline btn--sm" data-act="refresh">Refresh</button></div>';

  h += '<div class="notice"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="7.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6.2v4.4M10 13.4v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
    "<p>Patients are told this is answered during clinic hours, not around the clock. Anything urgent should be a phone call.</p></div>";

  if (!INBOX.length) {
    return h + '<div class="card"><div class="empty">No questions yet. When a patient asks something in the app it lands here.</div></div>';
  }

  const waiting = INBOX.filter(function (q) { return !q.answered; });
  const done = INBOX.filter(function (q) { return q.answered; });

  [["Waiting on you", waiting], ["Answered", done]].forEach(function (g) {
    if (!g[1].length) return;
    h += '<p class="eyebrow" style="margin-top:22px">' + esc(g[0]) + " · " + g[1].length + "</p>";
    h += '<div class="card card--flush">';
    g[1].forEach(function (q) {
      h += '<div class="pcard" data-level="' + (q.answered ? "" : "warn") + '">';
      h += "<div><div class=\"pcard__name\">" + esc(q.first_name + " " + q.last_name) + "</div>";
      h += '<div class="pcard__meta">' + esc(fmtDate(q.sent_at)) +
           (q.clinic ? " · " + esc(q.clinic) : "") + (q.phone ? " · " + esc(q.phone) : "") + "</div>";
      h += '<div style="margin-top:10px;white-space:pre-wrap">' + esc(q.body) + "</div></div>";
      h += '<div class="pcard__acts">';
      var qh = callHref(q);
      if (qh) h += '<a class="btn btn--outline btn--sm" href="' + esc(qh) + '"' +
        (salesforceHref(q) ? ' target="_blank" rel="noopener"' : "") + ">Call</a>";
      if (q.email) h += '<a class="btn btn--outline btn--sm" href="' + mailto(q.email) + '">Email</a>';
      h += '<button class="btn ' + (q.answered ? "btn--outline" : "btn--primary") + ' btn--sm" data-act="answer" data-id="' + q.id + '" data-pid="' + q.from_patient_id + '">' +
           (q.answered ? "Reply again" : "Answer") + "</button>";
      h += "</div></div>";
    });
    h += "</div>";
  });
  return h;
}

function profileModal() {
  const me = COORDS.filter(function (c) { return c.id === ME.id; })[0] || {};
  let h = '<p class="small muted" style="margin:0 0 18px">This is what your patients see in the app. ' +
    "Leave the number blank and they get no phone button, only the in-app question.</p>";
  h += field("Your direct line", '<input class="input" id="myPhone" value="' + esc(me.phone || "") + '" placeholder="e.g. 913-555-0143">');
  h += field("How you are introduced", '<input class="input" id="myTitle" value="' + esc(me.title || "") + '" placeholder="Your patient coordinator">');
  h += '<button class="btn btn--primary btn--full" id="mySave">Save</button>';
  openModal("My details", h, function (root) {
    $("#mySave", root).addEventListener("click", async function () {
      try {
        await api("/api/admin/me-update", {
          phone: $("#myPhone", root).value.trim(),
          title: $("#myTitle", root).value.trim()
        });
        closeModal(); await refresh(); render(); toast("Saved.");
      } catch (e) { toast(e.message); }
    });
  });
}

function answerModal(questionId, patientId) {
  const q = INBOX.filter(function (x) { return String(x.id) === String(questionId); })[0];
  if (!q) return;
  let h = '<p class="eyebrow">' + esc(q.first_name + " " + q.last_name) + " asked · " + esc(fmtDate(q.sent_at)) + "</p>";
  h += '<div class="card" style="white-space:pre-wrap;margin-bottom:18px">' + esc(q.body) + "</div>";
  h += field("Subject", '<input class="input" id="anTitle" value="Re: your question" maxlength="90">');
  h += field("Your answer", '<textarea class="textarea" id="anBody" style="min-height:180px"></textarea>');
  h += '<button class="btn btn--primary btn--full" id="anSend">Send answer</button>';
  openModal("Answer " + q.first_name, h, function (root) {
    $("#anSend", root).addEventListener("click", async function () {
      const body = $("#anBody", root).value.trim();
      if (!body) return toast("Write your answer first.");
      this.disabled = true;
      try {
        await api("/api/admin/message-send", {
          audience: "one", patientIds: [Number(patientId)],
          kind: "treatment", title: $("#anTitle", root).value.trim() || "Re: your question",
          body: body, reply_to: Number(questionId)
        });
        closeModal(); await refresh(); render(); toast("Answer sent.");
      } catch (e) { toast(e.message); this.disabled = false; }
    });
  });
}

/* ---------------- compose ---------------- */

const KINDS = [
  ["treatment", "Treatment communication",
   "About care they are already receiving: appointments, results, how to take something, what to expect."],
  ["refill", "Refill reminder",
   "A reminder about a medication they are already prescribed, including that it is running out."],
  ["marketing", "Promotional",
   "Anything selling a service they are not already on. HIPAA generally requires prior written authorisation. Check before sending."]
];

function viewCompose(preselectId) {
  let h = '<div class="head"><div><p class="eyebrow">Communication</p><h1 class="h1">Send a message</h1></div></div>';

  h += '<div class="card">';
  h += '<label class="field"><span class="field__l">Who gets it</span>' +
    '<select class="select" id="cAudience">' +
    '<option value="one">One patient</option>' +
    '<option value="flagged">Everyone flagged on today\'s list</option>' +
    '<option value="all">Every active patient</option>' +
    "</select></label>";

  h += '<label class="field" id="cOneWrap"><span class="field__l">Patient</span>' +
    '<select class="select" id="cPatient">' +
    PATIENTS.filter(function (p) { return p.status === "active"; }).map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.first_name + " " + p.last_name) + "</option>";
    }).join("") + "</select></label>";

  h += '<div class="field"><span class="field__l">What kind of message is this</span><div class="kinds" id="cKinds">';
  KINDS.forEach(function (k, i) {
    h += '<label class="kind' + (i === 0 ? " is-on" : "") + '" data-kind="' + k[0] + '">' +
      '<span class="kind__r"></span><input type="radio" name="kind" value="' + k[0] + '" hidden' +
      (i === 0 ? " checked" : "") + ">" +
      '<span><span class="kind__t">' + esc(k[1]) + '</span><span class="kind__s">' + esc(k[2]) + "</span></span></label>";
  });
  h += "</div></div>";

  h += '<div id="cWarn"></div>';

  h += '<label class="field"><span class="field__l">Title</span>' +
    '<input class="input" id="cTitle" maxlength="90" placeholder="Short and plain. This is the headline in their inbox."></label>';

  h += '<label class="field"><span class="field__l">Message</span>' +
    '<textarea class="textarea" id="cBody" placeholder="Write it the way you would say it on the phone."></textarea>' +
    '<span class="field__h">The push notification only says a message is waiting. Everything you write here stays behind their login.</span></label>';

  h += '<label class="field"><span class="field__l">Attach an article (optional)</span>' +
    '<select class="select" id="cArticle"><option value="">None</option>' +
    ARTICLES.filter(function (a) { return a.published; }).map(function (a) {
      return '<option value="' + a.id + '">' + esc(a.title) + "</option>";
    }).join("") + "</select></label>";

  h += '<button class="btn btn--primary" id="cSend">Send now</button>';
  h += "</div>";
  return h;
}

function wireCompose(preselectId) {
  const aud = $("#cAudience"), oneWrap = $("#cOneWrap");
  function syncAud() { oneWrap.hidden = aud.value !== "one"; }
  aud.addEventListener("change", syncAud);
  syncAud();
  if (preselectId) $("#cPatient").value = String(preselectId);

  $$(".kind").forEach(function (k) {
    k.addEventListener("click", function () {
      $$(".kind").forEach(function (x) { x.classList.remove("is-on"); });
      k.classList.add("is-on");
      $("input", k).checked = true;
      const warn = $("#cWarn");
      warn.innerHTML = k.dataset.kind === "marketing"
        ? '<div class="notice notice--urgent"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 2.6 18.2 17H1.8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8v3.4M10 14.1v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
          "<p><strong>Promotional messages need prior written authorisation from the patient under HIPAA.</strong> Refill reminders and treatment communication do not. If you are not certain which this is, check with compliance before you send.</p></div>"
        : "";
    });
  });

  $("#cSend").addEventListener("click", async function () {
    const btn = this;
    const audience = aud.value;
    const kind = ($("input[name=kind]:checked") || {}).value || "treatment";
    const title = $("#cTitle").value.trim();
    const body = $("#cBody").value.trim();
    if (!title || !body) return toast("Add a title and a message.");

    let count = audience === "all" ? PATIENTS.filter(function (p) { return p.status === "active"; }).length
              : audience === "flagged" ? BOARD.filter(function (p) { return p.level !== "ok"; }).length
              : 1;
    const who = audience === "one"
      ? ($("#cPatient").selectedOptions[0] || {}).textContent
      : count + " patients";
    if (!confirm("Send \"" + title + "\" to " + who + "?")) return;

    btn.disabled = true;
    btn.textContent = "Sending…";
    try {
      const r = await api("/api/admin/message-send", {
        audience: audience,
        panel: PANEL,
        patientIds: audience === "one" ? [Number($("#cPatient").value)] : [],
        kind: kind, title: title, body: body,
        article_id: $("#cArticle").value ? Number($("#cArticle").value) : null
      });
      toast("Sent to " + r.recipients + (r.recipients === 1 ? " patient" : " patients") +
            ". " + r.pushed + " notified" +
            (r.noDevice ? ", " + r.noDevice + " with no device yet" : "") + ".");
      $("#cTitle").value = ""; $("#cBody").value = "";
      await refresh();
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Send now";
    }
  });
}

/* ---------------- articles ---------------- */

function viewArticles() {
  let h = '<div class="head"><div><p class="eyebrow">Content</p><h1 class="h1">Articles</h1></div>' +
          '<button class="btn btn--primary btn--sm" data-act="article" data-id="new">Write an article</button></div>';
  if (!ARTICLES.length) {
    return h + '<div class="card"><div class="empty">Nothing written yet. Articles show up in the patient app under Learn.</div></div>';
  }
  h += '<div class="card card--flush">';
  ARTICLES.forEach(function (a) {
    h += '<button class="row row--btn" data-act="article" data-id="' + a.id + '">' +
      '<div class="row__main"><div class="row__t">' + esc(a.title) + "</div>" +
      '<div class="row__s">' + esc(a.category || "Uncategorised") + " · updated " + esc(fmtDate(a.updated_at)) + "</div></div>" +
      '<span class="tagline' + (a.published ? " tagline--warn" : "") + '">' +
      (a.published ? "Published" : "Draft") + "</span></button>";
  });
  return h + "</div>";
}

/* ---------------- sent ---------------- */

async function loadSent() {
  try {
    const r = await api("/api/admin/messages");
    const box = $("#sentBody");
    if (!r.messages.length) { box.className = "empty"; box.textContent = "Nothing sent yet."; return; }
    box.className = "card card--flush";
    box.innerHTML = r.messages.map(function (m) {
      const label = m.kind === "marketing" ? "Promotional" : m.kind === "refill" ? "Refill reminder" : "Treatment";
      return '<div class="row"><div class="row__main"><div class="row__t">' + esc(m.title) + "</div>" +
        '<div class="row__s">' + esc(label) + " · " + esc(fmtDate(m.sent_at)) +
        " · " + m.targets + (m.targets === 1 ? " recipient" : " recipients") +
        " · " + m.reads + " read</div></div>" +
        '<span class="tagline' + (m.kind === "marketing" ? " tagline--urgent" : "") + '">' + esc(label) + "</span></div>";
    }).join("");
  } catch (e) { toast(e.message); }
}

/* ==========================================================================
   Modals
   ========================================================================== */

function openModal(title, html, after) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal").hidden = false;
  if (after) after($("#modalBody"));
}
function closeModal() { $("#modal").hidden = true; }

function patientModal(id) {
  const isNew = id === "new";
  const p = isNew ? {} : PATIENTS.filter(function (x) { return String(x.id) === String(id); })[0];
  if (!p) return;

  let h = "";
  /* Straight at the top: either he is on the app or he is not, and if he is
     not there is one button that fixes it. */
  if (!isNew) {
    h += p.enrolled_at
      ? '<div class="setupbar setupbar--done"><span>On the app since ' +
        esc(fmtDate(p.enrolled_at)) + "</span>" +
        '<button class="btn btn--outline btn--sm" data-act="setup" data-id="' + p.id +
        '">New code</button></div>'
      : '<div class="setupbar"><span><strong>Not on the app yet.</strong> He sees nothing until he is set up.</span>' +
        '<button class="btn btn--primary btn--sm" data-act="setup" data-id="' + p.id +
        '">Get his code</button></div>';
  }
  h += '<div class="grid2">' +
    field("First name", '<input class="input" data-f="first_name" value="' + esc(p.first_name || "") + '">') +
    field("Last name", '<input class="input" data-f="last_name" value="' + esc(p.last_name || "") + '">') +
  "</div>";
  h += '<div class="grid2">' +
    field("Phone", '<input class="input" data-f="phone" value="' + esc(p.phone || "") + '">') +
    field("Email", '<input class="input" data-f="email" type="email" value="' + esc(p.email || "") + '">') +
  "</div>";
  h += field("Clinic", '<select class="select" data-f="clinic">' +
    ["", "Overland Park", "Independence", "North Kansas City"].map(function (c) {
      return '<option value="' + esc(c) + '"' + (p.clinic === c ? " selected" : "") + ">" + esc(c || "Not set") + "</option>";
    }).join("") + "</select>");
  h += field("What they are on",
    '<input class="input" data-f="protocol" value="' + esc(p.protocol || "") + '" placeholder="e.g. Testosterone cypionate, weekly">');

  h += '<div class="grid2">' +
    field("Date of birth", '<input class="input" type="date" data-f="date_of_birth" value="' + toDateInput(p.date_of_birth) + '">') +
    field("Treatment start date", '<input class="input" type="date" data-f="start_date" value="' + toDateInput(p.start_date) + '">') +
  "</div>";

  h += '<div class="grid2">' +
    field("Agreement length", '<select class="select" data-f="agreement_months">' +
      [["", "Not set"], ["12", "12 months"], ["24", "24 months"], ["36", "36 months"]].map(function (o) {
        return '<option value="' + o[0] + '"' + (String(p.agreement_months || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>";
      }).join("") + "</select>") +
    field("Renewal date (override)", '<input class="input" type="date" data-f="renewal_due_at" value="' + toDateInput(p.renewal_due_at) + '">') +
  "</div>";

  /* Show the coordinator what the start date implies, so they can sanity-check it. */
  h += '<div id="schedulePreview"></div>';

  h += field("Salesforce contact ID",
    '<input class="input" data-f="salesforce_id" value="' + esc(p.salesforce_id || "") + '" placeholder="003...">' +
    '<span class="field__h">Makes the Call button open this patient\'s Salesforce record. Blank opens the Contacts list instead.</span>');

  h += field("Their patient coordinator",
    '<select class="select" data-f="coordinator_id">' +
      '<option value="">Not assigned</option>' +
      COORDS.map(function (c) {
        return '<option value="' + c.id + '"' + (String(p.coordinator_id || "") === String(c.id) ? " selected" : "") + ">" +
               esc(c.name) + (c.phone ? " \u00b7 " + esc(c.phone) : " \u00b7 no direct line set") + "</option>";
      }).join("") + "</select>" +
    '<span class="field__h">This is the name and number the patient sees in their app. If no direct line is set, the app shows no phone button at all.</span>');

  h += field("Vitality Circle standing",
    '<select class="select" data-f="vitality_status"><option value="">Not in the Circle</option>' +
      LISTS.vitalityTiers.map(function (t) {
        var on = String(p.vitality_status || "").toLowerCase() === t.key ||
                 String(p.vitality_status || "").toLowerCase() === t.label.toLowerCase();
        return '<option value="' + t.key + '"' + (on ? " selected" : "") + ">" +
               esc(t.label) + " · " + t.discount + "% off</option>";
      }).join("") + "</select>" +
    '<span class="field__h">The patient sees their rung, the discount and the benefits. Leave blank to hide the card.</span>');

  h += field("Lifetime Vitality points",
    '<input class="input" type="number" min="0" data-f="vitality_points" value="' + esc(p.vitality_points == null ? "" : p.vitality_points) + '" placeholder="1 point per dollar invested">' +
    '<span class="field__h">Optional. Shown to the patient as their lifetime total. Once the tier thresholds are set in the code, the rung is worked out from this automatically.</span>');

  h += '<p class="eyebrow" style="margin:22px 0 10px">Financing</p>';
  h += '<div class="grid2">' +
    field("Lender", (function () {
      var cur = p.lender_name || "";
      var known = LISTS.lenders.indexOf(cur) !== -1;
      return '<select class="select" data-f="lender_name"><option value="">Not financed</option>' +
        LISTS.lenders.map(function (l) {
          return '<option value="' + esc(l) + '"' + (cur === l ? " selected" : "") + ">" + esc(l) + "</option>";
        }).join("") +
        (cur && !known ? '<option value="' + esc(cur) + '" selected>' + esc(cur) + " (not on the list)</option>" : "") +
        "</select>";
    })()) +
    field("Lender phone", '<input class="input" data-f="lender_phone" value="' + esc(p.lender_phone || "") + '">') +
  "</div>";
  h += field("Lender account link", '<input class="input" data-f="lender_url" value="' + esc(p.lender_url || "") + '" placeholder="https://...">');
  h += '<div class="grid2">' +
    field("Monthly payment", '<input class="input" data-f="payment_amount" value="' + esc(p.payment_amount || "") + '" placeholder="e.g. 189">') +
    field("Due on day of month", '<input class="input" type="number" min="1" max="31" data-f="payment_due_day" value="' + esc(p.payment_due_day == null ? "" : p.payment_due_day) + '">') +
  "</div>";
  h += '<p class="field__h" style="margin:-8px 0 18px">The app works out the next due date from that day each month. Nothing is pulled from the lender, so keep it current.</p>';

  h += field("Add-ons they may be interested in",
    '<textarea class="textarea" data-f="addons" style="min-height:70px" placeholder="e.g. IntraPulse course, GLP-1">' + esc(p.addons || "") + "</textarea>" +
    '<span class="field__h">Coordinator note only. Patients do not see this. To raise it with them, send a message and label it promotional.</span>');

  h += field("Last visit", '<input class="input" type="date" data-f="last_visit_at" value="' + toDateInput(p.last_visit_at) + '">');
  h += '<div class="grid2">' +
    field("Medication dispensed on", '<input class="input" type="date" data-f="supply_started_at" value="' + toDateInput(p.supply_started_at) + '">') +
    field("Days of supply", '<input class="input" type="number" min="0" data-f="supply_days" value="' + esc(p.supply_days == null ? "" : p.supply_days) + '">') +
  "</div>";
  h += '<p class="field__h" style="margin:-8px 0 16px">Those two together drive the "running out" reminder.</p>';

  h += field("Notes", '<textarea class="textarea" data-f="notes" style="min-height:90px">' + esc(p.notes || "") + "</textarea>");
  h += '<label class="check"><input type="checkbox" data-f="pinned"' + (p.pinned ? " checked" : "") + '> <span>Pin to the top of today\'s list</span></label>';

  h += '<button class="btn btn--primary btn--full" id="pSave" style="margin-top:14px">' +
       (isNew ? "Add patient" : "Save changes") + "</button>";

  if (!isNew) {
    h += '<div class="grid2" style="margin-top:10px">' +
      '<button class="btn btn--outline" data-act="pview" data-id="' + p.id +
      '">See his app</button>' +
      '<button class="btn btn--outline" id="pVisit">Log a visit today</button>' +
      (p.pass_hash
        ? '<button class="btn btn--outline" data-act="pw-reset" data-id="' + p.id +
          '">Reset his password</button>'
        : '<button class="btn btn--outline" data-act="setup" data-id="' + p.id + '">' +
          (p.enrolled_at ? "Send a new setup code" : "Get his setup code") + "</button>") +
      "</div>";
    if (p.email) {
      h += '<button class="btn btn--outline btn--full" id="pMail" style="margin-top:10px">Email ' +
           esc(p.first_name) + " from my mail app</button>";
    }
    h += '<button class="btn btn--ghost btn--full" id="pDel" style="margin-top:10px">Delete this patient</button>';
  }

  openModal(isNew ? "Add a patient" : p.first_name + " " + p.last_name, h, function (root) {

    /* Mirrors lib/db.js: labs at 8 weeks, +4 weeks, then every 6 months. */
    function addMonths(ts, n) {
      const d = new Date(ts), day = d.getDate();
      d.setDate(1); d.setMonth(d.getMonth() + n);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      return d.getTime();
    }
    function paintSchedule() {
      const box = $("#schedulePreview", root);
      const start = fromDateInput($('[data-f="start_date"]', root).value);
      const months = Number($('[data-f="agreement_months"]', root).value || 0);
      if (!start) { box.innerHTML = ""; return; }
      const DAYMS = 86400000;
      const l1 = start + 56 * DAYMS, l2 = l1 + 28 * DAYMS;
      const rows = [["8-week labs", l1], ["12-week labs", l2],
                    ["6-month labs", addMonths(l2, 6)], ["6-month labs", addMonths(l2, 12)]];
      let hh = '<div class="card" style="margin-bottom:15px"><p class="eyebrow" style="margin-bottom:10px">Computed from the start date</p>';
      hh += '<table class="datatable"><tbody>';
      rows.forEach(function (r) {
        hh += "<tr><td>" + r[0] + "</td><td>" + fmtDate(r[1]) + "</td></tr>";
      });
      if (months) hh += "<tr><td><strong>Renews</strong></td><td><strong>" + fmtDate(addMonths(start, months)) + "</strong></td></tr>";
      hh += "</tbody></table>";
      hh += '<p class="finetext" style="margin-top:10px">The patient sees only the next one. An override date above wins over the computed renewal.</p></div>';
      box.innerHTML = hh;
    }
    ['[data-f="start_date"]', '[data-f="agreement_months"]'].forEach(function (sel) {
      const el = $(sel, root);
      if (el) el.addEventListener("change", paintSchedule);
    });
    paintSchedule();

    $("#pSave", root).addEventListener("click", async function () {
      const payload = {};
      $$("[data-f]", root).forEach(function (el) {
        const k = el.dataset.f;
        if (el.type === "checkbox") payload[k] = el.checked ? 1 : 0;
        else if (el.type === "date") payload[k] = fromDateInput(el.value);
        else if (el.type === "number") payload[k] = el.value === "" ? null : Number(el.value);
        else payload[k] = el.value.trim() || null;
      });
      if (!payload.first_name || !payload.last_name) return toast("First and last name are required.");
      try {
        let newId = null;
        if (isNew) newId = (await api("/api/admin/patients", payload)).id;
        else { payload.id = p.id; await api("/api/admin/patient-update", payload); }
        closeModal();
        await refresh();
        render();
        /* The next thing you want after adding someone is his code. Making you
           reopen the record and scroll to the bottom for it was the whole
           problem. */
        if (isNew && newId) { toast("Patient added."); return setupModal(newId); }
        toast("Saved.");
      } catch (e) { toast(e.message); }
    });

    const visit = $("#pVisit", root);
    if (visit) visit.addEventListener("click", async function () {
      try {
        await api("/api/admin/patient-update", { id: p.id, last_visit_at: Date.now() });
        closeModal(); await refresh(); render(); toast("Visit logged for today.");
      } catch (e) { toast(e.message); }
    });

    const del = $("#pDel", root);
    if (del) del.addEventListener("click", async function () {
      if (!confirm("Delete " + p.first_name + " " + p.last_name +
                   " and everything attached to them? This cannot be undone.")) return;
      try {
        await api("/api/admin/patient-delete", { id: p.id });
        closeModal(); await refresh(); render(); toast("Deleted.");
      } catch (e) { toast(e.message); }
    });

    const mail = $("#pMail", root);
    if (mail) mail.addEventListener("click", function () {
      location.href = mailto(p.email);
    });

  });
}

function field(label, control) {
  return '<label class="field"><span class="field__l">' + esc(label) + "</span>" + control + "</label>";
}

function articleModal(id) {
  const isNew = id === "new";
  const a = isNew ? { published: 0 } : ARTICLES.filter(function (x) { return String(x.id) === String(id); })[0];
  if (!a) return;

  let h = field("Title", '<input class="input" data-f="title" value="' + esc(a.title || "") + '">');
  h += '<div class="grid2">' +
    field("Category", '<input class="input" data-f="category" value="' + esc(a.category || "") + '" placeholder="e.g. testosterone">') +
    field("Status", '<select class="select" data-f="published">' +
      '<option value="1"' + (a.published ? " selected" : "") + ">Published</option>" +
      '<option value="0"' + (a.published ? "" : " selected") + ">Draft</option></select>") +
  "</div>";
  h += field("One-line summary", '<input class="input" data-f="summary" value="' + esc(a.summary || "") + '">');
  h += field("Body", '<textarea class="textarea" data-f="body" style="min-height:260px">' + esc(a.body || "") + "</textarea>");
  h += '<p class="field__h" style="margin:-8px 0 16px">Plain text. Leave a blank line between paragraphs.</p>';
  h += '<button class="btn btn--primary btn--full" id="aSave">' + (isNew ? "Create" : "Save") + "</button>";
  if (!isNew) h += '<button class="btn btn--ghost btn--full" id="aDel" style="margin-top:8px">Delete this article</button>';

  openModal(isNew ? "New article" : "Edit article", h, function (root) {
    $("#aSave", root).addEventListener("click", async function () {
      const payload = { id: isNew ? null : a.id };
      $$("[data-f]", root).forEach(function (el) { payload[el.dataset.f] = el.value; });
      payload.published = payload.published === "1" ? 1 : 0;
      if (!payload.title || !payload.body) return toast("A title and body are required.");
      try {
        await api("/api/admin/article-save", payload);
        closeModal(); await refresh(); render(); toast("Saved.");
      } catch (e) { toast(e.message); }
    });
    const del = $("#aDel", root);
    if (del) del.addEventListener("click", async function () {
      if (!confirm("Delete \"" + a.title + "\"? Patients will no longer see it.")) return;
      try {
        await api("/api/admin/article-delete", { id: a.id });
        closeModal(); await refresh(); render(); toast("Deleted.");
      } catch (e) { toast(e.message); }
    });
  });
}





/* ==========================================================================
   New sign-ups.

   Men who created an account whose details did not match anything we had. Each
   one is sitting behind a "we are confirming your details" screen and can see
   nothing at all until somebody here says who he is. That is the whole point
   of the queue, so it should stay short.
   ========================================================================== */

function viewSignups() {
  var h = '<div class="head"><div><p class="eyebrow">Waiting on you</p>' +
          '<h1 class="h1">New sign-ups</h1></div>' +
          '<button class="btn btn--outline btn--sm" data-act="refresh">Refresh</button></div>';

  if (!SIGNUPS.length) {
    return h + '<div class="card"><div class="empty">' +
      "Nobody waiting. When a man signs up and his name, date of birth and mobile number " +
      "match a record you already entered, he goes straight in and never appears here." +
      "</div></div>";
  }

  h += '<div class="notice"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="7.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 6.2v4.4M10 13.4v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
    "<p>Each of these is waiting and can see nothing until you decide. Check the details " +
    "against what you know before you confirm anyone: this is the step that keeps one man's " +
    "record from opening on another man's phone.</p></div>";

  SIGNUPS.forEach(function (s) {
    h += '<div class="card card--flag">';
    h += '<div class="ckhead"><div>' +
      '<p class="ckname">' + esc(s.first_name + " " + s.last_name) + "</p>" +
      '<p class="sub">Signed up ' + esc(fmtWhen(s.signed_up_at)) + "</p></div></div>";

    h += '<div class="claimed">' +
      claimRow("Date of birth", fmtDate(s.date_of_birth)) +
      claimRow("Mobile", s.phone || "\u2014") +
      claimRow("Email", s.email || "\u2014") +
      "</div>";

    if (s.possibleMatches && s.possibleMatches.length) {
      h += '<p class="eyebrow" style="margin:18px 0 8px">Records with that surname, not yet claimed</p>';
      s.possibleMatches.forEach(function (m) {
        var dobSame = m.date_of_birth && s.date_of_birth &&
          new Date(Number(m.date_of_birth)).toISOString().slice(0, 10) ===
          new Date(Number(s.date_of_birth)).toISOString().slice(0, 10);
        h += '<div class="matchrow"><div>' +
          "<strong>" + esc(m.first_name + " " + m.last_name) + "</strong>" +
          '<span class="sub"> \u00b7 born ' + esc(fmtDate(m.date_of_birth)) +
          (dobSame ? ' <span class="agrees">same date of birth</span>' : "") +
          (m.phone ? " \u00b7 " + esc(m.phone) : "") +
          (m.clinic ? " \u00b7 " + esc(m.clinic) : "") + "</span>" +
          (m.protocol ? '<br><span class="sub">' + esc(m.protocol) + "</span>" : "") +
          "</div>" +
          '<button class="btn btn--primary btn--sm" data-act="su-link" data-id="' + s.id +
          '" data-target="' + m.id + '">This is him</button></div>';
      });
    }

    h += '<div class="ckacts" style="margin-top:16px">';
    if (s.phone) {
      h += '<a class="btn btn--outline btn--sm" href="tel:' +
        esc(String(s.phone).replace(/[^0-9+]/g, "")) + '">Call to check</a>';
    }
    h += '<button class="btn btn--primary btn--sm" data-act="su-approve" data-id="' + s.id +
      '">He is our patient, add him</button>';
    h += '<button class="btn btn--ghost btn--sm" data-act="su-reject" data-id="' + s.id +
      '">Not our patient</button>';
    h += "</div></div>";
  });
  return h;
}

function claimRow(label, value) {
  return '<div class="claimrow"><span class="claimrow__l">' + esc(label) + "</span>" +
         '<span class="claimrow__v">' + esc(value) + "</span></div>";
}

async function signupDecide(id, decision, targetId) {
  var s = SIGNUPS.filter(function (x) { return String(x.id) === String(id); })[0] || {};
  var who = (s.first_name || "") + " " + (s.last_name || "");
  if (decision === "reject" &&
      !confirm("Mark " + who + " as not our patient? He will be locked out immediately.")) return;
  if (decision === "approve" &&
      !confirm("Confirm " + who + " as a patient? His app opens straight away and he goes on your panel.")) return;
  try {
    var r = await api("/api/admin/signup-decide",
      { id: Number(id), decision: decision, targetId: targetId ? Number(targetId) : null });
    await refresh(); render();
    toast(r.decision === "linked" ? "Linked to the existing record."
        : r.decision === "approved" ? who.trim() + " is in."
        : "Marked as not our patient.");
  } catch (e) { toast(e.message); }
}


/* He rang because he cannot get in. Shown once, and he has to replace it. */
async function patientPassword(id) {
  var p = PATIENTS.filter(function (x) { return String(x.id) === String(id); })[0] || {};
  if (!confirm("Reset the password for " + p.first_name + " " + p.last_name +
               "? He will be signed out on every device.")) return;
  try {
    var r = await api("/api/admin/patient-password", { id: Number(id) });
    closeModal();
    var h = "<p>Read this to him. <strong>It is shown once</strong> and cannot be looked up again. " +
      "He will be asked to choose his own the moment he signs in.</p>";
    h += '<div class="codebox"><span class="codebox__l">Sign in at</span>' +
         '<span class="codebox__v">' + esc(location.host) + "</span></div>";
    h += '<div class="codebox"><span class="codebox__l">Email</span>' +
         '<span class="codebox__v">' + esc(r.email || "") + "</span></div>";
    h += '<div class="codebox"><span class="codebox__l">Password</span>' +
         '<span class="codebox__v">' + esc(r.password) + "</span></div>";
    openModal("Temporary password", h);
  } catch (e) { toast(e.message); }
}



/* Deleting takes his record, his messages, his check-ins and his food and
   training log with it, and there is no undo. The confirmation names what
   goes, and typing the surname is the guard against a mis-click on a list. */
async function deletePatient(id) {
  const p = PATIENTS.filter(function (x) { return String(x.id) === String(id); })[0];
  if (!p) return;
  const who = (p.first_name || "") + " " + (p.last_name || "");
  const typed = prompt(
    "Delete " + who.trim() + " permanently?\n\n" +
    "This also removes every message, check-in and log entry for him, and cannot be undone.\n\n" +
    "Type his last name to confirm:");
  if (typed === null) return;
  if (String(typed).trim().toLowerCase() !== String(p.last_name || "").trim().toLowerCase()) {
    return toast("That did not match. Nothing was deleted.");
  }
  try {
    await api("/api/admin/patient-delete", { id: Number(id) });
    closeModal();
    await refresh(); render();
    toast(who.trim() + " deleted.");
  } catch (e) { toast(e.message); }
}

/* ==========================================================================
   Looking into a patient's app.

   What he sees, drawn from the same payload his phone gets. Read only, and it
   says so: a coordinator who thinks they are inside his app might otherwise
   assume tapping something here does something for him.
   ========================================================================== */

async function patientView(id) {
  let r;
  try { r = await api("/api/admin/patient-view?id=" + encodeURIComponent(id)); }
  catch (e) { return toast(e.message); }

  const p = PATIENTS.filter(function (x) { return String(x.id) === String(id); })[0] || {};
  const h = r.home, a = r.access;
  let out = "";

  /* Can he open it at all? The first question when he says he cannot see
     something, and the one the rest of this screen is meaningless without. */
  const problems = [];
  if (!a.hasAccount) problems.push("has not created an account yet");
  if (a.accountStatus === "pending") problems.push("sign-up is still waiting for approval");
  if (a.accountStatus === "rejected") problems.push("account was marked not-our-patient");
  if (a.hasAccount && !a.signedInDevices) problems.push("not signed in on any device");
  if (a.signedInDevices && !a.notificationsOn) problems.push("notifications not turned on");

  out += '<div class="pvbar' + (problems.length ? " pvbar--warn" : "") + '">' +
    (problems.length
      ? "<strong>He may not be seeing this.</strong> " + esc(problems.join(", ")) + "."
      : "<strong>He can see all of this.</strong> Signed in on " + a.signedInDevices +
        " device" + (a.signedInDevices === 1 ? "" : "s") +
        (a.notificationsOn ? ", notifications on" : "") + ".") +
    (a.lastSeenAt ? '<span class="pvbar__t">last opened ' + esc(fmtWhen(a.lastSeenAt)) + "</span>" : "") +
    "</div>";

  out += '<p class="field__h" style="margin:-4px 0 16px">This is a read-only copy of his screen. Nothing here sends, marks read, or records anything as him.</p>';

  /* ---- his home screen ---- */
  out += '<div class="pvphone"><div class="pvscreen">';
  out += '<p class="pvgreet">' + esc(h.firstName || p.first_name || "") + "</p>";
  if (h.vitality) {
    out += '<span class="pvbadge">' + esc(h.vitality.label) + " \u00b7 " + h.vitality.discount + "% off</span>";
  }
  out += '<div class="pvrows">';
  out += pvRow("His coordinator", h.coordinator
    ? esc(h.coordinator.name) + (h.coordinator.phone ? " \u00b7 " + esc(h.coordinator.phone) : "") +
      (h.coordinator.email ? " \u00b7 " + esc(h.coordinator.email) : "")
    : "NOBODY \u2014 he sees no call or email button at all", !h.coordinator);
  out += pvRow("What he is on", h.protocol ? esc(h.protocol) : "nothing entered", !h.protocol);
  out += pvRow("Clinic", h.clinic ? esc(h.clinic) : "not set", !h.clinic);
  out += pvRow("Medication left", h.supplyLeft === null || h.supplyLeft === undefined
    ? "no supply dates entered" : h.supplyLeft + " days", h.supplyLeft === null || h.supplyLeft === undefined);
  out += pvRow("Next labs", h.labs && h.labs.next
    ? esc(fmtDate(h.labs.next.at)) + " \u00b7 " + esc(h.labs.next.label)
    : "no start date, so no lab schedule", !(h.labs && h.labs.next));
  out += pvRow("Renewal", h.renewalAt
    ? esc(fmtDate(h.renewalAt)) + " \u00b7 in " + h.renewalInDays + " days"
    : "no start date or agreement length", !h.renewalAt);
  out += pvRow("Payment", h.payment
    ? (h.payment.amount ? "$" + esc(h.payment.amount) : "amount not set") +
      (h.payment.lender ? " \u00b7 " + esc(h.payment.lender) : "") +
      (h.payment.dueAt ? " \u00b7 due " + esc(fmtDate(h.payment.dueAt)) : "")
    : "no payment plan entered \u2014 the card is hidden", !h.payment);
  out += pvRow("Unread messages", String(h.unread || 0));
  out += "</div></div></div>";

  /* ---- his conversation ---- */
  out += '<p class="eyebrow" style="margin-top:22px">His messages \u00b7 ' + r.thread.length + "</p>";
  if (!r.thread.length) out += '<p class="sub">Nothing either way yet.</p>';
  else {
    out += '<div class="pvthread">';
    r.thread.slice(0, 12).forEach(function (m) {
      out += '<div class="pvmsg pvmsg--' + (m.direction === "in" ? "in" : "out") + '">' +
        '<span class="pvmsg__w">' + (m.direction === "in" ? "he wrote" : "clinic") +
        " \u00b7 " + esc(fmtWhen(m.sent_at)) +
        (m.direction === "out" ? (m.read_at ? " \u00b7 read" : " \u00b7 unread") : "") + "</span>" +
        (m.title ? "<strong>" + esc(m.title) + "</strong><br>" : "") +
        esc(String(m.body || "").slice(0, 240)) + "</div>";
    });
    out += "</div>";
  }

  /* ---- what he has logged ---- */
  out += '<p class="eyebrow" style="margin-top:22px">His check-ins \u00b7 ' + r.checkins.length + "</p>";
  if (!r.checkins.length) out += '<p class="sub">He has not recorded a day yet.</p>';
  else {
    out += '<div class="pvthread">';
    r.checkins.slice(0, 6).forEach(function (c) {
      out += '<div class="pvmsg"><span class="pvmsg__w">' + esc(fmtWhen(c.at)) + " \u00b7 " +
        r.fields.map(function (f) { return esc(f.label) + " " + (c[f.key] || "\u2013"); }).join(", ") +
        "</span>" + (c.note ? esc(c.note) : "<em>no note</em>") + "</div>";
    });
    out += "</div>";
  }

  const meals = r.logs.filter(function (l) { return l.kind === "meal"; }).length;
  const training = r.logs.filter(function (l) { return l.kind === "training"; }).length;
  out += '<p class="sub" style="margin-top:14px">' + meals + " meal " + (meals === 1 ? "entry" : "entries") +
         ", " + training + " training " + (training === 1 ? "entry" : "entries") + "</p>";

  out += '<button class="btn btn--primary btn--full" data-act="edit" data-id="' + id +
         '" style="margin-top:20px">Edit what he sees</button>';

  openModal(esc((p.first_name || "") + " " + (p.last_name || "")).trim() + " \u2014 his app", out);
}

function pvRow(label, value, missing) {
  return '<div class="pvrow' + (missing ? " pvrow--missing" : "") + '">' +
    '<span class="pvrow__l">' + esc(label) + "</span>" +
    '<span class="pvrow__v">' + value + "</span></div>";
}

/* ==========================================================================
   Setting a patient up. One screen that answers the only two questions a
   coordinator has: what do I send him, and what happens when he gets it.
   ========================================================================== */

async function setupModal(patientId) {
  let r;
  try { r = await api("/api/admin/enroll-link", { id: patientId }); }
  catch (e) { return toast(e.message); }

  const p = PATIENTS.filter(function (x) { return String(x.id) === String(patientId); })[0] || {};
  const name = r.firstName || p.first_name || "your patient";
  const url = location.origin + r.path;
  const site = location.host;

  /* The message ready to go, so nobody has to compose one and nobody leaves
     out the Add to Home Screen step that push notifications depend on. */
  const sms =
    "Hi " + name + ", it's Heartland Men's Health. Here's your app:\n\n" + url +
    "\n\nOpen that on your phone and you're in, no password needed. " +
    "Then tap Share and Add to Home Screen so we can send you reminders.";

  let h = '<div class="setupsteps">';

  h += '<div class="setupstep"><span class="setupstep__n">1</span><div>' +
    "<p class=\"setupstep__t\">Send him this</p>" +
    '<p class="setupstep__b">Text or email it. One tap and he is in \u2014 no password, nothing to remember.</p>' +
    '<div class="sendbox" id="sendBox">' + esc(sms) + "</div>" +
    '<div class="grid2" style="margin-top:10px">' +
      (p.phone
        ? '<a class="btn btn--primary" href="sms:' + esc(String(p.phone).replace(/[^0-9+]/g, "")) +
          "?&body=" + encodeURIComponent(sms) + '">Text ' + esc(name) + "</a>"
        : '<button class="btn btn--outline" disabled>No phone on file</button>') +
      '<button class="btn btn--outline" id="suCopyMsg">Copy the message</button>' +
    "</div></div></div>";

  h += '<div class="setupstep"><span class="setupstep__n">2</span><div>' +
    "<p class=\"setupstep__t\">Or do it with him in the room</p>" +
    '<p class="setupstep__b">Have him open <strong>' + esc(site) +
    "</strong> on his phone and read him this code.</p>" +
    '<div class="bigcode">' + esc(r.code || "") + "</div>" +
    '<p class="setupstep__b" style="text-align:center">No zero, no letter O. Works once.</p>' +
    "</div></div>";

  h += '<div class="setupstep"><span class="setupstep__n">3</span><div>' +
    "<p class=\"setupstep__t\">He taps Share, then Add to Home Screen</p>" +
    '<p class="setupstep__b">On an iPhone this is not optional. Reminders and alerts only work from the home-screen icon, not from Safari.</p>' +
    "</div></div>";

  h += "</div>";

  h += '<div class="setupnote"><p><strong>He never signs in again.</strong> The app stays open on his phone from then on \u2014 no password, no code. ' +
    "If he changes phones or clears his browser, come back here and send him a new code.</p>" +
    "<p>This link and code both work once, and expire " + esc(expiryWords(r.expiresAt)) + ".</p></div>";

  h += '<button class="btn btn--outline btn--full" id="suCopyLink" style="margin-top:6px">Copy just the link</button>';

  openModal("Set up " + esc(name), h, function (root) {
    const copy = function (text, what) {
      navigator.clipboard.writeText(text).then(
        function () { toast(what + " copied."); },
        function () { toast("Could not copy. Select the text instead."); });
    };
    $("#suCopyMsg", root).addEventListener("click", function () { copy(sms, "Message"); });
    $("#suCopyLink", root).addEventListener("click", function () { copy(url, "Link"); });
  });
}

function expiryWords(at) {
  if (!at) return "in 3 days";
  const d = new Date(Number(at));
  const days = Math.round((Number(at) - Date.now()) / DAY);
  return "in " + days + (days === 1 ? " day" : " days") + ", on " +
    d.toLocaleDateString(undefined, { weekday: "long" }) + " at " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/* ==========================================================================
   Check-ins.

   What a patient said about his own week. Two rules the UI has to keep:
     - his note is shown VERBATIM and never truncated in the detail view. A
       paraphrase is where the signal gets lost.
     - "urgent" here does not mean the app handled it. The app has already put
       the emergency number in front of him; this list is so a human follows up,
       not so a human decides whether he gets help.
   ========================================================================== */

function viewCheckins() {
  var open = CHECKINS.filter(function (c) { return !c.seen_at; });
  var urgent = open.filter(function (c) { return c.level === "urgent"; });
  var rough = open.filter(function (c) { return c.level === "rough"; });
  var done = CHECKINS.filter(function (c) { return c.seen_at; });

  var h = '<div class="head"><div><p class="eyebrow">In their own words</p>' +
          '<h1 class="h1">Check-ins</h1></div>' +
          '<button class="btn btn--outline btn--sm" data-act="refresh">Refresh</button></div>';
  h += panelBar();

  h += '<div class="stats">' +
    stat(urgent.length, "need attention", urgent.length ? "stat--urgent" : "") +
    stat(rough.length, "rough days") +
    /* People, not rows: one man having four rough days is one phone call. */
    stat(new Set(open.map(function (c) { return c.patient_id; })).size, "patients waiting") +
    stat(done.length, "already handled") +
  "</div>";

  if (!CHECKINS.length) {
    return h + '<div class="card"><div class="empty">' +
      "No flagged check-ins. A patient's entry only lands here when he scores low or ticks a symptom." +
      "</div></div>";
  }

  if (urgent.length) h += ckGroup("Needs attention", urgent);
  if (rough.length) h += ckGroup("Rough day", rough);
  if (done.length) h += ckGroup("Handled", done.slice(0, 25));
  return h;
}

function ckGroup(title, list) {
  var h = '<p class="eyebrow" style="margin-top:22px">' + esc(title) + " \u00b7 " + list.length + "</p>";
  list.forEach(function (c) {
    var reasons = ckList(c.reasons);
    var redKeys = ckList(c.symptoms).map(function (k) {
      return (CK_SYMPTOMS.filter(function (x) { return x.key === k; })[0] || {});
    }).filter(function (x) { return x.red; });

    h += '<div class="card' + (c.level === "urgent" && !c.seen_at ? " card--urgent" : "") + '">';
    h += '<div class="ckhead"><div>' +
      '<p class="ckname">' + esc(c.first_name + " " + c.last_name) + "</p>" +
      '<p class="sub">' + esc(fmtWhen(c.at)) +
        (c.clinic ? " \u00b7 " + esc(c.clinic) : "") +
        (c.seen_at ? " \u00b7 seen" : "") + "</p></div>";
    h += '<div class="ckscores">' + CK_FIELDS.map(function (f) {
      return ckScore(f.label, c[f.key]);
    }).join("") + "</div></div>";

    if (redKeys.length) {
      h += '<p class="ckred">' + redKeys.map(function (x) { return esc(x.label); }).join(" \u00b7 ") +
           '<span class="ckred__n">He was given the emergency number on his own screen when he ticked this.</span></p>';
    }
    if (reasons.length) {
      h += '<div class="chips">' + reasons.map(function (r) {
        return '<span class="chip">' + esc(r) + "</span>";
      }).join("") + "</div>";
    }
    if (c.note) {
      /* verbatim, never trimmed */
      h += '<blockquote class="cknote">' + esc(c.note) + "</blockquote>";
    }

    h += '<div class="ckacts">';
    var call = callHref(c);
    if (call) h += '<a class="btn btn--outline btn--sm" href="' + esc(call) + '" target="_blank" rel="noopener">Call</a>';
    if (c.email) h += '<a class="btn btn--outline btn--sm" href="' + esc(mailto(c.email)) + '">Email</a>';
    h += '<button class="btn btn--outline btn--sm" data-act="message" data-id="' + c.patient_id + '">Message</button>';
    h += '<button class="btn btn--outline btn--sm" data-act="ck-history" data-id="' + c.patient_id + '">Last two weeks</button>';
    if (!c.seen_at) {
      h += '<button class="btn btn--primary btn--sm" data-act="ck-seen" data-id="' + c.id + '">Mark handled</button>';
    }
    h += "</div></div>";
  });
  return h;
}

function ckList(v) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || "[]"); } catch (e) { return []; }
}

/* Thresholds are fractions of the scale, not fixed numbers, so moving the
   range again does not silently change what counts as a bad day. */
function ckScore(label, v) {
  var n = Number(v);
  var frac = n ? (n - 1) / (CK_MAX - 1) : null;
  var cls = frac === null ? " is-none" : frac <= 0.25 ? " is-low" : frac >= 0.7 ? " is-high" : "";
  return '<span class="ckscore' + cls + '"><span class="ckscore__v">' +
    (n ? n : "\u2014") + '</span><span class="ckscore__l">' + esc(label) + "</span></span>";
}

function fmtWhen(ts) {
  var d = Math.floor((Date.now() - ts) / DAY);
  var day = d === 0 ? "today" : d === 1 ? "yesterday" : d + " days ago";
  return day + ", " + new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

async function ckHistory(patientId) {
  try {
    var r = await api("/api/admin/patient-checkins?id=" + encodeURIComponent(patientId));
    var p = PATIENTS.filter(function (x) { return String(x.id) === String(patientId); })[0] || {};
    var h = "";

    if (!r.checkins.length) {
      h += "<p>Nothing logged yet.</p>";
    } else {
      h += '<div class="trendgrid">';
      (r.fields || CK_FIELDS).forEach(function (f) {
        var t = r.trend[f.key] || {};
        var d = t.delta;
        var has = d !== null && d !== undefined;
        var arrow = !has ? "" : d > 0.4 ? "\u2191" : d < -0.4 ? "\u2193" : "\u2192";
        var cls = !has ? "" : d > 0.4 ? " is-up" : d < -0.4 ? " is-down" : "";
        h += '<div class="trendgrid__c"><span class="trendgrid__l">' + esc(f.label) + "</span>" +
             '<span class="trendgrid__v">' + (t.now === null || t.now === undefined ? "\u2014" : t.now) + "</span>" +
             '<span class="trendgrid__d' + cls + '">' + arrow +
             (t.was === null || t.was === undefined ? "" : " from " + t.was) + "</span></div>";
      });
      h += "</div>";
      h += '<p class="field__h">Last 7 entries against the 7 before them, out of ' + (r.scaleMax || CK_MAX) + '.</p>';
      /* A trend built on three entries is not a trend. Say how much of the
         fortnight it actually rests on before anyone reads meaning into it. */
      if (r.adherence) {
        var a = r.adherence, weak = a.logged < 7;
        h += '<p class="adherence' + (weak ? " adherence--thin" : "") + '">Recorded ' +
             a.logged + " of the last " + a.of + " days" +
             (weak ? " · too few entries to read much into the trend" : "") + "</p>";
      }

      h += '<h3 class="h2" style="margin:22px 0 10px">What he wrote</h3>';
      r.checkins.forEach(function (c) {
        h += '<div class="ckrow"><p class="sub">' + esc(fmtWhen(c.at)) + " \u00b7 " +
             (r.fields || CK_FIELDS).map(function (f) {
               return esc(f.label) + " " + (c[f.key] || "\u2013");
             }).join(", ") + "</p>";
        if (c.note) h += '<blockquote class="cknote">' + esc(c.note) + "</blockquote>";
        var reasons = ckList(c.reasons);
        if (reasons.length) {
          h += '<div class="chips">' + reasons.map(function (x) {
            return '<span class="chip">' + esc(x) + "</span>";
          }).join("") + "</div>";
        }
        h += "</div>";
      });
    }

    var meals = r.logs.filter(function (l) { return l.kind === "meal"; });
    var training = r.logs.filter(function (l) { return l.kind === "training"; });
    if (meals.length || training.length) {
      h += '<h3 class="h2" style="margin:24px 0 10px">Meals and training</h3>';
      h += '<div class="grid2">' + ckLogCol("Meals", meals) + ckLogCol("Training", training) + "</div>";
    }

    openModal(esc((p.first_name || "") + " " + (p.last_name || "")).trim() || "Their last two weeks", h);
  } catch (e) { toast(e.message); }
}

function ckLogCol(title, rows) {
  var h = '<div><p class="field__l">' + esc(title) + "</p>";
  if (!rows.length) h += '<p class="sub">Nothing logged.</p>';
  else {
    h += '<ul class="loglist">';
    rows.slice(0, 20).forEach(function (l) {
      h += '<li class="loglist__i"><span class="loglist__t">' +
        esc(new Date(l.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })) +
        '</span><span class="loglist__b">' + esc(l.body) + "</span></li>";
    });
    h += "</ul>";
  }
  return h + "</div>";
}

/* ==========================================================================
   The team. Admin only: a clinic running a hundred coordinators administers
   the accounts here rather than in the database.
   ========================================================================== */

function viewTeam() {
  var active = TEAM.filter(function (c) { return c.active; });
  var off = TEAM.filter(function (c) { return !c.active; });
  var admins = active.filter(function (c) { return c.role === "admin"; }).length;
  var carrying = active.filter(function (c) { return c.patients > 0; }).length;

  var h = '<div class="head"><div><p class="eyebrow">Administration</p><h1 class="h1">The team</h1></div>' +
          '<button class="btn btn--primary btn--sm" data-act="coord" data-id="new">Add a coordinator</button></div>';

  h += '<div class="stats">' +
    stat(active.length, active.length === 1 ? "active account" : "active accounts") +
    stat(carrying, "carrying patients") +
    stat(admins, admins === 1 ? "administrator" : "administrators") +
    stat(UNASSIGNED, "patients unassigned", UNASSIGNED ? "stat--urgent" : "") +
  "</div>";

  if (UNASSIGNED) {
    h += '<div class="card"><div class="card__b">' +
      "<p><strong>" + UNASSIGNED + " patient" + (UNASSIGNED === 1 ? " has" : "s have") +
      " no coordinator.</strong> Nobody is answering their messages, and they see no direct line in their app.</p>" +
      '<button class="btn btn--outline btn--sm" data-act="reassign" data-from="unassigned" style="margin-top:12px">Assign them to someone</button>' +
      "</div></div>";
  }

  h += '<div class="card"><table class="tbl"><thead><tr>' +
       "<th>Name</th><th>Role</th><th>Patients</th><th>Set up</th>" +
       "<th>Last signed in</th><th></th></tr></thead><tbody>";
  h += active.map(teamRow).join("");
  h += "</tbody></table></div>";

  if (off.length) {
    h += '<h2 class="h2" style="margin:26px 0 10px">Deactivated</h2>';
    h += '<div class="card"><table class="tbl"><thead><tr>' +
         "<th>Name</th><th>Role</th><th>Patients</th><th>Set up</th>" +
         "<th>Last signed in</th><th></th></tr></thead><tbody>" +
         off.map(teamRow).join("") + "</tbody></table></div>";
    h += '<p class="field__h" style="margin-top:10px">A deactivated account cannot sign in. Their patients stay assigned to them until you move the panel, so nothing is orphaned by accident.</p>';
  }

  return h;
}

function teamRow(c) {
  var rate = c.patients ? Math.round((c.enrolled / c.patients) * 100) : null;
  return "<tr>" +
    "<td><strong>" + esc(c.name) + "</strong>" +
      (c.id === ME.id ? " (you)" : "") +
      (c.active ? "" : " \u00b7 deactivated") +
      '<br><span class="sub">' + esc(c.email) + (c.title ? " \u00b7 " + esc(c.title) : "") + "</span></td>" +
    "<td>" + (c.role === "admin" ? "Administrator" : "Coordinator") + "</td>" +
    "<td>" + c.patients + "</td>" +
    "<td>" + (rate === null ? "\u2014" : rate + "%") + "</td>" +
    "<td>" + (c.last_login ? fmtDate(c.last_login) : '<span class="sub">never</span>') + "</td>" +
    '<td><button class="btn btn--outline btn--sm" data-act="coord" data-id="' + c.id + '">Manage</button></td>' +
  "</tr>";
}

function wireTeam() { /* rows are delegated through the document click handler */ }

function coordModal(id) {
  var isNew = id === "new";
  var c = isNew ? { role: "coordinator", active: 1 }
                : TEAM.filter(function (x) { return String(x.id) === String(id); })[0];
  if (!c) return;

  var h = '<div class="grid2">' +
    field("Name", '<input class="input" data-f="name" value="' + esc(c.name || "") + '">') +
    field("Title", '<input class="input" data-f="title" value="' + esc(c.title || "") + '" placeholder="Patient Coordinator">') +
  "</div>";

  h += field("Sign-in email",
    '<input class="input" type="email" data-f="email" value="' + esc(c.email || "") + '">' +
    '<span class="field__h">This is how they sign in to the console. Patients never see it.</span>');

  h += '<div class="grid2">' +
    field("Direct line", '<input class="input" data-f="phone" value="' + esc(c.phone || "") + '" placeholder="913-000-0000">') +
    field("Reply-to email", '<input class="input" type="email" data-f="contact_email" value="' + esc(c.contact_email || "") + '">') +
  "</div>";
  h += '<p class="field__h" style="margin:-8px 0 18px">These two are what their patients see in the app. Leave the direct line blank and the app shows no phone button at all, rather than falling back to the switchboard.</p>';

  h += field("Role", '<select class="select" data-f="role">' +
    '<option value="coordinator"' + (c.role === "admin" ? "" : " selected") + ">Coordinator \u00b7 their own panel</option>" +
    '<option value="admin"' + (c.role === "admin" ? " selected" : "") + ">Administrator \u00b7 every panel, manages the team</option>" +
    "</select>" +
    '<span class="field__h">A coordinator sees only the patients assigned to them, and can only message those patients.</span>');

  if (!isNew) {
    h += field("Account", '<select class="select" data-f="active">' +
      '<option value="1"' + (c.active ? " selected" : "") + ">Active</option>" +
      '<option value="0"' + (c.active ? "" : " selected") + ">Deactivated \u00b7 cannot sign in</option></select>");
  }

  h += '<button class="btn btn--primary btn--full" id="cSave">' + (isNew ? "Create the account" : "Save") + "</button>";

  if (!isNew) {
    h += '<button class="btn btn--outline btn--full" id="cPw" style="margin-top:8px">Reset their password</button>';
    if (c.patients) {
      h += '<button class="btn btn--ghost btn--full" data-act="reassign" data-from="' + c.id +
           '" style="margin-top:8px">Move their ' + c.patients + " patient" + (c.patients === 1 ? "" : "s") +
           " to someone else</button>";
    }
  }

  openModal(isNew ? "Add a coordinator" : c.name, h, function (root) {
    $("#cSave", root).addEventListener("click", async function () {
      var payload = { id: isNew ? null : c.id };
      $$("[data-f]", root).forEach(function (el) { payload[el.dataset.f] = el.value; });
      if (payload.active !== undefined) payload.active = Number(payload.active);
      try {
        var r = await api("/api/admin/team-save", payload);
        closeModal();
        await refresh(); render();
        if (r.password) showPassword(payload.name, payload.email, r.password, true);
        else toast("Saved.");
      } catch (e) { toast(e.message); }
    });

    var pw = $("#cPw", root);
    if (pw) pw.addEventListener("click", async function () {
      if (!confirm("Reset the password for " + c.name + "? They will be signed out everywhere and will need the new one to get back in.")) return;
      try {
        var r = await api("/api/admin/team-password", { id: c.id });
        closeModal();
        showPassword(c.name, c.email, r.password, false);
      } catch (e) { toast(e.message); }
    });
  });
}

/* Shown once. The password is stored only as a salted hash, so there is no
   screen anywhere that can show it again. */
function showPassword(name, email, pw, isNew) {
  var h = "<p>" + (isNew ? "The account is created." : "The password is reset.") +
    " Give " + esc(name) + " these details. <strong>This password is shown once</strong> and cannot be looked up again. If it is lost, reset it.</p>";
  h += '<div class="codebox"><span class="codebox__l">Sign in at</span>' +
       '<span class="codebox__v">' + esc(location.origin) + "/console/</span></div>";
  h += '<div class="codebox"><span class="codebox__l">Email</span>' +
       '<span class="codebox__v">' + esc(email) + "</span></div>";
  h += '<div class="codebox"><span class="codebox__l">Password</span>' +
       '<span class="codebox__v">' + esc(pw) + "</span></div>";
  h += '<button class="btn btn--primary btn--full" id="pwCopy" style="margin-top:10px">Copy all three</button>';
  openModal("Their sign-in details", h, function (root) {
    $("#pwCopy", root).addEventListener("click", function () {
      var text = "Heartland console\n" + location.origin + "/console/\n" +
                 "Email: " + email + "\nPassword: " + pw;
      navigator.clipboard.writeText(text).then(function () { toast("Copied."); },
                                               function () { toast("Could not copy."); });
    });
  });
}

function reassignModal(from) {
  var label;
  if (from === "unassigned") {
    label = UNASSIGNED + " unassigned patient" + (UNASSIGNED === 1 ? "" : "s");
  } else {
    var c = TEAM.filter(function (x) { return String(x.id) === String(from); })[0];
    label = c ? c.patients + " patient" + (c.patients === 1 ? "" : "s") + " from " + c.name : "this panel";
  }

  var choices = TEAM.filter(function (c2) { return c2.active && String(c2.id) !== String(from); });
  if (!choices.length) return toast("There is no other active coordinator to move them to.");

  var h = "<p>Move " + esc(label) + " to:</p>";
  h += field("Coordinator", '<select class="select" id="reTo">' +
    choices.map(function (c3) {
      return '<option value="' + c3.id + '">' + esc(c3.name) + " \u00b7 " + c3.patients + " now</option>";
    }).join("") + "</select>");
  h += '<p class="field__h">The patients keep everything else. What changes is the name and direct line they see in their app, and whose list they appear on.</p>';
  h += '<button class="btn btn--primary btn--full" id="reGo" style="margin-top:6px">Move them</button>';

  openModal("Move a panel", h, function (root) {
    $("#reGo", root).addEventListener("click", async function () {
      try {
        var r = await api("/api/admin/team-reassign", { from: from, to: $("#reTo", root).value });
        closeModal(); await refresh(); render();
        toast(r.moved + " moved to " + r.to + ".");
      } catch (e) { toast(e.message); }
    });
  });
}

/* ==========================================================================
   Events
   ========================================================================== */

document.addEventListener("click", function (e) {
  const nav = e.target.closest(".navbtn");
  if (nav) { VIEW = nav.dataset.view; return render(); }

  if (e.target.closest("[data-close]")) return closeModal();

  const act = e.target.closest("[data-act]");
  if (!act) return;
  const a = act.dataset.act;
  if (a === "refresh") {
    return refresh().then(render).then(function () { return pulse(true); })
      .then(function () { toast("Updated."); });
  }
  if (a === "profile") { VIEW = "me"; return render(); }
  if (a === "answer") return answerModal(act.dataset.id, act.dataset.pid);
  if (a === "edit") return patientModal(act.dataset.id);
  if (a === "article") return articleModal(act.dataset.id);
  if (a === "coord") return coordModal(act.dataset.id);
  if (a === "setup") { closeModal(); return setupModal(act.dataset.id); }
  if (a === "pview") { closeModal(); return patientView(act.dataset.id); }
  if (a === "pdel") return deletePatient(act.dataset.id);
  if (a === "su-approve") return signupDecide(act.dataset.id, "approve");
  if (a === "su-reject") return signupDecide(act.dataset.id, "reject");
  if (a === "su-link") return signupDecide(act.dataset.id, "link", act.dataset.target);
  if (a === "pw-reset") return patientPassword(act.dataset.id);
  if (a === "ck-history") { closeModal(); return ckHistory(act.dataset.id); }
  if (a === "ck-seen") {
    return api("/api/admin/checkin-seen", { id: Number(act.dataset.id) })
      .then(function () { return refresh(); }).then(render)
      .then(function () { toast("Marked handled."); })
      .catch(function (e) { toast(e.message); });
  }
  if (a === "reassign") { closeModal(); return reassignModal(act.dataset.from); }
  if (a === "panel-clear") { PANEL = ""; return refresh().then(render); }
  if (a === "message") {
    VIEW = "compose";
    $$(".navbtn").forEach(function (b) { b.classList.toggle("is-active", b.dataset.view === "compose"); });
    $("#main").innerHTML = viewCompose();
    wireCompose(act.dataset.id);
    window.scrollTo(0, 0);
    return;
  }
});

document.addEventListener("change", function (e) {
  if (e.target && e.target.id === "panelSel") {
    PANEL = e.target.value;
    refresh().then(render);
  }
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && !$("#modal").hidden) closeModal();
});

boot();

})();
