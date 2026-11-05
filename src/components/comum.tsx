import { pares, paresDasEntradas } from "@/components/pares";

export { pares, paresDasEntradas };

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
