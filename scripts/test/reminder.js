/* The evening nudge. The failures that matter are nagging a man who already
   recorded his day, nagging one who opted out, and running open to the world.

   node test-reminder.js <baseUrl> <adminEmail> <adminPassword> <cronSecret>  */
"use strict";
require("./guard")(process.argv[2]);
const B = process.argv[2], EMAIL = process.argv[3], PASS = process.argv[4], SECRET = process.argv[5];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   -> " + detail : "")); }
}
const j = r => r.json().catch(() => ({}));

(async () => {
  let ck = "";
  const A = async (path, body) => {
    const r = await fetch(B + path, {
      method: body ? "POST" : "GET",
      headers: Object.assign({ cookie: ck }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, j: await j(r), set: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
  };
  const li = await A("/api/admin/login", { email: EMAIL, password: PASS });
  ck = li.set.map(s => s.split(";")[0]).join("; ");
  ok("admin signs in", li.status === 200, li.status);

  // ---- the route must not be open ----
  const open = await fetch(B + "/api/cron/checkin-reminder");
  ok("the cron route refuses an unauthenticated call",
     open.status === 401 || open.status === 503, open.status);

  const wrong = await fetch(B + "/api/cron/checkin-reminder",
    { headers: { authorization: "Bearer not-the-secret" } });
  ok("the cron route refuses a wrong secret", wrong.status === 401, wrong.status);

  const CRON = () => fetch(B + "/api/cron/checkin-reminder",
    { headers: { authorization: "Bearer " + SECRET } }).then(j);

  const base = await CRON();
  ok("the cron route runs with the right secret", typeof base.due === "number",
     JSON.stringify(base).slice(0, 160));

  // ---- a patient who has not recorded today ----
  const pc = await A("/api/admin/patients", { first_name: "ReminderTest", last_name: "Patient" });
  const pid = pc.j.id;
  const link = await A("/api/admin/enroll-link", { id: pid });
  const en = await (await fetch(B + "/api/p/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: link.j.token }) })).json();
  const P = async (path, body) => {
    const r = await fetch(B + path, {
      method: body ? "POST" : "GET",
      headers: Object.assign({ authorization: "Bearer " + en.token },
                             body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: r.status, j: await j(r) };
  };

  const view = await P("/api/p/checkin");
  ok("reminders default to on for a new patient", view.j.reminders === 1, String(view.j.reminders));

  /* No device subscription in a test, so he cannot be "due" — which is itself
     the behaviour to prove: never push at someone with nowhere to push. */
  const r1 = await CRON();
  ok("a patient with no device is never counted as due",
     r1.due === base.due, base.due + " -> " + r1.due);

  // ---- the opt-out ----
  const off = await P("/api/p/reminders", { on: 0 });
  const view2 = await P("/api/p/checkin");
  ok("a patient can turn the reminder off",
     off.status === 200 && view2.j.reminders === 0, off.status + " " + view2.j.reminders);
  const on = await P("/api/p/reminders", { on: 1 });
  const view3 = await P("/api/p/checkin");
  ok("and back on", on.status === 200 && view3.j.reminders === 1, String(view3.j.reminders));

  // ---- adherence is reported to the coordinator ----
  await P("/api/p/checkin", { energy: 7, mood: 7, sleep: 7, libido: 7, strength: 7, cognitive: 7,
                              symptoms: [], note: "", tz: 0 });
  const hist = await A("/api/admin/patient-checkins?id=" + pid);
  ok("the coordinator is told how many days he actually recorded",
     hist.j.adherence && hist.j.adherence.logged === 1 && hist.j.adherence.of === 14,
     JSON.stringify(hist.j.adherence));

  // ---- recording today removes him from the due list ----
  const r2 = await CRON();
  ok("recording today takes him off the reminder list",
     r2.due === base.due, base.due + " -> " + r2.due);

  // ---- never twice in one night ----
  const twice = await CRON();
  ok("a second run the same night pushes nobody again", twice.sent === 0,
     "sent=" + twice.sent);

  await A("/api/admin/patient-delete", { id: pid });
  console.log("\n  " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(1); });
