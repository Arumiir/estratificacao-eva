import { useState } from "react";
import { NUMEROS_MATRIZ } from "@/lib/perdas";

type NumeroCarga = { numero: string; padrao: string; totalPares: string };
type ProgramaCarga = { nome: string; documento: string; cor: string; numeros: NumeroCarga[] };

const FICTICIO: ProgramaCarga[] = [
  { nome: "326749", documento: "38", cor: "Bege Birch", numeros: [{ numero: "36", padrao: "32", totalPares: "120" }] },
  { nome: "326805", documento: "28", cor: "Bege Birch", numeros: [{ numero: "33/34", padrao: "16", totalPares: "60" }] },
  { nome: "326747", documento: "38", cor: "Marrom Licor", numeros: [
    { numero: "33/34", padrao: "16", totalPares: "24" },
    { numero: "35", padrao: "16", totalPares: "24" },
    { numero: "36", padrao: "32", totalPares: "48" },
    { numero: "37", padrao: "32", totalPares: "120" },
    { numero: "39/40", padrao: "16", totalPares: "60" },
  ] },
  { nome: "326791", documento: "28", cor: "Rosa Boreal", numeros: [
    { numero: "33/34", padrao: "16", totalPares: "40" },
    { numero: "35", padrao: "24", totalPares: "60" },
    { numero: "38", padrao: "16", totalPares: "40" },
  ] },
];

function tituloCor(valor: string) {
  return valor.toLowerCase().replace(/(^|\s)\p{L}/gu, (letra) => letra.toUpperCase());
}

function numeroDaCarga(tam: string) {
  const [inicio, fim] = tam.split(".");
  if (!fim) return String(Number(inicio));
  return `${Number(inicio)}/${fim.padStart(2, "0")}`;
}

function padraoDaCarga(valor: string) {
  const n = Number(valor.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return valor;
  return String(n).replace(".", ",");
}

function lerCarga(texto: string, equip: string): ProgramaCarga[] {
  let equipamento = "";
  let programa = "";
  const grupos = new Map<string, { nome: string; documento: string; cor: string; numeros: Map<string, { numero: string; padrao: string; totalPares: number }> }>();
  for (const bruto of texto.split(/\r?\n/)) {
    const line = bruto.replace("\f", "");
    if (!line.trim() || line.trimStart().startsWith("**")) continue;
    if (/Total |CARGA|DATASUL|Fabrica:|Centro|Equip |------|Page:/.test(line)) continue;
    const novaMaquina = line.match(/^(S6IE\d+[AB]?)\s+\d+\s+(\d+)\s+\d{2}\/\d{4}\s+\d+\s+(\d+)\s+S\s+/);
    const novoPrograma = line.match(/^\s+\d{6}\s+(\d+)\s+\d{2}\/\d{4}\s+\d+\s+(\d+)\s+S\s+/);
    const continua = line.match(/^\s+(\d+)\s+S\s+\d{2}\/\d{2}/);
    if (novaMaquina) {
      equipamento = novaMaquina[1];
      programa = novaMaquina[2];
    } else if (novoPrograma) {
      programa = novoPrograma[1];
    } else if (!continua || !programa) {
      continue;
    }
    if (equipamento !== equip) continue;
    const tamanho = line.match(/(\d+(?:\.\d+)?)\s+[A-Z]\s+\d+\s+\d+\s+\d+\s+([\d.]+,\d+|\d+)\s+\d+\s+\d+\s+\d+\s+(\d+)\s+\d+:\d+/);
    const cor = line.match(/\s(\d{5})\s+([A-Z][A-Z ]*?)\s{2,}\d/);
    if (!tamanho || !cor) continue;
    const saldo = Number(tamanho[3]);
    if (saldo <= 0) continue;
    const doc = novaMaquina?.[3] || novoPrograma?.[2] || continua?.[1] || "";
    const chave = `${programa}|${doc}|${cor[2].trim()}`;
    const grupo = grupos.get(chave) ?? { nome: programa, documento: doc, cor: tituloCor(cor[2].trim()), numeros: new Map() };
    const numero = numeroDaCarga(tamanho[1]);
    const atual = grupo.numeros.get(numero);
    grupo.numeros.set(numero, { numero, padrao: padraoDaCarga(tamanho[2]), totalPares: (atual?.totalPares ?? 0) + saldo });
    grupos.set(chave, grupo);
  }
  return [...grupos.values()].map((grupo) => ({
    nome: grupo.nome,
    documento: grupo.documento,
    cor: grupo.cor,
    numeros: [...grupo.numeros.values()].map((numero) => ({ ...numero, totalPares: String(numero.totalPares) })),
  }));
}

function ordenar(numeros: string[]) {
  return [...numeros].sort((a, b) => {
    const ia = NUMEROS_MATRIZ.indexOf(a as (typeof NUMEROS_MATRIZ)[number]);
    const ib = NUMEROS_MATRIZ.indexOf(b as (typeof NUMEROS_MATRIZ)[number]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

export function TesteCarga() {
  const [carga, setCarga] = useState<ProgramaCarga[]>(FICTICIO);
  const [paresPorNumero, setParesPorNumero] = useState<Record<string, string>>({});
  const [marcados, setMarcados] = useState<string[]>(FICTICIO.map((programa) => `${programa.nome}|${programa.documento}|${programa.cor}`));
  const [aviso, setAviso] = useState("Dados de teste. Nada entra no aplicativo.");
  const [maquina, setMaquina] = useState("SIE01");
  const numeros = ordenar([...new Set(carga.flatMap((programa) => programa.numeros.map((numero) => numero.numero)))]);

  function aplicar(lista: ProgramaCarga[]) {
    setCarga(lista);
    setParesPorNumero({});
    setMarcados(lista.map((programa) => `${programa.nome}|${programa.documento}|${programa.cor}`));
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <p className="font-display text-4xl leading-none text-accent">Teste da carga</p>
      <p className="mt-2 text-sm text-muted">Segure o primeiro turno para chegar aqui. Isto não salva nada.</p>
      <div className="mt-4 flex gap-2">
        <select value={maquina} onChange={(event) => setMaquina(event.target.value)} className="rounded-xl border border-line bg-surface-2 px-3 py-2.5">
          {["SIE01", "SIE02", "SIE03", "SIE04", "SIE05", "SIE06", "SIE06A", "SIE06B"].map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
        <label className="flex flex-1 items-center justify-center rounded-xl border border-line bg-surface px-3 py-2.5 text-sm font-semibold">
          Arquivo de teste
          <input
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={async (event) => {
              const arquivo = event.target.files?.[0];
              event.target.value = "";
              if (!arquivo) return;
              const texto = new TextDecoder("windows-1252").decode(await arquivo.arrayBuffer());
              const equip = maquina.replace(/^SIE/, "S6IE");
              const lista = lerCarga(texto, equip);
              if (!lista.length) {
                setAviso("Esse arquivo não tem carga para esta máquina.");
                return;
              }
              aplicar(lista);
              setAviso(`${lista.length} programas lidos. Continua sendo teste.`);
            }}
          />
        </label>
      </div>
      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Números</p>
      <div className="space-y-2">
        {numeros.map((numero) => (
          <label key={numero} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2">
            <span className="w-16 font-semibold">Nº {numero}</span>
            <input
              value={paresPorNumero[numero] ?? ""}
              onChange={(event) => setParesPorNumero((atual) => ({ ...atual, [numero]: event.target.value }))}
              inputMode="decimal"
              placeholder="Pares por caixa"
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2"
            />
          </label>
        ))}
      </div>
      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">Programas</p>
      <div className="space-y-2">
        {carga.map((programa) => {
          const chave = `${programa.nome}|${programa.documento}|${programa.cor}`;
          const marcado = marcados.includes(chave);
          return (
            <label key={chave} className={`block rounded-2xl border p-3 ${marcado ? "border-accent" : "border-line"}`}>
              <span className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => setMarcados((atual) => atual.includes(chave) ? atual.filter((item) => item !== chave) : [...atual, chave])}
                  className="mt-1 size-4 accent-accent"
                />
                <span>
                  <span className="block font-semibold">{programa.nome}</span>
                  <span className="block text-sm text-muted">Doc {programa.documento} · {programa.cor}</span>
                  <span className="mt-1 block text-sm tabular-nums text-muted">{programa.numeros.map((numero) => `${numero.numero} · ${numero.totalPares}p`).join("  ")}</span>
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {aviso ? <p className="mt-4 text-sm font-semibold text-accent">{aviso}</p> : null}
      <button
        type="button"
        onClick={() => {
          const escolhidos = carga.filter((programa) => marcados.includes(`${programa.nome}|${programa.documento}|${programa.cor}`));
          if (!escolhidos.length) {
            setAviso("Escolha ao menos um programa.");
            return;
          }
          const faltando = [...new Set(escolhidos.flatMap((programa) => programa.numeros.map((numero) => numero.numero)))].filter((numero) => !paresPorNumero[numero]?.trim());
          if (faltando.length) {
            setAviso(`Coloque os pares por caixa do nº ${faltando.join(", ")}.`);
            return;
          }
          setAviso("Teste aceito. Nada foi salvo no aplicativo.");
        }}
        className="mt-4 w-full rounded-xl bg-accent py-3 font-semibold text-accent-ink"
      >
        Adicionar no teste
      </button>
    </div>
  );
}
