import type { Metadata } from "next";
import { InstallView } from "@/components/marketing/install-view";
import { isSiteMode } from "@/lib/mode";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Install",
  description:
    "Lore runs on your own machine, because it reads the folder your wiki lives in. Here is how to get it.",
};

export default function InstallPage() {
  return <InstallView siteMode={isSiteMode()} />;
}
