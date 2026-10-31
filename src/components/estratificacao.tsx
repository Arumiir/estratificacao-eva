import { useEffect, useRef, useState, type ReactNode } from "react";
import { InstallPrompt } from "@/components/install-prompt";
import { UpdateNotice } from "@/components/update-notice";
import {
  ChevronLeft,
  ChevronDown,
  Download,
  ImageDown,
  Minus,
  Plus,
  X,
} from "lucide-react";
import {
  MACHINES,
  PROBLEMS,
  SIDE_LABEL,
  SIDE_SHORT,
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
  fichaLines,
  formatDateBR,
  inShift,
  loadState,
  machineHasFicha,
  machineHasMatrices,
  numeroLimpo,
  mergeOutros,
  mergeCores,
  mergeFechamentos,
  mergeProducao,
  outroVivo,
  mergeSharedEntries,
  pad2,
  parseMachine,
  podeAlterarApontamento,
  problemName,
  saveState,
  shiftEntries,
  stationKey,
  todayISO,
  turnoPeloRelogio,
  diaOperacional,
  TURNO_LABEL,
  type Turno,
  diasAte,
  gradeHasNumbers,
  type Entry,
  type Cor,
  type Fechamento,
  type ProducaoPares,
  type FichaLine,
  type MachineId,
  type OutroMatriz,
  type Side,
  type State,
  type StationConfig,
} from "@/lib/perdas";
import { downloadBlob, renderFichasDaMaquina, renderFichasPdf } from "@/lib/ficha-image";
import { enviarPlanilha, pullApontamentos, pullHistorico, pushApontamentos } from "@/lib/apontamentos.functions";

type Papel = "preparador" | "lider" | "teste";
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
    if (row.papel !== "preparador" && row.papel !== "lider" && row.papel !== "teste") return null;
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
  | { kind: "teste" }
  | { kind: "teste-maquina"; machine: MachineId };

type Banner = {
  id: number;
  text: string;
  undo?: () => void;
};

function cx(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

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

function usePerdas() {
  const [state, setState] = useState<State | null>(null);
  const [cloud, setCloud] = useState<boolean | null>(null);
  const ref = useRef<State | null>(null);

  useEffect(() => {
    const loaded = loadState();
    ref.current = loaded;
    setState(loaded);
  }, []);

  useEffect(() => {
    function snapToToday() {
      const today = todayISO();
      setState((current) => {
        if (!current || current.date === today) return current;
        const next = { ...current, date: today };
        ref.current = next;
        return next;
      });
    }
    function onVisible() {
      if (document.visibilityState === "visible") snapToToday();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", snapToToday);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", snapToToday);
    };
  }, []);

  useEffect(() => {
    if (state) saveState(state);
  }, [state]);

  const synced = useRef<Set<string> | null>(null);
  const lastEntries = useRef<State["entries"] | null>(null);
  const lastOutros = useRef("");
  const lastCores = useRef("");
  const lastFechamentos = useRef("");
  const lastProducao = useRef("");
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
  const skipExcelBacklog = useRef(true);

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
    const producao = (state.producao ?? []).filter((item) => item.date === state.date);
    const outrosMudou = JSON.stringify(outros) !== lastOutros.current;
    const coresMudou = JSON.stringify(cores) !== lastCores.current;
    const fechamentosMudou = JSON.stringify(fechamentos) !== lastFechamentos.current;
    const producaoMudou = JSON.stringify(producao) !== lastProducao.current;
    if (upserts.length === 0 && removed.length === 0 && Object.keys(grades).length === 0 && !outrosMudou && !coresMudou && !fechamentosMudou && !producaoMudou) {
      skipExcelBacklog.current = false;
      return;
    }
    if (skipExcelBacklog.current) skipExcelBacklog.current = false;
    else {
      for (const entry of upserts) enqueueExcel(entry, 1);
      for (const entry of removedNow) queueRemoval(entry);
    }
    if (!booted.current && removed.length === 0 && reviveIds.length === 0) return;
    const sentGrades = Object.keys(grades);
    const gen = gradesGen.current;
    const sentRevives = reviveIds;
    void pushApontamentos({ data: { upserts: booted.current ? upserts : [], removed, grades: booted.current ? grades : {}, date: state.date, outros: booted.current ? outros : [], cores: booted.current ? cores : [], fechamentos: booted.current ? fechamentos : [], producao: booted.current ? producao : [], revives: sentRevives } })
      .then((result) => {
        setCloud(result.cloud);
        if (booted.current) {
          for (const entry of upserts) known.add(entry.id);
          lastOutros.current = JSON.stringify(outros);
          lastCores.current = JSON.stringify(cores);
          lastFechamentos.current = JSON.stringify(fechamentos);
          lastProducao.current = JSON.stringify(producao);
        }
        for (const id of sentRevives) revives.current.delete(id);
        if (gradesGen.current !== gen) return;
        for (const key of sentGrades) dirtyGrades.current.delete(key);
      })
      .catch(() => setCloud(false));
  }, [state, ligado]);

  function takeRemote(
    current: State,
    remote: { entries: Entry[]; removed: string[]; grades?: Record<string, StationConfig>; outros?: OutroMatriz[]; cores?: Cor[]; fechamentos?: Fechamento[]; producao?: ProducaoPares[] },
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
    const sameEntries =
      entries.length === current.entries.length &&
      entries.every(
        (entry, index) =>
          entry.id === current.entries[index]?.id &&
          entry.matrizNumero === current.entries[index]?.matrizNumero &&
          entry.matrizRel === current.entries[index]?.matrizRel &&
          entry.corId === current.entries[index]?.corId &&
          entry.corNome === current.entries[index]?.corNome,
      );
    const outros = mergeOutros(current.outros, remote.outros ?? []);
    const cores = mergeCores(current.cores, remote.cores ?? []);
    const fechamentos = mergeFechamentos(current.fechamentos ?? [], remote.fechamentos ?? []);
    const producao = mergeProducao(current.producao ?? [], remote.producao ?? []);
    const outrosIguais = JSON.stringify(outros) === JSON.stringify(current.outros);
    const coresIguais = JSON.stringify(cores) === JSON.stringify(current.cores);
    const fechamentosIguais = JSON.stringify(fechamentos) === JSON.stringify(current.fechamentos);
    const producaoIgual = JSON.stringify(producao) === JSON.stringify(current.producao ?? []);
    if (!stationsChanged && sameEntries && outrosIguais && coresIguais && fechamentosIguais && producaoIgual) return current;
    return { ...current, stations, entries, outros, cores, fechamentos, producao };
  }

  async function refresh() {
    const current = ref.current;
    if (!current) return false;
    const gen = gradesGen.current;
    const remote = await pullApontamentos({ data: { date: current.date } });
    if (gradesGen.current !== gen) return true;
    setCloud(remote.cloud);
    if (!booted.current) {
      booted.current = true;
      setLigado(true);
    }
    const next = takeRemote(current, remote);
    if (next === current) return true;
    ref.current = next;
    lastEntries.current = next.entries;
    setState(next);
    return true;
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
        const producao = (current.producao ?? []).filter((item) => item.date === current.date);
        const outrosMudou = JSON.stringify(outros) !== lastOutros.current;
        const coresMudou = JSON.stringify(cores) !== lastCores.current;
        const fechamentosMudou = JSON.stringify(fechamentos) !== lastFechamentos.current;
        const producaoMudou = JSON.stringify(producao) !== lastProducao.current;
        if (booted.current && (upserts.length > 0 || removed.length > 0 || reviveIds.length > 0 || outrosMudou || coresMudou || fechamentosMudou || producaoMudou)) {
          void pushApontamentos({ data: { upserts, removed, revives: reviveIds, date: current.date, outros, cores, fechamentos, producao } })
            .then((result) => {
              setCloud(result.cloud);
              for (const entry of upserts) known.add(entry.id);
              for (const id of reviveIds) revives.current.delete(id);
              lastOutros.current = JSON.stringify(outros);
              lastCores.current = JSON.stringify(cores);
              lastFechamentos.current = JSON.stringify(fechamentos);
              lastProducao.current = JSON.stringify(producao);
            })
            .catch(() => setCloud(false));
        }
      }
      void refresh().catch(() => setCloud(false));
      void pumpExcel();
    }, 15000);
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
        const next = takeRemote(ref.current, remote);
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
    case "teste":
      return "teste";
    case "teste-maquina":
      return `teste-${screen.machine}`;
  }
}

function machineFrom(screen: Screen): MachineId | null {
  if (
    screen.kind === "papel" ||
    screen.kind === "turnos" ||
    screen.kind === "machines" ||
    screen.kind === "teste"
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
  const stackRef = useRef<Screen[]>([{ kind: "papel" }]);
  const homeRef = useRef<Screen>({ kind: "papel" });
  const depthRef = useRef(1);
  const skipPopRef = useRef(0);

  const screen = stack[stack.length - 1] ?? { kind: "turnos" as const };
  const key = screenKey(screen);

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
      const nextState = window.history.state;
      const depth =
        nextState && typeof nextState === "object" && typeof nextState.perdasDepth === "number"
          ? nextState.perdasDepth
          : 1;
      depthRef.current = depth;
      const next = stackRef.current.slice(0, Math.max(1, depth));
      stackRef.current = next.length > 0 ? next : [homeRef.current];
      setDir("back");
      setStack(stackRef.current);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const saved = loadSessao();
    const home: Screen =
      saved?.papel === "preparador"
        ? { kind: "machines" }
        : saved?.papel === "lider"
          ? { kind: "sheet", machine: null }
          : saved?.papel === "teste"
            ? { kind: "teste" }
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

  function back() {
    if (stackRef.current.length <= 1) return;
    window.history.back();
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
      skipPopRef.current = 1;
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
    const home: Screen =
      next.papel === "lider"
        ? { kind: "sheet", machine: null }
        : next.papel === "teste"
          ? { kind: "teste" }
          : { kind: "machines" };
    homeRef.current = home;
    stackRef.current = [home];
    depthRef.current = 1;
    setDir("forward");
    setStack([home]);
    window.history.replaceState(stampDepth(1), "");
  }

  function leavePapel() {
    saveSessao(null);
    setSessao(null);
    const home: Screen = { kind: "papel" };
    homeRef.current = home;
    stackRef.current = [home];
    depthRef.current = 1;
    setDir("back");
    setStack([home]);
    window.history.replaceState(stampDepth(1), "");
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
    if (entry.date !== todayISO()) return "Dia fechado.";
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

  const today = todayISO();
  const offDay = state.date !== today;

  function setDate(date: string) {
    if (!date) return;
    commit((current) => ({ ...current, date }));
  }

  function setTurno(turno: Turno) {
    commit((current) => ({ ...current, turno }));
  }

  function salvarProducao(machine: MachineId, turno: Turno, valores: Record<string, number>) {
    const salvoEm = Date.now();
    commit((current) => {
      const prefixo = `${current.date}|${turno}|${machine}|`;
      const restantes = (current.producao ?? []).filter((item) => !item.id.startsWith(prefixo));
      const gravados: ProducaoPares[] = Object.entries(valores).flatMap(([numero, pares]) => {
        const limpo = numeroLimpo(numero);
        if (!limpo) return [];
        return [
          {
            id: `${prefixo}${limpo}`,
            date: current.date,
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
    flash("Produção salva.");
  }

  async function baixarFicha(machine: MachineId) {
    const current = read();
    if (!current) return;
    try {
      const grupos = await renderFichasDaMaquina(current, machine);
      if (grupos.length === 0) {
        flash("Nenhuma ficha nesta máquina.");
        return;
      }
      const base = `perdas-${current.date}-turno-${current.turno}`;
      grupos.forEach((grupo, index) => {
        const sufixo = grupo.nome
          ? `-${grupo.nome.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "")}`
          : "";
        window.setTimeout(() => downloadBlob(`${base}-maquina-${machine}${sufixo}.png`, grupo.blob), index * 400);
      });
      flash(grupos.length === 1 ? "Imagem baixada." : `${grupos.length} imagens baixadas.`);
    } catch {
      flash("Não foi possível gerar a imagem.");
    }
  }

  function openMachine(machine: MachineId) {
    const current = read();
    if (!current) return;
    const turno = sessao?.turno ?? current.turno;
    if (sessao?.papel === "preparador" && !gradeConfirmada(turno, machine)) {
      push({ kind: "matrices", machine, diaria: true });
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
    flash("Grade de matrizaria salva");
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
    const cleanRef = referencia.trim();
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

  function addProblem(machine: MachineId, station: number, side: Side, problem: string, outroId = "", corId = "") {
    const current = read();
    if (!current) return;
    if (current.date !== todayISO()) {
      flash("Dia fechado.");
      return;
    }
    const at = Date.now();
    const turno = sessao?.papel === "preparador" ? (sessao.turno ?? "1") : turnoPeloRelogio(at);
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
        referencia: numeroLimpo(slot?.numero ?? "") ? (slot?.referencia.trim() ?? "") : "",
      };
      const entry: Entry = {
        id,
        date: todayISO(),
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
      return { ...stateNow, turno, date: todayISO(), entries: [...stateNow.entries, entry] };
    });
    navigator.vibrate?.(12);
    const where = `${problemName(problem)} · ${SIDE_LABEL[side].toLowerCase()}`;
    flash(
      turno === current.turno ? `Lançado: ${where}` : `Lançado no ${TURNO_LABEL[turno]}: ${where}`,
      () => removeEntry(id, "Lançamento desfeito"),
    );
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
    );
  }

  function removeMany(ids: string[], label: string) {
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
  const telaFixa = screen.kind === "hub" || screen.kind === "papel";

  return (
    <div className="relative flex h-dvh flex-col bg-bg text-fg">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="h-1 bg-accent" />
        <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 lg:max-w-none lg:px-5">
          {stack.length > 1 ? (
            <button
              type="button"
              onClick={back}
              aria-label="Voltar"
              className="grid size-11 shrink-0 place-items-center rounded-tile bg-accent-soft text-accent"
            >
              <ChevronLeft className="size-6" />
            </button>
          ) : null}
          <div className="min-w-0 flex-1">
            {screen.kind === "sheet" ? (
              <>
                <h1 className="font-display text-2xl leading-none tracking-wide text-accent lg:text-4xl">
                  {papel === "lider" ? "Dashboard geral" : papel === "teste" ? "Página de teste" : "Lançamentos"}
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
          {papel ? (
            <button
              type="button"
              onClick={leavePapel}
              className="shrink-0 rounded-tile bg-accent-soft px-3 py-2 text-sm font-semibold text-accent"
            >
              Sair
            </button>
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

      <div ref={scroller} className={cx("min-h-0 flex-1 overflow-x-hidden", telaFixa ? "overflow-hidden" : "overflow-y-auto")}>
        <div
          key={key}
          className={cx(
            "mx-auto w-full min-w-0",
            telaFixa ? "flex h-full items-center justify-center px-6" : "px-4 py-4",
            !telaFixa &&
              (screen.kind === "producao" || screen.kind === "teste-maquina" || screen.kind === "matrices" || screen.kind === "outros"
                ? "pb-4"
                : "pb-28"),
            screen.kind === "sheet" ? "max-w-6xl lg:max-w-none lg:px-5 lg:py-3" : "max-w-6xl lg:px-8",
            dir === "forward" ? "enter-forward" : "enter-back",
          )}
        >
          {screen.kind === "papel" ? (
            <PortaScreen
              onPick={chooseSessao}
              onTeste={() => chooseSessao({ papel: "teste", turno: null })}
            />
          ) : null}

          {papel === "preparador" && screen.kind === "machines" ? (
            <MachinesScreen state={state} onOpen={openMachine} />
          ) : null}

          {papel === "preparador" && screen.kind === "hub" ? (
            <HubMaquina
              machine={screen.machine}
              onProducao={() => push({ kind: "producao", machine: screen.machine })}
              onPerdas={() => push({ kind: "stations", machine: screen.machine })}
            />
          ) : null}

          {(papel === "preparador" && screen.kind === "producao") ||
          (papel === "teste" && screen.kind === "teste-maquina") ? (
            <ProducaoScreen
              state={state}
              machine={screen.machine}
              turno={sessao?.turno ?? state.turno}
              onSave={(valores) => salvarProducao(screen.machine, sessao?.turno ?? state.turno, valores)}
            />
          ) : null}

          {papel === "teste" && screen.kind === "teste" ? (
            <TesteMaquinas onOpen={(machine) => push({ kind: "teste-maquina", machine })} />
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
              onOpen={(station) => push({ kind: "side", machine: screen.machine, station })}
              onOpenOutro={(outro) =>
                outro.ambos
                  ? push({
                      kind: "side",
                      machine: screen.machine,
                      station: outro.station,
                      outroId: outro.id,
                    })
                  : push({
                      kind: "problems",
                      machine: screen.machine,
                      station: outro.station,
                      side: outro.side,
                      outroId: outro.id,
                    })
              }
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
              autor=""
              onAdd={(problem) =>
                addProblem(screen.machine, screen.station, screen.side, problem, screen.outroId ?? "")
              }
              onRemove={(problem, quantidade) =>
                removeCount(screen.machine, screen.station, screen.side, problem, screen.outroId ?? "", quantidade)
              }
              outroId={screen.outroId ?? ""}
            />
          ) : null}

          {papel && screen.kind === "sheet" ? (
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
            />
          ) : null}
        </div>
      </div>
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
    case "teste":
      return { context: "Página de teste" };
    case "teste-maquina":
      return { context: `Teste · ${screen.machine}` };
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

function PortaScreen({
  onPick,
  onTeste,
}: {
  onPick: (sessao: Sessao) => void;
  onTeste: () => void;
}) {
  const segurando = useRef<number | null>(null);
  const segurou = useRef(false);

  function soltar() {
    if (segurando.current !== null) {
      window.clearTimeout(segurando.current);
      segurando.current = null;
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col justify-center gap-3">
      {(["1", "2", "3"] as const).map((turno) => (
        <button
          key={turno}
          type="button"
          onClick={() => onPick({ papel: "preparador", turno })}
          className="rounded-tile bg-accent py-5 font-display text-4xl leading-none text-accent-ink"
        >
          {TURNO_LABEL[turno]}
        </button>
      ))}
      <button
        type="button"
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={() => {
          segurou.current = false;
          soltar();
          segurando.current = window.setTimeout(() => {
            segurando.current = null;
            segurou.current = true;
            onTeste();
          }, 600);
        }}
        onPointerUp={soltar}
        onPointerCancel={soltar}
        onClick={() => {
          if (segurou.current) {
            segurou.current = false;
            return;
          }
          onPick({ papel: "lider", turno: null });
        }}
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

function gradeConfirmada(turno: Turno, machine: MachineId) {
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
  onProducao,
  onPerdas,
}: {
  machine: MachineId;
  onProducao: () => void;
  onPerdas: () => void;
}) {
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
          onClick={onPerdas}
          className="rounded-3xl bg-accent py-7 text-center font-display text-4xl leading-none text-accent-ink"
        >
          Perdas
        </button>
      </div>
    </div>
  );
}

function IconeEditar() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 20h4.2L19 9.2a2.1 2.1 0 0 0-3-3L5.2 17V20z" strokeLinejoin="round" />
      <path d="M13.8 7.4l2.8 2.8" strokeLinecap="round" />
    </svg>
  );
}

function IconeTroca() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 7h11l-3.2-3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 17H6l3.2 3.2" strokeLinecap="round" strokeLinejoin="round" />
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

function TesteMaquinas({ onOpen }: { onOpen: (machine: MachineId) => void }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-accent">Página de teste</p>
      <h2 className="font-display text-3xl leading-none">Qual máquina?</h2>
      <div className="mx-auto mt-3 grid w-full max-w-md grid-cols-2 gap-3 md:grid-cols-3">
        {MACHINES.map((machine) => (
          <button
            key={machine}
            type="button"
            onClick={() => onOpen(machine)}
            className="flex min-h-32 flex-col rounded-tile border border-line bg-surface p-4 text-left"
          >
            <span className="text-sm font-semibold text-muted">Máquina</span>
            <span className="mt-1 font-display text-4xl leading-none">{machine}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function percentualPerda(perdas: number, producao: number) {
  const base = perdas + producao;
  if (base <= 0) return null;
  return (perdas / base) * 100;
}

function textoPercentual(valor: number | null) {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
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
        (item) => item.date === state.date && item.turno === turno && item.machine === machine && item.pares > 0,
      ),
  );

  useEffect(() => {
    if (sujo) return;
    const proximo: Record<string, string> = {};
    for (const item of state.producao ?? []) {
      if (item.date !== state.date || item.turno !== turno || item.machine !== machine || item.pares <= 0) continue;
      proximo[item.numero] = String(item.pares);
    }
    setValores(proximo);
    setEditando(Object.keys(proximo).length === 0);
  }, [state.date, state.producao, turno, machine, assinatura, sujo]);

  const producao = numeros.reduce((soma, item) => soma + (Number(valores[item.id]) || 0), 0);
  const perdas = paresDasEntradas(
    state.entries.filter((entry) => entry.date === state.date && entry.turno === turno && entry.machine === machine),
  );

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
            <label key={item.id} className="flex flex-col items-center rounded-3xl bg-white p-4 text-center shadow-[0_8px_24px_rgba(47,84,150,0.08)]">
              <span className="font-display text-4xl leading-none">{item.numero}</span>
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
            </label>
          ))}
        </div>
      )}
      <div className="sticky bottom-0 mt-auto bg-bg/95 py-3 backdrop-blur">
        {editando ? (
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

function TurnoPicker({ value, onChange }: { value: Turno; onChange: (turno: Turno) => void }) {
  return (
    <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-1">
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

function DayControls({
  state,
  today,
  offDay,
  onDate,
}: {
  state: State;
  today: string;
  offDay: boolean;
  onDate: (date: string) => void;
}) {
  return (
    <div className="mx-auto mb-4 w-full max-w-md">
      <div className="mb-3 flex gap-2">
        <input
          type="date"
          value={state.date}
          onChange={(event) => onDate(event.target.value)}
          aria-label="Data"
          className="min-w-0 flex-1 rounded-tile border border-line bg-surface-2 px-3 py-3 text-base font-semibold text-fg"
        />
        {offDay ? (
          <button
            type="button"
            onClick={() => onDate(today)}
            className="rounded-tile bg-accent px-4 font-semibold text-accent-ink"
          >
            Hoje
          </button>
        ) : null}
      </div>
    </div>
  );
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
        {MACHINES.map((machine) => {
          const count = shiftEntries(state, machine).length;
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
  autor,
  onAdd,
  onRemove,
  outroId = "",
  corId = "",
}: {
  state: State;
  machine: MachineId;
  station: number;
  side: Side;
  offDay: boolean;
  autor: string;
  onAdd: (problem: string) => void;
  onRemove: (problem: string, quantidade: number) => void;
  outroId?: string;
  corId?: string;
}) {
  const [tirar, setTirar] = useState<Record<string, number>>({});
  const outro = state.outros.find((item) => item.id === outroId);
  const cor = state.cores.find((item) => item.id === corId);
  const config = cor?.grades[String(station)] ?? state.stations[stationKey(machine, station)];
  const primeira = coresDaMaquina(state, machine)[0];
  const matrix = outro
    ? [outro.numero, outro.referencia].filter(Boolean).join(" · ")
    : describeMatrix(config, side);
  const mine = autor.trim().toLocaleLowerCase("pt-BR");
  const rows = shiftEntries(state, machine).filter((entry) => {
    if (outroId) {
      if (entry.outroId !== outroId || entry.side !== side) return false;
    } else if (entry.outroId || entry.station !== station || entry.side !== side) {
      return false;
    } else if (corId && entry.corId !== corId && (entry.corId !== "" || corId !== primeira?.id)) {
      return false;
    }
    if (!mine) return true;
    const who = entry.autor.trim().toLocaleLowerCase("pt-BR");
    return who === mine || who === "";
  });

  return (
    <div>
      <ContextLine state={state} offDay={offDay} />
      {offDay ? (
        <p className="mt-2 text-sm font-semibold text-accent">Dia fechado.</p>
      ) : null}
      {matrix ? <p className="mt-2 text-base font-semibold">{matrix}</p> : null}
      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {PROBLEMS.map((problem) => {
          const count = rows.filter((entry) => entry.problem === problem.id).length;
          const pendente = Math.min(tirar[problem.id] ?? 0, count);
          return (
            <div key={problem.id} className="rounded-tile border border-line bg-surface p-2">
              <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={count === 0 || pendente >= count}
                aria-label={`Marcar exclusão de ${problem.name}`}
                onClick={() =>
                  setTirar((atual) => ({
                    ...atual,
                    [problem.id]: Math.min(count, (atual[problem.id] ?? 0) + 1),
                  }))
                }
                className="grid size-14 shrink-0 place-items-center rounded-tile bg-surface-2 touch-manipulation disabled:opacity-30"
              >
                <Minus className="size-6" />
              </button>
              <div className="min-w-0 flex-1 px-1 text-center">
                <p className="text-sm font-semibold leading-snug">{problem.name}</p>
                <p
                  className={cx(
                    "mt-1 font-display text-4xl leading-none tabular-nums",
                    count > 0 ? "text-accent" : "text-muted",
                  )}
                >
                  {count}
                </p>
              </div>
              <button
                type="button"
                disabled={offDay}
                aria-label={`Lançar ${problem.name}`}
                onClick={() => onAdd(problem.id)}
                className="grid size-14 shrink-0 place-items-center rounded-tile bg-accent text-accent-ink touch-manipulation disabled:opacity-30"
              >
                <Plus className="size-7" />
              </button>
              </div>
              {pendente > 0 ? (
                <div className="mt-2 flex items-center gap-2 rounded-tile bg-surface-2 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    Excluir {pendente} {pendente === 1 ? "sola" : "solas"}?
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setTirar((atual) => {
                        const next = { ...atual };
                        delete next[problem.id];
                        return next;
                      })
                    }
                    className="shrink-0 rounded-tile px-3 py-2 text-sm font-semibold text-muted"
                  >
                    Não
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const n = pendente;
                      setTirar((atual) => {
                        const next = { ...atual };
                        delete next[problem.id];
                        return next;
                      });
                      onRemove(problem.id, n);
                    }}
                    className="shrink-0 rounded-tile bg-[#9b3a34] px-3 py-2 text-sm font-semibold text-white"
                  >
                    Excluir
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
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

  function patch(index: number, next: StationConfig) {
    setDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
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
          onClick={() => onSave(drafts)}
          className="w-full rounded-2xl bg-accent py-4 font-display text-3xl leading-none text-accent-ink"
        >
          Salvar grade
        </button>
      </div>
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
  return (
    <div className="grid grid-cols-2 gap-2">
      <Field label="Numeração" value={numero} placeholder="39/0" onChange={onNumero} />
      <Field label="Referência" value={referencia} placeholder="01" onChange={onReferencia} />
    </div>
  );
}

function SheetScreen({
  state,
  today,
  offDay,
  onDate,
  onTurno,
  papel,
  onDelete,
  onNotice,
}: {
  state: State;
  today: string;
  offDay: boolean;
  onDate: (date: string) => void;
  onTurno: (turno: Turno) => void;
  papel: Papel;
  onDelete?: (entries: Entry[]) => void;
  onNotice: (text: string) => void;
}) {
  const [busy, setBusy] = useState<"foto" | "pdf" | null>(null);
  const [abaLider, setAbaLider] = useState<"geral" | "diario">("geral");
  const [rotuloPeriodo, setRotuloPeriodo] = useState("Mês");
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

  async function downloadPdf() {
    if (shown.length === 0) {
      onNotice("Nenhuma ficha neste turno.");
      return;
    }
    setBusy("pdf");
    try {
      const pdf = await renderFichasPdf(view, shown);
      downloadBlob(`${fileBase}.pdf`, pdf);
      onNotice(shown.length === 1 ? "PDF baixado." : "PDF baixado. Uma máquina por folha.");
    } catch {
      onNotice("Não foi possível gerar o PDF.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {papel === "lider" ? (
        <>
          <div className="mb-4 flex flex-wrap justify-center gap-2">
            {(
              [
                { id: "geral" as const, label: rotuloPeriodo },
                { id: "diario" as const, label: "Acompanhamento diário" },
              ]
            ).map((aba) => (
              <button
                key={aba.id}
                type="button"
                onClick={() => setAbaLider(aba.id)}
                className={cx(
                  "rounded-full px-4 py-2 text-sm font-semibold",
                  abaLider === aba.id ? "bg-[#2457b8] text-white" : "bg-white text-fg shadow-[0_6px_16px_rgba(47,84,150,0.06)]",
                )}
              >
                {aba.label}
              </button>
            ))}
          </div>
          {abaLider === "geral" ? (
            <PainelHistorico state={state} today={today} onDate={onDate} onPeriodo={setRotuloPeriodo} />
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
              onPdf={() => void downloadPdf()}
              onDelete={onDelete}
            />
          )}
        </>
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

function PainelHistorico({
  state,
  today,
  onDate,
  onPeriodo,
}: {
  state: State;
  today: string;
  onDate: (date: string) => void;
  onPeriodo?: (rotulo: string) => void;
}) {
  const [remoto, setRemoto] = useState<Entry[] | null>(null);
  const [producaoRemota, setProducaoRemota] = useState<ProducaoPares[]>([]);
  const [erro, setErro] = useState(false);
  const [janela, setJanela] = useState<"dia" | "semana" | "mes">("mes");
  const [maquina, setMaquina] = useState<MachineId | null>(null);
  const [estacao, setEstacao] = useState<number | null>(null);
  const [numero, setNumero] = useState<string | null>(null);
  const [referencia, setReferencia] = useState<string | null>(null);
  const [lado, setLado] = useState<Side | null>(null);
  const [turnoFiltro, setTurnoFiltro] = useState<Turno | null>(null);
  const [problema, setProblema] = useState<string | null>(null);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const datas = diasAte(state.date, 31);
  const semana = new Set(diasAte(state.date, 7));
  const mes = new Set(datas);

  useEffect(() => {
    let ativo = true;
    setRemoto(null);
    setProducaoRemota([]);
    setErro(false);
    pullHistorico({ data: { ate: state.date, dias: 31 } })
      .then((resultado) => {
        if (ativo) {
          setRemoto(resultado.entries);
          setProducaoRemota(resultado.producao ?? []);
        }
      })
      .catch(() => {
        if (ativo) setErro(true);
      });
    return () => {
      ativo = false;
    };
  }, [state.date]);

  const base = juntarHistorico(remoto ?? [], state.entries, mes);
  const diasJanela = janela === "dia" ? [state.date] : janela === "semana" ? diasAte(state.date, 7) : datas;
  const recorteLista = base.filter((entry) => {
    if (!diasJanela.includes(entry.date)) return false;
    if (maquina && entry.machine !== maquina) return false;
    if (estacao !== null && entry.station !== estacao) return false;
    return true;
  });
  const numerosJanela = [...new Set(recorteLista.map((entry) => numeroLimpo(entry.matrizNumero)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "pt-BR", { numeric: true }),
  );
  const referenciasJanela = [...new Set(recorteLista.map((entry) => entry.matrizRel.trim() || "sem ref."))].sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
  const numeroAtivo = numero && numerosJanela.includes(numero) ? numero : null;
  const refAtiva = referencia && referenciasJanela.includes(referencia) ? referencia : null;
  function passaRecorte(entry: Entry) {
    if (maquina && entry.machine !== maquina) return false;
    if (estacao !== null && entry.station !== estacao) return false;
    if (numeroAtivo !== null && numeroLimpo(entry.matrizNumero) !== numeroAtivo) return false;
    if (refAtiva !== null && (entry.matrizRel.trim() || "sem ref.") !== refAtiva) return false;
    if (lado && entry.side !== lado) return false;
    if (turnoFiltro && entry.turno !== turnoFiltro) return false;
    if (problema && entry.problem !== problema) return false;
    return true;
  }
  const periodo = base.filter((entry) => diasJanela.includes(entry.date) && passaRecorte(entry));
  const doDia = base.filter((entry) => entry.date === state.date && passaRecorte(entry));
  const daSemana = base.filter((entry) => semana.has(entry.date) && passaRecorte(entry));
  const doMes = base.filter((entry) => passaRecorte(entry));
  const turnos = (["1", "2", "3"] as const).map((turno) => {
    const lista = periodo.filter((entry) => entry.turno === turno);
    return { turno, lista, solas: lista.length, pares: paresDasEntradas(lista) };
  });
  const porProblema = PROBLEMS.map((problem) => ({
    name: problem.name,
    id: problem.id,
    total: paresDasEntradas(periodo.filter((entry) => entry.problem === problem.id)),
  }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
  const porMaquina = MACHINES.map((machine) => ({
    machine,
    total: paresDasEntradas(periodo.filter((entry) => entry.machine === machine)),
  }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total);
  const tituloJanela = janela === "dia" ? "24 horas" : janela === "semana" ? "Semana" : "Mês";
  const rankingNumeros = rankNumeros(periodo, 8);
  const rankingEstacao = STATIONS.map((station) => ({
    id: String(station),
    nome: `Estação ${pad2(station)}`,
    valor: paresDasEntradas(periodo.filter((entry) => entry.station === station)),
    ativo: estacao === null ? undefined : estacao === station,
  }))
    .filter((item) => item.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  const producaoBase = mergeProducao(producaoRemota, state.producao ?? []);
  function passaProducao(item: ProducaoPares, datasAlvo: string[]) {
    if (item.pares <= 0 || !datasAlvo.includes(item.date)) return false;
    if (maquina && item.machine !== maquina) return false;
    if (turnoFiltro && item.turno !== turnoFiltro) return false;
    if (numeroAtivo && item.numero !== numeroAtivo) return false;
    return true;
  }
  function totalProducao(datasAlvo: string[]) {
    return producaoBase.reduce((soma, item) => (passaProducao(item, datasAlvo) ? soma + item.pares : soma), 0);
  }
  const producaoPeriodo = totalProducao(diasJanela);
  const perdasPeriodo = paresDasEntradas(periodo);
  const producaoMaquinas = MACHINES.map((machine) => ({
    machine,
    valor: producaoBase.reduce(
      (soma, item) => (passaProducao(item, diasJanela) && item.machine === machine ? soma + item.pares : soma),
      0,
    ),
  })).filter((item) => item.valor > 0);

  const problemaNome = PROBLEMS.find((item) => item.id === problema)?.name ?? null;
  const filtrosAtivos = [
    janela !== "mes",
    state.date !== today,
    maquina !== null,
    estacao !== null,
    numeroAtivo !== null,
    refAtiva !== null,
    lado !== null,
    turnoFiltro !== null,
    problema !== null,
  ].filter(Boolean).length;
  const resumoFiltro = [
    maquina,
    estacao !== null ? `Est. ${pad2(estacao)}` : null,
    numeroAtivo ? `Nº ${numeroAtivo}` : null,
    refAtiva ? `Ref. ${refAtiva}` : null,
    lado ? SIDE_LABEL[lado] : null,
    turnoFiltro ? TURNO_LABEL[turnoFiltro] : null,
    problemaNome,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" · ");

  useEffect(() => {
    onPeriodo?.(tituloJanela);
  }, [tituloJanela, onPeriodo]);

  function limparFiltros() {
    setJanela("mes");
    setMaquina(null);
    setEstacao(null);
    setNumero(null);
    setReferencia(null);
    setLado(null);
    setTurnoFiltro(null);
    setProblema(null);
    if (state.date !== today) onDate(today);
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-end justify-center gap-3 text-center">
        <div className="min-w-0">
          <h2 className="font-display text-3xl leading-none text-fg lg:text-4xl">{tituloJanela}</h2>
          <p className="mt-2 text-sm text-muted">
            {erro ? "Sem nuvem." : remoto === null ? "" : resumoFiltro}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={limparFiltros}
            className="rounded-2xl bg-[#4682B4] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(70,130,180,0.25)]"
          >
            Limpar filtro
          </button>
          <button
            type="button"
            onClick={() => setFiltrosAbertos(true)}
            aria-label="Abrir filtros"
            className="relative grid size-12 place-items-center rounded-2xl bg-white text-[#4682B4] shadow-[0_8px_24px_rgba(47,84,150,0.08)]"
          >
          <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
            <path
              d="M4 5h16l-6.2 7.1V19l-3.6 1.4v-8.3L4 5z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
          {filtrosAtivos > 0 ? (
            <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-[#2457b8] text-[11px] font-semibold text-white">
              {filtrosAtivos}
            </span>
          ) : null}
          </button>
        </div>
      </div>

      <section className="grid grid-cols-3 gap-2 rounded-3xl bg-white p-4 text-center shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
        <div>
          <p className="text-xs font-semibold text-muted">Produção</p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums lg:text-4xl">{producaoPeriodo}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted">Perdas</p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums lg:text-4xl">{perdasPeriodo}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted">% perda</p>
          <p className="mt-1 font-display text-3xl leading-none tabular-nums lg:text-4xl">
            {textoPercentual(percentualPerda(perdasPeriodo, producaoPeriodo))}
          </p>
        </div>
      </section>

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
              <div>
                <p className="text-xs font-semibold text-muted">Período</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(
                    [
                      ["mes", "Mês"],
                      ["semana", "Semana"],
                      ["dia", "24 horas"],
                    ] as const
                  ).map(([id, label]) => (
                    <OpcaoFiltro key={id} ativo={janela === id} onClick={() => setJanela(id)}>
                      {label}
                    </OpcaoFiltro>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={state.date}
                    aria-label="Até"
                    onChange={(event) => onDate(event.target.value)}
                    className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold"
                  />
                  {state.date !== today ? (
                    <button type="button" onClick={() => onDate(today)} className="text-sm font-semibold text-[#2457b8]">
                      Hoje
                    </button>
                  ) : null}
                </div>
              </div>
              <GrupoFiltro titulo="Máquina">
                <OpcaoFiltro ativo={maquina === null} onClick={() => setMaquina(null)}>
                  Todas
                </OpcaoFiltro>
                {MACHINES.map((machine) => (
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
              <GrupoFiltro titulo="Turno">
                <OpcaoFiltro ativo={turnoFiltro === null} onClick={() => setTurnoFiltro(null)}>
                  Todos
                </OpcaoFiltro>
                {(["1", "2", "3"] as const).map((turno) => (
                  <OpcaoFiltro
                    key={turno}
                    ativo={turnoFiltro === turno}
                    onClick={() => setTurnoFiltro((atual) => (atual === turno ? null : turno))}
                  >
                    {TURNO_LABEL[turno]}
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
            <div className="grid grid-cols-2 gap-2 border-t border-[#f3f2f1] px-4 py-3">
              <button type="button" onClick={limparFiltros} className="rounded-2xl bg-[#f3f6fb] py-3 text-sm font-semibold">
                Limpar
              </button>
              <button
                type="button"
                onClick={() => setFiltrosAbertos(false)}
                className="rounded-2xl bg-[#2457b8] py-3 text-sm font-semibold text-white"
              >
                Ver resultado
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <RankingBarras
        vertical
        titulo="Produção"
        itens={producaoMaquinas.map((item) => ({
          id: item.machine,
          nome: item.machine,
          valor: item.valor,
          ativo: maquina === null ? undefined : maquina === item.machine,
        }))}
        onPick={(id) => setMaquina((atual) => (atual === id ? null : (id as MachineId)))}
      />

      <RankingBarras
        vertical
        titulo="Pares"
        itens={[
          { id: "dia", nome: "24 horas", valor: paresDasEntradas(doDia) },
          { id: "semana", nome: "Semana", valor: paresDasEntradas(daSemana) },
          { id: "mes", nome: "Mês", valor: paresDasEntradas(doMes) },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-2">
        <GraficoCircular
          titulo="Piores máquinas"
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
          itens={[...turnos]
            .sort((a, b) => b.pares - a.pares || a.turno.localeCompare(b.turno))
            .filter((item) => item.pares > 0)
            .map((item) => ({
              id: item.turno,
              nome: TURNO_LABEL[item.turno],
              valor: item.pares,
              ativo: turnoFiltro === null ? undefined : turnoFiltro === item.turno,
            }))}
          onPick={(id) => setTurnoFiltro((atual) => (atual === id ? null : (id as Turno)))}
        />
      </div>
      <RankingBarras
        vertical
        titulo="Piores problemas"
        itens={porProblema.map((item) => ({
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
      {maquina ? (
        <RankingBarras
          vertical
          titulo="Piores estações"
          itens={rankingEstacao}
          onPick={(id) => {
            const station = Number(id);
            setEstacao((atual) => (atual === station ? null : station));
          }}
        />
      ) : null}
    </div>
  );
}

const CORES_FATIA = ["#e23b3b", "#f08a24", "#e2b423", "#2f9e6b", "#2aa0c7", "#3b6fe0", "#7a4fd4", "#d4538a", "#6b7280", "#8b5a2b", "#1f7a4d"];

function GraficoCircular({
  titulo,
  itens,
  onPick,
}: {
  titulo: string;
  itens: { id: string; nome: string; valor: number; ativo?: boolean }[];
  onPick?: (id: string) => void;
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
      {fatias.length === 0 || !frente ? (
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
}: {
  titulo: string;
  itens: { id: string; nome: string; valor: number; extra?: string; ativo?: boolean }[];
  onPick?: (id: string) => void;
  vertical?: boolean;
}) {
  const maximo = Math.max(1, ...itens.map((item) => item.valor));
  const total = itens.reduce((soma, item) => soma + item.valor, 0);
  return (
    <section className="min-w-0 max-w-full rounded-3xl bg-white p-4 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
      <h3 className="text-base font-semibold">{titulo}</h3>
      {itens.length === 0 || total === 0 ? (
        <p className="mt-3 text-sm text-muted">Sem apontamento neste recorte.</p>
      ) : vertical ? (
        <div className="mt-4 flex w-full min-w-0 max-w-full items-start gap-2 overflow-x-auto pb-1">
          {itens.map((item, index) => {
            const altura = item.valor <= 0 ? 0 : Math.max(8, Math.round((item.valor / maximo) * 100));
            const corpo = (
              <>
                <span className="font-display text-2xl leading-none tabular-nums">{item.valor}</span>
                <span className="mt-1 text-[10px] font-semibold text-muted">{item.valor === 1 ? "par" : "pares"}</span>
                <span className="mt-2 flex h-40 w-full items-end border-b-2 border-[#d5dee8]">
                  <span
                    className="block w-full rounded-t-2xl"
                    style={{
                      height: `${altura}%`,
                      background: CORES_FATIA[index % CORES_FATIA.length],
                      opacity: item.ativo === false ? 0.35 : 1,
                    }}
                  />
                </span>
                <span className="mt-2 w-full break-words whitespace-pre-line text-center text-[11px] font-semibold leading-tight">
                  <span style={{ color: CORES_FATIA[index % CORES_FATIA.length] }}>{index + 1} </span>
                  {item.nome}
                </span>
                {item.extra ? <span className="mt-1 text-center text-[10px] text-muted">{item.extra}</span> : null}
              </>
            );
            const classe = "flex min-w-[5.5rem] flex-1 basis-[5.5rem] flex-col items-center";
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
      ) : (
        <ol className="mt-3 grid gap-3">
          {itens.map((item, index) => {
            const largura = item.valor <= 0 ? 0 : Math.max(8, Math.round((item.valor / maximo) * 100));
            const percentual = total > 0 ? Math.round((item.valor / total) * 100) : 0;
            const corpo = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-semibold leading-snug">
                    <span className="mr-2 font-display text-xl leading-none" style={{ color: CORES_FATIA[index % CORES_FATIA.length] }}>
                      {index + 1}
                    </span>
                    {item.nome}
                  </p>
                  <p className="shrink-0 text-right text-xs font-semibold tabular-nums">
                    {item.valor} {item.valor === 1 ? "par" : "pares"}
                    <span className="block text-muted">{percentual}%</span>
                  </p>
                </div>
                <span className="mt-1.5 block h-2.5 overflow-hidden rounded-full bg-[#e7eef5]">
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

function rankNumeros(entries: Entry[], limite = 12) {
  const grupos = new Map<string, { machine: string; numero: string; referencia: string; stations: Map<number, number>; itens: Entry[] }>();
  for (const entry of entries) {
    const numero = numeroLimpo(entry.matrizNumero);
    if (!numero) continue;
    const referencia = entry.matrizRel.trim();
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
            <button
              type="button"
              disabled={busy !== null || shown.length === 0}
              onClick={onPdf}
              className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-[0_6px_16px_rgba(47,84,150,0.08)] disabled:opacity-50"
            >
              {busy === "pdf" ? "Gerando PDF…" : "Baixar PDF"}
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
          <label className="mt-3 block text-xs font-semibold text-muted">
            Data
            <input
              type="date"
              value={state.date}
              onChange={(event) => onDate(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-[#f7f9fc] px-3 py-2 text-sm font-semibold text-fg"
            />
          </label>
          {offDay ? (
            <button
              type="button"
              onClick={() => onDate(today)}
              className="mt-2 w-full rounded-full bg-[#2457b8] py-2 text-sm font-semibold text-white"
            >
              Voltar para hoje
            </button>
          ) : null}
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

function AcompanhamentoDiario({
  state,
  today,
  offDay,
  onDate,
  onTurno,
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
  shown: MachineId[];
  busy: "foto" | "pdf" | null;
  onPhoto: () => void;
  onPdf: () => void;
  onDelete?: (entries: Entry[]) => void;
}) {
  const [painel, setPainel] = useState<{ machine: MachineId; tipo: "apontamentos" | "matrizaria" } | null>(null);
  const [pedir, setPedir] = useState(false);
  const visiveis = MACHINES.filter((machine) => {
    if (shown.includes(machine)) return true;
    return (state.producao ?? []).some(
      (item) => item.date === state.date && item.turno === state.turno && item.machine === machine && item.pares > 0,
    );
  });
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
      <DayControls state={state} today={today} offDay={offDay} onDate={onDate} />
      <TurnoPicker value={state.turno} onChange={onTurno} />
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
              .filter((item) => item.date === state.date && item.turno === state.turno && item.machine === machine)
              .reduce((soma, item) => soma + item.pares, 0);
            const piores = topProblems(linhasCard);
            return (
              <article key={machine} className="flex min-w-0 flex-col rounded-3xl bg-white p-3 shadow-[0_10px_30px_rgba(47,84,150,0.08)]">
                <h3 className="text-center font-display text-3xl leading-none">{machine}</h3>
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
                    Matrizaria
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
                  {painel.tipo === "matrizaria" ? "Matrizaria" : "Apontamentos"}
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
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy !== null || shown.length === 0}
          onClick={onPhoto}
          className="flex items-center justify-center gap-2 rounded-tile bg-surface-2 py-3 font-semibold disabled:opacity-60"
        >
          <ImageDown className="size-5" />
          {busy === "foto" ? "Gerando…" : "Baixar imagens"}
        </button>
        <button
          type="button"
          disabled={busy !== null || shown.length === 0}
          onClick={onPdf}
          className="flex items-center justify-center gap-2 rounded-tile bg-surface-2 py-3 font-semibold disabled:opacity-60"
        >
          <Download className="size-5" />
          {busy === "pdf" ? "Gerando…" : "Baixar PDF"}
        </button>
      </div>
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
  const referencia = line.referencia.trim();
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
            Uma sola no lado fecha 1 par. Esquerda e direita não se somam.
            {mine.length > editable.length ? " Turno fechado não sai." : ""}
          </p>
          <ApontamentosLista lines={lines} />
        </>
      ) : null}
    </section>
  );
}

function pares(solas: number): number {
  if (solas <= 0) return 0;
  return Math.ceil(solas / 2);
}

function paresDasEntradas(entries: Entry[]): number {
  const grupos = new Map<string, number>();
  for (const entry of entries) {
    const chave = `${entry.date}|${entry.turno}|${entry.machine}|${entry.station}|${entry.side}|${entry.problem}|${entry.outroId}`;
    grupos.set(chave, (grupos.get(chave) ?? 0) + 1);
  }
  let total = 0;
  for (const solas of grupos.values()) total += pares(solas);
  return total;
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
                      {item.pares} {item.pares === 1 ? "par" : "pares"}
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
              <span className="absolute left-1/2 top-1/2 w-max max-h-52 -translate-x-1/2 -translate-y-1/2 -rotate-90 text-[11px] font-semibold">
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


