import type { Metadata } from "next";
import { Barlow_Condensed, Figtree } from "next/font/google";
import { SiteFrame } from "@/components/SiteFrame";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Clipper — Vertical AI Video Clips",
  description:
    "Open-source AI video clipper studio. Extract high-impact vertical 9:16 clips with animated subtitles and viral retention scoring.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${barlow.variable} h-full`}>
      <body className="min-h-full bg-paper text-ink antialiased">
        <SiteFrame>{children}</SiteFrame>
      </body>
    </html>
  );
}
