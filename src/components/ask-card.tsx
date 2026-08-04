"use client";
// The Ask card — the hero object (brief §5): message-first, amount as a
// bold tabular figure, countdown always visible. Message/reply text renders
// through React text nodes only (XSS-inert by construction — never
// dangerouslySetInnerHTML).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DAA_PER_SECOND, explorerTxUrl, formatKas, shortAddress } from "@/lib/config";
import type { AskStatus } from "@/lib/ask-record";

/** Long text collapses to ~3 lines with an expander (F9: one huge card
 * must not destroy list scannability). Heuristic trigger — CSS clamps the
 * actual rendering. */
export function CollapsibleText({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible =
    text.length > 280 || (text.match(/\n/g)?.length ?? 0) >= 3;
  return (
    <div className="min-w-0">
      <p
        className={`whitespace-pre-wrap break-words ${className} ${
          collapsible && !expanded ? "line-clamp-3" : ""
        }`}
      >
        {text}
      </p>
      {collapsible && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-teal hover:underline mt-1"
        >
          {expanded ? "show less" : "show more"}
        </button>
      )}
    </div>
  );
}

/** Displayed times are ESTIMATES over a DAA-denominated deadline (the
 * chain counts DAA score, ~10/s — ASKSPEC §8); small drift against real
 * block pace is expected. Display smoothing (post-tag queue item 3): the
 * countdown ticks locally at 1/s; when the chain clock resyncs, small
 * corrections are absorbed by pausing (upward drift) or double-stepping
 * (downward drift) rather than jumping the number — only drift beyond 60s
 * resyncs visibly. */
export function Countdown({
  deadline,
  daaScore,
}: {
  deadline: string;
  daaScore: bigint | null;
}) {
  const [displaySecs, setDisplaySecs] = useState<number | null>(null);
  const targetRef = useRef<number | null>(null);

  useEffect(() => {
    if (daaScore === null) return;
    const remainingDaa = BigInt(deadline) - daaScore;
    const target = remainingDaa <= 0n ? 0 : Number(remainingDaa / DAA_PER_SECOND);
    targetRef.current = target;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setDisplaySecs((cur) => {
        if (cur === null) return target; // first sync
        if (target === 0) return 0; // deadline passed — never smoothed
        if (Math.abs(target - cur) > 60) return target; // visible resync
        return cur; // small drift — absorbed by the tick below
      });
    });
    return () => {
      cancelled = true;
    };
  }, [daaScore, deadline]);

  useEffect(() => {
    const id = setInterval(() => {
      setDisplaySecs((cur) => {
        if (cur === null || cur <= 0) return cur;
        const target = targetRef.current ?? cur;
        const drift = target - cur;
        if (drift > 2) return cur; // clock gained on us — hold, don't tick up
        if (drift < -2) return Math.max(0, cur - 2); // catch down gently
        return cur - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if (displaySecs === null) {
    return <span className="text-faint text-xs">countdown syncing…</span>;
  }
  if (displaySecs <= 0) {
    return <span className="text-warn text-xs">deadline passed</span>;
  }
  const secs = displaySecs;
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const text =
    d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return (
    <span
      className="text-teal text-xs amount"
      title={`Estimated from the DAA-score deadline (${deadline}); the chain counts blocks, not clocks.`}
    >
      {text} left
    </span>
  );
}

/** Resolution-relative time for settled cards (F10): terminal states take
 * absolute precedence — no countdown ever ticks on an answered/refunded
 * card. Freshness comes from the parent's regular re-renders (DAA poll). */
export function ResolvedAgo({ resolvedAtMs }: { resolvedAtMs: number | null }) {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    queueMicrotask(tick);
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  if (resolvedAtMs === null || nowMs === null) return null;
  const secs = Math.max(0, Math.floor((nowMs - resolvedAtMs) / 1000));
  const text =
    secs < 60
      ? "just now"
      : secs < 3600
        ? `${Math.floor(secs / 60)}m ago`
        : secs < 86400
          ? `${Math.floor(secs / 3600)}h ago`
          : `${Math.floor(secs / 86400)}d ago`;
  return (
    <span
      className="text-muted text-xs amount"
      title={new Date(resolvedAtMs).toLocaleString()}
    >
      {text}
    </span>
  );
}

const STATUS_LABELS: Record<AskStatus, { label: string; cls: string }> = {
  open: { label: "awaiting reply", cls: "text-teal border-teal/30" },
  answered: { label: "answered", cls: "text-teal border-teal/60 bg-teal/10" },
  refunded: { label: "refunded", cls: "text-muted border-border" },
  expired_pending_refund: {
    label: "expired — refund pending",
    cls: "text-warn border-warn/40",
  },
};

export function StatusChip({ status }: { status: AskStatus }) {
  const s = STATUS_LABELS[status];
  return (
    <span className={`text-[10px] tracking-wide border rounded px-1.5 py-0.5 ${s.cls}`}>
      {s.label}
    </span>
  );
}

/** Collapsed, always-recoverable container for hidden cards (F9 v1: only
 * settled cards can land here — the pages enforce that rule). */
export function HiddenSection({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details>
      <summary className="cursor-pointer text-sm text-muted hover:text-foreground select-none">
        Hidden ({count})
      </summary>
      <div className="space-y-4 mt-4 opacity-75">{children}</div>
    </details>
  );
}

export function ExplorerLink({ txid, label }: { txid: string; label: string }) {
  return (
    <a
      href={explorerTxUrl(txid)}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-faint hover:text-teal underline decoration-dotted"
      title={txid}
    >
      {label} ↗
    </a>
  );
}

export function AskCard({
  message,
  amountSompi,
  counterpartyLabel,
  counterpartyAddress,
  deadline,
  daaScore,
  status,
  resolvedAtMs = null,
  badge,
  footer,
  children,
}: {
  /** Decrypted plaintext, or null while locked/undecryptable. */
  message: string | null;
  amountSompi: string;
  counterpartyLabel: string;
  counterpartyAddress: string;
  deadline: string;
  daaScore: bigint | null;
  status: AskStatus;
  /** Epoch ms when the claim/refund was mined (settled cards, F10). */
  resolvedAtMs?: number | null;
  /** Extra chip(s) in the status row (e.g. the §4 escrow-verified badge). */
  badge?: ReactNode;
  /** Explorer links row. */
  footer?: ReactNode;
  /** Expanded content (reply box, reply text, actions). */
  children?: ReactNode;
}) {
  return (
    <article className="glass-clear rounded-xl p-5 space-y-4 animate-card-in">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {message !== null ? (
            <CollapsibleText text={message} className="text-[15px] leading-relaxed" />
          ) : (
            <p className="text-faint italic text-[15px]">encrypted message</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="amount text-xl font-bold">
            {formatKas(BigInt(amountSompi))}
            <span className="text-xs font-medium text-muted ml-1">TKAS</span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <StatusChip status={status} />
        {badge}
        {/* F10 precedence: terminal states never show a ticking countdown —
            deadline logic applies only while a reply is still possible. */}
        {status === "answered" || status === "refunded" ? (
          <ResolvedAgo resolvedAtMs={resolvedAtMs} />
        ) : (
          <Countdown deadline={deadline} daaScore={daaScore} />
        )}
        <span
          className="text-xs text-faint font-mono"
          title={counterpartyAddress}
        >
          {counterpartyLabel} {shortAddress(counterpartyAddress)}
        </span>
      </div>
      {children}
      {footer && (
        <div className="flex flex-wrap gap-3 pt-1 border-t border-border/60">
          {footer}
        </div>
      )}
    </article>
  );
}
