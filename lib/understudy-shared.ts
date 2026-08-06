/**
 * The parts of Understudy's configuration both builds need.
 *
 * `lib/understudy.ts` reaches for the filesystem, SQLite and Ollama at module
 * scope, so the browser build cannot import it — and the browser build still
 * has to agree with it about what counts as a writing sample. A constant
 * duplicated across two builds is a constant that drifts, and the symptom here
 * would be subtle: the same wiki producing two different voice profiles
 * depending on where it was measured.
 */

export type UnderstudySource = "wiki" | "sent-mail" | "messages" | "folders";

export type UnderstudyConfig = {
  sources: Record<UnderstudySource, boolean>;
  folders: string[];
  /** Samples shorter than this are noise ("ok", "thanks"), counted in words. */
  minWords: number;
  redact: boolean;
};

export const DEFAULT_UNDERSTUDY: UnderstudyConfig = {
  sources: { wiki: false, "sent-mail": false, messages: false, folders: false },
  folders: [],
  minWords: 25,
  redact: true,
};

export const UNDERSTUDY_LABEL: Record<UnderstudySource, string> = {
  wiki: "Your wiki",
  "sent-mail": "Mail you sent",
  messages: "Messages you sent",
  folders: "Folders you choose",
};
