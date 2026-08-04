"use client";
// The Ask card — the hero object (brief §5): message-first, amount as a
// bold tabular figure, countdown always visible. Message/reply text renders
// through React text nodes only (XSS-inert by construction — never
// dangerouslySetInnerHTML).
import { useState, type ReactNode } from "react";
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

export function Countdown({
  deadline,
  daaScore,
}: {
  deadline: string;
  daaScore: bigint | null;
}) {
  if (daaScore === null) {
    return <span className="text-faint text-xs">countdown syncing…</span>;
  }
  const remainingDaa = BigInt(deadline) - daaScore;
  if (remainingDaa <= 0n) {
    return <span className="text-warn text-xs">deadline passed</span>;
  }
  const secs = Number(remainingDaa / DAA_PER_SECOND);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const text =
    d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  return (
    <span className="text-teal text-xs amount" title={`deadline at DAA score ${deadline}`}>
      {text} left
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
  /** Extra chip(s) in the status row (e.g. the §4 escrow-verified badge). */
  badge?: ReactNode;
  /** Explorer links row. */
  footer?: ReactNode;
  /** Expanded content (reply box, reply text, actions). */
  children?: ReactNode;
}) {
  return (
    <article className="bg-card border border-border rounded-xl p-5 space-y-4">
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
        <Countdown deadline={deadline} daaScore={daaScore} />
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
