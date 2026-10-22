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
  Maximize2,
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
  describeMatrix,
  emptyConfig,
  fichaLines,
  fichaTotal,
  formatDateBR,
  GRID_MACHINES,
  gridTargets,
  inShift,
  loadState,
  machineHasFicha,
  machineHasMatrices,
  mergeSharedEntries,
  nomesNaFicha,
  pad2,
  problemName,
  saveState,
  shiftEntries,
  stationKey,
  todayISO,
  TURNO_LABEL,
  withMatrix,
  gradeHasNumbers,
  type Entry,
  type FichaLine,
  type GridMachine,
  type MachineId,
  type Side,
  type State,
  type StationConfig,
  type Turno,
} from "@/lib/perdas";
import { downloadBlob, renderFichaPng, renderFichasPdf } from "@/lib/ficha-image";
import { enviarPlanilha, pullApontamentos, pushApontamentos } from "@/lib/apontamentos.functions";
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
  | { kind: "side"; machine: MachineId; station: number }
  | { kind: "problems"; machine: MachineId; station: number; side: Side }
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
    if (state) saveState(state);
  }, [state]);

  const synced = useRef<Set<string> | null>(null);
  const lastEntries = useRef<State["entries"] | null>(null);
  const held = useRef<Set<string>>(new Set());
  const dirtyGrades = useRef<Set<string>>(new Set());
  const seededGrades = useRef(false);
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
    const stamped = state.entries.map((entry) => withMatrix(entry, state.stations));
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
    if (!seededGrades.current) {
      seededGrades.current = true;
      for (const [key, config] of Object.entries(state.stations)) {
        if (gradeHasNumbers(config)) grades[key] = config;
      }
    }
    for (const key of dirtyGrades.current) {
      const config = state.stations[key];
      if (config && gradeHasNumbers(config)) grades[key] = config;
    }
    if (upserts.length === 0 && removed.length === 0 && Object.keys(grades).length === 0) {
      skipExcelBacklog.current = false;
      return;
    }
    if (skipExcelBacklog.current) skipExcelBacklog.current = false;
    else {
      for (const entry of upserts) enqueueExcel(entry, 1);
      for (const entry of removed) queueRemoval(entry);
    }
    const sentGrades = Object.keys(grades);
    void pushApontamentos({ data: { upserts, removed, grades, date: state.date } })
      .then((result) => {
        setCloud(result.cloud);
        for (const entry of upserts) known.add(entry.id);
        for (const item of removed) known.delete(item.id);
        for (const key of sentGrades) dirtyGrades.current.delete(key);
      })
      .catch(() => {});
  }, [state]);

  function takeRemote(
    current: State,
    remote: { entries: Entry[]; removed: string[]; grades?: Record<string, StationConfig> },
  ) {
    for (const id of remote.removed) held.current.delete(id);
    const stations = { ...current.stations };
    let stationsChanged = false;
    for (const [key, config] of Object.entries(remote.grades ?? {})) {
      if (dirtyGrades.current.has(key) || !gradeHasNumbers(config)) continue;
      if (JSON.stringify(stations[key]) !== JSON.stringify(config)) {
        stations[key] = config;
        stationsChanged = true;
      }
    }
    const merged = mergeSharedEntries(current.entries, remote.entries, remote.removed, current.date).filter(
      (entry) => !held.current.has(entry.id),
    );
    const entries = merged.map((entry) => withMatrix(entry, stations));
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
    if (!stationsChanged && sameEntries) return current;
    return { ...current, stations, entries };
  }

  async function refresh() {
    const current = ref.current;
    if (!current) return false;
    const remote = await pullApontamentos({ data: { date: current.date } });
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
        if (upserts.length > 0) {
          void pushApontamentos({ data: { upserts, removed: [] } })
            .then((result) => {
              setCloud(result.cloud);
              for (const entry of upserts) known.add(entry.id);
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
    void pullApontamentos({ data: { date: state.date } })
      .then((remote) => {
        if (cancel || !ref.current || ref.current.date !== state.date) return;
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
    case "side":
      return `side-${screen.machine}-${screen.station}`;
    case "problems":
      return `problems-${screen.machine}-${screen.station}-${screen.side}`;
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

  function removeEntry(id: string, label = "Lançamento apagado") {
    const current = read();
    if (!current) return;
    const entry = current.entries.find((item) => item.id === id);
    if (!entry) return;
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
    markGrades(STATIONS.map((station) => stationKey(machine, station)));
    commit((current) => {
      const stations = { ...current.stations };
      STATIONS.forEach((station, index) => {
        const config = configs[index];
        if (config) stations[stationKey(machine, station)] = config;
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

  function addProblem(machine: MachineId, station: number, side: Side, problem: string) {
    const id = crypto.randomUUID();
    let snapshot = { numero: "", referencia: "" };
    commit((current) => {
      const slot = activeMatrix(current.stations[stationKey(machine, station)], side);
      snapshot = {
        numero: slot?.numero.trim() ?? "",
        referencia: slot?.referencia.trim() ?? "",
      };
      const entry: Entry = {
        id,
        date: current.date,
        turno: current.turno,
        machine,
        station,
        side,
        problem,
        at: Date.now(),
        matrizNumero: snapshot.numero,
        matrizRel: snapshot.referencia,
        autor: nome,
      };
      return { ...current, entries: [...current.entries, entry] };
    });
    navigator.vibrate?.(12);
    const where = `${problemName(problem)} · ${SIDE_LABEL[side].toLowerCase()}`;
    flash(`Lançado: ${where}`, () => removeEntry(id, "Lançamento desfeito"));
  }

  function sameAuthor(entry: Entry) {
    if (papel !== "preparador") return true;
    const mine = nome.trim().toLocaleLowerCase("pt-BR");
    const autor = entry.autor.trim().toLocaleLowerCase("pt-BR");
    return autor === mine || autor === "";
  }

  function removeLast(machine: MachineId, station: number, side: Side, problem: string) {
    const current = read();
    if (!current) return;
    const match = [...current.entries]
      .reverse()
      .find(
        (entry) =>
          inShift(entry, current) &&
          entry.machine === machine &&
          entry.station === station &&
          entry.side === side &&
          entry.problem === problem &&
          sameAuthor(entry),
      );
    if (!match) return;
    removeEntry(match.id, "Um lançamento tirado");
  }

  function removeMany(ids: string[], label: string) {
    const current = read();
    if (!current || ids.length === 0) return;
    const gone = current.entries.filter((entry) => ids.includes(entry.id));
    if (gone.length === 0) return;
    commit((s) => ({ ...s, entries: s.entries.filter((entry) => !ids.includes(entry.id)) }));
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
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
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
            className="pointer-events-auto mx-auto flex w-full max-w-3xl items-center gap-3 rounded-tile bg-accent px-4 py-3 text-accent-ink"
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
            "mx-auto w-full max-w-3xl px-4 py-4 pb-28",
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
            />
          ) : null}

          {papel === "preparador" && screen.kind === "side" ? (
            <SideScreen
              state={state}
              machine={screen.machine}
              station={screen.station}
              offDay={offDay}
              onChoose={(side) =>
                push({
                  kind: "problems",
                  machine: screen.machine,
                  station: screen.station,
                  side,
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
              onAdd={(problem) => addProblem(screen.machine, screen.station, screen.side, problem)}
              onRemove={(problem) =>
                removeLast(screen.machine, screen.station, screen.side, problem)
              }
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
    case "side":
      return { context: `Máquina ${screen.machine} · Estação ${pad2(screen.station)}` };
    case "problems":
      return {
        context: `Máquina ${screen.machine} · Estação ${pad2(screen.station)} · ${SIDE_LABEL[screen.side]}`,
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
      <div className="mt-4 grid gap-3">
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
      <DayControls state={state} today={today} offDay={offDay} onDate={onDate} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
      <div className="mt-4 grid gap-3">
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
}: {
  state: State;
  machine: MachineId;
  offDay: boolean;
  onOpen: (station: number) => void;
  onMatrices: () => void;
}) {
  return (
    <div>
      <ContextLine state={state} offDay={offDay} />
      <button
        type="button"
        onClick={onMatrices}
        className="mt-4 w-full rounded-tile border border-line bg-surface px-4 py-3 text-left text-base font-semibold text-accent"
      >
        Editar matrizes
      </button>
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATIONS.map((station) => {
          const config = state.stations[stationKey(machine, station)];
          const count = shiftEntries(state, machine).filter(
            (entry) => entry.station === station,
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
}: {
  state: State;
  machine: MachineId;
  station: number;
  offDay: boolean;
  onChoose: (side: Side) => void;
}) {
  const config = state.stations[stationKey(machine, station)];
  const rows = shiftEntries(state, machine).filter((entry) => entry.station === station);
  return (
    <div>
      <ContextLine state={state} offDay={offDay} />
      <div className="mt-4 grid gap-3">
        {SIDES.map((side) => {
          const count = rows.filter((entry) => entry.side === side).length;
          const matrix = describeMatrix(config, side);
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
}: {
  state: State;
  machine: MachineId;
  station: number;
  side: Side;
  offDay: boolean;
  autor: string;
  onAdd: (problem: string) => void;
  onRemove: (problem: string) => void;
}) {
  const [ask, setAsk] = useState<string | null>(null);
  const config = state.stations[stationKey(machine, station)];
  const matrix = describeMatrix(config, side);
  const mine = autor.trim().toLocaleLowerCase("pt-BR");
  const rows = shiftEntries(state, machine).filter((entry) => {
    if (entry.station !== station || entry.side !== side) return false;
    if (!mine) return true;
    const who = entry.autor.trim().toLocaleLowerCase("pt-BR");
    return who === mine || who === "";
  });

  return (
    <div>
      <ContextLine state={state} offDay={offDay} />
      {matrix ? <p className="mt-2 text-base font-semibold">{matrix}</p> : null}
      <div className="mt-4 grid gap-2">
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
                aria-label={`Lançar ${problem.name}`}
                onClick={() => onAdd(problem.id)}
                className="grid size-14 shrink-0 place-items-center rounded-tile bg-accent text-accent-ink touch-manipulation"
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
      <div className="mt-4 grid gap-3">
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
    <div>
      {papel === "lider" ? (
        <p className="mb-3 text-sm text-muted">Só as máquinas apontadas neste turno.</p>
      ) : (
        <p className="mb-3 text-sm text-muted">
          Cada toque seu vai para a planilha, uma sola por vez. A foto e o PDF saem com o seu nome.
        </p>
      )}
      <DayControls state={state} today={today} offDay={offDay} onDate={onDate} />

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
  const total = fichaTotal(lines);
  const filled = machineHasFicha(state, machine);
  const [wide, setWide] = useState(false);
  const [open, setOpen] = useState(force);
  const [askDelete, setAskDelete] = useState(false);
  const mine = shiftEntries(state, machine);
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
    <section className="mt-3 overflow-hidden rounded-tile border-2 border-accent bg-surface first:mt-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="w-full bg-accent px-4 py-3 text-left text-accent-ink"
      >
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-display text-4xl leading-none">Máquina {machine}</h2>
          <span className="flex items-center gap-2">
            <span className="font-display text-3xl leading-none tabular-nums">{total}</span>
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
            <button
              type="button"
              onClick={() => void openLandscape(setWide)}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-tile bg-accent-soft font-semibold text-accent"
            >
              <Maximize2 className="size-5" />
              Ver em paisagem
            </button>
            {onDelete && mine.length > 0 ? (
              askDelete ? (
                <div className="flex items-center gap-2 rounded-tile bg-surface-2 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    Excluir {mine.length} apontamento{mine.length === 1 ? "" : "s"} desta máquina?
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
                      onDelete(mine);
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
          <p className="px-3 py-2 text-sm text-muted">
            Desça a tabela: os problemas ficam fixos. Para o lado, o restante das colunas.
          </p>
          <div className="max-h-[65dvh] overflow-auto">
            <FichaTable lines={lines} />
          </div>
        </>
      ) : null}
      {wide ? (
        <LandscapeSheet
          machine={machine}
          date={formatDateBR(state.date)}
          turno={TURNO_LABEL[state.turno]}
          total={total}
          lines={lines}
          onClose={() => setWide(false)}
        />
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
        <li key={item.name} className="flex items-center gap-2 rounded-lg bg-white/15 px-2 py-1">
          <span className="w-5 shrink-0 font-display text-xl leading-none">{index + 1}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.name}</span>
          <span className="shrink-0 font-display text-2xl leading-none tabular-nums">{item.count}</span>
        </li>
      ))}
    </ol>
  );
}

function topProblems(lines: FichaLine[]): { name: string; count: number }[] {
  const ranked = PROBLEMS.map((problem, index) => ({
    name: problem.short,
    count: lines.reduce((sum, line) => sum + (line.counts[index] ?? 0), 0),
  })).sort((a, b) => b.count - a.count);
  const acima = ranked.filter((item) => item.count > 3);
  const lista = acima.length > 0 ? acima : ranked.filter((item) => item.count >= 2);
  return lista.slice(0, 3);
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


