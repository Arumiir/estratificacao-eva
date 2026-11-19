import { useEffect, useRef, useState } from "react";
import { Plus, Pencil, Trash2, ChevronDown, Clock, Check, Box } from "lucide-react";
import { NUMEROS_MATRIZ, TURNO_LABEL, diaDasHoras, diaOperacional, formatDateBR, maquinasDoFiltro, numeroLimpo, turnoPeloRelogio, type MachineId, type MaquinaPiso, type Turno } from "@/lib/perdas";
import { horasVazias, idHoras, juntarHoras, lerHorasLocal, salvarHorasLocal, type HorasDia } from "@/lib/horas-sync";

type Destino = "saldo" | "baixada";
type Caixa = { destino: Destino | null; date?: string; turno?: Turno; em?: number };

type Numero = {
  id: string;
  numero: string;
  padrao: string;
  totalPares: string;
  paresCheia: string;
  marcadas: boolean[];
  caixas?: (Caixa | Destino | null)[];
  modoSaldo?: boolean;
  em?: number;
};

type Programa = {
  id: string;
  nome: string;
  documento: string;
  cor: string;
  ordem: number;
  saldoAntes: boolean;
  numeros: Numero[];
  em?: number;
};

type Maquina = {
  id: string;
  nome: string;
  saldo: number;
  programas: Programa[];
};

type Data = {
  date?: string;
  maquinas: Maquina[];
  apagados?: { id: string; em: number }[];
};

export function formatHours(h: number): string {
  if (isNaN(h) || h < 0) return "00:00";
  const t = Math.round(h * 60);
  return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
}

function parseNum(s: string): number {
  return s ? parseFloat(String(s).replace(",", ".")) || 0 : 0;
}

function lerCaixa(bruto: Caixa | Destino | null | undefined, marcada = false): Caixa | null {
  if (bruto === "saldo" || bruto === "baixada") return { destino: bruto };
  if (bruto && typeof bruto === "object" && (bruto.destino === "saldo" || bruto.destino === "baixada" || bruto.destino === null)) return bruto;
  return marcada ? { destino: "baixada" } : null;
}

function destinoCaixa(num: Numero, index: number): Destino | null {
  return lerCaixa(num.caixas?.[index], !num.caixas && Boolean(num.marcadas?.[index]))?.destino ?? null;
}

function caixasDe(num: Numero): (Caixa | null)[] {
  const total = calcNumber(num).totalCaixas;
  if (!num.caixas) {
    return Array.from({ length: total }, (_, index) => (num.marcadas?.[index] ? { destino: "baixada" } : null));
  }
  const lista = num.caixas.slice(0, total).map((item) => lerCaixa(item));
  while (lista.length < total) lista.push(null);
  return lista;
}

function calcNumber(num: Numero, conta?: (caixa: Caixa | null) => boolean) {
  const totalPares = parseNum(num.totalPares);
  const paresCheia = parseNum(num.paresCheia);
  const padrao = parseNum(num.padrao);
  const qtdCheias = paresCheia > 0 ? Math.floor(totalPares / paresCheia) : 0;
  const ultima = paresCheia > 0 ? totalPares % paresCheia : 0;
  const totalCaixas = qtdCheias + (ultima > 0 ? 1 : 0);
  const totalHoras = padrao > 0 ? totalPares / padrao : 0;
  let paresSaldo = 0;
  let paresBaixada = 0;
  for (let i = 0; i < totalCaixas; i++) {
    const caixa = lerCaixa(num.caixas?.[i], !num.caixas && Boolean(num.marcadas?.[i]));
    if (conta && !conta(caixa)) continue;
    const pares = i < qtdCheias ? paresCheia : ultima;
    if (caixa?.destino === "saldo") paresSaldo += pares;
    if (caixa?.destino === "baixada") paresBaixada += pares;
  }
  const horasSaldo = padrao > 0 ? paresSaldo / padrao : 0;
  const horasBaixadas = padrao > 0 ? paresBaixada / padrao : 0;
  const horasProduzidas = horasSaldo + horasBaixadas;
  const restante = Math.max(0, totalHoras - horasProduzidas);
  const restanteHora = Math.max(0, totalHoras - horasBaixadas);
  return { totalHoras, horasProduzidas, horasSaldo, horasBaixadas, restante, restanteHora, totalCaixas, paresCheia, ultima, qtdCheias, totalPares };
}

function calcProgram(prog: Programa, conta?: (caixa: Caixa | null) => boolean) {
  const numeros = prog.numeros || [];
  const contas = numeros.map((numero) => ({ numero, conta: calcNumber(numero, conta) }));
  let maxTotal = 0;
  let maxRestanteHora = 0;
  let atrasado: { numero: string; restante: number } | null = null;
  for (const item of contas) {
    if (item.conta.totalHoras > maxTotal) maxTotal = item.conta.totalHoras;
    if (item.conta.restanteHora > maxRestanteHora) maxRestanteHora = item.conta.restanteHora;
    if (item.conta.restante > (atrasado?.restante ?? -1)) {
      atrasado = { numero: item.numero.numero, restante: item.conta.restante };
    }
  }
  const lider = atrasado;
  if (lider && contas.every((item) => Math.round(item.conta.restante * 60) === Math.round(lider.restante * 60))) {
    atrasado = null;
  }
  let saldoNumero: { numero: string; horas: number; restante: number } | null = null;
  for (const item of contas) {
    if (item.conta.horasSaldo <= 0) continue;
    if (!saldoNumero || item.conta.horasSaldo > saldoNumero.horas) {
      saldoNumero = { numero: item.numero.numero, horas: item.conta.horasSaldo, restante: item.conta.restante };
    }
  }
  const desconto = saldoNumero && atrasado && atrasado.numero !== saldoNumero.numero
    ? Math.max(0, atrasado.restante - saldoNumero.restante)
    : 0;
  const saldo = saldoNumero ? Math.max(0, saldoNumero.horas - desconto) : 0;
  return {
    produzidas: Math.max(0, maxTotal - maxRestanteHora),
    saldo,
    segurando: saldoNumero ? { numero: saldoNumero.numero, restante: saldo } : null,
    atrasado,
    concluido: numeros.length > 0 && numeros.every((numero) => calcNumber(numero).restante <= 0.01),
  };
}

function totaisMaquina(m: Maquina) {
  let hb = 0;
  let sd = 0;
  let maxRest = 0;
  let atrasado: { numero: string; restante: number } | null = null;
  for (const p of m.programas || []) {
    const c = calcProgram(p);
    hb += c.produzidas;
    sd += c.saldo;
    if (c.atrasado && c.atrasado.restante > maxRest) {
      maxRest = c.atrasado.restante;
      atrasado = c.atrasado;
    }
  }
  return { hb, sd, atrasado };
}

export function lerHorasTurno(date: string, turno: Turno): Record<string, { hb: number; sd: number }> {
  const guardado = lerHorasLocal();
  if (!guardado) return {};
  const mapa: Record<string, { hb: number; sd: number }> = {};
  for (const maquina of guardado.maquinas) {
    let hb = 0;
    let sd = 0;
    for (const programa of maquina.programas) {
      const conta = calcProgram(
        {
          ...programa,
          numeros: programa.numeros.map((numero) => ({
            ...numero,
            marcadas: numero.caixas.map((caixa) => Boolean(caixa?.destino)),
          })),
        },
        (caixa) => Boolean(caixa?.destino && caixa.date === date && caixa.turno === turno),
      );
      hb += conta.produzidas;
      sd += conta.saldo;
    }
    if (hb > 0 || sd > 0) {
      const nome = idHoras(maquina.id);
      if (nome) mapa[nome] = { hb, sd };
    }
  }
  return mapa;
}

function initMaquinas(data: Data): Data {
  const mapa = new Map<string, Maquina>();
  for (const maquina of data.maquinas ?? []) {
    const id = idHoras(maquina.id);
    if (!id) continue;
    const anterior = mapa.get(id);
    mapa.set(id, {
      ...maquina,
      id,
      nome: id,
      programas: [...(anterior?.programas ?? []), ...(maquina.programas ?? [])],
    });
  }
  return { ...data, maquinas: [...mapa.values()] };
}

function dadosDe(dia: HorasDia): Data {
  return initMaquinas({
    date: dia.date,
    apagados: dia.apagados,
    maquinas: dia.maquinas.map((maquina) => ({
      id: idHoras(maquina.id) ?? maquina.id,
      nome: idHoras(maquina.id) ?? maquina.id,
      saldo: 0,
      programas: maquina.programas.map((programa) => ({
        id: programa.id,
        nome: programa.nome,
        documento: programa.documento,
        cor: programa.cor,
        ordem: programa.ordem,
        saldoAntes: programa.saldoAntes,
        em: programa.em,
        numeros: programa.numeros.map((numero) => ({
          id: numero.id,
          numero: numero.numero,
          padrao: numero.padrao,
          totalPares: numero.totalPares,
          paresCheia: numero.paresCheia,
          modoSaldo: numero.modoSaldo,
          em: numero.em,
          marcadas: numero.caixas.map((caixa) => Boolean(caixa.destino)),
          caixas: numero.caixas.map((caixa) => ({ destino: caixa.destino, date: caixa.date, turno: caixa.turno, em: caixa.em })),
        })),
      })),
    })),
  });
}

function paraDia(origem: Data): HorasDia {
  const base = horasVazias(origem.date || diaDasHoras());
  const ids = new Set<string>(base.maquinas.map((maquina) => maquina.id));
  for (const maquina of origem.maquinas) {
    const id = idHoras(maquina.id);
    if (id) ids.add(id);
  }
  let em = 0;
  const maquinas = [...ids].map((id) => {
    const local = origem.maquinas.find((item) => idHoras(item.id) === id);
    return {
      id,
      programas: (local?.programas ?? []).map((programa) => {
        em = Math.max(em, programa.em ?? 0);
        return {
          id: programa.id,
          nome: programa.nome,
          documento: programa.documento,
          cor: programa.cor,
          ordem: programa.ordem,
          saldoAntes: programa.saldoAntes,
          em: programa.em ?? 0,
          numeros: (programa.numeros ?? []).map((numero) => {
            em = Math.max(em, numero.em ?? 0);
            return {
              id: numero.id,
              numero: numero.numero,
              padrao: numero.padrao,
              totalPares: numero.totalPares,
              paresCheia: numero.paresCheia,
              modoSaldo: Boolean(numero.modoSaldo),
              em: numero.em ?? 0,
              caixas: caixasDe(numero).map((caixa) => {
                em = Math.max(em, caixa?.em ?? 0);
                return { destino: caixa?.destino ?? null, date: caixa?.date, turno: caixa?.turno, em: caixa?.em ?? 0 };
              }),
            };
          }),
        };
      }),
    };
  });
  for (const apagado of origem.apagados ?? []) em = Math.max(em, apagado.em);
  return { date: base.date, em, maquinas, apagados: origem.apagados ?? [] };
}

function carimbar(antes: Data, depois: Data): Data {
  const now = Date.now();
  const apagados = [...(depois.apagados ?? antes.apagados ?? [])];
  const maquinas = depois.maquinas.map((maquina) => {
    const velha = antes.maquinas.find((item) => item.id === maquina.id);
    const idsNovos = new Set((maquina.programas ?? []).map((programa) => programa.id));
    for (const programa of velha?.programas ?? []) {
      if (!idsNovos.has(programa.id)) apagados.push({ id: programa.id, em: now });
    }
    return {
      ...maquina,
      programas: (maquina.programas ?? []).map((programa) => {
        const antiga = velha?.programas.find((item) => item.id === programa.id);
        const estrutura =
          !antiga || antiga.nome !== programa.nome || antiga.documento !== programa.documento || antiga.cor !== programa.cor || antiga.ordem !== programa.ordem || antiga.saldoAntes !== programa.saldoAntes || antiga.numeros.length !== programa.numeros.length;
        return {
          ...programa,
          em: estrutura ? now : programa.em ?? antiga?.em ?? now,
          numeros: programa.numeros.map((numero) => {
            const antigo = antiga?.numeros.find((item) => item.id === numero.id);
            const mudou =
              !antigo ||
              antigo.numero !== numero.numero ||
              antigo.padrao !== numero.padrao ||
              antigo.totalPares !== numero.totalPares ||
              antigo.paresCheia !== numero.paresCheia ||
              Boolean(antigo.modoSaldo) !== Boolean(numero.modoSaldo);
            return { ...numero, em: mudou ? now : numero.em ?? antigo?.em ?? 0 };
          }),
        };
      }),
    };
  });
  return { ...depois, date: diaDasHoras(), maquinas, apagados };
}

function nomeLimpo(nome: string) {
  return nome.replace(/\s*\(\s*\d+\s*º\s*prog\.?\s*\)\s*$/i, "").trim();
}

function ordemPrograma(programa: Programa) {
  if (programa.ordem > 0) return programa.ordem;
  const achado = programa.nome.match(/(\d+)\s*º/);
  return achado ? Number(achado[1]) : 99;
}

function tituloPrograma(programa: Programa) {
  const base = nomeLimpo(programa.nome) || programa.nome || "Programa";
  if (programa.saldoAntes) return base;
  const ordem = ordemPrograma(programa);
  return ordem < 99 ? `${base} (${ordem}º prog.)` : base;
}

function ordenarNumeros(numeros: Numero[]) {
  return [...numeros].sort((a, b) => {
    const ia = NUMEROS_MATRIZ.indexOf(a.numero as (typeof NUMEROS_MATRIZ)[number]);
    const ib = NUMEROS_MATRIZ.indexOf(b.numero as (typeof NUMEROS_MATRIZ)[number]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

function progressoPrograma(programa: Programa) {
  let total = 0;
  let verde = 0;
  let ambar = 0;
  for (const numero of programa.numeros || []) {
    const conta = calcNumber(numero);
    total += conta.totalHoras;
    verde += conta.horasBaixadas;
    ambar += conta.horasSaldo;
  }
  return {
    verde: total > 0 ? Math.min(100, (verde / total) * 100) : 0,
    ambar: total > 0 ? Math.min(100, (ambar / total) * 100) : 0,
  };
}

function assinatura(dia: HorasDia) {
  return JSON.stringify({ maquinas: dia.maquinas, apagados: dia.apagados });
}

export function AcompanhamentoHoras({
  aoVoltar,
  onProducao,
  enviarProducao,
  remoto,
  onGravar,
  modelos,
}: {
  aoVoltar: { current: (() => boolean) | null };
  onProducao: (machine: MachineId, numero: string, pares: number, date: string, turno: Turno) => void;
  enviarProducao: boolean;
  remoto: HorasDia | null;
  onGravar: (dia: HorasDia) => void;
  modelos: readonly MaquinaPiso[];
}) {
  const [turnoAtivo, setTurnoAtivo] = useState<Turno>(() => turnoPeloRelogio());
  const dia = diaOperacional(turnoAtivo);
  const [data, setData] = useState<Data>({ maquinas: [] });
  const [screen, setScreen] = useState<"home" | "maq" | "prog">("home");
  const [currentMaqId, setCurrentMaqId] = useState<string | null>(null);
  const [currentProgId, setCurrentProgId] = useState<string | null>(null);
  const [openNums, setOpenNums] = useState<Set<string>>(new Set());
  const [modalProg, setModalProg] = useState<{ editId: string | null } | null>(null);
  const [modalNum, setModalNum] = useState<{ editId: string | null } | null>(null);
  const [numeroEscolhido, setNumeroEscolhido] = useState("");
  const [pergunta, setPergunta] = useState<{ numId: string; idx: number; atual: Destino } | null>(null);
  const [apagar, setApagar] = useState<{ tipo: "programa" } | { tipo: "numero"; id: string } | null>(null);
  const [aviso, setAviso] = useState("");

  aoVoltar.current = () => {
    if (pergunta) {
      setPergunta(null);
      return true;
    }
    if (apagar) {
      setApagar(null);
      return true;
    }
    if (modalNum) {
      setModalNum(null);
      return true;
    }
    if (modalProg) {
      setModalProg(null);
      return true;
    }
    if (screen === "prog") {
      setScreen("maq");
      return true;
    }
    if (screen === "maq") {
      setScreen("home");
      return true;
    }
    return false;
  };
  useEffect(() => {
    return () => {
      aoVoltar.current = null;
    };
  }, [aoVoltar]);

  useEffect(() => {
    const hoje = diaDasHoras();
    const local = lerHorasLocal();
    setData(dadosDe(local && local.date === hoje ? local : horasVazias(hoje)));
  }, []);

  useEffect(() => {
    if (!remoto || remoto.date !== diaDasHoras()) return;
    setData((atual) => {
      if (!atual.maquinas.length) return atual;
      const junto = juntarHoras(paraDia(atual), remoto);
      if (!junto || assinatura(junto) === assinatura(paraDia(atual))) return atual;
      return dadosDe(junto);
    });
  }, [remoto]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const hoje = diaDasHoras();
      setData((atual) => (atual.date === hoje ? atual : dadosDe(horasVazias(hoje))));
    }, 30000);
    return () => window.clearInterval(id);
  }, []);

  const enviado = useRef(false);
  useEffect(() => {
    if (!data.maquinas.length || enviado.current) return;
    enviado.current = true;
    const maquinas = data.maquinas.map((maquina) => ({
      ...maquina,
      programas: (maquina.programas || []).map((programa) => ({
        ...programa,
        numeros: (programa.numeros || []).map((numero) => {
          const caixas = caixasDe(numero).map((caixa) =>
            caixa && (caixa.destino === "baixada" || caixa.destino === "saldo") && (!caixa.date || !caixa.turno)
              ? { destino: caixa.destino, date: dia, turno: turnoAtivo }
              : caixa,
          );
          return { ...numero, caixas, marcadas: caixas.map((caixa) => Boolean(caixa?.destino)) };
        }),
      })),
    }));
    setData((atual) => ({ ...atual, maquinas }));
    onGravar(paraDia({ ...data, date: diaDasHoras(), maquinas }));
    for (const maquina of maquinas) {
      const nome = idHoras(maquina.id);
      if (!nome || !enviarProducao) continue;
      for (const item of somasDe(maquina).values()) {
        if (item.pares <= 0) continue;
        onProducao(nome, item.numero, Math.floor(item.pares), item.date, item.turno);
      }
    }
  }, [data, dia, turnoAtivo, onProducao, enviarProducao]);

  useEffect(() => {
    if (!data.maquinas.length || data.date !== diaDasHoras()) return;
    salvarHorasLocal(paraDia(data));
  }, [data]);

  const maq = data.maquinas.find((m) => m.id === currentMaqId);
  const prog = maq?.programas.find((p) => p.id === currentProgId);

  function updateMaq(id: string, updater: (m: Maquina) => Maquina) {
    setData((d) => {
      const existe = d.maquinas.some((m) => m.id === id);
      const base = existe ? d.maquinas : [...d.maquinas, { id, nome: id, saldo: 0, programas: [] }];
      const next = carimbar(d, {
        ...d,
        maquinas: base.map((m) => (m.id === id ? updater(m) : m)),
      });
      onGravar(paraDia(next));
      return next;
    });
  }

  function somasDe(m: Maquina) {
    const mapa = new Map<string, { date: string; turno: Turno; numero: string; pares: number }>();
    for (const programa of m.programas || []) {
      for (const numero of programa.numeros || []) {
        const limpo = numeroLimpo(numero.numero);
        if (!limpo) continue;
        const conta = calcNumber(numero);
        const caixas = caixasDe(numero);
        for (let i = 0; i < conta.totalCaixas; i++) {
          const caixa = caixas[i];
          if (caixa?.destino !== "baixada" || !caixa.date || !caixa.turno) continue;
          const pares = i < conta.qtdCheias ? conta.paresCheia : conta.ultima;
          const chave = `${caixa.date}|${caixa.turno}|${limpo}`;
          const atual = mapa.get(chave) ?? { date: caixa.date, turno: caixa.turno, numero: limpo, pares: 0 };
          atual.pares += pares;
          mapa.set(chave, atual);
        }
      }
    }
    return mapa;
  }

  function publicarDiff(antes: Maquina, depois: Maquina) {
    if (!enviarProducao) return;
    const origem = somasDe(antes);
    const final = somasDe(depois);
    for (const chave of new Set([...origem.keys(), ...final.keys()])) {
      const paresAntes = origem.get(chave)?.pares ?? 0;
      const item = final.get(chave) ?? origem.get(chave);
      const pares = final.get(chave)?.pares ?? 0;
      if (!item || pares === paresAntes) continue;
      const nome = idHoras(depois.id);
      if (nome) onProducao(nome, item.numero, Math.floor(pares), item.date, item.turno);
    }
  }

  function definirCaixa(numId: string, idx: number, destino: Destino | null) {
    if (!maq || !prog) return;
    const depois: Maquina = {
      ...maq,
      programas: maq.programas.map((p) =>
        p.id === prog.id
          ? {
              ...p,
              numeros: p.numeros.map((n) => {
                if (n.id !== numId) return n;
                const caixas = caixasDe(n);
                const atual = caixas[idx];
                if (destino === "baixada") {
                  caixas[idx] =
                    atual?.destino === "baixada" && atual.date && atual.turno
                      ? atual
                      : { destino: "baixada", date: dia, turno: turnoAtivo, em: Date.now() };
                } else if (destino === "saldo") {
                  caixas[idx] = { destino: "saldo", date: atual?.date || dia, turno: atual?.turno || turnoAtivo, em: Date.now() };
                } else {
                  caixas[idx] = { destino: null, em: Date.now() };
                }
                return { ...n, caixas, marcadas: caixas.map((item) => Boolean(item?.destino)) };
              }),
            }
          : p
      ),
    };
    updateMaq(maq.id, () => depois);
    publicarDiff(maq, depois);
  }

  function clicarCaixa(num: Numero, idx: number) {
    const atual = destinoCaixa(num, idx);
    const modo: Destino = num.modoSaldo ? "saldo" : "baixada";
    if (!atual) {
      definirCaixa(num.id, idx, modo);
      return;
    }
    if (atual === modo) {
      definirCaixa(num.id, idx, null);
      return;
    }
    setPergunta({ numId: num.id, idx, atual });
  }

  return (
    <div className="text-fg">
      <div className="mb-3">
        <div className="grid grid-cols-3 gap-2">
          {(["1", "2", "3"] as Turno[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTurnoAtivo(item)}
              className={`rounded-2xl py-3 font-display text-3xl leading-none ${item === turnoAtivo ? "bg-accent text-accent-ink" : "border border-line bg-surface text-fg"}`}
            >
              {item}º
            </button>
          ))}
        </div>
        <p className="mt-2 text-center text-sm font-semibold text-muted">
          Apontando no {TURNO_LABEL[turnoAtivo]} · {formatDateBR(dia)}
        </p>
      </div>
      {screen === "home" && (
        <div className="grid grid-cols-2 gap-2">
            {maquinasDoFiltro(modelos).map((id) => {
              const m = data.maquinas.find((item) => item.id === id) ?? { id, nome: id, saldo: 0, programas: [] };
              const totais = totaisMaquina(m);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setCurrentMaqId(m.id);
                    setScreen("maq");
                    setData((atual) =>
                      atual.maquinas.some((item) => item.id === m.id)
                        ? atual
                        : { ...atual, maquinas: [...atual.maquinas, { id: m.id, nome: m.id, saldo: 0, programas: [] }] },
                    );
                  }}
                  className="flex flex-col rounded-2xl border border-line bg-surface p-3 text-left"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-display text-2xl leading-none">{m.id}</span>
                    <span className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent">
                      <Box className="size-3.5" />
                    </span>
                  </div>
                  <span className="text-sm text-muted">Horas baixadas</span>
                  <span className="font-display text-2xl leading-none tabular-nums text-accent">{formatHours(totais.hb)}</span>
                  {totais.atrasado ? (
                    <span className="mt-1 text-sm font-semibold leading-snug text-muted">
                      nº {totais.atrasado.numero}
                      <span className="whitespace-nowrap"> · {formatHours(totais.atrasado.restante)}</span>
                    </span>
                  ) : null}
                  <span className={`mt-2 rounded-xl px-2 py-1.5 text-sm font-semibold leading-tight ${totais.sd > 0 ? "bg-amber-100 text-amber-800" : "bg-surface-2 text-muted"}`}>
                    {totais.sd > 0 ? `Saldo ${formatHours(totais.sd)}` : "Sem saldo"}
                  </span>
                </button>
              );
            })}
        </div>
      )}

      {screen === "maq" && maq && (
        <div>
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-display text-4xl leading-none">{maq.id}</h2>
            <button
              type="button"
              aria-label="Novo programa"
              onClick={() => { setAviso(""); setModalProg({ editId: null }); }}
              className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-accent-ink"
            >
              <Plus className="size-5" />
            </button>
          </div>
          {(() => {
            const t = totaisMaquina(maq);
            return (
              <div className="mt-3 flex flex-wrap gap-2">
                <div className="min-w-[7.5rem] flex-1 rounded-2xl bg-emerald-50 p-3">
                  <p className="text-sm font-semibold text-emerald-800">HB</p>
                  <p className="font-display text-2xl leading-none tabular-nums text-emerald-800">{formatHours(t.hb)}</p>
                </div>
                <div className="min-w-[7.5rem] flex-1 rounded-2xl bg-amber-50 p-3">
                  <p className="text-sm font-semibold text-amber-800">SD</p>
                  <p className="font-display text-2xl leading-none tabular-nums text-amber-800">{formatHours(t.sd)}</p>
                </div>
              </div>
            );
          })()}
          <div className="mt-4 grid gap-2">
            {[...(maq.programas || [])]
              .sort((a, b) => {
                const fim = Number(calcProgram(b).concluido) - Number(calcProgram(a).concluido);
                return fim !== 0 ? -fim : ordemPrograma(a) - ordemPrograma(b);
              })
              .map((p) => {
              const c = calcProgram(p);
              const barra = progressoPrograma(p);
              const sequencia = barra.verde <= 0 && barra.ambar <= 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setCurrentProgId(p.id);
                    setScreen("prog");
                  }}
                  className="rounded-2xl border border-line bg-surface p-4 text-left shadow-sm hover:border-accent"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{tituloPrograma(p)}</div>
                      <div className="text-sm text-muted">Doc: {p.documento || "—"}{p.cor ? ` · ${p.cor}` : ""}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      {p.saldoAntes ? (
                        <>
                          <div className="font-display text-2xl leading-none tabular-nums text-amber-800">{formatHours(c.saldo)}</div>
                          <div className="text-xs font-semibold text-amber-800">Saldo anterior</div>
                          {c.produzidas > 0 ? <div className="text-xs font-semibold tabular-nums text-emerald-800">HB {formatHours(c.produzidas)}</div> : null}
                        </>
                      ) : (
                        <>
                          <div className="text-sm font-bold tabular-nums text-emerald-800">HB {formatHours(c.produzidas)}</div>
                          <div className="text-sm font-bold tabular-nums text-amber-800">SD {formatHours(c.saldo)}</div>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${c.concluido ? "bg-emerald-100 text-emerald-800" : sequencia ? "bg-surface-2 text-muted" : "bg-amber-100 text-amber-800"}`}>
                    {c.concluido ? <Check className="size-3.5" /> : sequencia ? null : <Clock className="size-3.5" />}
                    {c.concluido ? "Concluído" : sequencia ? "Sequência" : "Em andamento"}
                  </span>
                  {sequencia ? null : (
                  <div className="mt-3 flex h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-emerald-500" style={{ width: `${barra.verde}%` }} />
                    <div className="h-full bg-amber-500" style={{ width: `${barra.ambar}%` }} />
                  </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {screen === "prog" && prog && maq && (
        <div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-4xl leading-none">{tituloPrograma(prog)}</h2>
              <p className="text-sm text-muted">Documento: {prog.documento || "—"}{prog.cor ? ` · ${prog.cor}` : ""}{prog.saldoAntes ? " · Saldo anterior" : ""}</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Adicionar número"
                onClick={() => { setAviso(""); setNumeroEscolhido(""); setModalNum({ editId: null }); }}
                className="grid size-11 place-items-center rounded-2xl bg-accent text-accent-ink"
              >
                <Plus className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Editar programa"
                onClick={() => { setAviso(""); setModalProg({ editId: prog.id }); }}
                className="grid size-11 place-items-center rounded-2xl border border-line bg-surface text-accent"
              >
                <Pencil className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Apagar programa"
                onClick={() => setApagar({ tipo: "programa" })}
                className="grid size-11 place-items-center rounded-2xl border border-red-200 bg-surface text-red-600"
              >
                <Trash2 className="size-5" />
              </button>
            </div>
          </div>
          {apagar?.tipo === "programa" ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-700">Apagar este programa?</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setApagar(null)} className="rounded-xl border border-line bg-surface py-2 text-sm font-semibold">
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateMaq(maq.id, (m) => ({ ...m, programas: m.programas.filter((p) => p.id !== prog.id) }));
                    setApagar(null);
                    setScreen("maq");
                  }}
                  className="rounded-xl bg-red-600 py-2 text-sm font-semibold text-white"
                >
                  Apagar
                </button>
              </div>
            </div>
          ) : null}
          {(() => {
            const c = calcProgram(prog);
            return (
              <div className="mt-4 mb-4 flex flex-wrap gap-2">
                {prog.saldoAntes ? (
                  <div className="min-w-[7.5rem] flex-[1.4] rounded-2xl bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-amber-800">Saldo</p>
                    <p className="font-display text-2xl leading-none tabular-nums text-amber-800">{formatHours(c.saldo)}</p>
                  </div>
                ) : null}
                {!prog.saldoAntes || c.produzidas > 0 ? (
                  <div className="min-w-[7.5rem] flex-1 rounded-2xl bg-emerald-50 p-3">
                    <p className="text-sm font-semibold text-emerald-800">HB</p>
                    <p className="font-display text-2xl leading-none tabular-nums text-emerald-800">{formatHours(c.produzidas)}</p>
                  </div>
                ) : null}
                {!prog.saldoAntes && c.saldo > 0 ? (
                  <div className="min-w-[7.5rem] flex-1 rounded-2xl bg-amber-50 p-3">
                    <p className="text-sm font-semibold text-amber-800">SD</p>
                    <p className="font-display text-2xl leading-none tabular-nums text-amber-800">{formatHours(c.saldo)}</p>
                  </div>
                ) : null}
                {c.atrasado ? (
                <div className="min-w-[7.5rem] flex-1 rounded-2xl bg-surface-2 p-3">
                  <p className="text-sm font-semibold text-muted">Nº atrasado</p>
                  <p className="break-words font-display text-2xl leading-none tabular-nums">{c.atrasado.numero}</p>
                  <p className="mt-1 whitespace-nowrap text-sm tabular-nums text-muted">{formatHours(c.atrasado.restante)}</p>
                </div>
                ) : null}
              </div>
            );
          })()}
          <div className="space-y-3">
            {ordenarNumeros(prog.numeros || []).map((n) => {
              const cn = calcNumber(n);
              const open = openNums.has(n.id);
              return (
                <div key={n.id} className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
                  <button
                    type="button"
                    onClick={() => setOpenNums((s) => {
                      const next = new Set(s);
                      if (next.has(n.id)) next.delete(n.id); else next.add(n.id);
                      return next;
                    })}
                    className="flex w-full items-center gap-3 p-4 text-left"
                  >
                    <span className="flex-1">
                      <span className="font-semibold">Nº {n.numero}</span>
                      <span className="block text-xs text-muted">
                        Padrão {n.padrao} · {cn.qtdCheias} cheias{cn.ultima > 0 ? ` + ${Math.round(cn.ultima)}p` : ""} · {n.totalPares}p
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-center gap-1">
                      <span className={`text-[10px] font-semibold ${n.modoSaldo ? "text-amber-700" : "text-muted"}`}>{n.modoSaldo ? "Saldo" : "Hora"}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(n.modoSaldo)}
                        aria-label={n.modoSaldo ? "Próximas caixas vão para o saldo" : "Próximas caixas vão para horas baixadas"}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPergunta(null);
                          updateMaq(maq.id, (m) => ({
                            ...m,
                            programas: m.programas.map((p) =>
                              p.id === prog.id
                                ? {
                                    ...p,
                                    numeros: p.numeros.map((item) => (item.id === n.id ? { ...item, modoSaldo: !item.modoSaldo } : item)),
                                  }
                                : p
                            ),
                          }));
                        }}
                        className={`relative h-7 w-12 shrink-0 rounded-full ${n.modoSaldo ? "bg-amber-500" : "bg-line"}`}
                      >
                        <span className={`absolute top-1 size-5 rounded-full bg-white ${n.modoSaldo ? "left-6" : "left-1"}`} />
                      </button>
                    </span>
                    <span className="font-bold tabular-nums text-accent">{formatHours(cn.restante)}</span>
                    <ChevronDown className={`size-4 text-muted transition ${open ? "rotate-180" : ""}`} />
                  </button>
                  <div className="mx-4 flex h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-emerald-500" style={{ width: `${cn.totalHoras > 0 ? Math.min(100, (cn.horasBaixadas / cn.totalHoras) * 100) : 0}%` }} />
                    <div className="h-full bg-amber-500" style={{ width: `${cn.totalHoras > 0 ? Math.min(100, (cn.horasSaldo / cn.totalHoras) * 100) : 0}%` }} />
                  </div>
                  {open && (
                    <div className="p-4">
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(3.4rem,1fr))] gap-2">
                        {Array.from({ length: cn.totalCaixas }, (_, i) => {
                          const p = i < cn.qtdCheias ? cn.paresCheia : cn.ultima;
                          const destino = destinoCaixa(n, i);
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => clicarCaixa(n, i)}
                              className={`flex flex-col items-center justify-center rounded-xl border-2 py-2 text-sm font-bold ${destino === "saldo" ? "border-amber-500 bg-amber-50 text-amber-800" : destino === "baixada" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-line bg-surface-2"}`}
                            >
                              {i + 1}
                              <span className="text-[10px] font-semibold opacity-70">{Math.round(p)}p</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => { setAviso(""); setNumeroEscolhido(n.numero); setModalNum({ editId: n.id }); }} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm">
                          <Pencil className="size-3.5" /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => setApagar({ tipo: "numero", id: n.id })}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600"
                        >
                          <Trash2 className="size-3.5" /> Remover
                        </button>
                      </div>
                      {apagar?.tipo === "numero" && apagar.id === n.id ? (
                        <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3">
                          <p className="text-sm font-semibold text-red-700">Remover este número?</p>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => setApagar(null)} className="rounded-xl border border-line bg-surface py-2 text-sm font-semibold">
                              Cancelar
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                updateMaq(maq.id, (m) => ({
                                  ...m,
                                  programas: m.programas.map((p) =>
                                    p.id === prog.id ? { ...p, numeros: p.numeros.filter((x) => x.id !== n.id) } : p,
                                  ),
                                }));
                                setApagar(null);
                              }}
                              className="rounded-xl bg-red-600 py-2 text-sm font-semibold text-white"
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pergunta && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center" onClick={(e) => e.target === e.currentTarget && setPergunta(null)}>
          <div className="w-full max-w-md rounded-3xl bg-surface p-5 shadow-xl">
            <p className="text-base font-semibold">
              {pergunta.atual === "saldo" ? "Esta caixa está no saldo." : "Esta caixa está nas horas baixadas."}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  definirCaixa(pergunta.numId, pergunta.idx, null);
                  setPergunta(null);
                }}
                className="rounded-xl border border-line py-2.5 text-sm font-semibold"
              >
                Desmarcar
              </button>
              <button
                type="button"
                onClick={() => {
                  definirCaixa(pergunta.numId, pergunta.idx, pergunta.atual === "saldo" ? "baixada" : "saldo");
                  setPergunta(null);
                }}
                className="rounded-xl bg-accent py-2.5 text-sm font-semibold text-accent-ink"
              >
                {pergunta.atual === "saldo" ? "Tornar hora" : "Tornar saldo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalProg && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center" onClick={(e) => e.target === e.currentTarget && setModalProg(null)}>
          <form
            className="w-full max-w-md rounded-3xl bg-surface p-5 shadow-xl"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const nome = nomeLimpo(String(fd.get("nome") || "").trim());
              const documento = String(fd.get("documento") || "").trim();
              const cor = String(fd.get("cor") || "").trim();
              const ordem = Number(fd.get("ordem")) || 0;
              const saldoAntes = fd.get("saldoAntes") === "1";
              if (!nome || !maq) {
                setAviso("Coloque o código do programa.");
                return;
              }
              if (modalProg.editId) {
                updateMaq(maq.id, (m) => ({
                  ...m,
                  programas: m.programas.map((p) => (p.id === modalProg.editId ? { ...p, nome, documento, cor, ordem, saldoAntes } : p)),
                }));
              } else {
                updateMaq(maq.id, (m) => ({
                  ...m,
                  programas: [...m.programas, { id: Date.now().toString(), nome, documento, cor, ordem, saldoAntes, numeros: [] }],
                }));
              }
              setAviso("");
              setModalProg(null);
            }}
          >
            <h3 className="mb-4 text-lg font-bold">{modalProg.editId ? "Editar programa" : "Novo programa"}</h3>
            <label className="mb-1 block text-xs text-muted">Ordem</label>
            <select
              name="ordem"
              defaultValue={modalProg.editId && prog ? ordemPrograma(prog) : Math.min(12, (maq?.programas ?? []).reduce((max, item) => Math.max(max, ordemPrograma(item) < 99 ? ordemPrograma(item) : 0), 0) + 1)}
              className="mb-3 w-full appearance-none rounded-xl border border-line bg-surface-2 px-3 py-2.5"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((item) => (
                <option key={item} value={item}>{item}º programa</option>
              ))}
            </select>
            <label className="mb-3 flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
              <input name="saldoAntes" type="checkbox" value="1" defaultChecked={Boolean(modalProg.editId && prog?.saldoAntes)} className="size-4 accent-amber-600" />
              <span className="text-sm font-semibold">Saldo</span>
            </label>
            <label className="mb-1 block text-xs text-muted">Código do programa</label>
            <input name="nome" className="mb-3 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 336027" defaultValue={modalProg.editId && prog ? nomeLimpo(prog.nome) : ""} />
            <label className="mb-1 block text-xs text-muted">Documento</label>
            <input name="documento" className="mb-3 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 28" defaultValue={modalProg.editId ? prog?.documento : ""} />
            <label className="mb-1 block text-xs text-muted">Cor</label>
            <input name="cor" className="mb-4 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: Preto" defaultValue={modalProg.editId ? prog?.cor : ""} />
            {aviso ? <p className="mb-3 text-sm font-semibold text-red-600">{aviso}</p> : null}
            <div className="flex gap-2">
              <button type="button" onClick={() => setModalProg(null)} className="flex-1 rounded-xl border border-line py-2.5 font-semibold">Cancelar</button>
              <button type="submit" className="flex-1 rounded-xl bg-accent py-2.5 font-semibold text-accent-ink">Salvar</button>
            </div>
          </form>
        </div>
      )}

      {modalNum && prog && maq && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/40 p-3 sm:place-items-center" onClick={(e) => e.target === e.currentTarget && setModalNum(null)}>
          <form
            className="w-full max-w-md rounded-3xl bg-surface p-5 shadow-xl"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const numero = numeroEscolhido;
              const padrao = String(fd.get("padrao") || "").trim();
              const totalPares = String(fd.get("totalPares") || "").trim();
              const paresCheia = String(fd.get("paresCheia") || "").trim();
              if (!numero || !padrao || !totalPares || !paresCheia) {
                setAviso("Preencha a numeração, o padrão e os pares.");
                return;
              }
              if (modalNum.editId) {
                updateMaq(maq.id, (m) => ({
                  ...m,
                  programas: m.programas.map((p) =>
                    p.id === prog.id
                      ? {
                          ...p,
                          numeros: ordenarNumeros(p.numeros.map((n) =>
                            n.id === modalNum.editId ? { ...n, numero, padrao, totalPares, paresCheia } : n
                          )),
                        }
                      : p
                  ),
                }));
              } else {
                const id = Date.now().toString();
                updateMaq(maq.id, (m) => ({
                  ...m,
                  programas: m.programas.map((p) =>
                    p.id === prog.id
                      ? { ...p, numeros: ordenarNumeros([...p.numeros, { id, numero, padrao, totalPares, paresCheia, marcadas: [], caixas: [], modoSaldo: false }]) }
                      : p
                  ),
                }));
                setOpenNums((s) => new Set(s).add(id));
              }
              setAviso("");
              setModalNum(null);
            }}
          >
            <h3 className="mb-4 text-lg font-bold">{modalNum.editId ? "Editar número" : "Adicionar número"}</h3>
            <label className="mb-3 block">
              <span className="mb-1 block text-xs text-muted">Numeração</span>
              <select
                value={numeroEscolhido}
                onChange={(event) => setNumeroEscolhido(event.target.value)}
                className="w-full appearance-none rounded-xl border border-line bg-surface-2 px-3 py-2.5"
              >
                <option value="">—</option>
                {NUMEROS_MATRIZ.map((item) => (
                  <option key={item} value={item}>{item}</option>
                ))}
                {numeroEscolhido && !NUMEROS_MATRIZ.includes(numeroEscolhido as (typeof NUMEROS_MATRIZ)[number]) ? (
                  <option value={numeroEscolhido}>{numeroEscolhido}</option>
                ) : null}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-xs text-muted">Padrão</label>
                <input name="padrao" className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 15.09" defaultValue={modalNum.editId ? prog.numeros.find(n => n.id === modalNum.editId)?.padrao : ""} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Pares da carga</label>
                <input name="totalPares" className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 160" defaultValue={modalNum.editId ? prog.numeros.find(n => n.id === modalNum.editId)?.totalPares : ""} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Pares por caixa</label>
                <input name="paresCheia" className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 20" defaultValue={modalNum.editId ? prog.numeros.find(n => n.id === modalNum.editId)?.paresCheia : ""} />
              </div>
            </div>
            {aviso ? <p className="mt-3 text-sm font-semibold text-red-600">{aviso}</p> : null}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={() => setModalNum(null)} className="flex-1 rounded-xl border border-line py-2.5 font-semibold">Cancelar</button>
              <button type="submit" className="flex-1 rounded-xl bg-accent py-2.5 font-semibold text-accent-ink">Salvar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
