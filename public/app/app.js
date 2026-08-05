/* ==========================================================================
   Heartland — patient app.

   Home / Messages / Learn / Clinic.
   The device stores only the enrolment token. Everything else comes from the
   server on demand, so nothing clinical sits in this browser.
   ========================================================================== */
(function () {
"use strict";

var TOKEN_KEY = "hmh.token";
var API = "/api/p";

var token = null;
var current = "home";
var HOME = null;
var THREAD = [];
var ARTICLES = [];
var YOU = null;                 /* check-ins, logs, trend, symptom list */
var DRAFT = { energy: 0, mood: 0, sleep: 0, libido: 0, symptoms: [] };
/* A snapshot of DRAFT as it was last saved. Tapping a number changes nothing on
   the server, so the screen has to say so; without this a man taps six numbers,
   closes the app and loses all of it believing he recorded his day. */
var SAVED = null;

/* ---- clinic facts, from heartlandmenshealth.com ---- */
/* No general clinic number in the patient app. Patients reach their own named
   coordinator, or use the in-app question. The only number here is the priapism
   line, which is a genuine medical emergency. */

/* A phone number in the form an sms: or tel: link should carry.

   E.164 (+1816...) is what every phone resolves without ambiguity. A bare
   ten-digit number works on a US handset with a US SIM and is a coin flip
   anywhere else, including for a patient travelling.

   THE THREE-DIGIT CASE IS WHY THIS IS A FUNCTION AND NOT A REGEX INLINE.
   911 and 988 are rendered as tel: links in this app, and "+1911" does not
   dial anything. Short codes are handed back untouched; only a real
   ten-digit North American number gets the country code.  */
function dial(v) {
  var s = String(v == null ? "" : v).trim();
  if (s.charAt(0) === "+") return s.replace(/[^0-9+]/g, "");
  var d = s.replace(/[^0-9]/g, "");
  if (d.length === 10) return "+1" + d;            /* 913-431-2757 */
  if (d.length === 11 && d.charAt(0) === "1") return "+" + d;
  return d;                                        /* 911, 988, anything else */
}

var EMERGENCY = "844-981-4996";
var TEXT_LINE = "913-431-2757";   /* clinic text line, everyone sees it */
var PORTAL = "https://patientportal.advancedmd.com/150527/account/logon";
var CLINICS = [
  { name: "Overland Park", addr: "4601 W. 109th St., Suite 325", city: "Overland Park, KS 66211" },
  { name: "Independence", addr: "4911 S. Arrowhead Dr., Suite 304", city: "Independence, MO 64055" },
  { name: "North Kansas City", addr: "4150 N. Mulberry Dr., Suite 140", city: "Kansas City, MO 64116" }
];

/* ==========================================================================
   Utilities
   ========================================================================== */

function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/* Bodies are plain text written by a coordinator or a patient. Escape first,
   then turn blank lines into paragraphs. Never inject raw HTML. */
function paragraphs(text) {
  return String(text || "").split(/\n\s*\n/).map(function (p) {
    return "<p>" + esc(p.trim()).replace(/\n/g, "<br>") + "</p>";
  }).join("");
}

function fmtDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}
function fmtShort(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtWeekday(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
function relDay(ts) {
  var d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return d + " days ago";
  return fmtShort(ts);
}
function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

function toast(msg) {
  var t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._t);
  t._t = setTimeout(function () { t.hidden = true; }, 3200);
}

var ARROW = '<span class="btn__arrow"><svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true"><path d="M2 7h9M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
var CHEV = '<svg class="row__chev" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="m7.5 4 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* A call button ONLY when this patient has a coordinator with a direct line.
   Never falls back to a general number. Returns "" otherwise. */
/* Opens the PATIENT's mail app addressed to their coach. Nothing clinical in
   the subject: it travels unencrypted and shows in lock-screen previews. */
function emailCoordinator(cls) {
  var c = HOME && HOME.coordinator;
  if (!c || !c.email) return "";
  return '<a class="btn ' + (cls || "btn--outline") + '" href="mailto:' +
    encodeURIComponent(c.email) + "?subject=" + encodeURIComponent("Heartland Men's Health") +
    '">' + ARROW + "Email " + esc(c.name.split(" ")[0]) + "</a>";
}

function callCoordinator(label, cls) {
  var c = HOME && HOME.coordinator;
  if (!c || !c.phone) return "";
  return '<a class="btn ' + (cls || "btn--primary") + '" href="tel:' +
    esc(dial(c.phone)) + '">' + ARROW +
    esc(label || ("Call " + c.name.split(" ")[0])) + "</a>";
}

function sechead(label, first) {
  return '<div class="sechead' + (first ? " sechead--first" : "") + '"><span>' + esc(label) + "</span></div>";
}

async function api(path, body) {
  var res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: Object.assign({ Authorization: "Bearer " + token },
                           body ? { "Content-Type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  if (res.status === 401) { signOut(true); throw new Error("Not enrolled."); }
  if (!res.ok) throw new Error(data.error || "Could not reach the clinic. Try again in a moment.");
  return data;
}

/* ==========================================================================
   Enrolment gate
   ========================================================================== */

function gate(html) {
  $("#gateBody").innerHTML = html;
  $("#gate").hidden = false;
  $("#app").hidden = true;
}

/* He has his own account. Signing in is the front door; creating one is the
   other tab. The clinic-issued code still exists behind "Other ways in",
   because a man standing at the desk who cannot remember an email address is
   a real situation and it costs one link to keep it working. */
function gateWaiting(mode) {
  var creating = mode === "create";
  gate(
    '<p class="eyebrow">Heartland Men\'s Health</p>' +
    '<h1 class="display">' + (creating ? "Create your<br>account" : "Sign in") + "</h1>" +
    '<div class="tabs2">' +
      '<button class="tab2' + (creating ? "" : " is-on") + '" data-act="gate-signin">Sign in</button>' +
      '<button class="tab2' + (creating ? " is-on" : "") + '" data-act="gate-create">Create account</button>' +
    "</div>" +
    (creating ? gateCreateFields() : gateSignInFields()) +
    '<p class="formerr" id="gateErr" hidden></p>' +
    '<button class="btn btn--primary" data-act="' + (creating ? "do-register" : "do-login") + '">' +
      ARROW + (creating ? "Create my account" : "Sign in") + "</button>" +
    '<button class="gatelink" data-act="gate-code">I was given a setup code</button>' +
    '<a class="gateout" href="/console/">Clinic staff sign in &rarr;</a>'
  );
  var first = $("#gEmail") || $("#gFirst");
  if (first) first.focus();
  $$("#gate input").forEach(function (el) {
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); creating ? doRegister() : doLogin(); }
    });
  });
}

function gateSignInFields() {
  return '<p class="lede">Use the email address and password you chose.</p>' +
    '<label class="field"><span class="field__l">Email</span>' +
      '<input class="input" id="gEmail" type="email" autocomplete="username" ' +
      'inputmode="email" autocapitalize="off" spellcheck="false"></label>' +
    '<label class="field"><span class="field__l">Password</span>' +
      '<input class="input" id="gPass" type="password" autocomplete="current-password"></label>';
}

function gateCreateFields() {
  return '<p class="lede">Takes a minute. Your details have to match what the clinic has, ' +
    "so use the name and mobile number they know you by.</p>" +
    '<div class="pair">' +
      '<label class="field"><span class="field__l">First name</span>' +
        '<input class="input" id="gFirst" autocomplete="given-name"></label>' +
      '<label class="field"><span class="field__l">Last name</span>' +
        '<input class="input" id="gLast" autocomplete="family-name"></label>' +
    "</div>" +
    '<label class="field"><span class="field__l">Date of birth</span>' +
      '<input class="input" id="gDob" type="date" autocomplete="bday"></label>' +
    '<label class="field"><span class="field__l">Mobile number</span>' +
      '<input class="input" id="gPhone" type="tel" inputmode="tel" autocomplete="tel" ' +
      'placeholder="816-555-0142"></label>' +
    '<label class="field"><span class="field__l">Email</span>' +
      '<input class="input" id="gEmail" type="email" autocomplete="username" ' +
      'inputmode="email" autocapitalize="off" spellcheck="false"></label>' +
    '<label class="field"><span class="field__l">Choose a password</span>' +
      '<input class="input" id="gPass" type="password" autocomplete="new-password">' +
      '<span class="field__h">At least 8 characters.</span></label>';
}

/* Kept for the man at the desk who cannot remember which email he used. */
function gateCode() {
  gate(
    '<p class="eyebrow">Heartland Men\'s Health</p>' +
    '<h1 class="display">Enter your<br>setup code</h1>' +
    '<p class="lede">The clinic can give you a six-character code instead.</p>' +
    '<label class="field"><span class="field__l">Setup code</span>' +
      '<input class="input codein" id="setupCode" type="text" inputmode="latin" ' +
      'autocapitalize="characters" autocomplete="off" spellcheck="false" ' +
      'maxlength="7" placeholder="ABC123"></label>' +
    '<p class="formerr" id="codeErr" hidden></p>' +
    '<button class="btn btn--primary" data-act="redeem">' + ARROW + "Connect my phone</button>" +
    '<button class="gatelink" data-act="gate-signin">Back to signing in</button>'
  );
  var box = $("#setupCode");
  if (box) {
    box.addEventListener("input", function () {
      this.value = this.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 6);
    });
    box.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); redeemCode(); }
    });
  }
}

function gateErr(msg) {
  var e = $("#gateErr");
  if (e) { e.textContent = msg; e.hidden = false; }
}

async function doLogin() {
  var email = ($("#gEmail") && $("#gEmail").value || "").trim();
  var pass = ($("#gPass") && $("#gPass").value) || "";
  if (!email || !pass) return gateErr("Enter your email and password.");
  try {
    var r = await postJSON("/login", { email: email, password: pass });
    token = r.token;
    localStorage.setItem(TOKEN_KEY, token);
    if (r.status === "pending") return showPending(r.firstName);
    await start(r.firstName);
  } catch (e) { gateErr(e.message); }
}

async function doRegister() {
  var v = function (id) { return ($("#" + id) && $("#" + id).value || "").trim(); };
  var dob = v("gDob");
  if (!v("gFirst") || !v("gLast")) return gateErr("Enter your first and last name.");
  if (!dob) return gateErr("Enter your date of birth.");
  if (!v("gPhone")) return gateErr("Enter your mobile number.");
  if (!v("gEmail")) return gateErr("Enter your email address.");
  if (($("#gPass").value || "").length < 8) return gateErr("Your password needs at least 8 characters.");
  try {
    var r = await postJSON("/register", {
      first_name: v("gFirst"), last_name: v("gLast"), email: v("gEmail"),
      phone: v("gPhone"), date_of_birth: fromDateValue(dob),
      password: $("#gPass").value
    });
    token = r.token;
    localStorage.setItem(TOKEN_KEY, token);
    if (r.status === "pending") return showPending(r.firstName);
    await start(r.firstName);
  } catch (e) { gateErr(e.message); }
}

/* Noon local, so a date typed anywhere on earth lands on the day he meant. */
function fromDateValue(v) { return v ? new Date(v + "T12:00:00").getTime() : null; }

async function postJSON(path, body) {
  var res = await fetch(API + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) throw new Error(data.error || "Could not reach the clinic. Try again in a moment.");
  return data;
}

/* Signed up, waiting on the clinic. Says nothing about anyone's treatment,
   because at this point the app does not know who he is. */
function showPending(name) {
  gate(
    '<p class="eyebrow">Heartland Men\'s Health</p>' +
    '<h1 class="display">Almost there' + (name ? ",<br>" + esc(name) : "") + "</h1>" +
    '<p class="lede">Your account is made. The clinic is confirming your details, ' +
    "usually the same day. We will let you know the moment it is done.</p>" +
    '<p class="lede">Nothing to do in the meantime. If it has been longer than a day, ' +
    "text us on " + esc(TEXT_LINE) + ".</p>" +
    '<a class="btn btn--primary" href="sms:' + dial(TEXT_LINE) + '">' + ARROW +
      "Text the clinic</a>" +
    '<button class="gatelink" data-act="pending-check">Check again</button>' +
    '<button class="gatelink" data-act="signout">Sign out</button>'
  );
}

async function checkPending() {
  try {
    var r = await api("/status");
    if (r.status === "pending") return toast("Still confirming. We will let you know.");
    if (r.status === "rejected") return gateErr("Please call the clinic about your account.");
    await start(r.firstName);
  } catch (e) { toast(e.message); }
}

async function redeemCode() {
  var box = $("#setupCode"), err = $("#codeErr");
  var code = box ? box.value.trim() : "";
  if (err) err.hidden = true;
  if (code.length !== 6) {
    if (err) { err.textContent = "That code should be six characters."; err.hidden = false; }
    return;
  }
  try {
    var r = await fetch(API + "/enroll-code", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code })
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      if (err) { err.textContent = data.error || "That code did not work."; err.hidden = false; }
      return;
    }
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    await start(data.firstName);
  } catch (e) {
    if (err) { err.textContent = "Could not reach the clinic. Check your signal."; err.hidden = false; }
  }
}

async function tryEnroll(t) {
  gate('<p class="eyebrow">One moment</p><h1 class="display">Setting up</h1>');
  try {
    var r = await fetch(API + "/enroll", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: t })
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) {
      gate('<p class="eyebrow">That did not work</p><h1 class="display">Link not valid</h1>' +
           '<p class="lede">' + esc(data.error || "That setup link cannot be used.") + "</p>" +
           '<a class="btn btn--primary" href="sms:' + dial(TEXT_LINE) + "?&body=" +
             encodeURIComponent("Hi, my Heartland app link did not work. Please send a new one.") +
             '">' + ARROW + "Text us for a new link</a>" +
           '<a class="gateout" href="/console/">Clinic staff sign in &rarr;</a>');
      return;
    }
    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    history.replaceState({}, "", location.pathname);
    await start(data.firstName);
  } catch (e) {
    gate('<p class="eyebrow">No connection</p><h1 class="display">Could not reach the clinic</h1>' +
         '<p class="lede">Check your signal and try again.</p>' +
         '<button class="btn btn--primary" onclick="location.reload()">' + ARROW + "Try again</button>");
  }
}

function signOut(silent) {
  localStorage.removeItem(TOKEN_KEY);
  token = null;
  if (!silent) toast("Removed from this phone");
  gateWaiting();
}

/* ==========================================================================
   Push notifications
   ========================================================================== */

function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
         (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

async function pushState() {
  if (!pushSupported()) {
    return { state: isIOS() && !isStandalone() ? "needs-install" : "unsupported" };
  }
  if (Notification.permission === "denied") return { state: "blocked" };
  var reg = await navigator.serviceWorker.ready;
  var sub = await reg.pushManager.getSubscription();
  return { state: sub ? "on" : "off", sub: sub };
}

function urlB64ToUint8Array(base64String) {
  var padding = "=".repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  var raw = atob(base64);
  var out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function enablePush() {
  try {
    if (!pushSupported()) {
      return toast(isIOS() && !isStandalone()
        ? "Add Heartland to your Home Screen first"
        : "This browser cannot do notifications");
    }
    var perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Notifications stay off");
    var cfg = await (await fetch(API + "/config")).json();
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(cfg.vapidPublicKey)
    });
    var j = sub.toJSON();
    await api("/subscribe", { endpoint: j.endpoint, keys: j.keys });
    toast("Notifications are on");
    render();
  } catch (e) { toast("Could not turn notifications on"); }
}

async function disablePush() {
  try {
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription();
    if (sub) { await api("/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
    toast("Notifications are off");
    render();
  } catch (e) { toast("Could not turn notifications off"); }
}

/* ==========================================================================
   Load + render
   ========================================================================== */

async function loadAll() {
  var r = await Promise.all([api("/home"), api("/messages"), api("/articles")]);
  HOME = r[0];
  THREAD = r[1].messages;
  ARTICLES = r[2].articles;
}

function unreadCount() {
  return THREAD.filter(function (m) { return m.direction === "out" && !m.read_at; }).length;
}

function render() {
  var noUnread = unreadCount() === 0;
  $$("#msgDot, #msgDotSide").forEach(function (d) { d.hidden = noUnread; });
  if (current === "home") renderHome();
  if (current === "messages") renderMessages();
  if (current === "you") renderYou();
  if (current === "learn") renderLearn();
  if (current === "clinic") renderClinic();
}

/* ---------------- home ---------------- */

function renderHome() {
  var h = "";
  var hour = new Date().getHours();
  var greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  /* The photograph lives here. Everything below it sits on flat navy. */
  h += '<header class="hero2">' +
    '<p class="hero2__eyebrow">' + esc(greet) + "</p>" +
    '<h1 class="hero2__name">' + esc(HOME.firstName) + "</h1>" +
    (HOME.vitality
      ? '<p class="hero2__meta"><span class="hero2__badge">' + esc(HOME.vitality.label) +
        " &middot; " + HOME.vitality.discount + "% off</span></p>"
      : "") +
    "</header>";

  /* --- labs: the thing they most need to know --- */
  var L = HOME.labs;
  if (L && (L.next || L.missed)) {
    /* Labs are walk-in, so this card informs rather than asking them to book. */
    var walkIn = '<p class="cream__sub" style="margin-top:12px">' +
      '<strong style="color:#fff">No appointment needed.</strong><br>' +
      "Walk in Monday to Friday, 8:30 AM to 4:30 PM.</p>";

    if (L.missed) {
      h += '<div class="cream">' +
        '<p class="cream__label">Labs were due</p>' +
        '<p class="cream__big">' + esc(L.missed.label) + "</p>" +
        '<hr class="cream__rule">' +
        '<p class="cream__sub">Due ' + esc(fmtDate(L.missed.at)) + ", " +
          esc(plural(L.missed.daysAgo, "day")) + " ago.</p>" +
        walkIn +
        "</div>";
    } else {
      h += '<div class="cream">' +
        '<p class="cream__label">Your next labs</p>' +
        '<p class="cream__big">' + esc(fmtDate(L.next.at)) + "</p>" +
        '<hr class="cream__rule">' +
        '<p class="cream__sub">' + esc(L.next.label) +
        (L.next.inDays === 0 ? " &middot; today"
          : L.next.inDays <= 60 ? " &middot; in " + esc(plural(L.next.inDays, "day")) : "") +
        "</p>" +
        (L.next.inDays <= 21 ? walkIn : "") +
        "</div>";
    }
  }

  /* --- medication supply --- */
  if (HOME.supplyLeft != null) {
    var s = HOME.supplyLeft;
    h += '<div class="card">' +
      '<p class="eyebrow' + (s <= 10 ? "" : " eyebrow--muted") + '">Your medication</p>' +
      '<p class="h1" style="margin-bottom:8px">' +
      (s < 0 ? "Ran out " + esc(plural(Math.abs(s), "day")) + " ago"
        : s === 0 ? "Runs out today" : esc(plural(s, "day")) + " left") + "</p>" +
      (HOME.protocol ? '<p class="muted small" style="margin:0">' + esc(HOME.protocol) + "</p>" : "") +
      (s <= 10 ? (callCoordinator("Call about a refill") ||
                  '<button class="btn btn--primary" data-act="ask">' + ARROW + "Ask for a refill</button>") : "") +
      "</div>";
  }

  /* --- Vitality Circle standing --- */
  if (HOME.vitality) {
    var v = HOME.vitality;
    h += sechead("Vitality Circle");
    h += '<button class="cream cardbtn" data-act="vitality" style="text-align:center">' +
      '<p class="cream__label">Tier 0' + v.tierNumber + " &middot; your standing</p>" +
      '<p class="cream__big">' + esc(v.label) + "</p>" +
      '<p class="cream__sub" style="font-weight:700;color:var(--gold-soft)">' +
        v.discount + "% off renewals, upgrades and add-ons</p>" +
      (v.points != null
        ? '<p class="cream__sub" style="margin-top:6px">' + v.points.toLocaleString() + " lifetime points</p>"
        : "") +
      '<hr class="cream__rule">' +
      '<div class="tiers">' +
      v.ladder.map(function (t) {
        return '<span class="tier' + (t.current ? " is-on" : t.earned ? " is-earned" : "") + '">' +
               esc(t.label) + '<span class="tier__d">' + t.discount + "%</span></span>";
      }).join("") +
      "</div>" +
      (v.progress
        ? '<p class="cream__sub" style="margin-top:14px">' + v.progress.pointsToGo.toLocaleString() +
          " points to " + esc(v.progress.nextLabel) + "</p>"
        : "") +
      '<p class="cream__sub" style="margin-top:14px;color:var(--gold-soft);font-weight:700">See what you get &rarr;</p>' +
      "</button>";
  }

  /* --- financing --- */
  var pay = HOME.payment;
  if (pay && (pay.amount || pay.dueAt || pay.lender)) {
    h += sechead("Your payment plan");
    h += '<div class="card">';
    if (pay.amount || pay.dueAt) {
      h += '<p class="eyebrow' + (pay.dueInDays != null && pay.dueInDays <= 5 ? "" : " eyebrow--muted") + '">Next payment</p>';
      h += '<p class="h1" style="margin-bottom:8px">' +
        (pay.amount ? esc(String(pay.amount).replace(/^\$?/, "$")) : "Payment due") + "</p>";
      if (pay.dueAt) {
        h += '<p class="small muted" style="margin:0 0 4px">Due ' + esc(fmtDate(pay.dueAt)) +
          (pay.dueInDays === 0 ? " &middot; today"
            : pay.dueInDays > 0 ? " &middot; in " + esc(plural(pay.dueInDays, "day")) : "") + "</p>";
      }
    }
    if (pay.lender) {
      h += '<p class="small muted" style="margin:12px 0 0">Financed through <strong style="color:var(--navy)">' +
        esc(pay.lender) + "</strong></p>";
    }
    if (pay.lenderPhone) {
      h += '<a class="btn btn--outline btn--sm" style="margin-top:16px" href="tel:' +
        esc(dial(pay.lenderPhone)) + '">Call ' + esc(pay.lender || "the lender") + "</a>";
    }
    if (pay.lenderUrl) {
      h += '<a class="btn btn--outline btn--sm" style="margin-top:10px" href="' + esc(pay.lenderUrl) +
        '" target="_blank" rel="noopener">Open my account</a>';
    }
    h += '<p class="finetext" style="margin-top:14px">Questions about the balance itself go to ' +
      esc(pay.lender || "your lender") + ". Your coordinator can help with anything about your treatment.</p>";
    h += "</div>";
  }

  /* --- unread from the clinic --- */
  var unread = THREAD.filter(function (m) { return m.direction === "out" && !m.read_at; });
  if (unread.length) {
    h += sechead(unread.length === 1 ? "A message for you" : unread.length + " new messages");
    h += '<div class="card card--flush">';
    unread.slice(0, 3).forEach(function (m) {
      h += '<button class="row" data-act="msg" data-id="' + m.id + '">' +
        '<span class="unread" aria-hidden="true"></span>' +
        '<div class="row__main"><div class="row__t">' + esc(m.title) + "</div>" +
        '<div class="row__s">' + esc(relDay(m.sent_at)) + "</div></div>" + CHEV + "</button>";
    });
    h += "</div>";
  }

  /* --- direct line --- */
  h += sechead("Your care team");
  var co = HOME.coordinator;
  h += '<div class="card">' +
    '<p class="h3">' + (co ? esc(co.name) : "A direct line, not a text message") + "</p>" +
    '<p class="small muted" style="margin:0 0 18px">' +
    (co ? esc(co.title || "Your patient coordinator") + ". Ask about your treatment, your labs or your plan."
        : "Ask your coordinator anything about your treatment, your labs or your plan. Everything stays inside the app.") +
    "</p>" +
    '<button class="btn btn--primary" data-act="ask">' + ARROW + "Ask a question</button>" +
    callCoordinator(null, "btn--outline") +
    emailCoordinator("btn--outline") + "</div>";

  /* --- notifications --- */
  h += '<div id="pushPrompt"></div>';

  /* --- reading --- */
  if (ARTICLES.length) {
    h += sechead("Worth reading");
    var a = ARTICLES[0];
    h += '<button class="card cardbtn" data-act="article" data-id="' + a.id + '">' +
      '<p class="h3" style="margin-bottom:8px">' + esc(a.title) + "</p>" +
      '<p class="small muted" style="margin:0">' + esc(a.summary || "") + "</p></button>";
  }

  /* --- renewal, only when it is close --- */
  if (HOME.renewalInDays != null && HOME.renewalInDays <= 60) {
    h += sechead("Your plan");
    h += '<div class="card"><p class="h3">' +
      (HOME.renewalInDays < 0 ? "Renewal was due" : "Renews in " + esc(plural(HOME.renewalInDays, "day"))) +
      "</p>" +
      '<p class="small muted" style="margin:0 0 18px">' + esc(fmtDate(HOME.renewalAt)) +
      (HOME.agreementMonths ? " &middot; " + HOME.agreementMonths + "-month plan" : "") + "</p>" +
      (callCoordinator("Talk about renewing", "btn--outline btn--sm") ||
       '<button class="btn btn--outline btn--sm" data-act="ask">Talk about renewing</button>') + "</div>";
  }

  $("#homeBody").innerHTML = h;
  paintPushPrompt();
}

async function paintPushPrompt() {
  var box = $("#pushPrompt");
  if (!box) return;
  var st = await pushState();
  if (st.state === "on" || st.state === "unsupported") { box.innerHTML = ""; return; }

  if (st.state === "needs-install") {
    box.innerHTML = sechead("One more step") +
      '<div class="notice">' +
      '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 3v9m0 0 3.2-3.2M10 12 6.8 8.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14.5v1.2A1.3 1.3 0 0 0 5.3 17h9.4a1.3 1.3 0 0 0 1.3-1.3v-1.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
      "<p><strong>Add Heartland to your Home Screen</strong> so we can reach you without texting. Tap Share, then Add to Home Screen.</p></div>";
    return;
  }
  if (st.state === "blocked") {
    box.innerHTML = '<div class="notice notice--quiet">' +
      '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="7.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 5l10 10" stroke="currentColor" stroke-width="1.6"/></svg>' +
      "<p>Notifications are blocked in your phone settings. Turn them back on there if you want us to reach you.</p></div>";
    return;
  }
  box.innerHTML = sechead("Notifications") +
    '<div class="card"><p class="h3">Let us reach you without texting</p>' +
    '<p class="small muted" style="margin:0 0 18px">The alert only says a message is waiting. Nothing about your treatment shows on your lock screen.</p>' +
    '<button class="btn btn--primary" data-act="push-on">' + ARROW + "Turn on notifications</button></div>";
}

/* ---------------- messages: one thread with the coordinator ---------------- */

function renderMessages() {
  var h = "";
  h += '<button class="btn btn--primary" data-act="ask" style="margin-bottom:24px">' + ARROW + "Ask a question</button>";

  if (!THREAD.length) {
    h += '<div class="card"><div class="empty"><p class="h3">Nothing yet</p>' +
         '<p class="small muted" style="margin:0">Messages from your care team land here, and anything you ask goes straight to your coordinator.</p></div></div>';
  } else {
    h += '<div class="thread">';
    THREAD.slice().reverse().forEach(function (m) {
      var mine = m.direction === "in";
      var cls = mine ? "bubble bubble--out" : "bubble bubble--in" + (m.read_at ? "" : " bubble--unread");
      h += '<div class="' + cls + '">';
      h += '<p class="bubble__who">' + (mine ? "You asked" : esc(m.title || "Your care team")) + "</p>";
      h += '<div class="bubble__body">' + paragraphs(m.body) + "</div>";
      h += '<p class="bubble__when">' + esc(relDay(m.sent_at)) + "</p>";
      h += "</div>";
    });
    h += "</div>";
  }
  $("#messagesBody").innerHTML = h;
  markThreadRead();
}

/* Opening the thread marks what the clinic sent as read. */
async function markThreadRead() {
  var unread = THREAD.filter(function (m) { return m.direction === "out" && !m.read_at; });
  if (!unread.length) return;
  for (var i = 0; i < unread.length; i++) {
    var m = unread[i];
    m.read_at = Date.now();
    try { await api("/message-read", { id: m.id }); } catch (e) { /* retried next load */ }
  }
  $$("#msgDot, #msgDotSide").forEach(function (d) { d.hidden = true; });
}

async function openMessage(id) {
  var m = THREAD.filter(function (x) { return String(x.id) === String(id); })[0];
  if (!m) return;
  var h = '<p class="eyebrow">' + esc(fmtWeekday(m.sent_at)) + "</p>";
  h += '<div class="prose">' + paragraphs(m.body) + "</div>";
  if (m.article_id) {
    var a = ARTICLES.filter(function (x) { return x.id === m.article_id; })[0];
    if (a) h += '<button class="btn btn--outline" data-act="article" data-id="' + a.id + '" style="margin-top:22px">Read: ' + esc(a.title) + "</button>";
  }
  h += '<button class="btn btn--primary" data-act="ask" style="margin-top:12px">' + ARROW + "Reply to your coordinator</button>";
  openSheet(m.title, h);

  if (!m.read_at) {
    m.read_at = Date.now();
    try { await api("/message-read", { id: m.id }); } catch (e) {}
    render();
  }
}

function sheetVitality() {
  var v = HOME.vitality;
  if (!v) return;
  var h = '<p class="eyebrow">Tier 0' + v.tierNumber + "</p>";
  h += '<p class="display" style="font-size:34px;margin-bottom:6px">' + esc(v.label) + "</p>";
  h += '<p class="lede">Exclusive benefits, for life. Your points never expire and your tier never resets. ' +
       "Once you have earned a tier you never move backward.</p>";

  h += '<div class="cream" style="text-align:left">';
  h += '<p class="cream__label">What you get at ' + esc(v.label) + "</p>";
  h += '<ul style="margin:0;padding-left:20px;line-height:1.65">';
  h += "<li><strong>" + v.discount + "%</strong> off renewals, upgrades and add-ons</li>";
  v.universal.forEach(function (u) { h += "<li>" + esc(u) + "</li>"; });
  if (v.trial) h += "<li>Annual free benefit: " + esc(v.trial) + "</li>";
  if (v.treatments) h += "<li>Eligible treatments: " + esc(v.treatments) + "</li>";
  h += "</ul></div>";

  h += sechead("The whole ladder");
  h += '<div class="card card--flush">';
  v.ladder.forEach(function (t, i) {
    h += '<div class="row row--static">' +
      '<span class="rung' + (t.current ? " is-on" : t.earned ? " is-earned" : "") + '">' + (i + 1) + "</span>" +
      '<div class="row__main"><div class="row__t">' + esc(t.label) +
        (t.current ? '  <span class="nowbadge">You are here</span>' : "") + "</div>" +
      '<div class="row__s">' + t.discount + "% off renewals, upgrades and add-ons</div></div></div>";
  });
  h += "</div>";

  h += '<p class="small muted" style="margin-top:18px">You earn one point for every dollar you invest in your care, ' +
       "across treatments, renewals and additional services.</p>";
  h += '<p class="finetext" style="margin-top:14px">' + esc(v.footnote) + "</p>";
  h += '<button class="btn btn--primary" data-act="ask" style="margin-top:20px">' + ARROW + "Ask about my tier</button>";
  openSheet("Vitality Circle", h);
}

function sheetAsk() {
  openSheet("Ask your coordinator",
    '<p class="small muted" style="margin:0 0 20px">This goes to your patient coordinator at Heartland, not to a group inbox. ' +
    "They answer during clinic hours, Monday to Friday.</p>" +
    '<label class="field"><span class="field__l">Your question</span>' +
    '<textarea class="textarea" id="askBody" placeholder="Ask about your labs, your medication, your plan, or anything you want explained."></textarea></label>' +
    '<button class="btn btn--primary" id="askSend">' + ARROW + "Send to my coordinator</button>" +
    '<div class="notice notice--alert" style="margin-top:20px">' +
    '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 2.6 18.2 17H1.8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8v3.4M10 14.1v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
    "<p>This is not monitored around the clock. If something is urgent, call your coordinator. In an emergency call 911.</p></div>",
    function (root) {
      $("#askSend", root).addEventListener("click", async function () {
        var body = $("#askBody", root).value.trim();
        if (!body) return toast("Write your question first");
        this.disabled = true;
        try {
          await api("/ask", { body: body });
          closeSheet();
          toast("Sent to your coordinator");
          await loadAll();
          render();
        } catch (e) { toast(e.message); this.disabled = false; }
      });
    });
}

/* ---------------- learn ---------------- */

var STUDIES = null;         // null = not searched yet
var STUDY_TERM = "";
var STUDY_BUSY = false;
var STUDY_TOTAL = 0;

function renderLearn() {
  var h = "";

  /* --- research lookup --- */
  h += sechead("Look up research", true);
  h += '<div class="card">';
  h += '<p class="small muted" style="margin:0 0 14px">Search PubMed, the US National Library of Medicine\'s database of published research. ' +
       "Useful for reading around your treatment. It is not advice about you, and your coordinator can talk you through anything you find.</p>";
  h += '<div class="searchrow">' +
    '<input class="input" id="studyQ" type="search" placeholder="e.g. testosterone therapy cardiovascular" value="' + esc(STUDY_TERM) + '">' +
    '<button class="btn btn--primary" data-act="study-search">Search</button></div>';
  if (STUDY_BUSY) h += '<p class="small muted" style="margin:10px 0 0">Searching PubMed…</p>';
  else if (STUDIES && !STUDIES.length) h += '<p class="small muted" style="margin:10px 0 0">Nothing found for that. Try fewer words.</p>';
  h += "</div>";

  if (STUDIES && STUDIES.length) {
    h += '<div class="resulthead"><span>' + STUDY_TOTAL.toLocaleString() +
      ' results, showing the ' + STUDIES.length + ' most relevant</span>' +
      '<a href="https://pubmed.ncbi.nlm.nih.gov/?term=' + encodeURIComponent(STUDY_TERM) +
      '" target="_blank" rel="noopener">See all on PubMed &#8599;</a></div>';
    STUDIES.forEach(function (st) {
      h += '<a class="study" href="' + esc(st.url) + '" target="_blank" rel="noopener">' +
        '<p class="study__t">' + esc(st.title) + "</p>" +
        '<p class="study__m">' + (st.authors ? esc(st.authors) + " &middot; " : "") +
        '<span class="study__j">' + esc(st.journal) + "</span>" +
        (st.year ? " &middot; " + esc(st.year) : "") + " &middot; PMID " + esc(st.pmid) + "</p></a>";
    });
  }
  if (!ARTICLES.length) {
    h += '<div class="card"><div class="empty"><p class="h3">Nothing published yet</p>' +
        '<p class="small muted" style="margin:0">Your clinic posts guidance here.</p></div></div>';
  } else {
    var cats = {};
    ARTICLES.forEach(function (a) {
      var c = a.category || "General";
      (cats[c] = cats[c] || []).push(a);
    });
    Object.keys(cats).forEach(function (c) {
      h += sechead(c);
      h += '<div class="card card--flush">';
      cats[c].forEach(function (a) {
        h += '<button class="row" data-act="article" data-id="' + a.id + '">' +
          '<div class="row__main"><div class="row__t">' + esc(a.title) + "</div>" +
          (a.summary ? '<div class="row__s">' + esc(a.summary) + "</div>" : "") + "</div>" + CHEV + "</button>";
      });
      h += "</div>";
    });
  }
  $("#learnBody").innerHTML = h;
}

async function openArticle(id) {
  try {
    var r = await api("/article", { id: Number(id) });
    var a = r.article;
    var cites = [];
    try { cites = a.citations ? JSON.parse(a.citations) : []; } catch (e) { cites = []; }

    openSheet(a.title,
      (a.summary ? '<p class="lede">' + esc(a.summary) + "</p>" : "") +
      '<div class="prose">' + paragraphs(a.body) + "</div>" +
      (cites.length
        ? sechead("Sources") +
          '<div class="cites">' +
          cites.map(function (c) {
            return '<a class="cite" href="' + esc(c.url) + '" target="_blank" rel="noopener">' +
                   esc(c.label) + '<span class="cite__go">&#8599;</span></a>';
          }).join("") +
          '<p class="finetext" style="margin-top:12px">Published research this is based on. ' +
          "Opens on doi.org.</p></div>"
        : "") +
      '<button class="btn btn--outline" data-act="ask" style="margin-top:24px">Ask a question about this</button>' +
      '<p class="finetext" style="margin-top:20px">General information from your clinic, not medical advice about you. ' +
      "Talk to your provider about your own treatment.</p>");
  } catch (e) { toast(e.message); }
}

async function runStudySearch() {
  var box = $("#studyQ");
  var q = box ? box.value.trim() : "";
  if (!q) return toast("Type what you want to read about");
  STUDY_TERM = q;
  STUDY_BUSY = true;
  renderLearn();
  try {
    var r = await api("/studies", { q: q });
    STUDIES = r.studies;
    STUDY_TOTAL = r.total || r.studies.length;
  } catch (e) {
    STUDIES = [];
    toast(e.message);
  }
  STUDY_BUSY = false;
  renderLearn();
}

/* ---------------- clinic ---------------- */

function renderClinic() {
  var h = "";

  h += '<div class="notice notice--alert">' +
    '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 2.6 18.2 17H1.8Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8v3.4M10 14.1v.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
    "<p><strong>An erection lasting 4 hours or more is an emergency.</strong> It can cause permanent damage. Call the priapism line now, or go to an emergency room.</p></div>";
  h += '<a class="btn btn--primary" href="tel:' + dial(EMERGENCY) + '">' + ARROW + "Call " + EMERGENCY + "</a>";

  h += sechead("Get in touch");
  h += '<div class="actions">';
  h += '<button class="btn btn--gold" data-act="ask">' + ARROW + "Message my coordinator</button>";
  h += callCoordinator(null, "btn--outline");
  h += emailCoordinator("btn--outline");
  h += '<a class="btn btn--outline" href="sms:' + dial(TEXT_LINE) + '">Text the clinic on ' + TEXT_LINE + "</a>";
  h += '<a class="btn btn--outline" href="' + PORTAL + '" target="_blank" rel="noopener">Open the patient portal</a>';
  h += '</div>';

  h += sechead("Hours");
  h += '<div class="card"><p style="margin:0">Monday to Friday, 8:30 AM to 5:00 PM.</p>' +
       '<p class="small muted" style="margin:10px 0 0">Walk-ins welcome until 3:30 PM. Booking keeps your wait short. ' +
       "Same-day and next-day appointments are usually available.</p></div>";

  h += sechead("Our locations");
  h += '<div class="locations">';
  CLINICS.forEach(function (c) {
    var q = encodeURIComponent(c.addr + ", " + c.city);
    h += '<div class="cream" style="padding:20px">' +
      '<p class="cream__label" style="margin-bottom:8px">' + esc(c.name) + "</p>" +
      '<p class="cream__sub" style="margin-bottom:16px">' + esc(c.addr) + "<br>" + esc(c.city) + "</p>" +
      '<a class="btn btn--oncream btn--sm" href="https://maps.google.com/?q=' + q + '" target="_blank" rel="noopener">Directions</a>' +
      "</div>";
  });
  h += '</div>';

  h += sechead("This app");
  h += '<div class="card" id="settingsCard"></div>';

  h += '<div class="card"><p class="finetext">' +
    "<strong>This app does not give medical advice, diagnose anything, or decide what you are eligible for.</strong> " +
    "Messages are not monitored continuously and response times are not guaranteed. " +
    "For chest pain, trouble breathing, stroke symptoms, a severe allergic reaction or thoughts of suicide, call 911.</p>" +
    '<p class="finetext" style="margin-top:12px">Featured therapies are compounded and have not been approved or evaluated ' +
    "for safety, effectiveness or quality by the FDA. They are dispensed by state-licensed compounding pharmacies.</p>" +
    '<p class="finetext" style="margin-top:12px">Heartland Men\'s Health is a Promeniq Restorative Health partner practice.</p></div>';

  $("#clinicBody").innerHTML = h;
  paintSettings();
}

async function paintSettings() {
  var box = $("#settingsCard");
  if (!box) return;
  var st = await pushState();
  var h = '<p class="h3">Notifications</p>';
  if (st.state === "on") {
    h += '<p class="small muted" style="margin:0 0 16px">On. We will tell you when your coordinator sends something.</p>' +
         '<button class="btn btn--outline btn--sm" data-act="push-off">Turn off</button>';
  } else if (st.state === "needs-install") {
    h += '<p class="small muted" style="margin:0 0 16px">Add this app to your Home Screen first. Tap Share, then Add to Home Screen.</p>';
  } else if (st.state === "blocked") {
    h += '<p class="small muted" style="margin:0 0 16px">Blocked in your phone settings. Turn them back on there.</p>';
  } else if (st.state === "unsupported") {
    h += '<p class="small muted" style="margin:0 0 16px">This browser cannot show notifications.</p>';
  } else {
    h += '<p class="small muted" style="margin:0 0 16px">Off. Turn them on and we can reach you without texting.</p>' +
         '<button class="btn btn--outline btn--sm" data-act="push-on">Turn on</button>';
  }
  h += '<p class="h3" style="margin-top:26px">This device</p>' +
       '<p class="small muted" style="margin:0 0 16px">Removing the app from this phone does not affect your record at the clinic.</p>' +
       '<button class="btn btn--ghost btn--sm" data-act="signout">Remove Heartland from this phone</button>';
  box.innerHTML = h;
}

/* ==========================================================================
   Sheet
   ========================================================================== */

function openSheet(title, html, after) {
  $("#sheetTitle").textContent = title;
  $("#sheetBody").innerHTML = html;
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
  $("#sheetBody").scrollTop = 0;
  if (after) after($("#sheetBody"));
}
function closeSheet() {
  $("#sheet").hidden = true;
  document.body.style.overflow = "";
}


/* ==========================================================================
   How you're doing.

   Four numbers, a symptom list, and a box for his own words. The numbers are
   for the trend; the words are the thing that actually helps, so the box is
   not optional-looking and nothing rewrites what he types.

   The red symptoms do not wait for the clinic. Ticking one puts the number he
   needs on this screen, immediately, because a coordinator is not on duty at
   2am and "we'll get back to you" is not an answer to chest pain.
   ========================================================================== */

/* The six ends of the scale. The server owns the field list and the range;
   this only supplies the words at each end, because "1" and "10" alone tell a
   man nothing about which direction is bad. */
var ENDS = {
  energy:    { low: "Running on empty",   high: "Plenty in the tank" },
  mood:      { low: "Rough",              high: "Good" },
  sleep:     { low: "Barely slept",       high: "Slept well" },
  libido:    { low: "No interest",        high: "Strong" },
  strength:  { low: "Weak, nothing there", high: "Strong in the gym" },
  cognitive: { low: "Foggy",              high: "Sharp" }
};

function fields() { return (YOU && YOU.fields) || []; }
function scaleMax() { return (YOU && YOU.scaleMax) || 10; }

function tzOffset() { return new Date().getTimezoneOffset(); }

async function loadYou() {
  YOU = await api("/checkin?tz=" + tzOffset());
  DRAFT = { symptoms: [], note: "" };
  fields().forEach(function (f) { DRAFT[f.key] = 0; });
  if (YOU.today) {
    fields().forEach(function (f) { DRAFT[f.key] = Number(YOU.today[f.key]) || 0; });
    DRAFT.symptoms = parseList(YOU.today.symptoms);
    DRAFT.note = YOU.today.note || "";
  }
  SAVED = snapshot();
}

/* Comparable form of what is on screen right now. */
function snapshot() {
  var o = { note: (DRAFT.note || "").trim(), symptoms: DRAFT.symptoms.slice().sort().join(",") };
  fields().forEach(function (f) { o[f.key] = DRAFT[f.key] || 0; });
  return JSON.stringify(o);
}

/* Reads the note straight from the box, so typing counts as an unsaved change
   without waiting for a re-render. */
function liveSnapshot() {
  var box = $("#ckNote");
  var was = DRAFT.note;
  if (box) DRAFT.note = box.value;
  var snap = snapshot();
  DRAFT.note = was;
  return snap;
}

function isDirty() { return SAVED !== null && liveSnapshot() !== SAVED; }

function answeredCount() {
  return fields().filter(function (f) { return DRAFT[f.key] > 0; }).length;
}

/* The status line and the button both depend on saved/unsaved, so they are
   redrawn together rather than by re-rendering the whole screen on every tap. */
function refreshRecordState() {
  var st = $("#ckState"), btn = $("#ckSave"), prog = $("#ckProgress");
  if (!st || !btn) return;
  var dirty = isDirty();
  var done = !!YOU.today;
  var n = answeredCount(), total = fields().length;

  if (prog) prog.textContent = n + " of " + total + " answered";

  if (dirty) {
    st.className = "ckstate ckstate--unsaved";
    st.innerHTML = '<span class="ckstate__dot"></span>Not recorded yet. Tap the button below to save it.';
  } else if (done) {
    st.className = "ckstate ckstate--saved";
    st.innerHTML = '<span class="ckstate__tick" aria-hidden="true"></span>Recorded today at ' +
                   esc(fmtTime(YOU.today.at));
  } else {
    st.className = "ckstate";
    st.innerHTML = "Nothing recorded today yet.";
  }

  /* Settled state says what happened, not what to do. Inviting a tap on a
     button that will not respond is worse than saying nothing. */
  btn.textContent = (!dirty && done) ? "Recorded for today" : "Record today's scores";
  btn.disabled = !dirty && done;
  btn.classList.toggle("btn--done", !dirty && done);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function parseList(v) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || "[]"); } catch (e) { return []; }
}

/* ==========================================================================
   The screen, in the order it is useful:
     1  today's check-in            what he came here to do
     2  anything going on           the symptom list, its own card
     3  if you need help now        always present, never scrolled past
     4  worth reading               matched to whatever he scored lowest
     5  the last two weeks          his own trend
     6  food and training           grouped by day
   Each is its own card. The single long card it started as meant the save
   button sat below thirteen checkboxes, which is a good way to have nobody
   reach it.
   ========================================================================== */

function renderYou() {
  var b = $("#youBody");
  if (!YOU) {
    b.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
    loadYou().then(function () { if (current === "you") renderYou(); })
             .catch(function () {
               b.innerHTML = '<div class="card"><p class="muted">Could not load this right now. Close the app and open it again.</p></div>';
             });
    return;
  }

  var h = "";
  h += cardCheckin();
  h += cardSymptoms();
  h += cardHelp();
  h += cardReading();
  if (YOU.history.length > 1) h += cardTrend();
  h += cardLog("meal", "What you ate", "Eggs and toast, black coffee. Chicken and rice after the gym.",
               "No calorie counting. A few words a day is enough to spot a pattern.");
  h += cardLog("training", "What you did", "Lifted 45 minutes, legs. Walked the dog twice.",
               "Walking counts. So does a week with nothing in it.");
  b.innerHTML = h;
  refreshRecordState();
  var note = $("#ckNote");
  if (note) note.addEventListener("input", refreshRecordState);
}

function cardCheckin() {
  var done = !!YOU.today;
  var max = scaleMax();
  var h = '<div class="card">';
  h += '<div class="ckhead2"><p class="h3">How are you doing today?</p>' +
       '<span class="ckprogress" id="ckProgress">' + answeredCount() + " of " +
       fields().length + " answered</span></div>";
  h += '<p class="ckstate" id="ckState"></p>';
  h += '<p class="muted">About a minute. Best done at the same time each day, before bed.</p>';

  fields().forEach(function (f) {
    var ends = ENDS[f.key] || { low: "Low", high: "High" };
    h += '<div class="scale">';
    h += '<div class="scale__head"><span class="scale__label">' + esc(f.label) + "</span>" +
         '<span class="scale__val" id="v-' + f.key + '">' +
         (DRAFT[f.key] ? DRAFT[f.key] + " of " + max : "\u2014") + "</span></div>";
    h += '<div class="scale__row" role="group" aria-label="' + esc(f.label) + '">';
    for (var i = 1; i <= max; i++) {
      h += '<button class="dot' + (DRAFT[f.key] === i ? " is-on" : "") + '" ' +
           'data-act="scale" data-k="' + f.key + '" data-v="' + i + '" ' +
           'aria-label="' + esc(f.label) + " " + i + " of " + max + '"' +
           ' aria-pressed="' + (DRAFT[f.key] === i ? "true" : "false") + '">' + i + "</button>";
    }
    h += "</div>";
    h += '<div class="scale__ends"><span>' + esc(ends.low) + "</span><span>" +
         esc(ends.high) + "</span></div></div>";
  });

  h += '<div class="field"><label class="field__l" for="ckNote">Anything else? Write it however you want.</label>' +
       '<textarea class="textarea" id="ckNote" placeholder="What kind of week has it been?">' +
       esc(DRAFT.note || "") + "</textarea>" +
       '<span class="field__h">Your coordinator reads this exactly as you wrote it. Nothing is summarized.</span></div>';

  h += '<button class="btn btn--primary btn--full" id="ckSave" data-act="checkin-save">' +
       "Record today's scores</button>";
  h += '<p class="muted" style="margin:14px 0 0">Nothing is saved until you tap that. ' +
       "This is not a way to reach anyone urgently \u2014 if something is wrong right now, use the numbers below.</p>";

  /* Let the clinic remind him, since a daily habit nobody prompts is a daily
     habit that lasts about a week. */
  if (YOU.reminders !== undefined) {
    h += '<label class="remind"><input type="checkbox" id="ckRemind"' +
      (YOU.reminders ? " checked" : "") + ' data-act="remind-toggle">' +
      "<span>Remind me each evening if I have not recorded the day</span></label>";
  }
  return h + "</div>";
}

function cardSymptoms() {
  var reds = YOU.symptoms.filter(function (x) { return x.red; });
  var ambers = YOU.symptoms.filter(function (x) { return !x.red; });
  var h = '<div class="card"><p class="h3">Anything going on?</p>';
  h += '<p class="muted">Leave these blank if none apply. They save with your check-in.</p>';
  /* The two groups mean completely different things and must not look alike.
     One means call 911; the other means mention it. */
  h += '<p class="checkhead checkhead--red">Any of these, get help right away</p>';
  h += '<div class="checks checks--red">';
  reds.forEach(function (x) { h += checkRow(x, true); });
  h += "</div>";
  h += '<p class="checkhead">Worth your coordinator knowing</p>';
  h += '<div class="checks">';
  ambers.forEach(function (x) { h += checkRow(x, false); });
  h += "</div></div>";
  return h;
}

function cardHelp() {
  return '<div class="card card--help">' +
    '<p class="h3">If you need help now</p>' +
    helpRow(YOU.help.emergency.label, YOU.help.emergency.value, "Chest pain, trouble breathing, sudden weakness") +
    helpRow(YOU.help.crisis.label, YOU.help.crisis.value, YOU.help.crisis.note) +
    helpRow(YOU.help.priapism.label, YOU.help.priapism.value, "Heartland's line, any hour") +
    "</div>";
}

/* Reading matched to the numbers he actually put down. A low score with
   nothing behind it is just a bad number; this is the part that answers it. */
function cardReading() {
  if (!YOU.reading || !YOU.reading.length) return "";
  var h = '<div class="card"><p class="h3">About what you flagged</p>';
  h += '<p class="muted">Written for the thing you scored lowest.</p>';
  YOU.reading.forEach(function (r) {
    h += '<button class="readrow" data-act="article" data-id="' + r.id + '">' +
      '<span class="readrow__tag">' + esc(r.label) + " \u00b7 " + r.value + " of " + scaleMax() + "</span>" +
      '<span class="readrow__t">' + esc(r.title) + "</span>" +
      (r.summary ? '<span class="readrow__s">' + esc(r.summary) + "</span>" : "") +
      "</button>";
  });
  return h + "</div>";
}

function cardTrend() {
  var t = YOU.trend, max = scaleMax();
  var h = '<div class="card"><p class="h3">Your last two weeks</p>' +
          '<p class="muted">This week against the week before.</p><div class="trend">';
  fields().forEach(function (f) {
    var d = t[f.key] || {};
    var has = d.delta !== null && d.delta !== undefined;
    var arrow = !has ? "" : d.delta > 0.4 ? "\u2191" : d.delta < -0.4 ? "\u2193" : "\u2192";
    var cls = !has ? "" : d.delta > 0.4 ? " is-up" : d.delta < -0.4 ? " is-down" : "";
    h += '<div class="trend__row"><span class="trend__l">' + esc(f.label) + "</span>" +
         '<span class="trend__v">' + (d.now === null || d.now === undefined ? "\u2014" : d.now) + "</span>" +
         '<span class="trend__d' + cls + '">' + arrow +
         (d.was === null || d.was === undefined ? "" : " from " + d.was) + "</span></div>";
  });
  h += "</div>";

  var days = YOU.history.slice(0, 14).reverse();
  h += '<div class="spark" role="img" aria-label="Your overall score across your last ' + days.length + ' entries">';
  days.forEach(function (d) {
    var v = d.score === null || d.score === undefined ? 0 : Number(d.score);
    h += '<span class="spark__b spark__b--' + (d.level || "ok") + '" style="height:' +
         Math.max(8, v) + '%" title="' + esc(fmtShort(d.at)) + ": " + v + '"></span>';
  });
  h += "</div>";
  h += '<p class="muted">Out of ' + max + '. Higher is better. Amber marks a day you flagged something.</p>';
  return h + "</div>";
}

/* Meals and training, grouped by day. An undated list of forty lines is not
   a record of anything; "yesterday" is what a man actually thinks in. */
function cardLog(kind, title, placeholder, hint) {
  var rows = YOU.logs.filter(function (l) { return l.kind === kind; });
  var h = '<div class="card"><p class="h3">' + esc(title) + "</p>";
  h += '<div class="field">' +
    '<textarea class="textarea textarea--sm" id="add-' + kind + '" placeholder="' +
      esc(placeholder) + '" maxlength="600"></textarea>' +
    '<span class="field__h">' + esc(hint) + "</span></div>";
  h += '<button class="btn btn--outline btn--full" data-act="log-add" data-kind="' + kind + '">Add</button>';

  if (rows.length) {
    var groups = [], seen = {};
    rows.forEach(function (l) {
      if (!seen[l.day]) { seen[l.day] = []; groups.push(l.day); }
      seen[l.day].push(l);
    });
    h += '<div class="logdays">';
    groups.slice(0, 7).forEach(function (day) {
      h += '<p class="logday">' + esc(dayLabel(seen[day][0].at)) + "</p><ul class=\"loglist\">";
      seen[day].forEach(function (l) {
        h += '<li class="loglist__i"><span class="loglist__b">' + esc(l.body) + "</span>" +
             '<button class="loglist__x" data-act="log-del" data-id="' + l.id +
             '" aria-label="Remove this entry">\u00d7</button></li>';
      });
      h += "</ul>";
    });
    h += "</div>";
  }
  return h + "</div>";
}

function dayLabel(ts) {
  var d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function checkRow(x, red) {
  var on = DRAFT.symptoms.indexOf(x.key) !== -1;
  return '<button class="check' + (on ? " is-on" : "") + (red ? " check--red" : "") + '" ' +
    'data-act="sym" data-k="' + x.key + '" aria-pressed="' + (on ? "true" : "false") + '">' +
    '<span class="check__box" aria-hidden="true"></span>' +
    '<span class="check__l">' + esc(x.label) + "</span></button>";
}

function helpRow(label, value, note) {
  return '<a class="helprow" href="tel:' + esc(dial(value)) + '">' +
    '<span class="helprow__l">' + esc(label) + (note ? '<span class="helprow__n">' + esc(note) + "</span>" : "") + "</span>" +
    '<span class="helprow__v">' + esc(value) + "</span></a>";
}

/* ---- actions ---- */

function setScale(k, v) {
  DRAFT[k] = DRAFT[k] === v ? 0 : v;
  $$('[data-act="scale"][data-k="' + k + '"]').forEach(function (btn) {
    var on = Number(btn.dataset.v) === DRAFT[k];
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  var out = $("#v-" + k);
  if (out) out.textContent = DRAFT[k] ? DRAFT[k] + " of " + scaleMax() : "\u2014";
  refreshRecordState();
}

function toggleSymptom(k) {
  var i = DRAFT.symptoms.indexOf(k);
  if (i === -1) DRAFT.symptoms.push(k); else DRAFT.symptoms.splice(i, 1);
  var btn = $('[data-act="sym"][data-k="' + k + '"]');
  if (btn) {
    var on = DRAFT.symptoms.indexOf(k) !== -1;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  /* Ticking a red one answers immediately, before he has saved anything. */
  refreshRecordState();
  var sym = YOU.symptoms.filter(function (x) { return x.key === k; })[0];
  if (sym && sym.red && DRAFT.symptoms.indexOf(k) !== -1) actNow([sym], false);
}

/* The screen that must not wait for a coordinator.
   `told` says whether the clinic has actually been notified yet. Ticking a box
   fires this immediately, BEFORE anything is saved, so at that moment nobody
   has been told and the sheet must not claim otherwise. */
function actNow(list, told) {
  var h = '<p class="urgent__lead">Please do this now. Do not wait for a call back.</p>';
  list.forEach(function (x) {
    h += '<div class="urgent__item"><h3 class="h3">' + esc(x.label) + "</h3>" +
         "<p>" + esc(x.advice) + "</p></div>";
  });
  h += '<div class="urgent__nums">' +
    helpRow("Emergency", "911", "") +
    helpRow("Suicide and Crisis Lifeline", "988", "Call or text, any hour") +
    helpRow("Heartland urgent line", EMERGENCY, "") +
    "</div>";
  h += '<p class="muted">' + (told
    ? "Your coordinator has been told as well. That is not a substitute for the numbers above."
    : "Nothing has been sent to the clinic yet — save your check-in and they will see it. Do not wait for that if you need help now.") +
    "</p>";
  openSheet("This needs attention now", h);
}

async function saveCheckin() {
  var note = ($("#ckNote") && $("#ckNote").value || "").trim();
  DRAFT.note = note;
  if (!answeredCount() && !DRAFT.symptoms.length && !note) {
    return toast("Score at least one of them first.");
  }
  var btn = $("#ckSave");
  if (btn) { btn.disabled = true; btn.textContent = "Recording…"; }
  try {
    var payload = { tz: tzOffset(), symptoms: DRAFT.symptoms, note: note };
    fields().forEach(function (f) { payload[f.key] = DRAFT[f.key] || null; });
    var r = await api("/checkin", payload);
    YOU = null;
    await loadYou();
    renderYou();

    if (r.urgent && r.urgent.length) { actNow(r.urgent, true); return; }
    if (r.level === "ok") { toast("Recorded. That is today done."); return; }
    if (r.crisisText) {
      actNow([{ label: "What you wrote",
                advice: "Call or text 988 to reach the Suicide and Crisis Lifeline, any hour of the day. If you are in immediate danger, call 911." }], true);
      return;
    }
    toast("Recorded, and your coordinator has been told.");
  } catch (e) {
    toast(e.message);
    if (btn) { btn.disabled = false; btn.textContent = "Record today's scores"; }
  }
}

async function toggleReminders(on) {
  try {
    await api("/reminders", { on: on ? 1 : 0 });
    YOU.reminders = on ? 1 : 0;
    toast(on ? "We will remind you in the evening." : "Evening reminders off.");
  } catch (e) { toast(e.message); }
}

async function addLog(kind) {
  var input = $("#add-" + kind);
  var body = (input && input.value || "").trim();
  if (!body) return toast("Write something first.");
  try {
    await api("/log", { kind: kind, body: body, tz: tzOffset() });
    input.value = "";
    YOU = null; await loadYou(); renderYou();
  } catch (e) { toast(e.message); }
}

async function delLog(id) {
  try {
    await api("/log-delete", { id: Number(id) });
    YOU = null; await loadYou(); renderYou();
  } catch (e) { toast(e.message); }
}

/* ==========================================================================
   Navigation + events
   ========================================================================== */

function setScreen(name) {
  current = name;
  $$(".screen").forEach(function (s) { s.hidden = s.id !== "screen-" + name; });
  $$(".tab").forEach(function (t) {
    var on = t.dataset.screen === name;
    t.classList.toggle("is-active", on);
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  render();
  window.scrollTo(0, 0);
}

document.addEventListener("click", function (e) {
  var t = e.target.closest("[data-act], [data-close], .tab");
  if (!t) return;
  if (t.hasAttribute("data-close")) return closeSheet();
  if (t.classList.contains("tab")) return setScreen(t.dataset.screen);

  var a = t.dataset.act;
  if (a === "msg") return openMessage(t.dataset.id);
  if (a === "scale") return setScale(t.dataset.k, Number(t.dataset.v));
  if (a === "sym") return toggleSymptom(t.dataset.k);
  if (a === "checkin-save") return saveCheckin();
  if (a === "remind-toggle") return toggleReminders(t.checked);
  if (a === "log-add") return addLog(t.dataset.kind);
  if (a === "log-del") return delLog(t.dataset.id);
  if (a === "article") { closeSheet(); return openArticle(t.dataset.id); }
  if (a === "ask") { closeSheet(); return sheetAsk(); }
  if (a === "redeem") return redeemCode();
  if (a === "gate-signin") return gateWaiting("signin");
  if (a === "gate-create") return gateWaiting("create");
  if (a === "gate-code") return gateCode();
  if (a === "do-login") return doLogin();
  if (a === "do-register") return doRegister();
  if (a === "pending-check") return checkPending();
  if (a === "vitality") return sheetVitality();
  if (a === "study-search") return runStudySearch();
  if (a === "push-on") return enablePush();
  if (a === "push-off") return disablePush();
  if (a === "signout") {
    if (confirm("Remove Heartland from this phone? You will need a new setup link from the clinic to use it again.")) signOut();
    return;
  }
});

/* Leaving the tab, backgrounding the app, or closing it with numbers on screen
   that were never sent. The browser will not show custom text here, but the
   native prompt is enough to stop the loss. */
window.addEventListener("beforeunload", function (e) {
  if (current === "you" && YOU && isDirty()) { e.preventDefault(); e.returnValue = ""; }
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && !$("#sheet").hidden) closeSheet();
  if (e.key === "Enter" && e.target && e.target.id === "studyQ") {
    e.preventDefault();
    runStudySearch();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", function (e) {
    if (e.data && e.data.type === "refresh" && token) {
      loadAll().then(render).catch(function () {});
    }
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */

async function start(firstName) {
  $("#gate").hidden = true;
  $("#app").hidden = false;
  try {
    await loadAll();
  } catch (e) {
    gate('<p class="eyebrow">No connection</p><h1 class="display">Could not load</h1>' +
         '<p class="lede">' + esc(e.message) + "</p>" +
         '<button class="btn btn--primary" onclick="location.reload()">' + ARROW + "Try again</button>");
    return;
  }
  var deep = new URLSearchParams(location.search).get("m");
  if (deep) history.replaceState({}, "", location.pathname);
  setScreen(deep ? "messages" : "home");
  if (firstName) toast("You are all set, " + firstName);
}

async function boot() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); } catch (e) { /* offline only */ }
  }
  var qs = new URLSearchParams(location.search);
  var enrollParam = qs.get("enroll");
  if (enrollParam) return tryEnroll(enrollParam);
  /* The evening reminder links straight to the check-in, so tapping it does
     not drop him on the home screen to go hunting for the thing he was
     reminded about. */
  if (qs.get("screen") === "you") current = "you";
  token = localStorage.getItem(TOKEN_KEY);
  if (!token) return gateWaiting();
  /* A session can be valid and still be waiting on the clinic. */
  try {
    var st = await api("/status");
    if (st.status === "pending") return showPending(st.firstName);
    if (st.status === "rejected") { return gate(
      '<p class="eyebrow">Heartland Men\'s Health</p><h1 class="display">Call the clinic</h1>' +
      '<p class="lede">We could not confirm this account. Text us on ' + esc(TEXT_LINE) + '.</p>' +
      '<a class="btn btn--primary" href="sms:' + dial(TEXT_LINE) + '">' + ARROW +
      "Text the clinic</a>" +
      '<button class="gatelink" data-act="signout">Sign out</button>'); }
  } catch (e) { /* an old device token predates accounts; carry on */ }
  await start(null);
}

boot();

})();
