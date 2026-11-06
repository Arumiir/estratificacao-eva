import { startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Eraser, ImageDown, X } from "lucide-react";
import {
  MACHINES,
  MAQUINAS_PISO,
  maquinaBase,
  maquinasDoFiltro,
  PROBLEMS,
  SIDE_LABEL,
  SIDE_SHORT,
  SIDES,
  STATIONS,
  describeMatrix,
  diaDoApontamento,
  diaDeHoje,
  diasDaSemana,
  diasDoAno,
  diasDoMes,
  fichaLines,
  formatDateBR,
  machineHasFicha,
  machineHasMatrices,
  nomeMes,
  numeroLimpo,
  outroVivo,
  pad2,
  parseMachine,
  podeAlterarApontamento,
  problemName,
  referenciaLimpa,
  shiftEntries,
  stationKey,
  todayISO,
  TURNO_LABEL,
  type Entry,
  type FichaLine,
  type MachineId,
  type MaquinaPiso,
  type ProducaoPares,
  type Side,
  type State,
  type StationConfig,
  type Turno,
} from "@/lib/perdas";
import { pullEvolucaoMolde, pullHistorico } from "@/lib/apontamentos.functions";
import { cx, pares, paresDasEntradas, percentualPerda, textoPercentual } from "@/components/comum";
import { perdasPorEstacao, perdasPorMaquina, perdasPorProblema, separarEntradas, somarProducao } from "@/components/painel-calculo";

type Papel = "preparador" | "lider";

function TurnoPicker({ value, onChange }: { value: Turno; onChange: (turno: Turno) => void }) {
  return (
    <div className="grid w-full max-w-md grid-cols-3 gap-1">
      {(["1", "2", "3"] as const).map((turno) => (
        <button
          key={turno}
          type="button"
          onClick={() => onChange(turno)}
          className={cx(
            "rounded px-2 py-2 text-sm font-semibold",
            value === turno ? "bg-accent text-accent-ink" : "bg-white text-fg",
          )}
        >
          {TURNO_LABEL[turno]}
        </button>
      ))}
    </div>
  );
}

function moverDia(iso: string, delta: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() + delta);
  const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(cursor.getUTCDate()).padStart(2, "0");
  return `${cursor.getUTCFullYear()}-${mes}-${dia}`;
}

function nomeDia(iso: string): string {
  const nome = new Date(`${iso}T12:00:00-03:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    timeZone: "America/Fortaleza",
  });
  return nome ? nome.charAt(0).toUpperCase() + nome.slice(1) : iso;
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function celulasDoMes(ano: number, mes: number): Array<string | null> {
  const primeira = new Date(Date.UTC(ano, mes - 1, 1));
  const folga = (primeira.getUTCDay() + 6) % 7;
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const celulas: Array<string | null> = Array.from({ length: folga }, () => null);
  for (let dia = 1; dia <= ultimo; dia += 1) {
    celulas.push(`${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`);
  }
  return celulas;
}

function SeletorDia({
  date,
  today,
  teto,
  onDate,
}: {
  date: string;
  today: string;
  teto?: string;
  onDate: (date: string) => void;
}) {
  const limite = teto && teto > today ? teto : today;
  const [aberto, setAberto] = useState(false);
  const [ano, setAno] = useState(Number(date.slice(0, 4)));
  const [mes, setMes] = useState(Number(date.slice(5, 7)));

  function abrir() {
    setAno(Number(date.slice(0, 4)) || Number(today.slice(0, 4)));
    setMes(Number(date.slice(5, 7)) || Number(today.slice(5, 7)));
    setAberto(true);
  }

  function mudarMes(delta: number) {
    const cursor = new Date(Date.UTC(ano, mes - 1 + delta, 1));
    setAno(cursor.getUTCFullYear());
    setMes(cursor.getUTCMonth() + 1);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#d5dee8] bg-white px-1.5 py-1">
        <button
          type="button"
          aria-label="Dia anterior"
          onClick={() => onDate(moverDia(date, -1))}
          className="grid size-11 place-items-center rounded-xl text-[#1e3a5f]"
        >
          <ChevronLeft className="size-5" />
        </button>
        <button type="button" onClick={abrir} className="min-w-0 flex-1 text-center">
          <p className="text-base font-semibold leading-tight">{formatDateBR(date)}</p>
          <p className="text-xs text-muted">{date === today ? "Hoje" : nomeDia(date)}</p>
        </button>
        <button
          type="button"
          aria-label="Próximo dia"
          disabled={date >= limite}
          onClick={() => onDate(moverDia(date, 1))}
          className="grid size-11 place-items-center rounded-xl text-[#1e3a5f] disabled:opacity-30"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>
      {aberto ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setAberto(false);
          }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <button type="button" aria-label="Mês anterior" onClick={() => mudarMes(-1)} className="grid size-10 place-items-center rounded-xl text-[#1e3a5f]">
                <ChevronLeft className="size-5" />
              </button>
              <p className="text-base font-semibold">{MESES[mes - 1]} {ano}</p>
              <button type="button" aria-label="Próximo mês" onClick={() => mudarMes(1)} className="grid size-10 place-items-center rounded-xl text-[#1e3a5f]">
                <ChevronRight className="size-5" />
              </button>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-muted">
              {["S", "T", "Q", "Q", "S", "S", "D"].map((letra, index) => (
                <span key={`${letra}-${index}`}>{letra}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {celulasDoMes(ano, mes).map((iso, index) =>
                iso ? (
                  <button
                    key={iso}
                    type="button"
                    disabled={iso > limite}
                    onClick={() => {
                      onDate(iso);
                      setAberto(false);
                    }}
                    className={cx(
                      "grid h-10 place-items-center rounded-xl text-sm font-semibold disabled:opacity-30",
                      iso === date ? "bg-[#4682B4] text-white" : iso === today ? "bg-[#e7eef5] text-[#1e3a5f]" : "text-fg",
                    )}
                  >
                    {Number(iso.slice(8))}
                  </button>
                ) : (
                  <span key={`vazio-${index}`} />
                ),
              )}
            </div>
            <button type="button" onClick={() => setAberto(false)} className="mt-3 w-full rounded-2xl bg-[#f3f6fb] py-3 text-sm font-semibold">
              Fechar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function DayControls({
  state,
  today,
  teto,
  onDate,
}: {
  state: State;
  today: string;
  offDay: boolean;
  teto?: string;
  onDate: (date: string) => void;
}) {
  return (
    <div className="mb-4 w-full max-w-md">
      <SeletorDia date={state.date} today={today} teto={teto} onDate={onDate} />
    </div>
  );
}

export function SheetScreen({
  state,
  today,
  offDay,
  onDate,
  onTurno,
  papel,
  onDelete,
  onNotice,
  onModelo,
  onCorrigirProducao,
  onLancarPerda,
  onApagarPerda,
}: {
  state: State;
  today: string;
  offDay: boolean;
  onDate: (date: string) => void;
  onTurno: (turno: Turno) => void;
  papel: Papel;
  onDelete?: (entries: Entry[]) => void;
  onNotice: (text: string) => void;
  onModelo: (machine: MaquinaPiso) => void;
  onCorrigirProducao?: (date: string, machine: MachineId, turno: Turno, valores: Record<string, number>) => void;
  onLancarPerda?: (sola: SolaCorrecao) => void;
  onApagarPerda?: (id: string) => void;
}) {
  const [busy, setBusy] = useState<"foto" | "pdf" | null>(null);
  const [abaLider, setAbaLider] = useState<"geral" | "diario">("geral");
  const [escolherFoto, setEscolherFoto] = useState(false);
  const [escolhidas, setEscolhidas] = useState<MachineId[]>([]);
  const view = state;
  const shown = MACHINES.filter((machine) => shiftEntries(view, machine).length > 0);
  const fileBase = `perdas-${state.date}-turno-${state.turno}`;

  function abrirSeletor() {
    if (shown.length === 0) {
      onNotice("Nenhuma ficha neste turno.");
      return;
    }
    setEscolhidas([]);
    setEscolherFoto(true);
  }

  async function baixarImagens(machines: MachineId[]) {
    if (machines.length === 0) {
      onNotice("Escolha ao menos uma máquina.");
      return;
    }
    setEscolherFoto(false);
    setBusy("foto");
    try {
      const { downloadBlob, renderFichasDaMaquina } = await import("@/lib/ficha-image");
      const files: { name: string; blob: Blob }[] = [];
      for (const item of machines) {
        const grupos = await renderFichasDaMaquina(view, item);
        for (const grupo of grupos) {
          const sufixo = grupo.nome ? `-${grupo.nome.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}` : "";
          files.push({ name: `${fileBase}-maquina-${item}${sufixo}.png`, blob: grupo.blob });
        }
      }
      if (files.length === 0) {
        onNotice("Nenhuma ficha neste turno.");
        return;
      }
      files.forEach((file, index) => {
        window.setTimeout(() => downloadBlob(file.name, file.blob), index * 400);
      });
      onNotice(files.length === 1 ? "Imagem baixada." : `${files.length} imagens baixadas.`);
    } catch {
      onNotice("Não foi possível gerar as imagens.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {papel === "lider" ? (
        abaLider === "geral" ? (
          <PainelHistorico state={state} today={today} onDate={onDate} aba={abaLider} onAba={setAbaLider} onModelo={onModelo} />
        ) : (
          <AcompanhamentoDiario
            state={view}
            today={today}
            offDay={offDay}
            onDate={onDate}
            onTurno={onTurno}
            shown={shown}
            busy={busy}
            onPhoto={abrirSeletor}
            onDelete={onDelete}
            aba={abaLider}
            onAba={setAbaLider}
            onCorrigirProducao={onCorrigirProducao}
            onLancarPerda={onLancarPerda}
            onApagarPerda={onApagarPerda}
          />
        )
      ) : null}
      {escolherFoto ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setEscolherFoto(false);
          }}
        >
          <div className="w-full max-w-md rounded-3xl bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold">Quais máquinas baixar?</h3>
              <button type="button" onClick={() => setEscolherFoto(false)} className="text-sm font-semibold text-muted">
                Fechar
              </button>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => setEscolhidas(escolhidas.length === shown.length ? [] : shown)}
                className="rounded-full bg-[#f3f6fb] px-3 py-2 text-sm font-semibold"
              >
                {escolhidas.length === shown.length ? "Limpar" : "Todas"}
              </button>
              {shown.map((machine) => {
                const ligada = escolhidas.includes(machine);
                return (
                  <button
                    key={machine}
                    type="button"
                    aria-pressed={ligada}
                    onClick={() =>
                      setEscolhidas((atual) => (atual.includes(machine) ? atual.filter((item) => item !== machine) : [...atual, machine]))
                    }
                    className={cx(
                      "rounded-full px-3 py-2 text-sm font-semibold",
                      ligada ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
                    )}
                  >
                    {machine}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={busy !== null || escolhidas.length === 0}
              onClick={() => void baixarImagens(escolhidas)}
              className="mt-4 w-full rounded-2xl bg-[#2457b8] py-3 font-semibold text-white disabled:opacity-50"
            >
              {busy === "foto" ? "Gerando…" : escolhidas.length === 0 ? "Escolha as máquinas" : `Baixar ${escolhidas.length === 1 ? "imagem" : `${escolhidas.length} imagens`}`}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function FiltrosRecorte({
  estacao,
  numero,
  numeros,
  cor = null,
  cores = [],
  onEstacao,
  onNumero,
  onCor,
}: {
  estacao: number | null;
  numero: string | null;
  numeros: string[];
  cor?: string | null;
  cores?: string[];
  onEstacao: (station: number | null) => void;
  onNumero: (numero: string | null) => void;
  onCor?: (cor: string | null) => void;
}) {
  return (
    <div className="grid gap-3 rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
      <div>
        <p className="text-xs font-semibold text-muted">Estação</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onEstacao(null)}
            className={cx(
              "rounded-xl px-3 py-2 text-sm font-semibold",
              estacao === null ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
            )}
          >
            Todas
          </button>
          {STATIONS.map((station) => (
            <button
              key={station}
              type="button"
              onClick={() => onEstacao(estacao === station ? null : station)}
              className={cx(
                "rounded-xl px-3 py-2 text-sm font-semibold tabular-nums",
                estacao === station ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
              )}
            >
              {pad2(station)}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-muted">Número</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => onNumero(null)}
            className={cx(
              "rounded-xl px-3 py-2 text-sm font-semibold",
              numero === null ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
            )}
          >
            Todos
          </button>
          {numeros.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onNumero(numero === item ? null : item)}
              className={cx(
                "rounded-xl px-3 py-2 text-sm font-semibold",
                numero === item ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
              )}
            >
              {item}
            </button>
          ))}
        </div>
        {numeros.length === 0 ? <p className="mt-2 text-sm text-muted">Nenhum número neste recorte.</p> : null}
      </div>
      {cores.length > 0 && onCor ? (
        <div>
          <p className="text-xs font-semibold text-muted">Cor</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onCor(null)}
              className={cx(
                "rounded-xl px-3 py-2 text-sm font-semibold",
                cor === null ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
              )}
            >
              Todas
            </button>
            {cores.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onCor(cor === item ? null : item)}
                className={cx(
                  "rounded-xl px-3 py-2 text-sm font-semibold",
                  cor === item ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OpcaoFiltro({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-xl px-3 py-2 text-left text-sm font-semibold",
        ativo ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
      )}
    >
      {children}
    </button>
  );
}

function GrupoFiltro({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted">{titulo}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

const FILTROS_KEY = "injecao-filtros-dash-v1";
const RECORTE_KEY = "injecao-painel-recorte-v1";

const RECORTE_PADRAO: {
  resumo: RecorteBloco;
  producao: RecorteBloco;
  ranking: RecorteBloco;
  grafico: RecorteBloco;
} = {
  resumo: { periodo: "mes", turno: null },
  producao: { periodo: "mes", turno: null },
  ranking: { periodo: "dia", turno: null },
  grafico: { periodo: "mes", turno: null },
};

type FiltrosDash = {
  maquina: MachineId | null;
  estacao: number | null;
  numero: string | null;
  referencia: string | null;
  lado: Side | null;
  problema: string | null;
};

function lerFiltros(): FiltrosDash {
  const vazio: FiltrosDash = {
    maquina: null,
    estacao: null,
    numero: null,
    referencia: null,
    lado: null,
    problema: null,
  };
  try {
    const raw = localStorage.getItem(FILTROS_KEY);
    if (!raw) return vazio;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return vazio;
    const item = data as Partial<FiltrosDash>;
    const maquina = MACHINES.find((machine) => machine === item.maquina) ?? null;
    const estacao = STATIONS.find((station) => station === item.estacao) ?? null;
    const lado = item.lado === "esq" || item.lado === "dir" ? item.lado : null;
    const problema = PROBLEMS.some((problem) => problem.id === item.problema) ? (item.problema ?? null) : null;
    return {
      maquina,
      estacao,
      numero: typeof item.numero === "string" && item.numero ? item.numero : null,
      referencia: typeof item.referencia === "string" && item.referencia ? referenciaLimpa(item.referencia) : null,
      lado,
      problema,
    };
  } catch {
    return vazio;
  }
}

function ConfigModelos({ state, onToggle }: { state: State; onToggle: (machine: MaquinaPiso) => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#d5dee8] bg-[#f7f9fc] px-3 text-sm font-semibold text-fg"
      >
        <svg viewBox="0 0 24 24" className="size-4 text-[#4682B4]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M18.2 5.8l-1.6 1.6M7.4 16.6l-1.6 1.6" strokeLinecap="round" />
        </svg>
        Configuração
      </button>
      {aberto ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setAberto(false);
          }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold">A e B</h3>
            <p className="mt-1 text-sm text-muted">Ligado, a máquina pede A ou B. Desligado, entra direto.</p>
            <div className="mt-4 grid gap-2">
              {MAQUINAS_PISO.map((machine) => {
                const ligado = state.modelos.includes(machine);
                return (
                  <div key={machine} className="flex items-center justify-between gap-3 rounded-xl border border-[#d5dee8] px-3 py-2.5">
                    <span className="font-display text-2xl leading-none">{machine}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={ligado}
                      aria-label={`${ligado ? "Desativar" : "Ativar"} A e B na ${machine}`}
                      onClick={() => onToggle(machine)}
                      className={cx("relative h-8 w-14 shrink-0 rounded-full", ligado ? "bg-[#4682B4]" : "bg-[#d5dee8]")}
                    >
                      <span
                        className={cx(
                          "absolute top-1 size-6 rounded-full bg-white shadow",
                          ligado ? "left-7" : "left-1",
                        )}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
            <button type="button" onClick={() => setAberto(false)} className="mt-4 w-full rounded-2xl bg-[#f3f6fb] py-3 text-sm font-semibold">
              Fechar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

type PeriodoBloco = "dia" | "semana" | "mes" | "ano";
type RecorteBloco = { periodo: PeriodoBloco; turno: Turno | null };

const PERIODOS_BLOCO: { id: PeriodoBloco; nome: string }[] = [
  { id: "dia", nome: "Dia" },
  { id: "semana", nome: "Semana" },
  { id: "mes", nome: "Mês" },
  { id: "ano", nome: "Ano" },
];

function FiltroBloco({
  recorte,
  onChange,
}: {
  recorte: RecorteBloco;
  onChange: (recorte: RecorteBloco) => void;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5">
        {PERIODOS_BLOCO.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange({ ...recorte, periodo: item.id })}
            className={cx(
              "rounded-lg px-3 py-2 text-sm font-semibold",
              recorte.periodo === item.id ? "bg-[#4682B4] text-white" : "border border-[#d5dee8] bg-white text-fg",
            )}
          >
            {item.nome}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange({ ...recorte, turno: null })}
          className={cx(
            "rounded-lg px-3 py-2 text-sm font-semibold",
            recorte.turno === null ? "bg-[#1e3a5f] text-white" : "border border-[#d5dee8] bg-white text-fg",
          )}
        >
          Todos
        </button>
        {(["1", "2", "3"] as const).map((turno) => (
          <button
            key={turno}
            type="button"
            onClick={() => onChange({ ...recorte, turno })}
            className={cx(
              "rounded-lg px-3 py-2 text-sm font-semibold",
              recorte.turno === turno ? "bg-[#1e3a5f] text-white" : "border border-[#d5dee8] bg-white text-fg",
            )}
          >
            {TURNO_LABEL[turno].replace(" TURNO", "")}
          </button>
        ))}
      </div>
    </div>
  );
}

function lerRecorte(value: unknown, fallback: RecorteBloco): RecorteBloco {
  if (!value || typeof value !== "object") return fallback;
  const item = value as { periodo?: unknown; turno?: unknown };
  const periodo = item.periodo === "dia" || item.periodo === "semana" || item.periodo === "mes" || item.periodo === "ano" ? item.periodo : fallback.periodo;
  const turno = item.turno === "1" || item.turno === "2" || item.turno === "3" ? item.turno : null;
  return { periodo, turno };
}

function lerRecortes() {
  try {
    const raw = localStorage.getItem(RECORTE_KEY);
    if (!raw) return RECORTE_PADRAO;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return RECORTE_PADRAO;
    const item = data as Partial<typeof RECORTE_PADRAO>;
    return {
      resumo: lerRecorte(item.resumo, RECORTE_PADRAO.resumo),
      producao: lerRecorte(item.producao, RECORTE_PADRAO.producao),
      ranking: lerRecorte(item.ranking, RECORTE_PADRAO.ranking),
      grafico: lerRecorte(item.grafico, RECORTE_PADRAO.grafico),
    };
  } catch {
    return RECORTE_PADRAO;
  }
}

function PainelHistorico({
  state,
  today,
  onDate,
  aba,
  onAba,
  onModelo,
}: {
  state: State;
  today: string;
  onDate: (date: string) => void;
  aba: "geral" | "diario";
  onAba: (aba: "geral" | "diario") => void;
  onModelo: (machine: MaquinaPiso) => void;
}) {
  const salvos = lerFiltros();
  const recortes = lerRecortes();
  const [remoto, setRemoto] = useState<Entry[] | null>(null);
  const [producaoRemota, setProducaoRemota] = useState<ProducaoPares[]>([]);
  const [carga, setCarga] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [maquina, setMaquina] = useState<MachineId | null>(salvos.maquina);
  const [estacao, setEstacao] = useState<number | null>(salvos.estacao);
  const [numero, setNumero] = useState<string | null>(salvos.numero);
  const [referencia, setReferencia] = useState<string | null>(salvos.referencia);
  const [lado, setLado] = useState<Side | null>(salvos.lado);
  const [problema, setProblema] = useState<string | null>(salvos.problema);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [resumoRecorte, setResumoRecorte] = useState<RecorteBloco>(recortes.resumo);
  const [producaoRecorte, setProducaoRecorte] = useState<RecorteBloco>(recortes.producao);
  const [rankingRecorte, setRankingRecorte] = useState<RecorteBloco>(recortes.ranking);
  const [graficoRecorte, setGraficoRecorte] = useState<RecorteBloco>(recortes.grafico);
  const diasMes = diasDoMes(state.date);
  const querAno =
    resumoRecorte.periodo === "ano" ||
    producaoRecorte.periodo === "ano" ||
    rankingRecorte.periodo === "ano" ||
    graficoRecorte.periodo === "ano";
  const desdeHistorico = querAno ? `${state.date.slice(0, 4)}-01-01` : (diasMes[0] ?? state.date);
  const cobertura = useMemo(() => new Set(querAno ? diasDoAno(state.date) : diasDoMes(state.date)), [querAno, state.date]);

  useEffect(() => {
    let ativo = true;
    setCarga("carregando");
    pullHistorico({ data: { ate: state.date, desde: desdeHistorico } })
      .then((resultado) => {
        if (!ativo) return;
        startTransition(() => {
          setRemoto(resultado.entries);
          setProducaoRemota(resultado.producao ?? []);
          setCarga("pronto");
        });
      })
      .catch(() => {
        if (!ativo) return;
        setCarga("erro");
      });
    return () => {
      ativo = false;
    };
  }, [state.date, desdeHistorico]);

  useEffect(() => {
    const salvo: FiltrosDash = { maquina, estacao, numero, referencia, lado, problema };
    try {
      localStorage.setItem(FILTROS_KEY, JSON.stringify(salvo));
    } catch {
      /* o filtro continua só nesta tela */
    }
  }, [maquina, estacao, numero, referencia, lado, problema]);

  useEffect(() => {
    try {
      localStorage.setItem(
        RECORTE_KEY,
        JSON.stringify({ resumo: resumoRecorte, producao: producaoRecorte, ranking: rankingRecorte, grafico: graficoRecorte }),
      );
    } catch {
      /* o recorte continua só nesta tela */
    }
  }, [resumoRecorte, producaoRecorte, rankingRecorte, graficoRecorte]);

  const pronto = carga === "pronto";
  const base = useMemo(
    () => (pronto ? juntarHistorico(remoto ?? [], state.entries, cobertura) : []),
    [pronto, remoto, state.entries, cobertura],
  );
  const producaoBase = useMemo(
    () => (pronto ? juntarProducao(producaoRemota, state.producao ?? [], cobertura) : []),
    [pronto, producaoRemota, state.producao, cobertura],
  );
  const calculo = useMemo(() => {
    const recorteLista = base.filter((entry) => {
      if (maquina && entry.machine !== maquina) return false;
      if (estacao !== null && entry.station !== estacao) return false;
      return true;
    });
    const numerosJanela = [...new Set(recorteLista.map((entry) => numeroLimpo(entry.matrizNumero)).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "pt-BR", { numeric: true }),
    );
    const referenciasJanela = [...new Set(recorteLista.map((entry) => referenciaLimpa(entry.matrizRel) || "sem ref."))].sort((a, b) =>
      a.localeCompare(b, "pt-BR", { numeric: true }),
    );
    const numeroAtivo = numero && numerosJanela.includes(numero) ? numero : null;
    const refAtiva = referencia && referenciasJanela.includes(referencia) ? referencia : null;
    const passa = (entry: Entry) => {
      if (maquina && entry.machine !== maquina) return false;
      if (estacao !== null && entry.station !== estacao) return false;
      if (numeroAtivo !== null && numeroLimpo(entry.matrizNumero) !== numeroAtivo) return false;
      if (refAtiva !== null && (referenciaLimpa(entry.matrizRel) || "sem ref.") !== refAtiva) return false;
      if (lado && entry.side !== lado) return false;
      if (problema && entry.problem !== problema) return false;
      return true;
    };
    const datas = {
      dia: new Set([state.date]),
      semana: new Set(diasDaSemana(state.date)),
      mes: new Set(diasDoMes(state.date)),
      ano: new Set(diasDoAno(state.date)),
    };
    const separado = separarEntradas(base, passa, datas);
    const faixas = ["todos", "1", "2", "3"] as const;
    const periodos = ["dia", "semana", "mes", "ano"] as const;
    const paresPeriodo = {
      dia: { todos: 0, "1": 0, "2": 0, "3": 0 },
      semana: { todos: 0, "1": 0, "2": 0, "3": 0 },
      mes: { todos: 0, "1": 0, "2": 0, "3": 0 },
      ano: { todos: 0, "1": 0, "2": 0, "3": 0 },
    };
    for (const periodo of periodos) {
      for (const faixa of faixas) paresPeriodo[periodo][faixa] = paresDasEntradas(separado.listas[periodo][faixa]);
    }
    return { numerosJanela, referenciasJanela, numeroAtivo, refAtiva, ...separado, pares: paresPeriodo };
  }, [base, maquina, estacao, numero, referencia, lado, problema, state.date]);
  const totaisProducao = useMemo(() => {
    const dia = new Set([state.date]);
    const semana = new Set(diasDaSemana(state.date));
    const mes = new Set(diasDoMes(state.date));
    const ano = new Set(diasDoAno(state.date));
    const doPeriodo = (periodo: PeriodoBloco) => (periodo === "dia" ? dia : periodo === "semana" ? semana : periodo === "ano" ? ano : mes);
    return somarProducao(producaoBase, maquina, [
      { id: "resumo", datas: doPeriodo(resumoRecorte.periodo), turno: resumoRecorte.turno },
      { id: "resumo-dia", datas: dia, turno: resumoRecorte.turno },
      { id: "resumo-semana", datas: semana, turno: resumoRecorte.turno },
      { id: "resumo-mes", datas: mes, turno: resumoRecorte.turno },
      { id: "barra-dia", datas: dia, turno: producaoRecorte.turno },
      { id: "barra-semana", datas: semana, turno: producaoRecorte.turno },
      { id: "barra-mes", datas: mes, turno: producaoRecorte.turno },
      { id: "barra-ano", datas: ano, turno: producaoRecorte.turno },
      { id: "turno-1", datas: doPeriodo(producaoRecorte.periodo), turno: "1" },
      { id: "turno-2", datas: doPeriodo(producaoRecorte.periodo), turno: "2" },
      { id: "turno-3", datas: doPeriodo(producaoRecorte.periodo), turno: "3" },
    ]);
  }, [producaoBase, maquina, state.date, resumoRecorte, producaoRecorte]);
  const graficoLista = useMemo(() => {
    const listas = calculo.listas[graficoRecorte.periodo];
    return graficoRecorte.turno ? listas[graficoRecorte.turno] : listas.todos;
  }, [calculo, graficoRecorte]);
  const ativas = useMemo(() => new Set(maquinasDoFiltro(state.modelos)), [state.modelos]);
  const porProblema = useMemo(() => perdasPorProblema(graficoLista), [graficoLista]);
  const porMaquina = useMemo(
    () => perdasPorMaquina(graficoLista).filter((item) => ativas.has(item.machine)),
    [graficoLista, ativas],
  );
  const rankingNumeros = useMemo(
    () => rankNumeros(graficoLista.filter((entry) => ativas.has(entry.machine)), 5),
    [graficoLista, ativas],
  );
  const rankingEstacao = useMemo(
    () =>
      perdasPorEstacao(graficoLista).map((item) => ({
        ...item,
        ativo: estacao === null ? undefined : estacao === Number(item.id),
      })),
    [graficoLista, estacao],
  );
  const { numerosJanela, referenciasJanela, numeroAtivo, refAtiva } = calculo;
  const nomeDoMes = nomeMes(state.date);
  function nomePeriodo(periodo: PeriodoBloco) {
    if (periodo === "dia") return "Dia";
    if (periodo === "semana") return "Semana";
    if (periodo === "ano") return "Ano";
    return nomeDoMes;
  }
  const turnoResumo = resumoRecorte.turno ?? "todos";
  const perdasResumo = calculo.pares[resumoRecorte.periodo][turnoResumo];
  const producaoResumo = totaisProducao.resumo ?? 0;
  const tituloResumo = nomePeriodo(resumoRecorte.periodo);
  const turnos = (["1", "2", "3"] as const).map((turno) => ({
    turno,
    pares: calculo.pares[graficoRecorte.periodo][turno],
  }));
  const entradasRanking = (rankingRecorte.turno
    ? calculo.listas[rankingRecorte.periodo][rankingRecorte.turno]
    : calculo.listas[rankingRecorte.periodo].todos
  ).filter((entry) => ativas.has(entry.machine));
  const historicoRanking = calculo.historico.filter((entry) => ativas.has(entry.machine));
  const nomeRanking = `${nomePeriodo(rankingRecorte.periodo)}${rankingRecorte.turno ? ` · ${TURNO_LABEL[rankingRecorte.turno]}` : " · Todos"}`;
  const avisoIndicador = carga === "carregando" ? "Carregando o mês…" : carga === "erro" ? "Sem nuvem." : undefined;
  const valorOculto = carga === "erro" ? "—" : "…";

  const problemaNome = PROBLEMS.find((item) => item.id === problema)?.name ?? null;
  const filtrosAtivos = [maquina !== null, estacao !== null, numeroAtivo !== null, refAtiva !== null, lado !== null, problema !== null].filter(Boolean).length;
  const resumoFiltro = [
    maquina,
    estacao !== null ? `Est. ${pad2(estacao)}` : null,
    numeroAtivo ? `Nº ${numeroAtivo}` : null,
    refAtiva ? `Ref. ${refAtiva}` : null,
    lado ? SIDE_LABEL[lado] : null,
    problemaNome,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" · ");

  function limparFiltros() {
    setMaquina(null);
    setEstacao(null);
    setNumero(null);
    setReferencia(null);
    setLado(null);
    setProblema(null);
  }

  function voltarPadrao() {
    setResumoRecorte(RECORTE_PADRAO.resumo);
    setProducaoRecorte(RECORTE_PADRAO.producao);
    setRankingRecorte(RECORTE_PADRAO.ranking);
    setGraficoRecorte(RECORTE_PADRAO.grafico);
    limparFiltros();
    onDate(diaDeHoje());
  }

  const chips = resumoFiltro ? resumoFiltro.split(" · ") : [];
  const resumoLinhas = [
    { nome: "Dia", producao: totaisProducao["resumo-dia"] ?? 0, perdas: calculo.pares.dia[turnoResumo] },
    { nome: "Semana", producao: totaisProducao["resumo-semana"] ?? 0, perdas: calculo.pares.semana[turnoResumo] },
    { nome: nomeDoMes, producao: totaisProducao["resumo-mes"] ?? 0, perdas: calculo.pares.mes[turnoResumo] },
  ];

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SeletorDia date={state.date} today={today} teto={todayISO()} onDate={onDate} />
        </div>
        <button type="button" onClick={voltarPadrao} className="h-11 shrink-0 rounded-xl border border-[#d5dee8] bg-white px-3 text-sm font-semibold text-[#1e3a5f]">
          Limpar filtros
        </button>
      </div>
      <BarraDash aba={aba} onAba={onAba}>
        <button
          type="button"
          onClick={() => setFiltrosAbertos(true)}
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#d5dee8] bg-[#f7f9fc] px-3 text-sm font-semibold text-fg"
        >
          <svg viewBox="0 0 24 24" className="size-4 text-[#4682B4]" aria-hidden="true">
            <path
              d="M4 5h16l-6.2 7.1V19l-3.6 1.4v-8.3L4 5z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          Filtros
          {filtrosAtivos > 0 ? (
            <span className="grid size-5 place-items-center rounded-full bg-[#2457b8] text-[11px] font-semibold text-white">
              {filtrosAtivos}
            </span>
          ) : null}
        </button>
        <ConfigModelos state={state} onToggle={onModelo} />
        {filtrosAtivos > 0 ? (
          <button
            type="button"
            onClick={limparFiltros}
            aria-label="Limpar filtros"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#d5dee8] bg-[#f7f9fc] text-fg"
          >
            <Eraser className="size-4" strokeWidth={1.8} />
          </button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5">
          {avisoIndicador ? <span className="self-center text-sm text-muted">{avisoIndicador}</span> : null}
          {chips.map((chip) => (
            <span key={chip} className="inline-flex h-8 items-center rounded-lg border border-[#d5dee8] bg-[#f7f9fc] px-2.5 text-sm font-semibold">
              {chip}
            </span>
          ))}
        </div>
      </BarraDash>

      <nav className="flex flex-wrap gap-1.5">
        {(
          [
            ["resumo", "Resumo"],
            ["producao", "Produção e perdas"],
            ["ranking", "Ranking"],
            ["graficos", "Gráficos"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className="rounded-lg border border-[#d5dee8] bg-white px-3 py-2 text-sm font-semibold text-[#1e3a5f]"
          >
            {label}
          </button>
        ))}
      </nav>

      <BlocoDash id="resumo" titulo="Resumo">
        <FiltroBloco recorte={resumoRecorte} onChange={setResumoRecorte} />
        <div className="grid gap-3 lg:grid-cols-3">
        <CartaoResumo
          titulo="Produção"
          unidade="pares"
          valor={avisoIndicador ? valorOculto : producaoResumo}
          periodo={tituloResumo}
          tom="azul"
          aviso={avisoIndicador}
          linhas={resumoLinhas.map((item) => ({ nome: item.nome, valor: avisoIndicador ? valorOculto : item.producao }))}
        />
        <CartaoResumo
          titulo="Perdas"
          unidade="pares"
          valor={avisoIndicador ? valorOculto : perdasResumo}
          periodo={tituloResumo}
          tom="escuro"
          aviso={avisoIndicador}
          linhas={resumoLinhas.map((item) => ({ nome: item.nome, valor: avisoIndicador ? valorOculto : item.perdas }))}
        />
        <CartaoResumo
          titulo="% de perda"
          unidade=""
          valor={avisoIndicador ? valorOculto : textoPercentual(percentualPerda(perdasResumo, producaoResumo))}
          periodo={tituloResumo}
          tom="claro"
          aviso={avisoIndicador}
          linhas={resumoLinhas.map((item) => ({
            nome: item.nome,
            valor: avisoIndicador ? valorOculto : textoPercentual(percentualPerda(item.perdas, item.producao)),
          }))}
        />
        </div>
      </BlocoDash>

      {filtrosAbertos ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setFiltrosAbertos(false);
          }}
        >
          <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-[#f3f2f1] px-4 py-3">
              <h3 className="text-base font-semibold">Filtros</h3>
              <button type="button" onClick={() => setFiltrosAbertos(false)} className="text-sm font-semibold text-muted">
                Fechar
              </button>
            </div>
            <div className="grid gap-4 overflow-y-auto px-4 py-4">
              <GrupoFiltro titulo="Máquina">
                <OpcaoFiltro ativo={maquina === null} onClick={() => setMaquina(null)}>
                  Todas
                </OpcaoFiltro>
                {maquinasDoFiltro(state.modelos, base.map((entry) => entry.machine)).map((machine) => (
                  <OpcaoFiltro
                    key={machine}
                    ativo={maquina === machine}
                    onClick={() => setMaquina((atual) => (atual === machine ? null : machine))}
                  >
                    {machine}
                  </OpcaoFiltro>
                ))}
              </GrupoFiltro>
              <GrupoFiltro titulo="Estação">
                <OpcaoFiltro ativo={estacao === null} onClick={() => setEstacao(null)}>
                  Todas
                </OpcaoFiltro>
                {STATIONS.map((station) => (
                  <OpcaoFiltro
                    key={station}
                    ativo={estacao === station}
                    onClick={() => setEstacao((atual) => (atual === station ? null : station))}
                  >
                    {pad2(station)}
                  </OpcaoFiltro>
                ))}
              </GrupoFiltro>
              <GrupoFiltro titulo="Número">
                <OpcaoFiltro ativo={numeroAtivo === null} onClick={() => setNumero(null)}>
                  Todos
                </OpcaoFiltro>
                {numerosJanela.map((item) => (
                  <OpcaoFiltro key={item} ativo={numeroAtivo === item} onClick={() => setNumero((atual) => (atual === item ? null : item))}>
                    {item}
                  </OpcaoFiltro>
                ))}
              </GrupoFiltro>
              <GrupoFiltro titulo="Referência">
                <OpcaoFiltro ativo={refAtiva === null} onClick={() => setReferencia(null)}>
                  Todas
                </OpcaoFiltro>
                {referenciasJanela.map((item) => (
                  <OpcaoFiltro
                    key={item}
                    ativo={refAtiva === item}
                    onClick={() => setReferencia((atual) => (atual === item ? null : item))}
                  >
                    {item}
                  </OpcaoFiltro>
                ))}
              </GrupoFiltro>
              <GrupoFiltro titulo="Lado">
                <OpcaoFiltro ativo={lado === null} onClick={() => setLado(null)}>
                  Ambos
                </OpcaoFiltro>
                {SIDES.map((side) => (
                  <OpcaoFiltro key={side} ativo={lado === side} onClick={() => setLado((atual) => (atual === side ? null : side))}>
                    {SIDE_LABEL[side]}
                  </OpcaoFiltro>
                ))}
              </GrupoFiltro>
              <GrupoFiltro titulo="Problema">
                <OpcaoFiltro ativo={problema === null} onClick={() => setProblema(null)}>
                  Todos
                </OpcaoFiltro>
                {PROBLEMS.map((item) => (
                  <OpcaoFiltro
                    key={item.id}
                    ativo={problema === item.id}
                    onClick={() => setProblema((atual) => (atual === item.id ? null : item.id))}
                  >
                    {item.name}
                  </OpcaoFiltro>
                ))}
              </GrupoFiltro>
            </div>
            <div className="flex gap-2 border-t border-[#f3f2f1] px-4 py-3">
              {filtrosAtivos > 0 ? (
                <button
                  type="button"
                  onClick={limparFiltros}
                  aria-label="Limpar filtros"
                  className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#f3f6fb]"
                >
                  <Eraser className="size-4" strokeWidth={1.8} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setFiltrosAbertos(false)}
                className="flex-1 rounded-2xl bg-[#2457b8] py-3 text-sm font-semibold text-white"
              >
                Ver resultado
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <BlocoDash id="producao" titulo="Produção e perdas">
        <FiltroBloco recorte={producaoRecorte} onChange={setProducaoRecorte} />
        <div className="grid grid-cols-2 gap-3">
        <BarrasDuplas
          titulo="Produção e perdas"
          aviso={avisoIndicador}
          grupos={(
            [
              ["dia", "Dia"],
              ["semana", "Semana"],
              ["mes", nomeDoMes],
              ["ano", "Ano"],
            ] as const
          ).map(([id, nome]) => ({
            id,
            nome,
            producao: totaisProducao[`barra-${id}`] ?? 0,
            perdas: calculo.pares[id][producaoRecorte.turno ?? "todos"],
          }))}
        />
        <BarrasDuplas
          titulo="Por turno"
          aviso={avisoIndicador}
          grupos={(["1", "2", "3"] as const).map((turno) => ({
            id: turno,
            nome: TURNO_LABEL[turno].replace(" TURNO", ""),
            producao: totaisProducao[`turno-${turno}`] ?? 0,
            perdas: calculo.pares[producaoRecorte.periodo][turno],
          }))}
        />
        </div>
      </BlocoDash>

      <BlocoDash id="ranking" titulo="Ranking">
        <FiltroBloco recorte={rankingRecorte} onChange={setRankingRecorte} />
        <RankingDoDia
          entries={entradasRanking}
          historico={historicoRanking}
          data={state.date}
          estacao={estacao}
          lado={lado}
          problema={problema}
          periodoNome={nomeRanking}
          turno={rankingRecorte.turno ?? "24"}
          avisoCarga={avisoIndicador}
        />
      </BlocoDash>

      <BlocoDash id="graficos" titulo="Gráficos">
      <FiltroBloco recorte={graficoRecorte} onChange={setGraficoRecorte} />
      <div className="grid gap-4 xl:grid-cols-2">
        <GraficoCircular
          titulo="Piores máquinas"
          aviso={avisoIndicador}
          itens={porMaquina.map((item) => ({
            id: item.machine,
            nome: item.machine,
            valor: item.total,
            ativo: maquina === null ? undefined : maquina === item.machine,
          }))}
          onPick={(id) => setMaquina((atual) => (atual === id ? null : (id as MachineId)))}
        />
        <GraficoCircular
          titulo="Piores turnos"
          aviso={avisoIndicador}
          itens={[...turnos]
            .sort((a, b) => b.pares - a.pares || a.turno.localeCompare(b.turno))
            .filter((item) => item.pares > 0)
            .map((item) => ({
              id: item.turno,
              nome: TURNO_LABEL[item.turno],
              valor: item.pares,
              ativo: graficoRecorte.turno === null ? undefined : graficoRecorte.turno === item.turno,
            }))}
          onPick={(id) =>
            setGraficoRecorte((atual) => ({ ...atual, turno: atual.turno === id ? null : (id as Turno) }))
          }
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <RankingBarras
          vertical
          titulo="Piores problemas"
          aviso={avisoIndicador}
          itens={porProblema.slice(0, 5).map((item) => ({
            id: item.id,
            nome: item.name,
            valor: item.total,
            ativo: problema === null ? undefined : problema === item.id,
          }))}
          onPick={(id) => setProblema((atual) => (atual === id ? null : id))}
        />
        <RankingBarras
          vertical
          titulo="Piores números"
          aviso={avisoIndicador}
          itens={rankingNumeros.map((item) => ({
            id: item.chave,
            nome: `${item.machine}\nNº ${item.numero}${item.referencia ? `\nRef. ${item.referencia}` : ""}`,
            valor: item.pares,
            extra: item.estacoes ? `Est. ${item.estacoes}` : undefined,
          }))}
          onPick={(id) => {
            const [machine, numeroItem] = id.split("||");
            const escolhida = parseMachine(machine);
            if (!escolhida) return;
            setMaquina(escolhida);
            setNumero(numeroItem || null);
          }}
        />
      </div>
      {maquina ? (
        <RankingBarras
          vertical
          titulo="Piores estações"
          aviso={avisoIndicador}
          itens={rankingEstacao}
          onPick={(id) => {
            const station = Number(id);
            setEstacao((atual) => (atual === station ? null : station));
          }}
        />
      ) : null}
      </BlocoDash>
    </div>
  );
}

function BlocoDash({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="grid scroll-mt-4 gap-3 rounded-3xl border border-[#d5dee8] bg-[#f7f9fc] p-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[#1e3a5f]">{titulo}</h2>
      {children}
    </section>
  );
}

const COR_BASE: Record<MaquinaPiso, string> = {
  SIE01: "#4682B4",
  SIE02: "#6f97bf",
  SIE03: "#8aa4b8",
  SIE04: "#c47b6a",
  SIE05: "#3d9a86",
  SIE06: "#c4a35a",
};

const COR_B: Record<MaquinaPiso, string> = {
  SIE01: "#2c5278",
  SIE02: "#4d7194",
  SIE03: "#5e7c90",
  SIE04: "#8d4e42",
  SIE05: "#1f6b5c",
  SIE06: "#7a5a28",
};

function corDaMaquina(machine: MachineId) {
  const base = maquinaBase(machine);
  return machine.endsWith("B") ? COR_B[base] : COR_BASE[base];
}

function corDaTaxa(taxa: number | null) {
  if (taxa === null) return "#9aa8b5";
  if (taxa <= 5) return "#1d7a45";
  if (taxa < 10) return "#d4a017";
  return "#c24141";
}

function textoTaxa(taxa: number | null) {
  if (taxa === null) return "—";
  return taxa.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type BlocoRanking = {
  machine: MachineId;
  linhas: { numero: string; referencia: string; pares: number; cor: string; taxa: string }[];
  total: number;
  motivos: string[];
};

function montarRanking(entries: Entry[]): BlocoRanking[] {
  return MACHINES.map((machine) => {
    const daMaquina = entries.filter((entry) => entry.machine === machine);
    const grupos = new Map<string, { numero: string; referencia: string; itens: Entry[] }>();
    for (const entry of daMaquina) {
      const numero = numeroLimpo(entry.matrizNumero);
      if (!numero) continue;
      const referencia = referenciaLimpa(entry.matrizRel);
      const chave = `${numero}||${referencia}`;
      const atual = grupos.get(chave) ?? { numero, referencia, itens: [] };
      atual.itens.push(entry);
      grupos.set(chave, atual);
    }
    const base = [...grupos.values()]
      .map((item) => ({
        numero: item.numero,
        referencia: item.referencia,
        pares: paresNoRecorte(item.itens),
      }))
      .filter((item) => item.pares > 0)
      .sort((a, b) => b.pares - a.pares || a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
    const total = base.reduce((soma, item) => soma + item.pares, 0);
    const linhas = base.map((item) => {
      const taxa = total > 0 ? (item.pares / total) * 100 : 0;
      return { ...item, cor: corDaTaxa(taxa), taxa: textoTaxa(taxa) };
    });
    const motivos = PROBLEMS.map((problem) => ({
      nome: problem.name,
      pares: paresDasEntradas(daMaquina.filter((entry) => entry.problem === problem.id)),
    }))
      .filter((item) => item.pares > 0)
      .sort((a, b) => b.pares - a.pares)
      .slice(0, 3)
      .map((item) => item.nome);
    return { machine, linhas, total, motivos };
  }).filter((item) => item.total > 0);
}

function paresNoRecorte(entries: Entry[]): number {
  const grupos = new Map<string, number>();
  for (const entry of entries) {
    const chave = `${entry.station}|${entry.side}|${entry.outroId}`;
    grupos.set(chave, (grupos.get(chave) ?? 0) + 1);
  }
  let total = 0;
  for (const solas of grupos.values()) total += pares(solas);
  return total;
}

function fraseMotivos(nomes: string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

function rotuloNumero(numero: string, referencia: string) {
  return referencia ? `${numero} · ${referencia}` : numero;
}

function RankingDoDia({
  entries,
  historico,
  data,
  estacao,
  lado,
  problema,
  periodoNome,
  turno,
  avisoCarga,
}: {
  entries: Entry[];
  historico: Entry[];
  data: string;
  estacao: number | null;
  lado: Side | null;
  problema: string | null;
  periodoNome: string;
  turno: "24" | Turno;
  avisoCarga?: string;
}) {
  const [gerando, setGerando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [molde, setMolde] = useState<{ machine: MachineId; numero: string; referencia: string } | null>(null);
  const maquinas = montarRanking(entries);
  const faixa = turno === "1" ? "#2a2a2a" : turno === "2" ? "#1f5f99" : turno === "3" ? "#9b2c2c" : "#1d7a45";

  async function baixar() {
    if (maquinas.length === 0) {
      setAviso("Sem perdas neste recorte.");
      return;
    }
    setGerando(true);
    setAviso("");
    try {
      const { downloadBlob, renderRankingPng } = await import("@/lib/ficha-image");
      const blob = await renderRankingPng({
        data: formatDateBR(data),
        periodo: periodoNome,
        faixa,
        maquinas: maquinas.map((item) => ({
          nome: item.machine,
          total: item.total,
          linhas: item.linhas.map((linha) => ({
            rotulo: rotuloNumero(linha.numero, linha.referencia),
            pares: linha.pares,
            percentual: linha.taxa,
            cor: linha.cor,
          })),
          motivos: fraseMotivos(item.motivos),
        })),
      });
      downloadBlob(`ranking-${data}-${turno}.png`, blob);
    } catch {
      setAviso("Não foi possível gerar a imagem.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <section className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-[#3d4a5c]">
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-[#1d7a45]" /> Até 5%</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-[#d4a017]" /> 5% a 10%</span>
          <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-full bg-[#c24141]" /> Acima de 10%</span>
        </div>
        <button
          type="button"
          disabled={gerando || Boolean(avisoCarga)}
          onClick={() => void baixar()}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold shadow-[0_6px_16px_rgba(47,84,150,0.08)] disabled:opacity-50"
        >
          <ImageDown className="size-4" />
          {gerando ? "Gerando…" : "Baixar imagem"}
        </button>
      </div>
      <div>
        <h3 className="text-base font-semibold">Ranking</h3>
        <p className="text-sm text-muted">
          {formatDateBR(data)} · {periodoNome}
          {" · toque no número para ver o dia a dia"}
          {aviso ? ` · ${aviso}` : ""}
        </p>
      </div>
      {avisoCarga ? (
        <p className="rounded-2xl border border-dashed border-[#d5dee8] bg-white px-4 py-6 text-center text-sm text-muted">
          {avisoCarga}
        </p>
      ) : maquinas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#d5dee8] bg-white px-4 py-6 text-center text-sm text-muted">
          Sem perdas neste recorte.
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {maquinas.map((item) => (
            <article key={item.machine} className="min-w-0 overflow-hidden rounded-2xl border border-[#d5dee8] bg-white">
              <div className="h-1" style={{ background: corDaMaquina(item.machine) }} />
              <header className="flex items-center justify-between gap-3 bg-[#f7f9fc] px-3 py-2">
                <h4 className="text-sm font-semibold">{item.machine}</h4>
                <p className="text-sm font-semibold tabular-nums">{item.total} pares</p>
              </header>
              <div className="grid w-full grid-cols-[0.55rem_minmax(0,1fr)_2.6rem_3.5rem] gap-x-2 bg-[#e8eef5] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-[#1e3a5f]">
                <span />
                <span>Número</span>
                <span className="text-right">Pares</span>
                <span className="text-right">%</span>
              </div>
              <ol>
                {item.linhas.map((linha) => (
                  <li
                    key={`${linha.numero}-${linha.referencia}`}
                    className="grid w-full grid-cols-[0.55rem_minmax(0,1fr)_2.6rem_3.5rem] items-center gap-x-2 border-b border-[#f4f6f8] px-3 py-1 text-sm last:border-b-0"
                  >
                    <span className="size-2.5 rounded-full" style={{ background: linha.cor }} />
                    <button
                      type="button"
                      onClick={() => setMolde({ machine: item.machine, numero: linha.numero, referencia: linha.referencia })}
                      className="min-w-0 break-words text-left font-semibold leading-tight text-[#1e3a5f] underline decoration-[#4682B4] decoration-1 underline-offset-2"
                    >
                      {rotuloNumero(linha.numero, linha.referencia)}
                    </button>
                    <span className="text-right font-semibold tabular-nums">{linha.pares}</span>
                    <span className="text-right font-semibold tabular-nums" style={{ color: linha.cor }}>{linha.taxa}</span>
                  </li>
                ))}
              </ol>
              <footer className="border-t border-[#e6ebf2] bg-[#f7f9fc] px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wide text-[#1e3a5f]">Principais motivos</p>
                <p className="mt-0.5 whitespace-normal break-words text-sm font-semibold leading-snug text-fg">{fraseMotivos(item.motivos) || "Sem motivo."}</p>
              </footer>
            </article>
          ))}
        </div>
      )}
      {molde ? (
        <EvolucaoMolde
          machine={molde.machine}
          numero={molde.numero}
          referencia={molde.referencia}
          data={data}
          turno={turno}
          historico={historico}
          estacao={estacao}
          lado={lado}
          problema={problema}
          onClose={() => setMolde(null)}
        />
      ) : null}
    </section>
  );
}

const INICIO_LINHA = "2026-10-26";

type PontoLinha = { id: string; rotulo: string; nome: string; pares: number };
type MotivoDia = { nome: string; pares: number };
type DiaMolde = { date: string; pares: number; motivos?: MotivoDia[] };

function motivosDoDia(entries: Entry[]): MotivoDia[] {
  const porProblema = new Map<string, Entry[]>();
  for (const entry of entries) {
    const lista = porProblema.get(entry.problem) ?? [];
    lista.push(entry);
    porProblema.set(entry.problem, lista);
  }
  return [...porProblema.entries()]
    .map(([id, itens]) => ({ nome: problemName(id), pares: itens.length }))
    .filter((item) => item.pares > 0)
    .sort((a, b) => b.pares - a.pares || a.nome.localeCompare(b.nome, "pt-BR"));
}

function diasDesde(desde: string, ate: string): string[] {
  if (!desde || !ate || ate < desde) return [];
  const dias: string[] = [];
  let cursor = desde;
  for (let guarda = 0; guarda < 400 && cursor <= ate; guarda += 1) {
    dias.push(cursor);
    cursor = moverDia(cursor, 1);
  }
  return dias;
}

function mesmoMolde(entry: Entry, machine: MachineId, numero: string, referencia: string, turno: "24" | Turno) {
  if (entry.machine !== machine) return false;
  if (numeroLimpo(entry.matrizNumero) !== numero) return false;
  if (referenciaLimpa(entry.matrizRel) !== referencia) return false;
  if (turno !== "24" && entry.turno !== turno) return false;
  return true;
}

function serieDiaria(
  dias: DiaMolde[],
  historico: Entry[],
  machine: MachineId,
  numero: string,
  referencia: string,
  turno: "24" | Turno,
  ate: string,
): PontoLinha[] {
  const mapa = new Map(dias.map((item) => [item.date, item.pares]));
  const local = historico.filter((entry) => mesmoMolde(entry, machine, numero, referencia, turno));
  const inicioMes = diasDoMes(ate)[0] ?? ate;
  const faixa = diasDesde(INICIO_LINHA, ate);
  for (const dia of faixa) {
    if (dia >= inicioMes) mapa.set(dia, paresNoRecorte(local.filter((entry) => entry.date === dia)));
  }
  return faixa.map((dia) => ({
    id: dia,
    rotulo: `${dia.slice(8, 10)}/${dia.slice(5, 7)}`,
    nome: formatDateBR(dia),
    pares: mapa.get(dia) ?? 0,
  }));
}

function leituraLinha(pontos: PontoLinha[]): { texto: string; tom: "igual" | "melhor" | "pior" } | null {
  if (pontos.length < 2) return null;
  const agora = pontos[pontos.length - 1];
  const antes = pontos[pontos.length - 2];
  if (!agora || !antes) return null;
  const delta = agora.pares - antes.pares;
  if (delta === 0) return { texto: `${antes.nome}: ${antes.pares} pares. ${agora.nome}: ${agora.pares}. Igual.`, tom: "igual" };
  if (delta < 0) return { texto: `${antes.nome}: ${antes.pares} pares. ${agora.nome}: ${agora.pares}. Caiu ${-delta}.`, tom: "melhor" };
  return { texto: `${antes.nome}: ${antes.pares} pares. ${agora.nome}: ${agora.pares}. Subiu ${delta}.`, tom: "pior" };
}

function GraficoLinha({
  pontos,
  ativo,
  onAtivo,
}: {
  pontos: PontoLinha[];
  ativo: string | null;
  onAtivo: (id: string) => void;
}) {
  const esquerda = 28;
  const direita = 16;
  const topo = 22;
  const altura = 230;
  const base = 188;
  const largura = Math.max(320, esquerda + direita + pontos.length * 46);
  const maximo = Math.max(1, ...pontos.map((ponto) => ponto.pares));
  const n = pontos.length;
  const x = (indice: number) => (n <= 1 ? largura / 2 : esquerda + (indice / (n - 1)) * (largura - esquerda - direita));
  const y = (valor: number) => base - (valor / maximo) * (base - topo);
  const caminho = pontos.map((ponto, indice) => `${indice === 0 ? "M" : "L"} ${x(indice).toFixed(1)} ${y(ponto.pares).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${largura} ${altura}`} className="h-56" style={{ width: largura }} role="img">
      {[0, 0.5, 1].map((marca) => {
        const valor = Math.round(maximo * marca);
        const yLinha = y(valor);
        return (
          <g key={marca}>
            <line x1={esquerda} x2={largura - direita} y1={yLinha} y2={yLinha} stroke="#e6ebf2" />
            <text x={0} y={yLinha + 4} fill="#6b7280" fontSize="11">
              {valor}
            </text>
          </g>
        );
      })}
      <path d={caminho} fill="none" stroke="#4682B4" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {pontos.map((ponto, indice) => (
        <g key={ponto.id} onClick={() => onAtivo(ponto.id)}>
          <circle cx={x(indice)} cy={y(ponto.pares)} r="16" fill="transparent" />
          <text x={x(indice)} y={y(ponto.pares) - 10} textAnchor="middle" fill="#1e3a5f" fontSize="11" fontWeight="700">
            {ponto.pares}
          </text>
          <circle cx={x(indice)} cy={y(ponto.pares)} r={ativo === ponto.id ? 6 : 4} fill={ativo === ponto.id ? "#1e3a5f" : "#4682B4"} />
          <text x={x(indice)} y={208} textAnchor="middle" fill="#3d4a5c" fontSize="11">
            {ponto.rotulo}
          </text>
        </g>
      ))}
    </svg>
  );
}

function EvolucaoMolde({
  machine,
  numero,
  referencia,
  data,
  turno,
  historico,
  estacao,
  lado,
  problema,
  onClose,
}: {
  machine: MachineId;
  numero: string;
  referencia: string;
  data: string;
  turno: "24" | Turno;
  historico: Entry[];
  estacao: number | null;
  lado: Side | null;
  problema: string | null;
  onClose: () => void;
}) {
  const [remoto, setRemoto] = useState<DiaMolde[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState(false);
  const [ativo, setAtivo] = useState<string | null>(null);
  const ate = data < INICIO_LINHA ? INICIO_LINHA : data;

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setFalha(false);
    pullEvolucaoMolde({
      data: {
        machine,
        numero,
        referencia,
        desde: INICIO_LINHA,
        ate,
        turno,
        estacao: estacao ?? 0,
        lado: lado ?? "",
        problema: problema ?? "",
      },
    })
      .then((resultado) => {
        if (vivo) setRemoto(resultado.dias);
      })
      .catch(() => {
        if (vivo) setFalha(true);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [machine, numero, referencia, ate, turno, estacao, lado, problema]);

  const pontos = serieDiaria(remoto ?? [], historico, machine, numero, referencia, turno, ate);
  const leitura = leituraLinha(pontos);
  const escolhido = pontos.find((ponto) => ponto.id === ativo) ?? pontos[pontos.length - 1];
  const inicioMes = diasDoMes(ate)[0] ?? ate;
  const motivos =
    escolhido && escolhido.id >= inicioMes
      ? motivosDoDia(
          historico.filter((entry) => entry.date === escolhido.id && mesmoMolde(entry, machine, numero, referencia, turno)),
        )
      : (remoto?.find((item) => item.date === escolhido?.id)?.motivos ?? []);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">
              {machine} · {rotuloNumero(numero, referencia)}
            </h3>
            <p className="text-sm text-muted">
              {formatDateBR(INICIO_LINHA)} até {formatDateBR(ate)} · um ponto por dia
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-10 place-items-center rounded-xl text-[#1e3a5f]">
            <X className="size-5" />
          </button>
        </div>
        {carregando ? <p className="mt-4 text-sm text-muted">Carregando os dias…</p> : null}
        {falha ? <p className="mt-3 text-sm text-[#9b2c2c]">Não carregou o histórico. O mês que já está no painel continua visível.</p> : null}
        {!carregando && (pontos.length === 0 || pontos.every((ponto) => ponto.pares === 0)) ? (
          <p className="mt-4 text-sm text-muted">Sem perda de {formatDateBR(INICIO_LINHA)} até {formatDateBR(ate)}.</p>
        ) : null}
        {pontos.some((ponto) => ponto.pares > 0) && !carregando ? (
          <>
            <div className="mt-3 overflow-x-auto">
              <GraficoLinha pontos={pontos} ativo={escolhido?.id ?? null} onAtivo={setAtivo} />
            </div>
            {escolhido ? (
              <div className="mt-3 rounded-2xl border border-[#d5dee8] bg-[#f7f9fc] p-3">
                <p className="text-sm font-semibold">{escolhido.nome}</p>
                <p className="mt-1 font-display text-3xl leading-none tabular-nums">
                  {escolhido.pares} {escolhido.pares === 1 ? "par" : "pares"}
                </p>
                <p className="mt-3 text-xs font-bold uppercase tracking-wide text-[#1e3a5f]">Perdas deste número</p>
                {motivos.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">Sem perda neste dia.</p>
                ) : (
                  <ol className="mt-2 grid gap-1">
                    {motivos.map((item) => (
                      <li key={item.nome} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-semibold">{item.nome}</span>
                        <span className="shrink-0 tabular-nums">
                          {item.pares} {item.pares === 1 ? "sola" : "solas"}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ) : null}
            {leitura ? (
              <p
                className={cx(
                  "mt-1 text-sm font-semibold",
                  leitura.tom === "melhor" && "text-[#1d7a45]",
                  leitura.tom === "pior" && "text-[#9b2c2c]",
                  leitura.tom === "igual" && "text-muted",
                )}
              >
                {leitura.texto}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function BarraDash({
  aba,
  onAba,
  children,
}: {
  aba: "geral" | "diario";
  onAba: (aba: "geral" | "diario") => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#d5dee8] bg-white px-3 py-3 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
      <div className="grid h-11 shrink-0 grid-cols-2 overflow-hidden rounded-xl border border-[#d5dee8] lg:w-[26rem]">
        {(
          [
            ["geral", "Visão geral"],
            ["diario", "Acompanhamento diário"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onAba(id)}
            className={cx(
              "px-3 text-sm font-semibold lg:text-base",
              aba === id ? "bg-[#2457b8] text-white" : "bg-white text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CartaoResumo({
  titulo,
  unidade,
  valor,
  periodo,
  tom,
  linhas,
  aviso,
}: {
  titulo: string;
  unidade: string;
  valor: number | string;
  periodo: string;
  tom: "azul" | "escuro" | "claro";
  linhas: { nome: string; valor: number | string }[];
  aviso?: string;
}) {
  const claro = tom === "claro";
  return (
    <article
      className={cx(
        "rounded-2xl p-4",
        tom === "azul" && "bg-[#4682B4] text-white",
        tom === "escuro" && "bg-[#1e3a5f] text-white",
        claro && "border border-[#d5dee8] bg-white text-fg",
      )}
    >
      <p className={cx("text-xs font-semibold uppercase tracking-wide", claro ? "text-muted" : "text-white/75")}>{titulo}</p>
      <p className="mt-2 font-display text-4xl leading-none tabular-nums lg:text-5xl">{valor}</p>
      {aviso ? <p className={cx("mt-1 text-xs", claro ? "text-muted" : "text-white/80")}>{aviso}</p> : null}
      <p className={cx("mt-2 text-sm", claro ? "text-muted" : "text-white/75")}>
        {unidade ? `${unidade} · ` : ""}
        {periodo}
      </p>
      <div className={cx("mt-4 grid grid-cols-3 gap-2 border-t pt-3", claro ? "border-[#e6ebf2]" : "border-white/20")}>
        {linhas.map((linha) => (
          <div key={linha.nome}>
            <p className={cx("text-[11px]", claro ? "text-muted" : "text-white/70")}>{linha.nome}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums">{linha.valor}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

const COR_PRODUCAO = "#4682B4";
const COR_PERDA = "#e23b3b";

function BarrasDuplas({
  titulo,
  grupos,
  aviso,
}: {
  titulo: string;
  grupos: { id: string; nome: string; producao: number; perdas: number }[];
  aviso?: string;
}) {
  const maximo = Math.max(1, ...grupos.flatMap((item) => [item.producao, item.perdas]));
  const vazio = grupos.every((item) => item.producao === 0 && item.perdas === 0);
  return (
    <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{titulo}</h3>
        <div className="flex gap-3 text-xs font-semibold">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COR_PRODUCAO }} />
            Produção
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: COR_PERDA }} />
            Perdas
          </span>
        </div>
      </div>
      {aviso ? (
        <p className="mt-3 text-sm text-muted">{aviso}</p>
      ) : vazio ? (
        <p className="mt-3 text-sm text-muted">Sem apontamento neste recorte.</p>
      ) : (
        <div className="mt-4">
          <div className="flex items-end gap-1 border-b border-[#c5d0dc]">
            {grupos.map((item) => (
              <div key={item.id} className="flex min-w-0 flex-1 items-end justify-center gap-1">
                <BarraValor valor={item.producao} maximo={maximo} cor={COR_PRODUCAO} />
                <BarraValor valor={item.perdas} maximo={maximo} cor={COR_PERDA} />
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-1">
            {grupos.map((item) => (
              <span key={item.id} className="min-w-0 flex-1 text-center text-[11px] font-medium leading-tight text-[#3b4250]">
                {item.nome}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function BarraValor({ valor, maximo, cor }: { valor: number; maximo: number; cor: string }) {
  const altura = valor <= 0 ? 0 : Math.max(10, Math.round((valor / maximo) * 168));
  return (
    <span className="flex w-full max-w-7 flex-col items-center justify-end">
      <span className="mb-1 text-[11px] font-semibold tabular-nums" style={{ color: cor }}>
        {valor}
      </span>
      <span className="block w-full rounded-t-md" style={{ height: `${altura}px`, background: cor }} />
    </span>
  );
}

const CORES_FATIA = ["#e23b3b", "#f08a24", "#e2b423", "#2f9e6b", "#2aa0c7", "#3b6fe0", "#7a4fd4", "#d4538a", "#6b7280", "#8b5a2b", "#1f7a4d"];

function GraficoCircular({
  titulo,
  itens,
  onPick,
  aviso,
}: {
  titulo: string;
  itens: { id: string; nome: string; valor: number; ativo?: boolean }[];
  onPick?: (id: string) => void;
  aviso?: string;
}) {
  const total = itens.reduce((soma, item) => soma + item.valor, 0);
  const raio = 42;
  const volta = 2 * Math.PI * raio;
  let percorrido = 0;
  const fatias = itens.map((item, index) => {
    const parte = total > 0 ? item.valor / total : 0;
    const comprimento = parte * volta;
    const inicio = percorrido;
    percorrido += comprimento;
    return { ...item, index, parte, comprimento, inicio, cor: CORES_FATIA[index % CORES_FATIA.length] };
  });
  const frente = fatias.find((item) => item.ativo) ?? fatias[0];

  return (
    <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
      <h3 className="text-base font-semibold">{titulo}</h3>
      {aviso ? (
        <p className="mt-3 text-sm text-muted">{aviso}</p>
      ) : fatias.length === 0 || !frente ? (
        <p className="mt-3 text-sm text-muted">Sem apontamento neste recorte.</p>
      ) : (
        <>
          <div className="relative mx-auto mt-3 size-56">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="img" aria-label={titulo}>
              {fatias.map((item) => (
                <circle
                  key={item.id}
                  cx="60"
                  cy="60"
                  r={raio}
                  fill="none"
                  stroke={item.cor}
                  strokeWidth="16"
                  strokeDasharray={`${Math.max(item.comprimento - 1.5, 0)} ${volta}`}
                  strokeDashoffset={-item.inicio}
                  opacity={item.ativo === false ? 0.28 : 1}
                  className={onPick ? "cursor-pointer" : undefined}
                  onClick={() => onPick?.(item.id)}
                />
              ))}
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-12 text-center">
              <p className="font-display text-4xl leading-none tabular-nums">{frente.valor}</p>
              <p className="mt-1 text-[11px] font-semibold text-muted">{frente.valor === 1 ? "par" : "pares"}</p>
              <p className="mt-2 text-sm font-semibold leading-tight">{frente.nome}</p>
              <p className="text-xs font-semibold" style={{ color: frente.cor }}>
                {Math.round(frente.parte * 100)}%
              </p>
            </div>
          </div>
          <ul className="mt-3 grid gap-1.5">
            {fatias.map((item) => {
              const linha = (
                <>
                  <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: item.cor }} />
                  <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">{item.nome}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {item.valor} {item.valor === 1 ? "par" : "pares"} · {Math.round(item.parte * 100)}%
                  </span>
                </>
              );
              if (!onPick) {
                return (
                  <li key={item.id} className="flex items-start gap-2">
                    {linha}
                  </li>
                );
              }
              return (
                <li key={item.id}>
                  <button type="button" onClick={() => onPick(item.id)} className="flex w-full items-start gap-2 text-left">
                    {linha}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function RankingBarras({
  titulo,
  itens,
  onPick,
  vertical = false,
  aviso,
}: {
  titulo: string;
  itens: { id: string; nome: string; valor: number; extra?: string; ativo?: boolean }[];
  onPick?: (id: string) => void;
  vertical?: boolean;
  aviso?: string;
}) {
  const maximo = Math.max(1, ...itens.map((item) => item.valor));
  const total = itens.reduce((soma, item) => soma + item.valor, 0);
  return (
    <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
      <h3 className="text-base font-semibold">{titulo}</h3>
      {aviso ? (
        <p className="mt-3 text-sm text-muted">{aviso}</p>
      ) : itens.length === 0 || total === 0 ? (
        <p className="mt-3 text-sm text-muted">Sem apontamento neste recorte.</p>
      ) : vertical ? (
        <div className="mt-4">
          <div className="flex items-end gap-1 border-b border-[#c5d0dc]">
            {itens.map((item, index) => {
              const altura = item.valor <= 0 ? 0 : Math.max(6, Math.round((item.valor / maximo) * 132));
              const corpo = (
                <>
                  <span className="mb-1 text-xs font-semibold tabular-nums">{item.valor}</span>
                  <span
                    className="block w-full max-w-8 rounded-t-md"
                    style={{
                      height: `${altura}px`,
                      background: CORES_FATIA[index % CORES_FATIA.length],
                      opacity: item.ativo === false ? 0.35 : 1,
                    }}
                  />
                </>
              );
              const classe = "flex min-w-0 flex-1 flex-col items-center justify-end";
              if (!onPick) {
                return (
                  <div key={item.id} className={classe}>
                    {corpo}
                  </div>
                );
              }
              return (
                <button key={item.id} type="button" onClick={() => onPick(item.id)} className={classe}>
                  {corpo}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-1">
            {itens.map((item) => (
              <span key={item.id} className="min-w-0 flex-1 break-words whitespace-pre-line text-center text-[11px] font-medium leading-tight text-[#3b4250]">
                {item.nome}
                {item.extra ? <span className="mt-1 block text-[10px] font-normal text-muted">{item.extra}</span> : null}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <ol className="mt-3 grid gap-3">
          {itens.map((item, index) => {
            const largura = item.valor <= 0 ? 0 : Math.max(8, Math.round((item.valor / maximo) * 100));
            const percentual = total > 0 ? Math.round((item.valor / total) * 100) : 0;
            const corpo = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-semibold leading-snug">
                    <span className="mr-2 text-sm font-semibold tabular-nums" style={{ color: CORES_FATIA[index % CORES_FATIA.length] }}>
                      {index + 1}
                    </span>
                    {item.nome}
                  </p>
                  <p className="shrink-0 text-right text-xs font-semibold tabular-nums">
                    {item.valor} {item.valor === 1 ? "par" : "pares"}
                    <span className="block text-muted">{percentual}%</span>
                  </p>
                </div>
                <span className="mt-1.5 block h-2.5 overflow-hidden rounded-sm bg-[#e7eef5]">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${largura}%`,
                      background: CORES_FATIA[index % CORES_FATIA.length],
                      opacity: item.ativo === false ? 0.35 : 1,
                    }}
                  />
                </span>
                {item.extra ? <p className="mt-1 text-xs text-muted">{item.extra}</p> : null}
              </>
            );
            if (!onPick) return <li key={item.id}>{corpo}</li>;
            return (
              <li key={item.id}>
                <button type="button" onClick={() => onPick(item.id)} className="w-full text-left">
                  {corpo}
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function RankingNumeros({
  titulo,
  entries,
  limite = 12,
}: {
  titulo: string;
  entries: Entry[];
  limite?: number;
}) {
  const lista = rankNumeros(entries, limite);
  return (
    <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <p className="text-xs text-muted">{lista.reduce((soma, item) => soma + item.pares, 0)} pares</p>
      {lista.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Sem número apontado.</p>
      ) : (
        <ol className="mt-3 grid gap-2">
          {lista.map((item, index) => (
            <li key={item.chave} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 border-b border-[#f3f2f1] pb-2 last:border-b-0">
              <span className="font-display text-2xl leading-none text-accent">{index + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug">
                  {item.machine} · Nº {item.numero}
                  {item.referencia ? ` · Ref. ${item.referencia}` : " · sem ref."}
                </p>
                <p className="text-xs text-muted">{item.estacoes ? `Est. ${item.estacoes}` : "sem estação"}</p>
                <p className="text-xs font-semibold tabular-nums">
                  {item.pares} {item.pares === 1 ? "par" : "pares"} · {item.percentual}%
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function juntarHistorico(remoto: Entry[], local: Entry[], datas: Set<string>): Entry[] {
  const mapa = new Map(remoto.filter((entry) => datas.has(entry.date)).map((entry) => [entry.id, entry]));
  for (const entry of local) {
    if (datas.has(entry.date) && !mapa.has(entry.id)) mapa.set(entry.id, entry);
  }
  return [...mapa.values()];
}

function juntarProducao(remoto: ProducaoPares[], local: ProducaoPares[], datas: Set<string>): ProducaoPares[] {
  const mapa = new Map<string, ProducaoPares>();
  for (const item of [...remoto, ...local]) {
    const date = diaDoApontamento(item);
    if (!datas.has(date) || item.pares <= 0) continue;
    const normal = { ...item, date, id: `${date}|${item.turno}|${item.machine}|${item.numero}` };
    const prev = mapa.get(normal.id);
    if (!prev || item.salvoEm >= prev.salvoEm) mapa.set(normal.id, normal);
  }
  return [...mapa.values()];
}

function rankNumeros(entries: Entry[], limite = 12) {
  const grupos = new Map<string, { machine: string; numero: string; referencia: string; stations: Map<number, number>; itens: Entry[] }>();
  for (const entry of entries) {
    const numero = numeroLimpo(entry.matrizNumero);
    if (!numero) continue;
    const referencia = referenciaLimpa(entry.matrizRel);
    const chave = `${entry.machine}||${numero}||${referencia}`;
    const atual = grupos.get(chave) ?? {
      machine: entry.machine,
      numero,
      referencia,
      stations: new Map<number, number>(),
      itens: [],
    };
    atual.itens.push(entry);
    atual.stations.set(entry.station, (atual.stations.get(entry.station) ?? 0) + 1);
    grupos.set(chave, atual);
  }
  const total = entries.length;
  return [...grupos.values()]
    .map((item) => ({
      chave: `${item.machine}||${item.numero}||${item.referencia}`,
      machine: item.machine,
      numero: item.numero || "sem nº",
      referencia: item.referencia,
      estacoes: [...item.stations.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([station]) => pad2(station))
        .join(" · "),
      solas: item.itens.length,
      pares: paresDasEntradas(item.itens),
      percentual: total > 0 ? Math.round((item.itens.length / total) * 100) : 0,
    }))
    .sort((a, b) => b.solas - a.solas || a.machine.localeCompare(b.machine) || a.numero.localeCompare(b.numero, "pt-BR"))
    .slice(0, limite);
}

function PainelMesa({
  state,
  today,
  offDay,
  onDate,
  onTurno,
  papel,
  posto,
  onTrocar,
  shown,
  busy,
  onPhoto,
  onPdf,
  onDelete,
}: {
  state: State;
  today: string;
  offDay: boolean;
  onDate: (date: string) => void;
  onTurno: (turno: Turno) => void;
  papel: Papel;
  posto?: MachineId | null;
  onTrocar?: () => void;
  shown: MachineId[];
  busy: "foto" | "pdf" | null;
  onPhoto: () => void;
  onPdf: () => void;
  onDelete?: (entries: Entry[]) => void;
}) {
  const [foco, setFoco] = useState<MachineId | null>(null);
  const [estacao, setEstacao] = useState<number | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [pedirExclusao, setPedirExclusao] = useState(false);
  const recorte = foco && shown.includes(foco) ? shown.filter((machine) => machine === foco) : shown;
  const baseLinhas = linhasDaMesa(state, recorte);
  const numerosMesa = [
    ...new Set(
      baseLinhas
        .filter((linha) => estacao === null || linha.station === estacao)
        .map((linha) => linha.numero)
        .filter((item) => item.length > 0),
    ),
  ].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const numeroAtivo = numero && numerosMesa.includes(numero) ? numero : null;
  const linhas = baseLinhas.filter((linha) => {
    if (estacao !== null && linha.station !== estacao) return false;
    if (numeroAtivo !== null && (linha.numero || "sem nº") !== numeroAtivo) return false;
    return true;
  });
  const totalPares = linhas.reduce((sum, linha) => sum + linha.pares, 0);
  const porMaquina = shown.map((machine) => ({
    machine,
    solas: linhas.filter((linha) => linha.machine === machine).reduce((sum, linha) => sum + linha.pares, 0),
  }));
  const maxMaquina = Math.max(1, ...porMaquina.map((item) => item.solas));
  const porProblema = PROBLEMS.map((problem) => ({
    name: problem.name,
    solas: linhas.filter((linha) => linha.perda === problem.name).reduce((sum, linha) => sum + linha.pares, 0),
  }))
    .filter((item) => item.solas > 0)
    .sort((a, b) => b.solas - a.solas);
  const porEstacao = STATIONS.map((station) => ({
    nome: pad2(station),
    valor: baseLinhas
      .filter((linha) => linha.station === station && (numeroAtivo === null || (linha.numero || "sem nº") === numeroAtivo))
      .reduce((sum, linha) => sum + linha.solas, 0),
    ativo: estacao === null ? undefined : estacao === station,
  }));
  const porNumeroGraf = numerosMesa.map((item) => ({
    nome: item,
    valor: baseLinhas
      .filter((linha) => (estacao === null || linha.station === estacao) && (linha.numero || "sem nº") === item)
      .reduce((sum, linha) => sum + linha.solas, 0),
    ativo: numeroAtivo === null ? undefined : numeroAtivo === item,
  }));
  const porLado = SIDES.map((side) => ({
    nome: SIDE_SHORT[side],
    valor: linhas.filter((linha) => linha.side === side).reduce((sum, linha) => sum + linha.solas, 0),
  }));
  const refs = new Map<string, number>();
  for (const linha of linhas) refs.set(linha.referencia || "sem ref.", (refs.get(linha.referencia || "sem ref.") ?? 0) + linha.solas);
  const porRef = [...refs.entries()]
    .map(([nome, valor]) => ({ nome, valor }))
    .sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, "pt-BR"));
  const pior = porProblema[0];
  const autores = [
    ...new Set(
      recorte.flatMap((machine) =>
        shiftEntries(state, machine)
          .map((entry) => entry.autor.trim())
          .filter(Boolean),
      ),
    ),
  ];
  const editaveis = foco
    ? shiftEntries(state, foco).filter((entry) => podeAlterarApontamento(entry))
    : [];

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="grid min-w-0 gap-4">
        {papel === "preparador" && onTrocar ? (
          <button
            type="button"
            onClick={onTrocar}
            className="flex items-center justify-between rounded-3xl bg-white px-4 py-3 text-left shadow-[0_8px_24px_rgba(47,84,150,0.08)]"
          >
            <span>
              <span className="block text-sm text-muted">Sua máquina neste turno</span>
              <span className="font-display text-3xl leading-none">{posto ?? "Escolher"}</span>
            </span>
            <span className="text-sm font-semibold text-accent">{posto ? "Trocar" : "Escolher"}</span>
          </button>
        ) : null}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-fg">
              {papel === "lider" ? "Dashboard geral" : "Lançamentos"}
            </h2>
            <p className="text-sm text-muted">
              {formatDateBR(state.date)} · {TURNO_LABEL[state.turno]}
              {foco ? ` · ${foco}` : " · turno inteiro"}
              {estacao ? ` · Estação ${pad2(estacao)}` : ""}
              {numeroAtivo ? ` · Nº ${numeroAtivo}` : ""}
              {autores.length > 0 ? ` · ${autores.join(" · ")}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || shown.length === 0}
              onClick={onPhoto}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-[0_6px_16px_rgba(47,84,150,0.08)] disabled:opacity-50"
            >
              {busy === "foto" ? "Gerando imagens…" : "Baixar imagens"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi tom="roxo" titulo="Pares" valor={String(totalPares)} />
          <Kpi tom="ciano" titulo="Máquinas" valor={String(recorte.length)} />
          <Kpi tom="verde" titulo="Maior perda" valor={pior ? String(pior.solas) : "—"} detalhe={pior?.name} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
            <h3 className="text-base font-semibold">Pares por máquina</h3>
            <Barras
              itens={porMaquina.map((item) => ({
                nome: item.machine,
                valor: item.solas,
                ativo: foco ? foco === item.machine : undefined,
              }))}
              maximo={maxMaquina}
              onPick={(nome) => setFoco((atual) => (atual === nome ? null : (nome as MachineId)))}
            />
          </section>
          <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
            <h3 className="text-base font-semibold">Composição das perdas</h3>
            <div className="mt-2">
              <Rosca fatias={porProblema.map((item) => ({ nome: item.name, valor: item.solas }))} />
            </div>
          </section>
        </div>

        <RankingNumeros
          titulo={
            foco
              ? `Ranking da ${foco}${estacao ? ` · Estação ${pad2(estacao)}` : ""}`
              : estacao
                ? `Ranking da estação ${pad2(estacao)}`
                : "Ranking do turno"
          }
          entries={recorte.flatMap((machine) =>
            shiftEntries(state, machine).filter((entry) => estacao === null || entry.station === estacao),
          )}
        />

        {foco ? (
          <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-semibold">Matrizaria · {foco}</h3>
              {onDelete && editaveis.length > 0 ? (
                pedirExclusao ? (
                  <span className="flex items-center gap-2 text-sm">
                    <span>Excluir {editaveis.length} apontamentos abertos?</span>
                    <button type="button" onClick={() => setPedirExclusao(false)} className="font-semibold text-muted">
                      Não
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPedirExclusao(false);
                        onDelete(editaveis);
                      }}
                      className="rounded-full bg-[#9b3a34] px-3 py-1 font-semibold text-white"
                    >
                      Excluir
                    </button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setPedirExclusao(true)} className="text-sm font-semibold text-[#9b3a34]">
                    Excluir apontamentos abertos
                  </button>
                )
              ) : null}
            </div>
            <GradeSomenteLeitura state={state} machine={foco} />
          </section>
        ) : null}

        <section className="overflow-hidden rounded-3xl bg-white shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="text-base font-semibold">Detalhe do apontamento</h3>
            <p className="text-xs text-muted">{linhas.length} linhas</p>
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-[#f6f8fc] text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  {["Máquina", "Estação", "Lado", "Nº", "Ref.", "Perda", "Solas", "Pares"].map((coluna) => (
                    <th key={coluna} className="whitespace-nowrap px-3 py-2 font-semibold">
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {linhas.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted">
                      Nenhum apontamento neste recorte.
                    </td>
                  </tr>
                ) : (
                  linhas.map((linha, index) => (
                    <tr key={linha.key} className={index % 2 === 0 ? "bg-white" : "bg-[#f8fafc]"}>
                      <td className="whitespace-nowrap px-3 py-1.5 font-semibold">{linha.machine}</td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {linha.outroId ? `Troca ${linha.station >= 1 ? pad2(linha.station) : ""}`.trim() : pad2(linha.station)}
                      </td>
                      <td className="px-3 py-1.5">{SIDE_SHORT[linha.side]}</td>
                      <td className="px-3 py-1.5">{linha.numero || "—"}</td>
                      <td className="px-3 py-1.5">{linha.referencia || "—"}</td>
                      <td className="px-3 py-1.5">{linha.perda}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{linha.solas}</td>
                      <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{linha.pares}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <aside className="grid content-start gap-4 xl:sticky xl:top-3">
        <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
          <p className="text-sm font-semibold">Filtros</p>
          <div className="mt-3">
            <SeletorDia date={state.date} today={today} onDate={onDate} />
          </div>
          <p className="mt-4 text-xs font-semibold text-muted">Turno</p>
          {papel === "lider" ? (
            <div className="mt-1">
              <TurnoPicker value={state.turno} onChange={onTurno} />
            </div>
          ) : (
            <p className="mt-1 rounded-xl bg-[#f7f9fc] px-3 py-2 text-sm font-semibold">{TURNO_LABEL[state.turno]}</p>
          )}
        </section>
        <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
          <p className="text-sm font-semibold">Máquina</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setFoco(null)}
              className={cx(
                "rounded-xl px-2 py-2 text-left text-sm font-semibold",
                foco === null ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
              )}
            >
              Todas
            </button>
            {shown.map((machine) => (
              <button
                key={machine}
                type="button"
                onClick={() => setFoco((atual) => (atual === machine ? null : machine))}
                className={cx(
                  "rounded-xl px-2 py-2 text-left text-sm font-semibold",
                  foco === machine ? "bg-[#2457b8] text-white" : "bg-[#f3f6fb] text-fg",
                )}
              >
                {machine}
              </button>
            ))}
          </div>
          {shown.length === 0 ? <p className="mt-2 text-sm text-muted">Nenhuma máquina neste turno.</p> : null}
        </section>
        <FiltrosRecorte
          estacao={estacao}
          numero={numeroAtivo}
          numeros={numerosMesa}
          onEstacao={setEstacao}
          onNumero={setNumero}
        />
        {papel === "lider" ? <MatrizariaConsulta state={state} ocultar={shown} /> : null}
      </aside>
    </div>
  );
}

const CORES = ["#2f6fe0", "#6d5ef5", "#2bb3c7", "#3dcea0", "#ef6b7a", "#f0a04b", "#7aa2ff", "#8b7cf7", "#2457b8", "#14b8a6", "#fb7185"];

function Kpi({
  titulo,
  valor,
  detalhe,
  tom,
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
  tom: "roxo" | "azul" | "ciano" | "verde";
}) {
  const fundo = {
    roxo: "bg-gradient-to-br from-[#6a4cff] to-[#8d74ff]",
    azul: "bg-gradient-to-br from-[#2457d6] to-[#4d86f5]",
    ciano: "bg-gradient-to-br from-[#128fb8] to-[#3ec8dc]",
    verde: "bg-gradient-to-br from-[#129a78] to-[#3ddea4]",
  }[tom];
  return (
    <section className={cx("rounded-3xl px-4 py-4 text-white shadow-[0_12px_28px_rgba(47,84,150,0.16)]", fundo)}>
      <p className="text-sm font-semibold text-white/80">{titulo}</p>
      <p className="mt-2 font-display text-5xl leading-none tabular-nums">{valor}</p>
      {detalhe ? <p className="mt-2 line-clamp-2 text-xs leading-snug text-white/85">{detalhe}</p> : null}
    </section>
  );
}

function Rosca({ fatias }: { fatias: { nome: string; valor: number }[] }) {
  const total = fatias.reduce((soma, item) => soma + item.valor, 0);
  if (total <= 0) return <p className="py-8 text-sm text-muted">Sem perda neste recorte.</p>;
  const raio = 58;
  const volta = 2 * Math.PI * raio;
  let cursor = 0;
  const partes = fatias.map((item, index) => {
    const fatia = (item.valor / total) * volta;
    const parte = { ...item, fatia, resto: volta - fatia, inicio: cursor, cor: CORES[index % CORES.length] ?? CORES[0] };
    cursor += fatia;
    return parte;
  });
  return (
    <div className="grid items-center gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <svg viewBox="0 0 160 160" className="mx-auto h-52 w-52" role="img" aria-label="Composição das perdas">
        <g transform="rotate(-90 80 80)">
          {partes.map((parte) => (
            <circle
              key={parte.nome}
              cx="80"
              cy="80"
              r={raio}
              fill="none"
              stroke={parte.cor}
              strokeWidth="22"
              strokeDasharray={`${parte.fatia} ${parte.resto}`}
              strokeDashoffset={-parte.inicio}
            />
          ))}
        </g>
        <circle cx="80" cy="80" r="40" fill="white" />
        <text x="80" y="76" textAnchor="middle" className="fill-[#1d2a3a] text-[11px] font-semibold">
          Pares
        </text>
        <text x="80" y="94" textAnchor="middle" className="fill-[#1d2a3a] text-[16px] font-semibold">
          {total}
        </text>
      </svg>
      <ul className="grid gap-2">
        {partes.map((parte) => (
          <li key={parte.nome} className="grid grid-cols-[0.7rem_minmax(0,1fr)_auto] items-start gap-2 text-sm">
            <span className="mt-1 size-2.5 rounded-full" style={{ background: parte.cor }} />
            <span className="leading-snug">{parte.nome}</span>
            <span className="font-semibold tabular-nums">{Math.round((parte.valor / total) * 1000) / 10}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Barras({
  itens,
  maximo,
  onPick,
  largo,
}: {
  itens: { nome: string; valor: number; ativo?: boolean }[];
  maximo: number;
  onPick?: (nome: string) => void;
  largo?: boolean;
}) {
  if (itens.length === 0) return <p className="py-8 text-sm text-muted">Sem apontamento neste recorte.</p>;
  return (
    <div className="mt-3 grid gap-2.5">
      {itens.map((item, index) => {
        const barra = (
          <span className="h-3 overflow-hidden rounded-full bg-[#eef2f8]">
            <span
              className="block h-full rounded-full"
              style={{
                width: item.valor <= 0 ? "0%" : `${Math.max(6, (item.valor / maximo) * 100)}%`,
                background: `linear-gradient(90deg, ${CORES[index % CORES.length]}, #8eb6ff)`,
                opacity: item.ativo === false ? 0.35 : 1,
              }}
            />
          </span>
        );
        const corpo = largo ? (
          <>
            <span className="flex items-start justify-between gap-3 text-xs font-semibold leading-snug">
              <span>{item.nome}</span>
              <span className="tabular-nums">{item.valor}</span>
            </span>
            {barra}
          </>
        ) : (
          <>
            <span className="text-xs font-semibold">{item.nome}</span>
            {barra}
            <span className="text-right text-sm font-semibold tabular-nums">{item.valor}</span>
          </>
        );
        const classe = largo
          ? "grid gap-1 text-left"
          : "grid grid-cols-[4.6rem_minmax(0,1fr)_2.4rem] items-center gap-2 text-left";
        if (!onPick) {
          return (
            <div key={item.nome} className={classe}>
              {corpo}
            </div>
          );
        }
        return (
          <button key={item.nome} type="button" onClick={() => onPick(item.nome)} className={classe}>
            {corpo}
          </button>
        );
      })}
    </div>
  );
}

function LinhasTurno({
  dias,
  series,
}: {
  dias: string[];
  series: { nome: string; cor: string; valores: number[] }[];
}) {
  const largura = 720;
  const altura = 220;
  const esquerda = 32;
  const direita = 8;
  const topo = 16;
  const base = 26;
  const maximo = Math.max(1, ...series.flatMap((serie) => serie.valores));
  const mioloL = largura - esquerda - direita;
  const mioloA = altura - topo - base;
  const xDe = (index: number) => esquerda + (dias.length <= 1 ? mioloL / 2 : (index / (dias.length - 1)) * mioloL);
  const yDe = (valor: number) => topo + mioloA - (valor / maximo) * mioloA;
  return (
    <svg viewBox={`0 0 ${largura} ${altura}`} className="mt-2 h-56 w-full" role="img" aria-label="Solas por turno">
      {[0, 0.5, 1].map((passo) => {
        const y = topo + mioloA - passo * mioloA;
        return <line key={passo} x1={esquerda} x2={largura - direita} y1={y} y2={y} stroke="#e6edf5" />;
      })}
      {series.map((serie) => {
        const linha = serie.valores
          .map((valor, index) => `${index === 0 ? "M" : "L"}${xDe(index).toFixed(1)},${yDe(valor).toFixed(1)}`)
          .join(" ");
        return (
          <path key={serie.nome} d={linha} fill="none" stroke={serie.cor} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
        );
      })}
      {dias.map((dia, index) =>
        index % Math.ceil(dias.length / 6) === 0 ? (
          <text key={dia + index} x={xDe(index)} y={altura - 6} textAnchor="middle" className="fill-[#64748b] text-[11px]">
            {dia}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function linhasDaMesa(state: State, machines: MachineId[]) {
  return machines.flatMap((machine) =>
    fichaLines(state, machine).flatMap((line) =>
      PROBLEMS.flatMap((problem, index) => {
        const solas = line.counts[index] ?? 0;
        if (solas <= 0) return [];
        return [
          {
            key: `${machine}-${line.outroId || line.station}-${line.side}-${problem.id}`,
            machine,
            station: line.station,
            side: line.side,
            outroId: line.outroId,
            numero: line.numero,
            referencia: line.referencia,
            perda: problem.name,
            cor: line.cor,
            solas,
            pares: pares(solas),
          },
        ];
      }),
    ),
  );
}

function MatrizariaConsulta({ state, ocultar }: { state: State; ocultar: MachineId[] }) {
  const [aberta, setAberta] = useState<MachineId | null>(null);
  const machines = MACHINES.filter(
    (machine) => machineHasMatrices(state, machine) && !ocultar.includes(machine),
  );
  if (machines.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-sm font-semibold text-muted">Matrizes sem apontamento</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {machines.map((machine) => (
          <button
            key={machine}
            type="button"
            onClick={() => setAberta((atual) => (atual === machine ? null : machine))}
            className={cx(
              "rounded-tile border px-2 py-3 font-display text-2xl leading-none",
              aberta === machine ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface",
            )}
          >
            {machine}
          </button>
        ))}
      </div>
      {aberta ? <GradeSomenteLeitura state={state} machine={aberta} /> : null}
    </div>
  );
}

function MatrizesDaMaquina({ state, machine }: { state: State; machine: MachineId }) {
  const [open, setOpen] = useState(false);
  if (!machineHasMatrices(state, machine)) return null;
  return (
    <div className="px-3 pt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-11 w-full items-center justify-center rounded-tile bg-accent-soft font-semibold text-accent"
      >
        {open ? "Ocultar matrizes" : "Ver matrizes"}
      </button>
      {open ? <GradeSomenteLeitura state={state} machine={machine} /> : null}
    </div>
  );
}

function GradeSomenteLeitura({ state, machine }: { state: State; machine: MachineId }) {
  return (
    <div className="mt-2 grid gap-2">
      {STATIONS.map((station) => {
        const config = state.stations[stationKey(machine, station)];
        const esq = describeMatrix(config, "esq");
        const dir = describeMatrix(config, "dir");
        return (
          <div key={station} className="rounded-tile border border-line bg-surface-2 px-3 py-2">
            <p className="font-display text-xl leading-none">Estação {pad2(station)}</p>
            {config?.ambos ? (
              <p className="mt-1 text-sm font-semibold leading-snug">Ambos · {esq || "sem numeração"}</p>
            ) : (
              <>
                <p className="mt-1 text-sm leading-snug">
                  <span className="font-semibold text-muted">Esq. </span>
                  {esq || "sem numeração"}
                </p>
                <p className="text-sm leading-snug">
                  <span className="font-semibold text-muted">Dir. </span>
                  {dir || "sem numeração"}
                </p>
              </>
            )}
          </div>
        );
      })}
      {state.outros
        .filter((item) => outroVivo(item) && item.machine === machine && item.date === state.date && item.turno === state.turno)
        .map((item) => (
          <div key={item.id} className="rounded-tile border border-accent bg-surface-2 px-3 py-2">
            <p className="font-display text-xl leading-none">
              {item.station >= 1 ? `Troca · Estação ${pad2(item.station)}` : "Troca de matriz"}
            </p>
            <p className="mt-1 text-sm font-semibold leading-snug">
              {item.ambos ? "Ambos os lados" : SIDE_LABEL[item.side]} · {numeroLimpo(item.numero) || "—"}
              {item.referencia ? ` · ${item.referencia}` : ""}
            </p>
          </div>
        ))}
    </div>
  );
}

function numerosCorrecao(state: State, machine: MachineId, date: string, turno: Turno, extras: string[]) {
  const vistos = new Set<string>();
  const lista: string[] = [];
  function incluir(numero: string) {
    const limpo = numeroLimpo(numero);
    if (!limpo || vistos.has(limpo)) return;
    vistos.add(limpo);
    lista.push(limpo);
  }
  for (const station of STATIONS) {
    const config = state.stations[stationKey(machine, station)];
    if (!config) continue;
    if (config.ambos) incluir(config.numero);
    else {
      incluir(config.esq.numero);
      incluir(config.dir.numero);
    }
  }
  for (const outro of state.outros) {
    if (!outroVivo(outro) || outro.machine !== machine || outro.date !== date || outro.turno !== turno) continue;
    incluir(outro.numero);
  }
  for (const item of state.producao ?? []) {
    if (diaDoApontamento(item) === date && item.turno === turno && item.machine === machine) incluir(item.numero);
  }
  for (const extra of extras) incluir(extra);
  return lista.sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

function CorrigirProducao({
  state,
  date,
  turno,
  machine,
  onClose,
  onSave,
}: {
  state: State;
  date: string;
  turno: Turno;
  machine: MachineId;
  onClose: () => void;
  onSave: (date: string, turno: Turno, machine: MachineId, valores: Record<string, number>) => void;
}) {
  const [extras, setExtras] = useState<string[]>([]);
  const [novo, setNovo] = useState("");
  const numeros = numerosCorrecao(state, machine, date, turno, extras);
  const [valores, setValores] = useState<Record<string, string>>({});

  useEffect(() => {
    let vivo = true;
    const local: Record<string, string> = {};
    for (const item of state.producao ?? []) {
      if (diaDoApontamento(item) !== date || item.turno !== turno || item.machine !== machine || item.pares <= 0) continue;
      local[numeroLimpo(item.numero)] = String(item.pares);
    }
    setValores(local);
    void pullHistorico({ data: { desde: date, ate: date } })
      .then((resultado) => {
        if (!vivo) return;
        setValores((atual) => {
          const proximo = { ...atual };
          for (const item of resultado.producao ?? []) {
            if (diaDoApontamento(item) !== date || item.turno !== turno || item.machine !== machine || item.pares <= 0) continue;
            const numero = numeroLimpo(item.numero);
            if (!proximo[numero]) proximo[numero] = String(item.pares);
          }
          return proximo;
        });
      })
      .catch(() => {
        /* o que já está neste celular continua editável */
      });
    return () => {
      vivo = false;
    };
  }, [date, turno, machine]);

  function acrescentar() {
    const limpo = numeroLimpo(novo);
    if (!limpo) return;
    setExtras((atual) => (atual.includes(limpo) ? atual : [...atual, limpo]));
    setNovo("");
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Produção · {machine}</h3>
            <p className="text-sm text-muted">
              {formatDateBR(date)} · {TURNO_LABEL[turno]}. Campo vazio não altera. Zero zera.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-10 place-items-center rounded-xl text-[#1e3a5f]">
            <X className="size-5" />
          </button>
        </div>
        {numeros.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nenhum número nesta máquina. Acrescente o do relatório.</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {numeros.map((numero) => (
              <label key={numero} className="rounded-2xl border border-[#d5dee8] bg-[#f7f9fc] p-3 text-center">
                <span className="font-display text-2xl leading-none">{numero}</span>
                <input
                  inputMode="numeric"
                  value={valores[numero] ?? ""}
                  aria-label={`Pares de ${numero}`}
                  placeholder="0"
                  onChange={(event) => {
                    const limpo = event.target.value.replace(/\D/g, "").slice(0, 6);
                    setValores((atual) => ({ ...atual, [numero]: limpo }));
                  }}
                  className="mt-2 w-full rounded-xl border border-[#d5dee8] bg-white px-2 py-2 text-center font-display text-2xl leading-none tabular-nums outline-none"
                />
              </label>
            ))}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={novo}
            placeholder="Outro número"
            maxLength={32}
            onChange={(event) => setNovo(event.target.value)}
            className="min-w-0 flex-1 rounded-xl border border-[#d5dee8] bg-[#f7f9fc] px-3 py-3 text-base"
          />
          <button type="button" onClick={acrescentar} className="rounded-xl bg-[#f3f6fb] px-3 text-sm font-semibold">
            Incluir
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            const gravar: Record<string, number> = {};
            for (const numero of numeros) {
              const texto = valores[numero];
              if (texto === undefined || texto === "") continue;
              gravar[numero] = Number(texto) || 0;
            }
            onSave(date, turno, machine, gravar);
          }}
          className="mt-4 w-full rounded-2xl bg-[#2457b8] py-3 text-sm font-semibold text-white"
        >
          Salvar produção
        </button>
      </div>
    </div>
  );
}

type SolaCorrecao = {
  date: string;
  turno: Turno;
  machine: MachineId;
  station: number;
  side: Side;
  problem: string;
  matrizNumero: string;
  matrizRel: string;
  outroId: string;
  corId: string;
  corNome: string;
};

function gruposDePerda(state: State, machine: MachineId) {
  const grupos = new Map<string, { rotulo: string; detalhe: string; ids: string[]; amostra: SolaCorrecao }>();
  for (const entry of shiftEntries(state, machine)) {
    const chave = `${entry.station}|${entry.side}|${entry.problem}|${entry.matrizNumero}|${entry.matrizRel}|${entry.outroId}`;
    const atual = grupos.get(chave);
    if (atual) {
      atual.ids.push(entry.id);
      continue;
    }
    const numero = numeroLimpo(entry.matrizNumero);
    grupos.set(chave, {
      rotulo: problemName(entry.problem),
      detalhe: [`Est. ${pad2(entry.station)}`, SIDE_SHORT[entry.side], numero || "sem nº"].join(" · "),
      ids: [entry.id],
      amostra: {
        date: entry.date,
        turno: entry.turno,
        machine: entry.machine,
        station: entry.station,
        side: entry.side,
        problem: entry.problem,
        matrizNumero: entry.matrizNumero,
        matrizRel: entry.matrizRel,
        outroId: entry.outroId,
        corId: entry.corId,
        corNome: entry.corNome,
      },
    });
  }
  return [...grupos.values()].sort((a, b) => b.ids.length - a.ids.length || a.rotulo.localeCompare(b.rotulo, "pt-BR"));
}

function EditarPerdas({
  state,
  machine,
  onClose,
  onLancar,
  onApagar,
}: {
  state: State;
  machine: MachineId;
  onClose: () => void;
  onLancar: (sola: SolaCorrecao) => void;
  onApagar: (id: string) => void;
}) {
  const grupos = gruposDePerda(state, machine);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">Perdas · {machine}</h3>
            <p className="text-sm text-muted">
              {formatDateBR(state.date)} · {TURNO_LABEL[state.turno]}. Cada mais é uma sola.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar" className="grid size-10 place-items-center rounded-xl text-[#1e3a5f]">
            <X className="size-5" />
          </button>
        </div>
        {grupos.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nenhuma perda nesta máquina neste turno.</p>
        ) : (
          <div className="mt-3 grid gap-2">
            {grupos.map((grupo) => (
              <div key={grupo.ids[0]} className="flex items-center gap-2 rounded-2xl border border-[#d5dee8] px-2 py-2">
                <button
                  type="button"
                  aria-label={`Diminuir ${grupo.rotulo}`}
                  onClick={() => onApagar(grupo.ids[grupo.ids.length - 1] ?? "")}
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#f3f6fb] text-lg font-semibold"
                >
                  −
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{grupo.rotulo}</p>
                  <p className="truncate text-xs text-muted">{grupo.detalhe}</p>
                </div>
                <p className="w-8 text-center font-display text-2xl leading-none tabular-nums">{grupo.ids.length}</p>
                <button
                  type="button"
                  aria-label={`Lançar ${grupo.rotulo}`}
                  onClick={() => onLancar(grupo.amostra)}
                  className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#2457b8] text-lg font-semibold text-white"
                >
                  +
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AcompanhamentoDiario({
  state,
  today,
  offDay,
  onDate,
  onTurno,
  shown,
  busy,
  onPhoto,
  onDelete,
  aba,
  onAba,
  onCorrigirProducao,
  onLancarPerda,
  onApagarPerda,
}: {
  state: State;
  today: string;
  offDay: boolean;
  onDate: (date: string) => void;
  onTurno: (turno: Turno) => void;
  shown: MachineId[];
  busy: "foto" | "pdf" | null;
  onPhoto: () => void;
  onDelete?: (entries: Entry[]) => void;
  aba: "geral" | "diario";
  onAba: (aba: "geral" | "diario") => void;
  onCorrigirProducao?: (date: string, machine: MachineId, turno: Turno, valores: Record<string, number>) => void;
  onLancarPerda?: (sola: SolaCorrecao) => void;
  onApagarPerda?: (id: string) => void;
}) {
  const [painel, setPainel] = useState<{ machine: MachineId; tipo: "apontamentos" | "matrizaria" } | null>(null);
  const [pedir, setPedir] = useState(false);
  const [edicao, setEdicao] = useState<{ machine: MachineId; passo: "escolha" | "producao" | "perdas" } | null>(null);
  const visiveis = maquinasDoFiltro(state.modelos);
  const aberta = painel ? visiveis.find((machine) => machine === painel.machine) ?? null : null;
  const linhas = aberta ? fichaLines(state, aberta) : [];
  const estacoes = aberta ? estacoesDoDia(state, aberta, linhas).filter((item) => item.pares > 0) : [];
  const editaveis = aberta ? shiftEntries(state, aberta).filter((entry) => podeAlterarApontamento(entry)) : [];

  function abrir(machine: MachineId, tipo: "apontamentos" | "matrizaria") {
    setPedir(false);
    setPainel({ machine, tipo });
  }

  return (
    <div className="grid min-w-0 gap-3">
      <BarraDash aba={aba} onAba={onAba}>
        <span className="text-sm font-semibold text-muted">{formatDateBR(state.date)}</span>
      </BarraDash>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 max-w-md flex-1">
          <TurnoPicker value={state.turno} onChange={onTurno} />
        </div>
        <button
          type="button"
          disabled={busy !== null || shown.length === 0}
          onClick={onPhoto}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold shadow-[0_6px_16px_rgba(47,84,150,0.08)] disabled:opacity-50"
        >
          <ImageDown className="size-4" />
          {busy === "foto" ? "Gerando…" : "Baixar imagens"}
        </button>
      </div>
      <DayControls state={state} today={today} offDay={offDay} teto={todayISO()} onDate={onDate} />
      {edicao?.passo === "escolha" ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setEdicao(null);
          }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <p className="text-center font-display text-3xl leading-none">{edicao.machine}</p>
            <p className="mt-1 text-center text-sm text-muted">O que editar?</p>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => setEdicao({ machine: edicao.machine, passo: "producao" })}
                className="rounded-2xl bg-[#2457b8] py-3 text-sm font-semibold text-white"
              >
                Produção
              </button>
              <button
                type="button"
                onClick={() => setEdicao({ machine: edicao.machine, passo: "perdas" })}
                className="rounded-2xl bg-[#f3f6fb] py-3 text-sm font-semibold"
              >
                Perdas
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {edicao?.passo === "producao" && onCorrigirProducao ? (
        <CorrigirProducao
          state={state}
          date={state.date}
          turno={state.turno}
          machine={edicao.machine}
          onClose={() => setEdicao(null)}
          onSave={(date, turno, machine, valores) => {
            onCorrigirProducao(date, machine, turno, valores);
            setEdicao(null);
          }}
        />
      ) : null}
      {edicao?.passo === "perdas" && onLancarPerda && onApagarPerda ? (
        <EditarPerdas
          state={state}
          machine={edicao.machine}
          onClose={() => setEdicao(null)}
          onLancar={onLancarPerda}
          onApagar={onApagarPerda}
        />
      ) : null}
      {visiveis.length === 0 ? (
        <p className="rounded-tile border border-dashed border-line bg-surface px-4 py-6 text-center text-base text-muted">
          Nenhuma máquina apontada neste turno.
        </p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((machine) => {
            const linhasCard = fichaLines(state, machine);
            const paresMaquina = paresDasEntradas(shiftEntries(state, machine));
            const producaoMaquina = (state.producao ?? [])
              .filter((item) => diaDoApontamento(item) === state.date && item.turno === state.turno && item.machine === machine)
              .reduce((soma, item) => soma + item.pares, 0);
            const piores = topProblems(linhasCard);
            return (
              <article key={machine} className="flex min-w-0 flex-col rounded-3xl bg-white p-3 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-3xl leading-none">{machine}</h3>
                  <button
                    type="button"
                    onClick={() => setEdicao({ machine, passo: "escolha" })}
                    className="rounded-xl border border-[#d5dee8] bg-[#f7f9fc] px-3 py-2 text-sm font-semibold text-[#1e3a5f]"
                  >
                    Editar
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1 text-center">
                  <div>
                    <p className="text-[11px] font-semibold text-muted">Produção</p>
                    <p className="font-display text-2xl leading-none tabular-nums">{producaoMaquina}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-muted">Perdas</p>
                    <p className="font-display text-2xl leading-none tabular-nums">{paresMaquina}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold text-muted">%</p>
                    <p className="font-display text-2xl leading-none tabular-nums">
                      {textoPercentual(percentualPerda(paresMaquina, producaoMaquina))}
                    </p>
                  </div>
                </div>
                {piores.length > 0 ? (
                  <ol className="mt-3 grid gap-1.5">
                    {piores.map((item, index) => (
                      <li key={item.name} className="flex items-start gap-2">
                        <span className="w-4 shrink-0 font-display text-lg leading-none text-accent">{index + 1}</span>
                        <span className="min-w-0 flex-1 break-words text-sm font-semibold leading-snug">{item.name}</span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums">{item.pares}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-3 text-sm text-muted">Nenhuma perda passou de 2 solas.</p>
                )}
                <div className="mt-auto grid gap-2 pt-3">
                  <button
                    type="button"
                    onClick={() => abrir(machine, "apontamentos")}
                    className="rounded-2xl bg-[#4682B4] py-2.5 text-sm font-semibold text-white"
                  >
                    Apontamentos
                  </button>
                  <button
                    type="button"
                    onClick={() => abrir(machine, "matrizaria")}
                    className="rounded-2xl bg-[#f3f6fb] py-2.5 text-sm font-semibold text-[#4682B4]"
                  >
                    Estações
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {painel && aberta ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPainel(null);
          }}
        >
          <div className="flex max-h-[85dvh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-xl">
            <div className="flex items-center justify-between gap-3 border-b border-[#f3f2f1] px-4 py-3">
              <h3 className="font-display text-3xl leading-none">
                {aberta}
                <span className="ml-2 text-base font-semibold text-muted">
                  {painel.tipo === "matrizaria" ? "Estações" : "Apontamentos"}
                </span>
              </h3>
              <button type="button" onClick={() => setPainel(null)} className="text-sm font-semibold text-muted">
                Fechar
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-4">
              {painel.tipo === "matrizaria" ? (
                <GradeSomenteLeitura state={state} machine={aberta} />
              ) : estacoes.length === 0 ? (
                <p className="text-sm text-muted">Sem estação apontada.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {estacoes.map((item) => (
                    <article key={item.chave} className="rounded-2xl bg-[#f7f9fd] p-3">
                      <h4 className="font-display text-2xl leading-none">
                        {item.troca ? "Troca " : ""}
                        {item.titulo}
                      </h4>
                      <div className="mt-2 grid gap-2">
                        {item.lados.map((lado) => (
                          <div key={lado.lado}>
                            <p className="text-xs font-semibold text-muted">{lado.lado}</p>
                            <p className="text-sm font-semibold leading-snug">{lado.texto}</p>
                            <p className="text-sm tabular-nums">
                              {lado.pares} {lado.pares === 1 ? "par" : "pares"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {painel.tipo === "apontamentos" && onDelete && editaveis.length > 0 ? (
                pedir ? (
                  <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[#f7f9fd] px-3 py-2">
                    <span className="min-w-0 flex-1 text-sm font-semibold">
                      Excluir {editaveis.length} apontamento{editaveis.length === 1 ? "" : "s"} desta máquina?
                    </span>
                    <button type="button" onClick={() => setPedir(false)} className="text-sm font-semibold text-muted">
                      Não
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPedir(false);
                        setPainel(null);
                        onDelete(editaveis);
                      }}
                      className="rounded-xl bg-[#9b3a34] px-3 py-2 text-sm font-semibold text-white"
                    >
                      Excluir
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => setPedir(true)} className="mt-3 text-sm font-semibold text-[#9b3a34]">
                    Excluir apontamentos
                  </button>
                )
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MaquinaDoDia({
  state,
  machine,
  aberta,
  onToggle,
  onDelete,
}: {
  state: State;
  machine: MachineId;
  aberta: boolean;
  onToggle: () => void;
  onDelete?: (entries: Entry[]) => void;
}) {
  const lines = fichaLines(state, machine);
  const mine = shiftEntries(state, machine);
  const paresMaquina = paresDasEntradas(mine);
  const piores = topProblems(lines);
  const [pedir, setPedir] = useState(false);
  const [grade, setGrade] = useState(false);
  const editaveis = mine.filter((entry) => podeAlterarApontamento(entry));
  const estacoes = estacoesDoDia(state, machine, lines).filter((item) => item.pares > 0);

  return (
    <section className="overflow-hidden rounded-3xl bg-white shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
      <button type="button" onClick={onToggle} aria-expanded={aberta} className="w-full px-4 py-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-4xl leading-none">{machine}</h3>
            <p className="mt-1 text-sm text-muted">
              {paresMaquina} {paresMaquina === 1 ? "par" : "pares"}
            </p>
          </div>
          <ChevronDown className={cx("mt-1 size-6 shrink-0 text-muted transition-transform", aberta && "rotate-180")} />
        </div>
        {piores.length > 0 ? (
          <ol className="mt-3 grid gap-1.5">
            {piores.map((item, index) => (
              <li key={item.name} className="flex items-start gap-2">
                <span className="w-5 shrink-0 font-display text-xl leading-none text-accent">{index + 1}</span>
                <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">{item.name}</span>
                <span className="shrink-0 text-xs font-semibold tabular-nums">
                  {item.pares} {item.pares === 1 ? "par" : "pares"}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted">Nenhuma perda passou de 2 solas.</p>
        )}
      </button>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => setGrade((value) => !value)}
          className="flex min-h-11 w-full items-center justify-center rounded-2xl bg-[#f3f6fb] text-sm font-semibold text-[#4682B4]"
        >
          {grade ? "Ocultar matrizaria" : "Ver matrizaria"}
        </button>
        {grade ? <GradeSomenteLeitura state={state} machine={machine} /> : null}
      </div>
      {aberta ? (
        <div className="border-t border-[#f3f2f1] px-3 py-3">
          {estacoes.length === 0 ? (
            <p className="text-sm text-muted">Sem estação apontada.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {estacoes.map((item) => (
                <article key={item.chave} className="rounded-2xl bg-[#f7f9fd] p-3">
                  <h4 className="font-display text-2xl leading-none">
                    {item.troca ? "Troca " : ""}
                    {item.titulo}
                  </h4>
                  <div className="mt-2 grid gap-2">
                    {item.lados.map((lado) => (
                      <div key={lado.lado}>
                        <p className="text-xs font-semibold text-muted">{lado.lado}</p>
                        <p className="text-sm font-semibold leading-snug">{lado.texto}</p>
                        <p className="text-sm tabular-nums">
                          {lado.pares} {lado.pares === 1 ? "par" : "pares"}
                        </p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
          {onDelete && editaveis.length > 0 ? (
            pedir ? (
              <div className="mt-3 flex items-center gap-2 rounded-2xl bg-[#f7f9fd] px-3 py-2">
                <span className="min-w-0 flex-1 text-sm font-semibold">
                  Excluir {editaveis.length} apontamento{editaveis.length === 1 ? "" : "s"} desta máquina?
                </span>
                <button type="button" onClick={() => setPedir(false)} className="text-sm font-semibold text-muted">
                  Não
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPedir(false);
                    onDelete(editaveis);
                  }}
                  className="rounded-xl bg-[#9b3a34] px-3 py-2 text-sm font-semibold text-white"
                >
                  Excluir
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setPedir(true)} className="mt-2 py-2 text-sm font-semibold text-[#9b3a34]">
                Excluir apontamentos
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function estacoesDoDia(state: State, machine: MachineId, lines: FichaLine[]) {
  const daGrade = STATIONS.flatMap((station) => {
    const doPosto = lines.filter((line) => !line.outroId && line.station === station);
    const config = state.stations[stationKey(machine, station)];
    const ambos = Boolean(config?.ambos);
    const lados = SIDES.map((side) => {
      const linha = doPosto.find((item) => item.side === side);
      const texto = (ambos ? describeMatrix(config, "esq") : describeMatrix(config, side)) || textoDaLinha(linha) || "sem numeração";
      const paresLado = perdasDasLinhas(linha ? [linha] : []).reduce((soma, item) => soma + item.pares, 0);
      return { lado: SIDE_SHORT[side], texto, pares: paresLado };
    }).filter((lado) => lado.pares > 0);
    if (lados.length === 0) return [];
    return [
      {
        chave: `est-${station}`,
        titulo: pad2(station),
        troca: false,
        pares: lados.reduce((soma, lado) => soma + lado.pares, 0),
        lados,
      },
    ];
  });
  const trocas = lines
    .filter((line) => line.outroId)
    .reduce<FichaLine[][]>((grupos, line) => {
      const grupo = grupos.find((item) => item[0]?.outroId === line.outroId);
      if (grupo) grupo.push(line);
      else grupos.push([line]);
      return grupos;
    }, [])
    .flatMap((grupo) => {
      const primeiro = grupo[0];
      const lados = grupo
        .map((line) => ({
          lado: SIDE_SHORT[line.side],
          texto: textoDaLinha(line) || "sem numeração",
          pares: perdasDasLinhas([line]).reduce((soma, item) => soma + item.pares, 0),
        }))
        .filter((lado) => lado.pares > 0);
      if (lados.length === 0 || !primeiro) return [];
      return [
        {
          chave: primeiro.outroId,
          titulo: primeiro.station >= 1 ? pad2(primeiro.station) : "—",
          troca: true,
          pares: lados.reduce((soma, lado) => soma + lado.pares, 0),
          lados,
        },
      ];
    });
  return [...daGrade, ...trocas];
}

function textoDaLinha(line: FichaLine | undefined): string {
  if (!line) return "";
  const numero = line.numero.trim();
  const referencia = referenciaLimpa(line.referencia);
  if (numero && referencia) return `${numero} · ${referencia}`;
  return numero || referencia;
}

function perdasDasLinhas(lines: FichaLine[]) {
  return lines.flatMap((line) =>
    PROBLEMS.flatMap((problem, index) => {
      const solas = line.counts[index] ?? 0;
      if (solas <= 0) return [];
      return [
        {
          chave: `${line.outroId}-${line.side}-${problem.id}`,
          lado: SIDE_SHORT[line.side],
          nome: problem.name,
          pares: pares(solas),
        },
      ];
    }),
  );
}

function FichaSheet({
  state,
  machine,
  force,
  onDelete,
}: {
  state: State;
  machine: MachineId;
  force: boolean;
  onDelete?: (entries: Entry[]) => void;
}) {
  const lines = fichaLines(state, machine);
  const filled = machineHasFicha(state, machine);
  const [open, setOpen] = useState(force);
  const [askDelete, setAskDelete] = useState(false);
  const mine = shiftEntries(state, machine);
  const editable = mine.filter((entry) => podeAlterarApontamento(entry));
  useEffect(() => {
    setOpen(force);
  }, [force, machine]);
  if (!force && !filled) {
    return (
      <section className="mt-3 rounded-tile border border-dashed border-line bg-surface px-4 py-3 first:mt-0">
        <h2 className="font-display text-2xl leading-none">Máquina {machine}</h2>
        <p className="mt-1 text-sm text-muted">Sem matriz e sem perdas neste turno.</p>
      </section>
    );
  }

  return (
    <section className="mt-3 overflow-hidden rounded-tile border-2 border-accent bg-surface first:mt-0 lg:mt-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full bg-accent px-4 py-3 text-left text-accent-ink"
      >
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-display text-4xl leading-none">Máquina {machine}</h2>
          <span className="flex items-center gap-2">
            <ChevronDown className={cx("size-6 transition-transform", open && "rotate-180")} />
          </span>
        </div>
        <p className="mt-1 text-sm">
          {formatDateBR(state.date)} · {TURNO_LABEL[state.turno]}
        </p>
        <TopProblems lines={lines} />
      </button>
      {open ? (
        <>
          <div className="grid gap-2 px-3 pt-3">
            {onDelete && editable.length > 0 ? (
              askDelete ? (
                <div className="flex items-center gap-2 rounded-tile bg-surface-2 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    Excluir {editable.length} apontamento{editable.length === 1 ? "" : "s"} desta máquina?
                  </span>
                  <button
                    type="button"
                    onClick={() => setAskDelete(false)}
                    className="shrink-0 rounded-tile px-3 py-2 text-sm font-semibold text-muted"
                  >
                    Não
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAskDelete(false);
                      onDelete(editable);
                    }}
                    className="shrink-0 rounded-tile bg-[#9b3a34] px-3 py-2 text-sm font-semibold text-white"
                  >
                    Excluir
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAskDelete(true)}
                  className="flex min-h-11 w-full items-center justify-center rounded-tile bg-surface-2 font-semibold text-[#9b3a34]"
                >
                  Excluir apontamentos
                </button>
              )
            ) : null}
          </div>
          <MatrizesDaMaquina state={state} machine={machine} />
          <p className="px-3 pt-3 text-sm text-muted">
            As solas do mesmo lado fecham juntas. A que sobra, sem outra para formar par, vira 1 par. Esquerda e direita não se somam.
            {mine.length > editable.length ? " Turno fechado não sai." : ""}
          </p>
          <ApontamentosLista lines={lines} />
        </>
      ) : null}
    </section>
  );
}

function TopProblems({ lines }: { lines: FichaLine[] }) {
  const leaders = topProblems(lines);
  if (leaders.length === 0) return null;
  return (
    <ol className="mt-3 space-y-1">
      {leaders.map((item, index) => (
        <li key={item.name} className="flex items-start gap-2 rounded-lg bg-white/15 px-2 py-1.5">
          <span className="w-5 shrink-0 font-display text-xl leading-none">{index + 1}</span>
          <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">{item.name}</span>
          <span className="shrink-0 text-right text-xs font-semibold leading-snug">
            {item.pares} {item.pares === 1 ? "par" : "pares"}
          </span>
        </li>
      ))}
    </ol>
  );
}

function topProblems(lines: FichaLine[]): { name: string; solas: number; pares: number }[] {
  const ranked = PROBLEMS.map((problem, index) => {
    const solas = lines.reduce((sum, line) => sum + (line.counts[index] ?? 0), 0);
    const emPares = lines.reduce((sum, line) => sum + pares(line.counts[index] ?? 0), 0);
    return { name: problem.name, solas, pares: emPares };
  }).sort((a, b) => b.solas - a.solas);
  const acima = ranked.filter((item) => item.solas > 3);
  const lista = acima.length > 0 ? acima : ranked.filter((item) => item.solas >= 2);
  return lista.slice(0, 3);
}

function ApontamentosLista({ lines }: { lines: FichaLine[] }) {
  const stations = STATIONS.flatMap((station) => {
    const rows = SIDES.flatMap((side) => {
      const line = lines.find((item) => item.station === station && item.side === side);
      if (!line) return [];
      const items = PROBLEMS.flatMap((problem, index) => {
        const solas = line.counts[index] ?? 0;
        if (solas <= 0) return [];
        return [{ id: problem.id, name: problem.name, solas, pares: pares(solas) }];
      });
      if (items.length === 0) return [];
      const solas = items.reduce((sum, item) => sum + item.solas, 0);
      return [{ side, numero: line.numero, referencia: line.referencia, shared: line.shared, items, solas, pares: pares(solas) }];
    });
    if (rows.length === 0) return [];
    return [{ key: String(station), title: `Estação ${pad2(station)}`, rows }];
  });
  const extras = lines.flatMap((line) => {
    if (!line.outroId) return [];
    const items = PROBLEMS.flatMap((problem, index) => {
      const solas = line.counts[index] ?? 0;
      if (solas <= 0) return [];
      return [{ id: problem.id, name: problem.name, solas, pares: pares(solas) }];
    });
    if (items.length === 0) return [];
    const solas = items.reduce((sum, item) => sum + item.solas, 0);
    return [
      {
        key: `${line.outroId}-${line.side}`,
        title: line.station >= 1 ? `Troca · Estação ${pad2(line.station)}` : "Troca de matriz",
        rows: [
          {
            side: line.side,
            numero: line.numero,
            referencia: line.referencia,
            shared: false,
            items,
            solas,
            pares: pares(solas),
          },
        ],
      },
    ];
  });
  const groups = [...stations, ...extras];

  if (groups.length === 0) {
    return <p className="px-3 py-4 text-sm text-muted">Nenhuma perda apontada nesta máquina.</p>;
  }

  return (
    <div className="grid gap-2 px-3 py-3">
      {groups.map((station) => (
        <section key={station.key} className="rounded-tile border border-line bg-surface-2 p-3">
          <h3 className="font-display text-2xl leading-none">{station.title}</h3>
          {station.rows.map((row) => (
            <div key={row.side} className="mt-3 border-t border-line pt-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-sm font-semibold leading-snug text-accent">
                  {SIDE_LABEL[row.side]}
                  {row.numero || row.referencia
                    ? ` · Nº ${row.numero || "—"}${row.referencia ? ` · Ref. ${row.referencia}` : ""}`
                    : ""}
                </p>
                <p className="shrink-0 text-right leading-none">
                  <span className="block font-display text-2xl tabular-nums">
                    {row.pares} {row.pares === 1 ? "par" : "pares"}
                  </span>
                  <span className="text-xs font-semibold text-muted">
                    {row.solas} {row.solas === 1 ? "sola" : "solas"}
                  </span>
                </p>
              </div>
              <ul className="mt-1">
                {row.items.map((item) => (
                  <li key={item.id} className="border-b border-line py-2 text-sm font-semibold leading-snug last:border-b-0">
                    {item.name}
                    <span className="mt-0.5 block text-xs font-semibold text-muted">
                      {item.solas} {item.solas === 1 ? "sola" : "solas"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function LandscapeSheet({
  machine,
  date,
  turno,
  total,
  lines,
  onClose,
}: {
  machine: MachineId;
  date: string;
  turno: string;
  total: number;
  lines: FichaLine[];
  onClose: () => void;
}) {
  const [portrait, setPortrait] = useState(() => window.matchMedia("(orientation: portrait)").matches);
  const entered = useRef(false);

  useEffect(() => {
    const query = window.matchMedia("(orientation: portrait)");
    const sync = () => setPortrait(query.matches);
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      if (document.fullscreenElement) {
        entered.current = true;
        return;
      }
      if (entered.current) onClose();
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, [onClose]);

  async function close() {
    try {
      screen.orientation?.unlock();
    } catch {
      // O celular pode recusar soltar a rotação.
    }
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[80] bg-bg">
      <div
        className={
          portrait
            ? "absolute top-1/2 left-1/2 flex h-[100dvw] w-[100dvh] -translate-x-1/2 -translate-y-1/2 rotate-90 flex-col bg-bg"
            : "flex h-full w-full flex-col bg-bg"
        }
      >
        <header className="flex shrink-0 items-center gap-3 bg-accent px-3 py-2 text-accent-ink">
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl leading-none">Máquina {machine}</p>
            <p className="truncate text-sm">
              {date} · {turno} · {total}
            </p>
            <TopProblems lines={lines} />
          </div>
          <button
            type="button"
            onClick={() => void close()}
            className="flex h-11 shrink-0 items-center gap-1 rounded-tile bg-white/15 px-3 font-semibold"
            aria-label="Fechar paisagem"
          >
            <X className="size-5" />
            Fechar
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <FichaTable lines={lines} />
        </div>
      </div>
    </div>
  );
}

async function openLandscape(open: (value: boolean) => void) {
  open(true);
  const root = document.documentElement;
  try {
    if (!document.fullscreenElement) await root.requestFullscreen();
    await (
      screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> }
    ).lock?.("landscape");
  } catch {
    // Sem tela cheia nativa, a folha gira na própria tela.
  }
}

function FichaTable({ lines }: { lines: FichaLine[] }) {
  return (
    <table className="w-max border-separate border-spacing-0 text-left text-sm">
      <thead>
        <tr className="bg-accent-soft text-fg">
          <th
            scope="col"
            className="sticky top-0 left-0 z-40 w-14 border-b border-r border-line bg-accent-soft px-1 py-2 text-center"
          >
            Est.
          </th>
          <th
            scope="col"
            className="sticky top-0 left-14 z-40 w-12 border-b border-r border-line bg-accent-soft px-1 py-2 text-center"
          >
            Lado
          </th>
          <th
            scope="col"
            className="sticky top-0 left-26 z-40 w-16 border-b border-r border-line bg-accent-soft px-1 py-2 text-center"
          >
            Nº
          </th>
          <th
            scope="col"
            className="sticky top-0 left-42 z-40 w-12 border-b border-r border-line bg-accent-soft px-1 py-2 text-center"
          >
            Ref.
          </th>
          {PROBLEMS.map((problem) => (
            <th
              key={problem.id}
              scope="col"
              className="sticky top-0 z-30 h-56 w-12 border-b border-r border-line bg-accent-soft p-0"
            >
              <span className="absolute left-1/2 top-1/2 block h-11 w-52 -translate-x-1/2 -translate-y-1/2 -rotate-90 overflow-hidden text-center text-[11px] font-semibold leading-tight">
                {problem.name}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {STATIONS.map((station) =>
          SIDES.map((side, index) => {
            const line = lines.find((item) => item.station === station && item.side === side);
            const band = station % 2 === 1 ? "bg-surface" : "bg-surface-2";
            return (
              <tr key={`${station}-${side}`}>
                {index === 0 ? (
                  <th
                    scope="rowgroup"
                    rowSpan={2}
                    className={cx(
                      "sticky left-0 z-10 w-14 border-b border-r border-line px-1 text-center font-display text-2xl",
                      band,
                    )}
                  >
                    {pad2(station)}
                  </th>
                ) : null}
                <td
                  className={cx(
                    "sticky left-14 z-10 w-12 border-b border-r border-line px-1 py-2 text-center font-semibold",
                    band,
                  )}
                >
                  {SIDE_SHORT[side]}
                </td>
                {index === 0 || !line?.shared ? (
                  <td
                    rowSpan={line?.shared ? 2 : undefined}
                    className={cx(
                      "sticky left-26 z-10 w-16 border-r border-line px-1 text-center",
                      band,
                      line?.shared ? "border-b" : "border-b py-2",
                    )}
                  >
                    {line?.numero || ""}
                  </td>
                ) : null}
                {index === 0 || !line?.shared ? (
                  <td
                    rowSpan={line?.shared ? 2 : undefined}
                    className={cx(
                      "sticky left-42 z-10 w-12 border-r border-line px-1 text-center",
                      band,
                      line?.shared ? "border-b" : "border-b py-2",
                    )}
                  >
                    {line?.referencia || ""}
                  </td>
                ) : null}
                {PROBLEMS.map((problem, problemIndex) => {
                  const count = line?.counts[problemIndex] ?? 0;
                  return (
                    <td
                      key={problem.id}
                      className={cx(
                        "border-b border-r border-line px-1 py-2 text-center font-display text-xl tabular-nums",
                        band,
                      )}
                    >
                      {count > 0 ? count : ""}
                    </td>
                  );
                })}
              </tr>
            );
          }),
        )}
      </tbody>
    </table>
  );
}


