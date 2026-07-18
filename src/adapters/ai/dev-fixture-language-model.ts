import "server-only";

import type {
  LanguageModel,
  LanguageModelRequest,
  LanguageModelResponse,
} from "@/application/ports/language-model";

/**
 * A DEV/E2E fixture language model. There is no `AI_GATEWAY_API_KEY` in dev, test,
 * or CI and no paid call may be made (AGENTS.md), so the running dev app (and the
 * Playwright e2e) needs a language model that returns BELIEVABLE, schema-valid,
 * context-consistent fixtures for the one-off pipeline — mirroring the image
 * model's dev fake (M4). It is NOT used by unit/integration tests, which inject
 * `createFakeLanguageModel` directly; it exists so the mobile create flow actually
 * publishes a real-feeling story offline.
 *
 * It is context-aware: it reads the trusted `<canonical_context>` from the built
 * envelope so the plan's protagonist matches the real cast, the draft covers the
 * real plan beats and lands in the word band, and the illustration plan references
 * the real anchors — otherwise the pipeline's cross-reference and deterministic
 * checks would (correctly) reject a mismatched fixture.
 */

interface CanonicalContext {
  beatTarget?: { min: number; max: number };
  wordCountTarget?: { min: number; max: number };
  characters?: { key: string; name: string; apparentAge?: number }[];
  plan?: { title?: string; beats?: { key: string }[] };
  anchorKeys?: string[];
  chapterCount?: number;
  chapterNumber?: number;
}

/** Extract + parse the canonical context JSON from the built envelope. */
function canonicalContext(prompt: string): CanonicalContext {
  const match = prompt.match(
    /<canonical_context>\n([\s\S]*?)\n\s*<\/canonical_context>/,
  );
  if (!match) return {};
  const unescaped = match[1]
    .replace(/\\u003c/g, "<")
    .replace(/\\u003e/g, ">")
    .replace(/\\u0026/g, "&");
  try {
    return JSON.parse(unescaped) as CanonicalContext;
  } catch {
    return {};
  }
}

const SENTENCE =
  "Rosa stepped softly onto the cool grass and looked around the quiet garden, where the evening had folded itself gently over every sleeping flower.";

/** Build paragraphs whose total word count lands near the target midpoint. */
function bodyParagraphs(target: { min: number; max: number }): string[] {
  const mid = Math.round((target.min + target.max) / 2);
  const wordsPerSentence = SENTENCE.split(/\s+/).length;
  const totalSentences = Math.max(6, Math.round(mid / wordsPerSentence));
  const paragraphs: string[] = [];
  for (let i = 0; i < totalSentences; i += 2) {
    paragraphs.push(
      Array.from(
        { length: Math.min(2, totalSentences - i) },
        () => SENTENCE,
      ).join(" "),
    );
  }
  return paragraphs;
}

function planFixture(ctx: CanonicalContext): unknown {
  const beatCount = ctx.beatTarget?.min ?? 6;
  const protagonistKey = ctx.characters?.[0]?.key ?? "hero";
  const protagonistName = ctx.characters?.[0]?.name ?? "our hero";
  const beats = Array.from({ length: beatCount }, (_v, i) => ({
    key: `beat-${i + 1}`,
    description:
      i === 0
        ? `${protagonistName} notices the garden has grown dark`
        : i === beatCount - 1
          ? `${protagonistName} reaches the warm door and settles in`
          : `${protagonistName} takes another small, brave step along the path`,
  }));
  return {
    schemaVersion: "one-off-plan.v1",
    title: "The Lantern in the Garden",
    setting: `A small, safe garden at dusk`,
    protagonistKey,
    protagonistDesire: "to find the way back to the warm kitchen door",
    obstacle: "the garden has grown dark and quiet",
    emotionalTheme: "finding courage in small, gentle steps",
    beats,
    climax: "The path forks, and for a moment the way home is unclear",
    resolution: "A friendly firefly drifts ahead and lights the gentler path",
    calmingClose:
      "Warm and sleepy, our hero watches the lantern glow softly fade",
  };
}

function draftFixture(ctx: CanonicalContext): unknown {
  const beatKeys = ctx.plan?.beats?.map((b) => b.key) ?? ["beat-1"];
  const paragraphs = bodyParagraphs(
    ctx.wordCountTarget ?? { min: 600, max: 900 },
  );
  return {
    schemaVersion: "chapter-draft.v1",
    // The draft title follows the plan title (which the series plan varies per
    // chapter, below), so a series does not publish every chapter under one name.
    title: ctx.plan?.title ?? "The Lantern in the Garden",
    paragraphs,
    beatsCovered: beatKeys,
    illustrationAnchors: [
      {
        key: "anchor-1",
        afterParagraph: 1,
        description: "The garden at dusk",
      },
    ],
  };
}

function reviewFixture(): unknown {
  return {
    schemaVersion: "chapter-review.v1",
    completeArc: true,
    resolvesCentralProblem: true,
    endsCalmly: true,
    sequelDependency: false,
    ageAppropriate: true,
    findings: [],
    summary: "A gentle, complete story that resolves kindly and ends calmly.",
  };
}

function illustrationFixture(ctx: CanonicalContext): unknown {
  const keys = ctx.anchorKeys ?? [];
  return {
    schemaVersion: "illustration-plan.v1",
    illustrations: keys.map((anchorKey) => ({
      anchorKey,
      caption: "The garden glows softly in the evening light.",
      sceneDescription: "A small child in a safe garden at dusk, warm light.",
      aspect: "landscape",
    })),
  };
}

/** A VALID series bible for the given chapter count + cast (passes validation). */
function seriesBibleFixture(ctx: CanonicalContext): unknown {
  const n = ctx.chapterCount ?? 5;
  const cast = ctx.characters ?? [{ key: "hero", name: "our hero" }];
  const centralThread = "the-lost-lantern";
  const blueprints = Array.from({ length: n }, (_v, i) => {
    const chapterNumber = i + 1;
    return {
      chapterNumber,
      narrativePurpose: `Move the friends one gentle step along their quest (chapter ${chapterNumber}).`,
      openingState: "The friends wake to a soft, hopeful morning.",
      localGoal: "Find the next small clue on the path.",
      conflict: "A gentle obstacle asks them to be brave and kind.",
      majorBeats: [
        { key: `c${chapterNumber}-b1`, description: "They set out together." },
        {
          key: `c${chapterNumber}-b2`,
          description: "They help someone and learn something.",
        },
      ],
      emotionalMovement: "From worry to warm reassurance.",
      informationRevealed: "A small, kind truth about the Moonwood.",
      threadsIntroduced: chapterNumber === 1 ? [centralThread] : [],
      threadsAdvanced:
        chapterNumber > 1 && chapterNumber < n ? [centralThread] : [],
      threadsResolved: chapterNumber === n ? [centralThread] : [],
      closingState: "The friends settle in, cosy and safe.",
      tomorrowPromise:
        chapterNumber < n
          ? "Tomorrow, a new path opens through the trees."
          : "And so the whole story is told.",
    };
  });
  return {
    schemaVersion: "series-bible.v1",
    title: "The Moonwood Friends",
    spoilerFreePremise:
      "A gentle band of friends explore a glowing night forest.",
    internalSynopsis:
      "The friends follow the light of a lost lantern through the Moonwood, learning that kindness lights every path, and return it home.",
    emotionalPromise: "Courage grows from small, shared kindnesses.",
    worldRules: ["The Moonwood only glows for travellers who are kind."],
    locations: [
      { key: "home", name: "The warm house" },
      { key: "moonwood", name: "The Moonwood" },
    ],
    startingLocationKey: "home",
    cast: cast.map((c) => ({ characterKey: c.key, role: "a brave friend" })),
    centralQuestion:
      "Can the friends return the lost lantern before the last night?",
    centralConflict: "The Moonwood is growing dark and needs its lantern back.",
    plannedEnding:
      "The lantern is returned, the Moonwood glows warmly again, and the friends sleep soundly.",
    characterArcs: cast.map((c) => ({
      characterKey: c.key,
      arc: "learns that being kind is its own kind of brave",
    })),
    plotThreads: [
      {
        threadKey: centralThread,
        description: "A lantern that lights the Moonwood has gone missing.",
        introduceInChapter: 1,
        resolveInChapter: n,
        central: true,
      },
    ],
    chapterBlueprints: blueprints,
    immutableFacts: [
      { factKey: "moonwood-glows", statement: "The Moonwood glows at night." },
    ],
    forbiddenDevelopments: ["No friend is ever truly lost."],
  };
}

/**
 * Deterministic per-chapter titles so a series does not publish every chapter under
 * the same name (cosmetic, dev-only). Keyed by the plan stage's `chapterNumber`
 * (which the series chapter-plan canonical context carries); falls back to the first
 * title if absent.
 */
const SERIES_CHAPTER_TITLES = [
  "Into the Moonwood",
  "The Whispering Path",
  "A Light Among the Trees",
  "Across the Silver Stream",
  "The Longest Night",
  "The Owl's Quiet Secret",
  "Where the Path Forks",
  "A Promise Kept",
  "The Last Small Clue",
  "The Lantern Comes Home",
];

/** A valid chapter plan (beats within the beat band; protagonist from the cast). */
function chapterPlanFixture(ctx: CanonicalContext): unknown {
  const beatCount = ctx.beatTarget?.min ?? 6;
  const protagonistKey = ctx.characters?.[0]?.key ?? "hero";
  const protagonistName = ctx.characters?.[0]?.name ?? "our hero";
  const beats = Array.from({ length: beatCount }, (_v, i) => ({
    key: `beat-${i + 1}`,
    description:
      i === 0
        ? `${protagonistName} wakes and remembers the quest`
        : i === beatCount - 1
          ? `${protagonistName} settles in, cosy and hopeful for tomorrow`
          : `${protagonistName} takes another gentle, brave step`,
  }));
  const chapterNumber = ctx.chapterNumber ?? 1;
  return {
    schemaVersion: "chapter-plan.v1",
    title:
      SERIES_CHAPTER_TITLES[(chapterNumber - 1) % SERIES_CHAPTER_TITLES.length],
    setting: "A soft path winding into the glowing Moonwood",
    protagonistKey,
    protagonistDesire: "to follow the lantern's light a little further",
    obstacle: "the path forks and the way is unclear",
    emotionalTheme: "finding courage in small, kind steps",
    beats,
    climax: "For a moment the light dims and the way home is unclear",
    resolution: "A gentle friend of the wood lights the kinder path",
    calmingClose: "Warm and sleepy, the friends rest, ready for tomorrow",
  };
}

/** A minimal, always-valid continuity change set (applies cleanly to any state). */
function continuityChangeFixture(): unknown {
  return {
    schemaVersion: "continuity-change.v1",
    currentTime: "night",
    currentLocationId: null,
    characterMoves: [],
    emotionChanges: [],
    outfitChanges: [],
    possessionChanges: [],
    knowledgeGains: [],
    readerKnowledgeGains: [],
    relationshipChanges: [],
    temporaryConditionChanges: [],
    threadTransitions: [],
    locationDiscoveries: [],
    newFacts: [],
    supersededFacts: [],
  };
}

export function createDevFixtureLanguageModel(): LanguageModel {
  return {
    async generate(
      request: LanguageModelRequest,
    ): Promise<LanguageModelResponse> {
      const ctx = canonicalContext(request.prompt);
      let payload: unknown;
      switch (request.schemaName) {
        case "StorylightOneOffPlan":
          payload = planFixture(ctx);
          break;
        case "StorylightChapterPlan":
          payload = chapterPlanFixture(ctx);
          break;
        case "StorylightChapterDraft":
          payload = draftFixture(ctx);
          break;
        case "StorylightChapterReview":
          payload = reviewFixture();
          break;
        case "StorylightIllustrationPlan":
          payload = illustrationFixture(ctx);
          break;
        case "StorylightSeriesBible":
          payload = seriesBibleFixture(ctx);
          break;
        case "StorylightContinuityChange":
          payload = continuityChangeFixture();
          break;
        default:
          payload = {};
      }
      return {
        text: JSON.stringify(payload),
        resolvedModelId: `dev-fixture:${request.target}`,
        usage: { inputTokens: 100, outputTokens: 300, totalTokens: 400 },
        latencyMs: 5,
        finishReason: "stop",
      };
    },
  };
}
