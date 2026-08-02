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
  { name: "lion-1-haze",
    prompt: "High-key fine-art photograph of a majestic male lion with a full mane, standing in bright white morning haze, heavily overexposed and washed out so the whole frame is pale, the lion rendered in soft faint warm gold and cream tones as if seen through bright fog, NO dark areas, NO black, NO deep shadows, extremely low contrast, ethereal and airy, palette of white, cream, pale sand and faint warm gold, no text, no watermark, wide 16:9" },

  { name: "lion-2-studio",
    prompt: "High-key studio photograph of a male lion with a full mane in profile against a pure white seamless background, blown-out high-key lighting from all sides, the lion pale golden and softly lit with NO dark shadows and NO black anywhere, very low contrast, minimal and clean, palette of white, cream and pale gold, no text, no watermark, wide 16:9" },

  { name: "lion-3-faint",
    prompt: "Extremely faint high-key photograph of a male lion's head and mane emerging from bright cream mist, barely visible, like a watermark or a memory, the whole image washed out to near-white with only the softest warm gold suggestion of the mane, NO dark areas, NO black, NO shadows, almost no contrast, calm and minimal, palette of white, cream and the faintest gold, no text, no watermark, wide 16:9" }
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
