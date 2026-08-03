// Local plaintext notes (browser localStorage). On-chain, an ask message is
// encrypted TO THE RECIPIENT and a reply TO THE SENDER — the author cannot
// decrypt their own ciphertext later. Authors therefore keep their own
// plaintext locally, exactly like any encrypted messenger. Never sent to
// the server; loss of this store degrades display only (chain state and
// ciphertexts still rebuild everything else).

const KEY = "kaskly.notes.v1";

type Notes = Record<string, string>;

function load(): Notes {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Notes;
  } catch {
    return {};
  }
}

export function getNote(askRef: string, kind: "message" | "reply"): string | null {
  return load()[`${askRef}:${kind}`] ?? null;
}

export function setNote(
  askRef: string,
  kind: "message" | "reply",
  text: string
): void {
  const notes = load();
  notes[`${askRef}:${kind}`] = text;
  window.localStorage.setItem(KEY, JSON.stringify(notes));
}
