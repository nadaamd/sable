import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/*
 * IBM Plex, sans and mono.
 *
 * The system stack rendered SF Pro, which is legible but reads as no decision at all. Plex was
 * drawn by IBM for technical interfaces and code, so it holds up at 13px where a display face
 * would not, and the sans and mono are siblings: switching between prose and a column of figures
 * does not change the texture of the page.
 *
 * Not Inter, Geist or Space Grotesk, which the slop catalogue names as the faces that signal a
 * generated site. The landing declares its own display pair — see app/page.tsx — so the terminal
 * never downloads a face it does not use.
 *
 * next/font self-hosts these at build time, so there is no request to Google at runtime, and
 * `adjustFontFallback` matches the fallback's metrics to avoid a shift while they load.
 */
const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
});

const TITLE = "Sable — the confidential cross";
const DESCRIPTION =
  "A sealed-bid, uniform-price batch auction whose matching engine runs on encrypted orders. The market publishes a price. No participant reveals their hand.";

/**
 * `metadataBase` decides whether the OG card resolves to an absolute URL, and X will not render
 * a relative one. Vercel exposes the deployment host, so this is correct on a preview, in
 * production, and locally — in that order of preference.
 */
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Sable",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Sable",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#f3f3f2",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
