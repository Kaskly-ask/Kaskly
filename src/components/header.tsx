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
      {/* Mobile header is a DELIBERATE two-row composition (B5 follow-up):
          row 1 = wordmark + compact TESTNET/Connect cluster; row 2 = the
          nav as a full-width tab row. Desktop (sm+) keeps the original
          single row. Neither can widen the document (no unwrapped
          overflow; root overflow-x clip stays as backstop). */}
      <div className="max-w-2xl mx-auto px-3 sm:px-4 pt-3 pb-0 sm:py-4">
        <div className="flex items-center gap-3 sm:gap-5">
          {/* Wordmark placeholder — final brand assets pending (public/brand/) */}
          <Link href="/" className="flex items-baseline gap-2 shrink-0">
            <span className="text-teal text-xl font-bold tracking-tight">
              Kaskly
            </span>
            <span className="hidden md:inline text-faint text-xs">
              Just Ask Me
            </span>
          </Link>

          <nav className="hidden sm:flex items-center gap-1 text-sm">
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
                <UnreadBadge count={badgeFor(href)} />
              </Link>
            ))}
          </nav>

          <div className="flex-1 hidden sm:flex justify-center">
            <EarnedWidget />
          </div>

          <div className="flex items-center gap-2 sm:gap-3 ml-auto">
            <span
              className="text-[10px] font-semibold tracking-widest text-warn border border-warn/40 rounded px-1.5 py-0.5 bg-background"
              title="This app runs on Kaspa testnet-10 only. No real money."
            >
              TESTNET
            </span>
            <button
              onClick={() => setPanelOpen((v) => !v)}
              className={
                wallet
                  ? "text-xs font-mono px-2.5 sm:px-3 py-1.5 rounded-md border border-teal/30 text-teal hover:bg-teal/10 transition-colors"
                  : "text-xs px-3 py-1.5 rounded-md font-semibold bg-teal text-background hover:opacity-90 transition-opacity sm:bg-transparent sm:font-mono sm:font-normal sm:border sm:border-border sm:text-muted sm:hover:text-foreground"
              }
            >
              {status === "loading" ? (
                "…"
              ) : wallet ? (
                shortAddress(wallet.address)
              ) : (
                <>
                  <span className="sm:hidden">Connect</span>
                  <span className="hidden sm:inline">Connect wallet</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Mobile tab row — composed, full-bleed within the column */}
        <nav className="sm:hidden flex mt-2 -mx-3 border-t border-white/10">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`flex-1 text-center py-2 text-sm border-b-2 transition-colors ${
                pathname === href
                  ? "border-teal text-teal"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {label}
              <UnreadBadge count={badgeFor(href)} />
            </Link>
          ))}
        </nav>
      </div>
      {panelOpen && <WalletPanel onClose={() => setPanelOpen(false)} />}
    </header>
  );
}
