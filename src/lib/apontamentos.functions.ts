import { createServerFn } from "@tanstack/react-start";
import { pullDay, pushDays } from "@/lib/apontamentos-blob";
import { dbSource, getSql } from "@/lib/db";
import { coerceEntry, type Entry } from "@/lib/perdas";

type SyncResult = { entries: Entry[]; removed: string[]; cloud: boolean };

function usesBlob() {
  return dbSource !== "neon" && Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function cloudOn() {
  return dbSource === "neon" || Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

function cleanRemoved(value: unknown): { id: string; date: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { id?: unknown; date?: unknown };
      if (typeof row.id !== "string" || row.id.length === 0 || row.id.length > 80) return [];
      if (typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return [];
      return [{ id: row.id, date: row.date }];
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
  .validator((data: { upserts?: unknown; removed?: unknown }) => ({
    upserts: cleanEntries(data?.upserts),
    removed: cleanRemoved(data?.removed),
  }))
  .handler(async ({ data }) => {
    if (usesBlob()) {
      await pushDays(data.upserts, data.removed);
      return { ok: true as const, cloud: true };
    }
    const sql = await getSql();
    for (const item of data.removed) {
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
      await sql`delete from apontamentos_removidos where id = ${entry.id}`;
      await sql`
        insert into apontamentos (id, date, turno, machine, station, side, problem, at, numero, referencia, autor)
        values (
          ${entry.id}, ${entry.date}, ${entry.turno}, ${entry.machine}, ${entry.station}, ${entry.side},
          ${entry.problem}, ${entry.at}, ${entry.matrizNumero}, ${entry.matrizRel}, ${entry.autor}
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
    return { ok: true as const, cloud: cloudOn() };
  });

export const pullApontamentos = createServerFn({ method: "POST" })
  .validator((data: { date?: unknown }) => {
    const date = typeof data?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : "";
    return { date };
  })
  .handler(async ({ data }): Promise<SyncResult> => {
    if (!data.date) return { entries: [], removed: [], cloud: cloudOn() };
    if (usesBlob()) {
      const day = await pullDay(data.date);
      return { entries: day.entries, removed: day.removed, cloud: true };
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
    return { entries, removed: removedRows.map((row) => row.id), cloud: cloudOn() };
  });
