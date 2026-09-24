import { ImageResponse } from "next/og";
import { META_TITLE } from "@/lib/brand";

/**
 * The share card, drawn from the same words the landing page leads with, so a
 * card can never promise something the page does not.
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
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>Lore</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>
            Your AI takes notes.
          </div>
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>
            This is where you read them.
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, fontSize: 26, color: "rgba(255,255,255,0.7)" }}>
          <span>Read-only by default</span>
          <span>·</span>
          <span>Free and open source</span>
          <span>·</span>
          <span>Runs on your own machine</span>
        </div>
      </div>
    ),
    size,
  );
}
