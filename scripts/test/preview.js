/* The console's "see his app" must show the SAME thing his phone shows, and
   deleting must be scoped to the coordinator's own panel.

   node preview.js <baseUrl> <adminEmail> <adminPassword>                    */
"use strict";
require("./guard")(process.argv[2]);
const B = process.argv[2], EMAIL = process.argv[3], PASS = process.argv[4];

let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (d ? "   -> " + d : "")); } }
const jj = r => r.json().catch(() => ({}));
const stamp = Date.now();

function admin() {
  let ck = "";
  return async (path, body) => {
    const r = await fetch(B + path, {
      method: body ? "POST" : "GET",
      headers: Object.assign({ cookie: ck }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (set.length) ck = set.map(s => s.split(";")[0]).join("; ");
    return { status: r.status, j: await jj(r) };
  };
}

(async () => {
  const A = admin();
  ok("admin signs in", (await A("/api/admin/login", { email: EMAIL, password: PASS })).status === 200);

  const pc = await A("/api/admin/patients", {
    first_name: "Preview", last_name: "Zz" + stamp, phone: "8165550123",
    protocol: "Testosterone cypionate, weekly", clinic: "Independence",
    start_date: Date.parse("2026-05-01T12:00:00Z"), agreement_months: 12,
    vitality_status: "tungsten", payment_amount: "189", lender_name: "HFD" });
  const pid = pc.j.id;

  const link = await A("/api/admin/enroll-link", { id: pid });
  const en = await (await fetch(B + "/api/p/enroll", { method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: link.j.token }) })).json();
  const P = async path => {
    const r = await fetch(B + path, { headers: { authorization: "Bearer " + en.token } });
    return { status: r.status, j: await jj(r) };
  };

  // ---- the point: same payload, both ways ----
  const his = await P("/api/p/home");
  const ours = await A("/api/admin/patient-view?id=" + pid);
  ok("the preview loads", ours.status === 200, ours.status);

  const keys = ["firstName","protocol","clinic","supplyLeft","renewalAt","unread","startDate","agreementMonths"];
  const same = keys.every(k => JSON.stringify(his.j[k]) === JSON.stringify(ours.j.home[k]));
  ok("every home field matches what his phone gets", same,
     keys.filter(k => JSON.stringify(his.j[k]) !== JSON.stringify(ours.j.home[k])).join(","));
  ok("his labs schedule matches",
     JSON.stringify(his.j.labs) === JSON.stringify(ours.j.home.labs), "differs");
  ok("his Vitality tier matches",
     JSON.stringify(his.j.vitality) === JSON.stringify(ours.j.home.vitality), "differs");
  ok("his payment plan matches",
     JSON.stringify(his.j.payment) === JSON.stringify(ours.j.home.payment), "differs");

  // ---- it reports whether he can actually see any of it ----
  ok("it reports his access state",
     ours.j.access && typeof ours.j.access.signedInDevices === "number" &&
     ours.j.access.notificationsOn === false,
     JSON.stringify(ours.j.access));

  // ---- read only ----
  const before = (await A("/api/admin/patients")).j.patients.filter(x => x.id === pid)[0];
  await A("/api/admin/patient-view?id=" + pid);
  const after = (await A("/api/admin/patients")).j.patients.filter(x => x.id === pid)[0];
  ok("opening the preview does not touch his record",
     before.last_seen_at === after.last_seen_at && before.updated_at === after.updated_at,
     "last_seen " + before.last_seen_at + " -> " + after.last_seen_at);

  // ---- panel boundary ----
  const email = "pv-coord-" + stamp + "@heartlandmenshealth.com";
  const cr = await A("/api/admin/team-save", { name: "PV Coord", email, role: "coordinator" });
  const C = admin();
  await C("/api/admin/login", { email, password: cr.j.password });
  const peek = await C("/api/admin/patient-view?id=" + pid);
  ok("a coordinator cannot look into another panel's patient", peek.status === 403, peek.status);
  const nuke = await C("/api/admin/patient-delete", { id: pid });
  ok("a coordinator cannot delete another panel's patient", nuke.status === 403, nuke.status);

  // ---- delete really removes everything ----
  await fetch(B + "/api/p/ask", { method: "POST",
    headers: { authorization: "Bearer " + en.token, "content-type": "application/json" },
    body: JSON.stringify({ body: "a question that should not outlive the patient" }) });
  const inboxBefore = (await A("/api/admin/inbox")).j.questions.length;
  const del = await A("/api/admin/patient-delete", { id: pid });
  ok("admin can delete", del.status === 200, del.status);
  const gone = (await A("/api/admin/patients")).j.patients.some(x => x.id === pid);
  ok("the record is gone", !gone, "still listed");
  const inboxAfter = (await A("/api/admin/inbox")).j.questions.length;
  ok("his messages go with him, no orphans left behind",
     inboxAfter === inboxBefore - 1, inboxBefore + " -> " + inboxAfter);
  const dead = await P("/api/p/home");
  ok("his app stops working immediately", dead.status === 401, dead.status);
  const view404 = await A("/api/admin/patient-view?id=" + pid);
  ok("the preview 404s for a deleted patient", view404.status === 404, view404.status);

  await A("/api/admin/team-save", { id: cr.j.id, name: "PV Coord", email, role: "coordinator", active: 0 });
  console.log("\n  " + pass + " passed, " + fail + " failed");
  console.log("  NOTE: " + email + " left deactivated.");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(1); });
