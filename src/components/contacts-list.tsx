"use client";
// Contacts list (wallet panel): every saved name with edit (inline, via
// ContactName), delete, and an "ask →" shortcut to the prefilled
// composer. Renders nothing until the first contact exists.
import Link from "next/link";
import { setContact, useContacts } from "@/lib/contacts";
import { ContactName } from "./contact-name";

export function ContactsList() {
  const contacts = useContacts();
  const entries = Object.entries(contacts).sort((a, b) =>
    a[1].localeCompare(b[1])
  );
  if (entries.length === 0) return null;

  return (
    <div className="space-y-1.5 pt-3 border-t border-white/10">
      <p className="text-[10px] uppercase tracking-widest text-faint">
        Contacts{" "}
        <span className="normal-case tracking-normal">
          — names live in this browser only, like your keys
        </span>
      </p>
      {entries.map(([addr, name]) => (
        <div key={addr} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="flex-1 min-w-0">
            <ContactName address={addr} />
          </span>
          <Link
            href={`/ask?to=${addr}`}
            className="text-teal hover:underline shrink-0"
          >
            ask →
          </Link>
          <button
            onClick={() => setContact(addr, "")}
            aria-label={`delete contact ${name}`}
            title="delete"
            className="text-faint hover:text-danger shrink-0"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
