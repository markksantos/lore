import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_MODEL,
  estimateCost,
  PROVIDER_LABEL,
  providerAvailability,
  streamChat,
  type ChatMessage,
  type ProviderId,
} from "@/lib/chorus-providers";
import { detectOllama, recommendModel } from "@/lib/ollama";
import { openDb, type Db } from "@/lib/signal-store";

/**
 * Chorus — three models argue, then answer.
 *
 * One question goes to several models at once. They answer without seeing each
 * other. Then each reads the others and says where they are wrong. Then one
 * writes the answer, and says out loud what the panel did not agree on.
 *
 * The claim being tested is that for a hard question the DISAGREEMENT is worth
 * more than any single answer. Three models that independently reach the same
 * conclusion is evidence; three that split is a warning that the question is
 * harder than it looks — and that warning is exactly what a single confident
 * answer destroys. So the dissent is not a footnote here. It is the output.
 *
 * Two design choices carry that:
 *
 *   THE CRITIQUE ROUND IS BLIND. Panelists see the other answers labelled "A",
 *   "B", "C" with no provider names attached. A model told it is reviewing
 *   Claude behaves differently from one reviewing an unattributed answer, and
 *   the whole point is a judgement about the argument.
 *
 *   THE SYNTHESIS MUST NAME THE SPLIT. Its instruction says the disagreements
 *   are the most valuable part, and a synthesis that reports no dissent when
 *   there was one is a failure, not a tidy result.
 *
 * This is the one part of Lore that sends what the user wrote to somebody
 * else's model, and it does so only for panelists the user explicitly chose. A local-only panel — several Ollama
 * models arguing — is a legitimate configuration and needs no key at all.
 */

export type Panelist = {
  /** Stable within one debate; the UI keys columns on it. */
  id: string;
  provider: ProviderId;
  model: string;
  label: string;
};

export type ChorusConfig = {
  panelists: Panelist[];
  /** Which panelist writes the synthesis; null lets Chorus choose. */
  chair: string | null;
  /** Skip the critique round — two rounds instead of three. */
  skipCritique: boolean;
  maxTokens: number;
};

const CHORUS_DIR = path.join(os.homedir(), ".lore", "chorus");
const CONFIG_FILE = path.join(CHORUS_DIR, "config.json");

export const DEFAULT_CHORUS: ChorusConfig = {
  panelists: [],
  chair: null,
  skipCritique: false,
  maxTokens: 1_400,
};

/**
 * A panel, assembled from whatever this machine can actually reach.
 *
 * Called when the user has never configured one, which is every first run. A
 * default panel of three frontier providers would be right for someone with
 * three keys and an empty screen with an error for everybody else, so this
 * takes what exists: every configured cloud provider, plus the local model, and
 * if that is only the local model then Chorus runs with a panel of one and says
 * so rather than refusing.
 */
export async function suggestPanel(): Promise<Panelist[]> {
  const availability = await providerAvailability();
  const panel: Panelist[] = [];
  for (const provider of ["anthropic", "openai", "google"] as ProviderId[]) {
    if (!availability[provider].configured) continue;
    panel.push({
      id: provider,
      provider,
      model: DEFAULT_MODEL[provider],
      label: PROVIDER_LABEL[provider],
    });
  }
  if (availability.openrouter.configured && panel.length < 2) {
    panel.push({
      id: "openrouter",
      provider: "openrouter",
      model: DEFAULT_MODEL.openrouter,
      label: "OpenRouter",
    });
  }

  const detection = await detectOllama().catch(() => null);
  if (detection?.running) {
    const local = recommendModel(detection.models);
    if (local) {
      panel.push({ id: "local", provider: "ollama", model: local, label: `Local · ${local}` });
    }
    /*
     * A second local model, when there is one, so a machine with no API keys
     * still gets an argument rather than a monologue. Two models from the same
     * family disagree less than two from different labs, which is a real
     * limitation and is said plainly in the UI.
     */
    if (panel.length < 2) {
      const second = detection.models.find((m) => m.name !== local);
      if (second) {
        panel.push({
          id: "local-2",
          provider: "ollama",
          model: second.name,
          label: `Local · ${second.name}`,
        });
      }
    }
  }
  return panel;
}

export async function readChorusConfig(): Promise<ChorusConfig> {
  const raw = await fs.readFile(CONFIG_FILE, "utf8").catch(() => "");
  let parsed: Partial<ChorusConfig> = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) as Partial<ChorusConfig>;
    } catch {
      parsed = {};
    }
  }
  /*
   * An empty panel is a decision, not an absence.
   *
   * `panelists.length ? panelists : suggestPanel()` meant removing the last
   * panelist silently re-added every configured cloud provider on the next
   * read — so somebody who deliberately emptied the panel to stop paying for it
   * would press Convene and bill three frontier models. The suggestion is only
   * for a config that has never had a panel at all.
   */
  const configured = Array.isArray(parsed.panelists);
  const panelists = Array.isArray(parsed.panelists)
    ? parsed.panelists.filter(
        (p): p is Panelist =>
          Boolean(p) &&
          typeof p.id === "string" &&
          typeof p.model === "string" &&
          typeof p.provider === "string" &&
          p.provider in PROVIDER_LABEL,
      )
    : [];
  return {
    panelists: configured ? panelists : await suggestPanel(),
    chair: typeof parsed.chair === "string" ? parsed.chair : null,
    skipCritique: parsed.skipCritique === true,
    maxTokens: Math.min(8_000, Math.max(200, Number(parsed.maxTokens) || DEFAULT_CHORUS.maxTokens)),
  };
}

export async function writeChorusConfig(config: ChorusConfig): Promise<ChorusConfig> {
  await fs.mkdir(CHORUS_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
}

// ------------------------------------------------------------------- history

const MIGRATIONS = [
  `
  CREATE TABLE debates (
    id        TEXT PRIMARY KEY,
    at        INTEGER NOT NULL,
    question  TEXT NOT NULL,
    synthesis TEXT,
    dissents  TEXT,
    panel     TEXT NOT NULL,
    rounds    TEXT NOT NULL,
    costUsd   REAL NOT NULL DEFAULT 0,
    ms        INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX debates_at ON debates(at DESC);
  `,
];

export function chorusDb(): Db {
  return openDb("chorus", MIGRATIONS);
}

// -------------------------------------------------------------------- prompts

const ROUND_1 = `Answer the question directly and completely. State your reasoning, and be specific about what you are confident in and what you are not.

Do not hedge to be safe. A wrong answer stated clearly is more useful to this process than a vague one, because the next round exists to catch it.`;

const ROUND_2 = `You are reviewing other answers to the same question you just answered. You do not know who wrote them.

For each answer, say:
- What it gets right that yours did not.
- What is wrong, unsupported, or missing — be specific, quote the claim.
- Whether you now think your own answer was wrong, and where.

Be direct. Agreement that is not earned is worse than useless here: this round exists to find the errors, and a reviewer who finds none has usually not looked. If an answer really is sound, say so in one line and move on.`;

const ROUND_3 = `You are writing the panel's final answer.

You have every independent answer and every critique. Produce:

1. THE ANSWER — the best answer the panel can give, in full. Where the panel agreed, state it plainly. Where a critique corrected an earlier answer, use the correction.

2. WHERE THE PANEL SPLIT — every substantive disagreement that was not resolved, what each side held, and what would settle it. If the split is on the central question, say that first and loudly.

Do not manufacture consensus. An unresolved disagreement reported honestly is the most valuable thing this panel produces; smoothing it into one confident paragraph destroys the only advantage of having asked more than one model.

If the panel genuinely agreed on everything, say so in one line — do not invent a dissent for symmetry.`;

// ---------------------------------------------------------------------- run

export type ChorusEvent =
  | { type: "start"; panel: Panelist[]; rounds: number }
  | { type: "round"; round: number; name: string }
  | { type: "begin"; round: number; panelist: string }
  | { type: "token"; round: number; panelist: string; text: string }
  | {
      type: "answer";
      round: number;
      panelist: string;
      text: string;
      ms: number;
      costUsd: number;
      error: string | null;
    }
  | { type: "synthesis"; text: string; by: string }
  | { type: "done"; id: string; costUsd: number; ms: number }
  | { type: "error"; message: string };

export type RoundRecord = {
  round: number;
  panelist: string;
  text: string;
  ms: number;
  costUsd: number;
  error: string | null;
};

/**
 * Run the whole debate, emitting as it goes.
 *
 * Panelists run concurrently within a round and the rounds are sequential,
 * which is not an implementation detail: round two cannot begin until every
 * answer exists to be critiqued. One panelist failing does not stop the debate
 * — it is recorded as a failure and the rest carry on, because a panel of two
 * is still a panel and losing the whole run to one expired key is not.
 */
export async function runChorus(
  question: string,
  config: ChorusConfig,
  emit: (event: ChorusEvent) => void,
  signal?: AbortSignal,
): Promise<{ id: string; costUsd: number }> {
  const started = Date.now();
  const panel = config.panelists;
  const id = `${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`;
  const rounds: RoundRecord[] = [];
  let costUsd = 0;

  if (!panel.length) {
    emit({ type: "error", message: "No panelists are configured, so there is nobody to ask." });
    throw new Error("Chorus has no panel.");
  }

  const totalRounds = config.skipCritique ? 2 : 3;
  emit({ type: "start", panel, rounds: totalRounds });

  const ask = async (
    panelist: Panelist,
    round: number,
    messages: ChatMessage[],
  ): Promise<RoundRecord> => {
    emit({ type: "begin", round, panelist: panelist.id });
    try {
      const result = await streamChat(
        panelist.provider,
        panelist.model,
        messages,
        (text) => emit({ type: "token", round, panelist: panelist.id, text }),
        { signal, maxTokens: config.maxTokens },
      );
      const cost = estimateCost(panelist.provider, result.inputTokens, result.outputTokens);
      costUsd += cost;
      const record: RoundRecord = {
        round,
        panelist: panelist.id,
        text: result.text,
        ms: result.ms,
        costUsd: cost,
        /*
         * A provider that returns 200 and no text has failed, and recording it
         * as a success is worse than an error: the panelist appears in the
         * transcript with an empty column, its answer is fed to the critique
         * round as if it said nothing on purpose, and it can be chosen as chair.
         */
        error: result.text.trim() ? null : "Answered with nothing at all.",
      };
      emit({ type: "answer", ...record });
      return record;
    } catch (error) {
      const record: RoundRecord = {
        round,
        panelist: panelist.id,
        text: "",
        ms: 0,
        costUsd: 0,
        error: error instanceof Error ? error.message : "Failed.",
      };
      emit({ type: "answer", ...record });
      return record;
    }
  };

  // ---- Round 1: independent answers ---------------------------------------
  emit({ type: "round", round: 1, name: "Independent answers" });
  const first = await Promise.all(
    panel.map((panelist) =>
      ask(panelist, 1, [
        { role: "system", content: ROUND_1 },
        { role: "user", content: question },
      ]),
    ),
  );
  rounds.push(...first);

  const answered = first.filter((record) => !record.error && record.text.trim());
  if (!answered.length) {
    emit({
      type: "error",
      message: "Every panelist failed. The errors above are the providers' own words.",
    });
    throw new Error("No panelist answered.");
  }

  /*
   * Blind labels. The critique round sees "Answer A" and never "Anthropic",
   * because a model told whose answer it is reviewing is answering a different
   * question than the one this round asks.
   */
  const letterOf = new Map<string, string>();
  answered.forEach((record, i) => letterOf.set(record.panelist, String.fromCharCode(65 + i)));
  const transcript = answered
    .map((record) => `Answer ${letterOf.get(record.panelist)}:\n${record.text}`)
    .join("\n\n---\n\n");

  // ---- Round 2: blind cross-critique --------------------------------------
  let critiques: RoundRecord[] = [];
  if (!config.skipCritique && answered.length > 1) {
    emit({ type: "round", round: 2, name: "Cross-critique" });
    critiques = await Promise.all(
      answered.map((record) => {
        const panelist = panel.find((p) => p.id === record.panelist)!;
        const others = answered
          .filter((other) => other.panelist !== record.panelist)
          .map((other) => `Answer ${letterOf.get(other.panelist)}:\n${other.text}`)
          .join("\n\n---\n\n");
        return ask(panelist, 2, [
          { role: "system", content: ROUND_2 },
          {
            role: "user",
            content: `Question:\n${question}\n\nYour own answer (${letterOf.get(record.panelist)}):\n${record.text}\n\nThe other answers:\n\n${others}`,
          },
        ]);
      }),
    );
    rounds.push(...critiques);
  }

  // ---- Round 3: synthesis --------------------------------------------------
  /*
   * The number reflects what actually happened, not what was configured.
   *
   * The critique round is also skipped when only one panelist answered — a
   * panel of three where two keys have expired. Reporting that run as "round 3
   * of 3" claims a round that never took place, which is the sort of small lie
   * that makes the rest of the transcript untrustworthy.
   */
  const ranCritique = critiques.some((record) => !record.error && record.text.trim());
  const synthesisRound = ranCritique ? 3 : 2;
  emit({ type: "round", round: synthesisRound, name: "Synthesis" });

  /*
   * The chair is chosen, not assumed.
   *
   * A named chair wins. Otherwise the first panelist that actually answered
   * takes it — not simply `panel[0]`, which on a run where the first provider's
   * key had expired would hand the synthesis to a model that failed, and the
   * whole debate with it.
   */
  const chair =
    panel.find((p) => p.id === config.chair && answered.some((a) => a.panelist === p.id)) ??
    panel.find((p) => p.id === answered[0].panelist)!;

  const critiqueText = critiques
    .filter((record) => !record.error && record.text.trim())
    .map((record) => `Critique from the author of ${letterOf.get(record.panelist)}:\n${record.text}`)
    .join("\n\n---\n\n");

  const synthesis = await ask(chair, synthesisRound, [
    { role: "system", content: ROUND_3 },
    {
      role: "user",
      content: `Question:\n${question}\n\nIndependent answers:\n\n${transcript}${
        critiqueText ? `\n\nCritiques:\n\n${critiqueText}` : ""
      }`,
    },
  ]);
  rounds.push(synthesis);
  emit({ type: "synthesis", text: synthesis.text, by: chair.id });

  const dissents = extractDissents(synthesis.text);
  chorusDb().run(
    `INSERT INTO debates (id, at, question, synthesis, dissents, panel, rounds, costUsd, ms)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id,
    Date.now(),
    question,
    synthesis.text || null,
    JSON.stringify(dissents),
    JSON.stringify(panel),
    JSON.stringify(rounds),
    costUsd,
    Date.now() - started,
  );

  emit({ type: "done", id, costUsd, ms: Date.now() - started });
  return { id, costUsd };
}

/**
 * Pull the dissent section out of the synthesis.
 *
 * The prompt asks for a labelled section and models mostly comply, so this
 * matches the heading rather than trying to judge disagreement itself. When
 * nothing matches it returns nothing — an empty list means "the synthesis did
 * not mark a split", which the UI says in those words rather than claiming the
 * panel agreed.
 */
export function extractDissents(synthesis: string): string[] {
  if (!synthesis.trim()) return [];
  const match = synthesis.match(
    /(?:^|\n)\s*(?:\d+[.)]\s*)?(?:\*\*|##+\s*)?WHERE THE PANEL SPLIT\b[:*\s]*\n?([\s\S]*)$/i,
  );
  if (!match) return [];
  const body = match[1].trim();
  if (!body) return [];
  if (/^(none|the panel (?:genuinely )?agreed|no (?:substantive )?disagreement)/i.test(body)) {
    return [];
  }
  const bullets = body
    .split(/\n(?=\s*(?:[-*•]|\d+[.)])\s)/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 12);
  return bullets.length ? bullets : [body.slice(0, 2_000)];
}

export type DebateRecord = {
  id: string;
  at: number;
  question: string;
  synthesis: string | null;
  dissents: string[];
  panel: Panelist[];
  rounds: RoundRecord[];
  costUsd: number;
  ms: number;
};

function hydrate(row: Record<string, unknown>): DebateRecord {
  const parse = <T,>(value: unknown, fallback: T): T => {
    if (typeof value !== "string") return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: String(row.id),
    at: Number(row.at),
    question: String(row.question),
    synthesis: (row.synthesis as string | null) ?? null,
    dissents: parse<string[]>(row.dissents, []),
    panel: parse<Panelist[]>(row.panel, []),
    rounds: parse<RoundRecord[]>(row.rounds, []),
    costUsd: Number(row.costUsd) || 0,
    ms: Number(row.ms) || 0,
  };
}

export function listDebates(limit = 30): DebateRecord[] {
  return chorusDb()
    .all("SELECT * FROM debates ORDER BY at DESC LIMIT ?", Math.min(200, Math.max(1, limit)))
    .map(hydrate);
}

export function readDebate(id: string): DebateRecord | null {
  const row = chorusDb().get("SELECT * FROM debates WHERE id = ?", id);
  return row ? hydrate(row) : null;
}

export function forgetDebate(id: string): boolean {
  return chorusDb().run("DELETE FROM debates WHERE id = ?", id).changes > 0;
}
