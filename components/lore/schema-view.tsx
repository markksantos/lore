"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, Loader2, Minus, X } from "lucide-react";
import type { VaultIndex } from "@/lib/types";
import { paletteVars } from "@/lib/palette";
import {
  checkPages,
  parseSchemaRules,
  type FieldRule,
  type SchemaIssue,
} from "@/lib/schema-check";
import { cn, formatCount } from "@/lib/utils";

const SCHEMA_FILE = /^schema\.mdx?$/i;

/** Local disks are fast but the API is one request per page; six at a time
 *  keeps a thousand-page vault from opening a thousand sockets at once. */
const CONCURRENCY = 6;

type Status =
  | { kind: "loading"; done: number; total: number }
  | { kind: "no-schema" }
  | { kind: "unparsed"; schemaPath: string }
  | {
      kind: "ready";
      schemaPath: string;
      rules: FieldRule[];
      issues: SchemaIssue[];
      checked: number;
    };

type LoadedPage = {
  id: string;
  relPath: string;
  title: string;
  frontmatter: Record<string, unknown>;
};

/**
 * Schema — where the vault has drifted from its own contract.
 *
 * The output of this screen is not a fixed file, it's a prompt. Lore doesn't
 * rewrite frontmatter itself: a bulk metadata edit is exactly the confident,
 * plausible change you'd never review line by line. So the grid ends at a
 * clipboard button, and Claude Code does the writing where you can see it.
 */
export function SchemaView({ index }: { index: VaultIndex }) {
  const [status, setStatus] = useState<Status>({ kind: "loading", done: 0, total: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSelected(new Set());
    setStatus({ kind: "loading", done: 0, total: 0 });

    async function run() {
      /*
       * The index already knows every page, so "is there a SCHEMA.md" is a
       * question we can answer without asking the server.
       *
       * It used to guess the literal filename and let the request 404. That
       * worked, and it printed a red console error on every vault that does not
       * have one — which is most of them. Expected states must not look like
       * faults in the console, or the console stops being worth reading.
       */
      const schemaPage = index.pages.find((page) => SCHEMA_FILE.test(page.relPath));
      if (!schemaPage) {
        setStatus({ kind: "no-schema" });
        return;
      }

      const schemaPath = schemaPage.relPath;
      const response = await fetch(`/api/page?path=${encodeURIComponent(schemaPath)}`).catch(
        () => null,
      );
      if (cancelled) return;
      if (!response || !response.ok) {
        setStatus({ kind: "no-schema" });
        return;
      }

      const { raw } = (await response.json()) as { raw?: string };
      if (cancelled) return;

      const rules = parseSchemaRules(raw ?? "");
      if (rules.length === 0) {
        setStatus({ kind: "unparsed", schemaPath });
        return;
      }

      const targets = index.pages.filter((page) => page.relPath !== schemaPath);
      setStatus({ kind: "loading", done: 0, total: targets.length });

      // Frontmatter is stripped from the vault index before it crosses the
      // wire, so conformance has to be read page by page.
      let done = 0;
      const loaded = await mapPool(targets, CONCURRENCY, async (page) => {
        const pageResponse = await fetch(
          `/api/page?path=${encodeURIComponent(page.relPath)}`,
        ).catch(() => null);
        done += 1;
        if (!cancelled && done % 8 === 0) {
          setStatus({ kind: "loading", done, total: targets.length });
        }
        if (!pageResponse || !pageResponse.ok) return null;
        const body = (await pageResponse.json()) as {
          frontmatter?: Record<string, unknown>;
        };
        return {
          id: page.id,
          relPath: page.relPath,
          title: page.title,
          frontmatter: body.frontmatter ?? {},
        } satisfies LoadedPage;
      });
      if (cancelled) return;

      // A page we couldn't read is left out rather than reported as broken —
      // a fetch failure says nothing about its frontmatter.
      const pages = loaded.filter((page): page is LoadedPage => page !== null);
      setStatus({
        kind: "ready",
        schemaPath,
        rules,
        issues: checkPages(pages, rules),
        checked: pages.length,
      });
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [index]);

  const issues = status.kind === "ready" ? status.issues : [];
  const rules = status.kind === "ready" ? status.rules : [];

  const breakdown = useMemo(() => {
    return rules
      .map((rule) => ({
        rule,
        missing: issues.filter((issue) => issue.missing.includes(rule.name)).length,
        wrongType: issues.filter((issue) => issue.wrongType.includes(rule.name)).length,
      }))
      .filter((row) => row.missing + row.wrongType > 0)
      .sort((a, b) => b.missing + b.wrongType - (a.missing + a.wrongType));
  }, [rules, issues]);

  function toggle(pageId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) =>
      current.size === issues.length ? new Set() : new Set(issues.map((i) => i.pageId)),
    );
  }

  function copyFixPrompt() {
    if (status.kind !== "ready") return;
    const chosen = issues.filter((issue) => selected.has(issue.pageId));
    navigator.clipboard.writeText(
      buildFixPrompt({
        root: index.root,
        schemaPath: status.schemaPath,
        rules: status.rules,
        issues: chosen,
      }),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-9">
      <header className="mb-7">
        <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-[var(--lore-text-primary)]">
          Schema
        </h1>
        <p className="t-body mt-1.5 max-w-2xl text-[var(--lore-text-secondary)]">
          What your SCHEMA.md says every page should carry, and every page that has
          drifted away from it.
        </p>
      </header>

      {status.kind === "loading" ? (
        <div className="flex items-center gap-2.5 py-16 text-[var(--lore-text-tertiary)]">
          <Loader2 size={16} className="animate-spin" />
          <span className="t-body">
            {status.total > 0
              ? `Reading frontmatter — ${formatCount(status.done)} of ${formatCount(status.total)}`
              : "Looking for SCHEMA.md"}
          </span>
        </div>
      ) : status.kind === "no-schema" ? (
        <NoSchema />
      ) : status.kind === "unparsed" ? (
        <UnparsedSchema schemaPath={status.schemaPath} />
      ) : (
        <>
          <Headline
            checked={status.checked}
            drifting={issues.length}
            rules={status.rules.length}
          />

          {issues.length === 0 ? (
            <p className="t-body mt-8 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-4 text-[var(--lore-text-secondary)]">
              Every page matches{" "}
              <span style={{ fontFamily: "var(--font-mono), monospace" }}>
                {status.schemaPath}
              </span>
              . Nothing to fix.
            </p>
          ) : (
            <>
              <Breakdown rows={breakdown} total={status.checked} />

              <section className="mt-9">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
                      Drift
                    </h2>
                    <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
                      {selected.size > 0
                        ? `${formatCount(selected.size)} selected`
                        : "Select rows to build a fix prompt."}
                    </p>
                  </div>
                  {selected.size > 0 ? (
                    <button
                      type="button"
                      onClick={copyFixPrompt}
                      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-[var(--lore-accent)] px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-[var(--lore-accent-hover)]"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "Copied" : "Copy fix prompt"}
                    </button>
                  ) : null}
                </div>

                <Legend />

                <div className="lore-scrollbar mt-3 overflow-x-auto rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
                  <table className="w-full min-w-max border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--lore-border)]">
                        <th className="w-10 px-3 py-2.5">
                          <Box
                            id="schema-select-all"
                            checked={selected.size === issues.length}
                            indeterminate={selected.size > 0 && selected.size < issues.length}
                            onChange={toggleAll}
                            label="Select every drifting page"
                          />
                        </th>
                        <th className="min-w-[220px] px-1 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
                          Page
                        </th>
                        {status.rules.map((rule) => (
                          <th
                            key={rule.name}
                            title={`${rule.name} — ${rule.kind}${rule.required ? ", required" : ", optional"}`}
                            className="min-w-[86px] px-3 py-2.5 text-left text-[11px] font-medium text-[var(--lore-text-secondary)]"
                          >
                            <span className="block truncate">{rule.name}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {issues.map((issue) => (
                        <tr
                          key={issue.pageId}
                          className={cn(
                            "border-b border-[var(--lore-border)] transition-colors last:border-b-0",
                            selected.has(issue.pageId)
                              ? "bg-[var(--lore-accent-tint)]"
                              : "hover:bg-[var(--lore-surface-raised)]",
                          )}
                        >
                          <td className="px-3 py-2">
                            <Box
                              id={`schema-row-${issue.pageId}`}
                              checked={selected.has(issue.pageId)}
                              onChange={() => toggle(issue.pageId)}
                              label={`Select ${issue.title}`}
                            />
                          </td>
                          <td className="max-w-[320px] px-1 py-2">
                            <label
                              htmlFor={`schema-row-${issue.pageId}`}
                              className="block min-w-0 cursor-pointer"
                            >
                              <span className="block truncate text-[13.5px] text-[var(--lore-text-primary)]">
                                {issue.title}
                              </span>
                              <span
                                className="block truncate text-[11px] text-[var(--lore-text-tertiary)]"
                                style={{ fontFamily: "var(--font-mono), monospace" }}
                              >
                                {issue.relPath}
                              </span>
                            </label>
                          </td>
                          {status.rules.map((rule) => (
                            <td key={rule.name} className="px-3 py-2">
                              <Cell
                                state={
                                  issue.missing.includes(rule.name)
                                    ? "missing"
                                    : issue.wrongType.includes(rule.name)
                                      ? "wrong"
                                      : "present"
                                }
                                rule={rule}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- headline

function Headline({
  checked,
  drifting,
  rules,
}: {
  checked: number;
  drifting: number;
  rules: number;
}) {
  const percent = checked === 0 ? 100 : Math.round(((checked - drifting) / checked) * 100);
  // Colour tracks the number, not a fixed slot: green when the vault is clean,
  // amber mid-way, blue-red when most pages have drifted.
  const slot = percent >= 90 ? 3 : percent >= 60 ? 6 : 1;

  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <div style={paletteVars(slot)} className="plate min-w-0 px-4 py-3.5">
        <div className="text-[30px] font-bold leading-none tracking-[-0.04em] tabular-nums">
          {percent}%
        </div>
        <div className="plate-muted mt-2 text-[12px] font-semibold">Conforming</div>
      </div>
      <Stat slot={4} value={formatCount(checked)} label="Pages checked" />
      <Stat slot={2} value={formatCount(drifting)} label="Drifting" />
      <Stat slot={5} value={formatCount(rules)} label="Fields in schema" />
    </div>
  );
}

function Stat({ slot, value, label }: { slot: number; value: string; label: string }) {
  return (
    <div style={paletteVars(slot)} className="plate min-w-0 px-4 py-3.5">
      <div className="text-[30px] font-bold leading-none tracking-[-0.04em] tabular-nums">
        {value}
      </div>
      <div className="plate-muted mt-2 text-[12px] font-semibold">{label}</div>
    </div>
  );
}

function Breakdown({
  rows,
  total,
}: {
  rows: { rule: FieldRule; missing: number; wrongType: number }[];
  total: number;
}) {
  const worst = Math.max(1, ...rows.map((row) => row.missing + row.wrongType));

  return (
    <section className="mt-9">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        By field
      </h2>
      <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">
        Which field the vault forgets most often, out of {formatCount(total)} pages.
      </p>

      <div className="mt-3 divide-y divide-[var(--lore-border)] overflow-hidden rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)]">
        {rows.map((row, i) => (
          <div key={row.rule.name} style={paletteVars(i)} className="flex items-center gap-3 px-4 py-2.5">
            <span
              className="min-w-0 flex-1 truncate text-[13px] text-[var(--lore-text-primary)]"
              style={{ fontFamily: "var(--font-mono), monospace" }}
            >
              {row.rule.name}
            </span>
            <span className="pal-chip hidden shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium sm:inline">
              {row.rule.kind}
            </span>
            <span className="hidden h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-[var(--lore-surface-raised)] sm:block">
              <span
                className="block h-full rounded-full"
                style={{
                  background: "var(--plate)",
                  width: `${((row.missing + row.wrongType) / worst) * 100}%`,
                }}
              />
            </span>
            <span className="t-meta w-28 shrink-0 text-right tabular-nums text-[var(--lore-text-secondary)]">
              {row.missing > 0 ? `${formatCount(row.missing)} missing` : null}
              {row.missing > 0 && row.wrongType > 0 ? " · " : null}
              {row.wrongType > 0 ? `${formatCount(row.wrongType)} typed` : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ----------------------------------------------------------------- grid parts

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-4">
      <LegendItem state="present" text="Present" />
      <LegendItem state="missing" text="Missing" />
      <LegendItem state="wrong" text="Wrong type" />
    </div>
  );
}

function LegendItem({ state, text }: { state: CellState; text: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-[var(--lore-text-tertiary)]">
      <Cell state={state} />
      {text}
    </span>
  );
}

type CellState = "present" | "missing" | "wrong";

/**
 * Every row on this grid is already a problem row, so "present" is deliberately
 * the quietest mark — the eye should land on what's broken, not on the majority
 * of cells that are fine.
 */
function Cell({ state, rule }: { state: CellState; rule?: FieldRule }) {
  const title =
    state === "present"
      ? rule
        ? `${rule.name} is present`
        : "Present"
      : state === "missing"
        ? rule
          ? `${rule.name} is missing`
          : "Missing"
        : rule
          ? `${rule.name} is not a ${rule.kind}`
          : "Wrong type";

  if (state === "present") {
    return (
      <span
        title={title}
        className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--lore-surface-raised)]"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--lore-success)]" />
      </span>
    );
  }

  if (state === "missing") {
    return (
      <span
        title={title}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--lore-danger)]/35 bg-[var(--lore-surface-raised)] text-[var(--lore-danger)]"
      >
        <X size={12} strokeWidth={2.5} />
      </span>
    );
  }

  return (
    <span
      title={title}
      style={paletteVars(6)}
      className="pal-chip flex h-6 w-6 items-center justify-center rounded-md"
    >
      <AlertTriangle size={12} strokeWidth={2.4} />
    </span>
  );
}

function Box({
  id,
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <span className="flex items-center justify-center">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={cn(
          "flex h-4 w-4 cursor-pointer items-center justify-center rounded-[5px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--lore-accent)] peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-[var(--lore-surface)]",
          checked || indeterminate
            ? "border-[var(--lore-accent)] bg-[var(--lore-accent)] text-white"
            : "border-[var(--lore-border-strong)] bg-[var(--lore-surface)]",
        )}
      >
        {indeterminate ? (
          <Minus size={11} strokeWidth={3} />
        ) : checked ? (
          <Check size={11} strokeWidth={3} />
        ) : null}
      </label>
    </span>
  );
}

// --------------------------------------------------------------- empty states

function NoSchema() {
  return (
    <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-5">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        No SCHEMA.md in this vault
      </h2>
      <p className="t-body mt-1.5 max-w-2xl text-[var(--lore-text-secondary)]">
        A SCHEMA.md sits at the root of the wiki and says, in plain markdown, what
        frontmatter every page should carry — a title, a kind, tags, a review date.
        It&apos;s the contract you and your agents both read before writing a page.
      </p>
      <p className="t-body mt-3 max-w-2xl text-[var(--lore-text-secondary)]">
        Add one and this screen turns into a grid: every page that has drifted, which
        field it&apos;s missing, and a prompt you can hand to an agent to close the gap.
      </p>

      <pre
        className="lore-scrollbar mt-4 overflow-x-auto rounded-lg border border-[var(--lore-border)] bg-[var(--lore-background)] px-3 py-3 text-[12px] leading-[1.6] text-[var(--lore-text-primary)]"
        style={{ fontFamily: "var(--font-mono), monospace" }}
      >
        {[
          "# SCHEMA.md",
          "",
          "| Field   | Type   | Required |",
          "| ------- | ------ | -------- |",
          "| title   | string | yes      |",
          "| kind    | string | yes      |",
          "| tags    | list   | yes      |",
          "| updated | date   | yes      |",
          "| source  | string | optional |",
        ].join("\n")}
      </pre>

      <p className="t-meta mt-2.5 text-[var(--lore-text-tertiary)]">
        Bullets work too — <code>- `tags`: list, required</code>. Lore reads the file
        loosely and never rewrites it.
      </p>
    </section>
  );
}

function UnparsedSchema({ schemaPath }: { schemaPath: string }) {
  return (
    <section className="rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] px-5 py-5">
      <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
        No field rules found in{" "}
        <span style={{ fontFamily: "var(--font-mono), monospace" }}>{schemaPath}</span>
      </h2>
      <p className="t-body mt-1.5 max-w-2xl text-[var(--lore-text-secondary)]">
        The file is there, but nothing in it names a frontmatter field in a shape Lore
        can read. Rather than invent rules and flag your whole wiki against them, it
        reports nothing.
      </p>
      <p className="t-body mt-3 max-w-2xl text-[var(--lore-text-secondary)]">
        A markdown table whose first column is the field name works, and so does a
        bullet list where each field is in backticks or bold — for example{" "}
        <code>- `updated`: date, required</code>.
      </p>
    </section>
  );
}

// ----------------------------------------------------------------- primitives

async function mapPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor;
        cursor += 1;
        out[i] = await worker(items[i]);
      }
    }),
  );

  return out;
}

/**
 * The handoff to Claude Code. It names the vault, the schema, every file, and
 * every field — an agent should never have to re-derive what we already know,
 * because that's where it starts inventing.
 */
function buildFixPrompt({
  root,
  schemaPath,
  rules,
  issues,
}: {
  root: string;
  schemaPath: string;
  rules: FieldRule[];
  issues: SchemaIssue[];
}): string {
  const kinds = new Map(rules.map((rule) => [rule.name, rule.kind]));
  const used = new Set<string>();
  for (const issue of issues) {
    for (const name of [...issue.missing, ...issue.wrongType]) used.add(name);
  }

  const lines: string[] = [
    `Bring ${issues.length} page${issues.length === 1 ? "" : "s"} in my wiki back into conformance with its schema.`,
    "",
    `Vault root: ${root}`,
    `Schema: ${schemaPath}`,
    "",
    "Fields involved (from the schema):",
    ...rules
      .filter((rule) => used.has(rule.name))
      .map((rule) => `- ${rule.name} — ${rule.kind}, ${rule.required ? "required" : "optional"}`),
    "",
    "Files to fix (paths are relative to the vault root):",
    "",
  ];

  issues.forEach((issue, i) => {
    lines.push(`${i + 1}. ${issue.relPath}`);
    if (issue.missing.length > 0) {
      lines.push(
        `   add: ${issue.missing.map((name) => `${name} (${kinds.get(name) ?? "any"})`).join(", ")}`,
      );
    }
    if (issue.wrongType.length > 0) {
      lines.push(
        `   fix type: ${issue.wrongType
          .map((name) => `${name} (must be a ${kinds.get(name) ?? "value"})`)
          .join(", ")}`,
      );
    }
  });

  lines.push(
    "",
    "Rules:",
    "- Edit only the YAML frontmatter block at the top of each file. Leave the body byte-for-byte unchanged.",
    "- If a file has no frontmatter block, add one at the very top.",
    "- Keep existing keys and their order; append the new ones.",
    "- A list field must be a YAML list, a date field must be YYYY-MM-DD.",
    "- Derive every value from that page's own content. If you genuinely cannot, leave the field out and tell me which files you skipped — never write a placeholder.",
  );

  return lines.join("\n");
}
