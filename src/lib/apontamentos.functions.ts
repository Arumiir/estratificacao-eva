import { createServerFn } from "@tanstack/react-start";
import { pullDay, pushDays } from "@/lib/apontamentos-blob";
import { dbSource, getSql } from "@/lib/db";
import { apontamentoBloqueado, coerceEntry, diaOperacional, diasAte, mergeCores, mergeFechamentos, mergeOutros, mergeProducao, numeroLimpo, parseMachine, podeAlterarApontamento, problemName, readCores, readFechamentos, readGrades, readModelos, readOutros, readProducao, referenciaLimpa, turnoPeloRelogio, type Cor, type Entry, type Fechamento, type MaquinaPiso, type OutroMatriz, type ProducaoPares, type StationConfig } from "@/lib/perdas";

type ModeloSalvo = { machines: MaquinaPiso[]; salvoEm: number };

type SyncResult = {
  entries: Entry[];
  removed: string[];
  grades: Record<string, StationConfig>;
  outros: OutroMatriz[];
  cores: Cor[];
  fechamentos: Fechamento[];
  producao: ProducaoPares[];
  modelos: ModeloSalvo | null;
  cloud: boolean;
};

function usesBlob() {
  return dbSource !== "neon" && Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function cloudOn() {
  return dbSource === "neon" || Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

let acertoPronto: Promise<void> | null = null;

function garantirAcerto() {
  acertoPronto ??= acertarTerceiroTurno().catch((error) => {
    acertoPronto = null;
    throw error;
  });
  return acertoPronto;
}

async function acertarTerceiroTurno() {
  if (usesBlob() || dbSource !== "neon") return;
  const sql = await getSql();
  const marca = "2026-11-03";
  const feito = await sql<{ key: string }>`
    select key from grades where date = ${marca} and key = ${"__acerto_terceiro__"} limit 1
  `;
  if (feito.length > 0) return;
  const rows = await sql<{ id: string; date: string; at: number }>`
    select id, date, at from apontamentos where turno = ${"3"}
  `;
  for (const row of rows) {
    const dia = diaOperacional("3", Number(row.at));
    const atual = String(row.date).slice(0, 10);
    if (!dia || dia === atual) continue;
    await sql`update apontamentos set date = ${dia} where id = ${row.id}`;
  }
  await sql`
    insert into grades (date, key, config)
    values (${marca}, ${"__acerto_terceiro__"}, ${JSON.stringify({ em: Date.now() })}::jsonb)
    on conflict (date, key) do nothing
  `;
}

function excelUrl() {
  const raw = process.env.EXCEL_WEBHOOK_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".powerplatform.com")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function excelRow(entry: Entry, solas: 1 | -1) {
  return {
    data: entry.date,
    turno: entry.turno,
    maquina: entry.machine,
    estacao: entry.outroId ? "Outros" : entry.station,
    lado: entry.side === "esq" ? "Esq." : "Dir.",
    problema: problemName(entry.problem),
    numero: entry.matrizNumero,
    referencia: entry.matrizRel,
    preparador: entry.autor,
    solas,
  };
}

async function postExcel(entry: Entry, solas: 1 | -1) {
  const url = excelUrl();
  if (!url) return false;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(excelRow(entry, solas)),
      signal: AbortSignal.timeout(20000),
    });
    return response.status >= 200 && response.status < 300;
  } catch {
    return false;
  }
}

export const enviarPlanilha = createServerFn({ method: "POST" })
  .validator((data: { entry?: unknown; solas?: unknown }) => ({
    entry: coerceEntry(data?.entry),
    solas: data?.solas === -1 ? (-1 as const) : (1 as const),
  }))
  .handler(async ({ data }) => {
    if (!data.entry) return { ok: false as const };
    return { ok: await postExcel(data.entry, data.solas) };
  });

function cleanRemoved(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const entry = coerceEntry(item);
      return entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? [entry] : [];
    })
    .slice(0, 8000);
}

function cleanEntries(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const entry = coerceEntry(item);
      return entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? [entry] : [];
    })
    .slice(0, 8000);
}

function linhaTravada(row: { date: string; turno: string; at: number }) {
  const entry = { date: String(row.date).slice(0, 10), turno: row.turno, at: Number(row.at) };
  return apontamentoBloqueado(entry) || !podeAlterarApontamento(entry);
}

async function gravarLote(
  sql: Awaited<ReturnType<typeof getSql>>,
  removed: Entry[],
  revives: string[],
  upserts: Entry[],
) {
  if (removed.length > 0) {
    const ids = removed.map((item) => item.id);
    const rows = await sql.query<{ id: string; date: string; turno: string; at: number }>(
      "select id, date::text as date, turno, at from apontamentos where id = any($1::text[])",
      [ids],
    );
    const bloqueados = new Set(rows.filter(linhaTravada).map((row) => row.id));
    const apagar = removed.filter((item) => !bloqueados.has(item.id));
    if (apagar.length > 0) {
      const apagarIds = apagar.map((item) => item.id);
      await sql.query("delete from apontamentos where id = any($1::text[])", [apagarIds]);
      await sql.query(
        `insert into apontamentos_removidos (id, date)
         select * from unnest($1::text[], $2::text[])
         on conflict (id) do update set date = excluded.date`,
        [apagarIds, apagar.map((item) => item.date)],
      );
    }
  }
  if (revives.length > 0) {
    await sql.query("delete from apontamentos_removidos where id = any($1::text[])", [revives]);
  }
  const removedIds = new Set(removed.map((item) => item.id));
  const reviveIds = new Set(revives);
  const candidatos = upserts.filter((entry) => !removedIds.has(entry.id));
  if (candidatos.length === 0) return;
  const ids = candidatos.map((entry) => entry.id);
  const [tombs, existentes] = await Promise.all([
    sql.query<{ id: string }>("select id from apontamentos_removidos where id = any($1::text[])", [ids]),
    sql.query<{ id: string; date: string; turno: string; at: number }>(
      "select id, date::text as date, turno, at from apontamentos where id = any($1::text[])",
      [ids],
    ),
  ]);
  const tombados = new Set(tombs.map((row) => row.id));
  const porId = new Map(existentes.map((row) => [row.id, row]));
  const gravar = candidatos.flatMap((entry) => {
    if (!reviveIds.has(entry.id) && tombados.has(entry.id)) return [];
    const row = porId.get(entry.id);
    if (row && linhaTravada(row)) return [];
    const turnoInformado = entry.turno === "1" || entry.turno === "2" || entry.turno === "3" ? entry.turno : turnoPeloRelogio(entry.at);
    const dia = diaOperacional(turnoInformado, Number(entry.at) || Date.now());
    const salvo = row ? entry : { ...entry, date: dia, turno: turnoInformado };
    if (!row && salvo.date !== dia) return [];
    return [salvo];
  });
  if (gravar.length === 0) return;
  await sql.query("delete from apontamentos_removidos where id = any($1::text[])", [gravar.map((entry) => entry.id)]);
  await sql.query(
    `insert into apontamentos (id, date, turno, machine, station, side, problem, at, numero, referencia, autor, outro, cor, cor_nome)
     select * from unnest(
       $1::text[], $2::text[], $3::text[], $4::text[], $5::int[], $6::text[], $7::text[],
       $8::bigint[], $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[]
     )
     on conflict (id) do update set
       date = excluded.date,
       turno = excluded.turno,
       machine = excluded.machine,
       station = excluded.station,
       side = excluded.side,
       problem = excluded.problem,
       at = excluded.at,
       numero = excluded.numero,
       referencia = excluded.referencia,
       autor = excluded.autor,
       outro = excluded.outro,
       cor = excluded.cor,
       cor_nome = excluded.cor_nome`,
    [
      gravar.map((entry) => entry.id),
      gravar.map((entry) => entry.date),
      gravar.map((entry) => entry.turno),
      gravar.map((entry) => entry.machine),
      gravar.map((entry) => entry.station),
      gravar.map((entry) => entry.side),
      gravar.map((entry) => entry.problem),
      gravar.map((entry) => entry.at),
      gravar.map((entry) => entry.matrizNumero),
      gravar.map((entry) => entry.matrizRel),
      gravar.map((entry) => entry.autor),
      gravar.map((entry) => entry.outroId),
      gravar.map((entry) => entry.corId),
      gravar.map((entry) => entry.corNome),
    ],
  );
}

export const pushApontamentos = createServerFn({ method: "POST" })
  .validator((data: { upserts?: unknown; removed?: unknown; grades?: unknown; date?: unknown; outros?: unknown; cores?: unknown; fechamentos?: unknown; producao?: unknown; revives?: unknown; modelos?: unknown }) => ({
    upserts: cleanEntries(data?.upserts),
    removed: cleanRemoved(data?.removed),
    grades: readGrades(data?.grades),
    date: typeof data?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : "",
    outros: readOutros(data?.outros),
    cores: readCores(data?.cores),
    fechamentos: readFechamentos(data?.fechamentos),
    producao: readProducao(data?.producao),
    revives: Array.isArray(data?.revives) ? data.revives.filter((id): id is string => typeof id === "string").slice(0, 2000) : [],
    modelos: readModelos(data?.modelos),
  }))
  .handler(async ({ data }) => {
    if (usesBlob()) {
      await pushDays(
        data.upserts,
        data.removed,
        data.date && Object.keys(data.grades).length > 0 ? { date: data.date, grades: data.grades } : null,
        data.date && data.outros.length > 0 ? { date: data.date, outros: data.outros } : null,
      );
      return { ok: true as const, cloud: true };
    }
    const sql = await getSql();
    await gravarLote(sql, data.removed, data.revives, data.upserts);
    if (data.date) {
      for (const [key, config] of Object.entries(data.grades)) {
        const existing = await sql<{ config: StationConfig }>`
          select config from grades where date = ${data.date} and key = ${key}
        `;
        const prevAt = existing[0]?.config?.salvoEm ?? 0;
        if (existing[0] && prevAt > (config.salvoEm ?? 0)) continue;
        await sql`
          insert into grades (date, key, config)
          values (${data.date}, ${key}, ${JSON.stringify(config)}::jsonb)
          on conflict (date, key) do update set config = excluded.config
        `;
      }
      if (data.outros.length > 0) {
        const existing = await sql<{ config: unknown }>`
          select config from grades where date = ${data.date} and key = ${"__outros__"}
        `;
        const merged = mergeOutros(readOutros(existing[0]?.config), data.outros);
        await sql`
          insert into grades (date, key, config)
          values (${data.date}, ${"__outros__"}, ${JSON.stringify(merged)}::jsonb)
          on conflict (date, key) do update set config = excluded.config
        `;
      }
      if (data.cores.length > 0) {
        const existingCores = await sql<{ config: unknown }>`
          select config from grades where date = ${data.date} and key = ${"__cores__"}
        `;
        const cores = mergeCores(readCores(existingCores[0]?.config), data.cores);
        await sql`
          insert into grades (date, key, config)
          values (${data.date}, ${"__cores__"}, ${JSON.stringify(cores)}::jsonb)
          on conflict (date, key) do update set config = excluded.config
        `;
      }
      if (data.fechamentos.length > 0) {
        const existingFechamentos = await sql<{ config: unknown }>`
          select config from grades where date = ${data.date} and key = ${"__fechamento__"}
        `;
        const fechamentos = mergeFechamentos(readFechamentos(existingFechamentos[0]?.config), data.fechamentos);
        await sql`
          insert into grades (date, key, config)
          values (${data.date}, ${"__fechamento__"}, ${JSON.stringify(fechamentos)}::jsonb)
          on conflict (date, key) do update set config = excluded.config
        `;
      }
      if (data.producao.length > 0) {
        const porData = new Map<string, ProducaoPares[]>();
        for (const item of data.producao) {
          const lista = porData.get(item.date) ?? [];
          lista.push(item);
          porData.set(item.date, lista);
        }
        for (const [date, itens] of porData) {
          const existingProducao = await sql<{ config: unknown }>`
            select config from grades where date = ${date} and key = ${"__producao__"}
          `;
          const producao = mergeProducao(readProducao(existingProducao[0]?.config), itens);
          await sql`
            insert into grades (date, key, config)
            values (${date}, ${"__producao__"}, ${JSON.stringify(producao)}::jsonb)
            on conflict (date, key) do update set config = excluded.config
          `;
        }
      }
    }
    if (data.modelos) {
      const existingModelo = await sql<{ config: unknown }>`
        select config from grades where date = ${"modelos"} and key = ${"__modelos__"}
      `;
      const prev = readModelos(existingModelo[0]?.config);
      if (!prev || data.modelos.salvoEm >= prev.salvoEm) {
        await sql`
          insert into grades (date, key, config)
          values (${"modelos"}, ${"__modelos__"}, ${JSON.stringify(data.modelos)}::jsonb)
          on conflict (date, key) do update set config = excluded.config
        `;
      }
    }
    return { ok: true as const, cloud: cloudOn() };
  });

export const pullApontamentos = createServerFn({ method: "POST" })
  .validator((data: { date?: unknown }) => {
    const date = typeof data?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : "";
    return { date };
  })
  .handler(async ({ data }): Promise<SyncResult> => {
    if (!data.date) return { entries: [], removed: [], grades: {}, outros: [], cores: [], fechamentos: [], producao: [], modelos: null, cloud: cloudOn() };
    if (usesBlob()) {
      const day = await pullDay(data.date);
      return { entries: day.entries, removed: day.removed, grades: day.grades, outros: day.outros, cores: [], fechamentos: [], producao: [], modelos: null, cloud: true };
    }
    await garantirAcerto();
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      date: string;
      turno: string;
      machine: string;
      station: number;
      side: string;
      problem: string;
      at: number;
      numero: string;
      referencia: string;
      autor: string;
      outro: string;
      cor: string;
      cor_nome: string;
    }>`
      select id, date, turno, machine, station, side, problem, at, numero, referencia, autor, outro, cor, cor_nome
      from apontamentos
      where date = ${data.date}
    `;
    const removedRows = await sql<{ id: string }>`
      select id from apontamentos_removidos where date = ${data.date}
    `;
    const entries = rows.flatMap((row) => {
      const entry = coerceEntry({
        id: row.id,
        date: row.date,
        turno: row.turno,
        machine: row.machine,
        station: Number(row.station),
        side: row.side,
        problem: row.problem,
        at: Number(row.at),
        matrizNumero: row.numero,
        matrizRel: row.referencia,
        autor: row.autor,
        outroId: row.outro,
        corId: row.cor,
        corNome: row.cor_nome,
      });
      return entry ? [entry] : [];
    });
    const gradeRows = await sql<{ key: string; config: unknown }>`
      select key, config from grades where date = ${data.date}
    `;
    const outros = readOutros(gradeRows.find((row) => row.key === "__outros__")?.config);
    const cores = readCores(gradeRows.find((row) => row.key === "__cores__")?.config);
    const fechamentos = readFechamentos(gradeRows.find((row) => row.key === "__fechamento__")?.config);
    const producao = readProducao(gradeRows.find((row) => row.key === "__producao__")?.config).filter(
      (item) => item.date === data.date,
    );
    const grades = readGrades(
      Object.fromEntries(
        gradeRows
          .filter((row) => row.key !== "__outros__" && row.key !== "__cores__" && row.key !== "__fechamento__" && row.key !== "__producao__")
          .map((row) => [row.key, row.config]),
      ),
    );
    const modeloRow = await sql<{ config: unknown }>`
      select config from grades where date = ${"modelos"} and key = ${"__modelos__"}
    `;
    return {
      entries,
      removed: removedRows.map((row) => row.id),
      grades,
      outros,
      cores,
      fechamentos,
      producao,
      modelos: readModelos(modeloRow[0]?.config),
      cloud: cloudOn(),
    };
  });

export const pullHistorico = createServerFn({ method: "POST" })
  .validator((data: { ate?: unknown; dias?: unknown; desde?: unknown }) => {
    const ate = typeof data?.ate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.ate) ? data.ate : "";
    const desde = typeof data?.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.desde) ? data.desde : "";
    const dias = typeof data?.dias === "number" && Number.isFinite(data.dias) ? data.dias : 31;
    return { ate, desde, dias: Math.min(31, Math.max(1, Math.floor(dias))) };
  })
  .handler(async ({ data }): Promise<{ entries: Entry[]; producao: ProducaoPares[]; cloud: boolean }> => {
    if (!data.ate) return { entries: [], producao: [], cloud: cloudOn() };
    const datas = data.desde && data.desde <= data.ate ? intervaloDias(data.desde, data.ate) : diasAte(data.ate, data.dias);
    const inicio = datas[0] ?? data.ate;
    if (usesBlob()) {
      const days = await Promise.all(datas.map((date) => pullDay(date)));
      return { entries: days.flatMap((day) => day.entries), producao: [], cloud: true };
    }
    await garantirAcerto();
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      date: string;
      turno: string;
      machine: string;
      station: number;
      side: string;
      problem: string;
      at: number;
      numero: string;
      referencia: string;
      autor: string;
      outro: string;
      cor: string;
      cor_nome: string;
    }>`
      select id, date, turno, machine, station, side, problem, at, numero, referencia, autor, outro, cor, cor_nome
      from apontamentos
      where date >= ${inicio} and date <= ${data.ate}
    `;
    return {
      entries: rows.flatMap((row) => {
        const entry = coerceEntry({
          id: row.id,
          date: String(row.date).slice(0, 10),
          turno: row.turno,
          machine: row.machine,
          station: Number(row.station),
          side: row.side,
          problem: row.problem,
          at: Number(row.at),
          matrizNumero: row.numero,
          matrizRel: row.referencia,
          autor: row.autor,
          outroId: row.outro,
          corId: row.cor,
          corNome: row.cor_nome,
        });
        return entry ? [entry] : [];
      }),
      producao: (
        await sql<{ date: string; config: unknown }>`
          select date, config from grades
          where key = ${"__producao__"} and date >= ${inicio} and date <= ${data.ate}
        `
      )
        .flatMap((row) => readProducao(row.config))
        .filter((item) => item.date >= inicio && item.date <= data.ate),
      cloud: cloudOn(),
    };
  });

export const pullEvolucaoMolde = createServerFn({ method: "POST" })
  .validator((data: {
    machine?: unknown;
    numero?: unknown;
    referencia?: unknown;
    desde?: unknown;
    ate?: unknown;
    turno?: unknown;
    estacao?: unknown;
    lado?: unknown;
    problema?: unknown;
  }) => {
    const machine = parseMachine(data?.machine);
    const numero = typeof data?.numero === "string" ? numeroLimpo(data.numero) : "";
    const referencia = typeof data?.referencia === "string" ? referenciaLimpa(data.referencia) : "";
    const desde = typeof data?.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.desde) ? data.desde : "";
    const ate = typeof data?.ate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.ate) ? data.ate : "";
    const turno = data?.turno === "1" || data?.turno === "2" || data?.turno === "3" || data?.turno === "24" ? data.turno : "24";
    const estacao = typeof data?.estacao === "number" && data.estacao >= 1 && data.estacao <= 8 ? data.estacao : 0;
    const lado = data?.lado === "esq" || data?.lado === "dir" ? data.lado : "";
    const problema = typeof data?.problema === "string" ? data.problema : "";
    return { machine, numero, referencia, desde, ate, turno, estacao, lado, problema };
  })
  .handler(async ({ data }): Promise<{ dias: { date: string; pares: number; motivos: { nome: string; pares: number }[] }[] }> => {
    if (!data.machine || !data.numero || !data.desde || !data.ate || data.desde > data.ate) return { dias: [] };
    if (usesBlob() || dbSource !== "neon") return { dias: [] };
    const sql = await getSql();
    const rows = await sql<{
      date: string;
      station: number;
      side: string;
      problem: string;
      outro: string;
      numero: string;
      referencia: string;
      qtd: number;
    }>`
      select date, station, side, problem, coalesce(outro, '') as outro, numero, referencia, count(*)::int as qtd
      from apontamentos
      where machine = ${data.machine}
        and date >= ${data.desde}
        and date <= ${data.ate}
        and (${data.turno} = '24' or turno = ${data.turno})
        and (${data.estacao} = 0 or station = ${data.estacao})
        and (${data.lado} = '' or side = ${data.lado})
        and (${data.problema} = '' or problem = ${data.problema})
      group by date, station, side, problem, outro, numero, referencia
    `;
    const porDia = new Map<string, Map<string, number>>();
    for (const row of rows) {
      if (numeroLimpo(String(row.numero ?? "")) !== data.numero) continue;
      if (referenciaLimpa(String(row.referencia ?? "")) !== data.referencia) continue;
      const date = String(row.date).slice(0, 10);
      const grupos = porDia.get(date) ?? new Map<string, number>();
      const chave = `${row.station}|${row.side}|${row.problem}|${row.outro ?? ""}`;
      grupos.set(chave, (grupos.get(chave) ?? 0) + Number(row.qtd));
      porDia.set(date, grupos);
    }
    return {
      dias: [...porDia.entries()].map(([date, grupos]) => {
        const porProblema = new Map<string, number>();
        let pares = 0;
        for (const [chave, solas] of grupos) {
          const problema = chave.split("|")[2] ?? "";
          const fechado = solas <= 0 ? 0 : Math.ceil(solas / 2);
          pares += fechado;
          if (fechado > 0) porProblema.set(problema, (porProblema.get(problema) ?? 0) + fechado);
        }
        const motivos = [...porProblema.entries()]
          .map(([id, quantidade]) => ({ nome: problemName(id), pares: quantidade }))
          .sort((a, b) => b.pares - a.pares || a.nome.localeCompare(b.nome, "pt-BR"));
        return { date, pares, motivos };
      }),
    };
  });

function intervaloDias(desde: string, ate: string): string[] {
  const [year, month, day] = desde.split("-").map(Number);
  if (!year || !month || !day) return [ate];
  const cursor = new Date(Date.UTC(year, month - 1, day));
  const dias: string[] = [];
  for (let index = 0; index < 31; index += 1) {
    const mes = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const dia = String(cursor.getUTCDate()).padStart(2, "0");
    const iso = `${cursor.getUTCFullYear()}-${mes}-${dia}`;
    dias.push(iso);
    if (iso >= ate) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}
