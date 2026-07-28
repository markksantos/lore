import type { Metadata } from "next";
import { DemoView } from "@/components/marketing/demo-view";

export const metadata: Metadata = {
  title: "Try it",
  description:
    "A working Lore, in your browser, on a sample wiki. Click through it before downloading anything.",
};

export default function DemoPage() {
  return <DemoView />;
}
