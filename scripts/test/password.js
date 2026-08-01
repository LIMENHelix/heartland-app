/* Changing your own password. The failures that matter: doing it without
   knowing the current one, doing it to something trivially short, and leaving
   a stolen session alive afterwards.

   Runs against a throwaway coordinator, never the real account.
   node test-password.js <baseUrl> <adminEmail> <adminPassword>              */
"use strict";
require("./guard")(process.argv[2]);
const B = process.argv[2], EMAIL = process.argv[3], PASS = process.argv[4];

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   -> " + detail : "")); }
}
const jj = r => r.json().catch(() => ({}));

function client() {
  let ck = "";
  const f = async (path, body) => {
    const r = await fetch(B + path, {
      method: body ? "POST" : "GET",
      headers: Object.assign({ cookie: ck }, body ? { "content-type": "application/json" } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
    if (set.length) ck = set.map(s => s.split(";")[0]).join("; ");
    return { status: r.status, j: await jj(r) };
  };
  return f;
}

(async () => {
  const A = client();
  ok("admin signs in", (await A("/api/admin/login", { email: EMAIL, password: PASS })).status === 200);

  const email = "pw-test-" + Date.now() + "@heartlandmenshealth.com";
  const cr = await A("/api/admin/team-save", { name: "PW Test", email, role: "coordinator" });
  const id = cr.j.id, first = cr.j.password;
  ok("throwaway coordinator created", cr.status === 200 && !!first, cr.status);

  // two devices, same account
  const D1 = client(), D2 = client();
  ok("device one signs in", (await D1("/api/admin/login", { email, password: first })).status === 200);
  ok("device two signs in", (await D2("/api/admin/login", { email, password: first })).status === 200);

  // ---- the guards ----
  const wrong = await D1("/api/admin/me-password", { current: "not-it", next: "a-long-enough-one" });
  ok("cannot change it without the current password", wrong.status === 403, wrong.status);

  const short = await D1("/api/admin/me-password", { current: first, next: "short" });
  ok("a short new password is refused", short.status === 400, short.status + " " + JSON.stringify(short.j));

  const same = await D1("/api/admin/me-password", { current: first, next: first });
  ok("reusing the same password is refused", same.status === 400, same.status);

  const anon = await fetch(B + "/api/admin/me-password", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ current: first, next: "correct-horse-battery" }) });
  ok("a signed-out caller is refused", anon.status === 401, anon.status);

  // ---- the change ----
  const NEW = "quiet-harbor-lantern-41";
  const done = await D1("/api/admin/me-password", { current: first, next: NEW });
  ok("the change succeeds", done.status === 200, done.status + " " + JSON.stringify(done.j));
  ok("it reports how many other devices it signed out",
     done.j.signedOutElsewhere === 1, "signedOutElsewhere=" + done.j.signedOutElsewhere);

  // ---- what must be true afterwards ----
  const stillHere = await D1("/api/admin/me");
  ok("the device that made the change stays signed in", stillHere.status === 200, stillHere.status);

  const kicked = await D2("/api/admin/me");
  ok("the OTHER device is signed out", kicked.status === 401, kicked.status);

  const D3 = client();
  const oldPw = await D3("/api/admin/login", { email, password: first });
  ok("the old password no longer works", oldPw.status === 401, oldPw.status);
  const newPw = await D3("/api/admin/login", { email, password: NEW });
  ok("the new password works", newPw.status === 200, newPw.status);

  // ---- a coordinator still cannot touch anyone else ----
  const other = await D3("/api/admin/team-password", { id: 2 });
  ok("a coordinator still cannot reset an admin's password", other.status === 403, other.status);

  // ---- clean up ----
  const ms = await A("/api/admin/team");
  await A("/api/admin/team-save", { id, name: "PW Test", email, role: "coordinator", active: 0 });
  console.log("\n  " + pass + " passed, " + fail + " failed");
  console.log("  NOTE: " + email + " left deactivated; delete it in the console.");
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("HARNESS ERROR", e); process.exit(1); });
