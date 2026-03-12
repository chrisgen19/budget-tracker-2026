import type { Metadata, Viewport } from "next";
import { Young_Serif, Outfit, Plus_Jakarta_Sans } from "next/font/google";
import { SerwistProvider } from "./serwist";
import "./globals.css";

const youngSerif = Young_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-young-serif",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Budget Tracker",
  description: "Track your income and expenses with ease",
  applicationName: "Budget Tracker",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Budget Tracker",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#C8702A",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${youngSerif.variable} ${outfit.variable} ${plusJakarta.variable}`}>
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="font-sans antialiased">
        <SerwistProvider swUrl="/sw.js">
          {children}
        </SerwistProvider>
      </body>
    </html>
  );
}
