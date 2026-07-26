/**
 * Frontmatter conformance.
 *
 * A vault following the llm-wiki pattern keeps a SCHEMA.md at its root saying
 * what frontmatter every page should carry. That file is prose written for a
 * human, not a machine-readable contract, so this reads it the only way that
 * survives contact with real wikis: loosely. It looks for the three shapes
 * people actually use — a markdown table, a bullet list, and a worked YAML
 * example — pulls a field name out of each, and infers the rest from the words
 * sitting next to it.
 *
 * The parser's contract is that it never throws and never guesses wildly: an
 * unparseable schema yields zero rules, and zero rules yields zero findings.
 * Reporting nothing is always better than reporting drift against a rule the
 * user never wrote.
 */

export type FieldRule = {
  name: string;
  required: boolean;
  kind: "string" | "list" | "date" | "any";
};

export type SchemaIssue = {
  pageId: string;
  relPath: string;
  title: string;
  missing: string[];
  wrongType: string[];
};

/**
 * A schema describing more than this many fields is almost certainly a false
 * positive — an unrelated table in the same file — and a grid that wide is
 * unreadable anyway. Stop rather than render nonsense.
 */
const MAX_RULES = 24;

/**
 * First-column values that name the table itself rather than a field. Without
 * this the header row of every markdown table becomes a rule called "field".
 */
const NON_FIELD_WORDS = new Set([
  "field",
  "fields",
  "name",
  "key",
  "property",
  "attribute",
  "column",
  "frontmatter",
  "type",
  "kind",
  "value",
  "values",
  "required",
  "optional",
  "description",
  "notes",
  "example",
  "examples",
  "meaning",
  "purpose",
  "default",
]);

const YES = new Set(["yes", "y", "true", "required", "✓", "✔", "x", "✅"]);
const NO = new Set(["no", "n", "false", "optional", "-", "–", "—", "", "∅"]);

export function parseSchemaRules(schemaMarkdown: string): FieldRule[] {
  try {
    // Candidates are bucketed by the heading they were found under. A real
    // SCHEMA.md almost always contains a second list that looks exactly like a
    // field list — a tag vocabulary — so anything declared under a heading that
    // actually says "frontmatter" outranks everything else in the file.
    const primary: FieldRule[] = [];
    const secondary: FieldRule[] = [];

    let heading = "";
    let fence: string | null = null;

    for (const line of schemaMarkdown.split(/\r?\n/)) {
      const fenceEdge = /^\s*(?:```|~~~)(.*)$/.exec(line);
      if (fenceEdge) {
        fence = fence === null ? fenceEdge[1].trim().toLowerCase() : null;
        continue;
      }

      if (fence !== null) {
        // Most fenced blocks are illustrations. A YAML one under a frontmatter
        // heading is the declaration itself — the commonest way the pattern is
        // written — so it's the one block kind that gets read.
        if (!isDeclarativeFence(fence, heading)) continue;
        const fromYaml = readYamlLine(line);
        if (fromYaml) (isSchemaHeading(heading) ? primary : secondary).push(fromYaml);
        continue;
      }

      const headingLine = /^\s*#{1,6}\s+(.*)$/.exec(line);
      if (headingLine) {
        heading = headingLine[1].toLowerCase();
        continue;
      }

      const underSchemaHeading = isSchemaHeading(heading);
      const rule = readTableRow(line) ?? readBullet(line, underSchemaHeading);
      if (rule) (underSchemaHeading ? primary : secondary).push(rule);
    }

    const rules = new Map<string, FieldRule>();
    for (const rule of primary.length > 0 ? primary : secondary) {
      if (rules.has(rule.name)) continue;
      rules.set(rule.name, rule);
      if (rules.size >= MAX_RULES) break;
    }
    return [...rules.values()];
  } catch {
    return [];
  }
}

export function checkPages(
  pages: {
    id: string;
    relPath: string;
    title: string;
    frontmatter: Record<string, unknown>;
  }[],
  rules: FieldRule[],
): SchemaIssue[] {
  if (rules.length === 0) return [];

  const issues: SchemaIssue[] = [];

  for (const page of pages) {
    const missing: string[] = [];
    const wrongType: string[] = [];

    for (const rule of rules) {
      const value = page.frontmatter?.[rule.name];
      if (isBlank(value)) {
        if (rule.required) missing.push(rule.name);
        continue;
      }
      if (!matchesKind(value, rule.kind)) wrongType.push(rule.name);
    }

    if (missing.length > 0 || wrongType.length > 0) {
      issues.push({
        pageId: page.id,
        relPath: page.relPath,
        title: page.title,
        missing,
        wrongType,
      });
    }
  }

  return issues;
}

// --------------------------------------------------------------- line readers

function readTableRow(line: string): FieldRule | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;

  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

  if (cells.length < 2) return null;
  // `| --- | :--- |` — the alignment row.
  if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) return null;

  const name = cleanName(cells[0]);
  if (!name) return null;

  const rest = cells.slice(1);
  return { name, required: inferRequired(rest), kind: inferKind(rest.join(" ")) };
}

function readBullet(line: string, underSchemaHeading: boolean): FieldRule | null {
  const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
  if (!bullet) return null;

  const content = bullet[1].trim();

  // A field named in code or bold stands on its own; a bare word only counts
  // when a colon marks it as a key. Prose bullets ("Keep pages compact") have
  // neither, which is what keeps them out of the rule set.
  const marked = /^(?:`([^`]+)`|\*\*([^*]+)\*\*)\s*[:—–-]?\s*(.*)$/.exec(content);
  const bare = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(content);

  const rawName = marked ? (marked[1] ?? marked[2]) : bare?.[1];
  const descriptor = (marked ? marked[3] : (bare?.[2] ?? "")).trim();
  if (!rawName) return null;

  // `- \`hermes\`` with nothing after it is a vocabulary entry, not a field
  // declaration. Only a heading that says otherwise makes it one.
  if (descriptor === "" && !underSchemaHeading) return null;

  const name = cleanName(rawName, marked !== null);
  if (!name) return null;

  return { name, required: inferRequired([descriptor]), kind: inferKind(descriptor) };
}

/** A top-level `key: value` line inside a worked frontmatter example. */
function readYamlLine(line: string): FieldRule | null {
  // Zero indentation only: an indented line is a nested value, not a field.
  const pair = /^([A-Za-z_][\w.-]*)\s*:\s*(.*)$/.exec(line);
  if (!pair) return null;

  const name = cleanName(pair[1], true);
  if (!name) return null;

  return { name, required: inferRequired([pair[2]]), kind: inferKindFromSample(pair[2]) };
}

function isSchemaHeading(heading: string): boolean {
  return /front ?matter|schema|fields?|metadata|properties|required/.test(heading);
}

function isDeclarativeFence(info: string, heading: string): boolean {
  if (/^(ya?ml|frontmatter|toml)$/.test(info)) return true;
  return info === "" && isSchemaHeading(heading);
}

// ------------------------------------------------------------------ inference

/**
 * `allowCommonWords` is the difference between a column header and a field.
 * "type" heading a table column is not a field; `type:` in a YAML example is.
 * Only the forms where that ambiguity exists screen against the word list.
 */
function cleanName(raw: string, allowCommonWords = false): string | null {
  const name = raw
    .replace(/[`*_]/g, "")
    .replace(/^["']|["']$/g, "")
    .replace(/:$/, "")
    .trim();

  if (!/^[A-Za-z_][\w.-]{0,39}$/.test(name)) return null;
  if (!allowCommonWords && NON_FIELD_WORDS.has(name.toLowerCase())) return null;
  return name;
}

/**
 * Default is required.
 *
 * A SCHEMA.md that bothers to name a field is stating that pages ought to carry
 * it; treating unmarked fields as optional would make the grid empty on exactly
 * the loosely-written schemas that need it most. An explicit "optional" always
 * wins over an implicit "required".
 */
function inferRequired(cells: string[]): boolean {
  const text = cells.join(" ").toLowerCase();
  if (/\boptional\b|\bif present\b|\bnice to have\b/.test(text)) return false;
  if (/\brequired\b|\bmandatory\b|\bmust\b|\balways\b/.test(text)) return true;

  // A dedicated Required column holds a bare yes/no rather than a sentence.
  for (const cell of cells) {
    const token = cell.trim().toLowerCase();
    if (YES.has(token)) return true;
    if (token && NO.has(token)) return false;
  }
  return true;
}

/**
 * Kind from an example value rather than a description. `updated: YYYY-MM-DD`
 * and `tags: [from taxonomy]` describe their own type by shape, so a scalar
 * example means a string rather than the "any" that prose falls back to.
 */
function inferKindFromSample(sample: string): FieldRule["kind"] {
  const value = sample.trim();
  if (value === "") return "any";
  if (value.startsWith("[")) return "list";
  if (/yyyy-mm-dd|^\d{4}-\d{2}-\d{2}/i.test(value)) return "date";
  const described = inferKind(value);
  return described === "any" ? "string" : described;
}

function inferKind(text: string): FieldRule["kind"] {
  const lower = text.toLowerCase();
  if (/\b(list|array|multiple|comma[- ]separated)\b|\[\]/.test(lower)) return "list";
  if (/\b(date|datetime|timestamp|iso ?8601|yyyy-mm-dd)\b/.test(lower)) return "date";
  if (/\b(string|text|str|slug|line|sentence)\b/.test(lower)) return "string";
  return "any";
}

// ------------------------------------------------------------------ value test

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function matchesKind(value: unknown, kind: FieldRule["kind"]): boolean {
  switch (kind) {
    case "any":
      return true;
    case "list":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "date":
      // YAML parses an unquoted date into a Date, which becomes a full ISO
      // string once the index crosses the wire as JSON — so both shapes are
      // the same authored value and both have to pass.
      if (value instanceof Date) return !Number.isNaN(value.getTime());
      return (
        typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(value.trim()) &&
        !Number.isNaN(Date.parse(value.trim()))
      );
  }
}
