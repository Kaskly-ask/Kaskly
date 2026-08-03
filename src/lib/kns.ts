// KNS (.kas) name resolution — an OFF-CHAIN, trusted third-party REST
// service. Endpoint + response shape verified from Kasia's implementation
// (K-Kluster/Kasia src/service/integrations/kns-integration-service.ts,
// fetched 2026-08-03): GET {root}/{name}/owner → { success, data: { owner,
// asset, id } }, response asset must echo the queried name.
import { NETWORK_ID } from "./config";

const KNS_ROOTS: Record<string, string> = {
  "testnet-10": "https://api.knsdomains.org/tn10/api/v1",
};

export function isKnsName(input: string): boolean {
  return /^[a-z0-9-]+\.kas$/i.test(input.trim());
}

/** Resolve a .kas name to its owner address, or null if unregistered. */
export async function resolveKns(name: string): Promise<string | null> {
  const root = KNS_ROOTS[NETWORK_ID];
  if (!root) throw new Error(`KNS not supported on ${NETWORK_ID}`);
  const r = await fetch(`${root}/${encodeURIComponent(name)}/owner`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("KNS resolution failed");
  const data = (await r.json()) as {
    success?: boolean;
    data?: { owner?: string; asset?: string };
  };
  if (!data.success || !data.data?.owner) throw new Error("KNS: invalid response");
  if (data.data.asset !== name) throw new Error("KNS: response name mismatch");
  return data.data.owner;
}
