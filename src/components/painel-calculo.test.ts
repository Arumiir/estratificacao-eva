import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paresDasEntradas } from "./pares.ts";
import {
  perdasPorEstacao,
  perdasPorMaquina,
  perdasPorProblema,
  separarEntradas,
  somarProducao,
  type PeriodoCalculo,
} from "./painel-calculo.ts";
import { MACHINES, PROBLEMS, STATIONS, maquinaBase, type Entry, type MachineId, type ProducaoPares, type Turno } from "../lib/perdas.ts";

const PERIODOS: PeriodoCalculo[] = ["dia", "semana", "mes", "ano"];
const TURNOS: Turno[] = ["1", "2", "3"];

function entrada(parcial: Partial<Entry> & Pick<Entry, "id" | "date" | "turno" | "machine" | "problem">): Entry {
  return {
    station: 1,
    side: "esq",
    at: 1,
    matrizNumero: "33/4",
    matrizRel: "1",
    autor: "",
    outroId: "",
    corId: "",
    corNome: "",
    ...parcial,
  };
}

function legadoListas(
  base: Entry[],
  passa: (entry: Entry) => boolean,
  datas: Record<PeriodoCalculo, Set<string>>,
) {
  function de(periodo: PeriodoCalculo, turno: Turno | null) {
    return base.filter((entry) => datas[periodo].has(entry.date) && (!turno || entry.turno === turno) && passa(entry));
  }
  return { de, historico: base.filter(passa) };
}

function legadoProblemas(entries: Entry[]) {
  return PROBLEMS.map((problem) => ({
    name: problem.name,
    id: problem.id,
    total: paresDasEntradas(entries.filter((entry) => entry.problem === problem.id)),
  }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}

function legadoMaquinas(entries: Entry[]) {
  return MACHINES.map((machine) => ({
    machine,
    total: paresDasEntradas(entries.filter((entry) => entry.machine === machine)),
  }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
}

function legadoEstacoes(entries: Entry[]) {
  return STATIONS.map((station) => ({
    id: String(station),
    valor: paresDasEntradas(entries.filter((entry) => entry.station === station)),
  }))
    .filter((item) => item.valor > 0)
    .sort((a, b) => b.valor - a.valor);
}

function legadoProducao(itens: ProducaoPares[], maquina: MachineId | null, datas: Set<string>, turno: Turno | null) {
  return itens.reduce((soma, item) => {
    if (item.pares <= 0 || !datas.has(item.date)) return soma;
    if (turno && item.turno !== turno) return soma;
    if (maquina && item.machine !== maquina && maquinaBase(item.machine) !== maquina && maquinaBase(maquina) !== item.machine) return soma;
    return soma + item.pares;
  }, 0);
}

describe("painel em uma passagem", () => {
  const datas: Record<PeriodoCalculo, Set<string>> = {
    dia: new Set(["2026-11-05"]),
    semana: new Set(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]),
    mes: new Set(["2026-11-01", "2026-11-03", "2026-11-05"]),
    ano: new Set(["2026-10-20", "2026-11-01", "2026-11-05"]),
  };
  const machines = ["SIE01", "SIE02", "SIE04A", "SIE06", "SIE06B"] as const;
  const problems = ["gas-sola", "contaminacao", "falta-corpo", "gas-aberto"] as const;
  const entries: Entry[] = [];
  let n = 0;
  for (const date of ["2026-10-20", "2026-11-01", "2026-11-03", "2026-11-05", "2026-12-01"]) {
    for (const turno of TURNOS) {
      for (const machine of machines) {
        for (const problem of problems) {
          for (const station of [1, 4, 8]) {
            const impares = (n % 5) + 1;
            for (let i = 0; i < impares; i += 1) {
              entries.push(
                entrada({
                  id: `e-${n}-${i}`,
                  date,
                  turno,
                  machine,
                  problem,
                  station,
                  side: i % 2 === 0 ? "esq" : "dir",
                  outroId: n % 4 === 0 ? "troca" : "",
                  matrizNumero: n % 3 === 0 ? "37" : "33/4",
                  matrizRel: n % 2 === 0 ? "01" : "2",
                }),
              );
            }
            n += 1;
          }
        }
      }
    }
  }

  const passa = (entry: Entry) => entry.machine === "SIE04A" && entry.station !== 8 && entry.problem !== "gas-aberto";
  const novo = separarEntradas(entries, passa, datas);
  const velho = legadoListas(entries, passa, datas);

  it("mantém as mesmas solas em cada período e turno", () => {
    assert.deepEqual(novo.historico.map((item) => item.id), velho.historico.map((item) => item.id));
    for (const periodo of PERIODOS) {
      assert.deepEqual(
        novo.listas[periodo].todos.map((item) => item.id),
        velho.de(periodo, null).map((item) => item.id),
        periodo,
      );
      for (const turno of TURNOS) {
        assert.deepEqual(
          novo.listas[periodo][turno].map((item) => item.id),
          velho.de(periodo, turno).map((item) => item.id),
          `${periodo}-${turno}`,
        );
      }
    }
  });

  it("mantém pares, problemas, máquinas e estações", () => {
    const grafico = novo.listas.mes.todos;
    assert.equal(paresDasEntradas(grafico), paresDasEntradas(velho.de("mes", null)));
    assert.deepEqual(perdasPorProblema(grafico), legadoProblemas(velho.de("mes", null)));
    assert.deepEqual(perdasPorMaquina(grafico), legadoMaquinas(velho.de("mes", null)));
    assert.deepEqual(
      perdasPorEstacao(grafico).map((item) => [item.id, item.valor]),
      legadoEstacoes(velho.de("mes", null)).map((item) => [item.id, item.valor]),
    );
  });

  it("fecha ímpar em par e não soma lados ou trocas diferentes", () => {
    const um = [entrada({ id: "1", date: "2026-11-05", turno: "1", machine: "SIE01", problem: "contaminacao" })];
    assert.equal(paresDasEntradas(um), 1);
    const tres = [0, 1, 2].map((i) =>
      entrada({ id: String(i), date: "2026-11-05", turno: "1", machine: "SIE01", problem: "contaminacao", station: 2, side: "dir" }),
    );
    assert.equal(paresDasEntradas(tres), 2);
    const trocas = tres.map((item, index) => ({ ...item, id: `t-${index}`, outroId: index === 2 ? "outra" : "" }));
    assert.equal(paresDasEntradas(trocas), 2);
    const misturados = [
      entrada({ id: "x", date: "2026-11-05", turno: "1", machine: "SIE01", problem: "gas-sola", station: 1, side: "esq" }),
      entrada({ id: "y", date: "2026-11-05", turno: "1", machine: "SIE01", problem: "pezinho", station: 1, side: "esq" }),
      ...[0, 1, 2, 3, 4, 5].map((i) =>
        entrada({ id: `z-${i}`, date: "2026-11-05", turno: "1", machine: "SIE01", problem: "excesso-carga", station: 1, side: "esq" }),
      ),
    ];
    assert.equal(paresDasEntradas(misturados), 4);
  });

  it("soma a produção com o mesmo recorte de máquina", () => {
    const itens: ProducaoPares[] = [
      { id: "a", date: "2026-11-05", turno: "1", machine: "SIE06", numero: "33/4", pares: 10, salvoEm: 1 },
      { id: "b", date: "2026-11-05", turno: "2", machine: "SIE06A", numero: "33/4", pares: 4, salvoEm: 1 },
      { id: "c", date: "2026-11-03", turno: "1", machine: "SIE02", numero: "1", pares: 7, salvoEm: 1 },
      { id: "d", date: "2026-11-05", turno: "1", machine: "SIE06", numero: "1", pares: 0, salvoEm: 1 },
    ];
    const pedidos = [
      { id: "dia-1", datas: datas.dia, turno: "1" as Turno },
      { id: "mes-todos", datas: datas.mes, turno: null },
    ];
    const novoProd = somarProducao(itens, "SIE06", pedidos);
    assert.equal(novoProd["dia-1"], legadoProducao(itens, "SIE06", datas.dia, "1"));
    assert.equal(novoProd["mes-todos"], legadoProducao(itens, "SIE06", datas.mes, null));
    assert.equal(novoProd["dia-1"], 10);
    assert.equal(novoProd["mes-todos"], 14);
  });

  it("CEIL do mesmo conjunto bate; sola local ou exclusão fora do banco não batem", () => {
    function paresComoSql(linhas: Entry[]) {
      const grupos = new Map<string, number>();
      for (const entry of linhas) {
        const chave = `${entry.date}|${entry.turno}|${entry.machine}|${entry.station}|${entry.side}|${entry.outroId}`;
        grupos.set(chave, (grupos.get(chave) ?? 0) + 1);
      }
      let total = 0;
      for (const solas of grupos.values()) total += Math.ceil(solas / 2);
      return total;
    }
    const tres = [0, 1, 2].map((i) =>
      entrada({ id: `sql-${i}`, date: "2026-11-05", turno: "2", machine: "SIE03", problem: "pezinho", station: 5, side: "esq" }),
    );
    assert.equal(paresComoSql(tres), paresDasEntradas(tres));
    assert.equal(paresDasEntradas(tres), 2);
    assert.equal(Math.floor(3 / 2), 1);
    const noBanco = entries.filter((entry) => entry.date === "2026-11-05");
    assert.equal(paresComoSql(noBanco), paresDasEntradas(noBanco));
    const aindaLocal = entrada({
      id: "ainda-nao-subiu",
      date: "2026-11-05",
      turno: "1",
      machine: "SIE01",
      problem: "contaminacao",
    });
    assert.notEqual(paresComoSql(noBanco), paresDasEntradas([...noBanco, aindaLocal]));
    const semOPrimeiro = noBanco.slice(1);
    assert.equal(paresComoSql(semOPrimeiro), paresDasEntradas(semOPrimeiro));
    assert.notEqual(paresComoSql(noBanco), paresDasEntradas(semOPrimeiro));
  });
});
