export type Turno = "1" | "2" | "3";
export type Side = "esq" | "dir";

export type Problem = {
  id: string;
  short: string;
  name: string;
};

/** Colunas da ficha, na ordem da planilha. */
export const PROBLEMS: readonly Problem[] = [
  { id: "gas-sola", short: "Preso - Sola", name: "Escape de gás preso - Sola" },
  { id: "gas-gaspea", short: "Preso - Gáspea", name: "Escape de gás preso - Gáspea" },
  { id: "contaminacao", short: "Contaminação", name: "Contaminação" },
  { id: "tamanho-menor", short: "Tamanho menor", name: "Tamanho menor" },
  { id: "excesso-carga", short: "Excesso de carga", name: "Excesso de carga" },
  { id: "falta-corpo", short: "Falta de carga", name: "Falta de carga" },
  { id: "peca-rasgada", short: "Peça rasgada", name: "Peça rasgada" },
  { id: "sujeira", short: "Sujeira pós manut.", name: "Sujeira pós manutenção" },
  { id: "contra-pe", short: "Contra pé", name: "Contra pé" },
  { id: "pezinho", short: "Pezinho preso", name: "Pezinho preso" },
  { id: "gas-aberto", short: "Gás aberto", name: "Escape de gás aberto" },
] as const;

export type MatrixSlot = { numero: string; referencia: string };

export type StationConfig = {
  ambos: boolean;
  numero: string;
  referencia: string;
  esq: MatrixSlot;
  dir: MatrixSlot;
};

export type Entry = {
  id: string;
  date: string;
  turno: Turno;
  machine: MachineId;
  station: number;
  side: Side;
  problem: string;
  at: number;
  matrizNumero: string;
  matrizRel: string;
};

export type State = {
  stations: Record<string, StationConfig>;
  entries: Entry[];
  date: string;
  turno: Turno;
};

export const MACHINES = ["SIE01", "SIE02", "SIE03", "SIE04", "SIE05A", "SIE05B", "SIE06"] as const;
export type MachineId = (typeof MACHINES)[number];
export const GRID_MACHINES = ["SIE01", "SIE02", "SIE03", "SIE04", "SIE05", "SIE06"] as const;
export type GridMachine = (typeof GRID_MACHINES)[number];
export const STATIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const SIDES = ["esq", "dir"] as const;

export const TURNO_LABEL: Record<Turno, string> = {
  "1": "1º TURNO",
  "2": "2º TURNO",
  "3": "3º TURNO",
};

export const SIDE_LABEL: Record<Side, string> = {
  esq: "Esquerda",
  dir: "Direita",
};

export const SIDE_SHORT: Record<Side, string> = {
  esq: "Esq.",
  dir: "Dir.",
};

const KEY = "estratificacao-perdas-v1";

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function stationKey(machine: MachineId, station: number): string {
  return `${machine}-${station}`;
}

export function gridTargets(machine: GridMachine): MachineId[] {
  if (machine === "SIE05") return ["SIE05A", "SIE05B"];
  return [machine];
}

export function parseMachine(value: unknown): MachineId | null {
  if (typeof value === "number" && Number.isInteger(value)) return legacyMachine(String(value));
  if (typeof value !== "string") return null;
  if ((MACHINES as readonly string[]).includes(value)) return value as MachineId;
  return legacyMachine(value);
}

function legacyMachine(raw: string): MachineId | null {
  switch (raw) {
    case "1":
      return "SIE01";
    case "2":
      return "SIE02";
    case "3":
      return "SIE03";
    case "4":
      return "SIE04";
    case "5":
      return "SIE05A";
    case "6":
      return "SIE06";
    default:
      return null;
  }
}

function parseStationKey(key: string): string | null {
  const match = /^(.+)-(\d+)$/.exec(key);
  if (!match) return null;
  const machine = parseMachine(match[1]);
  const station = Number(match[2]);
  if (!machine || station < 1 || station > 8) return null;
  return stationKey(machine, station);
}

export function emptySlot(): MatrixSlot {
  return { numero: "", referencia: "" };
}

export function emptyConfig(): StationConfig {
  return {
    ambos: false,
    numero: "",
    referencia: "",
    esq: emptySlot(),
    dir: emptySlot(),
  };
}

export function problemById(id: string): Problem | undefined {
  return PROBLEMS.find((p) => p.id === id);
}

export function problemName(id: string): string {
  return problemById(id)?.name ?? id;
}

export function activeMatrix(
  config: StationConfig | undefined,
  side: Side,
): MatrixSlot | null {
  if (!config) return null;
  const slot = config.ambos
    ? { numero: config.numero, referencia: config.referencia }
    : side === "esq"
      ? config.esq
      : config.dir;
  if (!slot.numero.trim() && !slot.referencia.trim()) return null;
  return slot;
}

export function describeMatrix(config: StationConfig | undefined, side: Side): string {
  const slot = activeMatrix(config, side);
  if (!slot) return "";
  const numero = slot.numero.trim();
  const referencia = slot.referencia.trim();
  if (numero && referencia) return `${numero} · ${referencia}`;
  return numero || referencia;
}

export function machineHasMatrices(state: State, machine: MachineId): boolean {
  return STATIONS.some((station) => {
    const config = state.stations[stationKey(machine, station)];
    return SIDES.some((side) => activeMatrix(config, side));
  });
}

export function emptyState(now = new Date()): State {
  return {
    stations: {},
    entries: [],
    date: todayISO(now),
    turno: "1",
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isSide(v: unknown): v is Side {
  return v === "esq" || v === "dir";
}

function parseTurno(v: unknown): Turno | null {
  if (v === "1" || v === "A") return "1";
  if (v === "2" || v === "B") return "2";
  if (v === "3" || v === "C") return "3";
  return null;
}

function readSlot(v: unknown): MatrixSlot {
  if (!isRecord(v)) return emptySlot();
  const referencia =
    typeof v.referencia === "string" ? v.referencia : typeof v.rel === "string" ? v.rel : "";
  return {
    numero: typeof v.numero === "string" ? v.numero : "",
    referencia,
  };
}

function readConfig(v: unknown): StationConfig | null {
  if (!isRecord(v)) return null;
  if (v.mode === "uma" || v.mode === "duas") {
    const esq = readSlot(v.esq);
    const dir = readSlot(v.dir);
    if (v.mode === "uma") {
      const lado = v.lado === "dir" ? "dir" : "esq";
      return {
        ambos: false,
        numero: "",
        referencia: "",
        esq: lado === "esq" ? esq : emptySlot(),
        dir: lado === "dir" ? dir : emptySlot(),
      };
    }
    return { ambos: false, numero: "", referencia: "", esq, dir };
  }
  if (typeof v.ambos !== "boolean") return null;
  return {
    ambos: v.ambos,
    numero: typeof v.numero === "string" ? v.numero : "",
    referencia: typeof v.referencia === "string" ? v.referencia : "",
    esq: readSlot(v.esq),
    dir: readSlot(v.dir),
  };
}

function readEntry(v: unknown): Entry | null {
  if (!isRecord(v)) return null;
  if (typeof v.id !== "string" || typeof v.date !== "string") return null;
  const turno = parseTurno(v.turno);
  if (!turno || !isSide(v.side)) return null;
  const machine = parseMachine(v.machine);
  if (!machine || typeof v.station !== "number") return null;
  if (typeof v.problem !== "string" || typeof v.at !== "number") return null;
  const problem = v.problem === "manutencao" ? "sujeira" : v.problem;
  return {
    id: v.id,
    date: v.date,
    turno,
    machine,
    station: v.station,
    side: v.side,
    problem,
    at: v.at,
    matrizNumero: typeof v.matrizNumero === "string" ? v.matrizNumero : "",
    matrizRel: typeof v.matrizRel === "string" ? v.matrizRel : "",
  };
}

export function loadState(): State {
  const base = emptyState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data: unknown = JSON.parse(raw);
    if (!isRecord(data)) return base;
    const stations: Record<string, StationConfig> = {};
    if (isRecord(data.stations)) {
      for (const [k, val] of Object.entries(data.stations)) {
        const key = parseStationKey(k);
        const cfg = readConfig(val);
        if (key && cfg) stations[key] = cfg;
      }
    }
    const entries = Array.isArray(data.entries)
      ? data.entries.flatMap((item) => {
          const entry = readEntry(item);
          return entry ? [entry] : [];
        })
      : [];
    return {
      stations,
      entries,
      date:
        typeof data.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date)
          ? data.date
          : base.date,
      turno: parseTurno(data.turno) ?? base.turno,
    };
  } catch {
    return base;
  }
}

export function saveState(state: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* cheio ou bloqueado — a sessão continua */
  }
}

export function inShift(entry: Entry, state: State, machine?: MachineId): boolean {
  if (entry.date !== state.date || entry.turno !== state.turno) return false;
  if (machine !== undefined && entry.machine !== machine) return false;
  return true;
}

export function shiftEntries(state: State, machine?: MachineId): Entry[] {
  return state.entries.filter((entry) => inShift(entry, state, machine));
}

export type TableRow = string[];

function csvCell(value: string): string {
  if (/[;"\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function tsvCell(value: string): string {
  return value.replaceAll(/[\t\n\r]/g, " ");
}

export function formatTable(rows: TableRow[], sep: ";" | "\t"): string {
  const cell = sep === ";" ? csvCell : tsvCell;
  return rows.map((row) => row.map(cell).join(sep)).join("\r\n");
}

export type FichaLine = {
  machine: MachineId;
  station: number;
  side: Side;
  numero: string;
  referencia: string;
  shared: boolean;
  counts: number[];
};

export function fichaLines(state: State, machine: MachineId): FichaLine[] {
  const entries = shiftEntries(state, machine);
  return STATIONS.flatMap((station) => {
    const config = state.stations[stationKey(machine, station)];
    const shared = Boolean(config?.ambos);
    return SIDES.map((side) => {
      const slot = activeMatrix(config, side);
      let numero = slot?.numero.trim() ?? "";
      let referencia = slot?.referencia.trim() ?? "";
      if (!numero && !referencia) {
        const latest = entries
          .filter((entry) => entry.station === station && entry.side === side)
          .sort((a, b) => b.at - a.at)[0];
        if (latest) {
          numero = latest.matrizNumero.trim();
          referencia = latest.matrizRel.trim();
        }
      }
      const counts = PROBLEMS.map(
        (problem) =>
          entries.filter(
            (entry) =>
              entry.station === station && entry.side === side && entry.problem === problem.id,
          ).length,
      );
      return { machine, station, side, numero, referencia, shared, counts };
    });
  });
}

export function fichaTotal(lines: FichaLine[]): number {
  return lines.reduce((sum, line) => sum + line.counts.reduce((a, b) => a + b, 0), 0);
}

export function machineHasFicha(state: State, machine: MachineId): boolean {
  if (shiftEntries(state, machine).length > 0) return true;
  return fichaLines(state, machine).some((line) => line.numero || line.referencia);
}

export function entryRows(state: State, machines: MachineId[]): TableRow[] {
  const header = ["Máquina", "Estação", "Lado", "Nº", "Ref.", ...PROBLEMS.map((problem) => problem.name)];
  const body: TableRow[] = [];
  for (const machine of machines) {
    for (const line of fichaLines(state, machine)) {
      body.push([
        String(machine),
        String(line.station),
        SIDE_LABEL[line.side],
        line.shared && line.side === "dir" ? "" : line.numero,
        line.shared && line.side === "dir" ? "" : line.referencia,
        ...line.counts.map(String),
      ]);
    }
  }
  return [header, ...body];
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob(["\uFEFF" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}
