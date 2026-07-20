import { generateText, generateImage } from "ai";
import { writeFileSync } from "node:fs";
const OUT = process.env.OUT;
const GEMINI_LANG = new Set([
  "google/gemini-3.1-flash-image",
  "google/gemini-3-pro-image",
]);
const SCENE =
  "The same young girl kneeling in a moonlit garden beside a small worried owl, holding a tiny lantern. Warm digital gouache children's-storybook style, soft night colours, 4:3.";
const img = (f) =>
  (f || []).filter((x) => x.mediaType?.startsWith("image/"))[0];

async function scene(model, ref) {
  const t = Date.now();
  if (GEMINI_LANG.has(model)) {
    const r = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Using the attached reference of this child, draw her (identical face, hair, skin) in this scene: " +
                SCENE,
            },
            { type: "image", image: ref },
          ],
        },
      ],
    });
    const i = img(r.files);
    return { bytes: i?.uint8Array, ms: Date.now() - t };
  }
  const r = await generateImage({
    model,
    prompt: {
      images: [ref],
      text:
        SCENE + " Keep the child's face and hair identical to the reference.",
    },
  });
  return { bytes: r.image?.uint8Array, ms: Date.now() - t };
}

async function review(ref, sc) {
  // lenient: ask for compact JSON, parse
  const r = await generateText({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: 'Image 1 = approved reference of a child. Image 2 = a generated story scene. Reply ONLY with compact JSON: {"identityMatch":bool,"identityConfidence":0-100,"styleGouacheStorybook":bool,"childCount":int,"note":"<=120 chars"}. No markdown.',
          },
          { type: "image", image: ref },
          { type: "image", image: sc },
        ],
      },
    ],
  });
  const m = r.text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : { raw: r.text.slice(0, 120) };
}

const r0 = await generateText({
  model: "google/gemini-3-pro-image",
  prompt:
    "Children's storybook front portrait of a 6-year-old girl named Ivy: curly auburn hair, freckles, green eyes, front-facing, warm digital gouache, plain background.",
});
const ref = img(r0.files);
writeFileSync(OUT + "/reference.png", ref.uint8Array);
console.log("reference:", ref.uint8Array.length, "B\n");
for (const m of [
  "google/gemini-3.1-flash-image",
  "google/gemini-3-pro-image",
  "bytedance/seedream-5.0-pro",
  "bytedance/seedream-5.0-lite",
]) {
  try {
    const s = await scene(m, ref.uint8Array);
    if (!s.bytes) {
      console.log(m, "-> no image (" + s.ms + "ms)\n");
      continue;
    }
    const fn = m.replace(/[/.]/g, "_") + ".png";
    writeFileSync(OUT + "/" + fn, s.bytes);
    const v = await review(ref.uint8Array, s.bytes);
    console.log(
      m +
        "  [" +
        Math.round(s.bytes / 1024) +
        "KB, " +
        (s.ms / 1000).toFixed(1) +
        "s] -> " +
        fn,
    );
    console.log("   " + JSON.stringify(v) + "\n");
  } catch (e) {
    console.log(
      m,
      "-> ERR",
      e?.name,
      (e?.message || e).toString().slice(0, 120),
      "\n",
    );
  }
}
console.log("images saved in:", OUT);
