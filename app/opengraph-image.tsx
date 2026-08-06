import { ImageResponse } from "next/og";
import { META_TITLE } from "@/lib/brand";

/**
 * The share card.
 *
 * Drawn rather than photographed, for one reason: a PNG in public/ is a second
 * copy of the headline that nobody remembers to update, and a share card whose
 * text disagrees with the page is the version most people see. This one is
 * composed from the same constants the page renders, so it cannot drift.
 *
 * Deliberately plain. A card is looked at for a third of a second in a scrolling
 * feed at about four hundred pixels wide, which is room for a name, one claim
 * and the fact that it is free — and no room at all for a screenshot of a
 * seventeen-screen application.
 */
export const alt = META_TITLE;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(140deg, #0b1220 0%, #14243f 55%, #1d3a63 100%)",
          fontFamily: "sans-serif",
        }}
      >
        {/* The colour bar is the product's own palette, in its own order. It is
            the only ornament, and it is the thing that makes two Lore cards in
            a feed recognisably the same product. */}
        <div style={{ display: "flex", gap: 8 }}>
          {["#4f9eff", "#ff9c5e", "#ff6fc1", "#84d678", "#c084fc", "#fbbf24", "#22d3ee"].map(
            (colour) => (
              <div
                key={colour}
                style={{ width: 56, height: 8, borderRadius: 999, background: colour }}
              />
            ),
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              color: "rgba(255,255,255,0.6)",
            }}
          >
            Lore
          </div>
          <div
            style={{
              marginTop: 18,
              fontSize: 82,
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 1.02,
              color: "#ffffff",
            }}
          >
            Ask your own machine anything.
          </div>
          <div
            style={{
              marginTop: 26,
              fontSize: 30,
              lineHeight: 1.4,
              color: "rgba(255,255,255,0.78)",
              maxWidth: 880,
            }}
          >
            What your agents wrote, what was on your screen, every AI session you have had — one
            search box, on your laptop.
          </div>
        </div>

        <div style={{ display: "flex", gap: 28, fontSize: 24, color: "rgba(255,255,255,0.6)" }}>
          <span>Free and open source</span>
          <span>·</span>
          <span>No account</span>
          <span>·</span>
          <span>Nothing is uploaded</span>
        </div>
      </div>
    ),
    size,
  );
}
