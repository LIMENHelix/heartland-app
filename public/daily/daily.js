/* ==========================================================================
   Heartland Daily — the free app.

   For men who are not patients. Four nudges a day, and one question at the
   end of it.

   Three rules shape everything here.

   NOTHING IS ASKED FOR. No name, no email, no account. The phone makes a random
   key on first open and keeps it; that key is how a reminder finds this device
   and it is not a person. A number is only ever taken when he taps "have
   someone call me", which is a thing he chose to do.

   NOTHING CLINICAL IS SHOWN. He is not a patient, there is no record, and the
   app must never look like it knows something about his health. That is also
   why its notifications can say exactly what they are, unlike the patient app's.

   THERE IS ALWAYS A WAY BACK. Every screen is reachable from the bar at the
   bottom and nothing is a dead end. The first version put the goal picker on
   first open and then never showed it again, so a man who mis-tapped was
   stuck with it. The picker is now just what the Setup tab looks like before
   you have picked anything.
   ========================================================================== */
(function () {
"use strict";

var KEY = "hmh.daily.key";
var API = "/api/f";
var state = null;
var screen = "today";        /* today | rate | setup */
var draft = {};              /* the rating being tapped out, before it is saved */

function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

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
  { key: "eat",   title: "Eat on a schedule",  sub: "Protein at every meal." },
  { key: "train", title: "Train",              sub: "Get to the gym, or get outside." },
  { key: "sleep", title: "Sleep",              sub: "Wind down, same wake time." },
  { key: "water", title: "Water and moving",   sub: "Two small ones. They add up." }
];

function render() {
  var m = $("#main");
  if (!state) { m.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>'; return; }
  /* Never been here before: one screen, no tab bar, pick something and go.

     This tests `started` ONLY. Testing goals.length as well meant that tapping
     the first goal ended onboarding on the spot, because picking one made the
     count non-zero: you could never choose a second thing and the Start button
     was unreachable. `started` is set once, from what the server already had,
     and again when he presses Start. */
  if (!state.started) {
    $("#tabbar").hidden = true;
    document.body.classList.remove("is-inside");
    return renderOnboard();
  }
  $("#tabbar").hidden = false;
  /* Past the front door. The lion drops back a stop, because the working
     screens put small text where the front screen puts a headline: measured,
     the rating screen's intro came out at 2.39:1 against the lit mane. */
  document.body.classList.add("is-inside");
  if (screen === "rate")  m.innerHTML = renderRate();
  else if (screen === "setup") m.innerHTML = renderSetup();
  else m.innerHTML = renderToday();
  $$("#tabbar .tab").forEach(function (t) {
    var on = t.dataset.s === screen;
    t.classList.toggle("is-on", on);
    t.setAttribute("aria-current", on ? "page" : "false");
  });
  window.scrollTo(0, 0);
}

/* First open. */
function renderOnboard() {
  var h = '<div class="hero">' +
    '<p class="eyebrow">Free, from Heartland Men\'s Health</p>' +
    '<h1 class="h1">Pick your<br>battles.</h1>' +
    '<p class="lede">Four nudges a day and one question at the end of it. ' +
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

/* ---------------------------------------------------------------- today */

function renderToday() {
  var h = "";
  var done = state.today && rated(state.today);

  h += '<div class="head"><h1 class="h1 h1--sm">Today</h1>' +
       (state.streak > 1 ? '<span class="streak">' + state.streak + ' day streak</span>' : "") +
       "</div>";

  /* The one thing he is here to do, and the only place it is asked. */
  if (!done) {
    h += '<button class="prompt" data-act="go" data-s="rate">' +
      '<span class="prompt__t">Rate today</span>' +
      '<span class="prompt__s">Thirty seconds. Food, water, movement, creatine, energy.</span>' +
      '<span class="prompt__cta">Score it →</span></button>';
  } else {
    h += '<div class="card card--done"><p class="h3">Today is scored</p>' +
      '<div class="dots">' + dotRow(state.today) + "</div>" +
      (state.feedback ? '<p class="muted" style="margin-top:12px">' + esc(state.feedback) + "</p>" : "") +
      '<button class="btn btn--ghost btn--full" data-act="go" data-s="rate" style="margin-top:12px">Change it</button></div>';
  }

  if (state.news) {
    h += '<button class="newscard" data-act="news">' +
      '<span class="newscard__tag">From Heartland</span>' +
      '<span class="newscard__t">' + esc(state.news.title) + "</span>" +
      '<span class="newscard__b">' + esc(state.news.teaser) + "</span>" +
      '<span class="newscard__cta">Read it →</span></button>';
  }

  if (state.special) {
    h += '<button class="special" data-act="special">' +
      '<span class="special__tag">This month</span>' +
      '<span class="special__t">' + esc(state.special.title) + "</span>" +
      '<span class="special__b">' + esc(state.special.body) + "</span>" +
      '<span class="special__cta">' + esc(state.special.cta || "Tell me more") + " →</span></button>";
  }

  /* What his phone will do, in order, so the four beats are never a surprise. */
  h += '<div class="card"><p class="h3">Your day</p><ol class="beats">';
  state.beats.forEach(function (b) {
    h += '<li class="beat"><span class="beat__time">' + esc(state.times[b.key] || b.def) + "</span>" +
      '<span class="beat__body"><span class="beat__l">' + esc(b.label) + "</span>" +
      '<span class="beat__h">' + esc(b.hint) + "</span></span></li>";
  });
  h += "</ol>";
  h += '<button class="btn btn--ghost btn--full" data-act="go" data-s="setup" style="margin-top:6px">Change the times</button></div>';

  if (!pushOn()) h += pushCard();

  h += '<p class="fine">General guidance, not medical advice. Using this app does not make you ' +
       "a patient and nothing you do here is shared with anyone.</p>";
  return h;
}

function rated(r) {
  return state.rateFields.some(function (f) { return Number(r[f.key]) >= 1; });
}
function dotRow(r) {
  return state.rateFields.map(function (f) {
    var v = Number(r[f.key]) || 0;
    var pips = "";
    for (var i = 1; i <= state.rateMax; i++) {
      pips += '<span class="pip' + (i <= v ? " is-on" : "") + '"></span>';
    }
    return '<span class="dotrow"><span class="dotrow__l">' + esc(f.label) + "</span>" +
           '<span class="pips">' + pips + "</span></span>";
  }).join("");
}

function pushCard() {
  return '<div class="card card--nudge"><p class="h3">Turn the reminders on</p>' +
    '<p class="muted">Without this the app can show you your times but it cannot actually nudge you.</p>' +
    (isStandalone()
      ? '<button class="btn btn--primary btn--full" data-act="push">Allow notifications</button>'
      : '<p class="muted"><strong>On an iPhone:</strong> tap Share, then Add to Home Screen, and open it from there. ' +
        "Notifications only work from the home-screen icon.</p>") +
    "</div>";
}

/* ---------------------------------------------------------------- rate */

function renderRate() {
  var saved = state.today || {};
  var h = '<div class="head"><h1 class="h1 h1--sm">Rate today</h1></div>';
  h += '<p class="lede lede--sm">Be honest. Nobody sees this, it is not a test, and it is ' +
       "what decides which of these Heartland sends you next.</p>";

  state.rateFields.forEach(function (f) {
    var cur = draft[f.key] != null ? draft[f.key] : (Number(saved[f.key]) || 0);
    h += '<div class="rate"><div class="rate__head"><span class="rate__l">' + esc(f.label) + "</span>" +
      '<span class="rate__v" data-v="' + f.key + '">' + (cur ? cur + " / " + state.rateMax : "") + "</span></div>";
    h += '<div class="scale" role="group" aria-label="' + esc(f.label) + '">';
    for (var i = 1; i <= state.rateMax; i++) {
      h += '<button class="scale__b' + (cur && i <= cur ? " is-on" : "") + '" data-act="score" ' +
        'data-k="' + f.key + '" data-n="' + i + '" aria-label="' + esc(f.label) + " " + i + '">' + i + "</button>";
    }
    h += "</div>";
    h += '<div class="rate__ends"><span>' + esc(f.low) + "</span><span>" + esc(f.high) + "</span></div></div>";
  });

  h += '<label class="field"><span class="field__l">Anything worth noting</span>' +
       '<textarea class="textarea" id="rNote" placeholder="Optional. Slept badly, skipped lunch, whatever it was.">' +
       esc(saved.note || "") + "</textarea></label>";
  h += '<button class="btn btn--primary btn--full" data-act="save-rate" id="rSave">Save today</button>';
  h += '<button class="btn btn--ghost btn--full" data-act="go" data-s="today" style="margin-top:8px">Back</button>';
  return h;
}

/* ---------------------------------------------------------------- setup */

function renderSetup() {
  var h = '<div class="head"><h1 class="h1 h1--sm">Setup</h1></div>';

  h += '<div class="card"><p class="h3">When your phone nudges you</p>' +
       '<p class="muted">Four a day. They stay at least ' +
       Math.round(state.minGapMin / 60) + " hours apart, so if you move one the rest move with it.</p>";
  state.beats.forEach(function (b) {
    h += '<div class="slot"><span class="slot__l">' + esc(b.label) + "</span>" +
      '<input class="slot__t" type="time" value="' + esc(state.times[b.key] || b.def) +
      '" data-act="time" data-k="' + b.key + '"></div>';
  });
  h += "</div>";

  h += '<div class="card"><p class="h3">What you are working on</p>' +
       '<p class="muted">This changes what the nudges say, not how many you get.</p>' +
       '<div class="goals goals--tight">';
  GOALS.forEach(function (g) {
    var on = state.goals.indexOf(g.key) !== -1;
    h += '<button class="goal goal--sm' + (on ? " is-on" : "") + '" data-act="goal" data-k="' + g.key + '">' +
      '<span class="goal__box" aria-hidden="true"></span><span class="goal__t">' + esc(g.title) + "</span></button>";
  });
  h += "</div></div>";

  if (!pushOn()) h += pushCard();

  h += '<div class="card"><p class="h3">Heartland Men\'s Health</p>' +
    '<p class="muted">Low testosterone, weight, and sexual health. Kansas City.</p>' +
    '<a class="btn btn--outline btn--full" href="sms:' + dial(state.textLine) +
      '?&body=' + encodeURIComponent("Hi, I have some questions about getting started.") +
      '">Text us on ' + esc(state.textLine) + "</a>" +
    '<button class="btn btn--ghost btn--full" data-act="ask" style="margin-top:8px">Have someone call me</button>' +
    "</div>";

  h += '<p class="fine">General guidance, not medical advice. Nothing you do here is shared with anyone.</p>';
  return h;
}


/* ==========================================================================
   Actions
   ========================================================================== */

function go(s) { screen = s; draft = {}; render(); }

async function toggleGoal(k) {
  var i = state.goals.indexOf(k);
  if (i === -1) state.goals.push(k); else state.goals.splice(i, 1);
  render();
  try { await post("/prefs", { goals: state.goals, times: state.times }); }
  catch (e) { toast(e.message); }
}

/* The server spaces the times out and returns what it settled on, so if moving
   one pushed the others the screen shows that rather than lying about it. */
async function setTime(k, v) {
  state.times[k] = v;
  try {
    var r = await post("/prefs", { goals: state.goals, times: state.times });
    var moved = Object.keys(r.times).filter(function (x) { return x !== k && r.times[x] !== state.times[x]; });
    state.times = r.times;
    render();
    toast(moved.length ? "Saved. The later ones moved to keep them apart." : "Saved.");
  } catch (e) { toast(e.message); }
}

async function start() {
  if (!state.goals.length) return toast("Pick at least one.");
  state.started = true;
  try { await post("/prefs", { goals: state.goals, times: state.times }); } catch (e) {}
  go("today");
  if (isStandalone() && pushSupported()) enablePush();
}

function score(k, n) {
  draft[k] = Number(n);
  var wrap = document.querySelectorAll('[data-act="score"][data-k="' + k + '"]');
  Array.prototype.forEach.call(wrap, function (b) {
    b.classList.toggle("is-on", Number(b.dataset.n) <= draft[k]);
  });
  var v = $('[data-v="' + k + '"]');
  if (v) v.textContent = draft[k] + " / " + state.rateMax;
}

async function saveRate() {
  var scores = {};
  state.rateFields.forEach(function (f) {
    var v = draft[f.key] != null ? draft[f.key] : (state.today ? Number(state.today[f.key]) : 0);
    if (v >= 1) scores[f.key] = v;
  });
  if (!Object.keys(scores).length) return toast("Tap a number on at least one of them.");
  var b = $("#rSave"); b.disabled = true; b.textContent = "Saving…";
  try {
    var note = $("#rNote") ? $("#rNote").value : "";
    var r = await post("/rate", { scores: scores, note: note });
    state.today = Object.assign({ note: note }, scores);
    state.streak = r.streak; state.rated = r.rated;
    state.topic = r.topic; state.feedback = r.feedback;
    draft = {};
    go("today");
    toast(r.streak > 1 ? "Saved. " + r.streak + " days in a row." : "Saved.");
  } catch (e) {
    toast(e.message);
    b.disabled = false; b.textContent = "Save today";
  }
}

function showNews(id) {
  var n = state.news;
  if (!n || (id && String(n.id) !== String(id))) return;
  openSheet(n.title,
    "<p>" + esc(n.body).replace(/\n/g, "<br>") + "</p>" +
    (n.cta
      ? '<button class="btn btn--primary btn--full" data-act="ask-news" style="margin-top:18px">' +
        esc(n.cta) + "</button>"
      : "") +
    '<a class="btn btn--outline btn--full" style="margin-top:8px" href="sms:' +
      dial(state.textLine) + '?&body=' +
      encodeURIComponent("Hi, I read " + n.title + " on the Heartland app.") + '">Text the clinic</a>');
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
  var title = about === "special" ? "About this month"
            : about === "news" ? "Talk to someone" : "Have someone call you";
  openSheet(title, h, function (root) {
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
      dial(state.textLine) + '?&body=' +
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
  if (a === "go") return go(t.dataset.s);
  if (a === "score") return score(t.dataset.k, t.dataset.n);
  if (a === "save-rate") return saveRate();
  if (a === "push") return enablePush();
  if (a === "news") return showNews();
  if (a === "special") return showSpecial();
  if (a === "ask") return askForContact("call");
  if (a === "ask-news") { closeSheet(); return askForContact("news"); }
  if (a === "ask-special") { closeSheet(); return askForContact("special"); }
});
document.addEventListener("change", function (e) {
  if (e.target && e.target.dataset && e.target.dataset.act === "time") {
    setTime(e.target.dataset.k, e.target.value);
  }
});
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  if (!$("#sheet").hidden) return closeSheet();
  if (screen !== "today") go("today");
});

(async function boot() {
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("sw.js"); } catch (e) {}
  }
  try {
    state = await post("/hello", {});
    state.started = state.goals.length > 0;

    /* A notification carries where it wants to land. Tapping "rate the day"
       must open the rating, not the home screen with the rating one tap away. */
    var q = new URLSearchParams(location.search);
    if (q.get("screen") === "rate") screen = "rate";
    render();
    if (q.get("news") && state.news) showNews(q.get("news"));
  } catch (e) {
    /* A dead end with no way out of it. The first version said "open it again",
       which on a home-screen icon means force-quitting an app, and that is not
       a thing to ask of a man whose train went into a tunnel. */
    $("#main").innerHTML = '<div class="card"><p class="h3">No connection</p>' +
      '<p class="muted">Could not reach Heartland just now. Your times and your scores ' +
      "are safe on our side, nothing is lost.</p>" +
      '<button class="btn btn--primary btn--full" data-act="retry">Try again</button></div>';
  }
})();

/* Deliberately outside boot(), so a failed first load still has a live handler. */
document.addEventListener("click", async function (e) {
  var t = e.target.closest('[data-act="retry"]');
  if (!t) return;
  t.disabled = true; t.textContent = "Trying…";
  try {
    state = await post("/hello", {});
    state.started = state.goals.length > 0;
    render();
  } catch (err) {
    t.disabled = false; t.textContent = "Try again";
    toast("Still no connection.");
  }
});

})();
