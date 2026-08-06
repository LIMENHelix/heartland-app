/* Does any text on the free app actually fail against what is behind it?

   Not a guess and not a reading of the CSS. It renders the page twice: once
   normally to find where every piece of text IS, and once with all text
   hidden to see what is PAINTED THERE. Then it takes the worst pixel in each
   text's own box and computes the real ratio.

   This is the only way to catch text on a photograph. Walking the CSS finds
   the declared background, which for anything sitting on the backdrop layer
   is `transparent`, and transparent always "passes".

   node scripts/test/contrast.js [url] [width] [height]                      */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9477;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const URL_ = process.argv[2] || "https://heartland-deploy.vercel.app/daily/";
const W = Number(process.argv[3]) || 390;
const H = Number(process.argv[4]) || 900;

class CDP {
  constructor(u) {
    this.ws = new WebSocket(u); this.id = 0; this.p = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener("open", () => res());
      this.ws.addEventListener("error", () => rej(new Error("ws")));
    });
    this.ws.addEventListener("message", ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.p.has(m.id)) {
        const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.p.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); reject(new Error(method + " timed out")); } }, 40000);
    });
  }
}

/* Where every visible piece of text is, and what colour it is. */
const FIND = `(() => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let n;
  while ((n = walk.nextNode())) {
    const txt = (n.nodeValue || "").trim();
    if (txt.length < 2) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.bottom < 0 || r.top > innerHeight) continue;
    const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(cs.color);
    if (!m) continue;
    /* The corner radius, because a rounded element's own caps are not
       background. A fully rounded pill curves in by half its height at each
       end, and sampling across that reads the page behind the pill. */
    const rad = Math.max.apply(null, [cs.borderTopLeftRadius, cs.borderTopRightRadius,
      cs.borderBottomLeftRadius, cs.borderBottomRightRadius].map(function (x) {
        return parseFloat(x) || 0; }));
    out.push({
      text: txt.slice(0, 44), size: parseFloat(cs.fontSize), weight: cs.fontWeight,
      radius: Math.min(rad, r.height / 2),
      color: [+m[1], +m[2], +m[3]],
      box: [Math.max(0, Math.round(r.left)), Math.round(r.top + scrollY),
            Math.round(r.width), Math.round(r.height)]
    });
  }
  return JSON.stringify(out);
})()`;

const HIDE = `(() => {
  const s = document.createElement("style");
  s.id = "hide-text";
  /* Keep every box exactly where it is; just make the glyphs invisible, so
     what is measured is the surface the text lands on. */
  s.textContent = "*{color:transparent !important;text-shadow:none !important}";
  document.head.appendChild(s);
  return "ok";
})()`;

const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/* The screenshot is decoded and sampled by the browser that produced it.

   A hand-rolled PNG un-filterer was here first and it silently returned wrong
   pixels: it reported text sitting on bright yellow and magenta, colours that
   appear nowhere in this app. Wrong numbers that LOOK like measurements are
   worse than no measurement, so the decoding now goes through the one PNG
   reader on this machine that is definitely correct. */
const SAMPLE = `(async (dataUrl, boxes) => {
  const img = await new Promise((ok, bad) => {
    const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = dataUrl;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext("2d").drawImage(img, 0, 0);
  const x = c.getContext("2d");
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = p => 0.2126 * lin(p[0]) + 0.7152 * lin(p[1]) + 0.0722 * lin(p[2]);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return JSON.stringify(boxes.map(b => {
    /* Sample the middle horizontal band, not the whole box.

       A rounded button's own corners expose the page behind it, and on a dark
       theme that corner pixel can be the exact colour of the label: the gold
       Start button reported 1.00:1 while being perfectly legible. Insetting a
       couple of pixels was not enough, because an 8px radius curves further in
       than that. Glyphs live in the vertical middle, so that is what gets
       measured. */
    const pad = Math.max(2, Math.min(b.radius || 0, b.box[2] / 3));
    const bx = b.box[0] + pad;
    const w = Math.min(b.box[2] - pad * 2, c.width - bx);
    const band = Math.max(1, Math.round(b.box[3] * 0.5));
    const by = b.box[1] + Math.round((b.box[3] - band) / 2);
    const h = Math.min(band, c.height - by);
    if (w < 1 || h < 1) return null;
    const d = x.getImageData(bx, by, w, h).data;
    const tl = lum(b.color);
    let worst = Infinity, px = null;
    for (let i = 0; i < d.length; i += 4) {
      const bg = [d[i], d[i+1], d[i+2]];
      const r = ratio(tl, lum(bg));
      if (r < worst) { worst = r; px = bg; }
    }
    return { worst, px };
  }));
})(DATA_URL, BOXES)`;

async function main() {
  const profile = path.join(os.tmpdir(), "ct-" + Date.now());
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile,
    "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    await sleep(250);
    try {
      const list = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const pg = list.find(t => t.type === "page");
      if (pg) wsUrl = pg.webSocketDebuggerUrl;
    } catch (e) {}
  }
  if (!wsUrl) { chrome.kill(); throw new Error("chrome never came up"); }
  const cdp = new CDP(wsUrl); await cdp.ready;
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });

  /* Land on the origin first, so any setup runs against the right one. */
  await cdp.send("Page.navigate", { url: new URL(URL_).origin + "/daily/" });
  await sleep(1500);
  await cdp.send("Runtime.evaluate", {
    expression: 'localStorage.setItem("hmh.daily.key","contrastcheckAAAA' +
                Math.floor(Math.random() * 1e6) + '")' });
  /* --setup runs arbitrary JS on the origin before the real navigation, which
     is how the console gets a session: its pages are behind a login and
     measuring a login screen measures nothing. */
  const setupIdx = process.argv.indexOf("--setup");
  if (setupIdx > -1) {
    await cdp.send("Runtime.evaluate",
      { expression: process.argv[setupIdx + 1], awaitPromise: true });
    await sleep(900);
  }
  await cdp.send("Page.navigate", { url: URL_ });
  await sleep(3500);

  /* Walk into an inner screen before measuring. The screens behind a tap are
     the ones with the most text on them, so measuring only the first screen
     is measuring the easy case. */
  const clickIdx = process.argv.indexOf("--click");
  if (clickIdx > -1) {
    for (const sel of process.argv[clickIdx + 1].split(" >> ")) {
      const r = await cdp.send("Runtime.evaluate", { expression:
        '(function(){var e=document.querySelector(' + JSON.stringify(sel.trim()) + ');' +
        'if(e){e.click();return "ok";}return "MISSED";})()', returnByValue: true });
      if (r.result.value === "MISSED") console.error("  click missed: " + sel);
      await sleep(1200);
    }
  }

  /* Where the text is, while it is still visible. Document coordinates: the
     page gets scrolled below, so viewport coordinates would go stale. */
  const found = await cdp.send("Runtime.evaluate", { expression: FIND, returnByValue: true });
  const items = JSON.parse(found.result.value);

  await cdp.send("Runtime.evaluate", { expression: HIDE });
  await sleep(400);

  /* Scroll through the page a screen at a time and measure what is actually
     on screen at each stop.

     Measuring once, unscrolled, gave two false failures: the Save button read
     1.03:1 because at scroll zero it lies under the fixed tab bar, and text
     below the fold was compared against whatever happened to be painted at
     those coordinates instead. Neither is what a reader sees. A backdrop that
     is `position: fixed` also cannot be captured correctly in one full-page
     shot, because it only paints once at the top.

     So: scroll, capture, and only trust boxes that are fully clear of the
     fixed furniture at the top and bottom of that view. */
  const page = await cdp.send("Runtime.evaluate", {
    expression: `JSON.stringify({
      h: document.documentElement.scrollHeight,
      top: (document.querySelector(".topbar") || {getBoundingClientRect:()=>({bottom:0})}).getBoundingClientRect().bottom,
      bot: (function(){ const t = document.querySelector(".tabbar");
        return t && !t.hidden ? innerHeight - t.getBoundingClientRect().top : 0; })()
    })`, returnByValue: true });
  const { h: pageH, top: topGuard, bot: botGuard } = JSON.parse(page.result.value);

  const best = new Map();                 /* index -> worst reading found */
  const step = Math.max(120, H - topGuard - botGuard - 40);
  for (let y = 0; y <= Math.max(0, pageH - H) + step; y += step) {
    await cdp.send("Runtime.evaluate", { expression: "scrollTo(0," + y + ")" });
    await sleep(260);
    const at = await cdp.send("Runtime.evaluate", { expression: "String(scrollY)", returnByValue: true });
    const scrollY = Number(at.result.value);

    /* Boxes in viewport coordinates, clear of the fixed bars. */
    const here = items.map((it, i) => ({ i, it, box: [it.box[0], it.box[1] - scrollY, it.box[2], it.box[3]] }))
      .filter(o => o.box[1] >= topGuard && o.box[1] + o.box[3] <= H - botGuard);
    if (!here.length) continue;

    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    const sampled = await cdp.send("Runtime.evaluate", {
      expression: SAMPLE
        .replace("DATA_URL", JSON.stringify("data:image/png;base64," + shot.data))
        .replace("BOXES", JSON.stringify(here.map(o =>
          ({ box: o.box, color: o.it.color, radius: o.it.radius })))),
      awaitPromise: true, returnByValue: true
    });
    JSON.parse(sampled.result.value).forEach((m, k) => {
      if (!m || !isFinite(m.worst)) return;
      const idx = here[k].i;
      if (!best.has(idx) || m.worst < best.get(idx).worst) best.set(idx, m);
    });
    if (scrollY >= pageH - H) break;
  }

  const rows = [];
  items.forEach((it, i) => {
    const m = best.get(i);
    if (!m) return;                        /* never fully visible; nothing to claim */
    /* WCAG AA: 3:1 for large text (>=24px, or >=18.66px bold), else 4.5:1 */
    const large = it.size >= 24 || (it.size >= 18.66 && Number(it.weight) >= 700);
    rows.push({ ...it, worst: m.worst, worstPx: m.px, need: large ? 3 : 4.5, large });
  });

  rows.sort((a, b) => a.worst - b.worst);
  console.log("\n  " + URL_ + "  " + W + "x" + H + "\n");
  const bad = rows.filter(r => r.worst < r.need);
  rows.slice(0, 12).forEach(r => {
    console.log("  " + (r.worst < r.need ? "FAIL " : "ok   ") +
      r.worst.toFixed(2).padStart(6) + ":1  (needs " + r.need + ")  " +
      String(Math.round(r.size) + "px").padEnd(6) +
      "on rgb(" + r.worstPx.join(",") + ")".padEnd(6) + "  " + JSON.stringify(r.text));
  });
  console.log("\n  " + rows.length + " text runs measured, " + bad.length + " failing\n");

  chrome.kill(); await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(bad.length ? 1 : 0);
}
main().catch(e => { console.error("FAILED: " + e.message); process.exit(1); });
