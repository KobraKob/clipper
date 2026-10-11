import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteFrame } from "@/components/SiteFrame";
import "./globals.css";

// Self-hosted fonts: no network access needed at dev/build time.
const figtree = localFont({
  src: "../fonts/Figtree-Variable.ttf",
  variable: "--font-figtree",
  weight: "400 700",
  display: "swap",
});

const barlow = localFont({
  src: [
    { path: "../fonts/BarlowCondensed-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../fonts/BarlowCondensed-Bold.ttf", weight: "700", style: "normal" },
    { path: "../fonts/BarlowCondensed-ExtraBold.ttf", weight: "800", style: "normal" },
  ],
  variable: "--font-barlow",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clipper — Vertical AI Video Clips",
  description:
    "Open-source AI video clipper studio. Extract high-impact vertical 9:16 clips with animated subtitles and viral retention scoring.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${barlow.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full bg-paper text-ink antialiased" suppressHydrationWarning>
        <SiteFrame>{children}</SiteFrame>
      </body>
    </html>
  );
}
