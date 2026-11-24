import type { Entry } from "../lib/perdas.ts";

export function pares(solas: number): number {
  if (solas <= 0) return 0;
  return Math.ceil(solas / 2);
}

export function paresDasEntradas(entries: Entry[]): number {
  return pares(entries.length);
}
