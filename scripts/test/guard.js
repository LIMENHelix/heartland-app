/* Refuse to run a test suite against the live site or the live database.

   Every one of these suites creates patients, sends messages, logs check-ins
   and makes coordinator accounts. They were written against
   http://127.0.0.1:<port>, but the dev server reads .env.local, and
   .env.local points at the SAME Neon database the live site uses. There is
   only one database. So "local" testing wrote to production, and the residue
   showed up as messages nobody sent and records nobody created.

   This makes that a deliberate act rather than an accident. */
"use strict";

const PROD_HOSTS = ["heartland-deploy.vercel.app"];

function guard(baseUrl) {
  const forced = process.env.HMH_ALLOW_PROD === "1";
  let host = "";
  try { host = new URL(baseUrl).host; } catch (e) { host = String(baseUrl); }

  const hittingProdSite = PROD_HOSTS.some(function (h) { return host.indexOf(h) !== -1; });

  /* A local URL is not automatically safe: the dev server behind it may be
     pointed at the live database, which is exactly how this went wrong. */
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  const dbIsShared = /neon\.tech/.test(dbUrl) && !/-test|_test|localhost/.test(dbUrl);

  if (!forced && (hittingProdSite || dbIsShared)) {
    console.error("");
    console.error("  REFUSING TO RUN.");
    console.error("");
    if (hittingProdSite) console.error("  Target is the live site: " + host);
    if (dbIsShared)      console.error("  DATABASE_URL points at the shared Neon database.");
    console.error("");
    console.error("  These suites create patients, messages and coordinator accounts.");
    console.error("  Run them against a throwaway database, or if you really mean it:");
    console.error("");
    console.error("      HMH_ALLOW_PROD=1 node " + (process.argv[1] || "").split(/[\/]/).pop() + " ...");
    console.error("");
    process.exit(2);
  }
  if (forced) {
    console.log("  ! HMH_ALLOW_PROD=1 — writing to the live database on purpose.\n");
  }
}

module.exports = guard;
