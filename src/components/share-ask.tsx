"use client";
// "Share your Ask link" block (wallet panel, connected state): download
// the share card PNG, copy the Ask link, or copy a ready-to-paste post.
// The link is a URL (CANONICAL origin /ask?to=<address>), never a raw
// address — share artifacts are durable, so they always carry kaskly.app
// regardless of where they were generated (human decision 2026-08-05).
import { useEffect, useState } from "react";
import { CANONICAL_ORIGIN } from "@/lib/config";

export function ShareAsk({ address }: { address: string }) {
  const askUrl = `${CANONICAL_ORIGIN}/ask?to=${address}`;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live preview of the card — people should see what they'll post.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const { renderShareCard } = await import("@/lib/share-card");
        const blob = await renderShareCard(address, askUrl);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch {
        /* preview is optional; download will surface real errors */
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [askUrl, address]);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { renderShareCard } = await import("@/lib/share-card");
      const blob = await renderShareCard(address, askUrl);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kaskly-ask-card.png";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  // Workshopped 2026-08-05: excited-share energy, not solicitation — the
  // refund guarantee is the emotional center, "guaranteed by on-chain
  // math" the recurring hook.
  const posts = [
    `Hey everyone — I'm on Kaskly now! Send me questions and I'll reply, or your money back, guaranteed by on-chain math: ${askUrl}`,
    `This is cool — you can now ask me anything on Kaskly! Attach some KAS to your question: I answer, I earn it. I go silent, you get every cent back automatically. No trust needed, just math: ${askUrl}`,
    `Ask me anything on Kaskly. An answer or your refund — the chain enforces it: ${askUrl}`,
  ];

  return (
    <div className="space-y-3 pt-3 border-t border-white/10">
      <p className="text-xs text-muted">
        Share your Ask link — anyone who opens it lands in the composer
        with your address prefilled.
      </p>
      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt="Preview of your Kaskly share card"
          className="w-full max-w-sm rounded-lg border border-white/10"
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={download}
          disabled={busy}
          className="px-3 py-1.5 rounded-md bg-teal text-background font-medium text-xs disabled:opacity-50"
        >
          {busy ? "Rendering…" : "Download share card"}
        </button>
        <button
          onClick={() => copy("link", askUrl)}
          className="text-xs text-teal hover:underline"
        >
          {copied === "link" ? "copied!" : "copy my Ask link"}
        </button>
      </div>
      {error && <p className="text-danger text-xs">{error}</p>}
      <div className="space-y-1.5">
        <p className="text-[10px] uppercase tracking-widest text-faint">
          Ready to paste
        </p>
        {posts.map((p, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-xs text-muted bg-card-raised rounded-md px-3 py-2"
          >
            <span className="flex-1 break-words">{p}</span>
            <button
              onClick={() => copy(`post${i}`, p)}
              className="shrink-0 text-teal hover:underline"
            >
              {copied === `post${i}` ? "copied!" : "copy"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
