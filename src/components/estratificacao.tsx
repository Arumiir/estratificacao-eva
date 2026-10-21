import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ClipboardList,
  Download,
  ImageDown,
  Minus,
  Plus,
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
  pad2,
  problemName,
  saveState,
  shiftEntries,
  stationKey,
  todayISO,
  TURNO_LABEL,
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

type Screen =
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

function usePerdas() {
  const [state, setState] = useState<State | null>(null);
  const ref = useRef<State | null>(null);

  useEffect(() => {
    const loaded = loadState();
    ref.current = loaded;
    setState(loaded);
  }, []);

  useEffect(() => {
    if (state) saveState(state);
  }, [state]);

  function commit(recipe: (current: State) => State) {
    if (!ref.current) return;
    const next = recipe(ref.current);
    ref.current = next;
    setState(next);
  }

  return { state, commit, read: () => ref.current };
}

function screenKey(screen: Screen): string {
  switch (screen.kind) {
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
  if (screen.kind === "turnos" || screen.kind === "machines" || screen.kind === "sie05") return null;
  return screen.machine;
}

export function EstratificacaoApp() {
  const { state, commit, read } = usePerdas();
  const [stack, setStack] = useState<Screen[]>([{ kind: "turnos" }]);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [banner, setBanner] = useState<Banner | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const screen = stack[stack.length - 1] ?? { kind: "turnos" as const };
  const key = screenKey(screen);

  useEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [key]);

  useEffect(() => {
    if (!banner) return;
    const timer = window.setTimeout(() => setBanner(null), 4200);
    return () => window.clearTimeout(timer);
  }, [banner]);

  function push(next: Screen) {
    setDir("forward");
    setStack((current) => [...current, next]);
  }

  function back() {
    setDir("back");
    setStack((current) => (current.length > 1 ? current.slice(0, -1) : current));
  }

  function flash(text: string, undo?: () => void) {
    setBanner({ id: Date.now(), text, undo });
  }

  function restore(entry: Entry) {
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

  if (!state) return <Loading />;

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
    commit((current) => {
      const stations = { ...current.stations };
      STATIONS.forEach((station, index) => {
        const config = configs[index];
        if (config) stations[stationKey(machine, station)] = config;
      });
      return { ...current, stations };
    });
    flash("Grade de matrizaria salva");
    setDir("forward");
    const sie05 = machine === "SIE05A" || machine === "SIE05B";
    setStack(
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
      };
      return { ...current, entries: [...current.entries, entry] };
    });
    navigator.vibrate?.(12);
    const where = `${problemName(problem)} · ${SIDE_LABEL[side].toLowerCase()}`;
    flash(`Lançado: ${where}`, () => removeEntry(id, "Lançamento desfeito"));
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
          entry.problem === problem,
      );
    if (!match) return;
    removeEntry(match.id, "Um lançamento tirado");
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
            <h1 className="font-display text-3xl leading-none tracking-wide text-accent">
              Estratificação
            </h1>
            <p className="font-display text-xl leading-none text-fg">das perdas - EVA</p>
            {header.context ? (
              <p className="mt-1 truncate text-sm font-semibold text-muted">{header.context}</p>
            ) : null}
          </div>
          {screen.kind !== "sheet" && screen.kind !== "turnos" ? (
            <button
              type="button"
              onClick={() => push({ kind: "sheet", machine: machineFrom(screen) })}
              aria-label="Abrir planilha"
              className="grid size-11 shrink-0 place-items-center rounded-tile bg-accent-soft text-accent"
            >
              <ClipboardList className="size-5" />
            </button>
          ) : null}
        </div>
      </header>

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
          {screen.kind === "turnos" ? (
            <TurnosScreen
              onPick={(turno) => {
                setTurno(turno);
                push({ kind: "machines" });
              }}
            />
          ) : null}

          {screen.kind === "machines" ? (
            <MachinesScreen
              state={state}
              today={today}
              offDay={offDay}
              onDate={setDate}
              onOpen={openGrid}
              onSheet={() => push({ kind: "sheet", machine: null })}
            />
          ) : null}

          {screen.kind === "sie05" ? (
            <Sie05Screen state={state} onPick={openMachine} />
          ) : null}

          {screen.kind === "ask" ? (
            <AskScreen
              machine={screen.machine}
              onEdit={() => push({ kind: "matrices", machine: screen.machine })}
              onSkip={() => {
                setDir("forward");
                setStack((current) => [
                  ...current.slice(0, -1),
                  { kind: "stations", machine: screen.machine },
                ]);
              }}
            />
          ) : null}

          {screen.kind === "matrices" ? (
            <MatrixGradeScreen
              state={state}
              machine={screen.machine}
              onSave={(configs) => saveGrade(screen.machine, configs)}
            />
          ) : null}

          {screen.kind === "stations" ? (
            <StationsScreen
              state={state}
              machine={screen.machine}
              offDay={offDay}
              onOpen={(station) => push({ kind: "side", machine: screen.machine, station })}
              onMatrices={() => push({ kind: "matrices", machine: screen.machine })}
            />
          ) : null}

          {screen.kind === "side" ? (
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

          {screen.kind === "problems" ? (
            <ProblemsScreen
              state={state}
              machine={screen.machine}
              station={screen.station}
              side={screen.side}
              offDay={offDay}
              onAdd={(problem) => addProblem(screen.machine, screen.station, screen.side, problem)}
              onRemove={(problem) =>
                removeLast(screen.machine, screen.station, screen.side, problem)
              }
            />
          ) : null}

          {screen.kind === "sheet" ? (
            <SheetScreen
              state={state}
              initialMachine={screen.machine}
              today={today}
              offDay={offDay}
              onDate={setDate}
              onNotice={(text) => flash(text)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
