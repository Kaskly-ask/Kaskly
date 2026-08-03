"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { WalletPanel } from "./wallet-panel";

const NAV = [
  { href: "/", label: "Ask" },
  { href: "/inbox", label: "Inbox" },
  { href: "/sent", label: "Sent" },
] as const;

export function shortAddress(address: string): string {
  const sep = address.indexOf(":");
  const body = sep >= 0 ? address.slice(sep + 1) : address;
  return `${body.slice(0, 6)}…${body.slice(-6)}`;
}

export function Header() {
  const pathname = usePathname();
  const { wallet, status } = useWallet();
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <header className="w-full border-b border-border mb-8">
      <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-5">
        {/* Wordmark placeholder — final brand assets pending (public/brand/) */}
        <Link href="/" className="flex items-baseline gap-2 shrink-0">
          <span className="text-teal text-xl font-bold tracking-tight">
            Kaskly
          </span>
          <span className="hidden sm:inline text-faint text-xs">
            Just Ask Me
          </span>
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                pathname === href
                  ? "text-teal bg-teal/10"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3 ml-auto">
          <span
            className="text-[10px] font-semibold tracking-widest text-warn border border-warn/40 rounded px-1.5 py-0.5"
            title="This app runs on Kaspa testnet-10 only. No real money."
          >
            TESTNET
          </span>
          <button
            onClick={() => setPanelOpen((v) => !v)}
            className={`text-xs font-mono px-3 py-1.5 rounded-md border transition-colors ${
              wallet
                ? "border-teal/30 text-teal hover:bg-teal/10"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            {status === "loading"
              ? "…"
              : wallet
                ? shortAddress(wallet.address)
                : "Connect wallet"}
          </button>
        </div>
      </div>
      {panelOpen && <WalletPanel onClose={() => setPanelOpen(false)} />}
    </header>
  );
}
