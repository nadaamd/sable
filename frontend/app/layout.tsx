import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sable — the confidential cross",
  description:
    "A sealed-bid, uniform-price batch auction whose matching engine runs on encrypted orders.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
