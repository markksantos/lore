import { readConfig, suggestVaults } from "@/lib/config";
import { loadVaultIndex } from "@/lib/server";
import { Onboarding } from "@/components/lore/onboarding";
import { VaultApp } from "@/components/lore/vault-app";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vault" };

export default async function VaultPage() {
  const config = await readConfig();

  if (!config.activeVault) {
    return <Onboarding suggestions={await suggestVaults()} />;
  }

  // A linked folder can be renamed, unmounted, or deleted between sessions.
  // Falling back to onboarding is the honest response — better than an empty
  // app that looks like the wiki lost its contents.
  try {
    const index = await loadVaultIndex(true);
    return <VaultApp initialIndex={index} installDir={process.cwd()} />;
  } catch {
    return <Onboarding suggestions={await suggestVaults()} />;
  }
}
