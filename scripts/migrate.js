/* Creates or updates the schema. Safe to run repeatedly. */
"use strict";
const loadEnv = require("./env");
const db = require("../lib/db");

(async function () {
  const f = loadEnv();
  console.log(f ? "Loaded " + f : "Using the ambient environment.");
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    console.error("\nNo Postgres connection string.");
    console.error("Run:  vercel env pull .env.local --scope limen-helix\n");
    process.exit(1);
  }
  await db.ensureSchema();
  const t = await db.q(`SELECT table_name FROM information_schema.tables
                        WHERE table_schema = 'public' ORDER BY table_name`);
  console.log("Schema OK. Tables: " + t.map(function (r) { return r.table_name; }).join(", "));
  await db.getPool().end();
})().catch(function (e) { console.error(e.message); process.exit(1); });
