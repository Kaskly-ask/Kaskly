// Repository layer over the cache DB (brief §3.3, T2). Statuses are strings
// in SQLite; validation lives in the shared ask-record module.
import { prisma } from "./db";
import { type AskRecordDto, type AskStatus } from "./ask-record";

export { ASK_STATUSES, validateAskRecord } from "./ask-record";
export type { AskRecordDto, AskStatus };

interface AskRow {
  askRef: string;
  senderAddress: string;
  recipientAddress: string;
  amountSompi: bigint;
  messageCiphertextOrText: string;
  deadline: bigint;
  lockTxid: string;
  claimTxid: string | null;
  refundTxid: string | null;
  status: string;
}

function toDto(row: AskRow): AskRecordDto {
  return {
    askRef: row.askRef,
    senderAddress: row.senderAddress,
    recipientAddress: row.recipientAddress,
    amountSompi: row.amountSompi.toString(),
    messageCiphertext: row.messageCiphertextOrText,
    deadline: row.deadline.toString(),
    lockTxid: row.lockTxid,
    claimTxid: row.claimTxid,
    refundTxid: row.refundTxid,
    status: row.status as AskStatus,
  };
}

/** Insert-or-update by askRef (the lock txid). Idempotent: re-seeing the
 * same ask from the chain converges to the same row. */
export async function upsertAsk(dto: AskRecordDto): Promise<AskRecordDto> {
  const data = {
    senderAddress: dto.senderAddress,
    recipientAddress: dto.recipientAddress,
    amountSompi: BigInt(dto.amountSompi),
    messageCiphertextOrText: dto.messageCiphertext,
    deadline: BigInt(dto.deadline),
    lockTxid: dto.lockTxid,
    claimTxid: dto.claimTxid,
    refundTxid: dto.refundTxid,
    status: dto.status,
  };
  const row = await prisma.ask.upsert({
    where: { askRef: dto.askRef },
    create: { askRef: dto.askRef, ...data },
    update: data,
  });
  return toDto(row);
}

export async function listAsksForAddress(
  address: string
): Promise<{ sent: AskRecordDto[]; received: AskRecordDto[] }> {
  const [sent, received] = await Promise.all([
    prisma.ask.findMany({
      where: { senderAddress: address },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ask.findMany({
      where: { recipientAddress: address },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { sent: sent.map(toDto), received: received.map(toDto) };
}

/** Drop the whole cache — used by the rebuild-from-chain check (§3.3). */
export async function clearAsks(): Promise<number> {
  const { count } = await prisma.ask.deleteMany({});
  return count;
}
