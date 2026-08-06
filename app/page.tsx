import { Landing } from "@/components/marketing/landing";
import { pickScene } from "@/lib/scenery";
import { availableAgentLogos } from "@/lib/agents";
import { isSiteMode } from "@/lib/mode";
import { FAQ } from "@/lib/faq";
import { GITHUB_URL, TAGLINE } from "@/lib/brand";

// Rendered per request so the sky can change on every visit. The page has no
// other dynamic input, so this is the entire cost of the rotation.
export const dynamic = "force-dynamic";

/**
 * Structured data, rendered server-side.
 *
 * Two schemas, for two different readers. SoftwareApplication is what puts a
 * price and a platform in a search result; FAQPage is what an AI assistant
 * quotes when somebody asks it whether Lore uploads your notes. Given what this
 * product is, the second one matters more than the first — the answer to that
 * question is the whole sale, and it is better coming from our own markup than
 * from a paraphrase of the marketing copy.
 *
 * Every field below has to stay true. Structured data that disagrees with the
 * page is worse than none: search engines drop it, and an assistant that quotes
 * a stale price has been made to lie on our behalf.
 */
function StructuredData() {
  const graph = [
    {
      "@type": "SoftwareApplication",
      name: "Lore",
      description: TAGLINE,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "macOS, Windows, Linux",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      isAccessibleForFree: true,
      codeRepository: GITHUB_URL,
      featureList: [
        "Reads the markdown folder your AI agents write to",
        "Says what changed, who changed it and what it removed",
        "Answers questions from your own pages, with sources",
        "Indexes your files, mail, messages, calendar and notes locally",
        "Searches every Claude Code, Codex and Cursor session on your machine",
        "Describes your screen with a vision model that runs on your machine",
        "Serves twelve tools to agents over MCP",
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];

  return (
    <script
      type="application/ld+json"
      // Serialised with JSON.stringify, so the only injection surface is our
      // own copy — and `<` is escaped below in case an answer ever contains one.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(
          /</g,
          "\\u003c",
        ),
      }}
    />
  );
}

export default async function Home() {
  return (
    <>
      <StructuredData />
      <Landing scene={pickScene()} logos={await availableAgentLogos()} siteMode={isSiteMode()} />
    </>
  );
}
