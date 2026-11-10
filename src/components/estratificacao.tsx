import { lazy, Suspense, useEffect, useRef, useState, type MutableRefObject } from "react";
import { cx, paresDasEntradas, percentualPerda, textoPercentual } from "@/components/comum";
import { InstallPrompt } from "@/components/install-prompt";
import { UpdateNotice } from "@/components/update-notice";
import { ChevronLeft, ChevronDown, House, ImageDown, Settings } from "lucide-react";
import {
  MAQUINAS_PISO,
  variantesDe,
  PROBLEMS,
  SIDE_LABEL,
  SIDES,
  STATIONS,
  activeMatrix,
  aplicarMatriz,
  apontamentoBloqueado,
  coresDaMaquina,
  corViva,
  describeMatrix,
  dentroDaJanela,
  emptyConfig,
  formatDateBR,
  inShift,
  loadState,
  machineHasMatrices,
  numeroLimpo,
  referenciaLimpa,
  mergeOutros,
  mergeCores,
  mergeFechamentos,
  mergeProducao,
  outroVivo,
  mergeSharedEntries,
  pad2,
  podeAlterarApontamento,
  saveState,
  shiftEntries,
  stationKey,
  todayISO,
  diaDeHoje,
  turnoPeloRelogio,
  diaOperacional,
  matrizUnicaNoDia,
  NOITE_DOMINGO,
  SABADO_DA_NOITE,
  TURNO_LABEL,
  type Turno,
  diaDoApontamento,
  gradeHasNumbers,
  type Entry,
  type Cor,
  type Fechamento,
  type ProducaoPares,
  type MachineId,
  type MaquinaPiso,
  type OutroMatriz,
  type Side,
  type State,
  type StationConfig,
} from "@/lib/perdas";
import { enviarPlanilha, pullApontamentos, pushApontamentos } from "@/lib/apontamentos.functions";
import { AvisoSair, Teclado, campoInicial, teclaConta, teclaTexto, tecladoAberto, useFecharTeclado, useToque, type Campo } from "@/components/teclado";
import { FechamentoTurno } from "@/components/fechamento";

type Papel = "preparador" | "lider";
const SheetScreen = lazy(() => import("@/components/painel").then((mod) => ({ default: mod.SheetScreen })));

type Sessao = { papel: Papel; turno: Turno | null };

const SESSAO_KEY = "estratificacao-sessao-v3";

function turnoDaSessao(value: unknown, papel: Papel): Turno | null {
  if (value === "1" || value === "2" || value === "3") return value;
  return papel === "preparador" ? "1" : null;
}

function loadSessao(): Sessao | null {
  try {
    const raw = localStorage.getItem(SESSAO_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const row = data as { papel?: unknown; turno?: unknown };
    if (row.papel !== "preparador" && row.papel !== "lider") return null;
    return { papel: row.papel, turno: turnoDaSessao(row.turno, row.papel) };
  } catch {
    return null;
  }
}

function saveSessao(sessao: Sessao | null) {
  try {
    if (sessao) localStorage.setItem(SESSAO_KEY, JSON.stringify(sessao));
    else localStorage.removeItem(SESSAO_KEY);
  } catch {
    /* a sessão vale só neste aparelho */
  }
}

type Screen =
  | { kind: "papel" }
  | { kind: "turnos" }
  | { kind: "machines" }
  | { kind: "modelo"; machine: MaquinaPiso }
  | { kind: "ask"; machine: MachineId }
  | { kind: "cor"; machine: MachineId }
  | { kind: "troca-cor"; machine: MachineId; corId: string }
  | { kind: "matrices"; machine: MachineId; corId?: string; diaria?: boolean }
  | { kind: "hub"; machine: MachineId }
  | { kind: "producao"; machine: MachineId }
  | { kind: "stations"; machine: MachineId; corId?: string }
  | { kind: "outros"; machine: MachineId }
  | { kind: "side"; machine: MachineId; station: number; outroId?: string; corId?: string }
  | { kind: "problems"; machine: MachineId; station: number; side: Side; outroId?: string; corId?: string }
  | { kind: "sheet"; machine: MachineId | null }
  | { kind: "fechamento" }
  | { kind: "lados" };

type Banner = {
  id: number;
  text: string;
  undo?: () => void;
};


const EXCEL_KEY = "estratificacao-excel-enviados";

function loadExcelSent() {
  try {
    const raw = localStorage.getItem(EXCEL_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(ids)) return new Set<string>();
    return new Set(ids.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set<string>();
  }
}

function mesmasEntradas(proximas: Entry[], atuais: Entry[]) {
  if (proximas.length !== atuais.length) return false;
  const porId = new Map(atuais.map((entry) => [entry.id, entry]));
  return proximas.every((entry) => {
    const outra = porId.get(entry.id);
    return (
      outra !== undefined &&
      outra.matrizNumero === entry.matrizNumero &&
      outra.matrizRel === entry.matrizRel &&
      outra.problem === entry.problem &&
      outra.at === entry.at &&
      outra.corId === entry.corId &&
      outra.corNome === entry.corNome
    );
  });
}

function diaMenos(iso: string, dias: number) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() - dias);
  const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(cursor.getUTCDate()).padStart(2, "0");
  return `${cursor.getUTCFullYear()}-${mes}-${dia}`;
}

function enxugar(state: State): State {
  const limitePerda = diaMenos(state.date, 2);
  const limiteProducao = diaMenos(state.date, 45);
  const entries = state.entries.filter((entry) => entry.date >= limitePerda);
  const producao = (state.producao ?? []).filter((item) => item.date >= limiteProducao);
  const outros = state.outros.filter((item) => item.date >= limitePerda);
  const cores = state.cores.filter((item) => item.date >= limitePerda);
  const fechamentos = (state.fechamentos ?? []).filter((item) => item.date >= limitePerda);
  if (
    entries.length === state.entries.length &&
    producao.length === (state.producao ?? []).length &&
    outros.length === state.outros.length &&
    cores.length === state.cores.length &&
    fechamentos.length === (state.fechamentos ?? []).length
  ) {
    return state;
  }
  return { ...state, entries, producao, outros, cores, fechamentos };
}

function usePerdas() {
  const [state, setState] = useState<State | null>(null);
  const [cloud, setCloud] = useState<boolean | null>(null);
  const ref = useRef<State | null>(null);

  useEffect(() => {
    const bruto = loadState();
    const loaded = enxugar({
      ...bruto,
      entries: bruto.entries.map((entry) => {
        if (entry.turno !== "3") return entry;
        if (entry.date === NOITE_DOMINGO) return { ...entry, date: SABADO_DA_NOITE };
        if (!entry.at) return entry;
        const dia = diaOperacional("3", entry.at);
        return dia && dia !== entry.date ? { ...entry, date: dia } : entry;
      }),
      outros: mergeOutros(
        [],
        bruto.outros.map((item) => (item.turno === "3" && item.date === NOITE_DOMINGO ? { ...item, date: SABADO_DA_NOITE } : item)),
      ),
      cores: mergeCores(
        [],
        bruto.cores.map((item) => (item.turno === "3" && item.date === NOITE_DOMINGO ? { ...item, date: SABADO_DA_NOITE } : item)),
      ),
      fechamentos: mergeFechamentos(
        [],
        (bruto.fechamentos ?? []).map((item) =>
          item.turno === "3" && item.date === NOITE_DOMINGO
            ? { ...item, date: SABADO_DA_NOITE, id: `${SABADO_DA_NOITE}|${item.turno}|${item.machine}` }
            : item,
        ),
      ),
      producao: mergeProducao(
        [],
        (bruto.producao ?? []).map((item) =>
          item.turno === "3" && item.date === NOITE_DOMINGO
            ? { ...item, date: SABADO_DA_NOITE, id: `${SABADO_DA_NOITE}|${item.turno}|${item.machine}|${item.numero}` }
            : item,
        ),
      ),
    });
    ref.current = loaded;
    setState(loaded);
  }, []);

  useEffect(() => {
    if (!state) return;
    const timer = window.setTimeout(() => saveState(enxugar(state)), 700);
    return () => window.clearTimeout(timer);
  }, [state]);

  const synced = useRef<Set<string> | null>(null);
  const lastEntries = useRef<State["entries"] | null>(null);
  const lastOutros = useRef("");
  const lastCores = useRef("");
  const lastFechamentos = useRef("");
  const lastProducao = useRef("");
  const lastModelosEm = useRef(0);
  const held = useRef<Set<string>>(new Set());
  const pendingRemoved = useRef<Map<string, Entry>>(new Map());
  const revives = useRef<Set<string>>(new Set());
  const booted = useRef(false);
  const [ligado, setLigado] = useState(false);
  const dirtyGrades = useRef<Set<string>>(new Set());
  const gradesGen = useRef(0);
  const excelSent = useRef<Set<string>>(loadExcelSent());
  const excelQueue = useRef<Array<{ entry: Entry; solas: 1 | -1 }>>([]);
  const excelBusy = useRef(false);
  const envioTimer = useRef<number | null>(null);
  const puxando = useRef(false);

  function storeExcelSent() {
    const ids = [...excelSent.current].slice(-4000);
    try {
      localStorage.setItem(EXCEL_KEY, JSON.stringify(ids));
    } catch {
      /* segue a fila nesta sessão */
    }
  }

  async function pumpExcel() {
    if (excelBusy.current) return;
    excelBusy.current = true;
    let pause = false;
    try {
      while (excelQueue.current.length > 0) {
        const job = excelQueue.current[0];
        if (!job) break;
        const result = await enviarPlanilha({ data: { entry: job.entry, solas: job.solas } });
        if (!result.ok) {
          pause = true;
          break;
        }
        excelQueue.current.shift();
        if (job.solas === 1) excelSent.current.add(job.entry.id);
        else excelSent.current.delete(job.entry.id);
        storeExcelSent();
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
    } catch {
      pause = true;
    }
    excelBusy.current = false;
    if (pause) window.setTimeout(() => void pumpExcel(), 8000);
  }

  function enqueueExcel(entry: Entry, solas: 1 | -1) {
    if (solas === 1 && excelSent.current.has(entry.id)) return;
    if (excelQueue.current.some((job) => job.entry.id === entry.id && job.solas === solas)) return;
    excelQueue.current.push({ entry, solas });
    void pumpExcel();
  }

  function queueRemoval(entry: Entry) {
    const pending = excelQueue.current.findIndex((job) => job.entry.id === entry.id && job.solas === 1);
    if (pending >= 0) {
      excelQueue.current.splice(pending, 1);
      return;
    }
    if (excelSent.current.has(entry.id)) enqueueExcel(entry, -1);
  }

  function resendExcel(entries: Entry[]) {
    for (const entry of entries) excelSent.current.delete(entry.id);
    storeExcelSent();
    for (const entry of entries) enqueueExcel(entry, 1);
    return entries.length;
  }

  useEffect(() => {
    if (!state) return;
    if (!synced.current) synced.current = new Set();
    const known = synced.current;
    const stamped = state.entries.map((entry) =>
      podeAlterarApontamento(entry) ? aplicarMatriz(entry, state) : entry,
    );
    if (stamped.some((entry, index) => entry !== state.entries[index])) {
      for (const entry of stamped) {
        const before = state.entries.find((item) => item.id === entry.id);
        if (before && before !== entry) known.delete(entry.id);
      }
      const next = { ...state, entries: stamped };
      ref.current = next;
      setState(next);
      return;
    }
    const previous = lastEntries.current;
    lastEntries.current = state.entries;
    const upserts = state.entries.filter((entry) => !known.has(entry.id) && !held.current.has(entry.id));
    const removedNow = (previous ?? []).filter((entry) => !state.entries.some((item) => item.id === entry.id));
    for (const entry of removedNow) {
      held.current.add(entry.id);
      pendingRemoved.current.set(entry.id, entry);
      revives.current.delete(entry.id);
    }
    const removed = [...pendingRemoved.current.values()];
    const reviveIds = [...revives.current];
    const grades: Record<string, StationConfig> = {};
    for (const key of dirtyGrades.current) {
      const config = state.stations[key];
      if (config && gradeHasNumbers(config)) grades[key] = config;
    }
    const outros = state.outros.filter((item) => item.date === state.date);
    const cores = state.cores.filter((item) => item.date === state.date);
    const fechamentos = (state.fechamentos ?? []).filter((item) => item.date === state.date);
    const producao = state.producao ?? [];
    const outrosMudou = JSON.stringify(outros) !== lastOutros.current;
    const coresMudou = JSON.stringify(cores) !== lastCores.current;
    const fechamentosMudou = JSON.stringify(fechamentos) !== lastFechamentos.current;
    const producaoMudou = JSON.stringify(producao) !== lastProducao.current;
    const modelosMudou = state.modelosEm > lastModelosEm.current;
    if (upserts.length === 0 && removed.length === 0 && Object.keys(grades).length === 0 && !outrosMudou && !coresMudou && !fechamentosMudou && !producaoMudou && !modelosMudou) {
      return;
    }
    if (!booted.current && removed.length === 0 && reviveIds.length === 0) return;
    const sentGrades = Object.keys(grades);
    const gen = gradesGen.current;
    const sentRevives = reviveIds;
    const modeloEnviado = modelosMudou ? { machines: state.modelos, salvoEm: state.modelosEm } : null;
    const pacote = {
      upserts: booted.current ? upserts : [],
      removed,
      grades: booted.current ? grades : {},
      date: state.date,
      outros: booted.current && outrosMudou ? outros : [],
      cores: booted.current && coresMudou ? cores : [],
      fechamentos: booted.current && fechamentosMudou ? fechamentos : [],
      producao: booted.current && producaoMudou ? producao : [],
      revives: sentRevives,
      modelos: booted.current ? modeloEnviado : null,
    };
    if (envioTimer.current) window.clearTimeout(envioTimer.current);
    envioTimer.current = window.setTimeout(() => {
      envioTimer.current = null;
      void pushApontamentos({ data: pacote })
        .then((result) => {
          setCloud(result.cloud);
          if (booted.current) {
            for (const entry of upserts) known.add(entry.id);
            if (outrosMudou) lastOutros.current = JSON.stringify(outros);
            if (coresMudou) lastCores.current = JSON.stringify(cores);
            if (fechamentosMudou) lastFechamentos.current = JSON.stringify(fechamentos);
            if (producaoMudou) lastProducao.current = JSON.stringify(producao);
            if (modeloEnviado) lastModelosEm.current = modeloEnviado.salvoEm;
          }
          for (const id of sentRevives) revives.current.delete(id);
          if (gradesGen.current !== gen) return;
          for (const key of sentGrades) dirtyGrades.current.delete(key);
        })
        .catch(() => setCloud(false));
    }, 350);
  }, [state, ligado]);

  function takeRemote(
    current: State,
    remote: { entries: Entry[]; removed: string[]; grades?: Record<string, StationConfig>; outros?: OutroMatriz[]; cores?: Cor[]; fechamentos?: Fechamento[]; producao?: ProducaoPares[]; modelos?: { machines: MaquinaPiso[]; salvoEm: number } | null },
  ) {
    for (const id of remote.removed) {
      held.current.delete(id);
      pendingRemoved.current.delete(id);
      revives.current.delete(id);
    }
    const stations = { ...current.stations };
    let stationsChanged = false;
    for (const [key, config] of Object.entries(remote.grades ?? {})) {
      if (dirtyGrades.current.has(key) || !gradeHasNumbers(config)) continue;
      const localAt = stations[key]?.salvoEm ?? 0;
      const remoteAt = config.salvoEm ?? 0;
      if (localAt > remoteAt) continue;
      if (JSON.stringify(stations[key]) !== JSON.stringify(config)) {
        stations[key] = config;
        stationsChanged = true;
      }
    }
    const merged = mergeSharedEntries(current.entries, remote.entries, remote.removed, current.date).filter(
      (entry) => !held.current.has(entry.id),
    );
    const entries = merged.map((entry) =>
      podeAlterarApontamento(entry) ? aplicarMatriz(entry, { ...current, stations }) : entry,
    );
    if (!synced.current) synced.current = new Set();
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!entry) continue;
      if (entry === merged[index]) synced.current.add(entry.id);
      else synced.current.delete(entry.id);
    }
    for (const id of remote.removed) synced.current.delete(id);
    const sameEntries = mesmasEntradas(entries, current.entries);
    const outros = mergeOutros(current.outros, remote.outros ?? []);
    const cores = mergeCores(current.cores, remote.cores ?? []);
    const fechamentos = mergeFechamentos(current.fechamentos ?? [], remote.fechamentos ?? []);
    const producao = mergeProducao(current.producao ?? [], remote.producao ?? []);
    const outrosIguais = JSON.stringify(outros) === JSON.stringify(current.outros);
    const coresIguais = JSON.stringify(cores) === JSON.stringify(current.cores);
    const fechamentosIguais = JSON.stringify(fechamentos) === JSON.stringify(current.fechamentos);
    const producaoIgual = JSON.stringify(producao) === JSON.stringify(current.producao ?? []);
    const modelosNovos = remote.modelos && remote.modelos.salvoEm > current.modelosEm ? remote.modelos : null;
    if (modelosNovos) lastModelosEm.current = modelosNovos.salvoEm;
    if (!stationsChanged && sameEntries && outrosIguais && coresIguais && fechamentosIguais && producaoIgual && !modelosNovos) return current;
    return {
      ...current,
      stations,
      entries,
      outros,
      cores,
      fechamentos,
      producao,
      ...(modelosNovos ? { modelos: modelosNovos.machines, modelosEm: modelosNovos.salvoEm } : {}),
    };
  }

  async function refresh() {
    if (puxando.current) return false;
    const started = ref.current;
    if (!started) return false;
    puxando.current = true;
    const gen = gradesGen.current;
    try {
      const remote = await pullApontamentos({ data: { date: started.date } });
      const current = ref.current;
      if (!current || current.date !== started.date || gradesGen.current !== gen) return true;
      setCloud(remote.cloud);
      if (!booted.current) {
        booted.current = true;
        setLigado(true);
      }
      const next = enxugar(takeRemote(current, remote));
      if (next === current) return true;
      ref.current = next;
      lastEntries.current = next.entries;
      setState(next);
      return true;
    } finally {
      puxando.current = false;
    }
  }

  useEffect(() => {
    if (!state) return;
    const timer = window.setInterval(() => {
      const current = ref.current;
      const known = synced.current;
      if (current && known) {
        const upserts = current.entries.filter((entry) => !known.has(entry.id) && !held.current.has(entry.id));
        const removed = [...pendingRemoved.current.values()];
        const reviveIds = [...revives.current];
        const outros = current.outros.filter((item) => item.date === current.date);
        const cores = current.cores.filter((item) => item.date === current.date);
        const fechamentos = (current.fechamentos ?? []).filter((item) => item.date === current.date);
        const producao = current.producao ?? [];
        const outrosMudou = JSON.stringify(outros) !== lastOutros.current;
        const coresMudou = JSON.stringify(cores) !== lastCores.current;
        const fechamentosMudou = JSON.stringify(fechamentos) !== lastFechamentos.current;
        const producaoMudou = JSON.stringify(producao) !== lastProducao.current;
        const modelosMudou = current.modelosEm > lastModelosEm.current;
        if (booted.current && (upserts.length > 0 || removed.length > 0 || reviveIds.length > 0 || outrosMudou || coresMudou || fechamentosMudou || producaoMudou || modelosMudou)) {
          const modeloEnviado = modelosMudou ? { machines: current.modelos, salvoEm: current.modelosEm } : null;
          void pushApontamentos({
            data: {
              upserts,
              removed,
              revives: reviveIds,
              date: current.date,
              outros: outrosMudou ? outros : [],
              cores: coresMudou ? cores : [],
              fechamentos: fechamentosMudou ? fechamentos : [],
              producao: producaoMudou ? producao : [],
              modelos: modeloEnviado,
            },
          })
            .then((result) => {
              setCloud(result.cloud);
              for (const entry of upserts) known.add(entry.id);
              for (const id of reviveIds) revives.current.delete(id);
              if (outrosMudou) lastOutros.current = JSON.stringify(outros);
              if (coresMudou) lastCores.current = JSON.stringify(cores);
              if (fechamentosMudou) lastFechamentos.current = JSON.stringify(fechamentos);
              if (producaoMudou) lastProducao.current = JSON.stringify(producao);
              if (modeloEnviado) lastModelosEm.current = modeloEnviado.salvoEm;
            })
            .catch(() => setCloud(false));
        }
      }
      if (document.visibilityState === "hidden") return;
      void refresh().catch(() => setCloud(false));
    }, 60000);
    return () => window.clearInterval(timer);
  }, [Boolean(state)]);

  useEffect(() => {
    if (!state) return;
    let cancel = false;
    const gen = gradesGen.current;
    void pullApontamentos({ data: { date: state.date } })
      .then((remote) => {
        if (cancel || !ref.current || ref.current.date !== state.date || gradesGen.current !== gen) return;
        setCloud(remote.cloud);
        if (!booted.current) {
          booted.current = true;
          setLigado(true);
        }
        const next = enxugar(takeRemote(ref.current, remote));
        if (next === ref.current) return;
        ref.current = next;
        lastEntries.current = next.entries;
        setState(next);
      })
      .catch(() => setCloud(false));
    return () => {
      cancel = true;
    };
  }, [state?.date]);

  function commit(recipe: (current: State) => State) {
    if (!ref.current) return;
    const next = recipe(ref.current);
    ref.current = next;
    setState(next);
  }

  function markGrades(keys: string[]) {
    gradesGen.current += 1;
    for (const key of keys) dirtyGrades.current.add(key);
  }

  function releaseHold(ids: string[]) {
    for (const id of ids) {
      held.current.delete(id);
      pendingRemoved.current.delete(id);
      revives.current.add(id);
    }
  }

  function holdRemovals(entries: Entry[]) {
    for (const entry of entries) {
      held.current.add(entry.id);
      pendingRemoved.current.set(entry.id, entry);
      revives.current.delete(entry.id);
    }
  }

  return { state, commit, read: () => ref.current, refresh, cloud, resendExcel, releaseHold, markGrades, holdRemovals };
}

function destinoDaMaquina(current: State, machine: MachineId): Screen {
  return machineHasMatrices(current, machine) ? { kind: "stations", machine } : { kind: "ask", machine };
}

function screenKey(screen: Screen): string {
  switch (screen.kind) {
    case "papel":
      return "papel";
    case "turnos":
      return "turnos";
    case "machines":
      return "machines";
    case "modelo":
      return `modelo-${screen.machine}`;
    case "ask":
      return `ask-${screen.machine}`;
    case "cor":
      return `cor-${screen.machine}`;
    case "troca-cor":
      return `troca-cor-${screen.machine}-${screen.corId}`;
    case "matrices":
      return `matrices-${screen.machine}-${screen.corId ?? ""}-${screen.diaria ? "dia" : ""}`;
    case "hub":
      return `hub-${screen.machine}`;
    case "producao":
      return `producao-${screen.machine}`;
    case "stations":
      return `stations-${screen.machine}-${screen.corId ?? ""}`;
    case "outros":
      return `outros-${screen.machine}`;
    case "side":
      return `side-${screen.machine}-${screen.station}-${screen.outroId ?? ""}`;
    case "problems":
      return `problems-${screen.machine}-${screen.outroId || screen.station}-${screen.side}-${screen.corId ?? ""}`;
    case "sheet":
      return `sheet-${screen.machine ?? "all"}`;
    case "fechamento":
      return "fechamento";
    case "lados":
      return "lados";
  }
}

function machineFrom(screen: Screen): MachineId | null {
  if (
    screen.kind === "papel" ||
    screen.kind === "turnos" ||
    screen.kind === "machines" ||
    screen.kind === "fechamento" ||
    screen.kind === "lados"
  ) {
    return null;
  }
  return screen.machine;
}

export function EstratificacaoApp() {
  const { state, commit, read, cloud, releaseHold, markGrades, holdRemovals } = usePerdas();
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [sessaoReady, setSessaoReady] = useState(false);
  const [stack, setStack] = useState<Screen[]>([{ kind: "papel" }]);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [banner, setBanner] = useState<Banner | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [rolou, setRolou] = useState(false);
  const stackRef = useRef<Screen[]>([{ kind: "papel" }]);
  const homeRef = useRef<Screen>({ kind: "papel" });
  const depthRef = useRef(1);
  const skipPopRef = useRef(0);
  const bloqueioRef = useRef<(() => void) | null>(null);
  const pendenteRef = useRef<(() => void) | null>(null);
  const desfazerRef = useRef<(() => void) | null>(null);
  const voltarTelaRef = useRef<() => void>(() => {});
  const screen = stack[stack.length - 1] ?? { kind: "turnos" as const };
  const key = screenKey(screen);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const medir = () => setRolou(el.scrollTop > 420);
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    return () => el.removeEventListener("scroll", medir);
  }, [key]);

  function stampDepth(depth: number) {
    const current = window.history.state;
    const base = current && typeof current === "object" ? { ...current } : {};
    return { ...base, perdasDepth: depth };
  }

  useEffect(() => {
    const current = window.history.state;
    const marked = current && typeof current === "object" ? { ...current } : {};
    if (typeof marked.perdasDepth !== "number") {
      window.history.replaceState({ ...marked, perdasDepth: 1 }, "");
      depthRef.current = 1;
    } else {
      depthRef.current = marked.perdasDepth;
    }
    function onPop() {
      if (skipPopRef.current > 0) {
        skipPopRef.current -= 1;
        return;
      }
      window.history.pushState(stampDepth(depthRef.current), "");
      voltarTelaRef.current();
    }
    window.addEventListener("popstate", onPop);
    window.history.pushState(stampDepth(depthRef.current), "");
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void import("@/components/painel");
    }, 250);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    function bloquear(event: Event) {
      const alvo = event.target;
      if (alvo instanceof HTMLElement && alvo.closest("input, textarea")) return;
      event.preventDefault();
    }
    document.addEventListener("copy", bloquear);
    document.addEventListener("cut", bloquear);
    document.addEventListener("contextmenu", bloquear);
    return () => {
      document.removeEventListener("copy", bloquear);
      document.removeEventListener("cut", bloquear);
      document.removeEventListener("contextmenu", bloquear);
    };
  }, []);

  useEffect(() => {
    const saved = loadSessao();
    const home: Screen =
      saved?.papel === "preparador"
        ? { kind: "machines" }
        : saved?.papel === "lider"
          ? { kind: "sheet", machine: null }
          : { kind: "papel" };
    homeRef.current = home;
    stackRef.current = [home];
    setStack([home]);
    setSessao(saved);
    setSessaoReady(true);
    depthRef.current = 1;
    window.history.replaceState(stampDepth(1), "");
  }, []);

  useEffect(() => {
    if (!sessaoReady || !state || sessao?.papel === "lider") return;
    function snapToToday() {
      const turno = sessao?.papel === "preparador" ? (sessao.turno ?? "1") : turnoPeloRelogio();
      const today = diaOperacional(turno);
      commit((current) => (current.date === today ? current : { ...current, date: today }));
    }
    snapToToday();
    function onVisible() {
      if (document.visibilityState === "visible") snapToToday();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", snapToToday);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", snapToToday);
    };
  }, [sessaoReady, sessao?.papel, sessao?.turno, Boolean(state)]);

  useEffect(() => {
    if (sessao?.papel !== "preparador") return;
    function snapTurno() {
      const turno = sessao?.turno ?? "1";
      commit((current) => (current.turno === turno ? current : { ...current, turno }));
    }
    snapTurno();
    function onVisible() {
      if (document.visibilityState === "visible") snapTurno();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", snapTurno);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", snapTurno);
    };
  }, [sessao?.papel, sessao?.turno]);

  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [key]);

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), 4200);
    return () => window.clearTimeout(timer);
  }, [banner]);

  function push(next: Screen) {
    const stackNext = [...stackRef.current, next];
    stackRef.current = stackNext;
    depthRef.current = stackNext.length;
    setDir("forward");
    setStack(stackNext);
    window.history.pushState(stampDepth(stackNext.length), "");
  }

  function confirmarSaida() {
    const acao = pendenteRef.current;
    pendenteRef.current = null;
    desfazerRef.current = null;
    bloqueioRef.current = null;
    acao?.();
  }

  function ficarNaTela() {
    pendenteRef.current = null;
    const desfazer = desfazerRef.current;
    desfazerRef.current = null;
    if (!desfazer) return;
    skipPopRef.current += 1;
    desfazer();
  }

  function voltarAoSalvar(destino: "stations" | "side") {
    const atual = stackRef.current;
    const topo = atual[atual.length - 1];
    if (!topo || topo.kind !== "problems") return;
    bloqueioRef.current = null;
    let indice = -1;
    for (let i = atual.length - 1; i >= 0; i -= 1) {
      if (atual[i]?.kind === destino) {
        indice = i;
        break;
      }
    }
    if (indice >= 0 && indice < atual.length - 1) {
      adoptStack(atual.slice(0, indice + 1));
      return;
    }
    const tela: Screen =
      destino === "side"
        ? { kind: "side", machine: topo.machine, station: topo.station, outroId: topo.outroId, corId: topo.corId }
        : { kind: "stations", machine: topo.machine, corId: topo.corId };
    replaceTop(tela);
  }

  function back() {
    if (tecladoAberto()) {
      tecladoAberto()?.();
      return;
    }
    if (stackRef.current.length <= 1) {
      if (stackRef.current[0]?.kind !== "papel") leavePapel();
      return;
    }
    const ir = () => {
      const next = stackRef.current.slice(0, -1);
      stackRef.current = next.length > 0 ? next : [homeRef.current];
      depthRef.current = stackRef.current.length;
      setDir("back");
      setStack(stackRef.current);
      window.history.replaceState(stampDepth(stackRef.current.length), "");
    };
    if (bloqueioRef.current) {
      desfazerRef.current = null;
      pendenteRef.current = ir;
      bloqueioRef.current();
      return;
    }
    ir();
  }
  voltarTelaRef.current = back;

  function irParaCasa() {
    if (tecladoAberto()) {
      tecladoAberto()?.();
      return;
    }
    leavePapel();
  }

  function abrirConfig() {
    if (tecladoAberto()) {
      tecladoAberto()?.();
      return;
    }
    push({ kind: "lados" });
  }

  function replaceTop(next: Screen) {
    const stackNext = [...stackRef.current.slice(0, -1), next];
    stackRef.current = stackNext;
    depthRef.current = stackNext.length;
    setDir("forward");
    setStack(stackNext);
    window.history.replaceState(stampDepth(stackNext.length), "");
  }

  function adoptStack(nextStack: Screen[]) {
    const delta = depthRef.current - nextStack.length;
    stackRef.current = nextStack;
    setStack(nextStack);
    if (delta > 0) {
      skipPopRef.current = delta;
      depthRef.current = nextStack.length;
      window.history.go(-delta);
      return;
    }
    depthRef.current = nextStack.length;
    window.history.replaceState(stampDepth(nextStack.length), "");
  }

  function chooseSessao(next: Sessao) {
    saveSessao(next);
    setSessao(next);
    if (next.papel === "preparador") {
      commit((current) => ({ ...current, turno: next.turno ?? "1" }));
    }
    const home: Screen = next.papel === "lider" ? { kind: "sheet", machine: null } : { kind: "machines" };
    homeRef.current = home;
    stackRef.current = [home];
    depthRef.current = 1;
    setDir("forward");
    setStack([home]);
    window.history.replaceState(stampDepth(1), "");
  }

  function leavePapel() {
    if (tecladoAberto()) {
      tecladoAberto()?.();
      return;
    }
    const sair = () => {
      saveSessao(null);
      setSessao(null);
      const home: Screen = { kind: "papel" };
      homeRef.current = home;
      stackRef.current = [home];
      depthRef.current = 1;
      setDir("back");
      setStack([home]);
      window.history.replaceState(stampDepth(1), "");
    };
    if (bloqueioRef.current) {
      desfazerRef.current = null;
      pendenteRef.current = sair;
      bloqueioRef.current();
      return;
    }
    sair();
  }

  function abrirApontamento(machine: MachineId, station: number, outro?: OutroMatriz) {
    if (!state) return;
    const ambos = outro ? outro.ambos : Boolean(state.stations[stationKey(machine, station)]?.ambos);
    const posto = outro?.station || station;
    if (matrizUnicaNoDia(state.date, ambos)) {
      push({ kind: "problems", machine, station: posto, side: "esq", outroId: outro?.id });
      return;
    }
    if (outro && !outro.ambos) {
      push({ kind: "problems", machine, station: posto, side: outro.side, outroId: outro.id });
      return;
    }
    push({ kind: "side", machine, station: posto, outroId: outro?.id });
  }

  function flash(text: string, undo?: () => void) {
    setBanner({ id: Date.now(), text, undo });
  }

  function restore(entry: Entry) {
    releaseHold([entry.id]);
    commit((current) => {
      if (current.entries.some((item) => item.id === entry.id)) return current;
      return { ...current, entries: [...current.entries, entry] };
    });
  }

  function avisoFechado(entry: Entry) {
    if (apontamentoBloqueado(entry)) return "Turno bloqueado.";
    if (entry.date !== diaDeHoje() && entry.date !== diaOperacional(entry.turno === "1" || entry.turno === "2" || entry.turno === "3" ? entry.turno : "1", entry.at || Date.now())) return "Dia fechado.";
    return "Fora do horário.";
  }

  function removeEntry(id: string, label = "Lançamento apagado") {
    const current = read();
    if (!current) return;
    const entry = current.entries.find((item) => item.id === id);
    if (!entry) return;
    if (!podeAlterarApontamento(entry)) {
      flash(avisoFechado(entry));
      return;
    }
    holdRemovals([entry]);
    commit((s) => ({ ...s, entries: s.entries.filter((item) => item.id !== id) }));
    flash(label, () => restore(entry));
  }

  if (!state || !sessaoReady) return <Loading />;

  const papel = sessao?.papel ?? null;

  const today =
    sessao?.papel === "preparador" ? diaOperacional(sessao.turno ?? "1") : diaDeHoje();
  const offDay = state.date !== today;

  function setDate(date: string) {
    if (!date) return;
    commit((current) => ({ ...current, date }));
  }

  function setTurno(turno: Turno) {
    commit((current) => ({ ...current, turno }));
  }

  function alternarModelo(machine: MaquinaPiso) {
    commit((current) => {
      const ligados = new Set(current.modelos);
      if (ligados.has(machine)) ligados.delete(machine);
      else ligados.add(machine);
      return { ...current, modelos: MAQUINAS_PISO.filter((item) => ligados.has(item)), modelosEm: Date.now() };
    });
  }

  function gravarProducao(date: string, machine: MachineId, turno: Turno, valores: Record<string, number>) {
    const salvoEm = Date.now();
    commit((current) => {
      const prefixo = `${date}|${turno}|${machine}|`;
      const restantes = (current.producao ?? []).filter((item) => !item.id.startsWith(prefixo));
      const gravados: ProducaoPares[] = Object.entries(valores).flatMap(([numero, pares]) => {
        const limpo = numeroLimpo(numero);
        if (!limpo) return [];
        return [
          {
            id: `${prefixo}${limpo}`,
            date,
            turno,
            machine,
            numero: limpo,
            pares: Math.max(0, Math.floor(pares)),
            salvoEm,
          },
        ];
      });
      return { ...current, producao: [...restantes, ...gravados] };
    });
  }

  function salvarProducao(machine: MachineId, turno: Turno, valores: Record<string, number>) {
    const atual = read();
    if (!atual) return;
    gravarProducao(atual.date, machine, turno, valores);
  }

  function corrigirProducao(date: string, machine: MachineId, turno: Turno, valores: Record<string, number>) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayISO()) return;
    const salvoEm = Date.now();
    commit((current) => {
      const map = new Map((current.producao ?? []).map((item) => [item.id, item]));
      for (const [numero, pares] of Object.entries(valores)) {
        const limpo = numeroLimpo(numero);
        if (!limpo) continue;
        const id = `${date}|${turno}|${machine}|${limpo}`;
        map.set(id, {
          id,
          date,
          turno,
          machine,
          numero: limpo,
          pares: Math.max(0, Math.floor(pares)),
          salvoEm,
        });
      }
      return { ...current, producao: [...map.values()] };
    });
  }

  function lancarCorrecao(sola: {
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
  }) {
    const entry: Entry = { ...sola, id: crypto.randomUUID(), at: Date.now(), autor: "" };
    commit((current) => ({ ...current, entries: [...current.entries, entry] }));
  }

  function apagarCorrecao(id: string) {
    const current = read();
    const entry = current?.entries.find((item) => item.id === id);
    if (!entry) return;
    if (apontamentoBloqueado(entry)) {
      flash("Turno bloqueado.");
      return;
    }
    holdRemovals([entry]);
    commit((s) => ({ ...s, entries: s.entries.filter((item) => item.id !== id) }));
  }

  async function baixarFicha(machine: MachineId) {
    const current = read();
    if (!current) return;
    try {
      const { entregarArquivos, renderFichasDaMaquina } = await import("@/lib/ficha-image");
      const grupos = await renderFichasDaMaquina(current, machine);
      if (grupos.length === 0) {
        flash("Nenhuma ficha nesta máquina.");
        return;
      }
      const base = `perdas-${current.date}-turno-${current.turno}`;
      await entregarArquivos(
        grupos.map((grupo) => {
          const sufixo = grupo.nome ? `-${grupo.nome.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}` : "";
          return { name: `${base}-maquina-${machine}${sufixo}.png`, blob: grupo.blob };
        }),
      );
    } catch {
      flash("Não foi possível gerar a imagem.");
    }
  }

  function openMachine(machine: MachineId) {
    const current = read();
    if (!current) return;
    if ((MAQUINAS_PISO as readonly string[]).includes(machine) && current.modelos.includes(machine as MaquinaPiso)) {
      push({ kind: "modelo", machine: machine as MaquinaPiso });
      return;
    }
    if (sessao?.papel === "preparador") {
      push({ kind: "hub", machine });
      return;
    }
    push(destinoDaMaquina(current, machine));
  }

  function saveGrade(machine: MachineId, configs: StationConfig[], corId = "") {
    const salvoEm = Date.now();
    markGrades(STATIONS.map((station) => stationKey(machine, station)));
    commit((current) => {
      const stations = { ...current.stations };
      const grades: Record<string, StationConfig> = {};
      STATIONS.forEach((station, index) => {
        const config = configs[index];
        if (!config) return;
        const salvo = { ...config, salvoEm };
        grades[String(station)] = salvo;
        if (!corId) stations[stationKey(machine, station)] = salvo;
      });
      if (!corId) return { ...current, stations };
      const primeira = coresDaMaquina(current, machine)[0];
      if (primeira?.id === corId) {
        for (const [station, config] of Object.entries(grades)) {
          stations[stationKey(machine, Number(station))] = config;
        }
      }
      return {
        ...current,
        stations,
        cores: current.cores.map((item) =>
          item.id === corId ? { ...item, grades: { ...item.grades, ...grades }, salvoEm } : item,
        ),
      };
    });
    const topo = stackRef.current[stackRef.current.length - 1];
    if (topo?.kind === "matrices" && sessao?.papel === "preparador") {
      if (topo.diaria) marcarGradeDia(sessao.turno ?? "1", machine);
      replaceTop({ kind: "hub", machine });
      return;
    }
    const dest: Screen = { kind: "stations", machine, corId: corId || undefined };
    if (sessao?.papel === "preparador") homeRef.current = dest;
    adoptStack([dest]);
  }

  function criarCor(machine: MachineId, nome: string, stations: number[], grades: Record<string, StationConfig>) {
    const limpo = nome.trim().slice(0, 40);
    if (!limpo) {
      flash("Informe o nome da cor.");
      return;
    }
    if (stations.length === 0) {
      flash("Escolha ao menos uma estação.");
      return;
    }
    const cor: Cor = {
      id: crypto.randomUUID(),
      date: todayISO(),
      turno: sessao?.turno ?? read()?.turno ?? "1",
      machine,
      nome: limpo,
      stations,
      grades,
      salvoEm: Date.now(),
    };
    commit((current) => ({ ...current, cores: [...current.cores, cor] }));
    flash(`Cor ${limpo} aberta`);
    const dest: Screen = { kind: "stations", machine, corId: cor.id };
    if (sessao?.papel === "preparador") homeRef.current = dest;
    adoptStack([dest]);
  }

  function renomearCor(corId: string, nome: string) {
    const limpo = nome.trim().slice(0, 40);
    if (!limpo) {
      flash("Informe o nome da cor.");
      return;
    }
    const current = read();
    const cor = current?.cores.find((item) => item.id === corId && corViva(item));
    if (!cor) return;
    if (current?.date !== todayISO() || cor.date !== todayISO()) {
      flash("Dia fechado.");
      return;
    }
    if (cor.nome === limpo) return;
    commit((stateNow) => ({
      ...stateNow,
      cores: stateNow.cores.map((item) =>
        item.id === corId ? { ...item, nome: limpo, salvoEm: Date.now() } : item,
      ),
    }));
    flash(`Cor alterada para ${limpo}`);
  }

  function addOutro(
    machine: MachineId,
    station: number,
    ambos: boolean,
    side: Side,
    numero: string,
    referencia: string,
  ) {
    const cleanNumero = numero.trim();
    const cleanRef = referenciaLimpa(referencia);
    if (station < 1 || station > 8) {
      flash("Escolha a estação.");
      return;
    }
    if (!cleanNumero && !cleanRef) {
      flash("Informe a numeração ou a referência.");
      return;
    }
    if (read()?.date !== todayISO()) {
      flash("Dia fechado.");
      return;
    }
    const turnoTroca = sessao?.turno ?? "1";
    if (!dentroDaJanela(turnoTroca)) {
      flash("Fora do horário.");
      return;
    }
    const item: OutroMatriz = {
      id: crypto.randomUUID(),
      date: todayISO(),
      turno: turnoTroca,
      machine,
      station,
      ambos,
      side: ambos ? "esq" : side,
      numero: cleanNumero,
      referencia: cleanRef,
      salvoEm: Date.now(),
    };
    commit((current) => ({
      ...current,
      date: todayISO(),
      turno: item.turno,
      outros: [...current.outros, item],
    }));
    flash("Troca de matriz adicionada");
    back();
  }

  function removeOutro(id: string) {
    const current = read();
    if (!current) return;
    const item = current.outros.find((outro) => outro.id === id && outroVivo(outro));
    if (!item) return;
    if (current.date !== todayISO() || item.date !== todayISO()) {
      flash("Dia fechado.");
      return;
    }
    if (!dentroDaJanela(item.turno)) {
      flash("Fora do horário.");
      return;
    }
    const ligados = current.entries.filter((entry) => entry.outroId === id);
    const travado = ligados.find((entry) => !podeAlterarApontamento(entry));
    if (travado) {
      flash(avisoFechado(travado));
      return;
    }
    const drop = new Set(ligados.map((entry) => entry.id));
    holdRemovals(ligados);
    commit((s) => ({
      ...s,
      entries: s.entries.filter((entry) => !drop.has(entry.id)),
      outros: s.outros.map((outro) =>
        outro.id === id ? { ...outro, excluido: true, salvoEm: Date.now() } : outro,
      ),
    }));
    flash(ligados.length > 0 ? "Troca e perdas excluídas" : "Troca excluída");
  }

  function salvarContagens(
    machine: MachineId,
    station: number,
    side: Side,
    outroId: string,
    alvos: Record<string, number>,
  ) {
    const current = read();
    if (!current) return false;
    const at = Date.now();
    const turno = sessao?.papel === "preparador" ? (sessao.turno ?? "1") : turnoPeloRelogio(at);
    const dia = diaOperacional(turno, at);
    if (current.date !== dia) {
      flash("Dia fechado.");
      return false;
    }
    if (!dentroDaJanela(turno, at)) {
      flash("Fora do horário.");
      return false;
    }
    const rows = current.entries.filter((entry) => {
      if (!inShift(entry, current) || entry.machine !== machine) return false;
      if (outroId) return entry.outroId === outroId && entry.side === side;
      return !entry.outroId && entry.station === station && entry.side === side;
    });
    const remover: Entry[] = [];
    const faltas = new Map<string, number>();
    let travou = false;
    for (const [problem, bruto] of Object.entries(alvos)) {
      const alvo = Math.max(0, Math.floor(bruto));
      const doProblema = rows.filter((entry) => entry.problem === problem);
      const travados = doProblema.filter((entry) => !podeAlterarApontamento(entry));
      const livres = doProblema.filter((entry) => podeAlterarApontamento(entry)).sort((a, b) => a.at - b.at);
      if (alvo < travados.length) travou = true;
      const manter = Math.max(0, alvo - travados.length);
      remover.push(...livres.slice(manter));
      const atual = doProblema.length;
      if (alvo > atual) faltas.set(problem, alvo - atual);
    }
    const drop = new Set(remover.map((entry) => entry.id));
    if (remover.length > 0) holdRemovals(remover);
    commit((stateNow) => {
      const outro = outroId ? stateNow.outros.find((item) => item.id === outroId) : undefined;
      const slot = outro
        ? { numero: outro.numero, referencia: outro.referencia }
        : activeMatrix(stateNow.stations[stationKey(machine, station)], side);
      const numero = numeroLimpo(slot?.numero ?? "");
      const referencia = numero ? referenciaLimpa(slot?.referencia ?? "") : "";
      const novas: Entry[] = [];
      for (const [problem, quantidade] of faltas) {
        for (let i = 0; i < quantidade; i += 1) {
          novas.push({
            id: crypto.randomUUID(),
            date: dia,
            turno,
            machine,
            station: outro ? outro.station || station : station,
            side: outro && !outro.ambos ? outro.side : side,
            problem,
            at: at + i,
            matrizNumero: numero,
            matrizRel: referencia,
            autor: "",
            outroId,
            corId: "",
            corNome: "",
          });
        }
      }
      return { ...stateNow, turno, date: dia, entries: [...stateNow.entries.filter((entry) => !drop.has(entry.id)), ...novas] };
    });
    if (travou) {
      flash("Parte ficou bloqueada. O resto foi salvo.");
      return false;
    }
    return true;
  }

  function addProblem(machine: MachineId, station: number, side: Side, problem: string, outroId = "", corId = "") {
    const current = read();
    if (!current) return;
    const at = Date.now();
    const turno = sessao?.papel === "preparador" ? (sessao.turno ?? "1") : turnoPeloRelogio(at);
    const dia = diaOperacional(turno, at);
    if (current.date !== dia) {
      flash("Dia fechado.");
      return;
    }
    if (!dentroDaJanela(turno, at)) {
      flash("Fora do horário.");
      return;
    }
    const id = crypto.randomUUID();
    let snapshot = { numero: "", referencia: "" };
    commit((stateNow) => {
      const outro = outroId ? stateNow.outros.find((item) => item.id === outroId) : undefined;
      const cor = corId ? stateNow.cores.find((item) => item.id === corId) : undefined;
      const slot = outro
        ? { numero: outro.numero, referencia: outro.referencia }
        : activeMatrix(
            cor?.grades[String(station)] ?? stateNow.stations[stationKey(machine, station)],
            side,
          );
      snapshot = {
        numero: numeroLimpo(slot?.numero ?? ""),
        referencia: numeroLimpo(slot?.numero ?? "") ? referenciaLimpa(slot?.referencia ?? "") : "",
      };
      const entry: Entry = {
        id,
        date: dia,
        turno,
        machine,
        station: outro ? outro.station || station : station,
        side: outro && !outro.ambos ? outro.side : side,
        problem,
        at,
        matrizNumero: snapshot.numero,
        matrizRel: snapshot.referencia,
        autor: "",
        outroId,
        corId: outro ? "" : (cor?.id ?? ""),
        corNome: outro ? "" : (cor?.nome ?? ""),
      };
      return { ...stateNow, turno, date: dia, entries: [...stateNow.entries, entry] };
    });
    navigator.vibrate?.(12);
  }

  function sameAuthor(_entry: Entry) {
    return true;
  }

  function removeCount(machine: MachineId, station: number, side: Side, problem: string, outroId: string, quantidade: number, corId = "") {
    const current = read();
    if (!current) return;
    const primeira = coresDaMaquina(current, machine)[0]?.id ?? "";
    const pool = current.entries.filter(
      (entry) =>
        inShift(entry, current) &&
        entry.machine === machine &&
        entry.problem === problem &&
        sameAuthor(entry) &&
        (outroId
          ? entry.outroId === outroId
          : !entry.outroId &&
            entry.station === station &&
            entry.side === side &&
            (!corId || entry.corId === corId || (entry.corId === "" && corId === primeira))),
    );
    const matches = [...pool].reverse().filter((entry) => podeAlterarApontamento(entry)).slice(0, quantidade);
    if (matches.length === 0) {
      const fechado = [...pool].reverse().find((entry) => !podeAlterarApontamento(entry));
      if (fechado) flash(avisoFechado(fechado));
      return;
    }
    removeMany(
      matches.map((entry) => entry.id),
      matches.length === 1 ? "1 sola excluída" : `${matches.length} solas excluídas`,
      false,
    );
  }

  function removeMany(ids: string[], label: string, avisar = true) {
    const current = read();
    if (!current || ids.length === 0) return;
    const gone = current.entries.filter((entry) => ids.includes(entry.id) && podeAlterarApontamento(entry));
    if (gone.length === 0) {
      const fechado = current.entries.find((entry) => ids.includes(entry.id));
      flash(fechado ? avisoFechado(fechado) : "Dia fechado.");
      return;
    }
    holdRemovals(gone);
    const drop = new Set(gone.map((entry) => entry.id));
    commit((s) => ({ ...s, entries: s.entries.filter((entry) => !drop.has(entry.id)) }));
    if (!avisar) return;
    flash(label, () => {
      releaseHold(gone.map((entry) => entry.id));
      commit((s) => ({
        ...s,
        entries: [
          ...s.entries,
          ...gone.filter((entry) => !s.entries.some((item) => item.id === entry.id)),
        ],
      }));
    });
  }

  const header = headerFor(screen);
  const telaFixa = screen.kind === "hub" || screen.kind === "modelo" || screen.kind === "papel";
  const telaProblemas = screen.kind === "problems";

  return (
    <div className="relative flex h-dvh flex-col bg-bg text-fg">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="h-1 bg-accent" />
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 lg:max-w-none lg:px-5">
          <div className="min-w-0 flex-1">
            {screen.kind === "sheet" ? (
              <>
                <h1 className="font-display text-2xl leading-none tracking-wide text-accent lg:text-4xl">
                  {papel === "lider" ? "Dashboard geral" : "Lançamentos"}
                </h1>
              </>
            ) : (
              <>
                <h1 className="font-display text-3xl leading-none tracking-wide text-accent">
                  Injeção EVA
                </h1>
                <p className="font-display text-xl leading-none text-fg">(Sobral)</p>
                {header.context ? (
                  <p className="mt-1 truncate text-sm font-semibold text-muted">{header.context}</p>
                ) : null}
              </>
            )}
            {cloud === true ? (
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-accent">
                <span className="size-2.5 shrink-0 rounded-full bg-[#2f7d4a]" />
                Server: Online
              </p>
            ) : cloud === false ? (
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold text-muted">
                <span className="size-2.5 shrink-0 rounded-full bg-[#c4342d]" />
                Server: Offline
              </p>
            ) : null}
          </div>
          {papel || screen.kind === "fechamento" ? (
            <div data-nav="" className="hidden shrink-0 items-center gap-2 lg:flex">
              <button
                type="button"
                onClick={abrirConfig}
                className="inline-flex items-center gap-2 rounded-tile border border-line bg-surface px-3 py-2 text-sm font-semibold"
              >
                <Settings className="size-4" />
                Configuração
              </button>
              <button
                type="button"
                onClick={irParaCasa}
                className="inline-flex items-center gap-2 rounded-tile border border-line bg-surface px-3 py-2 text-sm font-semibold"
              >
                <House className="size-4" />
                Início
              </button>
              <button
                type="button"
                onClick={back}
                className="inline-flex items-center gap-2 rounded-tile bg-accent px-3 py-2 text-sm font-semibold text-accent-ink"
              >
                <ChevronLeft className="size-4" />
                Voltar
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <InstallPrompt />
      <UpdateNotice />

      {banner ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-4 pb-4">
          <div
            role="status"
            className="pointer-events-auto mx-auto flex w-full max-w-6xl items-center gap-3 rounded-tile bg-accent px-4 py-3 text-accent-ink"
          >
            <span className="min-w-0 flex-1 text-base font-semibold">{banner.text}</span>
            {banner.undo ? (
              <button
                type="button"
                onClick={() => {
                  const undo = banner.undo;
                  setBanner(null);
                  undo?.();
                }}
                className="shrink-0 rounded-tile bg-accent-ink/15 px-3 py-2 font-semibold"
              >
                Desfazer
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div ref={scroller} className={cx("min-h-0 flex-1 overflow-x-hidden", telaFixa || telaProblemas ? "overflow-hidden" : "overflow-y-auto")}>
        <div
          key={key}
          className={cx(
            "mx-auto w-full min-w-0",
            telaFixa ? "flex h-full items-center justify-center px-6" : telaProblemas ? "flex h-full min-h-0 flex-col px-4 py-3" : "px-4 py-4",
            !telaFixa &&
              !telaProblemas &&
              (screen.kind === "producao" || screen.kind === "matrices" || screen.kind === "outros"
                ? "pb-4"
                : "pb-28"),
            screen.kind === "sheet" ? "max-w-6xl lg:max-w-none lg:px-5 lg:py-3" : "max-w-6xl lg:px-8",
            dir === "forward" ? "enter-forward" : "enter-back",
          )}
        >
          {screen.kind === "papel" ? (
            <PortaScreen onPick={chooseSessao} onFechamento={() => push({ kind: "fechamento" })} />
          ) : null}

          {screen.kind === "fechamento" ? (
            <FechamentoTurno state={state} onCommit={commit} onNotice={(text) => flash(text)} />
          ) : null}

          {screen.kind === "lados" ? (
            <div className="mx-auto w-full max-w-md">
              <p className="font-display text-4xl leading-none text-accent">A e B</p>
              <p className="mt-2 text-sm font-semibold text-muted">
                Ligado, a máquina pede A ou B. Desligado, entra direto.
              </p>
              <div className="mt-4 grid gap-2">
                {MAQUINAS_PISO.map((machine) => {
                  const ligado = state.modelos.includes(machine);
                  return (
                    <div key={machine} className="flex items-center justify-between gap-3 rounded-tile border border-line bg-surface px-4 py-3">
                      <span className="font-display text-3xl leading-none">{machine}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={ligado}
                        aria-label={`${ligado ? "Desativar" : "Ativar"} A e B na ${machine}`}
                        onClick={() => alternarModelo(machine)}
                        className={cx("relative h-8 w-14 shrink-0 rounded-full", ligado ? "bg-accent" : "bg-line")}
                      >
                        <span className={cx("absolute top-1 size-6 rounded-full bg-white", ligado ? "left-7" : "left-1")} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {papel === "preparador" && screen.kind === "machines" ? (
            <MachinesScreen state={state} onOpen={openMachine} />
          ) : null}

          {papel === "preparador" && screen.kind === "modelo" ? (
            <ModeloScreen machine={screen.machine} onPick={(escolhida) => push({ kind: "hub", machine: escolhida })} />
          ) : null}

          {papel === "preparador" && screen.kind === "hub" ? (
            <HubMaquina
              machine={screen.machine}
              turno={sessao?.turno ?? state.turno}
              onProducao={() => push({ kind: "producao", machine: screen.machine })}
              onPerdas={() => push({ kind: "stations", machine: screen.machine })}
              onGrade={() => push({ kind: "matrices", machine: screen.machine })}
            />
          ) : null}

          {papel === "preparador" && screen.kind === "producao" ? (
            <ProducaoScreen
              state={state}
              machine={screen.machine}
              turno={sessao?.turno ?? state.turno}
              onSave={(valores) => salvarProducao(screen.machine, sessao?.turno ?? state.turno, valores)}
            />
          ) : null}

          {papel === "preparador" && screen.kind === "ask" ? (
            <AskScreen
              machine={screen.machine}
              onEdit={() => push({ kind: "matrices", machine: screen.machine })}
              onSkip={() => replaceTop({ kind: "stations", machine: screen.machine })}
              onTrocar={() => push({ kind: "machines" })}
            />
          ) : null}

          {papel === "preparador" && screen.kind === "matrices" ? (
            <MatrixGradeScreen
              state={state}
              machine={screen.machine}
              onSave={(configs) => saveGrade(screen.machine, configs)}
            />
          ) : null}

          {papel === "preparador" && screen.kind === "stations" ? (
            <StationsScreen
              state={state}
              machine={screen.machine}
              offDay={offDay}
              onDownload={() => void baixarFicha(screen.machine)}
              onEditar={() => push({ kind: "matrices", machine: screen.machine })}
              onOpen={(station) => abrirApontamento(screen.machine, station)}
              onOpenOutro={(outro) => abrirApontamento(screen.machine, outro.station, outro)}
              onDeleteOutro={removeOutro}
              onTrocar={() => push({ kind: "outros", machine: screen.machine })}
            />
          ) : null}

          {papel === "preparador" && screen.kind === "outros" ? (
            <OutrosScreen
              machine={screen.machine}
              offDay={offDay}
              onSave={(station, ambos, side, numero, referencia) =>
                addOutro(screen.machine, station, ambos, side, numero, referencia)
              }
            />
          ) : null}

          {papel === "preparador" && screen.kind === "side" ? (
            <SideScreen
              state={state}
              machine={screen.machine}
              station={screen.station}
              offDay={offDay}
              outroId={screen.outroId}
              onChoose={(side) =>
                push({
                  kind: "problems",
                  machine: screen.machine,
                  station: screen.station,
                  side,
                  outroId: screen.outroId,
                })
              }
            />
          ) : null}

          {papel === "preparador" && screen.kind === "problems" ? (
            <ProblemsScreen
              state={state}
              machine={screen.machine}
              station={screen.station}
              side={screen.side}
              offDay={offDay}
              outroId={screen.outroId ?? ""}
              bloqueioRef={bloqueioRef}
              onDescartar={confirmarSaida}
              onFicar={ficarNaTela}
              onSave={(alvos) => salvarContagens(screen.machine, screen.station, screen.side, screen.outroId ?? "", alvos)}
              onEstacoes={() => voltarAoSalvar("stations")}
              onLados={() => voltarAoSalvar("side")}
            />
          ) : null}

          {papel && screen.kind === "sheet" ? (
            <Suspense fallback={<p className="py-8 text-center text-sm text-muted">Abrindo o painel…</p>}>
            <SheetScreen
              state={state}
              today={today}
              offDay={offDay}
              onDate={setDate}
              onTurno={setTurno}
              papel={papel}
              onDelete={(entries) =>
                removeMany(
                  entries.map((entry) => entry.id),
                  entries.length === 1 ? "1 apontamento excluído" : `${entries.length} apontamentos excluídos`,
                )
              }
              onNotice={(text) => flash(text)}
              onCorrigirProducao={corrigirProducao}
              onLancarPerda={lancarCorrecao}
              onApagarPerda={apagarCorrecao}
            />
            </Suspense>
          ) : null}
        </div>
      </div>
      {rolou ? (
        <button
          type="button"
          aria-label="Voltar ao início"
          onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-24 right-4 z-40 grid size-11 place-items-center rounded-full border border-[#d5dee8] bg-white text-[#1e3a5f] shadow-[0_8px_20px_rgba(30,58,95,0.16)] lg:bottom-6"
        >
          <ChevronDown className="size-5 rotate-180" />
        </button>
      ) : null}
      {papel || screen.kind === "fechamento" ? (
        <nav data-nav="" className="shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
          <div className="grid grid-cols-3">
            <button
              type="button"
              onClick={abrirConfig}
              className="flex flex-col items-center gap-1 py-2 text-xs font-semibold text-accent"
            >
              <Settings className="size-5" />
              Configuração
            </button>
            <button
              type="button"
              onClick={irParaCasa}
              className="flex flex-col items-center gap-1 py-2 text-xs font-semibold text-accent"
            >
              <House className="size-5" />
              Início
            </button>
            <button
              type="button"
              onClick={back}
              className="flex flex-col items-center gap-1 py-2 text-xs font-semibold text-accent"
            >
              <ChevronLeft className="size-5" />
              Voltar
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function Loading() {
  return (
    <main className="flex h-dvh flex-col bg-bg text-fg">
      <header className="border-b border-line bg-surface">
        <div className="h-1 bg-accent" />
        <div className="px-4 py-4">
          <h1 className="font-display text-3xl leading-none tracking-wide text-accent">
            Injeção EVA
          </h1>
          <p className="font-display text-xl leading-none text-fg">(Sobral)</p>
          <p className="mt-2 text-base text-muted">Carregando o turno…</p>
        </div>
      </header>
    </main>
  );
}

function headerFor(screen: Screen): { context: string } {
  switch (screen.kind) {
    case "turnos":
      return { context: "" };
    case "machines":
      return { context: "" };
    case "modelo":
      return { context: `Máquina ${screen.machine}` };
    case "ask":
      return { context: `Máquina ${screen.machine}` };
    case "cor":
      return { context: `Máquina ${screen.machine} · cor` };
    case "troca-cor":
      return { context: `Máquina ${screen.machine} · troca de cor` };
    case "matrices":
      return { context: `Máquina ${screen.machine} · matrizes` };
    case "hub":
      return { context: `Máquina ${screen.machine}` };
    case "producao":
      return { context: `Máquina ${screen.machine}` };
    case "stations":
      return { context: `Máquina ${screen.machine}` };
    case "outros":
      return { context: `Máquina ${screen.machine} · troca de matriz` };
    case "side":
      return {
        context: screen.outroId
          ? `Máquina ${screen.machine} · Troca · Estação ${pad2(screen.station)}`
          : `Máquina ${screen.machine} · Estação ${pad2(screen.station)}`,
      };
    case "problems":
      return {
        context: screen.outroId
          ? `Máquina ${screen.machine} · Troca · Estação ${pad2(screen.station)} · ${SIDE_LABEL[screen.side]}`
          : `Máquina ${screen.machine} · Estação ${pad2(screen.station)} · ${SIDE_LABEL[screen.side]}`,
      };
    case "sheet":
      return { context: "Lançamentos" };
    case "fechamento":
      return { context: "Fechamento do turno" };
    case "lados":
      return { context: "A e B" };
    case "papel":
      return { context: "" };
  }
}

function ContextLine({ state, offDay }: { state: State; offDay: boolean }) {
  return (
    <p className={cx("text-sm font-semibold", offDay ? "text-accent" : "text-muted")}>
      {formatDateBR(state.date)} · {TURNO_LABEL[state.turno]}
      {offDay ? " · não é hoje" : ""}
    </p>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-muted">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        maxLength={32}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-tile border border-line bg-surface-2 px-3 py-3 text-base text-fg placeholder:text-muted"
      />
    </label>
  );
}

function PortaScreen({ onPick, onFechamento }: { onPick: (sessao: Sessao) => void; onFechamento: () => void }) {
  const segurando = useRef<number | null>(null);
  const segurou = useRef(false);

  function comecar(turno: Turno) {
    if (turno !== "1") return;
    segurou.current = false;
    if (segurando.current) window.clearTimeout(segurando.current);
    segurando.current = window.setTimeout(() => {
      segurando.current = null;
      segurou.current = true;
      onFechamento();
    }, 550);
  }

  function soltar() {
    if (!segurando.current) return;
    window.clearTimeout(segurando.current);
    segurando.current = null;
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-3">
      {(["1", "2", "3"] as const).map((turno) => (
        <button
          key={turno}
          type="button"
          onPointerDown={() => comecar(turno)}
          onPointerUp={soltar}
          onPointerCancel={soltar}
          onContextMenu={(event) => event.preventDefault()}
          onClick={() => {
            if (segurou.current) {
              segurou.current = false;
              return;
            }
            onPick({ papel: "preparador", turno });
          }}
          className="rounded-tile bg-accent py-5 font-display text-4xl leading-none text-accent-ink"
        >
          {TURNO_LABEL[turno]}
        </button>
      ))}
      <button
        type="button"
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => onPick({ papel: "lider", turno: null })}
        className="rounded-tile border border-line bg-surface py-5 font-display text-3xl leading-none text-fg"
      >
        Dashboard geral
      </button>
    </div>
  );
}

const GRADE_DIA_KEY = "injecao-grade-dia-v1";

function chaveGradeDia(turno: Turno, machine: MachineId, now = Date.now()) {
  return `${diaOperacional(turno, now)}|${turno}|${machine}`;
}

function gradePerguntada(turno: Turno, machine: MachineId) {
  try {
    const raw = localStorage.getItem(GRADE_DIA_KEY);
    const data: unknown = raw ? JSON.parse(raw) : {};
    if (!data || typeof data !== "object") return false;
    return Boolean((data as Record<string, unknown>)[chaveGradeDia(turno, machine)]);
  } catch {
    return false;
  }
}

function marcarGradeDia(turno: Turno, machine: MachineId) {
  try {
    const raw = localStorage.getItem(GRADE_DIA_KEY);
    const data: Record<string, number> =
      raw && typeof JSON.parse(raw) === "object" ? (JSON.parse(raw) as Record<string, number>) : {};
    data[chaveGradeDia(turno, machine)] = Date.now();
    localStorage.setItem(GRADE_DIA_KEY, JSON.stringify(data));
  } catch {
    /* a confirmação vale só neste aparelho */
  }
}

function HubMaquina({
  machine,
  turno,
  onProducao,
  onPerdas,
  onGrade,
}: {
  machine: MachineId;
  turno: Turno;
  onProducao: () => void;
  onPerdas: () => void;
  onGrade: () => void;
}) {
  const [perguntar, setPerguntar] = useState(false);
  function abrirPerdas() {
    if (gradePerguntada(turno, machine)) {
      onPerdas();
      return;
    }
    setPerguntar(true);
  }
  function responder(atualizar: boolean) {
    marcarGradeDia(turno, machine);
    setPerguntar(false);
    if (atualizar) onGrade();
    else onPerdas();
  }
  return (
    <div className="w-full max-w-sm">
      <p className="text-center text-xs font-semibold tracking-[0.22em] text-muted">MÁQUINA</p>
      <h2 className="mt-2 text-center font-display text-5xl leading-none">{machine}</h2>
      <div className="mt-8 grid gap-3">
        <button
          type="button"
          onClick={onProducao}
          className="rounded-3xl border border-line bg-white py-7 text-center font-display text-4xl leading-none text-fg shadow-[0_10px_30px_rgba(47,84,150,0.08)]"
        >
          Produção
        </button>
        <button
          type="button"
          onClick={abrirPerdas}
          className="rounded-3xl bg-accent py-7 text-center font-display text-4xl leading-none text-accent-ink"
        >
          Perdas
        </button>
      </div>
      {perguntar ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setPerguntar(false);
          }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <p className="text-center text-lg font-semibold">Deseja atualizar a grade de matrizes?</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => responder(true)} className="rounded-2xl bg-[#2457b8] py-3 text-sm font-semibold text-white">
                Sim
              </button>
              <button type="button" onClick={() => responder(false)} className="rounded-2xl bg-[#f3f6fb] py-3 text-sm font-semibold">
                Não
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function IconeEditar() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function IconeTroca() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 3.8c2.2 0 3.3 1.8 3.3 4.2 0 1.5-.4 2.6-.4 4.4 0 2.3-1.3 4.1-2.9 4.1S5.6 14.7 5.6 12.4c0-1.8-.4-2.9-.4-4.4.1-2.4 1.2-4.2 3.3-4.2z" />
      <path d="M16.2 8.2a4.2 4.2 0 1 1-1.4 3.3" />
      <path d="M16.2 5.6v2.8h2.8" />
    </svg>
  );
}

type NumeroProducao = { id: string; numero: string };

/** Um campo por numeração. Lado, estação e referência não abrem outro campo. */
function numerosProducao(state: State, machine: MachineId, date: string, turno: Turno): NumeroProducao[] {
  const vistos = new Set<string>();
  const lista: NumeroProducao[] = [];
  function incluir(numero: string) {
    const limpo = numero.trim();
    if (!limpo || vistos.has(limpo)) return;
    vistos.add(limpo);
    lista.push({ id: limpo, numero: limpo });
  }
  for (const station of STATIONS) {
    const config = state.stations[stationKey(machine, station)];
    if (!config) continue;
    if (config.ambos) {
      incluir(numeroLimpo(config.numero));
      continue;
    }
    incluir(numeroLimpo(config.esq.numero));
    incluir(numeroLimpo(config.dir.numero));
  }
  for (const outro of state.outros) {
    if (!outroVivo(outro) || outro.machine !== machine || outro.date !== date || outro.turno !== turno) continue;
    incluir(numeroLimpo(outro.numero));
  }
  return lista.sort((a, b) => a.numero.localeCompare(b.numero, "pt-BR", { numeric: true }));
}

function ProducaoScreen({
  state,
  machine,
  turno,
  onSave,
}: {
  state: State;
  machine: MachineId;
  turno: Turno;
  onSave: (valores: Record<string, number>) => void;
}) {
  const numeros = numerosProducao(state, machine, state.date, turno);
  const assinatura = numeros.map((item) => item.id).join("|");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [sujo, setSujo] = useState(false);
  const [editando, setEditando] = useState(
    () =>
      !(state.producao ?? []).some(
        (item) => diaDoApontamento(item) === state.date && item.turno === turno && item.machine === machine && item.pares > 0,
      ),
  );

  useEffect(() => {
    if (sujo) return;
    const proximo: Record<string, string> = {};
    for (const item of state.producao ?? []) {
      if (diaDoApontamento(item) !== state.date || item.turno !== turno || item.machine !== machine || item.pares <= 0) continue;
      proximo[item.numero] = String(item.pares);
    }
    setValores(proximo);
    setEditando(Object.keys(proximo).length === 0);
  }, [state.date, state.producao, turno, machine, assinatura, sujo]);

  const producao = numeros.reduce((soma, item) => soma + (Number(valores[item.id]) || 0), 0);
  const perdas = paresDasEntradas(
    state.entries.filter((entry) => entry.date === state.date && entry.turno === turno && entry.machine === machine),
  );
  const toque = useToque();
  const [foco, setFoco] = useState<string | null>(null);
  const [campo, setCampo] = useState<Campo>(campoInicial(0));
  const sessao = useRef<{ id: string; valor: string } | null>(null);

  function abrirProducao(id: string) {
    if (!editando || foco === id) return;
    if (foco && foco !== id) {
      const gravado = teclaConta(campo, "ok");
      setSujo(true);
      setValores((atual) => ({ ...atual, [foco]: gravado.texto === "0" ? "" : gravado.texto }));
    }
    const valor = valores[id] ?? "";
    sessao.current = { id, valor };
    setCampo(campoInicial(Number(valores[id]) || 0));
    setFoco(id);
  }

  function fecharProducao() {
    if (!foco) return;
    const gravado = teclaConta(campo, "ok");
    setSujo(true);
    setValores((atual) => ({ ...atual, [foco]: gravado.texto === "0" ? "" : gravado.texto }));
    sessao.current = null;
    setFoco(null);
  }
  useFecharTeclado(Boolean(toque && foco && editando), fecharProducao, foco);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10.5rem)] w-full max-w-md flex-col">
      <div className="text-center">
        <p className="text-sm font-semibold text-muted">
          {TURNO_LABEL[turno]} · {formatDateBR(state.date)}
        </p>
        <h2 className="mt-2 font-display text-5xl leading-none">{machine}</h2>
      </div>
      <section className="mt-4 grid grid-cols-3 gap-2 rounded-3xl bg-white p-4 text-center shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
        <div>
          <p className="text-xs font-semibold text-muted">Produção</p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums">{producao}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted">Perdas</p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums">{perdas}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted">% perda</p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums">{textoPercentual(percentualPerda(perdas, producao))}</p>
        </div>
      </section>
      {numeros.length === 0 ? (
        <p className="mt-4 rounded-3xl border border-dashed border-line bg-surface px-4 py-8 text-center text-base text-muted">
          Sem matrizaria.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {numeros.map((item) => (
            <label
              key={item.id}
              data-bloco=""
              className={cx(
                "flex flex-col items-center rounded-3xl bg-white p-4 text-center shadow-[0_8px_24px_rgba(47,84,150,0.08)]",
                foco === item.id && "ring-2 ring-accent",
              )}
            >
              <span className="font-display text-4xl leading-none">{item.numero}</span>
              {toque && editando ? (
                <button
                  type="button"
                  data-campo-teclado=""
                  data-foco={foco === item.id ? "" : undefined}
                  onClick={() => abrirProducao(item.id)}
                  className={cx(
                    "mt-4 w-full rounded-2xl border px-3 py-3 text-center font-display text-3xl leading-none tabular-nums",
                    foco === item.id ? "border-accent bg-accent-soft text-accent" : "border-line bg-[#f7f9fd]",
                  )}
                >
                  {foco === item.id ? campo.texto : valores[item.id] || "0"}
                </button>
              ) : (
                <input
                  inputMode="numeric"
                  value={valores[item.id] ?? ""}
                  aria-label={`Pares de ${item.numero}`}
                  placeholder="0"
                  readOnly={!editando}
                  onChange={(event) => {
                    if (!editando) return;
                    const limpo = event.target.value.replace(/\D/g, "").slice(0, 6);
                    setSujo(true);
                    setValores((atual) => ({ ...atual, [item.id]: limpo }));
                  }}
                  className={cx(
                    "mt-4 w-full rounded-2xl border border-line px-3 py-3 text-center font-display text-3xl leading-none tabular-nums outline-none",
                    editando ? "bg-[#f7f9fd] focus:border-[#4682B4]" : "bg-[#f3f4f6] text-muted",
                  )}
                />
              )}
            </label>
          ))}
        </div>
      )}
      <div className="sticky bottom-0 mt-auto bg-bg/95 py-3 backdrop-blur">
        {toque && foco && editando ? (
          <Teclado
            modo="conta"
            conta={campo.modo}
            onTecla={(tecla) => {
              setSujo(true);
              setCampo((atual) => teclaConta(atual, tecla));
            }}
          />
        ) : editando ? (
          <button
            type="button"
            disabled={numeros.length === 0}
            onClick={() => {
              const gravar: Record<string, number> = {};
              for (const item of numeros) gravar[item.id] = Number(valores[item.id]) || 0;
              setSujo(false);
              setEditando(false);
              onSave(gravar);
            }}
            className="w-full rounded-2xl bg-accent py-4 font-display text-3xl leading-none text-accent-ink disabled:opacity-50"
          >
            Salvar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditando(true);
              setSujo(true);
            }}
            className="w-full rounded-2xl border border-line bg-white py-4 font-display text-3xl leading-none text-fg"
          >
            Editar produção
          </button>
        )}
      </div>
    </div>
  );
}


function perdasNoCartao(state: State, machine: MaquinaPiso) {
  const [ladoA, ladoB] = variantesDe(machine);
  return [machine, ladoA, ladoB].reduce((soma, id) => soma + shiftEntries(state, id).length, 0);
}

function MachinesScreen({
  state,
  onOpen,
}: {
  state: State;
  onOpen: (machine: MachineId) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl text-center">
      <p className="mb-2 font-display text-4xl leading-none text-accent">{TURNO_LABEL[state.turno]}</p>
      <h2 className="font-display text-3xl leading-none">Qual máquina?</h2>
      <p className="mb-3 mt-2 text-sm text-muted">{formatDateBR(state.date)}</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {MAQUINAS_PISO.map((machine) => {
          const count = perdasNoCartao(state, machine);
          return (
            <button
              key={machine}
              type="button"
              onClick={() => onOpen(machine)}
              className="flex min-h-32 flex-col items-center rounded-tile border border-line bg-surface p-4 text-center"
            >
              <span className="text-sm font-semibold text-muted">Máquina</span>
              <span className="mt-1 font-display text-4xl leading-none">{machine}</span>
              <span
                className={cx(
                  "mt-auto pt-4 font-display text-2xl leading-none tabular-nums",
                  count > 0 ? "text-accent" : "text-muted",
                )}
              >
                {count > 0 ? `${count} perdas` : "sem perda"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModeloScreen({ machine, onPick }: { machine: MaquinaPiso; onPick: (machine: MachineId) => void }) {
  const lados = [
    ["A", variantesDe(machine)[0]],
    ["B", variantesDe(machine)[1]],
  ] as const;
  return (
    <div className="w-full max-w-sm">
      <p className="text-center text-xs font-semibold tracking-[0.22em] text-muted">MÁQUINA</p>
      <h2 className="mt-2 text-center font-display text-5xl leading-none">{machine}</h2>
      <div className="mt-8 grid gap-3">
        {lados.map(([letra, id]) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className="rounded-3xl border border-line bg-white py-7 text-center shadow-[0_10px_30px_rgba(47,84,150,0.08)]"
          >
            <span className="block font-display text-5xl leading-none">{letra}</span>
            <span className="mt-1 block text-sm font-semibold text-muted">{id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CorScreen({ machine, onSave }: { machine: MachineId; onSave: (nome: string) => void }) {
  const [nome, setNome] = useState("");
  return (
    <div>
      <h2 className="font-display text-4xl leading-none">{machine}</h2>
      <div className="mt-4">
        <Field label="Cor" value={nome} placeholder="Preto" onChange={setNome} />
      </div>
      <button
        type="button"
        onClick={() => onSave(nome)}
        className="mt-4 w-full rounded-tile bg-accent py-4 font-display text-3xl leading-none text-accent-ink"
      >
        Começar
      </button>
    </div>
  );
}

function TrocaCorScreen({
  state,
  machine,
  corId,
  offDay,
  onSave,
}: {
  state: State;
  machine: MachineId;
  corId: string;
  offDay: boolean;
  onSave: (nome: string, stations: number[], grades: Record<string, StationConfig>) => void;
}) {
  const origem = state.cores.find((item) => item.id === corId);
  const [nome, setNome] = useState("");
  const [escolhidas, setEscolhidas] = useState<number[]>([]);
  const [grades, setGrades] = useState<Record<string, StationConfig>>({});

  function alternar(station: number) {
    setEscolhidas((atual) => {
      if (atual.includes(station)) {
        setGrades((base) => {
          const next = { ...base };
          delete next[String(station)];
          return next;
        });
        return atual.filter((item) => item !== station);
      }
      const config = origem?.grades[String(station)] ?? state.stations[stationKey(machine, station)] ?? emptyConfig();
      setGrades((base) => ({ ...base, [String(station)]: config }));
      return [...atual, station].sort((a, b) => a - b);
    });
  }

  function patch(station: number, config: StationConfig) {
    setGrades((base) => ({ ...base, [String(station)]: config }));
  }

  return (
    <div>
      <h2 className="font-display text-4xl leading-none">Troca de cor</h2>
      <div className="mt-4">
        <Field label="Nome da cor" value={nome} placeholder="Azul" onChange={setNome} />
      </div>
      <p className="mb-2 mt-4 text-sm font-semibold text-muted">Estações que mudaram</p>
      <div className="grid grid-cols-4 gap-2">
        {STATIONS.map((station) => {
          const ligada = escolhidas.includes(station);
          return (
            <button
              key={station}
              type="button"
              onClick={() => alternar(station)}
              className={cx(
                "rounded-tile py-3 font-display text-2xl leading-none",
                ligada ? "bg-accent text-accent-ink" : "border border-line bg-surface",
              )}
            >
              {pad2(station)}
            </button>
          );
        })}
      </div>
      {escolhidas.map((station) => {
        const config = grades[String(station)] ?? emptyConfig();
        return (
          <div key={station} className="mt-4 rounded-tile border border-line bg-surface p-3">
            <p className="text-sm font-semibold">Estação {pad2(station)}</p>
            {config.ambos ? (
              <NumberPair
                numero={config.numero}
                referencia={config.referencia}
                onNumero={(numero) => patch(station, { ...config, numero })}
                onReferencia={(referencia) => patch(station, { ...config, referencia })}
              />
            ) : (
              <div className="grid gap-3">
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted">Esquerda</p>
                  <NumberPair
                    numero={config.esq.numero}
                    referencia={config.esq.referencia}
                    onNumero={(numero) => patch(station, { ...config, esq: { ...config.esq, numero } })}
                    onReferencia={(referencia) => patch(station, { ...config, esq: { ...config.esq, referencia } })}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted">Direita</p>
                  <NumberPair
                    numero={config.dir.numero}
                    referencia={config.dir.referencia}
                    onNumero={(numero) => patch(station, { ...config, dir: { ...config.dir, numero } })}
                    onReferencia={(referencia) => patch(station, { ...config, dir: { ...config.dir, referencia } })}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        disabled={offDay}
        onClick={() => onSave(nome, escolhidas, grades)}
        className="mt-4 w-full rounded-tile bg-accent py-4 font-display text-3xl leading-none text-accent-ink disabled:opacity-50"
      >
        Abrir cor
      </button>
    </div>
  );
}

function StationsScreen({
  state,
  machine,
  offDay,
  onDownload,
  onEditar,
  onOpen,
  onOpenOutro,
  onDeleteOutro,
  onTrocar,
}: {
  state: State;
  machine: MachineId;
  offDay: boolean;
  onDownload: () => void;
  onEditar: () => void;
  onOpen: (station: number) => void;
  onOpenOutro: (outro: OutroMatriz) => void;
  onDeleteOutro: (id: string) => void;
  onTrocar: () => void;
}) {
  const [pedindo, setPedindo] = useState("");
  const outros = state.outros.filter(
    (item) => outroVivo(item) && item.machine === machine && item.date === state.date && item.turno === state.turno,
  );
  return (
    <div className="mx-auto w-full max-w-5xl">
      <ContextLine state={state} offDay={offDay} />
      <div className="mt-3 flex items-center justify-between gap-3 rounded-tile border border-line bg-surface px-4 py-3">
        <span className="min-w-0 text-center">
          <span className="block text-sm text-muted">Máquina</span>
          <span className="font-display text-3xl leading-none">{machine}</span>
        </span>
        <span className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onDownload}
            aria-label="Baixar ficha"
            className="grid size-12 place-items-center rounded-tile bg-accent text-accent-ink"
          >
            <ImageDown className="size-6" />
          </button>
          <button
            type="button"
            onClick={onEditar}
            aria-label="Editar matrizes"
            className="grid size-12 place-items-center rounded-tile border border-line bg-white text-accent"
          >
            <IconeEditar />
          </button>
          <button
            type="button"
            onClick={onTrocar}
            aria-label="Troca de matriz"
            className="grid size-12 place-items-center rounded-tile border border-line bg-white text-accent"
          >
            <IconeTroca />
          </button>
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATIONS.map((station) => {
          const config = state.stations[stationKey(machine, station)];
          const count = shiftEntries(state, machine).filter(
            (entry) => !entry.outroId && entry.station === station,
          ).length;
          return (
            <button
              key={station}
              type="button"
              onClick={() => onOpen(station)}
              className="flex min-h-32 flex-col items-center rounded-tile border border-line bg-surface p-3 text-center"
            >
              <span className="text-sm font-semibold text-muted">Estação</span>
              <span className="font-display text-4xl leading-none">{pad2(station)}</span>
              <MatrixPreview config={config} />
              <span
                className={cx(
                  "mt-auto pt-3 font-display text-xl leading-none tabular-nums",
                  count > 0 ? "text-accent" : "text-muted",
                )}
              >
                {count > 0 ? `${count} perdas` : "sem perda"}
              </span>
            </button>
          );
        })}
      </div>
      {outros.length > 0 ? (
        <div className="mt-4">
          <p className="text-sm font-semibold text-muted">Trocas neste turno</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            {outros.map((outro) => {
              const count = shiftEntries(state, machine).filter((entry) => entry.outroId === outro.id).length;
              const lugar = outro.station >= 1 ? `Estação ${pad2(outro.station)}` : "Sem estação";
              const lado = outro.ambos ? "Ambos os lados" : SIDE_LABEL[outro.side];
              return (
                <div
                  key={outro.id}
                  className="flex min-h-32 flex-col rounded-tile border border-accent bg-surface p-3"
                >
                  <button type="button" onClick={() => onOpenOutro(outro)} className="flex flex-1 flex-col text-left">
                    <span className="text-sm font-semibold text-accent">Troca</span>
                    <span className="mt-1 font-display text-3xl leading-none">{lugar}</span>
                    <span className="mt-1 text-base font-semibold leading-snug">
                      {numeroLimpo(outro.numero) || "—"}
                      {outro.referencia ? ` · ${outro.referencia}` : ""}
                    </span>
                    <span className="text-sm text-muted">{lado}</span>
                    <span className={cx("mt-auto pt-3 font-display text-xl leading-none", count > 0 ? "text-accent" : "text-muted")}>
                      {count > 0 ? `${count} perdas` : "sem perda"}
                    </span>
                  </button>
                  {offDay ? null : pedindo === outro.id ? (
                    <span className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                      <span>{count > 0 ? `Excluir esta troca e ${count} perdas?` : "Excluir esta troca?"}</span>
                      <button type="button" onClick={() => setPedindo("")} className="font-semibold text-muted">
                        Não
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPedindo("");
                          onDeleteOutro(outro.id);
                        }}
                        className="rounded-full bg-[#9b3a34] px-3 py-1 font-semibold text-white"
                      >
                        Excluir
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPedindo(outro.id)}
                      className="mt-2 self-start text-sm font-semibold text-[#9b3a34]"
                    >
                      Excluir
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OutrosScreen({
  offDay,
  onSave,
}: {
  machine: MachineId;
  offDay: boolean;
  onSave: (station: number, ambos: boolean, side: Side, numero: string, referencia: string) => void;
}) {
  const [station, setStation] = useState(0);
  const [ambos, setAmbos] = useState(false);
  const [side, setSide] = useState<Side>("esq");
  const [numero, setNumero] = useState("");
  const [referencia, setReferencia] = useState("");
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10.5rem)] w-full max-w-md flex-col">
      {offDay ? <p className="mb-2 text-center text-sm font-semibold text-accent">Dia fechado.</p> : null}
      <p className="mt-4 text-sm font-semibold text-muted">Estação</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {STATIONS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setStation(item)}
            className={cx(
              "rounded-tile border py-3 font-display text-3xl leading-none",
              station === item ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface",
            )}
          >
            {pad2(item)}
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 rounded-tile border border-line bg-surface px-4 py-3">
        <p className="text-base font-semibold">Usar numeração para ambos os lados?</p>
        <button
          type="button"
          role="switch"
          aria-checked={ambos}
          onClick={() => setAmbos((value) => !value)}
          className={cx("relative h-8 w-14 shrink-0 rounded-full", ambos ? "bg-accent" : "bg-line")}
        >
          <span className={cx("absolute top-1 size-6 rounded-full bg-white", ambos ? "left-7" : "left-1")} />
        </button>
      </div>
      {ambos ? null : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {SIDES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSide(item)}
              className={cx(
                "rounded-tile border px-3 py-3 text-base font-semibold",
                side === item ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface",
              )}
            >
              {SIDE_LABEL[item]}
            </button>
          ))}
        </div>
      )}
      <div className="mt-4">
        <NumberPair numero={numero} referencia={referencia} onNumero={setNumero} onReferencia={setReferencia} />
      </div>
      <div className="sticky bottom-0 mt-auto bg-bg/95 py-3 backdrop-blur">
        <button
          type="button"
          disabled={offDay}
          onClick={() => onSave(station, ambos, side, numero, referencia)}
          className="w-full rounded-2xl bg-accent py-4 font-display text-3xl leading-none text-accent-ink disabled:opacity-50"
        >
          Adicionar troca
        </button>
      </div>
    </div>
  );
}

function MatrixPreview({ config }: { config: StationConfig | undefined }) {
  const esq = describeMatrix(config, "esq");
  const dir = describeMatrix(config, "dir");
  if (!esq && !dir) {
    return <span className="mt-2 text-sm text-muted">Sem numeração</span>;
  }
  if (config?.ambos) {
    return <span className="mt-2 block text-sm leading-snug text-fg">Ambos · {esq}</span>;
  }
  return (
    <span className="mt-2 block text-sm leading-snug">
      <span className="block text-muted">
        Esq. <span className="text-fg">{esq || "—"}</span>
      </span>
      <span className="block text-muted">
        Dir. <span className="text-fg">{dir || "—"}</span>
      </span>
    </span>
  );
}

function SideScreen({
  state,
  machine,
  station,
  offDay,
  onChoose,
  outroId = "",
  corId = "",
}: {
  state: State;
  machine: MachineId;
  station: number;
  offDay: boolean;
  onChoose: (side: Side) => void;
  outroId?: string;
  corId?: string;
}) {
  const outro = state.outros.find((item) => item.id === outroId);
  const cor = state.cores.find((item) => item.id === corId);
  const config = cor?.grades[String(station)] ?? state.stations[stationKey(machine, station)];
  const primeira = coresDaMaquina(state, machine)[0];
  const rows = shiftEntries(state, machine).filter((entry) =>
    outroId
      ? entry.outroId === outroId
      : !entry.outroId &&
        entry.station === station &&
        (!corId || entry.corId === corId || (!entry.corId && corId === primeira?.id)),
  );
  const troca = outro ? [outro.numero, outro.referencia].filter(Boolean).join(" · ") : "";
  return (
    <div>
      <ContextLine state={state} offDay={offDay} />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {SIDES.map((side) => {
          const count = rows.filter((entry) => entry.side === side).length;
          const matrix = outro ? troca : describeMatrix(config, side);
          return (
            <button
              key={side}
              type="button"
              onClick={() => onChoose(side)}
              className="flex items-center justify-between rounded-tile border border-line bg-surface px-5 py-6 text-left"
            >
              <span>
                <span className="block font-display text-5xl leading-none">
                  {SIDE_LABEL[side]}
                </span>
                {matrix ? <span className="mt-2 block text-base text-muted">{matrix}</span> : null}
              </span>
              <span className="font-display text-4xl leading-none tabular-nums text-accent">
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProblemsScreen({
  state,
  machine,
  station,
  side,
  offDay,
  onSave,
  outroId = "",
  bloqueioRef,
  onDescartar,
  onFicar,
  onEstacoes,
  onLados,
}: {
  state: State;
  machine: MachineId;
  station: number;
  side: Side;
  offDay: boolean;
  onSave: (alvos: Record<string, number>) => boolean;
  outroId?: string;
  bloqueioRef: MutableRefObject<(() => void) | null>;
  onDescartar: () => void;
  onFicar: () => void;
  onEstacoes: () => void;
  onLados: () => void;
}) {
  const outro = state.outros.find((item) => item.id === outroId);
  const config = state.stations[stationKey(machine, station)];
  const matrix = outro ? [outro.numero, outro.referencia].filter(Boolean).join(" · ") : describeMatrix(config, side);
  const rows = shiftEntries(state, machine).filter((entry) => {
    if (outroId) return entry.outroId === outroId && entry.side === side;
    return !entry.outroId && entry.station === station && entry.side === side;
  });
  const counts = new Map<string, number>();
  for (const entry of rows) counts.set(entry.problem, (counts.get(entry.problem) ?? 0) + 1);
  const base = PROBLEMS.map((problem) => `${problem.id}:${counts.get(problem.id) ?? 0}`).join("|");
  const [campos, setCampos] = useState<Record<string, Campo>>(() => camposDasContagens(counts));
  const [foco, setFoco] = useState<string | null>(null);
  const [aviso, setAviso] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const toque = useToque();
  const sessao = useRef<{ id: string; campo: Campo } | null>(null);
  const sujo = PROBLEMS.some((problem) => Number(campos[problem.id]?.texto ?? 0) !== (counts.get(problem.id) ?? 0));

  useEffect(() => {
    if (sujo) return;
    setCampos(camposDasContagens(counts));
  }, [base]);

  useEffect(() => {
    bloqueioRef.current = sujo && !offDay ? () => setAviso(true) : null;
    return () => {
      bloqueioRef.current = null;
    };
  }, [sujo, offDay, bloqueioRef]);

  const unica = matrizUnicaNoDia(state.date, outro ? outro.ambos : Boolean(config?.ambos));

  function abrirCampo(id: string) {
    if (!toque || offDay || foco === id) return;
    setCampos((atual) => {
      const aberta = sessao.current;
      const proximo =
        aberta && aberta.id !== id
          ? { ...atual, [aberta.id]: teclaConta(atual[aberta.id] ?? campoInicial(counts.get(aberta.id) ?? 0), "ok") }
          : atual;
      sessao.current = { id, campo: proximo[id] ?? campoInicial(counts.get(id) ?? 0) };
      return proximo;
    });
    setFoco(id);
  }

  function fecharTeclado() {
    if (foco) setCampos((atual) => ({ ...atual, [foco]: teclaConta(atual[foco] ?? campoInicial(0), "ok") }));
    sessao.current = null;
    setFoco(null);
  }
  useFecharTeclado(Boolean(toque && foco && !offDay), fecharTeclado, foco);

  function salvar() {
    if (offDay) return;
    const alvos: Record<string, number> = {};
    for (const problem of PROBLEMS) alvos[problem.id] = Number(campos[problem.id]?.texto) || 0;
    if (!onSave(alvos)) return;
    setFoco(null);
    setSalvo(true);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0">
        <ContextLine state={state} offDay={offDay} />
        {offDay ? <p className="mt-2 text-sm font-semibold text-accent">Dia fechado.</p> : null}
        {matrix ? <p className="mt-2 text-base font-semibold">{matrix}</p> : null}
        <p className="mt-1 text-sm text-muted">Digite o total de solas. + soma e – tira. Só grava em Salvar.</p>
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        <div className="grid gap-2 pr-1">
          {PROBLEMS.filter((problem) => problem.id !== "contaminacao").map((problem) => {
            const campo = campos[problem.id] ?? campoInicial(counts.get(problem.id) ?? 0);
            const ativo = foco === problem.id;
            return (
              <div
                key={problem.id}
                data-bloco=""
                className={cx(
                  "flex items-center gap-2 rounded-tile border bg-surface px-3 py-2",
                  ativo ? "border-accent" : "border-line",
                )}
              >
                <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{problem.name}</p>
                {toque ? (
                  <button
                    type="button"
                    data-campo-teclado=""
                    data-foco={ativo ? "" : undefined}
                    disabled={offDay}
                    onClick={() => abrirCampo(problem.id)}
                    className={cx(
                      "grid h-12 w-16 shrink-0 place-items-center rounded-xl border font-display text-2xl leading-none tabular-nums",
                      ativo ? "border-accent bg-accent-soft text-accent" : "border-line bg-[#f7f9fd]",
                    )}
                  >
                    {campo.texto}
                  </button>
                ) : (
                  <input
                    inputMode="numeric"
                    value={campo.texto}
                    aria-label={problem.name}
                    disabled={offDay}
                    onChange={(event) => {
                      const digitos = event.target.value.replace(/\D/g, "").slice(0, 4);
                      const n = Number(digitos) || 0;
                      setCampos((atual) => ({ ...atual, [problem.id]: { texto: String(n), modo: "total", ancora: n, digitos } }));
                    }}
                    className="h-12 w-16 shrink-0 rounded-xl border border-line bg-[#f7f9fd] text-center font-display text-2xl leading-none tabular-nums outline-none focus:border-accent"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="shrink-0 bg-bg pt-2">
        {toque && foco && !offDay ? (
          <Teclado
            modo="conta"
            conta={campos[foco]?.modo}
            onTecla={(tecla) => setCampos((atual) => ({ ...atual, [foco]: teclaConta(atual[foco] ?? campoInicial(0), tecla) }))}
          />
        ) : (
          <button
            type="button"
            disabled={offDay}
            onClick={salvar}
            className="mt-2 w-full rounded-2xl bg-accent py-4 font-display text-3xl leading-none text-accent-ink disabled:opacity-50"
          >
            Salvar
          </button>
        )}
      </div>
      {aviso ? (
        <AvisoSair
          onFicar={() => {
            setAviso(false);
            onFicar();
          }}
          onSair={() => {
            setAviso(false);
            bloqueioRef.current = null;
            onDescartar();
          }}
        />
      ) : null}
      {salvo ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-6">
          <div className="w-full max-w-sm rounded-3xl bg-white px-6 py-6 text-center shadow-xl">
            <p className="text-lg font-semibold">Apontamentos salvos.</p>
            <p className="mt-2 text-base text-muted">Deseja voltar?</p>
            <div className={cx("mt-5 grid gap-2", unica ? "grid-cols-1" : "grid-cols-2")}>
              <button type="button" onClick={onEstacoes} className="rounded-2xl bg-[#f3f6fb] py-3 text-sm font-semibold">
                Estações
              </button>
              {unica ? null : (
                <button type="button" onClick={onLados} className="rounded-2xl bg-[#2457b8] py-3 text-sm font-semibold text-white">
                  Lados
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function camposDasContagens(counts: Map<string, number>): Record<string, Campo> {
  const campos: Record<string, Campo> = {};
  for (const problem of PROBLEMS) campos[problem.id] = campoInicial(counts.get(problem.id) ?? 0);
  return campos;
}

function AskScreen({
  machine,
  onEdit,
  onSkip,
  onTrocar,
}: {
  machine: MachineId;
  onEdit: () => void;
  onSkip: () => void;
  onTrocar: () => void;
}) {
  return (
    <div>
      <h2 className="font-display text-4xl leading-none">{machine}</h2>
      <button
        type="button"
        onClick={onTrocar}
        className="mt-4 text-sm font-semibold text-accent"
      >
        Trocar de máquina
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="mt-4 w-full rounded-tile bg-accent py-4 font-display text-3xl leading-none text-accent-ink"
      >
        Sim, editar
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="mt-3 w-full rounded-tile border border-line bg-surface py-4 text-base font-semibold"
      >
        Agora não
      </button>
    </div>
  );
}

function MatrixGradeScreen({
  state,
  machine,
  grades,
  onSave,
}: {
  state: State;
  machine: MachineId;
  grades?: Record<string, StationConfig>;
  onSave: (configs: StationConfig[]) => void;
}) {
  const [drafts, setDrafts] = useState<StationConfig[]>(() =>
    STATIONS.map((station) => grades?.[String(station)] ?? state.stations[stationKey(machine, station)] ?? emptyConfig()),
  );
  const [falhas, setFalhas] = useState<string[]>([]);

  function patch(index: number, next: StationConfig) {
    setDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
  }

  function salvar() {
    const avisos: string[] = [];
    drafts.forEach((draft, index) => {
      const estacao = `Estação ${pad2(index + 1)}`;
      const pares = draft.ambos
        ? [[estacao, draft.numero, draft.referencia] as const]
        : [
            [`${estacao}, esquerda`, draft.esq.numero, draft.esq.referencia] as const,
            [`${estacao}, direita`, draft.dir.numero, draft.dir.referencia] as const,
          ];
      for (const [lugar, numero, referencia] of pares) {
        const temNumero = Boolean(numeroLimpo(numero));
        const temReferencia = Boolean(referenciaLimpa(referencia));
        if (temNumero && !temReferencia) avisos.push(`${lugar}: falta a referência.`);
        if (!temNumero && temReferencia) avisos.push(`${lugar}: falta a numeração.`);
      }
    });
    if (avisos.length > 0) {
      setFalhas(avisos);
      return;
    }
    onSave(drafts);
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10.5rem)] w-full max-w-5xl flex-col">
      <p className="text-center text-base text-muted">
        Em cada estação, ative o seletor se a mesma numeração vale para a esquerda e a direita.
      </p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {STATIONS.map((station, index) => {
          const draft = drafts[index] ?? emptyConfig();
          return (
            <section key={station} className="rounded-tile border border-line bg-surface p-4">
              <h2 className="font-display text-3xl leading-none">Estação {pad2(station)}</h2>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-base font-semibold">Usar numeração para ambos os lados?</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.ambos}
                  aria-label={`Usar numeração para ambos os lados na estação ${station}`}
                  onClick={() => patch(index, { ...draft, ambos: !draft.ambos })}
                  className={cx(
                    "relative h-8 w-14 shrink-0 rounded-full border",
                    draft.ambos ? "border-accent bg-accent" : "border-line bg-surface-2",
                  )}
                >
                  <span
                    className={cx(
                      "absolute top-1 size-6 rounded-full bg-surface",
                      draft.ambos ? "right-1" : "left-1",
                    )}
                  />
                </button>
              </div>
              {draft.ambos ? (
                <div className="mt-3">
                  <NumberPair
                    numero={draft.numero}
                    referencia={draft.referencia}
                    onNumero={(numero) => patch(index, { ...draft, numero })}
                    onReferencia={(referencia) => patch(index, { ...draft, referencia })}
                  />
                </div>
              ) : (
                <div className="mt-3 grid gap-3">
                  <div>
                    <p className="mb-2 font-semibold">Esquerda</p>
                    <NumberPair
                      numero={draft.esq.numero}
                      referencia={draft.esq.referencia}
                      onNumero={(numero) =>
                        patch(index, { ...draft, esq: { ...draft.esq, numero } })
                      }
                      onReferencia={(referencia) =>
                        patch(index, { ...draft, esq: { ...draft.esq, referencia } })
                      }
                    />
                  </div>
                  <div>
                    <p className="mb-2 font-semibold">Direita</p>
                    <NumberPair
                      numero={draft.dir.numero}
                      referencia={draft.dir.referencia}
                      onNumero={(numero) =>
                        patch(index, { ...draft, dir: { ...draft.dir, numero } })
                      }
                      onReferencia={(referencia) =>
                        patch(index, { ...draft, dir: { ...draft.dir, referencia } })
                      }
                    />
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
      <div className="sticky bottom-0 mt-auto bg-bg/95 py-3 backdrop-blur">
        <button
          type="button"
          onClick={salvar}
          className="w-full rounded-2xl bg-accent py-4 font-display text-3xl leading-none text-accent-ink"
        >
          Salvar grade
        </button>
      </div>
      {falhas.length > 0 ? (
        <div
          className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) setFalhas([]);
          }}
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-xl">
            <p className="text-lg font-semibold">Não salvei a grade</p>
            <p className="mt-1 text-sm text-muted">Número e referência andam juntos. Os dois vazios significam estação sem molde.</p>
            <ul className="mt-3 grid gap-1 text-sm font-semibold">
              {falhas.map((aviso) => (
                <li key={aviso}>{aviso}</li>
              ))}
            </ul>
            <button type="button" onClick={() => setFalhas([])} className="mt-4 w-full rounded-2xl bg-accent py-3 text-sm font-semibold text-accent-ink">
              Entendi
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NumberPair({
  numero,
  referencia,
  onNumero,
  onReferencia,
}: {
  numero: string;
  referencia: string;
  onNumero: (value: string) => void;
  onReferencia: (value: string) => void;
}) {
  const toque = useToque();
  const [foco, setFoco] = useState<"numero" | "referencia" | null>(null);
  const [rascunho, setRascunho] = useState("");
  const rascunhoRef = useRef("");
  const fecharRef = useRef<() => void>(() => {});

  function abrir(qual: "numero" | "referencia") {
    window.dispatchEvent(new Event("teclado-matriz"));
    const atual = qual === "numero" ? numero : referencia;
    rascunhoRef.current = atual;
    setRascunho(atual);
    setFoco(qual);
  }

  function digitar(tecla: string) {
    const proximo = teclaTexto(rascunhoRef.current, tecla);
    rascunhoRef.current = proximo;
    setRascunho(proximo);
    if (foco === "numero") onNumero(proximo);
    else onReferencia(proximo);
  }

  function fechar() {
    const texto = rascunhoRef.current;
    if (foco === "numero") onNumero(numeroLimpo(texto));
    if (foco === "referencia") onReferencia(referenciaLimpa(texto));
    setFoco(null);
  }
  fecharRef.current = fechar;
  useFecharTeclado(Boolean(foco), fechar, foco);

  useEffect(() => {
    if (!foco) return;
    const aoFechar = () => fecharRef.current();
    window.addEventListener("teclado-matriz", aoFechar);
    return () => window.removeEventListener("teclado-matriz", aoFechar);
  }, [foco]);

  if (!toque) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-muted">Numeração</span>
          <input
            value={numero}
            placeholder="Ex: 39/0"
            inputMode="text"
            autoComplete="off"
            onChange={(event) => onNumero(event.target.value.replace(/[^\d/]/g, "").replace(/\/{2,}/g, "/").slice(0, 16))}
            onBlur={() => onNumero(numeroLimpo(numero))}
            className="w-full rounded-tile border border-line bg-surface-2 px-3 py-3 text-base text-fg placeholder:text-[#9aa8b8]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-muted">Referência</span>
          <input
            value={referencia}
            placeholder="Ex: 1"
            maxLength={32}
            autoComplete="off"
            onChange={(event) => onReferencia(referenciaLimpa(event.target.value))}
            className="w-full rounded-tile border border-line bg-surface-2 px-3 py-3 text-base text-fg placeholder:text-[#9aa8b8]"
          />
        </label>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      <label data-bloco="" className="block">
        <span className="mb-1 block text-sm font-semibold text-muted">Numeração</span>
        <input
          readOnly
          data-campo-teclado=""
          data-foco={foco === "numero" ? "" : undefined}
          inputMode="none"
          value={foco === "numero" ? rascunho : numero}
          placeholder="Ex: 39/0"
          onClick={() => abrir("numero")}
          className={cx("w-full rounded-tile border bg-surface-2 px-3 py-3 text-base text-fg placeholder:text-[#9aa8b8]", foco === "numero" ? "border-accent" : "border-line")}
        />
      </label>
      <label data-bloco="" className="block">
        <span className="mb-1 block text-sm font-semibold text-muted">Referência</span>
        <input
          readOnly
          data-campo-teclado=""
          data-foco={foco === "referencia" ? "" : undefined}
          inputMode="none"
          value={foco === "referencia" ? rascunho : referencia}
          placeholder="Ex: 1"
          onClick={() => abrir("referencia")}
          className={cx(
            "w-full rounded-tile border bg-surface-2 px-3 py-3 text-base text-fg placeholder:text-[#9aa8b8]",
            foco === "referencia" ? "border-accent" : "border-line",
          )}
        />
      </label>
      {foco ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg px-3 py-3">
          <Teclado modo="matriz" onTecla={digitar} />
        </div>
      ) : null}
    </div>
  );
}
