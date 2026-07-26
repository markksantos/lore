import { Landing } from "@/components/marketing/landing";
import { pickScene } from "@/lib/scenery";
import { availableAgentLogos } from "@/lib/agents";

// Rendered per request so the sky can change on every visit. The page has no
// other dynamic input, so this is the entire cost of the rotation.
export const dynamic = "force-dynamic";

export default async function Home() {
  return <Landing scene={pickScene()} logos={await availableAgentLogos()} />;
}
