import type { Entry, StationConfig } from "@/lib/perdas";
import { apontamentoBloqueado, coerceEntry, podeAlterarApontamento, readGrades, todayISO, turnoPeloRelogio } from "@/lib/perdas";

type DayBag = { entries: Entry[]; removed: string[]; grades: Record<string, StationConfig> };

const emptyDay = (): DayBag => ({ entries: [], removed: [], grades: {} });

export function applyDayChanges(
  day: DayBag,
  upserts: Entry[],
  removed: { id: string; date: string }[],
  grades: Record<string, StationConfig> = {},
): DayBag {
  const gone = new Set(day.removed);
  const agora = Date.now();
  const fechado = (entry: Entry) => apontamentoBloqueado(entry) || !podeAlterarApontamento(entry, agora);
  for (const item of removed) {
    const current = day.entries.find((entry) => entry.id === item.id);
    if (current && fechado(current)) continue;
    gone.add(item.id);
  }
  const map = new Map<string, Entry>();
  for (const entry of day.entries) {
    if (!gone.has(entry.id)) map.set(entry.id, entry);
  }
  const removedNow = new Set(
    removed
      .filter((item) => {
        const current = day.entries.find((entry) => entry.id === item.id);
        return !(current && fechado(current));
      })
      .map((item) => item.id),
  );
  for (const entry of upserts) {
    if (removedNow.has(entry.id)) continue;
    const prev = map.get(entry.id);
    if (prev && fechado(prev)) continue;
    const next = { ...entry };
    if (!prev) {
      const hoje = todayISO(new Date(agora));
      const quando = todayISO(new Date(entry.at));
      if (quando !== hoje) continue;
      next.date = quando;
      next.turno = turnoPeloRelogio(entry.at);
    }
    gone.delete(entry.id);
    map.set(entry.id, next);
  }
  const nextGrades = { ...day.grades };
  for (const [key, config] of Object.entries(readGrades(grades))) {
    const prevAt = nextGrades[key]?.salvoEm ?? 0;
    const nextAt = config.salvoEm ?? 0;
    if (nextGrades[key] && prevAt > nextAt) continue;
    nextGrades[key] = config;
  }
  return {
    entries: [...map.values()],
    removed: [...gone],
    grades: nextGrades,
  };
}

function pathFor(date: string) {
  return `apontamentos/${date}.json`;
}

async function readDay(date: string): Promise<{ bag: DayBag; etag: string | null }> {
  const { get } = await import("@vercel/blob");
  const result = await get(pathFor(date), { access: "private", useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) return { bag: emptyDay(), etag: null };
  const text = await new Response(result.stream).text();
  const parsed = JSON.parse(text) as { entries?: unknown; removed?: unknown; grades?: unknown };
  const entries = Array.isArray(parsed.entries)
    ? parsed.entries.flatMap((item) => {
        const entry = coerceEntry(item);
        return entry ? [entry] : [];
      })
    : [];
  const removed = Array.isArray(parsed.removed)
    ? parsed.removed.filter((id): id is string => typeof id === "string")
    : [];
  return { bag: { entries, removed, grades: readGrades(parsed.grades) }, etag: result.blob.etag };
}

function etagForms(etag: string | null): Array<string | null> {
  if (!etag) return [null];
  const bare = etag.replace(/^W\//, "").replace(/^"|"$/g, "");
  const forms = [etag, bare, `"${bare}"`].filter((item, index, list) => item && list.indexOf(item) === index);
  return [...forms, null];
}

async function writeDay(date: string, bag: DayBag, etag: string | null) {
  const { put } = await import("@vercel/blob");
  const body = JSON.stringify(bag);
  let lastError: unknown;
  for (const match of etagForms(etag)) {
    try {
      await put(pathFor(date), body, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
        ...(match ? { ifMatch: match } : {}),
      });
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : "";
      if (!match || !/etag|precondition/i.test(message)) throw error;
    }
  }
  throw lastError;
}

export async function pullDay(date: string): Promise<DayBag> {
  const current = await readDay(date);
  return current.bag;
}

export async function pushDays(
  upserts: Entry[],
  removed: { id: string; date: string }[],
  grades: { date: string; grades: Record<string, StationConfig> } | null = null,
) {
  const dates = new Set([...upserts.map((entry) => entry.date), ...removed.map((item) => item.date)]);
  if (grades?.date) dates.add(grades.date);
  for (const date of dates) {
    const dayUpserts = upserts.filter((entry) => entry.date === date);
    const dayRemoved = removed.filter((item) => item.date === date);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await readDay(date);
      const next = applyDayChanges(
        current.bag,
        dayUpserts,
        dayRemoved,
        grades?.date === date ? grades.grades : {},
      );
      try {
        await writeDay(date, next, current.etag);
        break;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
  }
}
