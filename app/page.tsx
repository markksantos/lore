import { Landing } from "@/components/marketing/landing";
import { pickScene } from "@/lib/scenery";

// Rendered per request so the sky can change on every visit. The page has no
// other dynamic input, so this is the entire cost of the rotation.
export const dynamic = "force-dynamic";

export default function Home() {
  return <Landing scene={pickScene()} />;
}
