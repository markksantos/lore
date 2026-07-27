import type { Metadata } from "next";
import { Clause, ProsePage } from "@/components/marketing/prose-page";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Lore is MIT-licensed software you run yourself. There is no service, no subscription and no warranty.",
};

export default function TermsPage() {
  return (
    <ProsePage
      eyebrow="Terms"
      title="It's software, not a service."
      lede="There is nothing to subscribe to and no account to terminate. These terms cover the only relationship that exists: you have a copy of a program."
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

      <Clause title="Other people's trademarks">
        <p>
          The compatibility grid shows the marks of the tools Lore works with. They belong to
          their respective owners and appear to state a fact about interoperability. Nothing
          on this site implies endorsement, partnership or affiliation with any of them.
        </p>
      </Clause>

      <Clause title="Changes">
        <p>
          These terms may change as the project does. Since there is no account and no data
          held, a change here cannot affect anything you have already installed — the copy you
          are running keeps the licence it shipped with.
        </p>
      </Clause>
    </ProsePage>
  );
}
