import { useEffect, useState } from "react";
import { ChevronLeft, Plus, Pencil, Trash2, ChevronDown, Clock, AlertTriangle, Check, Box } from "lucide-react";

type Numero = {
  id: string;
  numero: string;
  padrao: string;
  totalPares: string;
  paresCheia: string;
  marcadas: boolean[];
};

type Programa = {
  id: string;
  nome: string;
  documento: string;
  numeros: Numero[];
};

type Maquina = {
  id: string;
  nome: string;
  saldo: number;
  programas: Programa[];
};

type Data = {
  maquinas: Maquina[];
};

const STORAGE_KEY = "horas_maquinas_v3";

function parseHours(str: string): number {
  if (!str?.trim()) return 0;
  const s = str.trim().replace(",", ".");
  if (s.includes(":")) {
    const [h, m] = s.split(":").map((n) => parseInt(n, 10) || 0);
    if (m >= 60 || m < 0 || h < 0) return NaN;
    return h + m / 60;
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

function formatHours(h: number): string {
  if (isNaN(h) || h < 0) return "00:00";
  const t = Math.round(h * 60);
  return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
}

function parseNum(s: string): number {
  return s ? parseFloat(String(s).replace(",", ".")) || 0 : 0;
}

function calcNumber(num: Numero) {
  const totalPares = parseNum(num.totalPares);
  const paresCheia = parseNum(num.paresCheia);
  const padrao = parseNum(num.padrao);
  const qtdCheias = paresCheia > 0 ? Math.floor(totalPares / paresCheia) : 0;
  const ultima = paresCheia > 0 ? totalPares % paresCheia : 0;
  const totalCaixas = qtdCheias + (ultima > 0 ? 1 : 0);
  const totalHoras = padrao > 0 ? totalPares / padrao : 0;
  const marcadas = num.marcadas || [];
  let prod = 0;
  for (let i = 0; i < totalCaixas; i++) if (marcadas[i]) prod += i < qtdCheias ? paresCheia : ultima;
  const horasProduzidas = padrao > 0 ? prod / padrao : 0;
  const restante = Math.max(0, totalHoras - horasProduzidas);
  return { totalHoras, horasProduzidas, restante, totalCaixas, paresCheia, ultima, qtdCheias, totalPares };
}

function calcProgram(prog: Programa) {
  let maxTotal = 0, maxRest = 0;
  let segurando: { numero: string; restante: number } | null = null;
  for (const n of prog.numeros || []) {
    const c = calcNumber(n);
    if (c.totalHoras > maxTotal) maxTotal = c.totalHoras;
    if (c.restante > maxRest) {
      maxRest = c.restante;
      segurando = { numero: n.numero, restante: c.restante };
    }
  }
  return {
    produzidas: Math.max(0, maxTotal - maxRest),
    segurando,
    concluido: (prog.numeros || []).length > 0 && (prog.numeros || []).every((n) => calcNumber(n).restante <= 0.01),
  };
}

function calcMaquina(m: Maquina) {
  let t = m.saldo || 0;
  for (const p of m.programas || []) t += calcProgram(p).produzidas;
  return t;
}

function getHoldingMaquina(m: Maquina) {
  let max = 0;
  let seg: { numero: string; restante: number } | null = null;
  for (const p of m.programas || []) {
    const c = calcProgram(p);
    if (c.segurando && c.segurando.restante > max) {
      max = c.segurando.restante;
      seg = c.segurando;
    }
  }
  return seg;
}

function initMaquinas(data: Data): Data {
  if (!data.maquinas || data.maquinas.length !== 6) {
    const maquinas: Maquina[] = [];
    for (let i = 1; i <= 6; i++) {
      const id = String(i).padStart(2, "0");
      maquinas.push({ id, nome: `Máq. ${id}`, saldo: 0, programas: [] });
    }
    return { maquinas };
  }
  return data;
}

export function AcompanhamentoHoras() {
  const [data, setData] = useState<Data>({ maquinas: [] });
  const [screen, setScreen] = useState<"home" | "maq" | "prog">("home");
  const [currentMaqId, setCurrentMaqId] = useState<string | null>(null);
  const [currentProgId, setCurrentProgId] = useState<string | null>(null);
  const [openNums, setOpenNums] = useState<Set<string>>(new Set());
  const [modalProg, setModalProg] = useState<{ editId: string | null } | null>(null);
  const [modalNum, setModalNum] = useState<{ editId: string | null } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setData(initMaquinas(parsed));
      } else {
        setData(initMaquinas({ maquinas: [] }));
      }
    } catch {
      setData(initMaquinas({ maquinas: [] }));
    }
  }, []);

  useEffect(() => {
    if (data.maquinas.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    }
  }, [data]);

  const maq = data.maquinas.find((m) => m.id === currentMaqId);
  const prog = maq?.programas.find((p) => p.id === currentProgId);

  function updateMaq(id: string, updater: (m: Maquina) => Maquina) {
    setData((d) => ({
      ...d,
      maquinas: d.maquinas.map((m) => (m.id === id ? updater(m) : m)),
    }));
  }

  function toggleBox(numId: string, idx: number) {
    if (!maq || !prog) return;
    updateMaq(maq.id, (m) => ({
      ...m,
      programas: m.programas.map((p) =>
        p.id === prog.id
          ? {
              ...p,
              numeros: p.numeros.map((n) => {
                if (n.id !== numId) return n;
                const marcadas = [...(n.marcadas || [])];
                marcadas[idx] = !marcadas[idx];
                return { ...n, marcadas };
              }),
            }
          : p
      ),
    }));
  }

  return (
    <div className="min-h-dvh bg-bg text-fg">
      {screen === "home" && (
        <div className="mx-auto max-w-5xl p-4">
          <h1 className="font-display text-3xl font-bold tracking-tight">Acompanhamento de Horas</h1>
          <p className="mt-1 text-muted">Máquinas 01 a 06</p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.maquinas.map((m) => {
              const h = getHoldingMaquina(m);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setCurrentMaqId(m.id);
                    setScreen("maq");
                  }}
                  className="flex flex-col rounded-2xl border border-line bg-surface p-4 text-left shadow-sm transition hover:border-accent"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-semibold">{m.nome}</span>
                    <span className="grid size-8 place-items-center rounded-xl bg-accent-soft text-accent">
                      <Box className="size-4" />
                    </span>
                  </div>
                  <span className="text-xs text-muted">Horas baixadas</span>
                  <span className="text-2xl font-bold tabular-nums text-accent">{formatHours(calcMaquina(m))}</span>
                  <span className="mt-3 text-xs text-muted">Atrasado</span>
                  <span className={`mt-1 inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${h ? "bg-amber-100 text-amber-800" : "bg-surface-2 text-muted"}`}>
                    {h ? <AlertTriangle className="size-3.5" /> : null}
                    <span className="truncate">{h ? `Nº ${h.numero} (${formatHours(h.restante)})` : "—"}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {screen === "maq" && maq && (
        <div className="mx-auto max-w-5xl p-4">
          <button type="button" onClick={() => setScreen("home")} className="mb-3 inline-flex items-center gap-1 text-accent">
            <ChevronLeft className="size-4" /> Máquinas
          </button>
          <h2 className="font-display text-2xl font-bold">{maq.nome}</h2>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-xs text-muted">Horas anteriores / saldo desta máquina</label>
              <input
                className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5"
                placeholder="Ex: 02:00"
                defaultValue={maq.saldo > 0 ? formatHours(maq.saldo) : ""}
                onBlur={(e) => {
                  const h = parseHours(e.target.value);
                  if (!isNaN(h) && h >= 0) updateMaq(maq.id, (m) => ({ ...m, saldo: h }));
                }}
              />
            </div>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {(maq.programas || []).map((p) => {
              const c = calcProgram(p);
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
                    <div>
                      <div className="font-semibold">{p.nome || "Programa"}</div>
                      <div className="text-sm text-muted">Doc: {p.documento || "—"}</div>
                    </div>
                    <div className="font-bold tabular-nums text-accent">{formatHours(c.produzidas)}</div>
                  </div>
                  <span className={`mt-3 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${c.concluido ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                    {c.concluido ? <Check className="size-3.5" /> : <Clock className="size-3.5" />}
                    {c.concluido ? "Concluído" : "Em andamento"}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setModalProg({ editId: null })}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-semibold text-accent-ink"
          >
            <Plus className="size-4" /> Novo programa
          </button>
        </div>
      )}

      {screen === "prog" && prog && maq && (
        <div className="mx-auto max-w-5xl p-4">
          <button type="button" onClick={() => setScreen("maq")} className="mb-3 inline-flex items-center gap-1 text-accent">
            <ChevronLeft className="size-4" /> Programas
          </button>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold">{prog.nome}</h2>
              <p className="text-sm text-muted">Documento: {prog.documento || "—"}</p>
            </div>
            <button type="button" onClick={() => setModalProg({ editId: prog.id })} className="inline-flex items-center gap-1 rounded-xl border border-line px-3 py-2 text-sm">
              <Pencil className="size-3.5" /> Editar
            </button>
          </div>
          {(() => {
            const c = calcProgram(prog);
            return c.segurando ? (
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                <AlertTriangle className="size-6" />
                <div>
                  <div className="text-xs font-semibold">Segurando a hora</div>
                  <div className="text-lg font-bold tabular-nums">Nº {c.segurando.numero} — {formatHours(c.segurando.restante)}</div>
                </div>
              </div>
            ) : (
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-muted">
                <Check className="size-6" />
                <div>
                  <div className="text-xs font-semibold">Nenhum número pendente</div>
                  <div className="text-lg font-bold">—</div>
                </div>
              </div>
            );
          })()}
          <div className="space-y-3">
            {(prog.numeros || []).map((n) => {
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
                    <span className="font-bold tabular-nums text-accent">{formatHours(cn.restante)}</span>
                    <ChevronDown className={`size-4 text-muted transition ${open ? "rotate-180" : ""}`} />
                  </button>
                  <div className="mx-4 h-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${cn.totalHoras > 0 ? Math.min(100, (cn.horasProduzidas / cn.totalHoras) * 100) : 0}%` }} />
                  </div>
                  {open && (
                    <div className="p-4">
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(3.4rem,1fr))] gap-2">
                        {Array.from({ length: cn.totalCaixas }, (_, i) => {
                          const p = i < cn.qtdCheias ? cn.paresCheia : cn.ultima;
                          const on = !!(n.marcadas || [])[i];
                          return (
                            <button
                              key={i}
                              type="button"
                              onClick={() => toggleBox(n.id, i)}
                              className={`flex flex-col items-center justify-center rounded-xl border-2 py-2 text-sm font-bold ${on ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-line bg-surface-2"}`}
                            >
                              {i + 1}
                              <span className="text-[10px] font-semibold opacity-70">{Math.round(p)}p</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button type="button" onClick={() => setModalNum({ editId: n.id })} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm">
                          <Pencil className="size-3.5" /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("Remover este número?")) {
                              updateMaq(maq.id, (m) => ({
                                ...m,
                                programas: m.programas.map((p) =>
                                  p.id === prog.id ? { ...p, numeros: p.numeros.filter((x) => x.id !== n.id) } : p
                                ),
                              }));
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600"
                        >
                          <Trash2 className="size-3.5" /> Remover
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setModalNum({ editId: null })} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-semibold text-accent-ink">
              <Plus className="size-4" /> Adicionar número
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm("Apagar este programa?")) {
                  updateMaq(maq.id, (m) => ({ ...m, programas: m.programas.filter((p) => p.id !== prog.id) }));
                  setScreen("maq");
                }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2.5 font-semibold text-red-600"
            >
              <Trash2 className="size-4" /> Apagar programa
            </button>
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
              const nome = String(fd.get("nome") || "").trim();
              const documento = String(fd.get("documento") || "").trim();
              if (!nome || !maq) return;
              if (modalProg.editId) {
                updateMaq(maq.id, (m) => ({
                  ...m,
                  programas: m.programas.map((p) => (p.id === modalProg.editId ? { ...p, nome, documento } : p)),
                }));
              } else {
                updateMaq(maq.id, (m) => ({
                  ...m,
                  programas: [...m.programas, { id: Date.now().toString(), nome, documento, numeros: [] }],
                }));
              }
              setModalProg(null);
            }}
          >
            <h3 className="mb-4 text-lg font-bold">{modalProg.editId ? "Editar programa" : "Novo programa"}</h3>
            <label className="mb-1 block text-xs text-muted">Código do programa</label>
            <input name="nome" required className="mb-3 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 336027" defaultValue={modalProg.editId ? prog?.nome : ""} />
            <label className="mb-1 block text-xs text-muted">Documento</label>
            <input name="documento" className="mb-4 w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 28" defaultValue={modalProg.editId ? prog?.documento : ""} />
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
              const numero = String(fd.get("numero") || "").trim();
              const padrao = String(fd.get("padrao") || "").trim();
              const totalPares = String(fd.get("totalPares") || "").trim();
              const paresCheia = String(fd.get("paresCheia") || "").trim();
              if (!numero || !padrao || !totalPares || !paresCheia) return;
              if (modalNum.editId) {
                updateMaq(maq.id, (m) => ({
                  ...m,
                  programas: m.programas.map((p) =>
                    p.id === prog.id
                      ? {
                          ...p,
                          numeros: p.numeros.map((n) =>
                            n.id === modalNum.editId ? { ...n, numero, padrao, totalPares, paresCheia } : n
                          ),
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
                      ? { ...p, numeros: [...p.numeros, { id, numero, padrao, totalPares, paresCheia, marcadas: [] }] }
                      : p
                  ),
                }));
                setOpenNums((s) => new Set(s).add(id));
              }
              setModalNum(null);
            }}
          >
            <h3 className="mb-4 text-lg font-bold">{modalNum.editId ? "Editar número" : "Adicionar número"}</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted">Número</label>
                <input name="numero" required className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 33" defaultValue={modalNum.editId ? prog.numeros.find(n => n.id === modalNum.editId)?.numero : ""} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Padrão</label>
                <input name="padrao" required className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 15.09" defaultValue={modalNum.editId ? prog.numeros.find(n => n.id === modalNum.editId)?.padrao : ""} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Pares da carga</label>
                <input name="totalPares" required className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 160" defaultValue={modalNum.editId ? prog.numeros.find(n => n.id === modalNum.editId)?.totalPares : ""} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted">Pares por caixa</label>
                <input name="paresCheia" required className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5" placeholder="Ex: 20" defaultValue={modalNum.editId ? prog.numeros.find(n => n.id === modalNum.editId)?.paresCheia : ""} />
              </div>
            </div>
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
