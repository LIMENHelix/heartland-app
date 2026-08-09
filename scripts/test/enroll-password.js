/* A setup link must not be a credential.

   The bug this locks down: /api/p/enroll validated the link, handed back a
   durable device token, and stopped. Nothing ever asked the man to choose a
   password, and nothing on the clinical routes checked whether one existed.
   So whoever opened the link held a permanent key to another man's medical
   record: a forwarded text, a shared phone, a borrowed laptop.

   The whole point of these assertions is the NEGATIVE one. It is easy to
   write a test that proves the password can be set and call that a fix; what
   matters is that the token does NOT open anything before it is.

   Usage: node scripts/test/enroll-password.js <baseUrl> <adminEmail> <adminPassword>  */
"use strict";
require("./guard")(process.argv[2]);
const B = process.argv[2], EMAIL = process.argv[3], PASS = process.argv[4];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   -> " + detail : "")); }
}

function mk(cookie) {
  return async function (path, body, method) {
    const r = await fetch(B + path, {
      method: method || (body ? "POST" : "GET"),
      headers: Object.assign({ cookie: cookie() },
                             body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j: j, set: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
  };
}

/* Patient side: bearer token, not a cookie. */
function pat(tok) {
  return async function (path, body) {
    const r = await fetch(B + path, {
      method: body ? "POST" : "GET",
      headers: Object.assign(tok() ? { authorization: "Bearer " + tok() } : {},
                             body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j: j };
  };
}

/* Every route that serves something about a man's treatment. If a new one is
   added and not listed here, this test will not notice it, so keep it in step
   with the "/api/p/" block in api/index.js. */
const CLINICAL = ["/api/p/home", "/api/p/messages", "/api/p/articles", "/api/p/checkin"];

(async () => {
  let ck = "";
  const A = mk(() => ck);

  const li = await A("/api/admin/login", { email: EMAIL, password: PASS });
  ck = li.set.map(s => s.split(";")[0]).join("; ");
  ok("admin signs in", li.status === 200, li.status + " " + JSON.stringify(li.j));
  if (li.status !== 200) { console.log("\n  cannot continue without a session\n"); process.exit(1); }

  /* A throwaway patient, so nothing real is touched. */
  const surname = "Testlink" + Date.now();
  const cr = await A("/api/admin/patients", {
    first_name: "Link", last_name: surname, phone: "5550000000",
    date_of_birth: "1980-01-01", start_date: "2026-01-01", agreement_months: 12
  });
  ok("coordinator creates a patient", cr.status === 200 && !!cr.j.id,
     cr.status + " " + JSON.stringify(cr.j));
  const patientId = cr.j.id;
  if (!patientId) { console.log("\n  cannot continue without a patient\n"); process.exit(1); }

  const link = await A("/api/admin/enroll-link", { id: patientId });
  ok("coordinator gets a setup link", link.status === 200 && !!link.j.token,
     link.status + " " + JSON.stringify(link.j));
  const setupToken = link.j.token;

  let deviceToken = null;
  const P = pat(() => deviceToken);

  const en = await fetch(B + "/api/p/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: setupToken })
  });
  const enj = await en.json().catch(() => ({}));
  ok("the link redeems", en.status === 200 && !!enj.token, en.status + " " + JSON.stringify(enj));
  deviceToken = enj.token;

  // -------- the point of the whole file --------
  ok("enrol says a password is required", enj.passwordRequired === true,
     JSON.stringify(enj));

  for (const route of CLINICAL) {
    const r = await P(route);
    ok("link alone cannot reach " + route,
       r.status === 403 && r.j.passwordRequired === true,
       r.status + " " + JSON.stringify(r.j).slice(0, 120));
  }

  const st1 = await P("/api/p/status");
  ok("status is reachable without a password (it has to be)", st1.status === 200, st1.status);
  ok("status reports passwordRequired", st1.j.passwordRequired === true, JSON.stringify(st1.j));
  ok("status reports no password set", st1.j.hasPassword === false, JSON.stringify(st1.j));

  // -------- setting one --------
  const short = await P("/api/p/password", { next: "short" });
  ok("a short password is refused", short.status === 400, short.status);

  const stillOut = await P("/api/p/home");
  ok("a refused password did not let him in", stillOut.status === 403, stillOut.status);

  const setPw = "correct-horse-" + Date.now();
  const sp = await P("/api/p/password", { next: setPw });
  ok("he can set a password without knowing an old one", sp.status === 200,
     sp.status + " " + JSON.stringify(sp.j));

  for (const route of CLINICAL) {
    const r = await P(route);
    ok("after setting one he reaches " + route, r.status === 200,
       r.status + " " + JSON.stringify(r.j).slice(0, 120));
  }

  const st2 = await P("/api/p/status");
  ok("status no longer demands a password", st2.j.passwordRequired === false, JSON.stringify(st2.j));

  // -------- a second device off the same spent link --------
  const reuse = await fetch(B + "/api/p/enroll", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: setupToken })
  });
  ok("the link cannot be redeemed twice", reuse.status === 409, reuse.status);

  // -------- cleanup --------
  const del = await A("/api/admin/patient-delete", { id: patientId });
  ok("test patient removed", del.status === 200, del.status + " " + JSON.stringify(del.j));
  if (del.status !== 200) {
    console.log("  !! leftover test patient id=" + patientId + " surname=" + surname);
  }

  console.log("\n  " + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("FAILED: " + e.message); process.exit(1); });
