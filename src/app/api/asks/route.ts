// Cache API (brief §3.3): the DB behind this route is an index only. The
// browser does all chain work and all key work (D4); it posts derived,
// PUBLIC chain data here so lists survive reloads. Nothing secret ever
// transits this API: ciphertexts, addresses, txids, statuses only.
import { NextRequest, NextResponse } from "next/server";
import {
  clearAsksForAddress,
  listAsksForAddress,
  upsertAsk,
  validateAskRecord,
} from "@/lib/repo";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }
  return NextResponse.json(await listAsksForAddress(address));
}

export async function POST(req: NextRequest) {
  let dto;
  try {
    dto = validateAskRecord(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: String((e as Error).message ?? e) },
      { status: 400 }
    );
  }
  return NextResponse.json(await upsertAsk(dto));
}

/** Drop ONE address's cache rows. The UI's "rebuild from chain" action
 * calls this first, then repopulates purely from chain state — proving
 * the DB is disposable. Address-scoped so a rebuild on a shared server
 * never touches other users' rows (beta hardening). */
export async function DELETE(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address required" }, { status: 400 });
  }
  const deleted = await clearAsksForAddress(address);
  return NextResponse.json({ deleted });
}
