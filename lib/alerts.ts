import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { vaultKey } from "@/lib/journal";

/**
 * Things that should be noticed the day they happen.
 *
 * The journal records every write equally, which is correct for a changelog and
 * useless as a warning: a write into `notes/` and a write into `raw/finance/`
 * are one line each, in a list of three hundred. An alert is the small set the
 * user asked to be told about — a protected path touched, canon contradicted, a
 * page rewritten that a human had verified.
 *
 * Deliberately small and deliberately hard to add to. An alert stream people
 * scroll past is worse than no alert stream, because it converts a real signal
 * into one they have already learned to dismiss.
 */

const DIR = path.join(os.homedir(), ".lore");
const filePath = (key: string) => path.join(DIR, `alerts-${key}.jsonl`);

export type AlertKind = "protected-write" | "canon-contradicted" | "verified-rewritten";

export type Alert = {
  at: number;
  kind: AlertKind;
  relPath: string;
  agent: string | null;
  message: string;
  /** Set once the user has seen it; unread alerts are what the badge counts. */
  readAt?: number;
};

/** Keep the file bounded; alerts are meant to be rare. */
const MAX = 2_000;

export async function raise(root: string, alert: Omit<Alert, "readAt">): Promise<void> {
  try {
    await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
    await fs.appendFile(filePath(vaultKey(root)), JSON.stringify(alert) + "\n", "utf8");
  } catch {
    // An alert that cannot be written must not fail the write it describes.
  }
}

export async function readAlerts(root: string): Promise<Alert[]> {
  const raw = await fs.readFile(filePath(vaultKey(root)), "utf8").catch(() => "");
  const out: Alert[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Alert);
    } catch {
      // Torn final line; one record lost, not the file.
    }
  }
  return out.slice(-MAX).reverse();
}

/** Mark everything up to `at` as seen. */
export async function markRead(root: string, at = Date.now()): Promise<void> {
  const all = (await readAlerts(root)).reverse();
  const next = all.map((a) => (a.at <= at && !a.readAt ? { ...a, readAt: Date.now() } : a));
  await fs.mkdir(DIR, { recursive: true, mode: 0o700 });
  await fs
    .writeFile(filePath(vaultKey(root)), next.map((a) => JSON.stringify(a)).join("\n") + "\n", "utf8")
    .catch(() => {});
}

export const unreadCount = (alerts: Alert[]) => alerts.filter((a) => !a.readAt).length;
