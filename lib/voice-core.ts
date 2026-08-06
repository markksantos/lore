/**
 * How a person writes, as arithmetic.
 *
 * Split out of lib/understudy.ts so the browser build can run it. Everything in
 * this file is pure: strings in, numbers out, no filesystem, no model, no
 * network. That is what lets the same measurements run against a folder opened
 * in a browser tab and against a Mail archive on disk, with one implementation
 * — the same reason index-core, health-core and trust-core exist.
 *
 * The measurements themselves are the argument. "Write in a friendly, concise
 * tone" is a description of a voice; "your median sentence is fourteen words and
 * you use a contraction 71% of the times you could" is the voice, and a model
 * given numbers holds a register that a model given adjectives abandons within
 * two sentences.
 */

export type VoiceStats = {
  samples: number;
  words: number;
  /** Sentence length, in words. */
  sentenceMean: number;
  sentenceMedian: number;
  sentenceP90: number;
  sentenceShortShare: number;
  sentenceLongShare: number;
  paragraphMean: number;
  wordLengthMean: number;
  /** Of the places a contraction was possible, how often you used one. */
  contractionRate: number;
  /** Per thousand words. */
  emDashRate: number;
  semicolonRate: number;
  exclamationRate: number;
  questionRate: number;
  ellipsisRate: number;
  parentheticalRate: number;
  emojiRate: number;
  /** Share of sentences starting with a lowercase letter. */
  lowercaseOpenRate: number;
  /** Share of list-shaped lines. */
  bulletRate: number;
  firstPersonRate: number;
  openers: { phrase: string; n: number }[];
  closers: { phrase: string; n: number }[];
  /** Words you use far more than baseline English. */
  signature: { word: string; n: number; lift: number }[];
};

export type VoiceProfile = {
  at: number;
  overall: VoiceStats;
  /** The same measurements per audience, where there is enough to measure. */
  byAudience: { audience: string; stats: VoiceStats }[];
};

/**
 * Split into sentences without a natural-language library.
 *
 * The abbreviation guard is the whole difficulty: "Mr. Smith" and "e.g." are
 * not sentence ends, and treating them as such halves the measured sentence
 * length, which is the single most load-bearing number in the profile.
 */
export function splitSentences(text: string): string[] {
  const guarded = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|approx|Inc|Ltd|Co|No)\.\s/gi, "$1<DOT> ")
    .replace(/\b([A-Z])\.\s?(?=[A-Z]\.)/g, "$1<DOT>")
    .replace(/(\d)\.(\d)/g, "$1<DOT>$2");
  return guarded
    .split(/(?<=[.!?])[\s\n]+|\n{2,}/)
    .map((sentence) => sentence.replace(/<DOT>/g, ".").trim())
    .filter((sentence) => /\p{L}/u.test(sentence));
}

export const wordsOf = (text: string): string[] => text.match(/[\p{L}\p{N}'’-]+/gu) ?? [];

/**
 * The words that make a voice recognisable.
 *
 * Frequency alone returns "the, and, to" for everyone. What is wanted is LIFT —
 * how much more often you use a word than English does — so a small baseline of
 * the commonest English words is divided out. The baseline is deliberately
 * short: it only has to suppress the function words, and everything below its
 * floor gets a lift of one, which is the neutral value.
 */
const BASELINE: Record<string, number> = {
  the: 56, be: 33, to: 27, of: 26, and: 25, a: 22, in: 17, that: 11, have: 10, i: 10,
  it: 10, for: 9, not: 9, on: 8, with: 8, he: 8, as: 7, you: 7, do: 7, at: 6,
  this: 6, but: 6, his: 5, by: 5, from: 5, they: 5, we: 5, say: 4, her: 4, she: 4,
  or: 4, an: 4, will: 4, my: 4, one: 4, all: 4, would: 3, there: 3, their: 3, what: 3,
  so: 3, up: 3, out: 3, if: 3, about: 3, who: 3, get: 3, which: 3, go: 3, me: 3,
  when: 2, make: 2, can: 2, like: 2, time: 2, no: 2, just: 2, him: 2, know: 2, take: 2,
  is: 20, are: 8, was: 8, were: 4, been: 3, has: 5, had: 5, im: 2, its: 2, dont: 1,
};

export function measureVoice(texts: string[]): VoiceStats {
  const empty: VoiceStats = {
    samples: 0, words: 0, sentenceMean: 0, sentenceMedian: 0, sentenceP90: 0,
    sentenceShortShare: 0, sentenceLongShare: 0, paragraphMean: 0, wordLengthMean: 0,
    contractionRate: 0, emDashRate: 0, semicolonRate: 0, exclamationRate: 0,
    questionRate: 0, ellipsisRate: 0, parentheticalRate: 0, emojiRate: 0,
    lowercaseOpenRate: 0, bulletRate: 0, firstPersonRate: 0,
    openers: [], closers: [], signature: [],
  };
  if (!texts.length) return empty;

  const sentenceLengths: number[] = [];
  const paragraphLengths: number[] = [];
  const frequency = new Map<string, number>();
  const openerCounts = new Map<string, number>();
  const closerCounts = new Map<string, number>();

  let totalWords = 0;
  let totalWordChars = 0;
  let contractions = 0;
  let contractionOpportunities = 0;
  let emDashes = 0;
  let semicolons = 0;
  let exclamations = 0;
  let questions = 0;
  let ellipses = 0;
  let parentheticals = 0;
  let emoji = 0;
  let lowercaseOpens = 0;
  let sentenceCount = 0;
  let bulletLines = 0;
  let totalLines = 0;
  let firstPerson = 0;

  /*
   * The apostrophe is not always an apostrophe.
   *
   * macOS substitutes a right single quotation mark (U+2019) as you type, and
   * so does every mail client and note-taking app on it — so a corpus of real
   * writing contains "don’t", not "don't". Matching only the ASCII form meant
   * CONTRACTED found nothing while EXPANDED still matched, and the profile
   * reported a contraction rate of zero for somebody who uses them constantly.
   *
   * That is not a rounding error: contraction rate is one of the strongest
   * signals in the profile and it goes straight into the prompt as a number, so
   * Understudy was being told to write formally on behalf of people who do not.
   * `[’']` everywhere, and the test corpus uses the smart form.
   */
  const CONTRACTED = /\b(?:i[’']m|i[’']ve|i[’']d|i[’']ll|it[’']s|that[’']s|don[’']t|doesn[’']t|didn[’']t|can[’']t|won[’']t|isn[’']t|aren[’']t|wasn[’']t|weren[’']t|you[’']re|we[’']re|they[’']re|there[’']s|here[’']s|let[’']s|couldn[’']t|shouldn[’']t|wouldn[’']t|haven[’']t|hasn[’']t|hadn[’']t|what[’']s|who[’']s|he[’']s|she[’']s|we[’']ve|they[’']ve|you[’']ve|we[’']ll|they[’']ll|you[’']ll)\b/gi;
  const EXPANDED = /\b(?:i am|i have|i would|i will|it is|that is|do not|does not|did not|cannot|can not|will not|is not|are not|was not|were not|you are|we are|they are|there is|here is|let us|could not|should not|would not|have not|has not|had not|what is|who is|he is|she is|we have|they have|you have|we will|they will|you will)\b/gi;
  const EMOJI = /\p{Extended_Pictographic}/gu;

  for (const raw of texts) {
    const text = raw.replace(/\r\n?/g, "\n");
    const sentences = splitSentences(text);
    sentenceCount += sentences.length;

    for (const sentence of sentences) {
      const words = wordsOf(sentence);
      if (!words.length) continue;
      sentenceLengths.push(words.length);
      totalWords += words.length;
      for (const word of words) {
        totalWordChars += word.length;
        const key = word.toLowerCase().replace(/^['’-]+|['’-]+$/g, "");
        if (key.length > 2) frequency.set(key, (frequency.get(key) ?? 0) + 1);
        if (/^(i|me|my|mine|myself)$/.test(key)) firstPerson++;
      }
      if (/^[a-z]/.test(sentence)) lowercaseOpens++;
    }

    for (const paragraph of text.split(/\n{2,}/)) {
      const words = wordsOf(paragraph);
      if (words.length > 3) paragraphLengths.push(splitSentences(paragraph).length);
    }

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      totalLines++;
      if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) bulletLines++;
    }

    contractions += (text.match(CONTRACTED) ?? []).length;
    contractionOpportunities +=
      (text.match(CONTRACTED) ?? []).length + (text.match(EXPANDED) ?? []).length;
    emDashes += (text.match(/—|--/g) ?? []).length;
    semicolons += (text.match(/;/g) ?? []).length;
    exclamations += (text.match(/!/g) ?? []).length;
    questions += (text.match(/\?/g) ?? []).length;
    ellipses += (text.match(/\.\.\.|…/g) ?? []).length;
    parentheticals += (text.match(/\([^)]{3,}\)/g) ?? []).length;
    emoji += (text.match(EMOJI) ?? []).length;

    /* The opening three words and the closing sentence, which is where a
       personal register lives most visibly — greetings and sign-offs. */
    const sentences0 = splitSentences(text);
    if (sentences0.length) {
      const opener = wordsOf(sentences0[0]).slice(0, 3).join(" ").toLowerCase();
      if (opener) openerCounts.set(opener, (openerCounts.get(opener) ?? 0) + 1);
      const last = sentences0[sentences0.length - 1];
      const closer = wordsOf(last).slice(-4).join(" ").toLowerCase();
      if (closer) closerCounts.set(closer, (closerCounts.get(closer) ?? 0) + 1);
    }
  }

  if (!sentenceLengths.length) return { ...empty, samples: texts.length };

  const sorted = [...sentenceLengths].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  const per1k = (n: number) => (totalWords ? (n / totalWords) * 1_000 : 0);

  const signature = [...frequency.entries()]
    .map(([word, n]) => {
      const share = (n / Math.max(1, totalWords)) * 1_000;
      /* Baseline is per-thousand too. Words absent from it get a divisor of
         0.2, which is roughly the frequency of a word that is common enough to
         appear five times in a thousand and still not be a function word. */
      const lift = share / (BASELINE[word] ?? 0.2);
      return { word, n, lift };
    })
    .filter((entry) => entry.n >= 3 && entry.word.length > 3)
    .sort((a, b) => b.lift * Math.log(1 + b.n) - a.lift * Math.log(1 + a.n))
    .slice(0, 20);

  const top = (map: Map<string, number>, min: number) =>
    [...map.entries()]
      .filter(([, n]) => n >= min)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([phrase, n]) => ({ phrase, n }));

  return {
    samples: texts.length,
    words: totalWords,
    sentenceMean: round(totalWords / sentenceLengths.length),
    sentenceMedian: at(0.5),
    sentenceP90: at(0.9),
    sentenceShortShare: round(sorted.filter((n) => n <= 8).length / sorted.length, 3),
    sentenceLongShare: round(sorted.filter((n) => n >= 25).length / sorted.length, 3),
    paragraphMean: paragraphLengths.length
      ? round(paragraphLengths.reduce((a, b) => a + b, 0) / paragraphLengths.length)
      : 0,
    wordLengthMean: round(totalWordChars / Math.max(1, totalWords)),
    contractionRate: contractionOpportunities
      ? round(contractions / contractionOpportunities, 3)
      : 0,
    emDashRate: round(per1k(emDashes)),
    semicolonRate: round(per1k(semicolons)),
    exclamationRate: round(per1k(exclamations)),
    questionRate: round(per1k(questions)),
    ellipsisRate: round(per1k(ellipses)),
    parentheticalRate: round(per1k(parentheticals)),
    emojiRate: round(per1k(emoji)),
    lowercaseOpenRate: round(lowercaseOpens / Math.max(1, sentenceCount), 3),
    bulletRate: round(bulletLines / Math.max(1, totalLines), 3),
    firstPersonRate: round(per1k(firstPerson)),
    openers: top(openerCounts, 2),
    closers: top(closerCounts, 2),
    signature,
  };
}

const round = (n: number, places = 2): number => {
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** places;
  return Math.round(n * factor) / factor;
};


/** The profile, written as instructions a model can actually follow. */
export function voiceBrief(stats: VoiceStats): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines = [
    `Sentence length: median ${stats.sentenceMedian} words, mean ${stats.sentenceMean}. ${pct(stats.sentenceShortShare)} of sentences are 8 words or fewer; ${pct(stats.sentenceLongShare)} run past 25.`,
    `Paragraphs run about ${stats.paragraphMean} sentence${stats.paragraphMean === 1 ? "" : "s"}.`,
    `Contractions: used ${pct(stats.contractionRate)} of the time they are possible.`,
  ];

  const rare = (rate: number, name: string, verb = "uses") => {
    if (rate < 0.2) return `Never ${verb === "uses" ? "uses" : verb} ${name}.`;
    if (rate < 1.5) return `Rarely ${verb} ${name} (about ${rate} per 1,000 words).`;
    return `${verb === "uses" ? "Uses" : verb} ${name} often — ${rate} per 1,000 words.`;
  };
  lines.push(rare(stats.emDashRate, "em dashes"));
  lines.push(rare(stats.semicolonRate, "semicolons"));
  lines.push(rare(stats.exclamationRate, "exclamation marks"));
  lines.push(rare(stats.parentheticalRate, "parentheses"));
  if (stats.emojiRate > 0.3) lines.push(`Uses emoji: ${stats.emojiRate} per 1,000 words.`);
  else lines.push("Never uses emoji.");
  if (stats.lowercaseOpenRate > 0.15) {
    lines.push(`Starts ${pct(stats.lowercaseOpenRate)} of sentences with a lowercase letter — do the same.`);
  }
  if (stats.bulletRate > 0.12) lines.push(`Uses bullet lists: ${pct(stats.bulletRate)} of lines are list items.`);
  else lines.push("Writes in prose, not bullet lists.");

  if (stats.openers.length) {
    lines.push(`Typical openings: ${stats.openers.map((o) => `"${o.phrase}"`).join(", ")}.`);
  }
  if (stats.closers.length) {
    lines.push(`Typical endings: ${stats.closers.map((c) => `"${c.phrase}"`).join(", ")}.`);
  }
  if (stats.signature.length) {
    lines.push(
      `Characteristic words, used far more than average: ${stats.signature.slice(0, 12).map((s) => s.word).join(", ")}.`,
    );
  }
  return lines.join("\n");
}


/**
 * Score a draft against the profile.
 *
 * This is the part that makes "sounds like me" checkable. Each dimension is
 * scored by relative distance, and the ones that miss are named — so a draft
 * that reads wrong has a reason attached rather than a vague feeling, and
 * regenerating is an informed decision.
 */
export function compareVoice(
  stats: VoiceStats,
  text: string,
): { match: number | null; deviations: { name: string; yours: string; draft: string }[] } {
  if (!text.trim()) return { match: null, deviations: [] };
  const draftStats = measureVoice([text]);
  const deviations: { name: string; yours: string; draft: string }[] = [];
  const scores: number[] = [];

  const compare = (name: string, mine: number, theirs: number, tolerance: number, format: (n: number) => string) => {
    /* Relative distance with a floor on the denominator, so a dimension where
       both values are near zero — em dashes in someone who never uses them —
       does not produce a division that swamps everything else. */
    const scale = Math.max(Math.abs(mine), tolerance);
    const distance = Math.abs(mine - theirs) / scale;
    scores.push(Math.max(0, 1 - distance));
    if (distance > 0.5) deviations.push({ name, yours: format(mine), draft: format(theirs) });
  };

  const words = (n: number) => `${round(n, 1)} words`;
  const per1k = (n: number) => `${round(n, 1)}/1k`;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  compare("Sentence length", stats.sentenceMean, draftStats.sentenceMean, 4, words);
  compare("Short sentences", stats.sentenceShortShare, draftStats.sentenceShortShare, 0.15, pct);
  compare("Long sentences", stats.sentenceLongShare, draftStats.sentenceLongShare, 0.1, pct);
  compare("Contractions", stats.contractionRate, draftStats.contractionRate, 0.2, pct);
  compare("Em dashes", stats.emDashRate, draftStats.emDashRate, 1.5, per1k);
  compare("Semicolons", stats.semicolonRate, draftStats.semicolonRate, 1, per1k);
  compare("Exclamations", stats.exclamationRate, draftStats.exclamationRate, 1, per1k);
  compare("Parentheses", stats.parentheticalRate, draftStats.parentheticalRate, 1.5, per1k);
  compare("Emoji", stats.emojiRate, draftStats.emojiRate, 0.5, per1k);
  compare("Bullet lists", stats.bulletRate, draftStats.bulletRate, 0.12, pct);
  compare("Word length", stats.wordLengthMean, draftStats.wordLengthMean, 0.4, (n) => `${round(n, 2)} chars`);

  return {
    match: round(scores.reduce((a, b) => a + b, 0) / scores.length, 3),
    deviations: deviations.slice(0, 6),
  };
}

