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
      return { context: "Turno" };
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

function TurnosScreen({ onPick }: { onPick: (turno: Turno) => void }) {
  return (
    <div>
      <p className="text-base text-muted">Escolha o turno antes de lançar as perdas.</p>
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
  onSheet,
}: {
  state: State;
  today: string;
  offDay: boolean;
  onDate: (date: string) => void;
  onOpen: (machine: GridMachine) => void;
  onSheet: () => void;
}) {
  const total = shiftEntries(state).length;
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
      <button
        type="button"
        onClick={onSheet}
        className="mt-4 flex w-full items-center justify-between rounded-tile bg-accent px-5 py-4 text-left text-accent-ink"
      >
        <span>
          <span className="block font-display text-3xl leading-none">Lançamentos</span>
          <span className="mt-1 block text-sm font-semibold">
            {total === 1 ? "1 perda neste turno" : `${total} perdas neste turno`}
          </span>
        </span>
        <ClipboardList className="size-7" />
      </button>
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
  onAdd,
  onRemove,
}: {
  state: State;
  machine: MachineId;
  station: number;
  side: Side;
  offDay: boolean;
  onAdd: (problem: string) => void;
  onRemove: (problem: string) => void;
}) {
  const config = state.stations[stationKey(machine, station)];
  const matrix = describeMatrix(config, side);
  const rows = shiftEntries(state, machine).filter(
    (entry) => entry.station === station && entry.side === side,
  );

  return (
    <div>
      <ContextLine state={state} offDay={offDay} />
      {matrix ? <p className="mt-2 text-base font-semibold">{matrix}</p> : null}
      <div className="mt-4 grid gap-2">
        {PROBLEMS.map((problem) => {
          const count = rows.filter((entry) => entry.problem === problem.id).length;
          return (
            <div
              key={problem.id}
              className="flex items-center gap-2 rounded-tile border border-line bg-surface p-2"
            >
              <button
                type="button"
                disabled={count === 0}
                aria-label={`Tirar um lançamento de ${problem.name}`}
                onClick={() => onRemove(problem.id)}
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
  initialMachine,
  today,
  offDay,
  onDate,
  onNotice,
}: {
  state: State;
  initialMachine: MachineId | null;
  today: string;
  offDay: boolean;
  onDate: (date: string) => void;
  onNotice: (text: string) => void;
}) {
  const [filter, setFilter] = useState<MachineId | "todas">(initialMachine ?? "todas");
  const [busy, setBusy] = useState<"foto" | "pdf" | null>(null);
  const shown = filter === "todas" ? [...MACHINES] : [filter];
  const exportMachines =
    filter === "todas" ? shown.filter((machine) => machineHasFicha(state, machine)) : shown;
  const fileBase = `perdas-${state.date}-turno-${state.turno}`;

  async function sendPhoto() {
    if (exportMachines.length === 0) {
      onNotice("Nenhuma ficha neste turno.");
      return;
    }
    setBusy("foto");
    try {
      const files: File[] = [];
      for (const machine of exportMachines) {
        const blob = await renderFichaPng(state, machine);
        files.push(
          new File([blob], `${fileBase}-maquina-${machine}.png`, { type: "image/png" }),
        );
      }
      if (navigator.canShare?.({ files })) {
        try {
          await navigator.share({
            files,
            title: "Estratificação das perdas - EVA",
            text: `${formatDateBR(state.date)} · ${TURNO_LABEL[state.turno]}`,
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
      const pdf = await renderFichasPdf(state, exportMachines);
      downloadBlob(`${fileBase}.pdf`, pdf);
      onNotice("O celular não abriu o compartilhamento. O PDF foi baixado.");
    } catch {
      onNotice("Não foi possível gerar a foto.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadPdf() {
    if (exportMachines.length === 0) {
      onNotice("Nenhuma ficha neste turno.");
      return;
    }
    setBusy("pdf");
    try {
      const pdf = await renderFichasPdf(state, exportMachines);
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
      <DayControls state={state} today={today} offDay={offDay} onDate={onDate} />
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Chip active={filter === "todas"} onClick={() => setFilter("todas")}>
          Todas
        </Chip>
        {MACHINES.map((item) => (
          <Chip key={item} active={filter === item} onClick={() => setFilter(item)}>
            {item}
          </Chip>
        ))}
      </div>

      <div className="mt-4">
        {shown.map((machine) => (
          <FichaSheet key={machine} state={state} machine={machine} force={filter !== "todas"} />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void sendPhoto()}
          className="flex items-center justify-center gap-2 rounded-tile bg-accent py-3 font-semibold text-accent-ink disabled:opacity-60"
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
}: {
  state: State;
  machine: MachineId;
  force: boolean;
}) {
  const lines = fichaLines(state, machine);
  const total = fichaTotal(lines);
  const filled = machineHasFicha(state, machine);
  if (!force && !filled) {
    return (
      <section className="mt-3 rounded-tile border border-dashed border-line bg-surface px-4 py-3 first:mt-0">
        <h2 className="font-display text-2xl leading-none">Máquina {machine}</h2>
        <p className="mt-1 text-sm text-muted">Sem matriz e sem perdas neste turno.</p>
      </section>
    );
  }

  return (
    <section className="mt-8 overflow-hidden rounded-tile border-2 border-accent bg-surface first:mt-0">
      <header className="bg-accent px-4 py-3 text-accent-ink">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-display text-4xl leading-none">Máquina {machine}</h2>
          <p className="font-display text-3xl leading-none tabular-nums">{total}</p>
        </div>
        <p className="mt-1 text-sm">
          {formatDateBR(state.date)} · {TURNO_LABEL[state.turno]}
        </p>
      </header>
      <p className="px-3 py-2 text-sm text-muted">Arraste para o lado para ver os problemas.</p>
      <div className="overflow-x-auto">
        <FichaTable lines={lines} />
      </div>
    </section>
  );
}

function FichaTable({ lines }: { lines: FichaLine[] }) {
  return (
    <table className="w-max border-separate border-spacing-0 text-left text-sm">
      <thead>
        <tr className="bg-accent-soft text-fg">
          <th
            scope="col"
            className="sticky left-0 z-20 w-14 border-b border-r border-line bg-accent-soft px-1 py-2 text-center"
          >
            Est.
          </th>
          <th
            scope="col"
            className="sticky left-14 z-20 w-12 border-b border-r border-line bg-accent-soft px-1 py-2 text-center"
          >
            Lado
          </th>
          <th
            scope="col"
            className="sticky left-26 z-20 w-16 border-b border-r border-line bg-accent-soft px-1 py-2 text-center"
          >
            Nº
          </th>
          <th
            scope="col"
            className="sticky left-42 z-20 w-12 border-b border-r border-line bg-accent-soft px-1 py-2 text-center"
          >
            Ref.
          </th>
          {PROBLEMS.map((problem) => (
            <th
              key={problem.id}
              scope="col"
              className="relative h-56 w-12 border-b border-r border-line p-0"
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

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string | number;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "min-h-11 min-w-11 shrink-0 rounded-tile px-3 font-display text-xl leading-none",
        active ? "bg-accent text-accent-ink" : "bg-surface-2 text-fg",
      )}
    >
      {children}
    </button>
  );
}

