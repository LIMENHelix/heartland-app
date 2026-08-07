/* Local dev server. Mirrors what Vercel does: static files from public/,
   everything under /api/* into the single serverless handler.

   Usage:  vercel env pull .env.local   (once)
           npm run dev
*/
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const loadEnv = require("./env");

const envFile = loadEnv();
process.env.HMH_INSECURE_COOKIE = process.env.HMH_INSECURE_COOKIE || "1";  // plain http locally

const handler = require("../api/index");

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, "..", "public");

/* .webp is not optional: the lion backdrop on all three surfaces is a .webp,
   and serving it as application/octet-stream is exactly the difference between
   measuring the page and measuring a blank ground. */
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp3": "audio/mpeg",
  ".woff2": "font/woff2"
};

function serveStatic(res, rel) {
  const clean = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(PUBLIC, clean);
  if (!file.startsWith(path.resolve(PUBLIC))) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(buf);
  });
}

http.createServer(function (req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (pathname.startsWith("/api/")) return handler(req, res);

  if (pathname === "/") return serveStatic(res, "console/index.html");
  if (pathname === "/console" || pathname === "/console/") return serveStatic(res, "console/index.html");
  if (pathname === "/app" || pathname === "/app/") return serveStatic(res, "app/index.html");
  if (pathname === "/daily" || pathname === "/daily/") return serveStatic(res, "daily/index.html");

  serveStatic(res, pathname.replace(/^\//, ""));
}).listen(PORT, function () {
  console.log(envFile ? "env: " + envFile : "env: none found (set DATABASE_URL yourself)");
  console.log("Heartland dev server on http://localhost:" + PORT);
  console.log("  console  http://localhost:" + PORT + "/console/");
  console.log("  patient  http://localhost:" + PORT + "/app/");
});
