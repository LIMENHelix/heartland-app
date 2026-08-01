/* Loads .env.local (written by `vercel env pull`) so the local scripts and dev
   server can reach the same database as production. No dependency needed. */
"use strict";

const fs = require("fs");
const path = require("path");

module.exports = function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(__dirname, "..", name);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    text.split(/\r?\n/).forEach(function (line) {
      const t = line.trim();
      if (!t || t[0] === "#") return;
      const eq = t.indexOf("=");
      if (eq < 1) return;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = val;
    });
    return file;
  }
  return null;
};
