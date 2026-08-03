// Browser-side ask store. Every status shown in the UI is DERIVED FROM
// CHAIN STATE here (brief §3.3 — the DB is a cache; ASKSPEC §7 defines the
// derivation); the cache API only makes lists survive reloads. This module
// also carries the two NORMATIVE client rules of ASKSPEC §8:
//   1. anyone-can-trigger refund is auto-broadcast once the deadline passes
//      (maybeAutoRefund — called by BOTH sender and recipient screens);
//   2. claim construction is refused once currentDaa >= deadline
//      (claimAsk throws DeadlinePassedError before touching the covenant).
import type { RpcClient } from "kaspa-wasm";
import { type AskRecordDto, type AskStatus, validateAskRecord } from "./ask-record";
import { NETWORK_ID, REST_API_BASE } from "./config";

export class DeadlinePassedError extends Error {
  constructor() {
    super("deadline passed — funds have been returned to the sender");
  }
}

// ---------- cache API (public chain data only; keys never leave here) ----

export async function fetchCachedAsks(
  address: string
): Promise<{ sent: AskRecordDto[]; received: AskRecordDto[] }> {
  const r = await fetch(`/api/asks?address=${encodeURIComponent(address)}`);
  if (!r.ok) throw new Error(`cache read failed (HTTP ${r.status})`);
  return r.json();
}

export async function cacheAsk(record: AskRecordDto): Promise<void> {
  const r = await fetch("/api/asks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!r.ok) throw new Error(`cache write failed (HTTP ${r.status})`);
}

export async function clearCache(): Promise<void> {
  const r = await fetch("/api/asks", { method: "DELETE" });
  if (!r.ok) throw new Error(`cache clear failed (HTTP ${r.status})`);
}

// ---------- REST (spending-tx lookup; endpoint shape verified against the
// Phase 2 refund lifecycle on TN10, 2026-08-03 — see PROGRESS.md) ---------

interface RestTxLite {
  transaction_id: string;
  payload: string | null;
  is_accepted?: boolean;
  outputs: Array<{
    index: number;
    amount: number | string;
    script_public_key_address: string;
  }>;
  inputs: Array<{
    previous_outpoint_hash?: string;
    previous_outpoint_address?: string | null;
  }> | null;
}

async function restGet<T>(path: string, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${REST_API_BASE}${path}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as T;
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

// ---------- covenant reconstruction (ASKSPEC §3/§4) ----------------------

export interface CovenantView {
  redeemScriptHex: string;
  p2shAddress: string;
  minRefund: bigint;
}

/** Rebuild the covenant purely from the announced/cached parameters —
 * the §4 verification predicate is "does THIS reproduce the funded P2SH". */
export async function covenantFor(record: {
  senderAddress: string;
  recipientAddress: string;
  amountSompi: string;
  deadline: string;
}): Promise<CovenantView> {
  const { deriveAskCovenant, xOnlyFromAddress, REFUND_FEE_ALLOWANCE } =
    await import("./ask");
  const minRefund = BigInt(record.amountSompi) - REFUND_FEE_ALLOWANCE;
  if (minRefund <= 0n) throw new Error("amount below refund fee allowance");
  const cov = deriveAskCovenant(
    {
      recipientXOnlyHex: xOnlyFromAddress(record.recipientAddress),
      senderAddress: record.senderAddress,
      deadlineDaa: BigInt(record.deadline),
      minRefund,
    },
    NETWORK_ID
  );
  return { ...cov, minRefund };
}

// ---------- chain-derived status (ASKSPEC §7) ----------------------------

export interface DerivedState {
  /** §4: announced parameters reproduce the P2SH the lock tx funded. */
  verified: boolean;
  status: AskStatus;
  claimTxid: string | null;
  refundTxid: string | null;
  /** kasia1 reply ciphertext from the claim tx payload, when answered. */
  replyCiphertext: string | null;
}

export async function deriveStatusFromChain(
  rpc: RpcClient,
  record: AskRecordDto
): Promise<DerivedState> {
  const cov = await covenantFor(record);
  const { getCovenantUtxo, currentDaaScore, parseAskPayload } = await import(
    "./ask"
  );

  const utxo = await getCovenantUtxo(rpc, cov.p2shAddress);
  if (utxo) {
    const outpoint = utxo.outpoint as { transactionId: string };
    const verified =
      outpoint.transactionId === record.lockTxid &&
      BigInt(utxo.amount) === BigInt(record.amountSompi);
    const daa = await currentDaaScore(rpc);
    return {
      verified,
      status:
        daa >= BigInt(record.deadline) ? "expired_pending_refund" : "open",
      claimTxid: null,
      refundTxid: null,
      replyCiphertext: null,
    };
  }

  // Covenant address has no UTXO: either spent (answered/refunded) or the
  // announcement never matched a funded escrow (§4 → malformed).
  const hist = await restGet<RestTxLite[]>(
    `/addresses/${encodeURIComponent(cov.p2shAddress)}/full-transactions?limit=50&resolve_previous_outpoints=light`
  );
  const funded = hist.some(
    (tx) =>
      tx.transaction_id === record.lockTxid &&
      tx.outputs.some(
        (o) =>
          o.script_public_key_address === cov.p2shAddress &&
          BigInt(o.amount) === BigInt(record.amountSompi)
      )
  );
  const spender = hist.find((tx) =>
    (tx.inputs ?? []).some(
      (i) => i.previous_outpoint_address === cov.p2shAddress
    )
  );
  if (!funded || !spender) {
    // Not funded → announcement is malformed per §4; funded-but-no-spender
    // should not happen once the UTXO is gone — surface as unverified.
    return {
      verified: false,
      status: record.status,
      claimTxid: record.claimTxid,
      refundTxid: record.refundTxid,
      replyCiphertext: null,
    };
  }
  // Classify the spend: a claim carries a reply payload referencing us.
  try {
    const parsed = spender.payload ? parseAskPayload(spender.payload) : null;
    if (
      parsed?.kind === "reply" &&
      parsed.envelope.ref.toLowerCase() === record.lockTxid.toLowerCase()
    ) {
      return {
        verified: true,
        status: "answered",
        claimTxid: spender.transaction_id,
        refundTxid: null,
        replyCiphertext: parsed.envelope.message,
      };
    }
  } catch {
    /* malformed payload on the spender — treat as non-reply spend */
  }
  return {
    verified: true,
    status: "refunded",
    claimTxid: null,
    refundTxid: spender.transaction_id,
    replyCiphertext: null,
  };
}

// ---------- actions ------------------------------------------------------

export interface SendAskParams {
  senderAddress: string;
  senderPrivateKeyHex: string;
  recipientAddress: string;
  amountSompi: bigint;
  message: string;
  deadlineDaa: bigint;
}

/** A1 CREATE from the compose screen; caches the resulting record. */
export async function sendAsk(
  rpc: RpcClient,
  params: SendAskParams
): Promise<AskRecordDto> {
  const { createAsk } = await import("./ask");
  const created = await createAsk(rpc, NETWORK_ID, {
    senderAddress: params.senderAddress,
    senderPrivateKeyHex: params.senderPrivateKeyHex,
    recipientAddress: params.recipientAddress,
    amount: params.amountSompi,
    message: params.message,
    deadlineDaa: params.deadlineDaa,
  });
  const record = validateAskRecord({
    askRef: created.lockTxid,
    senderAddress: params.senderAddress,
    recipientAddress: params.recipientAddress,
    amountSompi: params.amountSompi.toString(),
    messageCiphertext: created.envelope.message,
    deadline: params.deadlineDaa.toString(),
    lockTxid: created.lockTxid,
    claimTxid: null,
    refundTxid: null,
    status: "open",
  } satisfies AskRecordDto);
  await cacheAsk(record);
  return record;
}

/** A3 CLAIM-BY-REPLY. Enforces normative rule 2 (refuse late construction)
 * BEFORE building anything. Returns the claim txid. */
export async function claimAsk(
  rpc: RpcClient,
  record: AskRecordDto,
  recipientPrivateKeyHex: string,
  replyText: string
): Promise<string> {
  const { currentDaaScore, getCovenantUtxo, buildClaimTransaction } =
    await import("./ask");
  const daa = await currentDaaScore(rpc);
  if (daa >= BigInt(record.deadline)) throw new DeadlinePassedError();
  const cov = await covenantFor(record);
  const utxo = await getCovenantUtxo(rpc, cov.p2shAddress);
  if (!utxo) {
    throw new Error("this Ask is no longer claimable (already claimed or refunded)");
  }
  const tx = buildClaimTransaction({
    covenantUtxo: utxo,
    redeemScriptHex: cov.redeemScriptHex,
    recipientAddress: record.recipientAddress,
    recipientPrivateKeyHex,
    lockTxid: record.lockTxid,
    replyText,
    senderAddress: record.senderAddress,
  });
  const { transactionId } = await rpc.submitTransaction({ transaction: tx });
  await cacheAsk({ ...record, status: "answered", claimTxid: transactionId });
  return transactionId;
}

/** Normative rule 1: broadcast the sig-less refund for any Ask past its
 * deadline. Safe for ANYONE to call (covenant pins destination+amount).
 * Returns the refund txid, or null if someone else already closed it. */
export async function maybeAutoRefund(
  rpc: RpcClient,
  record: AskRecordDto
): Promise<string | null> {
  const { getCovenantUtxo, buildRefundTransaction, isChainRejection } =
    await import("./ask");
  const cov = await covenantFor(record);
  const utxo = await getCovenantUtxo(rpc, cov.p2shAddress);
  if (!utxo) return null; // already claimed or refunded
  const tx = buildRefundTransaction({
    covenantUtxo: utxo,
    redeemScriptHex: cov.redeemScriptHex,
    senderAddress: record.senderAddress,
    deadlineDaa: BigInt(record.deadline),
    minRefund: cov.minRefund,
  });
  try {
    const { transactionId } = await rpc.submitTransaction({ transaction: tx });
    await cacheAsk({ ...record, status: "refunded", refundTxid: transactionId });
    return transactionId;
  } catch (e) {
    // A racing watcher may have refunded first (double-spend rejection) —
    // that is success for the protocol; re-derivation will settle status.
    if (isChainRejection(e)) return null;
    throw e;
  }
}

/** Decrypt a kasia1 ciphertext with the wallet key, for display only. */
export async function decryptForDisplay(
  ciphertextHex: string,
  privateKeyHex: string
): Promise<string> {
  const { decryptKasia1 } = await import("./ask");
  return decryptKasia1(ciphertextHex, privateKeyHex);
}
