import { createServerFn } from "@tanstack/react-start";
import { pullDay, pushDays } from "@/lib/apontamentos-blob";
import { dbSource, getSql } from "@/lib/db";
import { apontamentoBloqueado, coerceEntry, podeAlterarApontamento, problemName, readGrades, todayISO, turnoPeloRelogio, type Entry, type StationConfig } from "@/lib/perdas";

type SyncResult = {
  entries: Entry[];
  removed: string[];
  grades: Record<string, StationConfig>;
  cloud: boolean;
};

function usesBlob() {
  return dbSource !== "neon" && Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function cloudOn() {
  return dbSource === "neon" || Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
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
    estacao: entry.station,
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
    .slice(0, 2000);
}

function cleanEntries(value: unknown): Entry[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const entry = coerceEntry(item);
      return entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? [entry] : [];
    })
    .slice(0, 2000);
}

export const pushApontamentos = createServerFn({ method: "POST" })
  .validator((data: { upserts?: unknown; removed?: unknown; grades?: unknown; date?: unknown }) => ({
    upserts: cleanEntries(data?.upserts),
    removed: cleanRemoved(data?.removed),
    grades: readGrades(data?.grades),
    date: typeof data?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : "",
  }))
  .handler(async ({ data }) => {
    if (usesBlob()) {
      await pushDays(
        data.upserts,
        data.removed,
        data.date && Object.keys(data.grades).length > 0 ? { date: data.date, grades: data.grades } : null,
      );
      return { ok: true as const, cloud: true };
    }
    const sql = await getSql();
    for (const item of data.removed) {
      const existing = await sql<{ date: string; turno: string; at: number }>`
        select date, turno, at from apontamentos where id = ${item.id}
      `;
      const row = existing[0];
      if (row && (apontamentoBloqueado({ date: row.date, turno: row.turno, at: Number(row.at) }) || !podeAlterarApontamento({ date: row.date, turno: row.turno, at: Number(row.at) }))) continue;
      await sql`delete from apontamentos where id = ${item.id}`;
      await sql`
        insert into apontamentos_removidos (id, date)
        values (${item.id}, ${item.date})
        on conflict (id) do update set date = excluded.date
      `;
    }
    const removedIds = new Set(data.removed.map((item) => item.id));
    for (const entry of data.upserts) {
      if (removedIds.has(entry.id)) continue;
      const existing = await sql<{ date: string; turno: string; at: number }>`
        select date, turno, at from apontamentos where id = ${entry.id}
      `;
      const row = existing[0];
      if (row && (apontamentoBloqueado({ date: row.date, turno: row.turno, at: Number(row.at) }) || !podeAlterarApontamento({ date: row.date, turno: row.turno, at: Number(row.at) }))) continue;
      const salvo = row
        ? entry
        : { ...entry, date: todayISO(new Date(entry.at)), turno: turnoPeloRelogio(entry.at) };
      if (!row && salvo.date !== todayISO()) continue;
      await sql`delete from apontamentos_removidos where id = ${entry.id}`;
      await sql`
        insert into apontamentos (id, date, turno, machine, station, side, problem, at, numero, referencia, autor)
        values (
          ${salvo.id}, ${salvo.date}, ${salvo.turno}, ${salvo.machine}, ${salvo.station}, ${salvo.side},
          ${salvo.problem}, ${salvo.at}, ${salvo.matrizNumero}, ${salvo.matrizRel}, ${salvo.autor}
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
          autor = excluded.autor
      `;
    }
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
    }
    return { ok: true as const, cloud: cloudOn() };
  });

export const pullApontamentos = createServerFn({ method: "POST" })
  .validator((data: { date?: unknown }) => {
    const date = typeof data?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : "";
    return { date };
  })
  .handler(async ({ data }): Promise<SyncResult> => {
    if (!data.date) return { entries: [], removed: [], grades: {}, cloud: cloudOn() };
    if (usesBlob()) {
      const day = await pullDay(data.date);
      return { entries: day.entries, removed: day.removed, grades: day.grades, cloud: true };
    }
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
    }>`
      select id, date, turno, machine, station, side, problem, at, numero, referencia, autor
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
      });
      return entry ? [entry] : [];
    });
    const gradeRows = await sql<{ key: string; config: unknown }>`
      select key, config from grades where date = ${data.date}
    `;
    const grades = readGrades(
      Object.fromEntries(gradeRows.map((row) => [row.key, row.config])),
    );
    return { entries, removed: removedRows.map((row) => row.id), grades, cloud: cloudOn() };
  });
