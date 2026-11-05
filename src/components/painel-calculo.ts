import { paresDasEntradas } from "./pares.ts";
import {
  MACHINES,
  PROBLEMS,
  STATIONS,
  maquinaBase,
  pad2,
  type Entry,
  type MachineId,
  type ProducaoPares,
  type Turno,
} from "../lib/perdas.ts";

export type PeriodoCalculo = "dia" | "semana" | "mes" | "ano";

type Faixa = "todos" | Turno;

export type ListasPeriodo = Record<PeriodoCalculo, Record<Faixa, Entry[]>>;

function listasVazias(): ListasPeriodo {
  const faixa = (): Record<Faixa, Entry[]> => ({ todos: [], "1": [], "2": [], "3": [] });
  return { dia: faixa(), semana: faixa(), mes: faixa(), ano: faixa() };
}

/** Uma passagem. A ordem de cada lista é a mesma de um filter sobre `base`. */
export function separarEntradas(
  base: Entry[],
  passa: (entry: Entry) => boolean,
  datas: Record<PeriodoCalculo, Set<string>>,
): { listas: ListasPeriodo; historico: Entry[] } {
  const listas = listasVazias();
  const historico: Entry[] = [];
  const periodos = ["dia", "semana", "mes", "ano"] as const;
  for (const entry of base) {
    if (!passa(entry)) continue;
    historico.push(entry);
    for (const periodo of periodos) {
      if (!datas[periodo].has(entry.date)) continue;
      listas[periodo].todos.push(entry);
      if (entry.turno === "1" || entry.turno === "2" || entry.turno === "3") {
        listas[periodo][entry.turno].push(entry);
      }
    }
  }
  return { listas, historico };
}

export function perdasPorProblema(entries: Entry[]) {
  const grupos = new Map<string, Entry[]>();
  for (const entry of entries) {
    const lista = grupos.get(entry.problem);
    if (lista) lista.push(entry);
    else grupos.set(entry.problem, [entry]);
  }
  return PROBLEMS.map((problem) => ({
    name: problem.name,
    id: problem.id,
    total: paresDasEntradas(grupos.get(problem.id) ?? []),
  }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}

export function perdasPorMaquina(entries: Entry[]) {
  const grupos = new Map<string, Entry[]>();
  for (const entry of entries) {
    const lista = grupos.get(entry.machine);
    if (lista) lista.push(entry);
    else grupos.set(entry.machine, [entry]);
  }
  return MACHINES.map((machine) => ({
    machine,
    total: paresDasEntradas(grupos.get(machine) ?? []),
  }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}

export function perdasPorEstacao(entries: Entry[]) {
  const grupos = new Map<number, Entry[]>();
  for (const entry of entries) {
    const lista = grupos.get(entry.station);
    if (lista) lista.push(entry);
    else grupos.set(entry.station, [entry]);
  }
  return STATIONS.map((station) => ({
    id: String(station),
    nome: `Estação ${pad2(station)}`,
    valor: paresDasEntradas(grupos.get(station) ?? []),
  }))
    .filter((item) => item.valor > 0)
    .sort((a, b) => b.valor - a.valor);
}

export function somarProducao(
  itens: ProducaoPares[],
  maquina: MachineId | null,
  pedidos: { id: string; datas: Set<string>; turno: Turno | null }[],
): Record<string, number> {
  const totais: Record<string, number> = {};
  for (const pedido of pedidos) totais[pedido.id] = 0;
  for (const item of itens) {
    if (item.pares <= 0) continue;
    if (
      maquina &&
      item.machine !== maquina &&
      maquinaBase(item.machine) !== maquina &&
      maquinaBase(maquina) !== item.machine
    ) {
      continue;
    }
    for (const pedido of pedidos) {
      if (!pedido.datas.has(item.date)) continue;
      if (pedido.turno && item.turno !== pedido.turno) continue;
      totais[pedido.id] = (totais[pedido.id] ?? 0) + item.pares;
    }
  }
  return totais;
}
