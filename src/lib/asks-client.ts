// Browser-side ask store. Every status shown in the UI is DERIVED FROM
// CHAIN STATE here (brief Â§3.3 â€” the DB is a cache; ASKSPEC Â§7 defines the
// derivation); the cache API only makes lists survive reloads. This module
// also carries the two NORMATIVE client rules of ASKSPEC Â§8:
//   1. anyone-can-trigger refund is auto-broadcast once the deadline passes
//      (maybeAutoRefund â€” called by BOTH sender and recipient screens);
//   2. claim construction is refused once currentDaa >= deadline
//      (claimAsk throws DeadlinePassedError before touching the covenant).
import type { RpcClient } from "kaspa-wasm";
import {
  type AskRecordDto,
  type AskStatus,
  type ProtocolVersion,
  validateAskRecord,
} from "./ask-record";
import { NETWORK_ID, REST_API_BASE } from "./config";

export class DeadlinePassedError extends Error {
  constructor() {
    super("deadline passed â€” funds have been returned to the sender");
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

export async function clearCache(address: string): Promise<void> {
  const r = await fetch(`/api/asks?address=${encodeURIComponent(address)}`, {
    method: "DELETE",
  });
  if (!r.ok) throw new Error(`cache clear failed (HTTP ${r.status})`);
}

// ---------- REST (spending-tx lookup; endpoint shape verified against the
// Phase 2 refund lifecycle on TN10, 2026-08-03 â€” see PROGRESS.md) ---------

interface RestTxLite {
  transaction_id: string;
  payload: string | null;
  is_accepted?: boolean;
  /** Epoch milliseconds (verified on TN10 2026-08-04). */
  block_time?: number;
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

// ---------- covenant reconstruction (ASKSPEC Â§3/Â§4) ----------------------

export interface CovenantView {
  redeemScriptHex: string;
  p2shAddress: string;
  minRefund: bigint;
}

/** Rebuild the covenant purely from the announced/cached parameters â€”
 * the Â§4 verification predicate is "does THIS reproduce the funded P2SH". */
export async function covenantFor(record: {
  senderAddress: string;
  recipientAddress: string;
  amountSompi: string;
  deadline: string;
  protocolVersion?: ProtocolVersion;
  askId?: string | null;
  refundAllowance?: string | null;
}): Promise<CovenantView> {
  // V3 (protocol v2): the covenant is derived from the per-Ask askId and
  // allowance, NOT from the V2 fixed-allowance arithmetic. Routing a V3
  // record through the V2 derivation produces the WRONG P2SH, so §4 fails,
  // the row is filtered from both screens, and maybeAutoRefund no-ops
  // against an address that was never funded.
  if (record.protocolVersion === 2) {
    const { deriveAskCovenantV3, xOnlyFromAddress } = await import("./ask");
    if (!record.askId || !record.refundAllowance) {
      throw new Error("v2-protocol record is missing askId/refundAllowance");
    }
    const allowance = BigInt(record.refundAllowance);
    const cov = deriveAskCovenantV3(
      {
        recipientXOnlyHex: xOnlyFromAddress(record.recipientAddress),
        senderAddress: record.senderAddress,
        deadlineDaa: BigInt(record.deadline),
        askIdHex: record.askId,
        refundAllowance: allowance,
      },
      NETWORK_ID
    );
    // The V3 floor is (funded input − allowance); minRefund is the same
    // quantity expressed against the announced amount.
    return { ...cov, minRefund: BigInt(record.amountSompi) - allowance };
  }

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

// ---------- chain-derived status (ASKSPEC Â§7) ----------------------------

export interface DerivedState {
  /** Â§4: announced parameters reproduce the P2SH the lock tx funded. */
  verified: boolean;
  status: AskStatus;
  claimTxid: string | null;
  refundTxid: string | null;
  /** kasia1 reply ciphertext from the claim tx payload, when answered. */
  replyCiphertext: string | null;
  /** Net sompi the recipient received from the claim tx (sum of its
   * outputs paying the recipient) â€” chain-derived, feeds "Earned". */
  claimNetSompi: string | null;
  /** When the resolving tx (claim or refund) was mined, epoch ms â€” feeds
   * "answered/refunded Xm ago" (F10: settled cards show resolution time,
   * never a ticking countdown). */
  resolvedAtMs: number | null;
}

export async function deriveStatusFromChain(
  rpc: RpcClient,
  record: AskRecordDto
): Promise<DerivedState> {
  const cov = await covenantFor(record);
  const { getCovenantUtxo, currentDaaScore, parseAskPayload, parseAskPayloadV3 } =
    await import("./ask");

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
      claimNetSompi: null,
      resolvedAtMs: null,
    };
  }

  // Covenant address has no UTXO: either spent (answered/refunded) or the
  // announcement never matched a funded escrow (Â§4 â†’ malformed).
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
    // Not funded â†’ announcement is malformed per Â§4; funded-but-no-spender
    // should not happen once the UTXO is gone â€” surface as unverified.
    return {
      verified: false,
      status: record.status,
      claimTxid: record.claimTxid,
      refundTxid: record.refundTxid,
      replyCiphertext: null,
      claimNetSompi: null,
      resolvedAtMs: null,
    };
  }
  // Classify the spend: a claim carries a reply payload referencing us.
  try {
    // Try V3 first (its parser returns null for anything that is not V3),
    // then V2. Before the wiring this read V2 ONLY, so a genuine V3 reply
    // was classified claimed_unreadable and the reply never surfaced —
    // the money was correctly reported gone, but the answer the sender
    // paid for was invisible.
    const parsed = spender.payload
      ? (parseAskPayloadV3(spender.payload) ?? parseAskPayload(spender.payload))
      : null;
    if (
      parsed?.kind === "reply" &&
      parsed.envelope.ref.toLowerCase() === record.lockTxid.toLowerCase()
    ) {
      const claimNet = spender.outputs
        .filter((o) => o.script_public_key_address === record.recipientAddress)
        .reduce((sum, o) => sum + BigInt(o.amount), 0n);
      return {
        verified: true,
        status: "answered",
        claimTxid: spender.transaction_id,
        refundTxid: null,
        replyCiphertext: parsed.envelope.message,
        claimNetSompi: claimNet.toString(),
        resolvedAtMs: spender.block_time ?? null,
      };
    }
  } catch {
    /* malformed payload on the spender — NOT evidence of a refund (F14) */
  }

  // --- F14: classify "refunded" ONLY on a POSITIVE test ----------------
  // The old code fell through to `refunded` whenever the payload was not a
  // matching reply — including when parsing THREW. A recipient could
  // therefore claim with a valid header and a garbage body and the
  // sender's UI would report "No reply came. Every sompi is back in your
  // wallet." while the money went to the recipient. Rebuild-from-chain
  // reproduced the lie, so the designated recovery action confirmed it.
  //
  // A genuine refund is trivially recognisable, because the covenant pins
  // its shape: exactly ONE output, paying the sender's address, of at
  // least minRefund. Anything else that spent the covenant is a claim we
  // could not read — a distinct terminal state, never silently a refund.
  //
  // Timing note: ASKSPEC §7 also says "after deadline". We do not re-check
  // that here because the covenant's refund branch carries
  // OpCheckLockTimeVerify(deadline) — consensus already refused any refund
  // before it. The REST record exposes block_time (wall clock), which is
  // not comparable to a DAA-score deadline, so testing it here would be
  // theatre rather than verification.
  const outs = spender.outputs ?? [];
  const paysSenderOnly =
    outs.length === 1 &&
    outs[0].script_public_key_address === record.senderAddress &&
    BigInt(outs[0].amount) >= cov.minRefund;

  if (paysSenderOnly) {
    return {
      verified: true,
      status: "refunded",
      claimTxid: null,
      refundTxid: spender.transaction_id,
      replyCiphertext: null,
      claimNetSompi: null,
      resolvedAtMs: spender.block_time ?? null,
    };
  }

  // Spent, but neither a verifiable reply nor a well-formed refund. The
  // money moved and we must say so plainly rather than guess.
  const claimNet = outs
    .filter((o) => o.script_public_key_address === record.recipientAddress)
    .reduce((sum, o) => sum + BigInt(o.amount), 0n);
  return {
    verified: true,
    status: "claimed_unreadable",
    claimTxid: spender.transaction_id,
    refundTxid: null,
    replyCiphertext: null,
    claimNetSompi: claimNet > 0n ? claimNet.toString() : null,
    resolvedAtMs: spender.block_time ?? null,
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
  // THE CLIENT NOW CREATES V3. Until 2026-08-06 this called `createAsk`
  // (V2), so F12/F13/F21/F22 were live in production while the audit
  // ledger recorded them fixed — the V3 modules existed but nothing
  // reached them. tests/unit/v3-reachability.test.ts asserts this call.
  const { prepareAskV3, createAskV3, currentDaaScore } = await import("./ask");
  const { payToAddressScript } = await import("kaspa-wasm");
  const currentDaa = await currentDaaScore(rpc);
  const prepared = prepareAskV3({
    networkId: NETWORK_ID,
    senderAddress: params.senderAddress,
    recipientAddress: params.recipientAddress,
    amount: params.amountSompi,
    message: params.message,
    deadlineDaa: params.deadlineDaa,
    // F24: the guards are mandatory and run BEFORE the covenant exists.
    currentDaa,
    utxoTemplate: (amount: bigint) =>
      ({
        address: params.senderAddress,
        outpoint: { transactionId: "aa".repeat(32), index: 0 },
        amount,
        scriptPublicKey: payToAddressScript(params.senderAddress),
        blockDaaScore: 1n,
        isCoinbase: false,
      }) as unknown as Parameters<typeof prepareAskV3>[0]["utxoTemplate"] extends (
        a: bigint
      ) => infer U
        ? U
        : never,
  });
  const created = await createAskV3(rpc, prepared, {
    networkId: NETWORK_ID,
    senderAddress: params.senderAddress,
    senderPrivateKeyHex: params.senderPrivateKeyHex,
    amount: params.amountSompi,
  });
  const record = validateAskRecord({
    askRef: created.lockTxid,
    protocolVersion: 2,
    askId: created.askIdHex,
    refundAllowance: created.refundAllowance.toString(),
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

/** Estimate the claim fee/net for a reply BEFORE claiming â€” used by the
 * reply box UI. Builds a size-identical synthetic transaction (fabricated
 * outpoint, placeholder ciphertext of the exact encrypted length) and runs
 * the same mass-based quote the real claim uses. No network access. */
export async function estimateReplyClaim(
  record: AskRecordDto,
  replyText: string
): Promise<{ fee: bigint; net: bigint }> {
  const { quoteClaimFee, encodeReplyPayload } = await import("./ask");
  const { payToAddressScript } = await import("kaspa-wasm");
  const cov = await covenantFor(record);
  const plaintextBytes = new TextEncoder().encode(replyText).length;
  // kasia1 blob = nonce(12) + ephemeral(33) + ciphertext(P) + tag(16).
  const payloadHex = encodeReplyPayload({
    v: 1,
    ref: "0".repeat(64),
    msgEnc: "kasia1",
    message: "00".repeat(plaintextBytes + 61),
  });
  const spk = payToAddressScript(cov.p2shAddress).toJSON() as unknown as {
    version: number;
    script: string;
  };
  return quoteClaimFee({
    networkId: NETWORK_ID,
    covenantUtxo: {
      outpoint: { transactionId: "0".repeat(64), index: 0 },
      amount: BigInt(record.amountSompi),
      scriptPublicKey: { version: spk.version, script: spk.script },
      blockDaaScore: 0n,
      isCoinbase: false,
    },
    redeemScriptHex: cov.redeemScriptHex,
    recipientAddress: record.recipientAddress,
    payloadHex,
  });
}

/** A3 CLAIM-BY-REPLY. Enforces normative rule 2 (refuse late construction)
 * BEFORE building anything. Fee scales with transaction mass (F7).
 * Returns the claim txid and the amount actually netted. */
export async function claimAsk(
  rpc: RpcClient,
  record: AskRecordDto,
  recipientPrivateKeyHex: string,
  replyText: string
): Promise<{ claimTxid: string; net: bigint }> {
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
    networkId: NETWORK_ID,
    covenantUtxo: utxo,
    redeemScriptHex: cov.redeemScriptHex,
    recipientAddress: record.recipientAddress,
    recipientPrivateKeyHex,
    lockTxid: record.lockTxid,
    replyText,
    senderAddress: record.senderAddress,
  });
  const net = BigInt(tx.outputs[0].value);
  let transactionId: string;
  try {
    ({ transactionId } = await rpc.submitTransaction({ transaction: tx }));
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // Backstop for any residual fee-floor rejection (should be prevented
    // by quoteClaimFee): translate the node's raw message (F7).
    if (/under the required amount|transient mass/i.test(msg)) {
      throw new Error(
        "The network requires a larger fee for a reply this size â€” try shortening your reply."
      );
    }
    throw e;
  }
  await cacheAsk({ ...record, status: "answered", claimTxid: transactionId });
  return { claimTxid: transactionId, net };
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
    // A racing watcher may have refunded first (double-spend rejection) â€”
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
