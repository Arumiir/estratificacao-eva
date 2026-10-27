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
  salvoEm?: number;
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
  autor: string;
  outroId: string;
};

export type OutroMatriz = {
  id: string;
  date: string;
  turno: Turno;
  machine: MachineId;
  station: number;
  ambos: boolean;
  side: Side;
  numero: string;
  referencia: string;
  salvoEm: number;
  excluido?: boolean;
};

export type State = {
  stations: Record<string, StationConfig>;
  outros: OutroMatriz[];
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

export function apontamentoBloqueado(entry: { date: string; turno: string; at: number }): boolean {
  return entry.date === "2026-10-24" && entry.turno === "1" && entry.at <= Date.parse("2026-10-24T14:49:00-03:00");
}

function partesFortaleza(at = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Fortaleza",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${read("year")}-${read("month")}-${read("day")}`,
    minutes: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

export function turnoPeloRelogio(at = Date.now()): Turno {
  const { minutes } = partesFortaleza(at);
  if (minutes >= 6 * 60 + 1 && minutes < 14 * 60 + 48) return "1";
  if (minutes >= 14 * 60 + 48 && minutes <= 23 * 60 + 30) return "2";
  return "3";
}

export function podeAlterarApontamento(
  entry: { date: string; turno: string; at: number },
  now = Date.now(),
): boolean {
  if (apontamentoBloqueado(entry)) return false;
  const agora = partesFortaleza(now);
  if (entry.date !== agora.date) return false;
  return entry.turno === turnoPeloRelogio(now);
}

export function todayISO(now = new Date()): string {
  return partesFortaleza(now.getTime()).date;
}

export function diasAte(ate: string, quantidade: number): string[] {
  const [year, month, day] = ate.split("-").map(Number);
  if (!year || !month || !day) return [];
  const total = Math.min(31, Math.max(1, quantidade));
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const dias: string[] = [];
  for (let index = total - 1; index >= 0; index -= 1) {
    const item = new Date(cursor);
    item.setUTCDate(cursor.getUTCDate() - index);
    const mes = String(item.getUTCMonth() + 1).padStart(2, "0");
    const dia = String(item.getUTCDate()).padStart(2, "0");
    dias.push(`${item.getUTCFullYear()}-${mes}-${dia}`);
  }
  return dias;
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

export function gradeHasNumbers(config: StationConfig | undefined): boolean {
  if (!config) return false;
  return SIDES.some((side) => activeMatrix(config, side));
}

export function readGrades(value: unknown): Record<string, StationConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const grades: Record<string, StationConfig> = {};
  for (const [key, item] of Object.entries(value)) {
    const parsed = parseStationKey(key);
    const config = readConfig(item);
    if (parsed && config && gradeHasNumbers(config)) grades[parsed] = config;
  }
  return grades;
}

export function withMatrix(entry: Entry, stations: Record<string, StationConfig>): Entry {
  if (entry.outroId) return entry;
  const slot = activeMatrix(stations[stationKey(entry.machine, entry.station)], entry.side);
  if (!slot) return entry;
  const numero = slot.numero.trim();
  const referencia = slot.referencia.trim();
  if (entry.matrizNumero === numero && entry.matrizRel === referencia) return entry;
  return { ...entry, matrizNumero: numero, matrizRel: referencia };
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
    outros: [],
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

function withSavedAt(config: StationConfig, raw: Record<string, unknown>): StationConfig {
  return typeof raw.salvoEm === "number" && Number.isFinite(raw.salvoEm) ? { ...config, salvoEm: raw.salvoEm } : config;
}

function readConfig(v: unknown): StationConfig | null {
  if (!isRecord(v)) return null;
  if (v.mode === "uma" || v.mode === "duas") {
    const esq = readSlot(v.esq);
    const dir = readSlot(v.dir);
    if (v.mode === "uma") {
      const lado = v.lado === "dir" ? "dir" : "esq";
      return withSavedAt(
        {
          ambos: false,
          numero: "",
          referencia: "",
          esq: lado === "esq" ? esq : emptySlot(),
          dir: lado === "dir" ? dir : emptySlot(),
        },
        v,
      );
    }
    return withSavedAt({ ambos: false, numero: "", referencia: "", esq, dir }, v);
  }
  if (typeof v.ambos !== "boolean") return null;
  return withSavedAt(
    {
      ambos: v.ambos,
      numero: typeof v.numero === "string" ? v.numero : "",
      referencia: typeof v.referencia === "string" ? v.referencia : "",
      esq: readSlot(v.esq),
      dir: readSlot(v.dir),
    },
    v,
  );
}

export function coerceEntry(v: unknown): Entry | null {
  return readEntry(v);
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
    autor: typeof v.autor === "string" ? v.autor.slice(0, 32) : "",
    outroId: typeof v.outroId === "string" ? v.outroId : "",
  };
}

export function readOutros(value: unknown): OutroMatriz[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const machine = parseMachine(item.machine);
    const turno = parseTurno(item.turno);
    if (!machine || !turno || !isSide(item.side)) return [];
    const date = typeof item.date === "string" ? item.date : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const numero = typeof item.numero === "string" ? item.numero.trim() : "";
    const referencia = typeof item.referencia === "string" ? item.referencia.trim() : "";
    if (!numero && !referencia) return [];
    const station = typeof item.station === "number" && item.station >= 1 && item.station <= 8 ? item.station : 0;
    const ambos = item.ambos === true;
    return [
      {
        id: item.id,
        date,
        turno,
        machine,
        station,
        ambos,
        side: item.side,
        numero,
        referencia,
        salvoEm: typeof item.salvoEm === "number" && Number.isFinite(item.salvoEm) ? item.salvoEm : 0,
        ...(item.excluido === true ? { excluido: true as const } : {}),
      },
    ];
  });
}

export function outroVivo(item: OutroMatriz) {
  return item.excluido !== true;
}

export function mergeOutros(local: OutroMatriz[], remote: OutroMatriz[]): OutroMatriz[] {
  const map = new Map(local.map((item) => [item.id, item]));
  for (const item of remote) {
    const prev = map.get(item.id);
    if (!prev || item.salvoEm >= prev.salvoEm) map.set(item.id, item);
  }
  return [...map.values()];
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
      outros: readOutros(data.outros),
      entries,
      date: base.date,
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

export function mergeSharedEntries(current: Entry[], incoming: Entry[], removed: string[], date: string): Entry[] {
  const drop = new Set(removed);
  const map = new Map<string, Entry>();
  for (const entry of current) {
    if (entry.date === date && drop.has(entry.id)) continue;
    map.set(entry.id, entry);
  }
  for (const entry of incoming) {
    if (entry.date === date && !drop.has(entry.id)) map.set(entry.id, entry);
  }
  return [...map.values()];
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
  outroId: string;
};

export function nomesNaFicha(state: State, machine: MachineId): string {
  const nomes = new Set<string>();
  for (const entry of shiftEntries(state, machine)) {
    const nome = entry.autor.trim();
    if (nome) nomes.add(nome);
  }
  return [...nomes].join(" · ");
}

export function fichaLines(state: State, machine: MachineId): FichaLine[] {
  const entries = shiftEntries(state, machine).filter((entry) => !entry.outroId);
  const daGrade = STATIONS.flatMap((station) => {
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
      return { machine, station, side, numero, referencia, shared, counts, outroId: "" };
    });
  });
  const deOutros = state.outros
    .filter((item) => outroVivo(item) && item.machine === machine && item.date === state.date && item.turno === state.turno)
    .flatMap((item) => {
      const lados = item.ambos ? SIDES : [item.side];
      return lados.map((side) => {
        const doItem = shiftEntries(state, machine).filter(
          (entry) => entry.outroId === item.id && entry.side === side,
        );
        const counts = PROBLEMS.map(
          (problem) => doItem.filter((entry) => entry.problem === problem.id).length,
        );
        return {
          machine,
          station: item.station,
          side,
          numero: item.numero,
          referencia: item.referencia,
          shared: item.ambos,
          counts,
          outroId: item.id,
        };
      });
    });
  return [...daGrade, ...deOutros];
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
