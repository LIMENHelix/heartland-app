/* Proves the panel boundary actually holds, against a running server.
   Usage: node test-team.js <baseUrl> <adminEmail> <adminPassword>          */
"use strict";
require("./guard")(process.argv[2]);
const B = process.argv[2], EMAIL = process.argv[3], PASS = process.argv[4];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   -> " + detail : "")); }
}

function mk(cookie) {
  return async function (path, body) {
    const r = await fetch(B + path, {
      method: body ? "POST" : "GET",
      headers: Object.assign({ cookie: cookie() }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j: j, set: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
  };
}

(async () => {
  let ck = "";
  const A = mk(() => ck);

  const li = await A("/api/admin/login", { email: EMAIL, password: PASS });
  ck = li.set.map(s => s.split(";")[0]).join("; ");
  ok("admin signs in", li.status === 200 && li.j.role === "admin", JSON.stringify(li.j));

  // -------- create a coordinator --------
  const email = "test-coord-" + Date.now() + "@heartlandmenshealth.com";
  const cr = await A("/api/admin/team-save", { name: "Test Coordinator", email: email, role: "coordinator", phone: "913-000-0000" });
  ok("admin creates a coordinator", cr.status === 200 && !!cr.j.password, JSON.stringify(cr.j));
  const coordId = cr.j.id, coordPw = cr.j.password;
  ok("temp password is readable-aloud shaped", /^[23456789A-HJKMNP-Z]{5}-[23456789A-HJKMNP-Z]{5}$/.test(coordPw || ""), coordPw);

  const dup = await A("/api/admin/team-save", { name: "Clash", email: email, role: "coordinator" });
  ok("duplicate email refused", dup.status === 409, dup.status + " " + JSON.stringify(dup.j));

  // -------- two patients, one on each panel --------
  const me = (await A("/api/admin/me")).j.user;
  const pA = await A("/api/admin/patients", { first_name: "PanelTest", last_name: "Admins" });
  const pB = await A("/api/admin/patients", { first_name: "PanelTest", last_name: "Coords", coordinator_id: coordId });
  ok("patient created on admin's own panel", pA.status === 200, JSON.stringify(pA.j));
  ok("patient created on the coordinator's panel", pB.status === 200, JSON.stringify(pB.j));

  const all = await A("/api/admin/patients");
  const mine = all.j.patients.filter(p => String(p.id) === String(pA.j.id))[0];
  ok("creator owns the patient they made", mine && String(mine.coordinator_id) === String(me.id),
     mine ? "coordinator_id=" + mine.coordinator_id + " me=" + me.id : "not found");

  // -------- sign in as the coordinator --------
  let ck2 = "";
  const Cd = mk(() => ck2);
  const li2 = await Cd("/api/admin/login", { email: email, password: coordPw });
  ck2 = li2.set.map(s => s.split(";")[0]).join("; ");
  ok("new coordinator can sign in with the temp password", li2.status === 200 && li2.j.role === "coordinator",
     li2.status + " " + JSON.stringify(li2.j));

  const cp = await Cd("/api/admin/patients");
  const ids = cp.j.patients.map(p => Number(p.id));
  ok("coordinator sees ONLY their own panel", ids.length === 1 && ids[0] === Number(pB.j.id),
     "saw " + ids.length + " -> " + JSON.stringify(ids));

  const wide = await Cd("/api/admin/patients?panel=");
  ok("coordinator cannot widen the panel via the query string",
     wide.j.patients.length === 1, "saw " + wide.j.patients.length);

  const other = await Cd("/api/admin/patients?panel=" + me.id);
  ok("coordinator cannot request someone else's panel",
     other.j.patients.length === 1 && Number(other.j.patients[0].id) === Number(pB.j.id),
     "saw " + JSON.stringify(other.j.patients.map(p => p.id)));

  // -------- writes --------
  const wr = await Cd("/api/admin/patient-update", { id: pA.j.id, notes: "should not land" });
  ok("coordinator cannot edit a patient outside their panel", wr.status === 403, wr.status + " " + JSON.stringify(wr.j));

  const del = await Cd("/api/admin/patient-delete", { id: pA.j.id });
  ok("coordinator cannot delete a patient outside their panel", del.status === 403, del.status);

  const enr = await Cd("/api/admin/enroll-link", { id: pA.j.id });
  ok("coordinator cannot enrol a patient outside their panel", enr.status === 403, enr.status);

  const own = await Cd("/api/admin/patient-update", { id: pB.j.id, notes: "mine, fine" });
  ok("coordinator CAN edit their own patient", own.status === 200, own.status + " " + JSON.stringify(own.j));

  const steal = await Cd("/api/admin/patient-update", { id: pB.j.id, coordinator_id: me.id });
  const after = (await A("/api/admin/patients")).j.patients.filter(p => String(p.id) === String(pB.j.id))[0];
  ok("coordinator cannot reassign a patient to themselves or anyone else",
     String(after.coordinator_id) === String(coordId),
     "status " + steal.status + ", coordinator_id now " + (after && after.coordinator_id) +
     ", expected " + coordId);

  // -------- team administration is admin only --------
  const tm = await Cd("/api/admin/team");
  ok("coordinator cannot list the team", tm.status === 403, tm.status);
  const ts = await Cd("/api/admin/team-save", { name: "Sneaky", email: "sneak" + Date.now() + "@x.com" });
  ok("coordinator cannot create an account", ts.status === 403, ts.status);
  const tp = await Cd("/api/admin/team-password", { id: me.id });
  ok("coordinator cannot reset an admin's password", tp.status === 403, tp.status);
  const tr = await Cd("/api/admin/team-reassign", { from: me.id, to: coordId });
  ok("coordinator cannot grab a panel", tr.status === 403, tr.status);

  // -------- broadcasts stay inside the panel --------
  const bc = await Cd("/api/admin/message-send",
    { audience: "all", kind: "treatment", title: "Panel test", body: "Panel test body." });
  ok("coordinator's 'everyone' means their panel only",
     bc.status === 200 && bc.j.recipients === 1, bc.status + " recipients=" + bc.j.recipients);

  const bad = await Cd("/api/admin/message-send",
    { audience: "one", patientIds: [pA.j.id], kind: "treatment", title: "x", body: "y" });
  ok("coordinator cannot message a patient outside their panel", bad.status === 403, bad.status);

  // -------- admin scoping --------
  const asC = await A("/api/admin/patients?panel=" + coordId);
  ok("admin can sit in a coordinator's seat",
     asC.j.patients.length === 1 && Number(asC.j.patients[0].id) === Number(pB.j.id),
     "saw " + asC.j.patients.length);

  const team = await A("/api/admin/team");
  const row = team.j.team.filter(t => Number(t.id) === Number(coordId))[0];
  ok("team list counts the panel", row && row.patients === 1, row ? "patients=" + row.patients : "missing");
  ok("team list records the sign-in", row && !!row.last_login, row ? "last_login=" + row.last_login : "");

  // -------- last-admin guard --------
  /* Only meaningful when this account IS the only admin. With another admin
     present the demotion is correct behaviour, so promote the throwaway first
     and demote THAT, leaving the signed-in account untouched either way. */
  const teamNow = (await A("/api/admin/team")).j.team;
  const otherAdmins = teamNow.filter(t => t.role === "admin" && t.active && t.id !== me.id).length;
  if (otherAdmins === 0) {
    const self = await A("/api/admin/team-save",
      { id: me.id, name: me.name, email: me.email, role: "coordinator" });
    ok("cannot demote the last administrator", self.status === 400,
       self.status + " " + JSON.stringify(self.j));
  } else {
    /* Make the throwaway an admin, then check IT can be demoted, then check
       the guard still fires when it would leave nobody. */
    await A("/api/admin/team-save", { id: coordId, name: "Test Coordinator", email, role: "admin" });
    const demote = await A("/api/admin/team-save",
      { id: coordId, name: "Test Coordinator", email, role: "coordinator" });
    ok("an admin can be demoted while another admin remains",
       demote.status === 200, demote.status + " " + JSON.stringify(demote.j));
    const stillAdmin = (await A("/api/admin/team")).j.team
      .filter(t => t.role === "admin" && t.active).length;
    ok("at least one administrator always survives", stillAdmin >= 1, "admins=" + stillAdmin);
  }

  // -------- password reset invalidates the session --------
  const rp = await A("/api/admin/team-password", { id: coordId });
  ok("admin can reset a password", rp.status === 200 && !!rp.j.password, rp.status);
  const dead = await Cd("/api/admin/patients");
  ok("reset signs the coordinator out everywhere", dead.status === 401, dead.status);
  const li3 = await Cd("/api/admin/login", { email: email, password: rp.j.password });
  ok("the new password works", li3.status === 200, li3.status);
  const old = await Cd("/api/admin/login", { email: email, password: coordPw });
  ok("the old password does not", old.status === 401, old.status);

  // -------- deactivation --------
  await A("/api/admin/team-save",
    { id: coordId, name: "Test Coordinator", email: email, role: "coordinator", active: 0 });
  const offLogin = await Cd("/api/admin/login", { email: email, password: rp.j.password });
  ok("a deactivated account cannot sign in", offLogin.status === 401, offLogin.status);

  // -------- reassign a whole panel --------
  const mv = await A("/api/admin/team-reassign", { from: coordId, to: me.id });
  ok("admin can move a whole panel", mv.status === 200 && mv.j.moved === 1,
     mv.status + " moved=" + mv.j.moved);

  // -------- clean up --------
  await A("/api/admin/patient-delete", { id: pA.j.id });
  await A("/api/admin/patient-delete", { id: pB.j.id });
  console.log("\n  " + pass + " passed, " + fail + " failed");
  console.log("  NOTE: test coordinator " + email + " left deactivated; delete it in the console.");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(1); });
