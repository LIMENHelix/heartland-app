/* Proves the check-in path end to end, including the part that matters:
   a bad day reaches a coordinator, and a dangerous answer puts the emergency
   number on the patient's own screen without waiting for one.

   node test-checkin.js <baseUrl> <adminEmail> <adminPassword>             */
"use strict";
require("./guard")(process.argv[2]);
const B = process.argv[2], EMAIL = process.argv[3], PASS = process.argv[4];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   -> " + detail : "")); }
}

function admin(cookie) {
  return async function (path, body) {
    const r = await fetch(B + path, {
      method: body ? "POST" : "GET",
      headers: Object.assign({ cookie: cookie() }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j, set: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
  };
}
function patient(tok) {
  return async function (path, body) {
    const r = await fetch(B + path, {
      method: body ? "POST" : "GET",
      headers: Object.assign({ authorization: "Bearer " + tok() },
                             body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  };
}

(async () => {
  let ck = "";
  const A = admin(() => ck);
  const li = await A("/api/admin/login", { email: EMAIL, password: PASS });
  ck = li.set.map(s => s.split(";")[0]).join("; ");
  ok("admin signs in", li.status === 200, li.status);
  const me = (await A("/api/admin/me")).j.user;

  // a patient of our own, enrolled properly through the real flow
  const pc = await A("/api/admin/patients", { first_name: "CheckinTest", last_name: "Patient" });
  const pid = pc.j.id;
  const link = await A("/api/admin/enroll-link", { id: pid });
  ok("enrolment link issued", link.status === 200 && !!link.j.token, link.status);

  const er = await fetch(B + "/api/p/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: link.j.token })
  });
  const ej = await er.json();
  ok("patient enrols", er.status === 200 && !!ej.token, er.status + " " + JSON.stringify(ej).slice(0, 120));
  let ptok = ej.token;
  const P = patient(() => ptok);

  // -------- the shape of the screen --------
  const g0 = await P("/api/p/checkin?tz=" + new Date().getTimezoneOffset());
  ok("check-in screen loads", g0.status === 200 && Array.isArray(g0.j.symptoms), g0.status);
  ok("emergency numbers are always present",
     g0.j.help && g0.j.help.crisis.value === "988" && g0.j.help.emergency.value === "911" &&
     /844/.test(g0.j.help.priapism.value),
     JSON.stringify(g0.j.help));
  ok("no check-in yet today", g0.j.today === null, JSON.stringify(g0.j.today));

  // -------- a good day does NOT bother anyone --------
  const inbox0 = (await A("/api/admin/inbox")).j.questions.length;
  const good = await P("/api/p/checkin", { energy: 9, mood: 9, sleep: 8, libido: 8, strength: 9, cognitive: 8, symptoms: [], note: "Feeling strong." });
  ok("a good day scores ok", good.status === 200 && good.j.level === "ok", JSON.stringify(good.j).slice(0, 150));
  const inbox1 = (await A("/api/admin/inbox")).j.questions.length;
  ok("a good day does NOT create clinic work", inbox1 === inbox0, inbox0 + " -> " + inbox1);

  // -------- same day resubmit overwrites, does not duplicate --------
  const again = await P("/api/p/checkin", { energy: 8, mood: 8, sleep: 8, libido: 8, strength: 8, cognitive: 8, symptoms: [] });
  const hist = (await P("/api/p/checkin")).j.history;
  ok("a second entry the same day overwrites", again.status === 200 && hist.length === 1,
     hist.length + " rows");

  // -------- a bad day reaches the coordinator, verbatim --------
  const words = "I can barely get out of bed and I snapped at my kids twice this week.";
  const bad = await P("/api/p/checkin", { energy: 2, mood: 2, sleep: 3, libido: 2, strength: 3, cognitive: 3, symptoms: [], note: words });
  ok("a bad day is graded rough", bad.status === 200 && bad.j.level === "rough", JSON.stringify(bad.j).slice(0, 150));

  const q = (await A("/api/admin/inbox")).j.questions;
  const mine = q.filter(x => Number(x.from_patient_id) === Number(pid))[0];
  ok("a bad day lands in the coordinator's inbox", !!mine, "not found");
  ok("his words arrive VERBATIM, not summarized",
     mine && mine.body.indexOf(words) !== -1,
     mine ? JSON.stringify(mine.body).slice(0, 220) : "no message");

  // re-saving the identical entry must not alert again
  const inboxA = (await A("/api/admin/inbox")).j.questions.length;
  await P("/api/p/checkin", { energy: 2, mood: 2, sleep: 3, libido: 2, strength: 3, cognitive: 3, symptoms: [], note: words });
  const inboxB = (await A("/api/admin/inbox")).j.questions.length;
  ok("re-saving the same rough day does NOT alert twice", inboxA === inboxB, inboxA + " -> " + inboxB);

  // but a changed note does
  await P("/api/p/checkin", { energy: 2, mood: 2, sleep: 3, libido: 2, strength: 3, cognitive: 3, symptoms: [], note: words + " It is getting worse." });
  const inboxC = (await A("/api/admin/inbox")).j.questions.length;
  ok("a changed note DOES alert again", inboxC === inboxB + 1, inboxB + " -> " + inboxC);

  // the six fields and the range are declared by the server, not hard-coded
  const meta = await P("/api/p/checkin");
  ok("six measures are declared, on a 1-10 scale",
     meta.j.fields.length === 6 && meta.j.scaleMax === 10 &&
     meta.j.fields.map(f => f.key).join(",") === "energy,mood,sleep,libido,strength,cognitive",
     JSON.stringify(meta.j.fields ? meta.j.fields.map(f => f.key) : null) + " max=" + meta.j.scaleMax);

  const oneLow = await P("/api/p/checkin", {
    energy: 9, mood: 9, sleep: 3, libido: 9, strength: 9, cognitive: 9, symptoms: [], note: "" });
  ok("one measure at rock bottom flags even when everything else is high",
     oneLow.j.level === "rough" && oneLow.j.low.some(f => f.key === "sleep"),
     JSON.stringify(oneLow.j).slice(0, 200));

  const withRead = await P("/api/p/checkin");
  ok("a low measure is matched to an article on that topic",
     withRead.j.reading.length > 0 && withRead.j.reading[0].topic === "sleep",
     JSON.stringify((withRead.j.reading || []).map(r => r.topic + ":" + r.title)));

  // restore the rough day the later assertions expect
  await P("/api/p/checkin", { energy: 2, mood: 2, sleep: 3, libido: 2, strength: 3, cognitive: 3, symptoms: [], note: words + " It is getting worse." });

  const ckl = await A("/api/admin/checkins");
  const row = ckl.j.checkins.filter(c => Number(c.patient_id) === Number(pid))[0];
  ok("it appears on the check-ins board", !!row && row.level === "rough", row ? row.level : "missing");
  ok("it starts unhandled", row && !row.seen_at, row ? String(row.seen_at) : "");

  // -------- a dangerous answer does not wait for anybody --------
  const red = await P("/api/p/checkin", {
    energy: 7, mood: 7, sleep: 7, libido: 7, strength: 7, cognitive: 7, symptoms: ["chest"], note: "tight chest since this morning" });
  ok("a red symptom is urgent", red.status === 200 && red.j.level === "urgent", JSON.stringify(red.j).slice(0, 120));
  ok("the patient is told what to do IMMEDIATELY, in the response",
     red.j.urgent && red.j.urgent.length === 1 && /911/.test(red.j.urgent[0].advice),
     JSON.stringify(red.j.urgent));

  const red2 = await P("/api/p/checkin", {
    energy: 7, mood: 2, sleep: 4, libido: 4, strength: 6, cognitive: 5, symptoms: [], note: "some days I honestly want to die" });
  ok("a crisis in free text is caught even with no box ticked",
     red2.status === 200 && red2.j.level === "urgent" && red2.j.crisisText === true,
     JSON.stringify(red2.j).slice(0, 160));

  const ckl2 = await A("/api/admin/checkins");
  const row2 = ckl2.j.checkins.filter(c => Number(c.patient_id) === Number(pid))[0];
  ok("urgent sorts above rough", row2 && row2.level === "urgent", row2 ? row2.level : "missing");

  // -------- rubbish in --------
  const junk = await P("/api/p/checkin", { energy: 99, mood: -4, sleep: "x", libido: null, strength: 0, cognitive: 11, symptoms: ["notreal"], note: "" });
  ok("out-of-range scores are rejected, not stored",
     junk.status === 400, junk.status + " " + JSON.stringify(junk.j));

  // -------- meals and training --------
  const m1 = await P("/api/p/log", { kind: "meal", body: "Eggs, toast, black coffee" });
  const t1 = await P("/api/p/log", { kind: "training", body: "Lifted 45 min" });
  ok("meal logs", m1.status === 200, m1.status);
  ok("training logs", t1.status === 200, t1.status);
  const after = await P("/api/p/checkin");
  ok("both come back on his screen",
     after.j.logs.filter(l => l.kind === "meal").length === 1 &&
     after.j.logs.filter(l => l.kind === "training").length === 1,
     JSON.stringify(after.j.logs.map(l => l.kind)));
  const dl = await P("/api/p/log-delete", { id: m1.j.id });
  const after2 = await P("/api/p/checkin");
  ok("he can delete his own entry",
     dl.status === 200 && after2.j.logs.filter(l => l.kind === "meal").length === 0,
     after2.j.logs.length + " left");

  // -------- another patient's data is not reachable --------
  const other = await A("/api/admin/patients", { first_name: "CheckinOther", last_name: "Patient" });
  const olink = await A("/api/admin/enroll-link", { id: other.j.id });
  const oe = await (await fetch(B + "/api/p/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: olink.j.token }) })).json();
  const O = patient(() => oe.token);
  const oview = await O("/api/p/checkin");
  ok("another patient sees none of this",
     oview.j.history.length === 0 && oview.j.logs.length === 0,
     oview.j.history.length + " checkins, " + oview.j.logs.length + " logs");
  const steal = await O("/api/p/log-delete", { id: t1.j.id });
  const stillThere = await P("/api/p/checkin");
  ok("another patient cannot delete his entries",
     stillThere.j.logs.filter(l => l.kind === "training").length === 1,
     "training rows " + stillThere.j.logs.filter(l => l.kind === "training").length);

  // -------- mark handled --------
  const seen = await A("/api/admin/checkin-seen", { id: row2.id });
  const ckl3 = await A("/api/admin/checkins");
  const row3 = ckl3.j.checkins.filter(c => Number(c.id) === Number(row2.id))[0];
  ok("a coordinator can mark it handled", seen.status === 200 && row3 && !!row3.seen_at,
     seen.status + " seen_at=" + (row3 && row3.seen_at));

  // -------- the panel boundary still holds on the new routes --------
  const tmp = "ck-coord-" + Date.now() + "@heartlandmenshealth.com";
  const cr = await A("/api/admin/team-save", { name: "CK Coord", email: tmp, role: "coordinator" });
  let ck2 = "";
  const C = admin(() => ck2);
  const l2 = await C("/api/admin/login", { email: tmp, password: cr.j.password });
  ck2 = l2.set.map(s => s.split(";")[0]).join("; ");
  const cList = await C("/api/admin/checkins");
  ok("a coordinator sees no check-ins outside their panel",
     cList.status === 200 && cList.j.checkins.length === 0,
     "saw " + (cList.j.checkins || []).length);
  const cHist = await C("/api/admin/patient-checkins?id=" + pid);
  ok("a coordinator cannot open another panel's history", cHist.status === 403, cHist.status);
  const cSeen = await C("/api/admin/checkin-seen", { id: row.id });
  ok("a coordinator cannot clear another panel's flag", cSeen.status === 403, cSeen.status);

  // -------- clean up --------
  await A("/api/admin/patient-delete", { id: pid });
  await A("/api/admin/patient-delete", { id: other.j.id });
  console.log("\n  " + pass + " passed, " + fail + " failed");
  console.log("  NOTE: temp coordinator " + tmp + " left behind; remove it in the console.");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(1); });
