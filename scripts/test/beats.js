/* The free app's four beats, end to end.

   Creates one anonymous install, drives it through the real HTTP routes, and
   deletes it again. It writes to whatever DATABASE_URL points at, which is
   still the live database, so the cleanup at the end is not optional: an
   earlier session left 47 test messages in the clinic's inbox by not doing it.

   node scripts/test/beats.js  [--host https://...]                          */
"use strict";
require("../env")();
const db = require("../../lib/db");
const voice = require("../../lib/voice");

const argHost = process.argv.indexOf("--host");
const HOST = argHost > -1 ? process.argv[argHost + 1] : "https://heartland-deploy.vercel.app";
const KEY = "test-beats-" + Math.random().toString(36).slice(2, 12);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   -> " + detail : "")); }
}
async function post(path, body) {
  const r = await fetch(HOST + "/api/f" + path, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(Object.assign({ key: KEY, tz: 300 }, body))
  });
  const d = await r.json().catch(function () { return {}; });
  if (!r.ok) throw new Error(path + " -> " + r.status + " " + (d.error || ""));
  return d;
}

(async function () {
  console.log("\n  " + HOST + "\n  device " + KEY + "\n");

  /* ---- 1. a new phone gets four beats and nothing else ---- */
  const hello = await post("/hello", {});
  ok("four beats, not nine", hello.beats && hello.beats.length === 4,
     hello.beats ? hello.beats.map(function (b) { return b.key; }).join(",") : "none");
  ok("beats arrive in day order",
     JSON.stringify(hello.beats.map(function (b) { return b.key; })) ===
     JSON.stringify(["plan", "midday", "news", "rate"]));
  ok("nothing scored yet", hello.today === null && hello.rated === 0);
  ok("no topic until there is data", hello.topic === null, String(hello.topic));

  /* ---- 2. the failure the operator named: times 30 minutes apart ---- */
  const bunched = await post("/prefs", {
    goals: ["eat"], times: { plan: "07:00", midday: "07:30", news: "08:00", rate: "08:30" }
  });
  const mins = ["plan", "midday", "news", "rate"].map(function (k) {
    const m = /^(\d\d):(\d\d)$/.exec(bunched.times[k]);
    return Number(m[1]) * 60 + Number(m[2]);
  });
  const gaps = [mins[1] - mins[0], mins[2] - mins[1], mins[3] - mins[2]];
  ok("the server refuses to bunch them up",
     gaps.every(function (g) { return g >= db.MIN_GAP_MIN; }),
     "gaps were " + gaps.join(", ") + " minutes");

  /* ---- 3. scoring a day ---- */
  const r1 = await post("/rate", { scores: { nutrition: 4, water: 2, movement: 3, creatine: 5, energy: 2 } });
  ok("a score comes back saved", r1.ok === true && r1.rated === 1);
  ok("one day is not a pattern", r1.topic === null, String(r1.topic));

  /* Two more days, backdated, so there is enough to pick a topic from. */
  const inst = await db.one("SELECT id FROM installs WHERE device_key = $1", [KEY]);
  const dayBack = function (n) {
    return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  };
  for (const n of [1, 2]) {
    await db.q(`INSERT INTO ratings (install_id, day, nutrition, water, movement, creatine, energy, at)
                VALUES ($1,$2,4,1,4,5,3,$3) ON CONFLICT (install_id, day) DO NOTHING`,
      [inst.id, dayBack(n), Date.now() - n * 86400000]);
  }
  const after = await post("/hello", {});
  ok("three days makes a pattern", after.topic === "water", String(after.topic));
  ok("and it says something useful about it",
     typeof after.feedback === "string" && after.feedback.length > 10, String(after.feedback));
  ok("the streak counts", after.streak === 3, String(after.streak));

  /* ---- 4. re-rating the same day overwrites ---- */
  await post("/rate", { scores: { nutrition: 1, water: 1, movement: 1, creatine: 1, energy: 1 } });
  const rows = await db.q("SELECT * FROM ratings WHERE install_id = $1 AND day = $2",
                          [inst.id, db.dayKey(Date.now(), 300)]);
  ok("rating twice in a day is one row, not two", rows.length === 1, rows.length + " rows");
  ok("and it is the later answer", Number(rows[0].nutrition) === 1);

  /* ---- 5. an empty news table must not fire an empty notification ---- */
  const live = await db.one("SELECT COUNT(*)::int AS n FROM news WHERE live = 1");
  const h3 = await post("/hello", {});
  ok("news is only offered when something is written",
     live.n > 0 ? h3.news !== null : h3.news === null,
     live.n + " live pieces, news is " + (h3.news ? "present" : "null"));

  /* ---- 6. every beat has copy behind it ---- */
  const noCopy = db.BEATS.filter(function (b) {
    const m = voice.freeMessage(b.key, "2026-08-05", KEY);
    return !m || !m.title || !m.body;
  });
  ok("all four beats can speak", noCopy.length === 0,
     noCopy.map(function (b) { return b.key; }).join(","));

  /* ---- clean up. Not optional. ---- */
  await db.q("DELETE FROM installs WHERE device_key = $1", [KEY]);
  const gone = await db.one("SELECT 1 AS x FROM installs WHERE device_key = $1", [KEY]);
  ok("the test device deleted itself", !gone);

  console.log("\n  " + pass + " passed, " + fail + " failed\n");
  process.exit(fail ? 1 : 0);
})().catch(async function (e) {
  console.error("\n  THREW: " + e.message);
  try { await db.q("DELETE FROM installs WHERE device_key = $1", [KEY]); } catch (x) {}
  process.exit(1);
});
