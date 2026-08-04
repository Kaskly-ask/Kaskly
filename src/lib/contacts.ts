"use client";
// Local contact labels (pre-beta QoL, 2026-08-05): a browser-private
// address→name map with the SAME privacy model as keys — localStorage
// only, never transmitted, no server, no protocol change. Backed by a
// tiny external store so every surface (cards, composer, panel) updates
// live when a name is saved. Names are display sugar: the address is
// always shown alongside (payments app — identity stays verifiable).
import { useSyncExternalStore } from "react";

const KEY = "kaskly.contacts.v1";
const EMPTY: Record<string, string> = {};

let cache: Record<string, string> | null = null;
const listeners = new Set<() => void>();

function load(): Record<string, string> {
  if (cache === null) {
    try {
      cache = JSON.parse(
        window.localStorage.getItem(KEY) ?? "{}"
      ) as Record<string, string>;
    } catch {
      cache = {};
    }
  }
  return cache;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Set (non-empty) or remove (empty/whitespace) a contact label. */
export function setContact(address: string, name: string): void {
  const next = { ...load() };
  const trimmed = name.trim().slice(0, 60);
  if (trimmed) next[address] = trimmed;
  else delete next[address];
  cache = next;
  window.localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

/** Live map of address→name. Hydration-safe (server snapshot is empty;
 * names appear right after mount). */
export function useContacts(): Record<string, string> {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}
