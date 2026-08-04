"use client";
// Marketing landing for kaskly.app (root route; the composer lives at
// /ask). Same design language as the app — near-black, hex texture, teal,
// clear glass — and the same voice as the composer's enforcement blurb:
// short declarative sentences, honesty as a feature. The hero art is the
// REAL AskCard component with mock data, countdown ticking live.
import Link from "next/link";
import { AskCard } from "@/components/ask-card";

const CTA =
  "inline-block px-5 py-2.5 rounded-md bg-teal text-background font-semibold text-sm hover:opacity-90 transition-opacity";

function EscrowedBadge() {
  return (
    <span className="text-[10px] tracking-wide text-teal border border-teal/30 rounded px-1.5 py-0.5">
      ✓ escrowed
    </span>
  );
}

export default function LandingPage() {
  return (
    <div className="space-y-24 pt-8 pb-8">
      {/* ---------- 1. HERO ---------- */}
      <section className="space-y-6">
        <p className="text-xs uppercase tracking-widest text-teal">
          Just Ask Me
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight [text-wrap:balance]">
          Ever message someone you admire — and hear nothing back?
        </h1>
        <p className="text-muted text-lg leading-relaxed max-w-xl">
          Kaskly attaches real money to your message. They reply, they earn
          it. They stay silent, you get every cent back — automatically.
        </p>
        <div className="flex flex-wrap items-center gap-5">
          <Link href="/ask" className={CTA}>
            Send your first Ask
          </Link>
          <a
            href="#how"
            className="text-sm text-muted hover:text-foreground transition-colors"
          >
            How it works ↓
          </a>
        </div>
        <div className="pt-6" aria-hidden>
          <AskCard
            message={
              "Love your work. One question: what would you build on Kaspa if you had a free weekend? 25 TKAS says it's worth two minutes of your time."
            }
            amountSompi="2500000000"
            counterpartyLabel="from"
            counterpartyAddress="kaspatest:qz3e6x3290ygpc70sj6gmrsz2gflruf2y7p4kdaguwy9tc6548e3g6zspgvp6"
            counterpartyEditable={false}
            deadline="6012000"
            daaScore={0n}
            status="open"
            badge={<EscrowedBadge />}
          />
        </div>
      </section>

      {/* ---------- 2. HOW IT WORKS ---------- */}
      <section id="how" className="space-y-6 scroll-mt-24">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="space-y-4">
          <div className="glass-clear rounded-xl p-5 space-y-2">
            <p className="text-xs uppercase tracking-widest text-faint">
              1 · Ask
            </p>
            <p className="text-[15px] leading-relaxed">
              Write your message. Attach KAS. Set a deadline. Your money
              locks under an on-chain rule the moment you send.
            </p>
          </div>
          <div className="glass-clear rounded-xl p-5 space-y-2">
            <p className="text-xs uppercase tracking-widest text-faint">
              2 · They reply to claim
            </p>
            <p className="text-[15px] leading-relaxed">
              Their answer is the transaction that pays them. One atomic
              action — no reply, no money.
            </p>
          </div>
          <div className="glass-clear rounded-xl p-5 space-y-2">
            <p className="text-xs uppercase tracking-widest text-faint">
              3 · Silence refunds you
            </p>
            <p className="text-[15px] leading-relaxed">
              The deadline passes and the chain returns every cent. No
              permission needed — from anyone.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted">
          Enforced by on-chain covenants — not promises. No protocol fees,
          ever.
        </p>
        <Link href="/ask" className="text-sm text-teal hover:underline">
          Try it now →
        </Link>
      </section>

      {/* ---------- 3. WHY IT MATTERS ---------- */}
      <section className="space-y-6">
        <h2 className="text-2xl font-semibold tracking-tight">
          Why it matters
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="glass-clear rounded-xl p-5 space-y-3">
            <p className="text-xs uppercase tracking-widest text-teal">
              For askers
            </p>
            <ul className="space-y-2 text-[15px] leading-relaxed">
              <li>Your message stands out from the noise.</li>
              <li>You never pay for silence.</li>
              <li>
                The only outcomes are an answer or your money back.
              </li>
            </ul>
          </div>
          <div className="glass-clear rounded-xl p-5 space-y-3">
            <p className="text-xs uppercase tracking-widest text-teal">
              For answerers
            </p>
            <ul className="space-y-2 text-[15px] leading-relaxed">
              <li>Your attention has value — get paid for it.</li>
              <li>
                No platform lock-in, no middleman. Your answers are yours.
              </li>
              <li>A new income stream that starts with one reply.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ---------- 4. WIN-WIN / KASPA ---------- */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          Good for you. Good for Kaspa.
        </h2>
        <p className="text-[15px] text-muted leading-relaxed max-w-xl">
          Every Ask brings someone new. The person you ask doesn&apos;t need
          to be in crypto — a wallet is two clicks in a browser, no
          exchange, no purchase. They enter the network holding KAS they
          earned, not bought.
        </p>
        <p className="text-[15px] text-muted leading-relaxed max-w-xl">
          Kaskly turns Kaspa&apos;s speed and covenants into something
          people outside crypto actually want: a reason to show up. More
          users. More real usage. More people earning their first KAS.
          That&apos;s the win-win.
        </p>
        <Link href="/ask" className={CTA}>
          Ask someone today
        </Link>
      </section>

      {/* ---------- 5. TRUST STRIP ---------- */}
      <section className="glass-clear rounded-xl p-5 space-y-3">
        <p className="text-sm leading-relaxed">
          <span className="text-foreground">Non-custodial</span>
          <span className="text-faint"> — keys never leave your browser · </span>
          <span className="text-foreground">end-to-end encrypted</span>
          <span className="text-faint"> messages · </span>
          <span className="text-foreground">automatic refunds</span>
          <span className="text-faint"> enforced on-chain · </span>
          <span className="text-foreground">open protocol, open spec</span>
          <span className="text-faint"> (ISC)</span>
        </p>
        <p className="text-sm">
          <span className="text-[10px] font-semibold tracking-widest text-warn border border-warn/40 rounded px-1.5 py-0.5 bg-background mr-2 align-middle">
            TESTNET
          </span>
          <span className="text-muted">
            Beta on testnet — real money mode comes after it survives
            testing.
          </span>
        </p>
      </section>

      {/* ---------- 6. FOOTER ---------- */}
      <section className="border-t border-white/10 pt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-faint">
        <span className="text-muted">kaskly.app</span>
        <span>·</span>
        <span className="font-mono">kaskly.kas</span>
        <span>·</span>
        <a
          href="https://github.com/Kaskly-ask/Kaskly"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-teal underline decoration-dotted"
        >
          open source — spec &amp; reference client (ISC)
        </a>
        <span className="ml-auto">
          <Link href="/ask" className="text-teal hover:underline">
            Send your first Ask →
          </Link>
        </span>
      </section>
    </div>
  );
}
