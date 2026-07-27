import type { Metadata } from "next";
import { PricingView } from "@/components/marketing/pricing-view";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Lore is open source and free to self-host. Hosted plans add cross-device sync, backups, and managed auth and storage, from $12 a month.",
};

export default function PricingPage() {
  return <PricingView />;
}
