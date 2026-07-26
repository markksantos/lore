import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Lore is local-first: there is no account, no database, no cloud. The only
// state that lives outside the user's own wiki folder is this tiny JSON file,
// which remembers which folder(s) they linked. Deleting it un-links the vault
// and changes nothing inside the wiki itself.
const CONFIG_DIR = path.join(os.homedir(), ".lore");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export type Vault = {
  /** Absolute path to the wiki folder on disk. */
  root: string;
  /** Display name; defaults to the folder's basename. */
  name: string;
  /** Epoch ms of when this vault was linked. */
  linkedAt: number;
};

export type LoreConfig = {
  vaults: Vault[];
  /** `root` of the vault currently open in the app. */
  activeVault: string | null;
};

const EMPTY: LoreConfig = { vaults: [], activeVault: null };

export async function readConfig(): Promise<LoreConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<LoreConfig>;
    const vaults = Array.isArray(parsed.vaults) ? parsed.vaults : [];
    // The active vault must still be one we know about; a hand-edited config
    // or a removed vault should degrade to "nothing open", not to a broken app.
    const active =
      parsed.activeVault && vaults.some((v) => v.root === parsed.activeVault)
        ? parsed.activeVault
        : (vaults[0]?.root ?? null);
    return { vaults, activeVault: active };
  } catch {
    return EMPTY;
  }
}

export async function writeConfig(config: LoreConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/** Expand `~`, resolve to absolute, and strip a trailing slash. */
export function expandPath(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const expanded = trimmed.startsWith("~")
    ? path.join(os.homedir(), trimmed.slice(1))
    : trimmed;
  return path.resolve(expanded);
}

export async function linkVault(rawPath: string): Promise<Vault> {
  const root = expandPath(rawPath);
  if (!root) throw new Error("Enter a folder path.");

  const stat = await fs.stat(root).catch(() => null);
  if (!stat) throw new Error(`Nothing exists at ${root}`);
  if (!stat.isDirectory()) throw new Error(`${root} is a file, not a folder.`);

  const config = await readConfig();
  const existing = config.vaults.find((v) => v.root === root);
  const vault: Vault =
    existing ?? { root, name: path.basename(root), linkedAt: Date.now() };

  await writeConfig({
    vaults: existing ? config.vaults : [...config.vaults, vault],
    activeVault: root,
  });
  return vault;
}

export async function unlinkVault(root: string): Promise<void> {
  const config = await readConfig();
  const vaults = config.vaults.filter((v) => v.root !== root);
  await writeConfig({
    vaults,
    activeVault: config.activeVault === root ? (vaults[0]?.root ?? null) : config.activeVault,
  });
}

export async function setActiveVault(root: string): Promise<void> {
  const config = await readConfig();
  if (!config.vaults.some((v) => v.root === root)) throw new Error("Vault is not linked.");
  await writeConfig({ ...config, activeVault: root });
}

export async function getActiveVault(): Promise<Vault | null> {
  const config = await readConfig();
  return config.vaults.find((v) => v.root === config.activeVault) ?? null;
}

/**
 * Folders worth offering on first run. We only probe the handful of places a
 * markdown wiki actually tends to live, and only report ones that exist and
 * already contain markdown — a suggestion the user has to verify is worse than
 * no suggestion at all.
 */
export async function suggestVaults(): Promise<{ root: string; files: number }[]> {
  const home = os.homedir();
  const candidates = [
    path.join(home, "Documents", "wiki"),
    path.join(home, "Documents", "Obsidian"),
    path.join(home, "Documents", "Notes"),
    path.join(home, "wiki"),
    path.join(home, "notes"),
    path.join(home, "Obsidian"),
    path.join(home, "Library", "Mobile Documents", "iCloud~md~obsidian", "Documents"),
  ];

  const found: { root: string; files: number }[] = [];
  for (const root of candidates) {
    const count = await countMarkdownShallow(root);
    if (count > 0) found.push({ root, files: count });
  }
  return found;
}

/** Counts markdown files up to two levels deep — enough to prove "this is a wiki". */
async function countMarkdownShallow(root: string, depth = 2): Promise<number> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => null);
  if (!entries) return 0;
  let count = 0;
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isFile() && /\.mdx?$/i.test(entry.name)) count += 1;
    else if (entry.isDirectory() && depth > 0) {
      count += await countMarkdownShallow(path.join(root, entry.name), depth - 1);
    }
  }
  return count;
}
