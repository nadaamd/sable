import type { Metadata, Viewport } from "next";
import "./globals.css";

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
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
