import type { Metadata, Viewport } from "next";
import { Literata, Fraunces } from "next/font/google";
import "./globals.css";

// Story / body serif — highly readable at reading sizes.
const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

// Display serif — story titles and headings only.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  // Variable weight is required when requesting extra axes like opsz.
  weight: "variable",
  axes: ["opsz"],
});

export const metadata: Metadata = {
  title: "Storylight",
  description: "Personalised illustrated bedtime stories for your family.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf6ee" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1613" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${literata.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-canvas text-ink">
        {children}
      </body>
    </html>
  );
}
