import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/lore/theme-provider";
import { DESCRIPTION, META_TITLE } from "@/lib/brand";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: META_TITLE, template: "%s | Lore" },
  description: DESCRIPTION,
  // Next injects the manifest link itself; the Apple icon has no manifest
  // equivalent, and iOS screenshots the page instead when the link is missing.
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// Next's default viewport meta omits viewport-fit, which leaves every
// env(safe-area-inset-*) in the app shell resolving to 0 on a notched phone —
// the top bar then sits under the status bar and the drawer under the home
// indicator. Declaring the viewport here is what makes those insets real.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Apply the persisted theme before first paint so dark mode never
            flashes white. A server-rendered inline script is the canonical
            no-flash pattern: it runs during the initial HTML response, before
            React hydrates, so the class is on <html> by the time anything
            paints. next/script with beforeInteractive is not a substitute. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('lore:theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d){document.documentElement.classList.add('dark');document.documentElement.style.colorScheme='dark';}}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
