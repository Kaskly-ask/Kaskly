import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { ChainProvider } from "@/lib/chain";
import { ActivityProvider } from "@/lib/activity";
import { Header } from "@/components/header";
import { SheenController } from "@/components/sheen-controller";
import { ConnectionBanner } from "@/components/connection-banner";
import { PwaSetup } from "@/components/pwa-setup";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kaskly — Just Ask Me",
  description:
    "Attach KAS to a message. A reply claims it; silence past the deadline refunds you. Testnet reference client for the ASK protocol.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Kaskly",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning is scoped to THIS element on purpose.
          Browser extensions (password managers, scanners) mutate <body>
          before React hydrates — ours injects `__processed_<uuid>__="true"`
          — which React reports as a mismatch even though the server HTML is
          correct: a curl of production returns exactly
          `<body class="min-h-full flex flex-col">`, and nothing in this
          repo writes that attribute.
          The flag covers only this element's own attributes, NOT its
          subtree, so genuine mismatches deeper in the app still surface.
          That matters: this same investigation found a REAL mismatch
          (unpinned toLocaleString on the compose form), and constant
          extension noise is exactly how such a thing gets scrolled past.
          Do NOT widen this, and do not reach for a global suppression. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <WalletProvider>
          <ChainProvider>
            <ActivityProvider>
            <SheenController />
            <Header />
            <ConnectionBanner />
            <main className="w-full max-w-2xl mx-auto flex-1 px-4 pb-16">
              {children}
            </main>
            <footer className="w-full max-w-2xl mx-auto px-4 pb-8 text-xs text-faint space-y-2">
              <p>
                Kaskly is a reference client for the open ASK protocol — no
                fees, non-custodial, testnet only. Messages and replies are
                end-to-end encrypted; addresses, amounts and deadlines are
                public on-chain.
              </p>
              <p>
                <a
                  href="https://github.com/Kaskly-ask/Kaskly"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal hover:underline"
                >
                  open source
                </a>{" "}
                — verify every claim: the spec, the client, and the
                on-chain evidence (ISC).
              </p>
              <PwaSetup />
              {process.env.NEXT_PUBLIC_FEEDBACK_URL && (
                <p>
                  Beta:{" "}
                  <a
                    href={process.env.NEXT_PUBLIC_FEEDBACK_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal hover:underline"
                  >
                    report a bug or share feedback
                  </a>
                </p>
              )}
            </footer>
            </ActivityProvider>
          </ChainProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
