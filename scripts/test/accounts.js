/* Patient self-registration.

   The failure that matters is not a junk row: it is a stranger's login ending
   up attached to a real man's treatment record. Most of this file is about
   that one thing.

   node test-accounts.js <baseUrl> <adminEmail> <adminPassword>              */
"use strict";
require("./guard")(process.argv[2]);
const B = process.argv[2], EMAIL = process.argv[3], PASS = process.argv[4];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   -> " + detail : "")); }
}
const jj = r => r.json().catch(() => ({}));
const stamp = Date.now();

function admin() {
  let ck = "";
  return async (path, body) => {
    const r = await fetch(B + path, {
      method: body ? "POST" : "GET",
      headers: Object.assign({ cookie: ck }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (set.length) ck = set.map(s => s.split(";")[0]).join("; ");
    return { status: r.status, j: await jj(r) };
  };
}
const anon = async (path, body) => {
  const r = await fetch(B + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await jj(r) };
};
const asPatient = tok => async (path, body) => {
  const r = await fetch(B + path, {
    method: body ? "POST" : "GET",
    headers: Object.assign({ authorization: "Bearer " + tok },
                           body ? { "content-type": "application/json" } : {}),
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await jj(r) };
};

const DOB = Date.parse("1978-04-12T12:00:00Z");

(async () => {
  const A = admin();
  ok("admin signs in", (await A("/api/admin/login", { email: EMAIL, password: PASS })).status === 200);

  /* ---------- 1. a record the clinic typed in, waiting to be claimed ---------- */
  const known = await A("/api/admin/patients", {
    first_name: "Walt", last_name: "Zz" + stamp, phone: "816-555-0142",
    date_of_birth: DOB, protocol: "Testosterone cypionate, weekly", clinic: "Overland Park" });
  ok("clinic record created", known.status === 200, known.status);

  /* ---------- 2. he signs himself up and matches it ---------- */
  const good = await anon("/api/p/register", {
    first_name: "Walter", last_name: "Zz" + stamp, email: "walter" + stamp + "@example.com",
    phone: "(816) 555 0142", date_of_birth: DOB, password: "a-decent-password" });
  ok("a matching sign-up is active immediately",
     good.status === 200 && good.j.status === "active", JSON.stringify(good.j).slice(0, 140));

  const W = asPatient(good.j.token);
  const home = await W("/api/p/home");
  ok("he lands on HIS existing record, with his treatment on it",
     home.status === 200 && /cypionate/i.test(JSON.stringify(home.j)),
     home.status + " " + JSON.stringify(home.j).slice(0, 160));

  const all = await A("/api/admin/patients");
  const dupes = all.j.patients.filter(p => p.last_name === "Zz" + stamp);
  ok("no duplicate record was created", dupes.length === 1, dupes.length + " rows");

  /* ---------- 3. the attack: right name and DOB, wrong phone ---------- */
  const near = await anon("/api/p/register", {
    first_name: "NotWalter", last_name: "Zz" + stamp, email: "imposter" + stamp + "@example.com",
    phone: "816-555-9999", date_of_birth: DOB, password: "another-password" });
  ok("knowing the name and birthday is NOT enough to claim a record",
     near.status === 200 && near.j.status === "pending", JSON.stringify(near.j).slice(0, 140));

  const I = asPatient(near.j.token);
  const blocked = await I("/api/p/home");
  ok("a pending account is refused everything clinical", blocked.status === 403, blocked.status);
  const blocked2 = await I("/api/p/checkin");
  ok("...including the check-in", blocked2.status === 403, blocked2.status);
  const blocked3 = await I("/api/p/articles");
  ok("...and the library", blocked3.status === 403, blocked3.status);
  const st = await I("/api/p/status");
  ok("but he can see that he is waiting", st.status === 200 && st.j.status === "pending",
     JSON.stringify(st.j).slice(0, 120));

  const board = await A("/api/admin/board");
  ok("a pending sign-up is NOT on today's call list",
     !board.j.board.some(p => /imposter|NotWalter/.test(JSON.stringify(p))), "found on board");
  const list = await A("/api/admin/patients");
  ok("nor in the working patient list",
     !list.j.patients.some(p => p.first_name === "NotWalter"), "found in list");

  /* ---------- 4. the coordinator decides ---------- */
  const q = await A("/api/admin/signups");
  const mine = q.j.signups.filter(x => x.first_name === "NotWalter")[0];
  ok("he appears in the sign-up queue", !!mine, "not queued");
  ok("an ALREADY-CLAIMED record is never offered as a link target",
     mine && !mine.possibleMatches.some(m => m.first_name === "Walt"),
     JSON.stringify(mine && mine.possibleMatches));

  const rej = await A("/api/admin/signup-decide", { id: mine.id, decision: "reject" });
  ok("rejecting works", rej.status === 200, rej.status);
  const dead = await I("/api/p/status");
  ok("a rejected account's session dies at once", dead.status === 401, dead.status);
  const reuse = await anon("/api/p/register", {
    first_name: "NotWalter", last_name: "Zz" + stamp, email: "imposter" + stamp + "@example.com",
    phone: "816-555-9999", date_of_birth: DOB, password: "another-password" });
  ok("the rejected email cannot simply sign up again", reuse.status === 409, reuse.status);

  /* ---------- 5. a genuine new man with no record ---------- */
  const fresh = await anon("/api/p/register", {
    first_name: "Bruce", last_name: "Qq" + stamp, email: "bruce" + stamp + "@example.com",
    phone: "816-555-0177", date_of_birth: Date.parse("1969-09-02T12:00:00Z"),
    password: "bruces-own-password" });
  ok("an unknown man is queued, not refused", fresh.j.status === "pending", JSON.stringify(fresh.j).slice(0, 120));

  const q2 = await A("/api/admin/signups");
  const bruce = q2.j.signups.filter(x => x.first_name === "Bruce")[0];
  const appr = await A("/api/admin/signup-decide", { id: bruce.id, decision: "approve" });
  ok("approving works", appr.status === 200 && appr.j.decision === "approved", JSON.stringify(appr.j));

  const Bt = asPatient(fresh.j.token);
  const bruceHome = await Bt("/api/p/home");
  ok("his app lights up on the SAME session, no re-login", bruceHome.status === 200, bruceHome.status);
  const me = (await A("/api/admin/me")).j.user;
  const after = (await A("/api/admin/patients")).j.patients.filter(p => p.first_name === "Bruce")[0];
  ok("and he is put on the deciding coordinator's panel",
     after && String(after.coordinator_id) === String(me.id),
     after ? "coordinator_id=" + after.coordinator_id : "missing");

  /* ---------- 6. linking a sign-up onto an existing record ---------- */
  const rec2 = await A("/api/admin/patients", {
    first_name: "Samuel", last_name: "Xx" + stamp, phone: "816-555-0188",
    date_of_birth: Date.parse("1971-01-05T12:00:00Z"), protocol: "Enclomiphene daily" });
  const typo = await anon("/api/p/register", {
    first_name: "Sam", last_name: "Xx" + stamp, email: "sam" + stamp + "@example.com",
    phone: "816-555-0000", date_of_birth: Date.parse("1971-01-05T12:00:00Z"),
    password: "sams-own-password" });
  ok("a mistyped phone lands him in the queue", typo.j.status === "pending", JSON.stringify(typo.j).slice(0, 120));

  const q3 = await A("/api/admin/signups");
  const sam = q3.j.signups.filter(x => x.first_name === "Sam")[0];
  ok("an unclaimed record IS offered as a possible match",
     sam && sam.possibleMatches.some(m => m.first_name === "Samuel"),
     JSON.stringify(sam && sam.possibleMatches));
  const link = await A("/api/admin/signup-decide",
    { id: sam.id, decision: "link", targetId: rec2.j.id });
  ok("linking works", link.status === 200 && link.j.decision === "linked", JSON.stringify(link.j));

  const S = asPatient(typo.j.token);
  const samHome = await S("/api/p/home");
  ok("his session now opens the record he was linked to",
     samHome.status === 200 && /Enclomiphene/i.test(JSON.stringify(samHome.j)),
     samHome.status + " " + JSON.stringify(samHome.j).slice(0, 140));
  const noDupe = (await A("/api/admin/patients")).j.patients.filter(p => p.last_name === "Xx" + stamp);
  ok("linking leaves ONE record, not two", noDupe.length === 1, noDupe.length + " rows");

  /* ---------- 7. signing in ---------- */
  const li = await anon("/api/p/login",
    { email: "bruce" + stamp + "@example.com", password: "bruces-own-password" });
  ok("he signs in with his own password", li.status === 200 && !!li.j.token, li.status);
  const liBad = await anon("/api/p/login",
    { email: "bruce" + stamp + "@example.com", password: "wrong" });
  ok("a wrong password is refused", liBad.status === 401, liBad.status);
  const liUnknown = await anon("/api/p/login",
    { email: "nobody" + stamp + "@example.com", password: "wrong" });
  ok("an unknown email gives the SAME message, revealing nothing",
     liUnknown.status === 401 && liUnknown.j.error === liBad.j.error,
     JSON.stringify([liBad.j.error, liUnknown.j.error]));

  /* ---------- 8. lockout ---------- */
  for (let i = 0; i < 4; i++) {
    await anon("/api/p/login", { email: "bruce" + stamp + "@example.com", password: "nope" });
  }
  const locked = await anon("/api/p/login",
    { email: "bruce" + stamp + "@example.com", password: "bruces-own-password" });
  ok("five wrong tries locks the account, even with the right password",
     locked.status === 429, locked.status + " " + JSON.stringify(locked.j).slice(0, 90));

  /* ---------- 9. the coordinator reset ---------- */
  const rp = await A("/api/admin/patient-password", { id: after.id });
  ok("a coordinator can reset his password", rp.status === 200 && !!rp.j.password, rp.status);
  const li2 = await anon("/api/p/login",
    { email: "bruce" + stamp + "@example.com", password: rp.j.password });
  ok("the reset clears the lockout and the temporary password works",
     li2.status === 200 && li2.j.mustChangePassword === true,
     li2.status + " mustChange=" + li2.j.mustChangePassword);
  const B2 = asPatient(li2.j.token);
  const setOwn = await B2("/api/p/password", { next: "a-brand-new-password" });
  ok("he replaces it without repeating the temporary one", setOwn.status === 200, setOwn.status);
  const li3 = await anon("/api/p/login",
    { email: "bruce" + stamp + "@example.com", password: "a-brand-new-password" });
  ok("his new password works", li3.status === 200 && !li3.j.mustChangePassword, li3.status);

  /* ---------- 10. rubbish in ---------- */
  const short = await anon("/api/p/register", {
    first_name: "A", last_name: "B" + stamp, email: "x" + stamp + "@example.com",
    phone: "8165550000", date_of_birth: DOB, password: "short" });
  ok("a short password is refused", short.status === 400, short.status);
  const noDob = await anon("/api/p/register", {
    first_name: "A", last_name: "C" + stamp, email: "y" + stamp + "@example.com",
    phone: "8165550000", date_of_birth: null, password: "long-enough-one" });
  ok("no date of birth is refused", noDob.status === 400, noDob.status);
  const badPhone = await anon("/api/p/register", {
    first_name: "A", last_name: "D" + stamp, email: "z" + stamp + "@example.com",
    phone: "555", date_of_birth: DOB, password: "long-enough-one" });
  ok("a short phone number is refused", badPhone.status === 400, badPhone.status);

  /* ---------- clean up ---------- */
  const final = await A("/api/admin/patients");
  for (const p of final.j.patients) {
    if (new RegExp("(Zz|Qq|Xx)" + stamp).test(p.last_name)) {
      await A("/api/admin/patient-delete", { id: p.id });
    }
  }
  const leftover = await A("/api/admin/signups");
  for (const p of leftover.j.signups) {
    if (new RegExp(String(stamp)).test(p.email || "")) {
      await A("/api/admin/signup-decide", { id: p.id, decision: "reject" });
    }
  }
  console.log("\n  " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(1); });
