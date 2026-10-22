import type { Entry, StationConfig } from "@/lib/perdas";
import { coerceEntry, readGrades } from "@/lib/perdas";

type DayBag = { entries: Entry[]; removed: string[]; grades: Record<string, StationConfig> };

const emptyDay = (): DayBag => ({ entries: [], removed: [], grades: {} });

export function applyDayChanges(
  day: DayBag,
  upserts: Entry[],
  removed: { id: string; date: string }[],
  grades: Record<string, StationConfig> = {},
): DayBag {
  const gone = new Set(day.removed);
  for (const item of removed) gone.add(item.id);
  const map = new Map<string, Entry>();
  for (const entry of day.entries) {
    if (!gone.has(entry.id)) map.set(entry.id, entry);
  }
  const removedNow = new Set(removed.map((item) => item.id));
  for (const entry of upserts) {
    if (removedNow.has(entry.id)) continue;
    gone.delete(entry.id);
    map.set(entry.id, entry);
  }
  return {
    entries: [...map.values()],
    removed: [...gone],
    grades: { ...day.grades, ...readGrades(grades) },
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

async function writeDay(date: string, bag: DayBag, etag: string | null) {
  const { put } = await import("@vercel/blob");
  await put(pathFor(date), JSON.stringify(bag), {
    access: "private",
    addRandomSuffix: false,
    contentType: "application/json",
    ...(etag ? { ifMatch: etag } : {}),
  });
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
