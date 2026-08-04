"use client";
// Sticky glass header (2026-08-04 visual pass): content slides beneath the
// blur; the "Earned" widget is the centerpiece. Honesty labels (TESTNET
// badge) sit on a SOLID chip — never on translucency.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useActivity } from "@/lib/activity";
import { formatKas, shortAddress } from "@/lib/config";
import { WalletPanel } from "./wallet-panel";

const NAV = [
  { href: "/ask", label: "Ask" },
  { href: "/inbox", label: "Inbox" },
  { href: "/sent", label: "Sent" },
] as const;

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="animate-fade-in ml-1.5 inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-teal text-background text-[10px] font-bold align-middle">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Total net TKAS this wallet has earned by replying — chain-derived (sum
 * of claim outputs), consistent with rebuild-from-chain. The key on the
 * value re-runs the tick-up animation whenever the total increases. */
function EarnedWidget() {
  const { wallet } = useWallet();
  const { earnedSompi } = useActivity();
  if (!wallet) return null;
  const label = formatKas(earnedSompi);
  return (
    <div
      className="hidden sm:flex items-baseline gap-1.5"
      title="Everything you've earned by replying to Asks with this wallet — the sum of your claim transactions, net of network fees, computed from public chain data."
    >
      <span className="text-[10px] uppercase tracking-widest text-faint">
        Earned
      </span>
      <span
        key={label}
        className="amount text-teal font-bold text-sm inline-block animate-tick-up"
      >
        {label}
      </span>
      <span className="text-[10px] text-muted">TKAS</span>
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const { wallet, status } = useWallet();
  const { unreadInbox, unreadSent } = useActivity();
  const [panelOpen, setPanelOpen] = useState(false);
  const badgeFor = (href: string) =>
    href === "/inbox" ? unreadInbox : href === "/sent" ? unreadSent : 0;

  return (
    <header className="sticky top-0 z-40 w-full glass-deep border-b border-white/10 mb-8">
      {/* flex-wrap is the structural overflow fix: a wrapping row can
          never exceed the viewport, so the document can never grow wider
          than 100vw (mobile bug 2026-08-05: the unwrapped row extended
          the whole document's scroll width, sliding centered content off
          the left edge). */}
      <div className="max-w-2xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-x-5">
        {/* Wordmark placeholder — final brand assets pending (public/brand/) */}
        <Link href="/" className="flex items-baseline gap-2 shrink-0">
          <span className="text-teal text-xl font-bold tracking-tight">
            Kaskly
          </span>
          <span className="hidden md:inline text-faint text-xs">
            Just Ask Me
          </span>
        </Link>

        <nav className="flex items-center gap-0.5 sm:gap-1 text-sm">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`px-2 sm:px-3 py-1.5 rounded-md transition-colors ${
                pathname === href
                  ? "text-teal bg-teal/10"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {label}
              <UnreadBadge count={badgeFor(href)} />
            </Link>
          ))}
        </nav>

        <div className="flex-1 hidden sm:flex justify-center">
          <EarnedWidget />
        </div>

        <div className="flex items-center gap-2 sm:gap-3 ml-auto sm:ml-0">
          <span
            className="text-[10px] font-semibold tracking-widest text-warn border border-warn/40 rounded px-1.5 py-0.5 bg-background"
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
