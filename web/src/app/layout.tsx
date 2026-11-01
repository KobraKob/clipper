import type { Metadata } from "next";
import localFont from "next/font/local";
import { SiteFrame } from "@/components/SiteFrame";
import "./globals.css";

// Self-hosted fonts keep the interface independent of third-party font requests.
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
  title: "Chop Shop — Find the moment. Make the cut.",
  description:
    "A video cut room for finding standout moments, refining vertical clips, captioning, and exporting.",
  applicationName: "Chop Shop",
  openGraph: {
    title: "Chop Shop — Find the moment. Make the cut.",
    description:
      "Bring footage in, refine the cut, and export the moments worth sharing.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${figtree.variable} ${barlow.variable} h-full`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-paper text-ink antialiased" suppressHydrationWarning>
        <SiteFrame>{children}</SiteFrame>
      </body>
    </html>
  );
}
