import type { Entry } from "@/lib/perdas";

export function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function percentualPerda(perdas: number, producao: number) {
  const base = perdas + producao;
  if (base <= 0) return null;
  return (perdas / base) * 100;
}

export function textoPercentual(valor: number | null) {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function pares(solas: number): number {
  if (solas <= 0) return 0;
  return Math.ceil(solas / 2);
}

export function paresDasEntradas(entries: Entry[]): number {
  const grupos = new Map<string, number>();
  for (const entry of entries) {
    const chave = `${entry.date}|${entry.turno}|${entry.machine}|${entry.station}|${entry.side}|${entry.problem}|${entry.outroId}`;
    grupos.set(chave, (grupos.get(chave) ?? 0) + 1);
  }
  let total = 0;
  for (const solas of grupos.values()) total += pares(solas);
  return total;
}
