/* Nothing that goes on a lock screen may name a medication, a dose, a result
   or a condition. A notification is read by whoever is standing there.

   node voice.js                                                            */
"use strict";
const v = require("../../lib/voice");

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) { pass++; console.log("  PASS  " + n); }
  else { fail++; console.log("  FAIL  " + n + (d ? "   -> " + d : "")); } };

const BANNED = /testosterone|cypionate|enanthate|semaglutide|tirzepatide|clomiphene|enclomiphene|sermorelin|trimix|\bTRT\b|erectile|dysfunction|libido|hypogonad|\d+\s?mg\b|ng\/dL|haematocrit|hematocrit|estradiol/i;

function scan(group, name) {
  const bad = [];
  Object.keys(group).forEach(function (slot) {
    group[slot].forEach(function (m) {
      const hit = BANNED.exec(m.title + " " + m.body);
      if (hit) bad.push(slot + ': "' + hit[0] + '"');
    });
  });
  ok(name + " names nothing clinical", bad.length === 0, bad.join(", "));
}
scan(v.FREE, "free app copy");
scan(v.PATIENT, "patient copy");

/* Length: a lock screen truncates, so the point has to land early. */
const long = [];
[].concat(...Object.values(v.FREE), ...Object.values(v.PATIENT)).forEach(function (m) {
  if (m.title.length > 28) long.push("title " + m.title.length + ': "' + m.title + '"');
  if (m.body.length > 95) long.push("body " + m.body.length + ': "' + m.body.slice(0, 40) + '..."');
});
ok("everything fits a lock screen", long.length === 0, long.slice(0, 3).join(" | "));

/* Rotation: the same man must not read the same line every day. */
const week = ["2026-08-05","2026-08-06","2026-08-07","2026-08-08","2026-08-09","2026-08-10"];
let stale = [];
Object.keys(v.FREE).forEach(function (slot) {
  if (v.FREE[slot].length < 3) return;
  /* Compare the whole message, not the title. Several creatine lines share a
     title and differ in the body, which is still a different notification. */
  const seen = new Set(week.map(function (d) {
    const m = v.freeMessage(slot, d, "same-device");
    return m.title + "|" + m.body;
  }));
  if (seen.size < 3) stale.push(slot + " (" + seen.size + " in 6 days)");
});
ok("copy rotates across a week", stale.length === 0, stale.join(", "));

/* And two men on the same day should not always get the identical line.

   Checks every beat that has variants to choose between, rather than naming
   one. The version that named "train" kept passing until the slot was
   removed, at which point freeMessage fell back to a single default and the
   test reported one distinct line without knowing why. */
const devices = ["a","b","c","d","e","f"];
const flat = [];
Object.keys(v.FREE).forEach(function (slot) {
  if (v.FREE[slot].length < 3) return;
  const spread = new Set(devices.map(function (d) {
    const m = v.freeMessage(slot, "2026-08-05", d);
    return m.title + "|" + m.body;
  }));
  if (spread.size < 3) flat.push(slot + " (" + spread.size + " across 6 phones)");
});
ok("different phones get different lines", flat.length === 0, flat.join(", "));

/* Every slot the schedule can fire must have copy behind it. */
const SLOTS = require("../../lib/db").DAILY_SLOTS.map(s => s.key);
const missing = SLOTS.filter(k => !v.FREE[k] || !v.FREE[k].length);
ok("every reminder slot has copy", missing.length === 0, missing.join(","));

console.log("\n  " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
