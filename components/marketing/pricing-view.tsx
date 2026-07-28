"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, X, Star, ChevronDown } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { SceneryImage } from "@/components/marketing/scenery-image";
import { CYCLES, FAQ, PLANS, type Cycle, type Plan } from "@/lib/pricing";
import type { Scene } from "@/lib/scenery";
import { cn } from "@/lib/utils";

/**
 * Pricing.
 *
 * Opens on the same sky the landing page does, cut to a shallow band. The page
 * is otherwise a table of numbers, and arriving at one straight from a hero
 * makes the site feel like two different products — the band carries the brand
 * across the seam without asking anyone to scroll past a second full-height
 * photograph to reach the prices.
 *
 * Each plan owns a hue, used on its name, its button and its ticks. That is
 * doing work rather than decoration: it makes the three columns separable at a
 * glance on a page where every column has the same shape.
 */

const TONES = {
  neutral: {
    name: "text-[var(--lore-text-tertiary)]",
    tick: "text-[var(--lore-success)]",
    button:
      "border border-[var(--lore-border-strong)] text-[var(--lore-text-primary)] hover:bg-[var(--lore-surface-raised)]",
  },
  accent: {
    name: "text-[var(--lore-accent)]",
    tick: "text-[var(--lore-success)]",
    button: "bg-[var(--lore-accent)] text-white hover:bg-[var(--lore-accent-hover)]",
  },
  amber: {
    name: "text-[#F59E0B] dark:text-[#F5A623]",
    tick: "text-[#F59E0B] dark:text-[#F5A623]",
    button: "bg-[#F59E0B] text-[#1F1300] hover:bg-[#E08E09]",
  },
} as const;

export function PricingView({ scene }: { scene: Scene }) {
  const [cycle, setCycle] = useState<Cycle>("monthly");

  return (
    <>
      <MarketingHeader overHero />

      {/* The band. Short enough that the first plan is on screen without
          scrolling on a laptop, which a full hero would push below the fold. */}
      <div className="relative h-[34svh] min-h-[220px] w-full overflow-hidden bg-[var(--lore-background)]">
        <SceneryImage
          src={scene.light}
          fileName={`hero-${scene.id}.png`}
          label={scene.label}
          priority
          className="dark:hidden"
        />
        <SceneryImage
          src={scene.dark}
          fileName={`hero-${scene.id}-dark.png`}
          label={`${scene.label} (dark)`}
          className="hidden dark:block"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(15,31,60,0.16)_0%,rgba(15,31,60,0.08)_28%,rgba(15,31,60,0.05)_56%,rgba(255,255,255,0)_76%)] dark:bg-[linear-gradient(180deg,rgba(0,0,0,0.32)_0%,rgba(0,0,0,0.18)_28%,rgba(0,0,0,0.08)_56%,rgba(0,0,0,0)_76%)]" />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3"
          style={{ backgroundImage: "var(--scenery-fade-down)" }}
        />
      </div>

      <main className="mx-auto max-w-6xl px-6 pb-24 md:px-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="t-section text-[var(--lore-text-primary)]">Pricing</h1>
            <p className="t-lede mt-3 max-w-xl text-[var(--lore-text-secondary)]">
              Run Lore yourself for free, or skip the setup and let us host it.
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Billing cycle"
            className="inline-flex shrink-0 items-center gap-1 self-start rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-1 md:self-auto"
          >
            {CYCLES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={cycle === option.id}
                onClick={() => setCycle(option.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13.5px] font-medium transition-colors",
                  cycle === option.id
                    ? "bg-[var(--lore-accent)] text-white"
                    : "text-[var(--lore-text-secondary)] hover:text-[var(--lore-text-primary)]",
                )}
              >
                {option.label}
                {option.note ? (
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-px text-[10.5px] font-semibold",
                      cycle === option.id
                        ? "bg-white/20 text-inherit"
                        : "bg-[var(--lore-success)]/12 text-[var(--lore-success)]",
                    )}
                  >
                    {option.note}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <hr className="mt-8 border-[var(--lore-border)]" />

        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <PlanCard key={plan.id} plan={plan} cycle={cycle} />
          ))}
        </div>

        <p className="t-meta mt-8 text-center text-[var(--lore-text-tertiary)]">
          The hosted service is not open yet — these are the prices it will launch at, not a
          checkout you can reach today. The self-hosted build is shipping now, has no licence
          check, no expiry and no account, and keeps working whatever happens here.
        </p>

        <hr className="mt-16 border-[var(--lore-border)]" />

        <section className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-[26px] font-semibold tracking-[-0.03em] text-[var(--lore-text-primary)]">
            Common questions
          </h2>
          <div className="mt-6 divide-y divide-[var(--lore-border)] border-t border-[var(--lore-border)]">
            {FAQ.map((item) => (
              <Question key={item.q} question={item.q} answer={item.a} />
            ))}
          </div>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}

function PlanCard({ plan, cycle }: { plan: Plan; cycle: Cycle }) {
  const price = plan.price[cycle];
  const tone = TONES[plan.tone];

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-[var(--lore-surface)] p-6",
        plan.featured ? "border-[var(--lore-accent)]/40" : "border-[var(--lore-border)]",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          className={cn(
            "text-[34px] font-semibold leading-none tracking-[-0.03em]",
            tone.name,
          )}
        >
          {plan.name}
        </h2>
        {/* The price is announced; the checkout is not open. Said on the card,
            where the decision is made, rather than in a footnote below it. */}
        {!plan.available ? (
          <span className="rounded-full border border-[var(--lore-border)] px-2.5 py-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--lore-text-tertiary)]">
            Not open yet
          </span>
        ) : null}
      </div>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-[32px] font-semibold leading-none tracking-[-0.04em] text-[var(--lore-text-primary)]">
          {price.amount}
        </span>
        <span className="t-meta text-[var(--lore-text-tertiary)]">
          {price.unit || price.caption}
        </span>
      </div>
      {price.unit ? (
        <p className="t-meta mt-2 text-[var(--lore-text-tertiary)]">{price.caption}</p>
      ) : null}

      <p className="t-body mt-3 text-[var(--lore-text-secondary)]">{plan.blurb}</p>

      <hr className="mt-6 border-[var(--lore-border)]" />

      {/* Split, not just crossed. Reviewers repeatedly read the free tier as
          including sync and hosted storage, because a small red cross does not
          survive a skim — and survives a screen reader even less well. */}
      <ul className="mt-6 space-y-3">
        {plan.features
          .filter((f) => f.included)
          .map((feature) => (
          <li key={feature.label} className="flex items-start gap-2.5">
            {/* A star means "this is more than the tier below gives you". A
                carried-forward line like "Everything in Personal" is not that,
                so it keeps the tick — starring it would claim an upgrade that
                the row itself says is a repeat. */}
            {!feature.included ? (
              <X size={14} className="mt-[3px] shrink-0 text-[var(--lore-danger)]" />
            ) : feature.upgrade ? (
              <Star size={14} className={cn("mt-[3px] shrink-0 fill-current", tone.tick)} />
            ) : (
              <Check size={14} className="mt-[3px] shrink-0 text-[var(--lore-success)]" />
            )}
            <span className="text-[13.5px] leading-[1.6] text-[var(--lore-text-secondary)]">
              {feature.label}
            </span>
          </li>
          ))}
      </ul>

      {plan.features.some((f) => !f.included) ? (
        <div className="mt-5 flex-1 border-t border-[var(--lore-border)] pt-4">
          <p className="t-meta mb-2.5 font-semibold uppercase tracking-[0.08em] text-[var(--lore-text-tertiary)]">
            Not included
          </p>
          <ul className="space-y-2.5">
            {plan.features
              .filter((f) => !f.included)
              .map((feature) => (
                <li key={feature.label} className="flex items-start gap-2.5">
                  <X size={14} className="mt-[3px] shrink-0 text-[var(--lore-text-tertiary)]" />
                  <span className="text-[13.5px] leading-[1.6] text-[var(--lore-text-tertiary)]">
                    {feature.label}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {plan.external ? (
        <a
          href={plan.href}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "mt-7 inline-flex h-11 items-center justify-center rounded-xl px-4 text-[14px] font-semibold transition-colors",
            tone.button,
          )}
        >
          {plan.cta}
        </a>
      ) : (
        <Link
          href={plan.href}
          className={cn(
            "mt-7 inline-flex h-11 items-center justify-center rounded-xl px-4 text-[14px] font-semibold transition-colors",
            tone.button,
          )}
        >
          {plan.cta}
        </Link>
      )}

      {!plan.available ? (
        <p className="t-meta mt-2.5 text-center text-[var(--lore-text-tertiary)]">
          No charge, no card, no waitlist form — releases are announced on GitHub.
        </p>
      ) : null}
    </div>
  );
}

function Question({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-4 text-left"
      >
        <span className="text-[15px] font-medium text-[var(--lore-text-primary)]">
          {question}
        </span>
        <ChevronDown
          size={16}
          className={cn(
            "shrink-0 text-[var(--lore-text-tertiary)] transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <p className="pb-5 pr-8 text-[14.5px] leading-[1.75] text-[var(--lore-text-secondary)]">
          {answer}
        </p>
      ) : null}
    </div>
  );
}
