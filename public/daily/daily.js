/* ==========================================================================
   Heartland Daily — the free app.

   For men who are not patients. It nudges them to eat, train, wind down and
   move, and it carries whatever the clinic is running this month.

   Two rules shape everything here.

   NOTHING IS ASKED FOR. No name, no email, no account. The phone makes a random
   key on first open and keeps it; that key is how a reminder finds this device
   and it is not a person. A number is only ever taken when he taps "text me
   about this", which is a thing he chose to do.

   NOTHING CLINICAL IS SHOWN. He is not a patient, there is no record, and the
   app must never look like it knows something about his health. That is also
   why its notifications can say exactly what they are, unlike the patient app's.
   ========================================================================== */
(function () {
"use strict";

var KEY = "hmh.daily.key";
var API = "/api/f";
var state = null;

function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function tz() { return new Date().getTimezoneOffset(); }

/* A key the phone keeps. Random, meaningless, and never sent anywhere but here. */
function deviceKey() {
  var k = localStorage.getItem(KEY);
  if (!k) {
    var b = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(b);
    k = btoa(String.fromCharCode.apply(null, b)).replace(/[+/=]/g, "").slice(0, 24);
    localStorage.setItem(KEY, k);
  }
  return k;
}

async function post(path, body) {
  var r = await fetch(API + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(Object.assign({ key: deviceKey(), tz: tz() }, body || {}))
  });
  var d = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(d.error || "Could not reach Heartland. Try again in a moment.");
  return d;
}

function toast(msg) {
  var t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(function () { t.hidden = true; }, 3000);
}
function openSheet(title, html, after) {
  $("#sheetTitle").textContent = title;
  $("#sheetBody").innerHTML = html;
  $("#sheet").hidden = false;
  document.body.style.overflow = "hidden";
  if (after) after($("#sheetBody"));
}
function closeSheet() { $("#sheet").hidden = true; document.body.style.overflow = ""; }

/* ==========================================================================
   Screens
   ========================================================================== */

var GOALS = [
  { key: "eat",   title: "Eat on a schedule",  sub: "Three nudges a day, at times you set." },
  { key: "train", title: "Train",              sub: "A push on the days you mean to go." },
  { key: "sleep", title: "Sleep",              sub: "Wind down, and the same wake time every day." },
  { key: "water", title: "Water and moving",   sub: "Two small ones. They add up." }
];

function render() {
  var m = $("#main");
  if (!state) { m.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>'; return; }
  if (!state.goals.length) return renderOnboard();
  renderHome();
}

/* First open. One screen, no form, nothing to type. */
function renderOnboard() {
  var h = '<div class="hero">' +
    '<p class="eyebrow">Free, from Heartland Men\'s Health</p>' +
    '<h1 class="h1">Pick your<br>battles.</h1>' +
    '<p class="lede">Choose what you want to be better at. Your phone does the nagging. ' +
    "No account, nothing to fill in, free forever.</p></div>";
  h += '<div class="goals">';
  GOALS.forEach(function (g) {
    var on = state.goals.indexOf(g.key) !== -1;
    h += '<button class="goal' + (on ? " is-on" : "") + '" data-act="goal" data-k="' + g.key + '">' +
      '<span class="goal__box" aria-hidden="true"></span>' +
      '<span><span class="goal__t">' + esc(g.title) + "</span>" +
      '<span class="goal__s">' + esc(g.sub) + "</span></span></button>";
  });
  h += "</div>";
  h += '<button class="btn btn--primary btn--full" data-act="start">Start</button>';
  h += '<p class="fine">Heartland Men\'s Health, Kansas City. This is general guidance, ' +
       "not medical advice, and using it does not make you a patient.</p>";
  $("#main").innerHTML = h;
}

function renderHome() {
  var h = "";

  if (state.special) {
    h += '<button class="special" data-act="special">' +
      '<span class="special__tag">This month</span>' +
      '<span class="special__t">' + esc(state.special.title) + "</span>" +
      '<span class="special__b">' + esc(state.special.body) + "</span>" +
      '<span class="special__cta">' + esc(state.special.cta || "Tell me more") + " →</span></button>";
  }

  h += '<div class="card"><p class="h3">Your day</p>';
  var slots = state.slots.filter(function (s) { return state.goals.indexOf(s.goal) !== -1; });
  slots.sort(function (a, b) { return timeOf(a).localeCompare(timeOf(b)); });
  if (!slots.length) h += '<p class="muted">Nothing set. Pick something below.</p>';
  slots.forEach(function (s) {
    h += '<div class="slot"><span class="slot__l">' + esc(s.label) + "</span>" +
      '<input class="slot__t" type="time" value="' + esc(timeOf(s)) + '" data-act="time" data-k="' + s.key + '"></div>';
  });
  h += '<p class="field__h" style="margin-top:12px">Tap a time to change it. Saved as you go.</p>';
  h += "</div>";

  h += '<div class="card"><p class="h3">What you are working on</p><div class="goals goals--tight">';
  GOALS.forEach(function (g) {
    var on = state.goals.indexOf(g.key) !== -1;
    h += '<button class="goal goal--sm' + (on ? " is-on" : "") + '" data-act="goal" data-k="' + g.key + '">' +
      '<span class="goal__box" aria-hidden="true"></span><span class="goal__t">' + esc(g.title) + "</span></button>";
  });
  h += "</div></div>";

  if (!pushOn()) {
    h += '<div class="card card--nudge"><p class="h3">Turn the reminders on</p>' +
      '<p class="muted">Without this the app can show you your times but it cannot actually nudge you.</p>' +
      (isStandalone()
        ? '<button class="btn btn--primary btn--full" data-act="push">Allow notifications</button>'
        : '<p class="muted"><strong>On an iPhone:</strong> tap Share, then Add to Home Screen, and open it from there. ' +
          "Notifications only work from the home-screen icon.</p>") +
      "</div>";
  }

  h += '<div class="card"><p class="h3">Heartland Men\'s Health</p>' +
    '<p class="muted">Low testosterone, weight, and sexual health. Kansas City.</p>' +
    '<a class="btn btn--outline btn--full" href="sms:' + state.textLine.replace(/-/g, "") +
      '?&body=' + encodeURIComponent("Hi, I have some questions about getting started.") +
      '">Text us on ' + esc(state.textLine) + "</a>" +
    '<button class="btn btn--ghost btn--full" data-act="ask" style="margin-top:8px">Have someone call me</button>' +
    "</div>";

  h += '<p class="fine">General guidance, not medical advice. Using this app does not make you ' +
       "a patient and nothing you do here is shared with anyone.</p>";
  $("#main").innerHTML = h;
}

function timeOf(slot) { return state.times[slot.key] || slot.def; }

/* ==========================================================================
   Actions
   ========================================================================== */

async function toggleGoal(k) {
  var i = state.goals.indexOf(k);
  if (i === -1) state.goals.push(k); else state.goals.splice(i, 1);
  render();
  try { await post("/prefs", { goals: state.goals, times: state.times }); }
  catch (e) { toast(e.message); }
}

async function setTime(k, v) {
  state.times[k] = v;
  try { await post("/prefs", { goals: state.goals, times: state.times }); toast("Saved."); }
  catch (e) { toast(e.message); }
}

async function start() {
  if (!state.goals.length) return toast("Pick at least one.");
  try { await post("/prefs", { goals: state.goals, times: state.times }); } catch (e) {}
  render();
  if (isStandalone() && pushSupported()) enablePush();
}

/* The one place anything personal is taken, and only after he asked. */
function askForContact(about) {
  var h = "<p>Leave a number and someone from the clinic will get back to you. " +
    "Nothing is shared with anyone else, and we will not add you to a list.</p>";
  h += '<label class="field"><span class="field__l">Your name</span>' +
       '<input class="input" id="lName" autocomplete="given-name"></label>';
  h += '<label class="field"><span class="field__l">Mobile number</span>' +
       '<input class="input" id="lPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="816-555-0142"></label>';
  h += '<label class="field"><span class="field__l">Anything you want them to know</span>' +
       '<textarea class="textarea" id="lNote" placeholder="Optional"></textarea></label>';
  h += '<p class="formerr" id="lErr" hidden></p>';
  h += '<button class="btn btn--primary btn--full" id="lGo">Ask them to call me</button>';
  openSheet(about === "special" ? "About this month" : "Have someone call you", h, function (root) {
    $("#lGo", root).addEventListener("click", async function () {
      var err = $("#lErr", root); err.hidden = true;
      var phone = $("#lPhone", root).value.trim();
      if (phone.replace(/[^0-9]/g, "").length < 10) {
        err.textContent = "Please give a 10-digit mobile number."; err.hidden = false; return;
      }
      var b = $("#lGo", root); b.disabled = true; b.textContent = "Sending…";
      try {
        await post("/lead", { name: $("#lName", root).value, phone: phone,
                              note: $("#lNote", root).value, about: about || "call" });
        closeSheet();
        toast("Done. Someone will be in touch.");
      } catch (e) {
        err.textContent = e.message; err.hidden = false;
        b.disabled = false; b.textContent = "Ask them to call me";
      }
    });
  });
}

function showSpecial() {
  var s = state.special;
  if (!s) return;
  openSheet(s.title,
    "<p>" + esc(s.body).replace(/\n/g, "<br>") + "</p>" +
    '<button class="btn btn--primary btn--full" data-act="ask-special" style="margin-top:18px">' +
      esc(s.cta || "Have someone call me") + "</button>" +
    '<a class="btn btn--outline btn--full" style="margin-top:8px" href="sms:' +
      state.textLine.replace(/-/g, "") + '?&body=' +
      encodeURIComponent("Hi, I saw " + s.title + " on the Heartland app.") + '">Text instead</a>');
}

/* ---- push ---- */
function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function pushOn() { return localStorage.getItem("hmh.daily.push") === "1"; }

async function enablePush() {
  if (!pushSupported()) return toast("This phone cannot do reminders from the browser.");
  try {
    var perm = await Notification.requestPermission();
    if (perm !== "granted") return toast("Reminders stay off until you allow notifications.");
    var reg = await navigator.serviceWorker.ready;
    var cfg = await (await fetch(API + "/config")).json();
    var raw = atob(cfg.vapidPublicKey.replace(/-/g, "+").replace(/_/g, "/"));
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    var sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: arr });
    await post("/subscribe", { subscription: sub.toJSON() });
    localStorage.setItem("hmh.daily.push", "1");
    toast("Reminders are on.");
    render();
  } catch (e) { toast("Could not turn reminders on."); }
}

document.addEventListener("click", function (e) {
  var t = e.target.closest("[data-act], [data-close]");
  if (!t) return;
  if (t.hasAttribute("data-close")) return closeSheet();
  var a = t.dataset.act;
  if (a === "goal") return toggleGoal(t.dataset.k);
  if (a === "start") return start();
  if (a === "push") return enablePush();
  if (a === "special") return showSpecial();
  if (a === "ask") return askForContact("call");
  if (a === "ask-special") { closeSheet(); return askForContact("special"); }
});
document.addEventListener("change", function (e) {
  if (e.target && e.target.dataset && e.target.dataset.act === "time") {
    setTime(e.target.dataset.k, e.target.value);
  }
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && !$("#sheet").hidden) closeSheet();
});

(async function boot() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); } catch (e) {}
  }
  try {
    state = await post("/hello", {});
    render();
  } catch (e) {
    $("#main").innerHTML = '<div class="card"><p class="muted">Could not reach Heartland. ' +
      "Check your signal and open it again.</p></div>";
  }
})();

})();
