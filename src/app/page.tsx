"use client";
// Marketing landing for kaskly.app (root route; the composer lives at
// /ask).
//
// REGISTER: this app moves money, so the page is calm and solid — closer to
// a serious wallet than to a launch page. Concretely: no colour wash behind
// the hero (teal is a sharp accent ON elements, never a glow behind them),
// no manufactured urgency of any kind, and plain declarative copy. The
// primitive is genuinely new; saying so clearly persuades better than
// adjectives do.
//
// The hero shows the REAL AskCard component with example data rather than a
// picture of one, so the first thing a visitor meets is the product.
import Link from "next/link";
import { AskCard } from "@/components/ask-card";
import { DagVisual } from "@/components/dag-visual";

/** One primary action, worded identically both times it appears. */
const CTA =
  "inline-flex items-center justify-center px-6 py-3 rounded-md bg-teal text-background font-semibold text-sm hover:opacity-90 transition-opacity";

function EscrowedBadge() {
  return (
    <span className="text-[10px] tracking-wide text-teal border border-teal/30 rounded px-1.5 py-0.5">
      ✓ escrowed
    </span>
  );
}

export default function LandingPage() {
  return (
    // ONE rhythm for the page: every section is a child of this stack, so
    // vertical spacing is decided once rather than per section.
    <div className="relative space-y-20 sm:space-y-28 pb-8">
      {/* Left-rail blockDAG. Pinned to the viewport and positioned from the
          same 42rem column this page is centred in, so it sits entirely in
          the left margin and can never overlap the hero. Purely decorative
          texture — the value proposition is the focal point. */}
      <DagVisual />

      {/* ---------- 1. HERO ---------- */}
      <section className="pt-10 sm:pt-16 space-y-8">
        <div className="text-center space-y-5">
          <p className="text-xs uppercase tracking-widest text-teal">
            Attention monetization without the ads
          </p>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight [text-wrap:balance] max-w-2xl mx-auto">
            Ever message someone you admire — and hear nothing back?
          </h1>
          {/* One clarifying line, answering the headline's question. */}
          <p className="text-muted text-lg leading-relaxed max-w-xl mx-auto [text-wrap:pretty]">
            Kaskly attaches real money to your message. They reply, they earn
            it. They stay silent, it comes back to you — automatically.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
            <Link href="/ask" className={CTA}>
              Send an Ask
            </Link>
            <a
              href="#how"
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              How it works ↓
            </a>
          </div>
        </div>

        {/* The product itself, in the hero. Labelled as an example so it is
            never mistaken for the visitor's own inbox. */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-muted text-center">
            An Ask, exactly as it arrives
          </p>
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
            viewer="recipient"
            badge={<EscrowedBadge />}
          />
        </div>
      </section>

      {/* ---------- 2. HOW IT WORKS ---------- */}
      <section id="how" className="space-y-6 scroll-mt-24">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <div className="space-y-4">
          <div className="glass-clear rounded-xl p-5 space-y-2">
            <p className="text-xs uppercase tracking-widest text-muted">
              1 · Ask
            </p>
            <p className="text-[15px] leading-relaxed">
              Write your message. Attach KAS. Set a deadline. Your money locks
              under an on-chain rule the moment you send.
            </p>
          </div>
          <div className="glass-clear rounded-xl p-5 space-y-2">
            <p className="text-xs uppercase tracking-widest text-muted">
              2 · They reply to claim
            </p>
            <p className="text-[15px] leading-relaxed">
              Their answer is the transaction that pays them. One atomic
              action — no reply, no money.
            </p>
          </div>
          <div className="glass-clear rounded-xl p-5 space-y-2">
            <p className="text-xs uppercase tracking-widest text-muted">
              3 · Silence refunds you
            </p>
            <p className="text-[15px] leading-relaxed">
              The deadline passes and the chain returns your KAS. No permission
              needed — from anyone.
            </p>
          </div>
        </div>
        <p className="text-sm text-muted">
          Enforced by on-chain covenants — not promises. No protocol fees,
          ever.
        </p>
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
              <li>The only outcomes are an answer or your money back.</li>
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
          Every Ask brings someone new. The person you ask doesn&apos;t need to
          be in crypto — a wallet is two clicks in a browser, no exchange, no
          purchase. They enter the network holding KAS they earned, not bought.
        </p>
        <p className="text-[15px] text-muted leading-relaxed max-w-xl">
          Kaskly turns Kaspa&apos;s speed and covenants into something people
          outside crypto actually want: a reason to show up.
        </p>
      </section>

      {/* ---------- 5. CLOSING CTA — same action, same words ---------- */}
      <section className="text-center space-y-4">
        <p className="text-lg [text-wrap:balance] max-w-lg mx-auto">
          A reply, or your money back. Those are the only two endings.
        </p>
        <div>
          <Link href="/ask" className={CTA}>
            Send an Ask
          </Link>
        </div>
      </section>

      {/* ---------- 6. TRUST STRIP (honesty labels — always visible) ------- */}
      <section className="glass-clear rounded-xl p-5 space-y-3">
        <p className="text-sm leading-relaxed">
          <span className="text-foreground">Non-custodial</span>
          <span className="text-muted"> — keys never leave your browser · </span>
          <span className="text-foreground">end-to-end encrypted</span>
          <span className="text-muted"> messages · </span>
          <span className="text-foreground">automatic refunds</span>
          <span className="text-muted"> enforced on-chain · </span>
          <span className="text-foreground">open protocol, open spec</span>
          <span className="text-muted"> (ISC)</span>
        </p>
        <p className="text-sm">
          <span className="text-[10px] font-semibold tracking-widest text-warn border border-warn/40 rounded px-1.5 py-0.5 bg-background mr-2 align-middle">
            TESTNET
          </span>
          <span className="text-muted">
            Beta on testnet — real money mode comes after it survives testing.
          </span>
        </p>
      </section>

      {/* ---------- 7. FOOTER ---------- */}
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
            Send an Ask →
          </Link>
        </span>
      </section>
    </div>
  );
}
