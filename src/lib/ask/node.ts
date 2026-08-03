// Node connectivity + the high-level ASK operations that touch the chain:
// createAsk (lock), discovery scanning, status derivation. (ASKSPEC §4, §7)
import {
  RpcClient,
  Resolver,
  Encoding,
  ConnectStrategy,
  createTransactions,
  type IUtxoEntry,
} from "kaspa-wasm";
import {
  ASK_PREFIX,
  encodeAskPayload,
  parseAskPayload,
  REFUND_FEE_ALLOWANCE,
  toHex,
  type AskEnvelope,
  type MessageEncoding,
} from "./protocol";
import { deriveAskCovenant } from "./covenant";
import { XOnlyPublicKey, Address } from "kaspa-wasm";

export interface NodeConfig {
  networkId: string;
  /** Optional pinned wRPC URL; otherwise the public-node resolver is used. */
  wrpcUrl?: string;
}

/** Connect with retry across resolver picks; validates the node is synced
 * and has a UTXO index (public TN10 nodes are flaky — finding F4). */
export async function connectRpc(config: NodeConfig): Promise<RpcClient> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const usePinned = !!config.wrpcUrl && attempt === 0;
    const rpc = usePinned
      ? new RpcClient({
          url: config.wrpcUrl,
          encoding: Encoding.Borsh,
          networkId: config.networkId,
        })
      : new RpcClient({
          resolver: new Resolver(),
          encoding: Encoding.Borsh,
          networkId: config.networkId,
        });
    try {
      await rpc.connect({
        strategy: ConnectStrategy.Fallback,
        timeoutDuration: 15000,
      });
      const info = await rpc.getServerInfo();
      if (!info.isSynced || !info.hasUtxoIndex) {
        throw new Error(
          `node unusable (synced=${info.isSynced}, utxoindex=${info.hasUtxoIndex})`
        );
      }
      return rpc;
    } catch (e) {
      lastErr = e;
      try {
        await rpc.disconnect();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr;
}

/** True only for a node-side transaction rejection; connection failures
 * must never be mistaken for chain rejections (finding F4 / R6). */
export function isChainRejection(e: unknown): boolean {
  const msg = String((e as Error)?.message ?? e);
  return (
    msg.includes("Rejected transaction") ||
    msg.includes("RPC Server (remote error)")
  );
}

export interface CreateAskParams {
  senderAddress: string;
  senderPrivateKeyHex: string;
  recipientAddress: string;
  amount: bigint;
  message: string;
  msgEnc: MessageEncoding;
  deadlineDaa: bigint;
}

export interface CreatedAsk {
  lockTxid: string;
  p2shAddress: string;
  redeemScriptHex: string;
  envelope: AskEnvelope;
  minRefund: bigint;
}

/** Recipient's x-only key derived from their address — Kasia's own trick
 * (their cipher/src/lib.rs): a schnorr address payload IS the x-only key. */
export function xOnlyFromAddress(address: string): string {
  const hex = XOnlyPublicKey.fromAddress(new Address(address)).toString();
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(`address does not carry an x-only schnorr key: ${address}`);
  }
  return hex;
}

/** A1 CREATE: lock funds under the ASK covenant; the SAME transaction
 * carries the ask envelope payload (discovery + covenant in one tx). */
export async function createAsk(
  rpc: RpcClient,
  networkId: string,
  params: CreateAskParams
): Promise<CreatedAsk> {
  if (params.amount <= REFUND_FEE_ALLOWANCE) {
    throw new Error("amount must exceed the refund fee allowance");
  }
  const minRefund = params.amount - REFUND_FEE_ALLOWANCE;
  const recipientXOnlyHex = xOnlyFromAddress(params.recipientAddress);
  const covenant = deriveAskCovenant(
    {
      recipientXOnlyHex,
      senderAddress: params.senderAddress,
      deadlineDaa: params.deadlineDaa,
      minRefund,
    },
    networkId
  );
  const envelope: AskEnvelope = {
    v: 1,
    sender: params.senderAddress,
    recipient: params.recipientAddress,
    deadlineDaa: params.deadlineDaa.toString(),
    minRefund: minRefund.toString(),
    msgEnc: params.msgEnc,
    message: params.message,
  };
  const payloadHex = encodeAskPayload(envelope);

  const { entries } = await rpc.getUtxosByAddresses({
    addresses: [params.senderAddress],
  });
  if (!entries.length) throw new Error("sender has no UTXOs");
  const { transactions } = await createTransactions({
    entries,
    outputs: [{ address: covenant.p2shAddress, amount: params.amount }],
    changeAddress: params.senderAddress,
    priorityFee: 0n,
    payload: payloadHex,
    networkId,
  });
  let lockTxid = "";
  for (const pending of transactions) {
    await pending.sign([params.senderPrivateKeyHex]);
    lockTxid = await pending.submit(rpc);
  }
  return {
    lockTxid,
    p2shAddress: covenant.p2shAddress,
    redeemScriptHex: covenant.redeemScriptHex,
    envelope,
    minRefund,
  };
}

export async function getCovenantUtxo(
  rpc: RpcClient,
  p2shAddress: string
): Promise<IUtxoEntry | null> {
  const { entries } = await rpc.getUtxosByAddresses({
    addresses: [p2shAddress],
  });
  return (entries[0] as unknown as IUtxoEntry) ?? null;
}

export async function currentDaaScore(rpc: RpcClient): Promise<bigint> {
  const dag = await rpc.getBlockDagInfo();
  return BigInt(dag.virtualDaaScore);
}

/** A2 NOTIFY / discovery: the block-firehose filter, same pattern Kasia
 * clients use. Calls `onPayload` for every ASK-namespace payload seen. */
export function startAskScanner(
  rpc: RpcClient,
  onPayload: (parsed: ReturnType<typeof parseAskPayload>, txid: string) => void,
  onMalformed?: (txid: string, error: string) => void
): () => Promise<void> {
  const prefixHex = toHex(new TextEncoder().encode(ASK_PREFIX));
  const listener = (event: { data?: { block?: { transactions?: Array<{ payload?: string; verboseData?: { transactionId?: string } }> } } }) => {
    const txs = event?.data?.block?.transactions ?? [];
    for (const tx of txs) {
      const payload: string = tx.payload ?? "";
      if (!payload.startsWith(prefixHex)) continue;
      const txid = tx.verboseData?.transactionId ?? "";
      try {
        const parsed = parseAskPayload(payload);
        if (parsed) onPayload(parsed, txid);
      } catch (e) {
        onMalformed?.(txid, String((e as Error).message ?? e));
      }
    }
  };
  rpc.addEventListener("block-added", listener);
  void rpc.subscribeBlockAdded();
  return async () => {
    rpc.removeEventListener("block-added", listener);
    await rpc.unsubscribeBlockAdded();
  };
}
