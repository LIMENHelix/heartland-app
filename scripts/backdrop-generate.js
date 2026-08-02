/* Generate backdrop candidates with xAI's image model.
   node grok-image.js <outDir>                                              */
"use strict";
const fs = require("fs");
const path = require("path");

/* The key lives in the LIMEN repo's env file, not this project's. Read it
   directly rather than copying it anywhere. */
function xaiKey() {
  const raw = fs.readFileSync("C:/Users/Chris/Limen-Helix-live-/.env.local", "utf8");
  const m = raw.match(/^XAI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error("XAI_API_KEY not found");
  return m[1].trim();
}

/* Written for a background BEHIND dense working UI: calm, soft, low contrast,
   nothing sharp competing with tables of patient names. */
const PROMPTS = [
  { name: "L1-clinic-highkey",
    prompt: "High-key architectural photograph of a bright modern men's health clinic interior, flooded with soft diffused daylight, pale bleached oak, warm white walls, cream upholstery, a hint of brushed brass, everything light and airy with NO dark areas, NO deep shadows, NO black, uniformly bright and overexposed in the highlights, very low contrast, soft focus throughout, palette of white, cream, pale sand and light warm grey, no people, no text, no watermark, wide 16:9" },

  { name: "L2-linen-highkey",
    prompt: "High-key macro photograph of cream linen fabric and pale warm stone with a faint brushed gold thread, extremely soft focus, flooded with bright diffused light, entirely light and airy, NO dark areas, NO shadows, NO black, very low contrast, minimal and calm, palette of white, cream, oatmeal and the faintest warm gold, no text, no watermark, wide 16:9" },

  { name: "L3-couple-highkey",
    prompt: "High-key lifestyle photograph, a man in his late forties and his wife walking together outdoors in bright hazy morning sunlight, seen small and far away in the lower right, heavily overexposed and washed out, the frame dominated by bright white haze and pale sky, NO dark areas, NO deep shadows, very low contrast, dreamlike and airy, palette of white, cream and pale gold, no text, no watermark, wide 16:9" }
];

(async () => {
  const outDir = process.argv[2] || ".";
  fs.mkdirSync(outDir, { recursive: true });
  const key = xaiKey();
  let spent = 0;

  for (const p of PROMPTS) {
    process.stdout.write("  " + p.name.padEnd(14));
    try {
      const r = await fetch("https://api.x.ai/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          model: "grok-imagine-image",
          prompt: p.prompt,
          n: 1,
          response_format: "b64_json"
        })
      });
      if (!r.ok) {
        console.log("HTTP " + r.status + "  " + (await r.text()).slice(0, 200));
        continue;
      }
      const j = await r.json();
      const item = (j.data || [])[0];
      if (!item || !item.b64_json) { console.log("no image in response"); continue; }
      const buf = Buffer.from(item.b64_json, "base64");
      const file = path.join(outDir, p.name + ".jpg");
      fs.writeFileSync(file, buf);
      spent += 0.07;
      console.log(Math.round(buf.length / 1024) + "kb  -> " + p.name + ".jpg");
      if (item.revised_prompt) {
        fs.writeFileSync(path.join(outDir, p.name + ".txt"), item.revised_prompt);
      }
    } catch (e) {
      console.log("FAILED: " + e.message);
    }
  }
  console.log("\n  approximate spend: $" + spent.toFixed(2));
})();
