import type { Metadata } from "next";
import { Clause, ProsePage } from "@/components/marketing/prose-page";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Lore has no server, no account and no telemetry. This page says exactly what that means and where the two exceptions are.",
};

export default function PrivacyPage() {
  return (
    <ProsePage
      eyebrow="Privacy"
      title="Nothing leaves your machine."
      lede="Most privacy policies describe what a company does with your data. This one mostly describes an absence, because Lore has nowhere to send anything."
      updated="27 July 2026"
    >
      <Clause title="There is no account and no server">
        <p>
          Lore runs as a local process on your own computer, bound to{" "}
          <code>127.0.0.1</code>. There is no sign-up, no login, no hosted backend and no
          database anywhere but your disk. Nobody operating Lore can see your wiki, because
          there is no operator — the copy you run answers only to you.
        </p>
      </Clause>

      <Clause title="There is no analytics or telemetry">
        <p>
          No tracking scripts, no error reporting service, no usage pings, no feature flags
          phoning home. The application has no analytics dependency of any kind, and the only
          external addresses written anywhere in its source are the two links in the footer.
        </p>
        <p>
          Lore does record how your agents use your wiki — which pages get read, which
          searches come back empty. That log is a file in <code>~/.lore</code> on your
          machine. It is written locally, read locally, and never transmitted.
        </p>
      </Clause>

      <Clause title="What Lore writes, and where">
        <p>
          Everything Lore keeps for itself lives in <code>~/.lore</code>, deliberately
          outside your wiki, so a <code>git diff</code> of your notes stays clean: the vault
          path you chose, the write journal, the verification ledger, the usage log, and any
          model you downloaded.
        </p>
        <p>
          Inside your wiki it writes two things, both only when you ask: pages you create or
          edit in the app, and an <code>AGENTS.md</code> index when you press the button —
          fenced with markers so anything you wrote in that file is preserved.
        </p>
      </Clause>

      <Clause title="The two times it touches the network">
        <p>
          <strong>Semantic search</strong>, if you turn it on, downloads a small embedding
          model from Hugging Face the first time and caches it in <code>~/.lore/models</code>.
          Your pages are not sent anywhere — the model comes to your machine and the
          embedding happens there. After that download it works offline.
        </p>
        <p>
          <strong>A local language model</strong>, if you have Ollama running, is reached at{" "}
          <code>127.0.0.1:11434</code>. That is your own machine. Lore does not bundle a
          model, does not install one, and has no cloud model provider configured.
        </p>
      </Clause>

      <Clause title="Paired remote access">
        <p>
          Lore can be opened from your phone on your own network. It is off unless you switch
          it on, and when you do it issues a random token stored with owner-only permissions.
          The connection is plain HTTP over your local network — there is no TLS, so a
          hostile network could read the token. Treat it as a convenience on networks you
          trust, not a security boundary.
        </p>
      </Clause>

      <Clause title="This website">
        <p>
          The page you are reading is a static marketing site with no analytics on it. It is
          served by a hosting provider that keeps its own request logs, in the ordinary way
          that every web server does — IP address, page, timestamp. Nothing on this site sets
          a tracking cookie, and none of it is connected to the application.
        </p>
      </Clause>

      <Clause title="How to verify all of this">
        <p>
          Do not take it on trust. The source is public: search it for a network call and see
          what you find. Or run Lore with the network off — everything except the one-time
          model download works exactly the same, which is the shortest proof available.
        </p>
      </Clause>
    </ProsePage>
  );
}
