import { useEffect, useRef, useState } from "react";
import { InstallPrompt } from "@/components/install-prompt";
import {
  ChevronLeft,
  ChevronDown,
  ClipboardList,
  Download,
  Eye,
  EyeOff,
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
  apontamentoBloqueado,
  describeMatrix,
  emptyConfig,
  fichaLines,
  formatDateBR,
  GRID_MACHINES,
  gridTargets,
  inShift,
  loadState,
  machineHasFicha,
  machineHasMatrices,
  mergeOutros,
  mergeSharedEntries,
  nomesNaFicha,
  pad2,
  podeAlterarApontamento,
  problemName,
  saveState,
  shiftEntries,
  stationKey,
  todayISO,
  turnoPeloRelogio,
  TURNO_LABEL,
  withMatrix,
  diasAte,
  gradeHasNumbers,
  type Entry,
  type FichaLine,
  type GridMachine,
  type MachineId,
  type OutroMatriz,
  type Side,
  type State,
  type StationConfig,
  type Turno,
} from "@/lib/perdas";
import { downloadBlob, renderFichaPng, renderFichasPdf } from "@/lib/ficha-image";
import { enviarPlanilha, pullApontamentos, pullHistorico, pushApontamentos } from "@/lib/apontamentos.functions";
import { entrar } from "@/lib/login.functions";

type Papel = "preparador" | "lider";
type Sessao = { papel: Papel; nome: string };

const SESSAO_KEY = "estratificacao-sessao-v2";

function loadSessao(): Sessao | null {
  try {
    const raw = localStorage.getItem(SESSAO_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    const row = data as { papel?: unknown; nome?: unknown };
    if (row.papel !== "preparador" && row.papel !== "lider") return null;
    if (typeof row.nome !== "string" || row.nome.trim().length < 2) return null;
    if (row.nome.trim() === "0000") return null;
    return { papel: row.papel, nome: row.nome.trim() };
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
  | { kind: "sie05" }
  | { kind: "ask"; machine: MachineId }
  | { kind: "matrices"; machine: MachineId }
  | { kind: "stations"; machine: MachineId }
  | { kind: "outros"; machine: MachineId }
  | { kind: "side"; machine: MachineId; station: number; outroId?: string }
  | { kind: "problems"; machine: MachineId; station: number; side: Side; outroId?: string }
  | { kind: "sheet"; machine: MachineId | null };

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
  const held = useRef<Set<string>>(new Set());
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
      podeAlterarApontamento(entry) ? withMatrix(entry, state.stations) : entry,
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
    const upserts = state.entries.filter((entry) => !known.has(entry.id));
    const removed = (previous ?? []).filter((entry) => !state.entries.some((item) => item.id === entry.id));
    for (const entry of removed) held.current.add(entry.id);
    const grades: Record<string, StationConfig> = {};
    for (const key of dirtyGrades.current) {
      const config = state.stations[key];
      if (config && gradeHasNumbers(config)) grades[key] = config;
    }
    const outros = state.outros.filter((item) => item.date === state.date);
    const outrosMudou = JSON.stringify(outros) !== lastOutros.current;
    if (upserts.length === 0 && removed.length === 0 && Object.keys(grades).length === 0 && !outrosMudou) {
      skipExcelBacklog.current = false;
      return;
    }
    if (skipExcelBacklog.current) skipExcelBacklog.current = false;
    else {
      for (const entry of upserts) enqueueExcel(entry, 1);
      for (const entry of removed) queueRemoval(entry);
    }
    const sentGrades = Object.keys(grades);
    const gen = gradesGen.current;
    void pushApontamentos({ data: { upserts, removed, grades, date: state.date, outros } })
      .then((result) => {
        setCloud(result.cloud);
        for (const entry of upserts) known.add(entry.id);
        for (const item of removed) known.delete(item.id);
        lastOutros.current = JSON.stringify(outros);
        if (gradesGen.current !== gen) return;
        for (const key of sentGrades) dirtyGrades.current.delete(key);
      })
      .catch(() => {});
  }, [state]);

  function takeRemote(
    current: State,
    remote: { entries: Entry[]; removed: string[]; grades?: Record<string, StationConfig>; outros?: OutroMatriz[] },
  ) {
    for (const id of remote.removed) held.current.delete(id);
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
      podeAlterarApontamento(entry) ? withMatrix(entry, stations) : entry,
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
          entry.matrizRel === current.entries[index]?.matrizRel,
      );
    const outros = mergeOutros(current.outros, remote.outros ?? []);
    const outrosIguais = JSON.stringify(outros) === JSON.stringify(current.outros);
    if (!stationsChanged && sameEntries && outrosIguais) return current;
    return { ...current, stations, entries, outros };
  }

  async function refresh() {
    const current = ref.current;
    if (!current) return false;
    const gen = gradesGen.current;
    const remote = await pullApontamentos({ data: { date: current.date } });
    if (gradesGen.current !== gen) return true;
    setCloud(remote.cloud);
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
        const upserts = current.entries.filter((entry) => !known.has(entry.id));
        const outros = current.outros.filter((item) => item.date === current.date);
        const outrosMudou = JSON.stringify(outros) !== lastOutros.current;
        if (upserts.length > 0 || outrosMudou) {
          void pushApontamentos({ data: { upserts, removed: [], date: current.date, outros } })
            .then((result) => {
              setCloud(result.cloud);
              for (const entry of upserts) known.add(entry.id);
              lastOutros.current = JSON.stringify(outros);
            })
            .catch(() => {});
        }
      }
      void refresh().catch(() => {});
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
        const next = takeRemote(ref.current, remote);
        if (next === ref.current) return;
        ref.current = next;
        lastEntries.current = next.entries;
        setState(next);
      })
      .catch(() => {});
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
    for (const id of ids) held.current.delete(id);
  }

  return { state, commit, read: () => ref.current, refresh, cloud, resendExcel, releaseHold, markGrades };
}

function screenKey(screen: Screen): string {
  switch (screen.kind) {
    case "papel":
      return "papel";
    case "turnos":
      return "turnos";
    case "machines":
      return "machines";
    case "sie05":
      return "sie05";
    case "ask":
      return `ask-${screen.machine}`;
    case "matrices":
      return `matrices-${screen.machine}`;
    case "stations":
      return `stations-${screen.machine}`;
    case "outros":
      return `outros-${screen.machine}`;
    case "side":
      return `side-${screen.machine}-${screen.station}-${screen.outroId ?? ""}`;
    case "problems":
      return `problems-${screen.machine}-${screen.outroId || screen.station}-${screen.side}`;
    case "sheet":
      return `sheet-${screen.machine ?? "all"}`;
  }
}

function machineFrom(screen: Screen): MachineId | null {
  if (
    screen.kind === "papel" ||
    screen.kind === "turnos" ||
    screen.kind === "machines" ||
    screen.kind === "sie05"
  ) {
    return null;
  }
  return screen.machine;
}

export function EstratificacaoApp() {
  const { state, commit, read, cloud, releaseHold, markGrades } = usePerdas();
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [sessaoReady, setSessaoReady] = useState(false);
  const [stack, setStack] = useState<Screen[]>([{ kind: "papel" }]);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [banner, setBanner] = useState<Banner | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
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
      saved?.papel === "lider" || saved?.papel === "preparador"
        ? { kind: "turnos" }
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
    scroller.current?.scrollTo(0, 0);
    setMenuAberto(false);
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
    const home: Screen = { kind: "turnos" };
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
    if (apontamentoBloqueado(entry)) return "1º turno até 14:49 está bloqueado.";
    if (entry.date !== todayISO()) return "Dia fechado. Só o dia de hoje pode ser alterado.";
    return "Fora do horário. Esse turno não pode ser alterado agora.";
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
    commit((s) => ({ ...s, entries: s.entries.filter((item) => item.id !== id) }));
    flash(label, () => restore(entry));
  }

  if (!state || !sessaoReady) return <Loading />;

  const papel = sessao?.papel ?? null;
  const nome = sessao?.nome ?? "";

  const today = todayISO();
  const offDay = state.date !== today;

  function setDate(date: string) {
    if (!date) return;
    commit((current) => ({ ...current, date }));
  }

  function setTurno(turno: Turno) {
    commit((current) => ({ ...current, turno }));
  }

  function openGrid(machine: GridMachine) {
    if (machine === "SIE05") {
      push({ kind: "sie05" });
      return;
    }
    openMachine(machine);
  }

  function openMachine(machine: MachineId) {
    const current = read();
    if (!current) return;
    if (machineHasMatrices(current, machine)) push({ kind: "stations", machine });
    else push({ kind: "ask", machine });
  }

  function saveGrade(machine: MachineId, configs: StationConfig[]) {
    const salvoEm = Date.now();
    markGrades(STATIONS.map((station) => stationKey(machine, station)));
    commit((current) => {
      const stations = { ...current.stations };
      STATIONS.forEach((station, index) => {
        const config = configs[index];
        if (config) stations[stationKey(machine, station)] = { ...config, salvoEm };
      });
      return { ...current, stations };
    });
    flash("Grade de matrizaria salva");
    const sie05 = machine === "SIE05A" || machine === "SIE05B";
    adoptStack(
      sie05
        ? [{ kind: "turnos" }, { kind: "machines" }, { kind: "sie05" }, { kind: "stations", machine }]
        : [{ kind: "turnos" }, { kind: "machines" }, { kind: "stations", machine }],
    );
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
      flash("Dia fechado. Só o dia de hoje pode ser alterado.");
      return;
    }
    const item: OutroMatriz = {
      id: crypto.randomUUID(),
      date: todayISO(),
      turno: turnoPeloRelogio(),
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

  function addProblem(machine: MachineId, station: number, side: Side, problem: string, outroId = "") {
    const current = read();
    if (!current) return;
    if (current.date !== todayISO()) {
      flash("Dia fechado. Só o dia de hoje pode ser alterado.");
      return;
    }
    const id = crypto.randomUUID();
    const at = Date.now();
    const turno = turnoPeloRelogio(at);
    let snapshot = { numero: "", referencia: "" };
    commit((stateNow) => {
      const outro = outroId ? stateNow.outros.find((item) => item.id === outroId) : undefined;
      const slot = outro
        ? { numero: outro.numero, referencia: outro.referencia }
        : activeMatrix(stateNow.stations[stationKey(machine, station)], side);
      snapshot = {
        numero: slot?.numero.trim() ?? "",
        referencia: slot?.referencia.trim() ?? "",
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
        autor: nome,
        outroId,
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

  function sameAuthor(entry: Entry) {
    if (papel !== "preparador") return true;
    const mine = nome.trim().toLocaleLowerCase("pt-BR");
    const autor = entry.autor.trim().toLocaleLowerCase("pt-BR");
    return autor === mine || autor === "";
  }

  function removeLast(machine: MachineId, station: number, side: Side, problem: string, outroId = "") {
    const current = read();
    if (!current) return;
    const pool = current.entries.filter(
      (entry) =>
        inShift(entry, current) &&
        entry.machine === machine &&
        entry.problem === problem &&
        sameAuthor(entry) &&
        (outroId ? entry.outroId === outroId : !entry.outroId && entry.station === station && entry.side === side),
    );
    const match = [...pool].reverse().find((entry) => podeAlterarApontamento(entry));
    if (!match) {
      const fechado = [...pool].reverse().find((entry) => !podeAlterarApontamento(entry));
      if (fechado) flash(avisoFechado(fechado));
      return;
    }
    removeEntry(match.id, "Um lançamento tirado");
  }

  function removeMany(ids: string[], label: string) {
    const current = read();
    if (!current || ids.length === 0) return;
    const gone = current.entries.filter((entry) => ids.includes(entry.id) && podeAlterarApontamento(entry));
    if (gone.length === 0) {
      const fechado = current.entries.find((entry) => ids.includes(entry.id));
      flash(fechado ? avisoFechado(fechado) : "Dia fechado. Só o dia de hoje pode ser alterado.");
      return;
    }
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
                <h1 className="font-display text-4xl leading-none tracking-wide text-accent">
                  {papel === "lider" ? "Acompanhamentos" : "Lançamentos"}
                </h1>
                {papel === "lider" ? (
                  <p className="mt-1 text-sm font-semibold tracking-wide text-accent">Área do Líder Técnico</p>
                ) : null}
              </>
            ) : (
              <>
                <h1 className="font-display text-3xl leading-none tracking-wide text-accent">
                  Estratificação
                </h1>
                <p className="font-display text-xl leading-none text-fg">das perdas - EVA</p>
                {papel === "lider" ? (
                  <p className="mt-1 text-sm font-semibold tracking-wide text-accent">Área do Líder Técnico</p>
                ) : null}
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
          {papel === "preparador" && nome ? (
            <div className="flex shrink-0 items-center gap-2">
              {screen.kind !== "sheet" ? (
                <button
                  type="button"
                  onClick={() => push({ kind: "sheet", machine: null })}
                  aria-label="Lançamentos"
                  className="grid size-11 place-items-center rounded-tile bg-accent text-accent-ink"
                >
                  <ClipboardList className="size-6" />
                </button>
              ) : null}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuAberto((open) => !open)}
                  aria-label={`Menu de ${nome}`}
                  aria-expanded={menuAberto}
                  className="grid size-11 place-items-center rounded-full bg-accent font-display text-2xl leading-none text-accent-ink"
                >
                  {nome.trim().charAt(0).toLocaleUpperCase("pt-BR")}
                </button>
                {menuAberto ? (
                  <button
                    type="button"
                    onClick={leavePapel}
                    className="absolute right-0 top-full z-40 mt-2 rounded-tile border border-line bg-surface px-4 py-3 text-sm font-semibold text-accent shadow-lg"
                  >
                    Sair
                  </button>
                ) : null}
              </div>
            </div>
          ) : papel ? (
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

      <div ref={scroller} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div
          key={key}
          className={cx(
            "mx-auto w-full px-4 py-4 pb-28",
            screen.kind === "sheet" ? "max-w-6xl lg:max-w-none lg:px-5 lg:py-3" : "max-w-6xl lg:px-8",
            dir === "forward" ? "enter-forward" : "enter-back",
          )}
        >
          {screen.kind === "papel" ? (
            <PapelScreen onPick={chooseSessao} onFail={(text) => flash(text)} />
          ) : null}

          {papel && screen.kind === "turnos" ? (
            <TurnosScreen
              hint={
                papel === "lider"
                  ? "Escolha o turno para acompanhar."
                  : "Escolha o turno antes de lançar as perdas."
              }
              onPick={(turno) => {
                setTurno(turno);
                push(papel === "lider" ? { kind: "sheet", machine: null } : { kind: "machines" });
              }}
            />
          ) : null}

          {papel === "preparador" && screen.kind === "machines" ? (
            <MachinesScreen
              state={state}
              today={today}
              offDay={offDay}
              onDate={setDate}
              onOpen={openGrid}
            />
          ) : null}

          {papel === "preparador" && screen.kind === "sie05" ? (
            <Sie05Screen state={state} onPick={openMachine} />
          ) : null}

          {papel === "preparador" && screen.kind === "ask" ? (
            <AskScreen
              machine={screen.machine}
              onEdit={() => push({ kind: "matrices", machine: screen.machine })}
              onSkip={() => replaceTop({ kind: "stations", machine: screen.machine })}
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
              onOpen={(station) => push({ kind: "side", machine: screen.machine, station })}
              onMatrices={() => push({ kind: "matrices", machine: screen.machine })}
              onOutros={() => push({ kind: "outros", machine: screen.machine })}
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
              autor={papel === "preparador" ? nome : ""}
              onAdd={(problem) =>
                addProblem(screen.machine, screen.station, screen.side, problem, screen.outroId ?? "")
              }
              onRemove={(problem) =>
                removeLast(screen.machine, screen.station, screen.side, problem, screen.outroId ?? "")
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
              papel={papel}
              nome={nome}
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
            Estratificação
          </h1>
          <p className="font-display text-xl leading-none text-fg">das perdas - EVA</p>
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
    case "sie05":
      return { context: "Máquina SIE05" };
    case "ask":
      return { context: `Máquina ${screen.machine}` };
    case "matrices":
      return { context: `Máquina ${screen.machine} · matrizes` };
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
    case "papel":
      return { context: "Quem está usando" };
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

function PapelScreen({
  onPick,
  onFail,
}: {
  onPick: (sessao: Sessao) => void;
  onFail: (text: string) => void;
}) {
  const [nome, setNome] = useState("");
  const [senha, setSenha] = useState("");
  const [mostraSenha, setMostraSenha] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  async function submit() {
    if (nome.trim().length < 2 || senha.length < 4) {
      setErro("Digite o nome e a senha.");
      return;
    }
    setBusy(true);
    setErro("");
    try {
      const result = await entrar({ data: { nome, senha } });
      if (!result.ok) {
        setErro("Nome ou senha errados.");
        return;
      }
      onPick({ papel: result.papel, nome: result.nome });
    } catch {
      onFail("Sem rede para entrar. Tente de novo.");
      setErro("Sem rede para entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="mx-auto w-full max-w-md rounded-tile border border-line bg-surface p-5 lg:mt-10 lg:p-8"
    >
      <p className="text-base text-muted">Entre com o seu nome e a sua senha.</p>
      <label className="mt-4 block">
        <span className="mb-1 block text-sm font-semibold text-muted">Nome</span>
        <input
          value={nome}
          autoComplete="username"
          onChange={(event) => setNome(event.target.value)}
          className="w-full rounded-tile border border-line bg-surface-2 px-3 py-3 text-base text-fg"
        />
      </label>
      <label className="mt-3 block">
        <span className="mb-1 block text-sm font-semibold text-muted">Senha</span>
        <span className="relative block">
          <input
            type={mostraSenha ? "text" : "password"}
            value={senha}
            autoComplete="current-password"
            onChange={(event) => setSenha(event.target.value)}
            className="w-full rounded-tile border border-line bg-surface-2 px-3 py-3 pr-12 text-base text-fg"
          />
          <button
            type="button"
            onClick={() => setMostraSenha((value) => !value)}
            aria-label={mostraSenha ? "Ocultar senha" : "Mostrar senha"}
            className="absolute inset-y-0 right-0 grid w-12 place-items-center text-muted"
          >
            {mostraSenha ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </span>
      </label>
      {erro ? <p className="mt-2 text-sm font-semibold text-accent">{erro}</p> : null}
      <button
        type="submit"
        disabled={busy}
        className="mt-4 w-full rounded-tile bg-accent py-4 font-display text-3xl leading-none text-accent-ink disabled:opacity-60"
      >
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

function TurnosScreen({
  hint,
  onPick,
}: {
  hint: string;
  onPick: (turno: Turno) => void;
}) {
  return (
    <div>
      <p className="text-base text-muted">{hint}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {( ["1", "2", "3"] as const).map((turno) => (
          <button
            key={turno}
            type="button"
            onClick={() => onPick(turno)}
            className="min-h-28 rounded-tile border border-line bg-surface px-5 py-4 text-left"
          >
            <span className="font-display text-5xl leading-none">{TURNO_LABEL[turno]}</span>
          </button>
        ))}
      </div>
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
    <div className="mb-4">
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
  today,
  offDay,
  onDate,
  onOpen,
}: {
  state: State;
  today: string;
  offDay: boolean;
  onDate: (date: string) => void;
  onOpen: (machine: GridMachine) => void;
}) {
  return (
    <div>
      <p className="mb-3 font-display text-4xl leading-none text-accent">
        {TURNO_LABEL[state.turno]}
      </p>
      <p className="mb-3 text-sm font-semibold text-muted">
        Aberto agora: {TURNO_LABEL[turnoPeloRelogio()]}. 1º 06:00–14:49, 2º até 23:59, 3º até 05:59.
      </p>
      <DayControls state={state} today={today} offDay={offDay} onDate={onDate} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {GRID_MACHINES.map((machine) => {
          const count = gridTargets(machine).reduce(
            (sum, id) => sum + shiftEntries(state, id).length,
            0,
          );
          return (
            <button
              key={machine}
              type="button"
              onClick={() => onOpen(machine)}
              className="flex min-h-32 flex-col rounded-tile border border-line bg-surface p-4 text-left"
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

function Sie05Screen({
  state,
  onPick,
}: {
  state: State;
  onPick: (machine: "SIE05A" | "SIE05B") => void;
}) {
  const models = [
    { id: "SIE05A", letter: "A" },
    { id: "SIE05B", letter: "B" },
  ] as const;
  return (
    <div>
      <p className="text-base text-muted">Dois modelos nesta máquina. Escolha A ou B.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {models.map((model) => {
          const count = shiftEntries(state, model.id).length;
          return (
            <button
              key={model.id}
              type="button"
              onClick={() => onPick(model.id)}
              className="flex min-h-28 items-center justify-between rounded-tile border border-line bg-surface px-5 py-4 text-left"
            >
              <span>
                <span className="block font-display text-6xl leading-none">{model.letter}</span>
                <span className="mt-1 block text-base font-semibold text-muted">{model.id}</span>
              </span>
              <span
                className={cx(
                  "font-display text-2xl leading-none",
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

function StationsScreen({
  state,
  machine,
  offDay,
  onOpen,
  onMatrices,
  onOutros,
  onOpenOutro,
}: {
  state: State;
  machine: MachineId;
  offDay: boolean;
  onOpen: (station: number) => void;
  onMatrices: () => void;
  onOutros: () => void;
  onOpenOutro: (outro: OutroMatriz) => void;
}) {
  const outros = state.outros.filter(
    (item) => item.machine === machine && item.date === state.date && item.turno === state.turno,
  );
  return (
    <div>
      <ContextLine state={state} offDay={offDay} />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={onMatrices}
          className="rounded-tile border border-line bg-surface px-4 py-3 text-left text-base font-semibold text-accent"
        >
          Editar matrizes
        </button>
        <button
          type="button"
          onClick={onOutros}
          className="rounded-tile border border-line bg-surface px-4 py-3 text-left text-base font-semibold text-accent"
        >
          Troca de matriz
        </button>
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
              className="flex min-h-32 flex-col rounded-tile border border-line bg-surface p-3 text-left"
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
                <button
                  key={outro.id}
                  type="button"
                  onClick={() => onOpenOutro(outro)}
                  className="flex min-h-32 flex-col rounded-tile border border-accent bg-surface p-3 text-left"
                >
                  <span className="text-sm font-semibold text-accent">Troca</span>
                  <span className="mt-1 font-display text-3xl leading-none">{lugar}</span>
                  <span className="mt-1 text-base font-semibold leading-snug">
                    {outro.numero || "sem nº"}
                    {outro.referencia ? ` · ${outro.referencia}` : ""}
                  </span>
                  <span className="text-sm text-muted">{lado}</span>
                  <span className={cx("mt-auto pt-3 font-display text-xl leading-none", count > 0 ? "text-accent" : "text-muted")}>
                    {count > 0 ? `${count} perdas` : "sem perda"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function OutrosScreen({
  machine,
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
    <div>
      <p className="text-base text-muted">
        Troca no meio do turno da Máquina {machine}. A matriz que já está na estação continua. As perdas novas entram só nesta.
      </p>
      {offDay ? <p className="mt-2 text-sm font-semibold text-accent">Dia fechado. Só o dia de hoje pode ser alterado.</p> : null}
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
      <button
        type="button"
        disabled={offDay}
        onClick={() => onSave(station, ambos, side, numero, referencia)}
        className="mt-4 w-full rounded-tile bg-accent py-4 font-display text-3xl leading-none text-accent-ink disabled:opacity-50"
      >
        Adicionar troca
      </button>
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
}: {
  state: State;
  machine: MachineId;
  station: number;
  offDay: boolean;
  onChoose: (side: Side) => void;
  outroId?: string;
}) {
  const outro = state.outros.find((item) => item.id === outroId);
  const config = state.stations[stationKey(machine, station)];
  const rows = shiftEntries(state, machine).filter((entry) =>
    outroId ? entry.outroId === outroId : !entry.outroId && entry.station === station,
  );
  const troca = outro ? [outro.numero, outro.referencia].filter(Boolean).join(" · ") : "";
  return (
    <div>
      <ContextLine state={state} offDay={offDay} />
      {outro ? <p className="mt-3 text-sm text-muted">A numeração vale para os dois lados. Escolha onde apontar a perda.</p> : null}
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
}: {
  state: State;
  machine: MachineId;
  station: number;
  side: Side;
  offDay: boolean;
  autor: string;
  onAdd: (problem: string) => void;
  onRemove: (problem: string) => void;
  outroId?: string;
}) {
  const [ask, setAsk] = useState<string | null>(null);
  const outro = state.outros.find((item) => item.id === outroId);
  const config = state.stations[stationKey(machine, station)];
  const matrix = outro
    ? [outro.numero, outro.referencia].filter(Boolean).join(" · ")
    : describeMatrix(config, side);
  const mine = autor.trim().toLocaleLowerCase("pt-BR");
  const rows = shiftEntries(state, machine).filter((entry) => {
    if (outroId) {
      if (entry.outroId !== outroId || entry.side !== side) return false;
    } else if (entry.outroId || entry.station !== station || entry.side !== side) {
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
        <p className="mt-2 text-sm font-semibold text-accent">Dia fechado. Só o dia de hoje pode ser alterado.</p>
      ) : state.turno !== turnoPeloRelogio() ? (
        <p className="mt-2 text-sm font-semibold text-accent">
          Neste horário o lançamento entra no {TURNO_LABEL[turnoPeloRelogio()]}.
        </p>
      ) : null}
      {matrix ? <p className="mt-2 text-base font-semibold">{matrix}</p> : null}
      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {PROBLEMS.map((problem) => {
          const count = rows.filter((entry) => entry.problem === problem.id).length;
          return (
            <div key={problem.id} className="rounded-tile border border-line bg-surface p-2">
              <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={count === 0}
                aria-label={`Tirar um lançamento de ${problem.name}`}
                onClick={() => setAsk(problem.id)}
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
              {ask === problem.id ? (
                <div className="mt-2 flex items-center gap-2 rounded-tile bg-surface-2 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold">Tirar 1 de {problem.name}?</span>
                  <button
                    type="button"
                    onClick={() => setAsk(null)}
                    className="shrink-0 rounded-tile px-3 py-2 text-sm font-semibold text-muted"
                  >
                    Não
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAsk(null);
                      onRemove(problem.id);
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
}: {
  machine: MachineId;
  onEdit: () => void;
  onSkip: () => void;
}) {
  return (
    <div>
      <p className="text-base text-muted">A grade de matrizaria da Máquina {machine} está vazia.</p>
      <h2 className="mt-2 font-display text-4xl leading-none">Editar a grade de matrizaria?</h2>
      <button
        type="button"
        onClick={onEdit}
        className="mt-6 w-full rounded-tile bg-accent py-4 font-display text-3xl leading-none text-accent-ink"
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
  onSave,
}: {
  state: State;
  machine: MachineId;
  onSave: (configs: StationConfig[]) => void;
}) {
  const [drafts, setDrafts] = useState<StationConfig[]>(() =>
    STATIONS.map((station) => state.stations[stationKey(machine, station)] ?? emptyConfig()),
  );

  function patch(index: number, next: StationConfig) {
    setDrafts((current) => current.map((item, itemIndex) => (itemIndex === index ? next : item)));
  }

  return (
    <div>
      <p className="text-base text-muted">
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
      <button
        type="button"
        onClick={() => onSave(drafts)}
        className="mt-4 w-full rounded-tile bg-accent py-4 font-display text-3xl leading-none text-accent-ink"
      >
        Salvar grade
      </button>
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
  papel,
  nome,
  onDelete,
  onNotice,
}: {
  state: State;
  today: string;
  offDay: boolean;
  onDate: (date: string) => void;
  papel: Papel;
  nome: string;
  onDelete?: (entries: Entry[]) => void;
  onNotice: (text: string) => void;
}) {
  const [busy, setBusy] = useState<"foto" | "pdf" | null>(null);
  const [fotoPick, setFotoPick] = useState(false);
  const [aba, setAba] = useState<"turno" | "historico">("turno");
  const view: State =
    papel === "preparador"
      ? { ...state, entries: state.entries.filter((entry) => entry.autor === nome) }
      : state;
  const shown = MACHINES.filter((machine) => shiftEntries(view, machine).length > 0);
  const fileBase = `perdas-${state.date}-turno-${state.turno}`;

  async function sendPhoto(machine?: MachineId) {
    const machines = machine ? shown.filter((item) => item === machine) : shown;
    if (machines.length === 0) {
      onNotice("Nenhuma ficha neste turno.");
      return;
    }
    setFotoPick(false);
    setBusy("foto");
    try {
      const files: File[] = [];
      for (const item of machines) {
        const blob = await renderFichaPng(view, item);
        files.push(
          new File([blob], `${fileBase}-maquina-${item}.png`, { type: "image/png" }),
        );
      }
      if (navigator.canShare?.({ files })) {
        try {
          await navigator.share({
            files,
            title: "Estratificação das perdas - EVA",
            text: `${formatDateBR(state.date)} · ${TURNO_LABEL[state.turno]}${nome ? ` · ${nome}` : ""}`,
          });
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      if (files.length === 1) {
        const file = files[0];
        if (file) downloadBlob(file.name, file);
        onNotice("Foto baixada. Envie ao gestor.");
        return;
      }
      const pdf = await renderFichasPdf(view, machines);
      downloadBlob(`${fileBase}.pdf`, pdf);
      onNotice("O celular não abriu o compartilhamento. O PDF foi baixado.");
    } catch {
      onNotice("Não foi possível gerar a foto.");
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
      onNotice("PDF baixado. Uma máquina por folha.");
    } catch {
      onNotice("Não foi possível gerar o PDF.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="lg:hidden">
      {papel === "lider" ? (
        <p className="mb-3 text-sm text-muted">Só as máquinas apontadas neste turno. As matrizes ficam no botão de cada uma.</p>
      ) : (
        <p className="mb-3 text-sm text-muted">
          Cada toque seu vai para a planilha, uma sola por vez. A foto e o PDF saem com o seu nome.
        </p>
      )}
      <DayControls state={state} today={today} offDay={offDay} onDate={onDate} />

      {papel === "lider" ? <MatrizariaConsulta state={view} ocultar={shown} /> : null}

      <div className="mt-4">
        {shown.length === 0 ? (
          <p className="rounded-tile border border-dashed border-line bg-surface px-4 py-6 text-base text-muted">
            {papel === "preparador"
              ? "Você ainda não apontou máquina neste turno."
              : "Nenhuma máquina apontada neste turno."}
          </p>
        ) : (
          shown.map((machine) => (
            <FichaSheet
              key={machine}
              state={view}
              machine={machine}
              force={false}
              onDelete={onDelete ? (entries) => onDelete(entries) : undefined}
            />
          ))
        )}
      </div>

      {papel === "lider" && fotoPick ? (
        <div className="mt-4 rounded-tile border border-line bg-surface p-3">
          <p className="text-sm font-semibold">Qual máquina vai na foto?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {shown.map((machine) => (
              <button
                key={machine}
                type="button"
                disabled={busy !== null}
                onClick={() => void sendPhoto(machine)}
                className="rounded-tile bg-accent-soft py-3 font-semibold text-accent disabled:opacity-60"
              >
                {machine}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy !== null || shown.length === 0}
          onClick={() => {
            if (papel === "lider" && shown.length > 1) {
              setFotoPick((open) => !open);
              return;
            }
            void sendPhoto(papel === "lider" ? shown[0] : undefined);
          }}
          className="flex items-center justify-center gap-2 rounded-tile bg-surface-2 py-3 font-semibold disabled:opacity-60"
        >
          <ImageDown className="size-5" />
          {busy === "foto" ? "Gerando…" : "Enviar foto"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void downloadPdf()}
          className="flex items-center justify-center gap-2 rounded-tile bg-surface-2 py-3 font-semibold disabled:opacity-60"
        >
          <Download className="size-5" />
          {busy === "pdf" ? "Gerando…" : "Baixar PDF"}
        </button>
      </div>
      </div>
      <div className="hidden lg:block">
        <div className="mb-3 flex gap-1 border-b border-[#c8c6c4]">
          {(
            [
              ["turno", "Turno"],
              ["historico", "Histórico"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAba(id)}
              className={cx(
                "px-4 py-2 text-sm font-semibold",
                aba === id ? "border-b-2 border-accent text-accent" : "text-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {aba === "turno" ? (
          <PainelMesa
            state={view}
            today={today}
            offDay={offDay}
            onDate={onDate}
            papel={papel}
            shown={shown}
            busy={busy}
            onPhoto={(machine) => void sendPhoto(machine)}
            onPdf={() => void downloadPdf()}
            onDelete={onDelete}
          />
        ) : (
          <PainelHistorico state={state} today={today} onDate={onDate} />
        )}
      </div>
    </>
  );
}

function PainelHistorico({
  state,
  today,
  onDate,
}: {
  state: State;
  today: string;
  onDate: (date: string) => void;
}) {
  const [remoto, setRemoto] = useState<Entry[] | null>(null);
  const [erro, setErro] = useState(false);
  const [turno, setTurno] = useState<Turno | "todos">("todos");
  const datas = diasAte(state.date, 31);
  const semana = new Set(diasAte(state.date, 7));
  const mes = new Set(datas);

  useEffect(() => {
    let ativo = true;
    setRemoto(null);
    setErro(false);
    pullHistorico({ data: { ate: state.date, dias: 31 } })
      .then((resultado) => {
        if (ativo) setRemoto(resultado.entries);
      })
      .catch(() => {
        if (ativo) setErro(true);
      });
    return () => {
      ativo = false;
    };
  }, [state.date]);

  const entradas = juntarHistorico(remoto ?? [], state.entries, mes).filter(
    (entry) => turno === "todos" || entry.turno === turno,
  );
  const doDia = entradas.filter((entry) => entry.date === state.date);
  const daSemana = entradas.filter((entry) => semana.has(entry.date));
  const porDia = new Map<string, number>();
  for (const dia of datas) porDia.set(dia, 0);
  for (const entry of entradas) porDia.set(entry.date, (porDia.get(entry.date) ?? 0) + 1);
  const maxDia = Math.max(1, ...porDia.values());
  const porMaquina = MACHINES.map((machine) => ({
    machine,
    solas: entradas.filter((entry) => entry.machine === machine).length,
  }))
    .filter((item) => item.solas > 0)
    .sort((a, b) => b.solas - a.solas);
  const maxMaquina = Math.max(1, ...porMaquina.map((item) => item.solas));
  const porProblema = PROBLEMS.map((problem) => ({
    name: problem.name,
    solas: entradas.filter((entry) => entry.problem === problem.id).length,
  }))
    .filter((item) => item.solas > 0)
    .sort((a, b) => b.solas - a.solas);
  const maxProblema = Math.max(1, ...porProblema.map((item) => item.solas));
  const total = entradas.length;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#c8c6c4] pb-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
            Dados já salvos · até {formatDateBR(state.date)}
          </p>
          <h2 className="font-display text-4xl leading-none text-fg">Histórico</h2>
          <p className="mt-1 text-sm text-muted">
            {erro
              ? "Não leu a nuvem. Mostrando o que este computador já tem."
              : remoto === null
                ? "Lendo os últimos 31 dias…"
                : `${total} solas no recorte · ${turno === "todos" ? "todos os turnos" : TURNO_LABEL[turno]}`}
          </p>
        </div>
        <label className="text-xs font-semibold text-muted">
          Até
          <input
            type="date"
            value={state.date}
            onChange={(event) => onDate(event.target.value)}
            className="mt-1 block rounded border border-[#c8c6c4] bg-white px-2 py-2 text-sm font-semibold text-fg"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1">
        {(
          [
            ["todos", "Todos os turnos"],
            ["1", "1º TURNO"],
            ["2", "2º TURNO"],
            ["3", "3º TURNO"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTurno(id)}
            className={cx(
              "rounded px-3 py-1.5 text-sm font-semibold",
              turno === id ? "bg-accent text-accent-ink" : "bg-white text-fg",
            )}
          >
            {label}
          </button>
        ))}
        {state.date !== today ? (
          <button type="button" onClick={() => onDate(today)} className="rounded px-3 py-1.5 text-sm font-semibold text-accent">
            Hoje
          </button>
        ) : null}
      </div>

      <section className="rounded-md border border-[#e1dfdd] bg-white p-3 shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
        <h3 className="text-sm font-semibold">Solas por dia</h3>
        <p className="text-xs text-muted">31 dias até {formatDateBR(state.date)}. O dia marcado é o recorte do ranking diário.</p>
        <div className="mt-3 flex h-44 items-end gap-1">
          {datas.map((dia) => {
            const valor = porDia.get(dia) ?? 0;
            const rotulo = dia.slice(8);
            return (
              <div key={dia} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div className="flex h-36 items-end">
                  <div
                    title={`${formatDateBR(dia)} · ${valor} solas`}
                    className={cx("w-full rounded-sm", dia === state.date ? "bg-accent" : "bg-[#8fb0cb]")}
                    style={{ height: `${Math.max(valor > 0 ? 8 : 2, (valor / maxDia) * 100)}%` }}
                  />
                </div>
                <span className={cx("mt-1 text-center text-[10px] tabular-nums", dia === state.date ? "font-semibold text-accent" : "text-muted")}>
                  {rotulo}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-2">
        <section className="rounded-md border border-[#e1dfdd] bg-white p-3 shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
          <h3 className="text-sm font-semibold">Máquinas no período</h3>
          <div className="mt-3 grid gap-2">
            {porMaquina.length === 0 ? (
              <p className="text-sm text-muted">Sem apontamento salvo nesse recorte.</p>
            ) : (
              porMaquina.map((item) => (
                <div key={item.machine} className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-2">
                  <span className="text-xs font-semibold">{item.machine}</span>
                  <span className="h-5 overflow-hidden rounded-sm bg-[#f3f2f1]">
                    <span className="block h-full rounded-sm bg-accent" style={{ width: `${Math.max(4, (item.solas / maxMaquina) * 100)}%` }} />
                  </span>
                  <span className="text-right text-xs font-semibold tabular-nums">
                    {item.solas} · {total > 0 ? Math.round((item.solas / total) * 100) : 0}%
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
        <section className="rounded-md border border-[#e1dfdd] bg-white p-3 shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
          <h3 className="text-sm font-semibold">Perdas no período</h3>
          <div className="mt-3 grid gap-2">
            {porProblema.length === 0 ? (
              <p className="text-sm text-muted">Sem apontamento salvo nesse recorte.</p>
            ) : (
              porProblema.map((item) => (
                <div key={item.name} className="grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-snug">{item.name}</p>
                    <span className="mt-1 block h-2.5 overflow-hidden rounded-sm bg-[#f3f2f1]">
                      <span className="block h-full rounded-sm bg-accent" style={{ width: `${Math.max(4, (item.solas / maxProblema) * 100)}%` }} />
                    </span>
                  </div>
                  <span className="text-right text-xs font-semibold tabular-nums">
                    {item.solas} · {total > 0 ? Math.round((item.solas / total) * 100) : 0}%
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <RankingNumeros titulo="5 piores números do dia" detalhe={formatDateBR(state.date)} entries={doDia} />
        <RankingNumeros titulo="5 piores da semana" detalhe="7 dias até a data" entries={daSemana} />
        <RankingNumeros titulo="5 piores do mês" detalhe="31 dias até a data" entries={entradas} />
      </div>
    </div>
  );
}

function RankingNumeros({
  titulo,
  detalhe,
  entries,
}: {
  titulo: string;
  detalhe: string;
  entries: Entry[];
}) {
  const lista = rankNumeros(entries);
  return (
    <section className="rounded-md border border-[#e1dfdd] bg-white p-3 shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <p className="text-xs text-muted">{detalhe} · {entries.length} solas</p>
      {lista.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Sem número apontado.</p>
      ) : (
        <ol className="mt-3 grid gap-2">
          {lista.map((item, index) => (
            <li key={item.chave} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 border-b border-[#f3f2f1] pb-2 last:border-b-0">
              <span className="font-display text-2xl leading-none text-accent">{index + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug">
                  Nº {item.numero}
                  {item.referencia ? ` · Ref. ${item.referencia}` : ""}
                </p>
                <p className="text-xs text-muted">{item.maquinas}</p>
                <p className="text-xs font-semibold tabular-nums">
                  {item.solas} solas · {item.pares} {item.pares === 1 ? "par" : "pares"} · {item.percentual}%
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

function rankNumeros(entries: Entry[]) {
  const grupos = new Map<string, { numero: string; referencia: string; machines: Map<string, number>; solas: number }>();
  for (const entry of entries) {
    const numero = entry.matrizNumero.trim();
    const referencia = entry.matrizRel.trim();
    const chave = `${numero}||${referencia}`;
    const atual = grupos.get(chave) ?? { numero, referencia, machines: new Map<string, number>(), solas: 0 };
    atual.solas += 1;
    atual.machines.set(entry.machine, (atual.machines.get(entry.machine) ?? 0) + 1);
    grupos.set(chave, atual);
  }
  const total = entries.length;
  return [...grupos.values()]
    .map((item) => ({
      chave: `${item.numero}||${item.referencia}`,
      numero: item.numero || "sem nº",
      referencia: item.referencia,
      maquinas: [...item.machines.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([machine]) => machine)
        .join(" · "),
      solas: item.solas,
      pares: pares(item.solas),
      percentual: total > 0 ? Math.round((item.solas / total) * 100) : 0,
    }))
    .sort((a, b) => b.solas - a.solas || a.numero.localeCompare(b.numero, "pt-BR"))
    .slice(0, 5);
}

function PainelMesa({
  state,
  today,
  offDay,
  onDate,
  papel,
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
  papel: Papel;
  shown: MachineId[];
  busy: "foto" | "pdf" | null;
  onPhoto: (machine?: MachineId) => void;
  onPdf: () => void;
  onDelete?: (entries: Entry[]) => void;
}) {
  const [foco, setFoco] = useState<MachineId | null>(null);
  const [fotoAberta, setFotoAberta] = useState(false);
  const [pedirExclusao, setPedirExclusao] = useState(false);
  const recorte = foco && shown.includes(foco) ? shown.filter((machine) => machine === foco) : shown;
  const linhas = linhasDaMesa(state, recorte);
  const solas = linhas.reduce((sum, linha) => sum + linha.solas, 0);
  const totalPares = linhas.reduce((sum, linha) => sum + linha.pares, 0);
  const porMaquina = shown.map((machine) => ({
    machine,
    solas: linhasDaMesa(state, [machine]).reduce((sum, linha) => sum + linha.solas, 0),
  }));
  const maxMaquina = Math.max(1, ...porMaquina.map((item) => item.solas));
  const porProblema = PROBLEMS.map((problem) => ({
    name: problem.name,
    solas: linhas.filter((linha) => linha.perda === problem.name).reduce((sum, linha) => sum + linha.solas, 0),
  }))
    .filter((item) => item.solas > 0)
    .sort((a, b) => b.solas - a.solas);
  const maxProblema = Math.max(1, ...porProblema.map((item) => item.solas));
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
    <div className="grid items-start gap-3 xl:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="grid content-start gap-3 xl:sticky xl:top-3">
        <section className="rounded-md border border-[#e1dfdd] bg-white p-3 shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Segmentação</p>
          <label className="mt-3 block text-xs font-semibold text-muted">
            Data
            <input
              type="date"
              value={state.date}
              onChange={(event) => onDate(event.target.value)}
              className="mt-1 w-full rounded border border-[#c8c6c4] bg-[#faf9f8] px-2 py-2 text-sm font-semibold text-fg"
            />
          </label>
          {offDay ? (
            <button
              type="button"
              onClick={() => onDate(today)}
              className="mt-2 w-full rounded bg-accent py-2 text-sm font-semibold text-accent-ink"
            >
              Voltar para hoje
            </button>
          ) : null}
          <p className="mt-3 text-xs font-semibold text-muted">Turno</p>
          <p className="mt-1 rounded border border-[#c8c6c4] bg-[#f3f2f1] px-2 py-2 text-sm font-semibold">
            {TURNO_LABEL[state.turno]}
          </p>
        </section>
        <section className="rounded-md border border-[#e1dfdd] bg-white p-3 shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Máquina</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setFoco(null)}
              className={cx(
                "rounded px-2 py-2 text-left text-sm font-semibold",
                foco === null ? "bg-accent text-accent-ink" : "bg-[#f3f2f1] text-fg",
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
                  "rounded px-2 py-2 text-left text-sm font-semibold",
                  foco === machine ? "bg-accent text-accent-ink" : "bg-[#f3f2f1] text-fg",
                )}
              >
                {machine}
              </button>
            ))}
          </div>
          {shown.length === 0 ? <p className="mt-2 text-sm text-muted">Nenhuma máquina neste turno.</p> : null}
        </section>
        {papel === "lider" ? <MatrizariaConsulta state={state} ocultar={shown} /> : null}
      </aside>

      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#c8c6c4] pb-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              Estratificação das perdas · EVA
            </p>
            <h2 className="font-display text-4xl leading-none text-fg">
              {papel === "lider" ? "Acompanhamento" : "Lançamentos"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {formatDateBR(state.date)} · {TURNO_LABEL[state.turno]}
              {foco ? ` · recorte ${foco}` : " · turno inteiro"}
              {autores.length > 0 ? ` · ${autores.join(" · ")}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || shown.length === 0}
              onClick={() => {
                if (foco) {
                  onPhoto(foco);
                  return;
                }
                if (papel === "lider" && shown.length > 1) {
                  setFotoAberta((open) => !open);
                  return;
                }
                onPhoto(shown[0]);
              }}
              className="rounded border border-[#c8c6c4] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {busy === "foto" ? "Gerando foto…" : "Enviar foto"}
            </button>
            <button
              type="button"
              disabled={busy !== null || shown.length === 0}
              onClick={onPdf}
              className="rounded border border-[#c8c6c4] bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {busy === "pdf" ? "Gerando PDF…" : "Baixar PDF"}
            </button>
          </div>
        </div>

        {fotoAberta ? (
          <div className="flex flex-wrap gap-2">
            {shown.map((machine) => (
              <button
                key={machine}
                type="button"
                onClick={() => onPhoto(machine)}
                className="rounded bg-accent-soft px-3 py-2 text-sm font-semibold text-accent"
              >
                Foto {machine}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi titulo="Solas" valor={String(solas)} detalhe="apontadas no recorte" />
          <Kpi titulo="Pares" valor={String(totalPares)} detalhe="1 sola fecha 1 par" />
          <Kpi titulo="Máquinas" valor={String(recorte.length)} detalhe={foco ? "recorte ativo" : "com apontamento"} />
          <Kpi titulo="Maior perda" valor={pior ? String(pior.solas) : "—"} detalhe={pior?.name ?? "sem perda neste turno"} />
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <section className="rounded-md border border-[#e1dfdd] bg-white p-3 shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
            <h3 className="text-sm font-semibold">Solas por máquina</h3>
            <p className="text-xs text-muted">Clique na barra para filtrar o relatório.</p>
            <div className="mt-3 grid gap-2">
              {porMaquina.length === 0 ? (
                <p className="text-sm text-muted">Sem apontamento neste turno.</p>
              ) : (
                porMaquina.map((item) => (
                  <button
                    key={item.machine}
                    type="button"
                    onClick={() => setFoco((atual) => (atual === item.machine ? null : item.machine))}
                    className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-left"
                  >
                    <span className={cx("text-xs font-semibold", foco === item.machine && "text-accent")}>{item.machine}</span>
                    <span className="h-6 overflow-hidden rounded-sm bg-[#f3f2f1]">
                      <span
                        className={cx("block h-full rounded-sm", foco && foco !== item.machine ? "bg-[#c5d7e6]" : "bg-accent")}
                        style={{ width: `${Math.max(4, (item.solas / maxMaquina) * 100)}%` }}
                      />
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums">{item.solas}</span>
                  </button>
                ))
              )}
            </div>
          </section>
          <section className="rounded-md border border-[#e1dfdd] bg-white p-3 shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
            <h3 className="text-sm font-semibold">Solas por perda</h3>
            <p className="text-xs text-muted">Esquerda e direita não se somam. O par é de cada lado.</p>
            <div className="mt-3 grid gap-2">
              {porProblema.length === 0 ? (
                <p className="text-sm text-muted">Sem perda neste recorte.</p>
              ) : (
                porProblema.map((item) => (
                  <div key={item.name} className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">{item.name}</p>
                      <span className="mt-1 block h-2.5 overflow-hidden rounded-sm bg-[#f3f2f1]">
                        <span
                          className="block h-full rounded-sm bg-accent"
                          style={{ width: `${Math.max(4, (item.solas / maxProblema) * 100)}%` }}
                        />
                      </span>
                    </div>
                    <span className="text-right text-sm font-semibold tabular-nums">{item.solas}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {foco ? (
          <section className="rounded-md border border-[#e1dfdd] bg-white p-3 shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Matrizaria · {foco}</h3>
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
                      className="rounded bg-[#9b3a34] px-2 py-1 font-semibold text-white"
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

        <section className="overflow-hidden rounded-md border border-[#e1dfdd] bg-white shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
          <div className="flex items-center justify-between border-b border-[#e1dfdd] px-3 py-2">
            <h3 className="text-sm font-semibold">Detalhe do apontamento</h3>
            <p className="text-xs text-muted">{linhas.length} linhas</p>
          </div>
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-[#f3f2f1] text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  {["Máquina", "Estação", "Lado", "Nº", "Ref.", "Perda", "Solas", "Pares"].map((coluna) => (
                    <th key={coluna} className="whitespace-nowrap border-b border-[#e1dfdd] px-3 py-2 font-semibold">
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
                    <tr key={linha.key} className={index % 2 === 0 ? "bg-white" : "bg-[#faf9f8]"}>
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
    </div>
  );
}

function Kpi({ titulo, valor, detalhe }: { titulo: string; valor: string; detalhe: string }) {
  return (
    <section className="overflow-hidden rounded-md border border-[#e1dfdd] bg-white shadow-[0_1.6px_3.6px_rgba(0,0,0,.12)]">
      <div className="h-1 bg-accent" />
      <div className="px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{titulo}</p>
        <p className="mt-1 font-display text-5xl leading-none tabular-nums text-fg">{valor}</p>
        <p className="mt-2 line-clamp-2 text-xs text-muted">{detalhe}</p>
      </div>
    </section>
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
        .filter((item) => item.machine === machine && item.date === state.date && item.turno === state.turno)
        .map((item) => (
          <div key={item.id} className="rounded-tile border border-accent bg-surface-2 px-3 py-2">
            <p className="font-display text-xl leading-none">
              {item.station >= 1 ? `Troca · Estação ${pad2(item.station)}` : "Troca de matriz"}
            </p>
            <p className="mt-1 text-sm font-semibold leading-snug">
              {item.ambos ? "Ambos os lados" : SIDE_LABEL[item.side]} · {item.numero || "sem nº"}
              {item.referencia ? ` · ${item.referencia}` : ""}
            </p>
          </div>
        ))}
    </div>
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
          {nomesNaFicha(state, machine) ? ` · ${nomesNaFicha(state, machine)}` : ""}
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
            {item.solas} {item.solas === 1 ? "sola" : "solas"}
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


