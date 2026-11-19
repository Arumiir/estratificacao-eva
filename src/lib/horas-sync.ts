import { diaDeHoje, MACHINES, type MachineId, type Turno } from "@/lib/perdas";

export type CaixaSync = {
  destino: "saldo" | "baixada" | null;
  date?: string;
  turno?: Turno;
  em: number;
};

export type NumeroSync = {
  id: string;
  numero: string;
  padrao: string;
  totalPares: string;
  paresCheia: string;
  modoSaldo: boolean;
  em: number;
  caixas: CaixaSync[];
};

export type ProgramaSync = {
  id: string;
  nome: string;
  documento: string;
  cor: string;
  em: number;
  numeros: NumeroSync[];
};

export type HorasDia = {
  date: string;
  em: number;
  maquinas: { id: string; programas: ProgramaSync[] }[];
  apagados: { id: string; em: number }[];
};

export function idHoras(id: string): MachineId | null {
  const direto = id.trim().toUpperCase();
  if ((MACHINES as readonly string[]).includes(direto)) return direto as MachineId;
  if (!/^\d{1,2}$/.test(direto)) return null;
  const nome = `SIE${direto.padStart(2, "0")}`;
  return (MACHINES as readonly string[]).includes(nome) ? (nome as MachineId) : null;
}

function texto(value: unknown) {
  return typeof value === "string" ? value : "";
}

function emDe(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function turnoDe(value: unknown): Turno | undefined {
  return value === "1" || value === "2" || value === "3" ? value : undefined;
}

function lerCaixa(value: unknown): CaixaSync | null {
  if (!value || typeof value !== "object") return null;
  const item = value as { destino?: unknown; date?: unknown; turno?: unknown; em?: unknown };
  const destino = item.destino === "saldo" || item.destino === "baixada" ? item.destino : null;
  if (!destino && emDe(item.em) <= 0) return null;
  return {
    destino,
    date: typeof item.date === "string" ? item.date : undefined,
    turno: turnoDe(item.turno),
    em: emDe(item.em),
  };
}

function lerNumero(value: unknown): NumeroSync | null {
  if (!value || typeof value !== "object") return null;
  const item = value as { id?: unknown; numero?: unknown; padrao?: unknown; totalPares?: unknown; paresCheia?: unknown; modoSaldo?: unknown; em?: unknown; caixas?: unknown };
  const id = texto(item.id);
  if (!id) return null;
  return {
    id,
    numero: texto(item.numero),
    padrao: texto(item.padrao),
    totalPares: texto(item.totalPares),
    paresCheia: texto(item.paresCheia),
    modoSaldo: Boolean(item.modoSaldo),
    em: emDe(item.em),
    caixas: Array.isArray(item.caixas) ? item.caixas.flatMap((caixa) => {
      const lida = lerCaixa(caixa);
      return lida ? [lida] : [];
    }) : [],
  };
}

function lerPrograma(value: unknown): ProgramaSync | null {
  if (!value || typeof value !== "object") return null;
  const item = value as { id?: unknown; nome?: unknown; documento?: unknown; cor?: unknown; em?: unknown; numeros?: unknown };
  const id = texto(item.id);
  if (!id) return null;
  return {
    id,
    nome: texto(item.nome),
    documento: texto(item.documento),
    cor: texto(item.cor),
    em: emDe(item.em),
    numeros: Array.isArray(item.numeros) ? item.numeros.flatMap((numero) => {
      const lido = lerNumero(numero);
      return lido ? [lido] : [];
    }) : [],
  };
}

export function lerHoras(value: unknown): HorasDia | null {
  if (!value || typeof value !== "object") return null;
  const item = value as { date?: unknown; em?: unknown; maquinas?: unknown; apagados?: unknown };
  const date = typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : "";
  if (!date || !Array.isArray(item.maquinas)) return null;
  return {
    date,
    em: emDe(item.em),
    maquinas: item.maquinas.flatMap((maquina) => {
      if (!maquina || typeof maquina !== "object") return [];
      const id = idHoras(texto((maquina as { id?: unknown }).id)) ?? "";
      if (!id) return [];
      const programas = Array.isArray((maquina as { programas?: unknown }).programas)
        ? (maquina as { programas: unknown[] }).programas.flatMap((programa) => {
            const lido = lerPrograma(programa);
            return lido ? [lido] : [];
          })
        : [];
      return [{ id, programas }];
    }),
    apagados: Array.isArray(item.apagados)
      ? item.apagados.flatMap((apagado) => {
          if (!apagado || typeof apagado !== "object") return [];
          const id = texto((apagado as { id?: unknown }).id);
          if (!id) return [];
          return [{ id, em: emDe((apagado as { em?: unknown }).em) }];
        })
      : [],
  };
}

function juntarCaixas(esquerda: CaixaSync[], direita: CaixaSync[]) {
  const total = Math.max(esquerda.length, direita.length);
  const lista: CaixaSync[] = [];
  for (let i = 0; i < total; i += 1) {
    const a = esquerda[i];
    const b = direita[i];
    if (!a) lista.push(b);
    else if (!b) lista.push(a);
    else lista.push(a.em >= b.em ? a : b);
  }
  return lista;
}

function juntarNumeros(novo: NumeroSync[], velho: NumeroSync[]) {
  const extra = new Map(velho.map((numero) => [numero.id, numero]));
  return novo.map((numero) => {
    const outro = extra.get(numero.id);
    if (!outro) return numero;
    const campos = numero.em >= outro.em ? numero : outro;
    return { ...campos, caixas: juntarCaixas(numero.caixas, outro.caixas) };
  });
}

function juntarApagados(esquerda: HorasDia["apagados"], direita: HorasDia["apagados"]) {
  const mapa = new Map<string, number>();
  for (const item of [...esquerda, ...direita]) mapa.set(item.id, Math.max(mapa.get(item.id) ?? 0, item.em));
  return [...mapa.entries()].map(([id, em]) => ({ id, em }));
}

export function juntarHoras(esquerda: HorasDia | null, direita: HorasDia | null): HorasDia | null {
  if (!esquerda) return direita;
  if (!direita) return esquerda;
  if (esquerda.date !== direita.date) return esquerda.em >= direita.em ? esquerda : direita;
  const apagados = juntarApagados(esquerda.apagados, direita.apagados);
  const tumulo = new Map(apagados.map((item) => [item.id, item.em]));
  const ids = [
    ...new Set(
      [...esquerda.maquinas, ...direita.maquinas].flatMap((maquina) => {
        const id = idHoras(maquina.id);
        return id ? [id] : [];
      }),
    ),
  ];
  const maquinas = ids.map((id) => {
    const a = new Map((esquerda.maquinas.find((item) => item.id === id)?.programas ?? []).map((item) => [item.id, item]));
    const b = new Map((direita.maquinas.find((item) => item.id === id)?.programas ?? []).map((item) => [item.id, item]));
    const programas: ProgramaSync[] = [];
    for (const programaId of new Set([...a.keys(), ...b.keys()])) {
      const pa = a.get(programaId);
      const pb = b.get(programaId);
      const em = Math.max(pa?.em ?? 0, pb?.em ?? 0);
      if ((tumulo.get(programaId) ?? 0) >= em && em > 0) continue;
      if ((tumulo.get(programaId) ?? 0) > 0 && !pa && !pb) continue;
      if (!pa && pb) programas.push(pb);
      else if (pa && !pb) programas.push(pa);
      else if (pa && pb) {
        const novo = pa.em >= pb.em ? pa : pb;
        const velho = pa.em >= pb.em ? pb : pa;
        programas.push({ ...novo, numeros: juntarNumeros(novo.numeros, velho.numeros) });
      }
    }
    return { id, programas };
  });
  return { date: esquerda.date, em: Math.max(esquerda.em, direita.em), maquinas, apagados };
}

export function horasVazias(date = diaDeHoje()): HorasDia {
  return {
    date,
    em: 0,
    maquinas: ["SIE01", "SIE02", "SIE03", "SIE04", "SIE05", "SIE06"].map((id) => ({ id, programas: [] })),
    apagados: [],
  };
}

const CHAVE = "horas_maquinas_v3";

export function salvarHorasLocal(dia: HorasDia | null) {
  if (!dia || typeof localStorage === "undefined") return;
  localStorage.setItem(CHAVE, JSON.stringify(dia));
}

export function lerHorasLocal(): HorasDia | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CHAVE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { date?: unknown; maquinas?: unknown };
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.date && Array.isArray(parsed.maquinas)) {
      return lerHoras({ ...parsed, date: diaDeHoje(), em: 1, apagados: [] });
    }
    return lerHoras(parsed);
  } catch {
    return null;
  }
}
