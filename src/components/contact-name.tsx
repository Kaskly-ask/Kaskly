"use client";
// Inline contact display + naming (feels like naming a chat, not editing
// a database). Named: the name leads, the truncated address stays beside
// it in muted mono — NEVER hidden, this is a payments app. Unnamed: the
// truncated address with a quiet ✎ affordance.
import { useState } from "react";
import { setContact, useContacts } from "@/lib/contacts";
import { shortAddress } from "@/lib/config";

export function ContactName({
  address,
  editable = true,
}: {
  address: string;
  editable?: boolean;
}) {
  const contacts = useContacts();
  const name = contacts[address];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (editing) {
    const save = () => {
      setContact(address, draft);
      setEditing(false);
    };
    return (
      <span className="inline-flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={save}
          placeholder="name this contact"
          className="bg-card-raised border border-teal/40 rounded px-1.5 py-0.5 text-xs w-36 focus:outline-none"
        />
        <span className="font-mono text-muted text-[10px]" title={address}>
          {shortAddress(address)}
        </span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0">
      {name ? (
        <>
          <span className="text-muted">{name}</span>
          <span className="font-mono text-muted text-[10px]" title={address}>
            {shortAddress(address)}
          </span>
        </>
      ) : (
        <span className="font-mono" title={address}>
          {shortAddress(address)}
        </span>
      )}
      {editable && (
        <button
          onClick={() => {
            setDraft(name ?? "");
            setEditing(true);
          }}
          aria-label={name ? `rename ${name}` : "name this contact"}
          title={name ? "rename" : "name this contact"}
          className="text-faint hover:text-teal text-[11px] leading-none"
        >
          ✎
        </button>
      )}
    </span>
  );
}
