import { useState } from "react";
import { perdasPorProblema } from "@/components/painel-calculo";
import { paresDasEntradas, percentualPerda, textoPercentual } from "@/components/comum";
import {
  diaDoApontamento,
  diaOperacional,
  formatDateBR,
  maquinasDoFiltro,
  mergeFechamentos,
  TURNO_LABEL,
  type Fechamento,
  type MachineId,
  type State,
  type Turno,
} from "@/lib/perdas";

const TURNO: Turno = "1";

type Campos = { horas: string; saldo: string; setup: string };

function vazio(): Campos {
  return { horas: "", saldo: "", setup: "" };
}

function ponto(texto: string) {
  if (!texto || texto === "----") return texto;
  return /[.!?]$/.test(texto) ? texto : `${texto}.`;
}

function preenchido(texto: string) {
  const limpo = texto.trim();
  return limpo || "----";
}

function nomeCurto(nome: string) {
  return nome.split(" - ")[0]?.trim() || nome;
}

function juntar(nomes: string[]) {
  const lista = nomes.filter(Boolean);
  if (lista.length === 0) return "----";
  const [primeiro, ...resto] = lista;
  const cauda = resto.map((nome) => nome.charAt(0).toLocaleLowerCase("pt-BR") + nome.slice(1));
  if (cauda.length === 0) return primeiro;
  if (cauda.length === 1) return `${primeiro} e ${cauda[0]}`;
  return `${primeiro}, ${cauda.slice(0, -1).join(", ")} e ${cauda[cauda.length - 1]}`;
}

export function FechamentoTurno({
  state,
  onCommit,
  onNotice,
}: {
  state: State;
  onCommit: (recipe: (current: State) => State) => void;
  onNotice: (text: string) => void;
}) {
  const data = diaOperacional(TURNO);
  const view: State = { ...state, date: data, turno: TURNO };
  const maquinas = maquinasDoFiltro(view.modelos);
  const [escolhidas, setEscolhidas] = useState<MachineId[]>([]);
  const [campos, setCampos] = useState<Record<string, Campos>>(() => {
    const inicial: Record<string, Campos> = {};
    for (const item of state.fechamentos ?? []) {
      if (item.date !== data || item.turno !== TURNO) continue;
      inicial[item.machine] = { horas: item.horasBaixadas, saldo: item.saldo, setup: item.setup };
    }
    return inicial;
  });
  const [gerando, setGerando] = useState(false);

  function camposDe(machine: MachineId) {
    return campos[machine] ?? vazio();
  }

  function calcular(machine: MachineId) {
    const entradas = view.entries.filter(
      (entry) => entry.date === view.date && entry.turno === TURNO && entry.machine === machine,
    );
    const perdas = paresDasEntradas(entradas);
    const producao = (view.producao ?? [])
      .filter((item) => diaDoApontamento(item) === view.date && item.turno === TURNO && item.machine === machine)
      .reduce((soma, item) => soma + item.pares, 0);
    const percentual = percentualPerda(perdas, producao);
    const problemas = perdasPorProblema(entradas).slice(0, 3).map((item) => nomeCurto(item.name));
    return {
      perdas,
      producao,
      percentual: percentual === null ? "----" : `${textoPercentual(percentual)}%`,
      problemas: juntar(problemas),
    };
  }

  function alternar(machine: MachineId) {
    setEscolhidas((atual) => (atual.includes(machine) ? atual.filter((item) => item !== machine) : [...atual, machine]));
  }

  function editar(machine: MachineId, chave: keyof Campos, valor: string) {
    setCampos((atual) => ({ ...atual, [machine]: { ...camposDe(machine), [chave]: valor } }));
  }

  function textoDa(machine: MachineId) {
    const conta = calcular(machine);
    const digitado = camposDe(machine);
    const setup = digitado.setup.trim();
    return [
      `${machine}:`,
      `• Horas Baixadas: ${preenchido(digitado.horas)}`,
      `• Produção: ${conta.producao}`,
      `• Perdas: ${conta.perdas}`,
      `• Percentual: ${conta.percentual}`,
      `• Saldo: ${preenchido(digitado.saldo)}`,
      `• Setup: ${setup ? ponto(setup) : "----"}`,
      `• Prob.: ${ponto(conta.problemas)}`,
    ];
  }

  async function enviarTexto(texto: string) {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ text: texto });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener,noreferrer");
  }

  async function gerar() {
    if (escolhidas.length === 0 || gerando) return;
    const lista = maquinas.filter((machine) => escolhidas.includes(machine));
    setGerando(true);
    try {
      const salvos: Fechamento[] = [];
      const agora = Date.now();
      for (const machine of lista) {
        const digitado = camposDe(machine);
        salvos.push({
          id: `${view.date}|${TURNO}|${machine}`,
          date: view.date,
          turno: TURNO,
          machine,
          horasBaixadas: digitado.horas.trim(),
          producao: calcular(machine).producao,
          saldo: digitado.saldo.trim(),
          setup: digitado.setup.trim(),
          salvoEm: agora,
        });
      }
      onCommit((current) => ({
        ...current,
        fechamentos: mergeFechamentos(current.fechamentos ?? [], salvos),
      }));
      await enviarTexto(lista.map((machine) => textoDa(machine).join("\n")).join("\n\n"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      onNotice("Não foi possível enviar o texto.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <p className="font-display text-4xl leading-none text-accent">Fechamento</p>
      <p className="mt-1 text-sm font-semibold text-muted">
        {TURNO_LABEL[TURNO]} · {formatDateBR(view.date)}
      </p>
      <div className="mt-4 grid gap-2">
        {maquinas.map((machine) => {
          const ligada = escolhidas.includes(machine);
          const conta = calcular(machine);
          const digitado = camposDe(machine);
          return (
            <div key={machine} className="rounded-tile border border-line bg-surface p-3">
              <button
                type="button"
                aria-pressed={ligada}
                onClick={() => alternar(machine)}
                className="flex w-full items-center gap-3 text-left"
              >
                <span
                  className={
                    ligada
                      ? "grid size-7 place-items-center rounded-lg bg-accent text-sm font-semibold text-accent-ink"
                      : "grid size-7 place-items-center rounded-lg bg-surface-2 text-sm font-semibold text-muted"
                  }
                >
                  {ligada ? "✓" : ""}
                </span>
                <span className="font-display text-3xl leading-none">{machine}</span>
                <span className="ml-auto text-right text-xs font-semibold text-muted">
                  {conta.producao} · {conta.perdas}
                  <br />
                  {conta.percentual}
                </span>
              </button>
              {ligada ? (
                <div className="mt-3 grid gap-2">
                  <input
                    value={digitado.horas}
                    placeholder="Horas baixadas"
                    autoComplete="off"
                    onChange={(event) => editar(machine, "horas", event.target.value)}
                    className="w-full rounded-tile border border-line bg-surface-2 px-3 py-3 text-base"
                  />
                  <input
                    value={digitado.saldo}
                    placeholder="Saldo"
                    autoComplete="off"
                    onChange={(event) => editar(machine, "saldo", event.target.value)}
                    className="w-full rounded-tile border border-line bg-surface-2 px-3 py-3 text-base"
                  />
                  <input
                    value={digitado.setup}
                    placeholder="Setup"
                    autoComplete="off"
                    onChange={(event) => editar(machine, "setup", event.target.value)}
                    className="w-full rounded-tile border border-line bg-surface-2 px-3 py-3 text-base"
                  />
                  <p className="text-sm text-muted">Prob.: {conta.problemas}</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 mt-4 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <button
          type="button"
          disabled={gerando || escolhidas.length === 0}
          onClick={() => void gerar()}
          className="w-full rounded-tile bg-accent py-4 font-display text-3xl leading-none text-accent-ink disabled:opacity-40"
        >
          {gerando ? "Enviando…" : "Enviar texto"}
        </button>
      </div>
    </div>
  );
}
