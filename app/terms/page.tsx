import type { Metadata } from "next";
import { Clause, ProsePage } from "@/components/marketing/prose-page";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Lore is MIT-licensed software you can run yourself for free. Hosted plans are a separate, optional service on top of it.",
};

export default function TermsPage() {
  return (
    <ProsePage
      eyebrow="Terms"
      title="The software is yours. The hosting is optional."
      lede="Two separate things, with separate terms. The program is MIT-licensed and free forever. A hosted plan is a service you may choose to buy on top of it, and can stop buying without losing anything you wrote."
      updated="27 July 2026"
    >
      <Clause title="The licence">
        <p>
          Lore is released under the MIT licence. You may use it commercially, modify it,
          distribute it and build on it. The full text ships in the repository as{" "}
          <code>LICENSE</code>, and it governs — if anything on this page contradicts it, the
          licence wins.
        </p>
      </Clause>

      <Clause title="No warranty">
        <p>
          The software is provided &ldquo;as is&rdquo;, without warranty of any kind. Lore
          writes to your files when you tell it to, and no author or contributor is liable
          for anything that follows.
        </p>
        <p>
          Concretely: keep your wiki in version control. That is good advice regardless of
          this program, and it is the only backstop between an editing mistake and a bad
          afternoon.
        </p>
      </Clause>

      <Clause title="Your wiki stays yours">
        <p>
          No rights in your content are claimed, granted or transferred. Lore reads a folder
          you point it at, on hardware you own. There is no mechanism by which anyone else
          could obtain your notes through it.
        </p>
      </Clause>

      <Clause title="What agents do is on you">
        <p>
          Lore hands your agents four read-only tools. It does not stop them writing to your
          files by other means, and it makes no claim to — that gate was tried, measured, and
          removed for being unenforceable. Anything an agent writes to your wiki is between
          you and the agent you gave file access to.
        </p>
      </Clause>

      <Clause title="Hosted plans">
        <p>
          A hosted plan is billed monthly, yearly, or once for lifetime access, and covers
          sync, backups, managed auth and storage, and the hosted MCP endpoint. It buys you a
          service. It does not buy you the software, which you already have for free, and it
          places no restriction on the self-hosted build.
        </p>
        <p>
          Cancel whenever you like. Your wiki is plain markdown in a folder on your own disk
          and stays exactly where it is — cancelling ends the syncing, not your notes. The
          self-hosted build has no licence check and no expiry, so it keeps running whatever
          happens to your subscription, or to us.
        </p>
      </Clause>

      <Clause title="Other people's trademarks">
        <p>
          The compatibility grid shows the marks of the tools Lore works with. They belong to
          their respective owners and appear to state a fact about interoperability. Nothing
          on this site implies endorsement, partnership or affiliation with any of them.
        </p>
      </Clause>

      <Clause title="Changes">
        <p>
          These terms may change as the project does. A change here cannot reach backwards
          into software you already have: the copy you are running keeps the licence it
          shipped with, permanently. If hosted terms change in a way that matters, plan
          holders are told before it takes effect.
        </p>
      </Clause>
    </ProsePage>
  );
}
