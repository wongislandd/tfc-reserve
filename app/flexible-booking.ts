// Public request contract and deterministic time selection. No credentials or backend IDs.
export type FlexiblePreferences = {
  version: 1;
  window_start: string;
  window_end: string;
  notice_minutes: number;
  preference: "closest" | "earliest";
  amenity_ids: number[];
};

export type FlexibleTarget = { booking_date: string; start_time: string; end_time: string };
export type CandidateTime = { start_time: string; end_time: string; starts_at: string; ends_at: string; cutoff_at: string };

export function clockMinutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[03]0(?::00)?$/.test(value)) return NaN;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function clock(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function newYorkDate(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// Round-trip the local wall time so nonexistent DST times cannot become bookings.
export function newYorkInstant(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(clockMinutes(time))) return null;
  const wall = `${date}T${time.slice(0, 5)}:00`;
  const naive = Date.parse(`${wall}Z`);
  if (!Number.isFinite(naive)) return null;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  // In the repeated fall-back hour prefer its first occurrence, consistently.
  for (const offset of [4, 5]) {
    const instant = new Date(naive + offset * 60 * 60 * 1000);
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00` === wall) return instant.toISOString();
  }
  return null;
}

export function validateFlexiblePreferences(value: unknown, target: FlexibleTarget): FlexiblePreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Choose your acceptable hours and locations.");
  const p = value as Partial<FlexiblePreferences>;
  const start = clockMinutes(target.start_time), end = clockMinutes(target.end_time);
  const from = clockMinutes(String(p.window_start ?? "")), until = clockMinutes(String(p.window_end ?? ""));
  if (!newYorkInstant(target.booking_date, "12:00") || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Choose a valid date and duration in 30-minute increments.");
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) throw new Error("Acceptable hours must end after they start on the selected date.");
  if (start < from || end > until) throw new Error("Include the entire preferred time in your acceptable hours.");
  if (p.version !== 1 || ![0, 30, 60, 120, 240].includes(p.notice_minutes as number)) throw new Error("Choose a valid notice period.");
  if (p.preference !== "closest" && p.preference !== "earliest") throw new Error("Choose how to rank openings.");
  if (!Array.isArray(p.amenity_ids) || p.amenity_ids.length === 0 || p.amenity_ids.length > 20 || p.amenity_ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Choose at least one acceptable location.");
  return { version: 1, window_start: clock(from), window_end: clock(until), notice_minutes: p.notice_minutes!, preference: p.preference, amenity_ids: [...new Set(p.amenity_ids)] };
}

export function candidateTimes(target: FlexibleTarget, preferences: FlexiblePreferences, nowMs: number): CandidateTime[] {
  const p = validateFlexiblePreferences(preferences, target);
  const preferred = clockMinutes(target.start_time);
  const duration = clockMinutes(target.end_time) - preferred;
  const candidates: CandidateTime[] = [];
  for (let start = clockMinutes(p.window_start); start + duration <= clockMinutes(p.window_end); start += 30) {
    const startsAt = newYorkInstant(target.booking_date, clock(start));
    const endsAt = newYorkInstant(target.booking_date, clock(start + duration));
    if (!startsAt || !endsAt || Date.parse(endsAt) - Date.parse(startsAt) !== duration * 60_000) continue;
    const cutoff = Date.parse(startsAt) - p.notice_minutes * 60_000;
    if (cutoff <= nowMs) continue;
    candidates.push({ start_time: clock(start), end_time: clock(start + duration), starts_at: startsAt, ends_at: endsAt, cutoff_at: new Date(cutoff).toISOString() });
  }
  return candidates.sort((a, b) => {
    const left = clockMinutes(a.start_time), right = clockMinutes(b.start_time);
    if (p.preference === "earliest") return left - right;
    return Math.abs(left - preferred) - Math.abs(right - preferred) || right - left;
  });
}

export function defaultFlexiblePreferences(start: string, end: string, amenityIds: number[]): FlexiblePreferences {
  return { version: 1, window_start: start.slice(0, 5), window_end: end.slice(0, 5), notice_minutes: 120, preference: "closest", amenity_ids: amenityIds };
}
