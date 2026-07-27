import type { Metadata } from "next";
import { PricingView } from "@/components/marketing/pricing-view";
import { pickScene } from "@/lib/scenery";

// The sky is rolled per request, like the landing page's, so the two pages are
// always the same world on any given visit.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Lore is open source and free to self-host. Hosted plans add cross-device sync, backups, and managed auth and storage, from $12 a month.",
};

export default function PricingPage() {
  return <PricingView scene={pickScene()} />;
}
