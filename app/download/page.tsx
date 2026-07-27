import type { Metadata } from "next";
import { DownloadView } from "@/components/marketing/download-view";

export const metadata: Metadata = {
  title: "Download",
  description:
    "Lore for macOS, Windows and Linux — one window, a real folder picker, and nothing leaving your machine.",
};

export default function DownloadPage() {
  return <DownloadView />;
}
