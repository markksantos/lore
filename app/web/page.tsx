import type { Metadata } from "next";
import { WebApp } from "@/components/marketing/web-app";

export const metadata: Metadata = {
  title: "Lore on the web",
  description:
    "Open your own markdown folder in the browser. Read-only, nothing uploaded, no account.",
};

export default function WebPage() {
  return <WebApp />;
}
