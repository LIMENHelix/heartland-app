/* The app-icon lion as a page backdrop, KEEPING ITS OWN COLOURS.

   The earlier version used the icon's brightness as an opacity mask and
   painted it all in one tan. That solved the contrast problem and threw the
   photograph away: a stencil, not a lion.

   This keeps every pixel's own hue. Three steps, in this order:

     1  boost saturation, because step 2 compresses the range and would
        otherwise leave everything grey
     2  compress luminance into a light band, which preserves relative colour
        and detail while lifting the whole image clear of dark type
     3  fade to paper radially, so the icon's square edge and its near-black
        surround both disappear instead of leaving a rectangle

   node lioncolor.js <src.png> <outDir> [lo] [hi] [sat]                       */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9493;
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(u) {
    this.ws = new WebSocket(u); this.id = 0; this.p = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener("open", () => res());
      this.ws.addEventListener("error", () => rej(new Error("ws")));
    });
    this.ws.addEventListener("message", e => {
      const m = JSON.parse(e.data);
      if (m.id && this.p.has(m.id)) {
        const { resolve, reject } = this.p.get(m.id); this.p.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.p.has(id)) { this.p.delete(id); rej(new Error(method + " timeout")); } }, 40000);
    });
  }
}

(async () => {
  const [src, outDir, loA, hiA, satA] = process.argv.slice(2);
  const LO = Number(loA || 168), HI = Number(hiA || 251), SAT = Number(satA || 2.4);
  fs.mkdirSync(outDir, { recursive: true });

  const dir = path.dirname(path.resolve(src)).split(path.sep).join("/");
  const file = path.basename(src);
  const profile = path.join(os.tmpdir(), "hmh-lioncol-" + Date.now());
  const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu",
    "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile,
    "--allow-file-access-from-files", "--no-first-run", "about:blank"], { stdio: "ignore" });

  let ws = null;
  for (let i = 0; i < 60 && !ws; i++) {
    await sleep(250);
    try {
      const l = await (await fetch("http://127.0.0.1:" + PORT + "/json/list")).json();
      const p = l.find(t => t.type === "page"); if (p) ws = p.webSocketDebuggerUrl;
    } catch (e) {}
  }
  const cdp = new CDP(ws); await cdp.ready;
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Page.navigate", { url: "file:///" + dir + "/enc.html" });
  await sleep(900);

  const expr = `(async () => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("load")); img.src = ${JSON.stringify(file)}; });

    const W = 1280, H = 720;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d", { alpha: false });

    const cream = [247, 243, 235];
    g.fillStyle = "rgb(" + cream.join(",") + ")"; g.fillRect(0, 0, W, H);

    const side = Math.round(H * 1.18);
    const dx = Math.round((W - side) / 2), dy = Math.round((H - side) / 2);
    g.drawImage(img, dx, dy, side, side);

    const d = g.getImageData(0, 0, W, H);
    const px = d.data;
    const LO = ${LO}, HI = ${HI}, SPAN = HI - LO, SAT = ${SAT};
    const cx = W / 2, cy = H / 2;
    const rIn = H * 0.30, rOut = H * 0.72;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;

        /* inside the drawn square? outside it, leave the cream alone */
        const inSquare = x >= dx && x < dx + side && y >= dy && y < dy + side;

        let r = px[i], gg = px[i + 1], b = px[i + 2];

        /* 1. saturation, around the pixel's own grey */
        const grey = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        r  = grey + (r  - grey) * SAT;
        gg = grey + (gg - grey) * SAT;
        b  = grey + (b  - grey) * SAT;

        /* 2. compress into the light band */
        r  = LO + (Math.max(0, Math.min(255, r))  / 255) * SPAN;
        gg = LO + (Math.max(0, Math.min(255, gg)) / 255) * SPAN;
        b  = LO + (Math.max(0, Math.min(255, b))  / 255) * SPAN;

        /* 3. fade to paper towards the edges, and everywhere outside the square */
        const dist = Math.hypot(x - cx, y - cy);
        let a = inSquare ? 1 - Math.max(0, Math.min(1, (dist - rIn) / (rOut - rIn))) : 0;
        a = a * a * (3 - 2 * a);   /* smoothstep, so there is no visible ring */

        /* Weight by the pixel's ORIGINAL brightness as well. The icon's
           near-black surround would otherwise compress to a flat grey and
           read as a halo around the head; this lets it fall away to paper
           while the lit mane keeps full strength and full colour. */
        const L0 = grey / 255;
        a *= 0.72 + 0.28 * Math.pow(L0, 0.6);

        px[i]     = cream[0] * (1 - a) + r  * a;
        px[i + 1] = cream[1] * (1 - a) + gg * a;
        px[i + 2] = cream[2] * (1 - a) + b  * a;
      }
    }
    g.putImageData(d, 0, 0);

    const out = g.getImageData(0, 0, W, H).data;
    let min = 255, minPx = null;
    for (let i = 0; i < out.length; i += 4 * 5) {
      const y2 = 0.2126 * out[i] + 0.7152 * out[i+1] + 0.0722 * out[i+2];
      if (y2 < min) { min = y2; minPx = [out[i], out[i+1], out[i+2]]; }
    }
    return JSON.stringify({ min: Math.round(min), minPx: minPx.map(Math.round),
                            data: c.toDataURL("image/webp", 0.88) });
  })()`;

  const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) { console.error("FAILED: " + r.exceptionDetails.text); process.exit(1); }
  const o = JSON.parse(r.result.value);
  const buf = Buffer.from(o.data.split(",")[1], "base64");
  const outFile = path.join(outDir, "backdrop.webp");
  fs.writeFileSync(outFile, buf);

  /* what navy type will actually get on the worst pixel */
  const rl = (a) => { const f = a.map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); });
                      return 0.2126*f[0] + 0.7152*f[1] + 0.0722*f[2]; };
  const navy = rl([33,49,59]), bg = rl(o.minPx);
  const ratio = ((Math.max(navy,bg)+0.05)/(Math.min(navy,bg)+0.05)).toFixed(2);
  console.log("  band [" + LO + "," + HI + "]  sat " + SAT +
              "   darkest rgb(" + o.minPx.join(",") + ")   navy " + ratio + ":1   " +
              Math.round(buf.length/1024) + "kb   -> " + outFile);

  chrome.kill(); await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error("FAILED", e.message); process.exit(1); });
