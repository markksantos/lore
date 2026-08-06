import { fail } from "@/lib/server";
import { readObservers } from "@/lib/observers";
import { ghostDb, recall } from "@/lib/ghost";
import { ledgerDb, searchLedger, SOURCE_LABEL } from "@/lib/ledger";
import { searchOracle, oracleDb } from "@/lib/oracle";
import { ORACLE_LABEL, type OracleSource } from "@/lib/oracle-sources";
import { askGate, busyResponse, GateBusyError } from "@/lib/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the observers will tell an agent.
 *
 * Everything else the observers expose is for a person looking at a screen.
 * This is for the MCP server, and it is a different question with a different
 * answer, so it gets its own route rather than a flag on the existing ones.
 *
 * The distinction that matters: switching Ghost on means a model ON THIS
 * MACHINE describes your screen. Answering an MCP call means the contents of
 * your screen, mail and messages are handed to whatever agent is connected —
 * which is frequently a frontier model on hardware you do not own. Those are
 * not the same consent and are not stored in the same field.
 *
 * So this route refuses by default, in words the agent can relay, and the
 * output is plain text rather than JSON because every other Lore MCP tool
 * returns prose the model reads directly.
 */

/** Prose, not JSON: the caller is a language model, not a parser. */
function text(body: string): Response {
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

const REFUSAL = `Lore is not sharing what it observes with agents.

This is a separate switch from turning an observer on, because it is a bigger
decision: enabling Ghost means a model on this machine reads the screen, while
enabling this means what it saw can be sent to you.

The person using this computer can turn it on in Lore under Settings → What is
watching. Tell them that rather than trying again.`;

const NOTHING_INDEXED = (what: string, where: string) =>
  `Nothing to search: ${what} has not indexed anything yet.

Ask the person using this computer to open Lore, go to ${where}, switch it on and
press the index button. Until then this tool has nothing to answer from.`;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { tool?: string; query?: string; limit?: number };
    const config = await readObservers();
    if (!config.shareWithAgents) return text(REFUSAL);

    const query = (body.query ?? "").trim();
    const limit = Math.min(25, Math.max(1, Number(body.limit) || 8));

    switch (body.tool) {
      // -------------------------------------------------------------- Ghost
      case "recall": {
        if (!query) return fail(new Error("`query` is required."));
        if (!countRows(() => ghostDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM frames")?.n)) {
          return text(
            config.observers.ghost.enabledAt
              ? "Ghost has captured nothing — it may have been switched on only just now, or paused since."
              : "Ghost has never been switched on, so there are no screen observations to recall.",
          );
        }
        /* Behind the same gate as every other local-model call: one model, and
           two questions at once means both take twice as long. */
        const result = await askGate.run(() => recall(query));
        if (!result.frames.length) {
          return text(
            `Ghost captured nothing matching that${result.window ? " in that period" : ""}. It only knows about times when it was switched on and not paused.`,
          );
        }
        const lines = result.frames.map((frame, i) => {
          const when = new Date(frame.at).toLocaleString(undefined, {
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
          });
          const where = [frame.app, frame.title].filter(Boolean).join(" — ") || "unknown app";
          return `[${i + 1}] ${when} · ${where}\n${(frame.summary ?? "(not read by the model)").slice(0, 400)}`;
        });
        return text(
          [
            result.answer ? `${result.answer}\n` : "",
            `What was on screen (${result.frames.length} moment${result.frames.length === 1 ? "" : "s"}):\n`,
            lines.join("\n\n"),
            result.pending
              ? `\n\n(${result.pending} of these have not been read by the vision model yet.)`
              : "",
          ].join(""),
        );
      }

      // ------------------------------------------------------------- Ledger
      case "conversations": {
        if (!query) return fail(new Error("`query` is required."));
        const found = searchLedger(query, { limit });
        if (!found.hits.length) {
          if (!countRows(() => ledgerDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")?.n)) {
            return text(NOTHING_INDEXED("Ledger", "Ledger"));
          }
          return text(
            `No past AI conversation on this machine contains that. Ledger searches the words that were actually typed, so a phrase the person remembers writing works better than a description of it.`,
          );
        }
        const byId = new Map(found.sessions.map((session) => [session.id, session]));
        const lines = found.hits.map((hit, i) => {
          const session = byId.get(hit.sessionId);
          const when = hit.at ? new Date(hit.at).toLocaleDateString() : "unknown date";
          /* The guillemets are FTS5's own match markers; an agent does not need
             them and they read as noise inside a quotation. */
          const snippet = hit.snippet.replace(/[«»]/g, "");
          return `[${i + 1}] ${SOURCE_LABEL[hit.source] ?? hit.source} · ${session?.title ?? "untitled"} · ${when}\n${snippet}`;
        });
        return text(
          `${found.total} match${found.total === 1 ? "" : "es"} across past AI conversations on this machine.\n\n${lines.join("\n\n")}`,
        );
      }

      // ------------------------------------------------------------- Oracle
      case "find": {
        if (!query) return fail(new Error("`query` is required."));
        const found = searchOracle(query, { limit });
        if (!found.hits.length) {
          if (!countRows(() => oracleDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM items")?.n)) {
            return text(NOTHING_INDEXED("Oracle", "Oracle"));
          }
          return text("Nothing in the indexed files, mail, messages, calendar or notes matches that.");
        }
        const db = oracleDb();
        const lines = found.hits.map((hit, i) => {
          const row = db.get<{ body: string }>("SELECT body FROM items WHERE id = ?", hit.id);
          const when = hit.at ? new Date(hit.at).toLocaleString() : "no date";
          const head = [ORACLE_LABEL[hit.source as OracleSource] ?? hit.source, hit.title, hit.who, when]
            .filter(Boolean)
            .join(" · ");
          /* Trimmed hard. The caller is assembling a context window and a single
             forty-thousand-character email would consume all of it. */
          return `[${i + 1}] ${head}\n${(row?.body ?? hit.snippet).replace(/[«»]/g, "").slice(0, 1_200)}`;
        });
        return text(
          `${found.total} match${found.total === 1 ? "" : "es"} in this person's own files, mail, messages, calendar and notes.\n\n${lines.join("\n\n")}`,
        );
      }

      default:
        return fail(new Error(`Unknown tool ${body.tool ?? "(none)"}.`));
    }
  } catch (error) {
    if (error instanceof GateBusyError) return busyResponse(error);
    return fail(error);
  }
}

/**
 * How many rows a feature has, or zero if it has no database yet.
 *
 * "Has this been switched on" and "can this answer a question" are different
 * questions, and the second is the one that matters here. A first version keyed
 * on the consent timestamp and reported Ledger unavailable while it was
 * cheerfully answering with two thousand indexed conversations, because the
 * index had been built by a script rather than through the switch.
 */
function countRows(read: () => number | undefined): number {
  try {
    return read() ?? 0;
  } catch {
    /* No database file yet, which is the same as no rows. */
    return 0;
  }
}

/** Which of these an agent can currently use, so the MCP server can say so. */
export async function GET() {
  try {
    const config = await readObservers();
    const has = {
      recall: countRows(() => ghostDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM frames")?.n),
      conversations: countRows(
        () => ledgerDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions")?.n,
      ),
      find: countRows(() => oracleDb().get<{ n: number }>("SELECT COUNT(*) AS n FROM items")?.n),
    };
    return Response.json({
      sharing: config.shareWithAgents,
      indexed: has,
      available: {
        recall: config.shareWithAgents && has.recall > 0,
        conversations: config.shareWithAgents && has.conversations > 0,
        find: config.shareWithAgents && has.find > 0,
      },
    });
  } catch (error) {
    return fail(error);
  }
}
