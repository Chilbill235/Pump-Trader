import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Pump Trader",
  description: "Personal pump.fun buy/sell dashboard. Not financial advice.",
  applicationName: "Pump Trader",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Pump Trader",
    statusBarStyle: "black-translucent",
    startupImage: "/icons/icon-512.svg",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icons/favicon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icons/icon-192.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#05060a" },
    { media: "(prefers-color-scheme: light)", color: "#05060a" },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
      </head>
      <body>
        <Providers>{children}</Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => undefined);
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}