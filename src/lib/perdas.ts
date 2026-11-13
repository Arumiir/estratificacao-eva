export type Turno = "1" | "2" | "3";
export type Side = "esq" | "dir";

export type Problem = {
  id: string;
  short: string;
  name: string;
};

/** Modos da ficha de falha. O id antigo permanece quando o modo é o mesmo. */
export const PROBLEMS: readonly Problem[] = [
  { id: "alta-reticulacao", short: "Alta reticulação - bolha", name: "Alta reticulação - bolha" },
  { id: "amassado-mp", short: "Amassado (extração) - MP pegajosa", name: "Amassado (extração) - MP pegajosa" },
  { id: "baixa-reticulacao", short: "Baixa reticulação", name: "Baixa reticulação" },
  { id: "contaminacao-material", short: "Contaminação (material pegajoso)", name: "Contaminação (material pegajoso)" },
  { id: "manchas", short: "Manchas (fluidez/pigmentação)", name: "Manchas (fluidez/pigmentação)" },
  { id: "tamanho-menor", short: "Tamanho menor - variação na expansão", name: "Tamanho menor - variação na expansão" },
  { id: "tonalidade", short: "Tonalidade divergente da amostra", name: "Tonalidade divergente da amostra" },
  { id: "amassado-valvula", short: "Amassado (extração) - válvula presa/extrator", name: "Amassado (extração) - válvula presa/extrator" },
  { id: "contaminacao-molde", short: "Contaminação (molde sujo)", name: "Contaminação (molde sujo)" },
  { id: "gas-aberto", short: "Escape de gás aberto", name: "Escape de gás aberto" },
  { id: "falha-textura", short: "Falha na textura", name: "Falha na textura" },
  { id: "pezinho", short: "Pezinho/ forma presa na cavidade", name: "Pezinho/ forma presa na cavidade" },
  { id: "rebarba", short: "Rebarba", name: "Rebarba" },
  { id: "gas-sola", short: "Gás preso", name: "Gás preso" },
  { id: "peca-rasgada", short: "Peça rasgada", name: "Peça rasgada" },
  { id: "amassado-desmoldante", short: "Amassado (extração) - falta de desmoldante", name: "Amassado (extração) - falta de desmoldante" },
  { id: "cabedal-menor", short: "Cabedal menor - gáspea baixa", name: "Cabedal menor - gáspea baixa" },
  { id: "contra-pe", short: "Contra-pé", name: "Contra-pé" },
  { id: "corte-injecao", short: "Corte do ponto de injeção (baixo)", name: "Corte do ponto de injeção (baixo)" },
  { id: "excesso-carga", short: "Excesso de carga", name: "Excesso de carga" },
  { id: "falta-corpo", short: "Falta de carga", name: "Falta de carga" },
  { id: "falta-desmoldante", short: "Falta de desmoldante", name: "Falta de desmoldante" },
  { id: "sujeira", short: "Sujeira mancha (graxa, bucha, óleo)", name: "Sujeira mancha (graxa, bucha, óleo)" },
  { id: "tamanho-maior", short: "Tamanho maior - monobloco", name: "Tamanho maior - monobloco" },
  { id: "tamanho-menor-ajuste", short: "Tamanho menor - ajuste de máquina", name: "Tamanho menor - ajuste de máquina" },
  { id: "contaminacao-cor", short: "Contaminação (troca de cor)", name: "Contaminação (troca de cor)" },
  { id: "falta-energia", short: "Falta de energia", name: "Falta de energia" },
  { id: "manutencao", short: "Manutenção de máquina", name: "Manutenção de máquina" },
  { id: "contaminacao-injetor", short: "Contaminação (injetor)", name: "Contaminação (injetor)" },
  { id: "contaminacao-rabicho", short: "Contaminação (Rabicho)", name: "Contaminação (Rabicho)" },
  { id: "gas-gaspea", short: "Escape de gás preso - gáspea", name: "Escape de gás preso - gáspea" },
  { id: "contaminacao", short: "Contaminação", name: "Contaminação" },
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
  corId: string;
  corNome: string;
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

export type Cor = {
  id: string;
  date: string;
  turno: Turno;
  machine: MachineId;
  nome: string;
  stations: number[];
  grades: Record<string, StationConfig>;
  salvoEm: number;
  excluido?: boolean;
};

export type Fechamento = {
  id: string;
  date: string;
  turno: Turno;
  machine: MachineId;
  horasBaixadas: string;
  producao: number;
  saldo: string;
  setup: string;
  salvoEm: number;
};

export type ProducaoPares = {
  id: string;
  date: string;
  turno: Turno;
  machine: MachineId;
  numero: string;
  pares: number;
  salvoEm: number;
};

export type State = {
  stations: Record<string, StationConfig>;
  outros: OutroMatriz[];
  cores: Cor[];
  fechamentos: Fechamento[];
  producao: ProducaoPares[];
  entries: Entry[];
  date: string;
  turno: Turno;
  modelos: MaquinaPiso[];
  modelosEm: number;
};

export const MAQUINAS_PISO = ["SIE01", "SIE02", "SIE03", "SIE04", "SIE05", "SIE06"] as const;
export type MaquinaPiso = (typeof MAQUINAS_PISO)[number];
export const MACHINES = [
  "SIE01",
  "SIE01A",
  "SIE01B",
  "SIE02",
  "SIE02A",
  "SIE02B",
  "SIE03",
  "SIE03A",
  "SIE03B",
  "SIE04",
  "SIE04A",
  "SIE04B",
  "SIE05",
  "SIE05A",
  "SIE05B",
  "SIE06",
  "SIE06A",
  "SIE06B",
] as const;
export type MachineId = (typeof MACHINES)[number];
export const MODELOS_PADRAO: MaquinaPiso[] = ["SIE06"];
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
  if (minutes >= 6 * 60 + 31 && minutes <= 15 * 60 + 29) return "1";
  if (minutes >= 15 * 60 + 30 && minutes <= 23 * 60 + 59) return "2";
  return "3";
}

/** Minutos do dia em que cada turno pode lançar ou apagar perda. Limites inclusivos. O 3º atravessa a meia-noite. */
const JANELA_MINUTOS: Record<Turno, readonly [number, number]> = {
  "1": [6 * 60 + 31, 15 * 60 + 29],
  "2": [15 * 60 + 30, 23 * 60 + 59],
  "3": [23 * 60, 6 * 60 + 59],
};

function minutoNaJanela(turno: Turno, minutes: number): boolean {
  const [inicio, fim] = JANELA_MINUTOS[turno];
  if (inicio <= fim) return minutes >= inicio && minutes <= fim;
  return minutes >= inicio || minutes <= fim;
}

export function dentroDaJanela(turno: Turno, now = Date.now()): boolean {
  return minutoNaJanela(turno, partesFortaleza(now).minutes);
}

export function podeAlterarApontamento(
  entry: { date: string; turno: string; at: number },
  now = Date.now(),
): boolean {
  if (apontamentoBloqueado(entry)) return false;
  const agora = partesFortaleza(now);
  const dia = entry.turno === "1" || entry.turno === "2" || entry.turno === "3" ? diaOperacional(entry.turno, now) : agora.date;
  if (entry.date !== dia) return false;
  if (entry.turno !== "1" && entry.turno !== "2" && entry.turno !== "3") return false;
  return dentroDaJanela(entry.turno, now);
}

export function todayISO(now = new Date()): string {
  return partesFortaleza(now.getTime()).date;
}

/** Dia em que a produção foi colocada. Não muda de mês. */
export function diaDoApontamento(item: { date?: string }): string {
  return typeof item.date === "string" ? (item.date.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "") : "";
}

function diaAnterior(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(cursor.getUTCDate()).padStart(2, "0");
  return `${cursor.getUTCFullYear()}-${mes}-${dia}`;
}

/** 0 é domingo. A data já está no calendário de Fortaleza. */
export function diaDaSemanaISO(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return -1;
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Noite de domingo 08/11, que a fábrica conta como sábado 07/11. */
export const NOITE_DOMINGO = "2026-11-08";
export const SABADO_DA_NOITE = "2026-11-07";

/** O 3º turno atravessa a meia-noite. A noite de domingo, das 23:00 até as 06:59 de segunda, conta como sábado. */
export function diaOperacional(turno: Turno, now = Date.now()): string {
  const { date, minutes } = partesFortaleza(now);
  const dia = turno === "3" && minutes < 7 * 60 ? diaAnterior(date) : date;
  const noite = minutes >= 23 * 60 || minutes < 7 * 60;
  if (turno === "3" && noite && diaDaSemanaISO(dia) === 0) return diaAnterior(dia);
  return dia;
}

/** O dia do aplicativo vira às 07:00. De 00:00 até 06:59 ainda é o dia anterior. */
export function diaDeHoje(now = Date.now()): string {
  const { date, minutes } = partesFortaleza(now);
  if (minutes < 7 * 60) return diaAnterior(date);
  return date;
}

/** Matriz única deixa de pedir lado a partir do 1º turno deste dia, às 07:00. */
export const MATRIZ_UNICA_DESDE = "2026-11-10";

export function matrizUnicaNoDia(date: string, ambos: boolean | undefined): boolean {
  return Boolean(ambos) && date >= MATRIZ_UNICA_DESDE;
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

const NOMES_MES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** Do dia 1 do mês até a data. Novembro não puxa outubro. */
export function diasDoMes(ate: string): string[] {
  const [year, month, day] = ate.split("-").map(Number);
  if (!year || !month || !day) return [];
  const mes = String(month).padStart(2, "0");
  const dias: string[] = [];
  for (let dia = 1; dia <= day; dia += 1) {
    dias.push(`${year}-${mes}-${String(dia).padStart(2, "0")}`);
  }
  return dias;
}

export function nomeMes(ate: string): string {
  const month = Number(ate.slice(5, 7));
  return NOMES_MES[month - 1] ?? "Mês";
}

/** Do dia 1º de janeiro até a data. */
export function diasDoAno(ate: string): string[] {
  const year = ate.slice(0, 4);
  if (!/^\d{4}$/.test(year) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) return [];
  const dias: string[] = [];
  const cursor = new Date(Date.UTC(Number(year), 0, 1));
  const fim = new Date(Date.UTC(Number(ate.slice(0, 4)), Number(ate.slice(5, 7)) - 1, Number(ate.slice(8, 10))));
  for (let guarda = 0; guarda < 366 && cursor <= fim; guarda += 1) {
    const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const dia = String(cursor.getUTCDate()).padStart(2, "0");
    dias.push(`${cursor.getUTCFullYear()}-${mes}-${dia}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

/** Semana corrente, de segunda até a data, sem dia do mês anterior. */
export function diasDaSemana(ate: string): string[] {
  const [year, month, day] = ate.split("-").map(Number);
  if (!year || !month || !day) return [];
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const weekday = cursor.getUTCDay();
  const desdeSegunda = weekday === 0 ? 6 : weekday - 1;
  const inicio = new Date(cursor);
  inicio.setUTCDate(cursor.getUTCDate() - desdeSegunda);
  const primeiro = new Date(Date.UTC(year, month - 1, 1));
  if (inicio < primeiro) inicio.setTime(primeiro.getTime());
  const dias: string[] = [];
  for (const item = new Date(inicio); item <= cursor; item.setUTCDate(item.getUTCDate() + 1)) {
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

export function parseMachine(value: unknown): MachineId | null {
  if (typeof value === "number" && Number.isInteger(value)) return legacyMachine(String(value));
  if (typeof value !== "string") return null;
  if ((MACHINES as readonly string[]).includes(value)) return value as MachineId;
  return legacyMachine(value);
}

export function maquinaBase(machine: MachineId): MaquinaPiso {
  if ((MAQUINAS_PISO as readonly string[]).includes(machine)) return machine as MaquinaPiso;
  return machine.slice(0, -1) as MaquinaPiso;
}

export function variantesDe(base: MaquinaPiso): [MachineId, MachineId] {
  return [`${base}A`, `${base}B`];
}

export function readModelos(value: unknown): { machines: MaquinaPiso[]; salvoEm: number } | null {
  if (!isRecord(value)) return null;
  const salvoEm = typeof value.salvoEm === "number" && Number.isFinite(value.salvoEm) ? value.salvoEm : 0;
  if (!Array.isArray(value.machines) || salvoEm <= 0) return null;
  const machines = [...new Set(value.machines.flatMap((item) => ((MAQUINAS_PISO as readonly string[]).includes(String(item)) ? [item as MaquinaPiso] : [])))];
  return { machines, salvoEm };
}

export function maquinasDoFiltro(modelos: readonly MaquinaPiso[], comDado: Iterable<MachineId> = []): MachineId[] {
  const ligados = new Set(modelos);
  const lista: MachineId[] = [];
  for (const base of MAQUINAS_PISO) {
    if (ligados.has(base)) lista.push(...variantesDe(base));
    else lista.push(base);
  }
  const ja = new Set(lista);
  for (const machine of comDado) {
    if (ja.has(machine) || !(MACHINES as readonly string[]).includes(machine)) continue;
    lista.push(machine);
    ja.add(machine);
  }
  return lista;
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
      return "SIE05";
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

/** Mantém só dígitos e barra. "33/4" e "39/0" viram "33/34" e "39/40". */
export function numeroLimpo(valor: string): string {
  const bruto = valor.replace(/[^\d/]/g, "");
  const limpo = bruto.replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  if (!/\d/.test(limpo)) return "";
  const partes = limpo.split("/");
  if (partes.length !== 2) return limpo;
  const [esquerda, direitaBruta] = partes;
  if (!esquerda || !direitaBruta) return limpo;
  const direita = String(Number(direitaBruta));
  const base = String(Number(esquerda));
  if (direita.length >= base.length) return `${base}/${direita}`;
  const seguinte = String(Number(base) + 1);
  return seguinte.endsWith(direita) ? `${base}/${seguinte}` : `${base}/${direita}`;
}

/** "01", "001" e "1" são a mesma referência. Texto que não é só número fica como está. */
export function referenciaLimpa(valor: string): string {
  const texto = valor.trim();
  if (!/^\d+$/.test(texto)) return texto;
  return texto.replace(/^0+/, "") || "0";
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
  const numero = numeroLimpo(slot.numero);
  if (!numero) return null;
  return { numero, referencia: referenciaLimpa(slot.referencia) };
}

export function describeMatrix(config: StationConfig | undefined, side: Side): string {
  const slot = activeMatrix(config, side);
  if (!slot) return "";
  const numero = slot.numero.trim();
  const referencia = referenciaLimpa(slot.referencia);
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
  if (entry.outroId || entry.corId) return entry;
  const slot = activeMatrix(stations[stationKey(entry.machine, entry.station)], entry.side);
  if (!slot) return entry;
  const numero = slot.numero.trim();
  const referencia = referenciaLimpa(slot.referencia);
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
    cores: [],
    fechamentos: [],
    producao: [],
    entries: [],
    date: todayISO(now),
    turno: "1",
    modelos: [...MODELOS_PADRAO],
    modelosEm: 0,
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
    referencia: referenciaLimpa(referencia),
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
    matrizRel: typeof v.matrizRel === "string" ? referenciaLimpa(v.matrizRel) : "",
    autor: typeof v.autor === "string" ? v.autor.slice(0, 32) : "",
    outroId: typeof v.outroId === "string" ? v.outroId : "",
    corId: typeof v.corId === "string" ? v.corId : "",
    corNome: typeof v.corNome === "string" ? v.corNome.slice(0, 40) : "",
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
    const referencia = typeof item.referencia === "string" ? referenciaLimpa(item.referencia) : "";
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

export function corViva(item: Cor) {
  return item.excluido !== true;
}

export function readCores(value: unknown): Cor[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const machine = parseMachine(item.machine);
    const turno = parseTurno(item.turno);
    const date = typeof item.date === "string" ? item.date : "";
    const nome = typeof item.nome === "string" ? item.nome.trim().slice(0, 40) : "";
    if (!machine || !turno || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !nome) return [];
    const stations = Array.isArray(item.stations)
      ? [...new Set(item.stations.filter((station) => typeof station === "number" && station >= 1 && station <= 8))]
      : [];
    if (stations.length === 0) return [];
    const grades: Record<string, StationConfig> = {};
    if (isRecord(item.grades)) {
      for (const [key, raw] of Object.entries(item.grades)) {
        const station = Number(key);
        const config = readConfig(raw);
        if (station >= 1 && station <= 8 && config) grades[String(station)] = config;
      }
    }
    return [
      {
        id: item.id,
        date,
        turno,
        machine,
        nome,
        stations,
        grades,
        salvoEm: typeof item.salvoEm === "number" && Number.isFinite(item.salvoEm) ? item.salvoEm : 0,
        ...(item.excluido === true ? { excluido: true as const } : {}),
      },
    ];
  });
}

export function mergeCores(local: Cor[], remote: Cor[]): Cor[] {
  const map = new Map(local.map((item) => [item.id, item]));
  for (const item of remote) {
    const prev = map.get(item.id);
    if (!prev || item.salvoEm >= prev.salvoEm) map.set(item.id, item);
  }
  return [...map.values()];
}

function horaCurta(value: unknown) {
  if (typeof value !== "string") return "";
  const texto = value.trim().slice(0, 16);
  const match = texto.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return texto;
  const hora = Number(match[1]);
  const minuto = Number(match[2]);
  if (hora > 99 || minuto > 59) return texto;
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

export function readFechamentos(value: unknown): Fechamento[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const machine = parseMachine(item.machine);
    const turno = parseTurno(item.turno);
    const date = typeof item.date === "string" ? item.date : "";
    if (!machine || !turno || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const producao = typeof item.producao === "number" && Number.isFinite(item.producao) ? Math.max(0, Math.round(item.producao)) : 0;
    const setup = typeof item.setup === "string" ? item.setup.trim().slice(0, 80) : "";
    return [
      {
        id: `${date}|${turno}|${machine}`,
        date,
        turno,
        machine,
        horasBaixadas: horaCurta(item.horasBaixadas),
        producao,
        saldo: horaCurta(item.saldo),
        setup,
        salvoEm: typeof item.salvoEm === "number" && Number.isFinite(item.salvoEm) ? item.salvoEm : 0,
      },
    ];
  });
}

export function mergeFechamentos(local: Fechamento[], remote: Fechamento[]): Fechamento[] {
  const map = new Map(local.map((item) => [item.id, item]));
  for (const item of remote) {
    const prev = map.get(item.id);
    if (!prev || item.salvoEm >= prev.salvoEm) map.set(item.id, item);
  }
  return [...map.values()];
}

export function readProducao(value: unknown): ProducaoPares[] {
  const lista = comoLista(value);
  return lista.flatMap((item) => {
    if (!isRecord(item)) return [];
    const machine = parseMachine(item.machine);
    const turnoBruto = typeof item.turno === "number" ? String(item.turno) : item.turno;
    const turno = parseTurno(turnoBruto);
    const date = diaDoApontamento({ date: typeof item.date === "string" ? item.date : "" });
    const numero = numeroLimpo(typeof item.numero === "string" ? item.numero : String(item.numero ?? ""));
    if (!machine || !turno || !numero || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const paresBrutos = typeof item.pares === "number" ? item.pares : Number(item.pares);
    const pares = Number.isFinite(paresBrutos) ? Math.max(0, Math.floor(paresBrutos)) : 0;
    return [
      {
        id: `${date}|${turno}|${machine}|${numero}`,
        date,
        turno,
        machine,
        numero,
        pares,
        salvoEm: typeof item.salvoEm === "number" && Number.isFinite(item.salvoEm) ? item.salvoEm : 0,
      },
    ];
  });
}

function comoLista(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      return comoLista(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object") return [];
  const registro = value as Record<string, unknown>;
  if (Array.isArray(registro.producao)) return registro.producao;
  const valores = Object.values(registro);
  if (valores.length > 0 && valores.every((item) => item && typeof item === "object")) return valores;
  return [];
}

/** Junta as duas listas. Um zero mais novo não esconde um par já apontado. */
export function unirProducao(remota: ProducaoPares[], local: ProducaoPares[]): ProducaoPares[] {
  const map = new Map<string, ProducaoPares>();
  for (const item of [...remota, ...local]) {
    if (item.pares <= 0) continue;
    const prev = map.get(item.id);
    if (!prev || item.salvoEm >= prev.salvoEm) map.set(item.id, item);
  }
  return [...map.values()];
}

export function mergeProducao(local: ProducaoPares[], remote: ProducaoPares[]): ProducaoPares[] {
  const map = new Map(local.map((item) => [item.id, item]));
  for (const item of remote) {
    const prev = map.get(item.id);
    if (!prev || item.salvoEm >= prev.salvoEm) map.set(item.id, item);
  }
  return [...map.values()];
}

export function coresDaMaquina(state: State, machine: MachineId): Cor[] {
  return state.cores.filter(
    (item) => corViva(item) && item.machine === machine && item.date === state.date && item.turno === state.turno,
  );
}

export function gradeDaCor(state: State, corId: string, station: number): StationConfig | undefined {
  const cor = state.cores.find((item) => item.id === corId);
  return cor?.grades[String(station)] ?? state.stations[stationKey(cor?.machine ?? "SIE01", station)];
}

function aplicarSlot(entry: Entry, slot: { numero: string; referencia: string } | null | undefined, corNome?: string): Entry {
  const numero = numeroLimpo(slot?.numero ?? entry.matrizNumero);
  const referencia = numero ? referenciaLimpa(slot?.referencia ?? entry.matrizRel) : "";
  const nome = corNome ?? entry.corNome;
  if (entry.matrizNumero === numero && entry.matrizRel === referencia && entry.corNome === nome) return entry;
  return { ...entry, matrizNumero: numero, matrizRel: referencia, corNome: nome };
}

export function aplicarMatriz(entry: Entry, state: State): Entry {
  if (entry.outroId) return entry;
  if (entry.corId) {
    const cor = state.cores.find((item) => item.id === entry.corId);
    const slot = activeMatrix(cor?.grades[String(entry.station)], entry.side);
    return aplicarSlot(entry, slot, cor?.nome || entry.corNome);
  }
  return withMatrix(entry, state.stations);
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
    const modelos = readModelos({ machines: data.modelos, salvoEm: data.modelosEm });
    return {
      stations,
      outros: readOutros(data.outros),
      cores: readCores(data.cores),
      fechamentos: readFechamentos(data.fechamentos),
      producao: readProducao(data.producao),
      entries,
      date: base.date,
      turno: parseTurno(data.turno) ?? base.turno,
      modelos: modelos?.machines ?? base.modelos,
      modelosEm: modelos?.salvoEm ?? 0,
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
  unica?: boolean;
  counts: number[];
  outroId: string;
  cor: string;
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
    const doPosto = entries.filter((entry) => entry.station === station);
    if (matrizUnicaNoDia(state.date, shared)) {
      const slot = activeMatrix(config, "esq");
      let numero = slot?.numero ?? "";
      let referencia = slot ? referenciaLimpa(slot.referencia) : "";
      if (!numero) {
        const latest = [...doPosto].sort((a, b) => b.at - a.at)[0];
        numero = numeroLimpo(latest?.matrizNumero ?? "");
        referencia = numero ? referenciaLimpa(latest?.matrizRel ?? "") : "";
      }
      const counts = PROBLEMS.map((problem) => doPosto.filter((entry) => entry.problem === problem.id).length);
      return [{ machine, station, side: "esq" as const, numero, referencia, shared: false, unica: true, counts, outroId: "", cor: "" }];
    }
    return SIDES.map((side) => {
            const slot = activeMatrix(config, side);
            let numero = slot?.numero ?? "";
            let referencia = slot ? referenciaLimpa(slot.referencia) : "";
            const doLado = entries.filter((entry) => entry.station === station && entry.side === side);
            if (!numero) {
              const latest = [...doLado].sort((a, b) => b.at - a.at)[0];
              numero = numeroLimpo(latest?.matrizNumero ?? "");
              referencia = numero ? referenciaLimpa(latest?.matrizRel ?? "") : "";
            }
            const counts = PROBLEMS.map(
              (problem) => doLado.filter((entry) => entry.problem === problem.id).length,
            );
            return { machine, station, side, numero, referencia, shared, counts, outroId: "", cor: "" };
    });
  });
  const deOutros = state.outros
    .filter((item) => outroVivo(item) && item.machine === machine && item.date === state.date && item.turno === state.turno)
    .flatMap((item) => {
      const doItem = shiftEntries(state, machine).filter((entry) => entry.outroId === item.id);
      const numero = numeroLimpo(item.numero);
      const referencia = numero ? referenciaLimpa(item.referencia) : "";
      if (matrizUnicaNoDia(state.date, item.ambos)) {
        const counts = PROBLEMS.map((problem) => doItem.filter((entry) => entry.problem === problem.id).length);
        return [{
          machine,
          station: item.station,
          side: "esq" as const,
          numero,
          referencia,
          shared: false,
          unica: true,
          counts,
          outroId: item.id,
          cor: "",
        }];
      }
      const lados = item.ambos ? SIDES : [item.side];
      return lados.map((side) => {
        const counts = PROBLEMS.map(
          (problem) => doItem.filter((entry) => entry.problem === problem.id && entry.side === side).length,
        );
        return {
          machine,
          station: item.station,
          side,
          numero,
          referencia,
          shared: item.ambos,
          counts,
          outroId: item.id,
          cor: "",
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
        line.unica ? "" : SIDE_LABEL[line.side],
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
