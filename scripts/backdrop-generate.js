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
  { name: "01-couple",
    prompt: "Cinematic editorial photograph, a relaxed man in his late forties and his wife on a sunlit porch in early evening, laughing quietly together, positioned in the right third of the frame and softly out of focus, the left two thirds filled with warm blurred evening light and empty space, muted palette of cream, tan and soft gold, natural low-contrast window light, no harsh shadows, shallow depth of field, no text, no watermark, no logos, wide 16:9 composition" },

  { name: "02-road",
    prompt: "Cinematic documentary photograph, a fit man in his fifties running on a quiet tree-lined road at dawn, seen from far behind and small in the frame, soft golden morning haze, the composition dominated by open empty road and diffused light, very low contrast, muted warm neutrals of cream and pale gold, no text, no watermark, no logos, wide 16:9 composition" },

  { name: "03-clinic",
    prompt: "Architectural interior photograph, the quiet corner of a modern private men's health clinic consultation room, warm oak panelling and matte deep navy surfaces, a single soft lamp, one empty leather chair, mostly gently blurred with a large uncluttered warm wall area, soft natural daylight, palette of cream, warm oak, deep blue-grey and brushed brass, no people, no text, no watermark, no logos, wide 16:9 composition" },

  { name: "04-abstract",
    prompt: "Abstract macro photograph of warm brushed brass meeting soft cream stone along a gentle diagonal, extremely shallow depth of field so the whole frame is softly out of focus, subtle golden light gradient, no recognisable objects, minimal and calm, muted palette of cream, tan, deep gold and charcoal, no text, no watermark, no logos, wide 16:9 composition" }
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
