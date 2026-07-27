/**
 * Plans.
 *
 * The product is open source and free to self-host, and that is the real thing —
 * not a crippled demo with the good parts removed. Every feature Lore has works
 * in the free build, because the free build is the whole application.
 *
 * What the hosted plans sell is the one category a local-first app genuinely
 * cannot do for you: state that has to exist somewhere other than the machine in
 * front of you. Sync between two laptops, a backup that survives the laptop,
 * auth, and an MCP endpoint an agent can reach when your machine is asleep.
 *
 * This split matters for honesty as much as for pricing. If the paid tier
 * withheld the graph or the editor, the privacy argument would collapse — you
 * would be paying to be allowed to use software that already runs on your own
 * hardware. It withholds nothing. It adds a server, for the people who want one.
 */

export type Cycle = "monthly" | "yearly" | "lifetime";

export const CYCLES: { id: Cycle; label: string; note?: string }[] = [
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly", note: "Save 31%" },
  { id: "lifetime", label: "Lifetime" },
];

export type Price = { amount: string; unit: string; caption: string };

export type Plan = {
  id: string;
  name: string;
  /** The plan's own hue, used on its name, its button and its feature ticks. */
  tone: "neutral" | "accent" | "amber";
  blurb: string;
  price: Record<Cycle, Price>;
  cta: string;
  href: string;
  /** External destination — GitHub rather than a checkout. */
  external?: boolean;
  featured?: boolean;
  features: { label: string; included: boolean }[];
};

/** Shared by every plan, because the application itself is not the paywall. */
const APP_FEATURES = [
  "The whole app — editor, graph, map, timeline",
  "All four MCP tools, and the AGENTS.md index",
  "Verification ledger and the write journal",
  "Context budgets and local semantic search",
];

export const PLANS: Plan[] = [
  {
    id: "open",
    name: "Open",
    tone: "neutral",
    blurb: "Self-host the open source build. Not a trial — the entire application.",
    price: {
      monthly: { amount: "$0", unit: "", caption: "forever" },
      yearly: { amount: "$0", unit: "", caption: "forever" },
      lifetime: { amount: "$0", unit: "", caption: "forever" },
    },
    cta: "Download",
    href: "/download",
    features: [
      ...APP_FEATURES.map((label) => ({ label, included: true })),
      { label: "Runs entirely on your own machine", included: true },
      { label: "Cross-device sync and backups", included: false },
      { label: "Hosted MCP endpoint for remote agents", included: false },
      { label: "Managed auth and storage", included: false },
    ],
  },
  {
    id: "personal",
    name: "Personal",
    tone: "accent",
    blurb: "Your wiki on every machine you use, and reachable when none of them are on.",
    price: {
      monthly: { amount: "$12", unit: "/mo", caption: "billed monthly" },
      yearly: { amount: "$99", unit: "/yr", caption: "$8.25 a month, billed yearly" },
      lifetime: { amount: "$199", unit: "", caption: "one payment, no renewal" },
    },
    cta: "Get started",
    href: "/download",
    featured: true,
    features: [
      ...APP_FEATURES.map((label) => ({ label, included: true })),
      { label: "Cross-device sync, encrypted in transit and at rest", included: true },
      { label: "Versioned backups you can roll back", included: true },
      { label: "Hosted MCP endpoint — agents reach your wiki anywhere", included: true },
      { label: "Managed auth and storage", included: true },
    ],
  },
  {
    id: "team",
    name: "Team",
    tone: "amber",
    blurb: "Ten seats, then $12 each. One shared wiki your whole team's agents read from.",
    price: {
      monthly: { amount: "$129", unit: "/mo", caption: "10 seats, billed monthly" },
      yearly: { amount: "$999", unit: "/yr", caption: "10 seats, billed yearly" },
      lifetime: { amount: "$1,999", unit: "", caption: "10 seats, one payment" },
    },
    cta: "Get started",
    href: "/download",
    features: [
      { label: "Everything in Personal", included: true },
      { label: "A shared vault, with per-member permissions", included: true },
      { label: "See which pages each member's agents actually read", included: true },
      { label: "Verification across the team — who checked what, and when", included: true },
      { label: "Admin controls and audit log", included: true },
      { label: "Priority support", included: true },
    ],
  },
];

export const FAQ: { q: string; a: string }[] = [
  {
    q: "Is Lore free?",
    a: "Yes. Lore is open source and free to self-host, and the free build is the complete application — the editor, every MCP tool, the graph, semantic search, context budgets and the verification ledger. Nothing is held back. Hosted plans add cross-device sync, backups, and managed auth and storage, and start at $12 per month.",
  },
  {
    q: "What do the hosted plans actually add?",
    a: "The things a program running on one laptop cannot do by itself: keep two machines in step, hold a backup somewhere the laptop is not, and answer an agent that asks for a page while that laptop is asleep. If you only ever use one machine and your agents run on it, the free build already does everything.",
  },
  {
    q: "Does hosting mean my wiki leaves my machine?",
    a: "Only if you turn sync on, and only then. The local app has no upload path at all — that is not a policy, it is that no such code exists. Switching on a hosted plan is a deliberate choice to put an encrypted copy somewhere you can reach from elsewhere, and it is the one thing that changes.",
  },
  {
    q: "Can I switch between monthly, yearly and lifetime?",
    a: "Yes, from the billing portal, and a subscriber can pay the difference to own Lore for life. Only the account owner manages billing.",
  },
  {
    q: "What happens if I stop paying?",
    a: "You keep your wiki, because it was always yours — plain markdown files in a folder on your disk. You lose sync and the hosted endpoint, not your notes. The self-hosted build keeps working forever with no licence check, because there is nothing to check.",
  },
  {
    q: "Why pay for something open source?",
    a: "You are not paying for the software, which is free and always will be. You are paying for a server you do not have to run, keep patched, or back up. If you would rather run it yourself, that path is fully supported and always will be — it is the same code.",
  },
];
