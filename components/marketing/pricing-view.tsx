"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Minus, ChevronDown } from "lucide-react";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/site-chrome";
import { CYCLES, FAQ, PLANS, type Cycle } from "@/lib/pricing";
import { paletteVars } from "@/lib/palette";
import { cn } from "@/lib/utils";

/**
 * Pricing.
 *
 * The free column is first and is not styled as a lesser thing, because it is
 * not one — it is the whole application. A pricing page that visually punishes
 * the free tier is telling on itself, and here it would also be lying.
 */
export function PricingView() {
  const [cycle, setCycle] = useState<Cycle>("monthly");

  return (
    <>
      <MarketingHeader />

      <main className="mx-auto max-w-6xl px-6 pb-24 pt-32 md:px-8">
        <div className="text-center">
          <p className="t-meta font-medium uppercase tracking-[0.1em] text-[var(--lore-accent)]">
            Pricing
          </p>
          <h1 className="t-section mt-3 text-[var(--lore-text-primary)]">
            Free to run yourself.
          </h1>
          <p className="t-lede mx-auto mt-4 max-w-2xl text-[var(--lore-text-secondary)]">
            Lore is open source, and the free build is the entire application — nothing is
            held back for a paid tier. Hosted plans add the one thing a program on your
            laptop cannot do for you: be somewhere else too.
          </p>
        </div>

        <div className="mt-9 flex justify-center">
          <div
            role="tablist"
            aria-label="Billing cycle"
            className="inline-flex items-center gap-1 rounded-xl border border-[var(--lore-border)] bg-[var(--lore-surface)] p-1"
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
                    ? "bg-[var(--lore-text-primary)] text-[var(--lore-button-primary-fg)]"
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

        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {PLANS.map((plan, i) => {
            const price = plan.price[cycle];
            return (
              <div
                key={plan.id}
                style={paletteVars(i * 3)}
                className={cn(
                  "flex flex-col rounded-2xl border bg-[var(--lore-surface)] p-6",
                  plan.featured
                    ? "border-[var(--lore-accent)] shadow-[0_1px_24px_-12px_var(--lore-accent)]"
                    : "border-[var(--lore-border)]",
                )}
              >
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--lore-text-primary)]">
                    {plan.name}
                  </h2>
                  {plan.featured ? (
                    <span className="rounded-md bg-[var(--lore-accent)]/12 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--lore-accent)]">
                      Most picked
                    </span>
                  ) : null}
                </div>

                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-[34px] font-semibold tracking-[-0.04em] text-[var(--lore-text-primary)]">
                    {price.amount}
                  </span>
                  {price.unit ? (
                    <span className="text-[15px] text-[var(--lore-text-tertiary)]">
                      {price.unit}
                    </span>
                  ) : null}
                </div>
                <p className="t-meta mt-1 text-[var(--lore-text-tertiary)]">{price.caption}</p>

                <p className="t-body mt-4 text-[var(--lore-text-secondary)]">{plan.blurb}</p>

                <Link
                  href={plan.href}
                  className={cn(
                    "mt-6 inline-flex h-10 items-center justify-center rounded-xl px-4 text-[14px] font-semibold transition-colors",
                    plan.featured
                      ? "bg-[var(--lore-accent)] text-white hover:bg-[var(--lore-accent-hover)]"
                      : "border border-[var(--lore-border)] text-[var(--lore-text-primary)] hover:bg-[var(--lore-surface-raised)]",
                  )}
                >
                  {plan.cta}
                </Link>

                <ul className="mt-6 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature.label} className="flex items-start gap-2.5">
                      {feature.included ? (
                        <Check
                          size={14}
                          className="mt-[3px] shrink-0 text-[var(--lore-success)]"
                        />
                      ) : (
                        <Minus
                          size={14}
                          className="mt-[3px] shrink-0 text-[var(--lore-text-tertiary)]"
                        />
                      )}
                      <span
                        className={cn(
                          "text-[13.5px] leading-[1.6]",
                          feature.included
                            ? "text-[var(--lore-text-secondary)]"
                            : "text-[var(--lore-text-tertiary)]",
                        )}
                      >
                        {feature.label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        <p className="t-meta mt-6 text-center text-[var(--lore-text-tertiary)]">
          Hosted plans are billed per account. The self-hosted build has no licence check,
          no expiry and no account — it keeps working whatever happens here.
        </p>

        <section className="mx-auto mt-20 max-w-2xl">
          <h2 className="t-section text-center text-[var(--lore-text-primary)]">
            Common questions
          </h2>
          <div className="mt-8 divide-y divide-[var(--lore-border)] border-y border-[var(--lore-border)]">
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
        <p className="pb-4 text-[14.5px] leading-[1.75] text-[var(--lore-text-secondary)]">
          {answer}
        </p>
      ) : null}
    </div>
  );
}
