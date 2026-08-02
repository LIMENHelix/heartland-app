/* Turn the app-icon lion into a page backdrop.

   The icon is a near-black portrait. Dark text cannot sit on that, so rather
   than pick a different lion this remaps THIS lion's tones into the light end
   of the range: every level is preserved, the whole thing is just moved up
   into a band that dark type clears. The head, the mane, the shape are all
   still there, rendered as a watermark rather than a photograph.

   node lionize.js <src.png> <outDir> [lo] [hi]                              */
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9491;
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
  const [src, outDir, loArg, hiArg] = process.argv.slice(2);
  const LO = Number(loArg || 420);   /* strength x1000 */
  const HI = Number(hiArg || 0);
  fs.mkdirSync(outDir, { recursive: true });

  const dir = path.dirname(path.resolve(src)).split(path.sep).join("/");
  const file = path.basename(src);
  const profile = path.join(os.tmpdir(), "hmh-lionize-" + Date.now());
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
    /* Fill BLACK, not cream. The mapping below turns brightness into ink, so
       anything untouched must start at zero brightness or the empty margins
       come out as solid tan bars. */
    g.fillStyle = "#000000"; g.fillRect(0, 0, W, H);

    /* The icon is square. Draw it tall and centred so the head fills the
       height, then let the cream field carry the rest of the width. */
    const side = Math.round(H * 1.06);
    const dx = Math.round((W - side) / 2), dy = Math.round((H - side) / 2);
    g.drawImage(img, dx, dy, side, side);

    const d = g.getImageData(0, 0, W, H);
    const px = d.data;
    const STRENGTH = ${LO} / 1000;          /* reused as the mark's strength */
    const cream = [247, 243, 235];
    const tint  = [138, 108, 58];           /* warm tan, sits in the brand's gold family */

    /* The icon is a bright lion on a near-black surround. Using its own
       brightness as the mark's opacity means the lion paints in warm tan and
       the black surround becomes paper exactly, so there is no rectangle edge
       to hide and no seam when the page crops it. */
    for (let i = 0; i < px.length; i += 4) {
      const L = (0.2126 * px[i] + 0.7152 * px[i+1] + 0.0722 * px[i+2]) / 255;
      const a = L * STRENGTH;
      px[i]     = cream[0] * (1 - a) + tint[0] * a;
      px[i + 1] = cream[1] * (1 - a) + tint[1] * a;
      px[i + 2] = cream[2] * (1 - a) + tint[2] * a;
    }
    g.putImageData(d, 0, 0);

    /* report the darkest pixel: the number that decides if this is usable */
    const out = g.getImageData(0, 0, W, H).data;
    let min = 255;
    for (let i = 0; i < out.length; i += 4 * 7) {
      const y = 0.2126 * out[i] + 0.7152 * out[i+1] + 0.0722 * out[i+2];
      if (y < min) min = y;
    }
    return JSON.stringify({ min: Math.round(min), data: c.toDataURL("image/webp", 0.86) });
  })()`;

  const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) { console.error("FAILED: " + r.exceptionDetails.text); process.exit(1); }
  const o = JSON.parse(r.result.value);
  const buf = Buffer.from(o.data.split(",")[1], "base64");
  const outFile = path.join(outDir, "backdrop.webp");
  fs.writeFileSync(outFile, buf);
  console.log("  mark strength " + (LO/1000).toFixed(2) + "   darkest pixel " + o.min +
              "   " + Math.round(buf.length / 1024) + "kb   -> " + outFile);

  chrome.kill(); await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error("FAILED", e.message); process.exit(1); });
