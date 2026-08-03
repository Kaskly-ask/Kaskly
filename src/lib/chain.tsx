"use client";
// Shared chain context: one lazy wRPC connection for the whole app (public
// TN10 nodes are flaky — connectRpc retries across resolver picks, finding
// F4) plus a polled virtual DAA score for countdowns and the deadline rules.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RpcClient } from "kaspa-wasm";
import { ensureKaspaReady } from "./kaspa-ready";
import { NETWORK_ID, WRPC_URL } from "./config";

const DAA_POLL_MS = 5000;

interface ChainContextValue {
  /** Lazily connects on first call; concurrent callers share one attempt. */
  getRpc: () => Promise<RpcClient>;
  rpcStatus: "idle" | "connecting" | "connected" | "error";
  rpcError: string | null;
  /** Current virtual DAA score, polled every few seconds once connected. */
  daaScore: bigint | null;
  retry: () => void;
}

const ChainContext = createContext<ChainContextValue | null>(null);

export function ChainProvider({ children }: { children: ReactNode }) {
  const rpcPromise = useRef<Promise<RpcClient> | null>(null);
  const [rpcStatus, setRpcStatus] =
    useState<ChainContextValue["rpcStatus"]>("idle");
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [daaScore, setDaaScore] = useState<bigint | null>(null);

  const getRpc = useCallback(() => {
    if (!rpcPromise.current) {
      setRpcStatus("connecting");
      setRpcError(null);
      rpcPromise.current = (async () => {
        await ensureKaspaReady();
        const { connectRpc } = await import("./ask");
        const rpc = await connectRpc({ networkId: NETWORK_ID, wrpcUrl: WRPC_URL });
        setRpcStatus("connected");
        return rpc;
      })().catch((e) => {
        rpcPromise.current = null;
        setRpcStatus("error");
        setRpcError(String((e as Error)?.message ?? e));
        throw e;
      });
    }
    return rpcPromise.current;
  }, []);

  const retry = useCallback(() => {
    rpcPromise.current = null;
    setRpcStatus("idle");
    setRpcError(null);
    void getRpc().catch(() => {});
  }, [getRpc]);

  // DAA clock: poll once connected. Screens convert to wall-clock with
  // DAA_PER_SECOND for display only; rules compare raw scores.
  useEffect(() => {
    if (rpcStatus !== "connected") return;
    let stop = false;
    const tick = async () => {
      try {
        const rpc = await getRpc();
        const { currentDaaScore } = await import("./ask");
        const score = await currentDaaScore(rpc);
        if (!stop) setDaaScore(score);
      } catch {
        /* transient poll failure — keep last value */
      }
    };
    void tick();
    const id = setInterval(tick, DAA_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [rpcStatus, getRpc]);

  return (
    <ChainContext.Provider value={{ getRpc, rpcStatus, rpcError, daaScore, retry }}>
      {children}
    </ChainContext.Provider>
  );
}

export function useChain(): ChainContextValue {
  const ctx = useContext(ChainContext);
  if (!ctx) throw new Error("useChain outside ChainProvider");
  return ctx;
}
