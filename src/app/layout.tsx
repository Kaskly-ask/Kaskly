import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "@/lib/wallet";
import { ChainProvider } from "@/lib/chain";
import { ActivityProvider } from "@/lib/activity";
import { Header } from "@/components/header";

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
      <body className="min-h-full flex flex-col">
        <WalletProvider>
          <ChainProvider>
            <ActivityProvider>
            <Header />
            <main className="w-full max-w-2xl mx-auto flex-1 px-4 pb-16">
              {children}
            </main>
            <footer className="w-full max-w-2xl mx-auto px-4 pb-8 text-xs text-faint">
              Kaskly is a reference client for the open ASK protocol — no
              fees, non-custodial, testnet only. Messages and replies are
              end-to-end encrypted; addresses, amounts and deadlines are
              public on-chain.
            </footer>
            </ActivityProvider>
          </ChainProvider>
        </WalletProvider>
      </body>
    </html>
  );
}
