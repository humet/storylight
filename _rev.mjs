import { generateText } from "ai";
import { readFileSync } from "node:fs";
const OUT = process.env.OUT;
const ref = new Uint8Array(readFileSync(OUT + "/reference.png"));
async function review(sc) {
  const r = await generateText({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: 'Image 1 = approved reference of a child. Image 2 = a generated story scene. Reply ONLY compact JSON: {"identityMatch":bool,"identityConfidence":0-100,"style_gouache_storybook":bool,"childCount":int,"note":"<=110 chars"}',
          },
          { type: "image", image: ref },
          { type: "image", image: sc },
        ],
      },
    ],
  });
  const m = r.text.match(/\{[\s\S]*\}/);
  return m ? m[0] : r.text.slice(0, 120);
}
for (const [label, fn] of [
  ["gemini-3.1-flash-image", "google_gemini-3_1-flash-image.png"],
  ["gemini-3-pro-image", "google_gemini-3-pro-image.png"],
  ["seedream-5.0-pro", "bytedance_seedream-5_0-pro.png"],
]) {
  const sc = new Uint8Array(readFileSync(OUT + "/" + fn));
  console.log(
    label + " [" + Math.round(sc.length / 1024) + "KB]:",
    await review(sc),
  );
}
