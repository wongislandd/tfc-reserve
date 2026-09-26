"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import FlexibleFields from "./flexible-fields";
import { appPath } from "./app-path";
import { buildDayAvailability, queuedSlotTimes, slotIsPast, type SlotStatus } from "./slot-availability";
import { sortScheduledBookings } from "./scheduled-bookings";
import { candidateTimes, clockMinutes, defaultFlexiblePreferences, newYorkDate, validateFlexiblePreferences, type FlexiblePreferences } from "./flexible-booking";

type View = "book" | "reservations" | "scheduled";
type Recurrence = "once" | "daily" | "weekdays" | "weekly";
type ScheduleWindow = { day_of_week: number; is_open: boolean; open_time: string; close_time: string };
type AmenityType = {
  id: number;
  name: string;
  description?: string;
  rules?: string | null;
  open_time?: string;
  close_time?: string;
  schedule_set?: ScheduleWindow[];
  max_reservation_length?: string | null;
  is_allow_guests?: boolean;
  max_number_guests?: number;
};
type Amenity = { id: number; label: string; is_active: boolean };
type Schedule = Record<string, Record<string, Record<string, SlotStatus>>>;
type Reservation = { id: number; amenity?: { label?: string }; start_time: string; end_time: string; guests?: number; is_cancelled?: boolean };
type Scheduled = { flexible_preferences?: FlexiblePreferences | null; monitor_state?: string | null; last_checked_at?: string | null; booked_start_time?: string | null; booked_end_time?: string | null; booked_amenity_label?: string | null; booking_intent?: unknown; id: string; booking_date: string; start_time: string; end_time: string; status: string; error_message?: string | null; amenity_type_id: number; amenity_id: number; amenity_label?: string | null; release_time?: string | null; held_reservation_id?: string | null; held_start_time?: string | null; held_end_time?: string | null; recurrence_group_id?: string | null; recurrence_frequency?: Exclude<Recurrence, "once"> | null; recurrence_occurrence_index?: number | null; recurrence_occurrence_count?: number | null };

const api = async (path: string, init?: RequestInit) => {
  const response = await fetch(appPath(`/api/reservations/${path}`), init);
  const text = await response.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return { error: text }; } })() : {};
  if (response.status === 401 && body.needs_login && typeof window !== "undefined") {
    window.dispatchEvent(new Event("tfc-session-expired"));
  }
  if (!response.ok) throw new Error(body.error || body.detail || `Request failed (${response.status})`);
  return body;
};

function localDateValue(date = new Date()) {
  const local = new Date(date);
  local.setHours(12, 0, 0, 0);
  return local.toLocaleDateString("en-CA");
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDateValue(date);
}

function startOfWeek(value: string) {
  const date = new Date(`${value}T12:00:00`);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  return localDateValue(date);
}

function weekDateValues(weekStart: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

function weekLabel(weekStart: string) {
  const start = new Date(`${weekStart}T12:00:00`);
  const end = new Date(`${addDays(weekStart, 6)}T12:00:00`);
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${startLabel}–${end.getDate()}, ${end.getFullYear()}`;
  }
  const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return start.getFullYear() === end.getFullYear()
    ? `${startLabel}–${endLabel}, ${end.getFullYear()}`
    : `${startLabel}, ${start.getFullYear()}–${endLabel}, ${end.getFullYear()}`;
}

function isOutsideBookingWindow(value: string) {
  const bookingDate = new Date(`${value}T12:00:00`);
  const windowEnd = new Date();
  windowEnd.setHours(12, 0, 0, 0);
  windowEnd.setDate(windowEnd.getDate() + 7);
  return bookingDate > windowEnd;
}

function prettyTime(value: string) {
  const match = value.match(/T?(\d{2}):(\d{2})/);
  if (!match) return value;
  const hour = Number(match[1]);
  return `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? "PM" : "AM"}`;
}

function minutes(value: string) { const [h, m] = value.split(":").map(Number); return h * 60 + m; }
function plusThirty(value: string) { const total = minutes(value) + 30; return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }
function amenityKey(typeId: number, amenityId: number) { return `${typeId}:${amenityId}`; }
function shortAmenityLabel(label: string) {
  const trailingNumber = label.match(/(?:court|room|grill|cabana)?\s*#?(\d+)$/i)?.[1];
  return trailingNumber ? `Court ${trailingNumber}` : label;
}
function normalizeTime(value?: string) {
  const match = value?.match(/(?:T|^)(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : null;
}
function slotsBetween(open?: string, close?: string) {
  const start = normalizeTime(open);
  const end = normalizeTime(close);
  if (!start || !end || minutes(start) >= minutes(end)) return [];
  const result: string[] = [];
  for (let cursor = start; minutes(cursor) < minutes(end); cursor = plusThirty(cursor)) result.push(cursor);
  return result;
}
function maxReservationMinutes(value?: string | null) {
  if (!value) return 30;
  const clock = value.match(/^(\d{1,2}):(\d{2})/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const numeric = value.match(/\d+/);
  return numeric ? Number(numeric[0]) : 30;
}
function predictedSlots(amenitySchedule: Record<string, Record<string, SlotStatus>>, targetDate: string, type: AmenityType) {
  const targetDay = new Date(`${targetDate}T12:00:00`).getDay();
  const publishedDays = Object.entries(amenitySchedule)
    .filter(([publishedDate, day]) => publishedDate < targetDate && Object.keys(day).length > 0)
    .map(([publishedDate, day]) => {
      const inRange = Object.entries(day).filter(([, status]) => !status.is_out_of_range).map(([time]) => time).sort();
      return { publishedDate, slots: inRange.length ? inRange : Object.keys(day).sort() };
    });
  const sameWeekday = publishedDays.filter(({ publishedDate }) => new Date(`${publishedDate}T12:00:00`).getDay() === targetDay);
  const candidates = sameWeekday.length ? sameWeekday : publishedDays;
  const template = candidates.sort((a, b) => b.slots.length - a.slots.length || b.publishedDate.localeCompare(a.publishedDate))[0];
  if (template?.slots.length) {
    return { slots: template.slots, note: `Based on the published hours for ${new Date(`${template.publishedDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}.` };
  }

  const dailyWindow = type.schedule_set?.find((window) => window.is_open && (
    window.day_of_week === targetDay || (targetDay === 0 && window.day_of_week === 7)
  ));
  const hours = slotsBetween(dailyWindow?.open_time || type.open_time, dailyWindow?.close_time || type.close_time);
  return { slots: hours, note: "Based on this amenity’s posted opening hours." };
}
function nyOffset(date: string) {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "longOffset" }).formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value;
  return (part || "GMT-05:00").replace("GMT", "") || "-05:00";
}
function recurrenceLabel(value: Recurrence | Scheduled["recurrence_frequency"]) {
  if (value === "daily") return "Every day";
  if (value === "weekdays") return "Every weekday";
  if (value === "weekly") return "Every week";
  return "Does not repeat";
}

export default function ReservationApp() {
  const [checking, setChecking] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [displayName, setDisplayName] = useState("Resident");
  const [serviceOffline, setServiceOffline] = useState(false);

  useEffect(() => {
    fetch(appPath("/api/session")).then((r) => r.json()).then((d) => {
      setSignedIn(Boolean(d.authenticated));
      setServiceOffline(d.serviceAvailable === false);
      if (d.displayName) setDisplayName(d.displayName);
    }).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const handleExpiredSession = () => {
      setSignedIn(false);
      setDisplayName("Resident");
    };
    window.addEventListener("tfc-session-expired", handleExpiredSession);
    return () => window.removeEventListener("tfc-session-expired", handleExpiredSession);
  }, []);

  if (checking) return <div className="loading-screen"><div className="loading-mark">R</div></div>;
  if (!signedIn) return <Login serviceOffline={serviceOffline} onSuccess={(name) => { setDisplayName(name || "Resident"); setSignedIn(true); }} />;
  return <Dashboard displayName={displayName} onSignOut={() => { setSignedIn(false); setDisplayName("Resident"); }} />;
}

function Login({ onSuccess, serviceOffline }: { onSuccess: (name?: string) => void; serviceOffline: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsOccupant, setNeedsOccupant] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = { username: form.get("username"), password: form.get("password"), occupant_id: form.get("occupant_id") || undefined };
    try {
      const response = await fetch(appPath("/api/session"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) { if (body.needs_occupant_id) setNeedsOccupant(true); throw new Error(body.error || "Sign in failed"); }
      onSuccess(body.display_name);
    } catch (e) { setError(e instanceof Error ? e.message : "Sign in failed"); }
    finally { setBusy(false); }
  }

  return <main className="login-page">
    <section className="login-panel">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">TFC Amenities</div>
        <h1>Sign in</h1>
        <p>Use your TFC resident portal credentials.</p>
        {(error || serviceOffline) && <div className="error-box" role="alert">{error || "Reservations are temporarily offline while the database is being moved."}</div>}
        <div className="field"><label htmlFor="username">Email or username</label><input id="username" name="username" autoComplete="username" required /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required /></div>
        {needsOccupant && <div className="field"><label htmlFor="occupant_id">Occupant ID</label><input id="occupant_id" name="occupant_id" inputMode="numeric" pattern="[0-9]+" required /><small>You can find this number in the URL when viewing a reservation on my.tfc.com.</small></div>}
        <button className="primary-button" disabled={busy || serviceOffline}>{busy ? "Signing in…" : serviceOffline ? "Service offline" : "Continue"}</button>
        <div className="privacy-note">Your password is not stored in this browser.</div>
      </form>
    </section>
  </main>;
}

function Dashboard({ displayName, onSignOut }: { displayName: string; onSignOut: () => void }) {
  const [view, setView] = useState<View>("book");
  const [types, setTypes] = useState<AmenityType[]>([]);
  const [upcoming, setUpcoming] = useState<Reservation[]>([]);
  const [past, setPast] = useState<Reservation[]>([]);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [amenityLabels, setAmenityLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [t, u, p, s] = await Promise.all([api("amenity-types"), api("reservations/upcoming"), api("reservations/past"), api("reservations/scheduled")]);
      const nextTypes: AmenityType[] = t.results || [];
      const nextScheduled: Scheduled[] = s.results || [];
      const unresolvedTypeIds = Array.from(new Set(nextScheduled.filter((item) => !item.amenity_label).map((item) => item.amenity_type_id)));
      const resolvedGroups = await Promise.all(unresolvedTypeIds.map(async (typeId) => {
        try {
          const amenities: Amenity[] = await api(`club-amenities?type=${typeId}`);
          return amenities.map((amenity) => [amenityKey(typeId, amenity.id), amenity.label] as const);
        } catch {
          return [];
        }
      }));
      const savedLabels = nextScheduled.flatMap((item) => item.amenity_label
        ? [[amenityKey(item.amenity_type_id, item.amenity_id), item.amenity_label] as const]
        : []);
      setAmenityLabels(Object.fromEntries([...savedLabels, ...resolvedGroups.flat()]));
      setTypes(nextTypes); setUpcoming(u.results || []); setPast(p.results || []); setScheduled(nextScheduled);
    } catch (e) { setMessage({ text: e instanceof Error ? e.message : "Could not load reservations", error: true }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 30_000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [refresh]);

  async function signOut() { await fetch(appPath("/api/session"), { method: "DELETE" }); onSignOut(); }
  const nav = [{ id: "book" as const, symbol: "＋", label: "Book an amenity" }, { id: "reservations" as const, symbol: "◷", label: "My reservations" }, { id: "scheduled" as const, symbol: "◇", label: "Auto-book queue" }];

  return <div className="app-frame">
    <aside className="sidebar">
      <div className="wordmark"><span className="wordmark-seal">T</span><span>TFC Amenities</span></div>
      <nav className="nav" aria-label="Main navigation">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span className="nav-symbol">{item.symbol}</span>{item.label}</button>)}</nav>
      <div className="sidebar-footer"><strong>{displayName}</strong><span>Resident account</span><br /><button className="text-button" onClick={signOut}>Sign out</button></div>
    </aside>
    <section className="main">
      <header className="topbar"><p>{new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p><button className="top-action" onClick={refresh}>Refresh</button></header>
      <div className="content">
        {message && <div className={`notice ${message.error ? "error" : ""}`} role="status">{message.text}</div>}
        {view === "book" && <BookView types={types} scheduled={scheduled} loading={loading} onBooked={async (text) => { setMessage({ text }); await refresh(); }} />}
        {view === "reservations" && <ReservationsView upcoming={upcoming} past={past} loading={loading} onCancel={async (id) => { await api(`cancel?id=${id}`, { method: "POST" }); setMessage({ text: "Reservation cancelled." }); await refresh(); }} />}
        {view === "scheduled" && <ScheduledView items={scheduled} types={types} amenityLabels={amenityLabels} loading={loading} onUpdated={refresh} onCancel={async (id, scope) => { await api(`cancel-scheduled?id=${id}${scope === "series" ? "&scope=series" : ""}`, { method: "POST" }); setMessage({ text: scope === "series" ? "Remaining series bookings removed." : "Auto-booking removed." }); await refresh(); }} />}
      </div>
    </section>
    <nav className="mobile-nav" aria-label="Mobile navigation">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>{item.symbol}<br />{item.label.replace(" an amenity", "")}</button>)}</nav>
  </div>;
}

function BookView({ types, scheduled, loading, onBooked }: { types: AmenityType[]; scheduled: Scheduled[]; loading: boolean; onBooked: (message: string) => Promise<void> }) {
  const now = new Date();
  const today = newYorkDate(now);
  const currentTime = now.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const [type, setType] = useState<AmenityType | null>(null);
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [amenity, setAmenity] = useState<Amenity | null>(null);
  const [schedule, setSchedule] = useState<Schedule>({});
  const [date, setDate] = useState(today);
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const [slots, setSlots] = useState<string[]>([]);
  const [guests, setGuests] = useState(0);
  const [recurrence, setRecurrence] = useState<Recurrence>("once");
  const [occurrenceCount, setOccurrenceCount] = useState(4);
  const [flexible, setFlexible] = useState(false);
  const [preferences, setPreferences] = useState<FlexiblePreferences>(defaultFlexiblePreferences("11:00", "18:00", []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function chooseType(next: AmenityType) {
    setType(next); setAmenity(null); setSlots([]); setFlexible(false); setError("");
    try { const [a, s] = await Promise.all([api(`club-amenities?type=${next.id}`), api(`schedule?type=${next.id}`)]); setAmenities(a || []); setAmenity((a || [])[0] || null); setSchedule(s.results || {}); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load availability"); }
  }
  const selectedWeekday = new Date(`${date}T12:00:00`).getDay();
  const selectedDateIsWeekend = selectedWeekday === 0 || selectedWeekday === 6;
  const selectedDateLabel = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const visibleDates = weekDateValues(weekStart);
  const availabilityByAmenity = amenities.map((option) => {
    const amenitySchedule = schedule[option.label] || {};
    const days = visibleDates.map((value) => {
      const published = amenitySchedule[value] || {};
      const expected = value >= today && type
        ? predictedSlots(amenitySchedule, value, type)
        : null;
      const day = buildDayAvailability(published, expected, value, today, currentTime);
      const queuedSlots = type ? queuedSlotTimes(scheduled, type.id, option.id, value) : [];
      return {
        ...day,
        queuedSlots,
        daySlots: { ...Object.fromEntries(queuedSlots.map((time) => [time, {} as SlotStatus])), ...day.daySlots },
      };
    });
    return { amenity: option, days };
  });
  const selectedAmenityAvailability = availabilityByAmenity.find((item) => item.amenity.id === amenity?.id);
  const selectedDay = selectedAmenityAvailability?.days.find((day) => day.value === date);
  const prediction = selectedDay?.prediction || null;
  const selectionIncludesPrediction = slots.some((slot) => prediction?.slots.includes(slot));
  const selectionIncludesQueued = slots.some((slot) => selectedDay?.queuedSlots.includes(slot));
  const autoBookDate = isOutsideBookingWindow(date) || selectionIncludesPrediction;
  const calendarTimes = Array.from(new Set(availabilityByAmenity.flatMap((item) => item.days.flatMap((day) => Object.keys(day.daySlots))))).sort();
  const maxLength = maxReservationMinutes(type?.max_reservation_length);
  function toggleSlot(slot: string) {
    setSlots((current) => {
      if (current.includes(slot)) return current.filter((s) => s !== slot);
      if (current.length === 1 && maxLength >= 60 && Math.abs(minutes(slot) - minutes(current[0])) === 30) return [...current, slot].sort();
      return [slot];
    });
  }
  function chooseDate(nextDate: string) {
    if (!nextDate || nextDate < today) return;
    setDate(nextDate);
    setWeekStart(startOfWeek(nextDate));
    setSlots([]);
    if (recurrence === "weekdays" && [0, 6].includes(new Date(`${nextDate}T12:00:00`).getDay())) setRecurrence("once");
  }
  function moveWeek(amount: number) {
    const nextDate = addDays(date, amount);
    chooseDate(nextDate < today ? today : nextDate);
  }
  function chooseCalendarSlot(nextDate: string, slot: string, nextAmenity: Amenity) {
    if (nextDate !== date || nextAmenity.id !== amenity?.id) {
      setDate(nextDate);
      setAmenity(nextAmenity);
      setSlots([slot]);
      if (recurrence === "weekdays" && [0, 6].includes(new Date(`${nextDate}T12:00:00`).getDay())) setRecurrence("once");
      return;
    }
    toggleSlot(slot);
  }
  async function submit() {
    if (!type || !amenity || slots.length === 0) return;
    if (selectionIncludesQueued) { setError("This time is already queued for auto-booking."); return; }
    const submittedAt = new Date();
    const submittedTime = submittedAt.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (!flexible && slots.some(slot => slotIsPast(date, slot, selectedDay?.daySlots[slot], newYorkDate(submittedAt), submittedTime))) { setError("This time has already started. Choose a later slot."); return; }
    setBusy(true); setError("");
    const start = slots[0]; const end = plusThirty(slots[slots.length - 1]);
    try {
      let flexiblePreferences: FlexiblePreferences | undefined;
      if (flexible) {
        flexiblePreferences = validateFlexiblePreferences(preferences, { booking_date: date, start_time: start, end_time: end });
        if (!candidateTimes({ booking_date: date, start_time: start, end_time: end }, flexiblePreferences, submittedAt.getTime()).length) throw new Error("All acceptable starts have passed their notice cutoff.");
      }
      if (flexible || autoBookDate || recurrence !== "once") {
        await api("schedule-auto-book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ booking_date: date, start_time: start, end_time: end, amenity_type_id: type.id, amenity_id: amenity.id, amenity_label: amenity.label, guests, flexible_preferences: flexiblePreferences, recurrence: recurrence === "once" ? undefined : { frequency: recurrence, count: occurrenceCount } }) });
        await onBooked(flexible
          ? `Flexible search started${recurrence !== "once" ? ` for ${occurrenceCount} dates` : ""}. We’ll book one matching reservation per date and stop.`
          : recurrence === "once"
          ? `Auto-booking queued for ${amenity.label} on ${date}. We’ll start trying when the reservation window opens.`
          : `${occurrenceCount} bookings queued for ${amenity.label}, ${recurrenceLabel(recurrence).toLowerCase()} starting ${date}.`);
      } else {
        const offset = nyOffset(date);
        await api("book", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ start_time: `${date}T${start}:00${offset}`, end_time: `${date}T${end}:00${offset}`, amenity_id: amenity.id, amenity_reservation_type: "TR", guests, is_text_amenity_reservation: false }) });
        await onBooked(`Reservation confirmed for ${amenity.label} on ${date}.`);
      }
      setSlots([]); setGuests(0); setRecurrence("once"); setOccurrenceCount(4); setFlexible(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Booking failed"); }
    finally { setBusy(false); }
  }

  return <>
    <div className="page-heading"><div><span className="section-label">Booking</span><h1>Book an amenity</h1></div><p>Scan the week, or jump to any future date.</p></div>
    {error && <div className="notice error">{error}</div>}
    <div className="booking-layout">
      <div className="card card-pad amenity-picker"><h2 className="card-title">Amenities</h2><p className="card-subtitle">Choose a space</p><div className="amenity-list">{loading ? <p>Loading amenities…</p> : types.map((item) => <button className={`amenity-button ${type?.id === item.id ? "active" : ""}`} key={item.id} onClick={() => chooseType(item)}><span><strong>{item.name}</strong><span>{item.description || "View availability"}</span></span><b>›</b></button>)}</div></div>
      <div className="card card-pad schedule-card">
        {!type ? <div className="empty-panel"><div><span className="big-symbol">01</span><strong>Select an amenity</strong><p>Availability will appear here.</p></div></div> : <div className="booking-form">
          {type.is_allow_guests && <div className="field"><label>Guests</label><select value={guests} onChange={(e) => setGuests(Number(e.target.value))}>{Array.from({ length: (type.max_number_guests || 0) + 1 }, (_, i) => <option key={i}>{i}</option>)}</select></div>}
          <div className="flexible-toggle wide"><label><input type="checkbox" checked={flexible} onChange={e => { setFlexible(e.target.checked); if (e.target.checked) setPreferences(defaultFlexiblePreferences(slots[0] || "11:00", slots.length ? plusThirty(slots[slots.length - 1]) : "18:00", amenities.filter(a => a.is_active !== false).map(a => a.id))); }} />Find another time if my preference is unavailable</label><p>Watch earlier or later times, including cancellations. Turn this on to select an already-booked time to watch.</p></div>
          <div className="field wide availability-field">
            <div className="schedule-toolbar">
              <div><span>Availability</span><strong>{weekLabel(weekStart)}</strong></div>
              <div className="schedule-actions">
                <div className="week-nav"><button type="button" aria-label="Previous week" disabled={weekStart <= startOfWeek(today)} onClick={() => moveWeek(-7)}>‹</button><button type="button" onClick={() => chooseDate(today)}>Today</button><button type="button" aria-label="Next week" onClick={() => moveWeek(7)}>›</button></div>
                <label className="jump-date" htmlFor="booking-date"><span>Jump to date</span><input id="booking-date" type="date" min={today} value={date} onChange={(event) => chooseDate(event.target.value)} /></label>
              </div>
            </div>
            <div className="calendar-legend" aria-label="Availability legend"><span><i className="open" />Open</span><span><i className="selected" />Selected</span><span><i className="booked" />Booked</span><span><i className="queued" />Queued</span><span><i className="predicted" />Open · predicted</span><span><i className="unavailable" />Unavailable</span></div>
            {calendarTimes.length ? <div className="week-calendar-scroll"><div className="week-calendar" role="grid" aria-label={`Availability for ${weekLabel(weekStart)}`}>
              <div className="calendar-corner" />
              {visibleDates.map((dayValue) => { const dayDate = new Date(`${dayValue}T12:00:00`); const predicted = availabilityByAmenity.some((item) => item.days.find((day) => day.value === dayValue)?.prediction); return <button type="button" key={dayValue} className={`calendar-day-header ${date === dayValue ? "active" : ""} ${dayValue === today ? "today" : ""} ${dayValue < today ? "past" : ""}`} onClick={() => chooseDate(dayValue)} disabled={dayValue < today}><span>{dayDate.toLocaleDateString("en-US", { weekday: "short" })}</span><strong>{dayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</strong>{predicted ? <small>Auto</small> : null}</button>; })}
              {calendarTimes.map((time) => <div className="calendar-row" key={time}>
                <div className="calendar-time">{prettyTime(time)}</div>
                {visibleDates.map((dayValue) => <div className={`calendar-cell-group ${dayValue < today ? "past" : ""}`} key={`${dayValue}-${time}`}>{availabilityByAmenity.map((item) => { const day = item.days.find((candidate) => candidate.value === dayValue); const status = day?.daySlots[time]; const predictedSlot = Boolean(day?.prediction?.slots.includes(time)); const queued = Boolean(day?.queuedSlots.includes(time)); const booked = Boolean(status?.has_reservation); const past = slotIsPast(dayValue, time, status, today, currentTime); const unavailable = !status || past || queued || (!flexible && booked); const active = !queued && item.amenity.id === amenity?.id && dayValue === date && slots.includes(time); const label = `${item.amenity.label}, ${new Date(`${dayValue}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} at ${prettyTime(time)}`; const stateLabel = queued ? "Queued" : active ? "Selected" : booked ? (flexible ? "Watch" : "Booked") : past && status ? "Past" : status && !unavailable ? "Open" : "—"; const ariaState = queued ? ", queued for auto-booking" : booked ? ", booked" : past ? ", in the past" : unavailable ? ", unavailable" : predictedSlot ? ", open based on predicted hours" : ", available"; return <button type="button" key={item.amenity.id} className={`court-slot ${queued ? "queued" : ""} ${!status ? "closed" : ""} ${unavailable ? "unavailable" : ""} ${booked ? "booked" : ""} ${past ? "past" : ""} ${predictedSlot ? "predicted" : ""} ${active ? "active" : ""}`} disabled={unavailable} aria-label={`${label}${ariaState}`} onClick={() => chooseCalendarSlot(dayValue, time, item.amenity)}><strong>{shortAmenityLabel(item.amenity.label)}</strong><span>{stateLabel}</span></button>; })}</div>)}
              </div>)}
            </div></div> : <div className="calendar-empty">No hours are available for this week. Try another week or choose a different amenity.</div>}
          </div>
          {flexible && <section className="flexible-panel wide" aria-label="Flexible auto-book preferences">
            <h2 className="card-title">Flexible auto-book</h2>
            <p className="card-subtitle">Choose your preferred time, then widen the hours you can accept. You can close this page; the search runs automatically.</p>
            <div className="flexible-fields">
              <div className="field"><label htmlFor="preferred-start">Preferred start</label><input id="preferred-start" type="time" step="1800" value={slots[0] || ""} onChange={e => { const start = e.target.value; if (Number.isFinite(clockMinutes(start))) setSlots(slots.length > 1 && clockMinutes(start) < 23 * 60 ? [start, plusThirty(start)] : [start]); }} /></div>
              <div className="field"><label htmlFor="preferred-duration">Duration</label><select id="preferred-duration" value={Math.max(1, slots.length) * 30} onChange={e => { if (slots[0]) setSlots(Number(e.target.value) === 60 ? [slots[0], plusThirty(slots[0])] : [slots[0]]); }}><option value={30}>30 minutes</option>{maxLength >= 60 && <option value={60}>1 hour</option>}</select></div>
            </div>
            <FlexibleFields value={preferences} onChange={setPreferences} amenities={amenities.filter(a => a.is_active !== false)} />
            <p className="flexible-explanation">We reserve the complete duration once it is available, then stop. Your chosen location is tried first when it is included above.</p>
          </section>}
          <div className="field"><label htmlFor="recurrence">Repeat</label><select id="recurrence" value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}><option value="once">Does not repeat</option><option value="daily">Every day</option><option value="weekdays" disabled={selectedDateIsWeekend}>Every weekday</option><option value="weekly">Every week</option></select></div>
          {recurrence !== "once" ? <div className="field"><label htmlFor="occurrences">Occurrences</label><select id="occurrences" value={occurrenceCount} onChange={(e) => setOccurrenceCount(Number(e.target.value))}>{[2, 4, 6, 8, 12].map((count) => <option value={count} key={count}>{count} bookings</option>)}</select></div> : <div className="recurrence-help"><strong>Optional series</strong><span>Repeat this date and time daily, on weekdays, or weekly.</span></div>}
          {selectionIncludesPrediction && prediction?.slots.length ? <div className="prediction-note wide"><strong>Unpublished time on {selectedDateLabel}</strong><span>Portico has not published this time yet. {prediction.note} We’ll queue it now and try automatically as the slot rolls out.</span></div> : null}
          {!flexible && (autoBookDate || recurrence !== "once") && slots.length > 1 && <div className="hold-note wide"><strong>First-slot hold</strong><span>For each date, we’ll reserve {prettyTime(slots[0])} as soon as it opens. When {prettyTime(slots[1])} opens, we’ll cancel that hold and immediately reserve the full {prettyTime(slots[0])}–{prettyTime(plusThirty(slots[1]))} range.</span></div>}
          {type.rules && <div className="form-rule wide"><span className="rule-check" aria-hidden="true">✓</span><span>The {type.name} reservation rules are accepted automatically when you book.</span></div>}
          <div className="booking-summary wide"><div><small>Your selection</small><strong>{amenity?.label || "Choose a location"}{slots.length ? ` · ${new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · ${prettyTime(slots[0])}–${prettyTime(plusThirty(slots[slots.length - 1]))}` : ""}{recurrence !== "once" ? ` · ${recurrenceLabel(recurrence)} × ${occurrenceCount}` : ""}</strong></div><button className="primary-button" disabled={busy || !amenity || slots.length === 0 || selectionIncludesQueued} onClick={submit}>{busy ? "Saving…" : flexible ? "Start watching" : recurrence !== "once" ? "Queue series" : autoBookDate ? "Queue auto-book" : "Reserve now"}</button></div>
        </div>}
      </div>
    </div>
  </>;
}

function ReservationsView({ upcoming, past, loading, onCancel }: { upcoming: Reservation[]; past: Reservation[]; loading: boolean; onCancel: (id: number) => Promise<void> }) {
  return <><div className="page-heading"><div><span className="section-label">Bookings</span><h1>My reservations</h1></div><p>Upcoming and past reservations.</p></div><h2 className="card-title">Upcoming</h2><p className="card-subtitle">Confirmed with TFC</p>{loading ? <p>Loading…</p> : upcoming.length ? <div className="reservation-grid">{upcoming.map((r) => <ReservationCard key={r.id} item={r} onCancel={() => onCancel(r.id)} />)}</div> : <div className="card empty-panel"><div><span className="big-symbol">00</span><strong>No upcoming reservations</strong><p>Confirmed bookings will appear here.</p></div></div>}{past.length > 0 && <><h2 className="card-title" style={{ marginTop: 42 }}>Past</h2><div className="reservation-grid">{past.slice(0, 6).map((r) => <ReservationCard key={r.id} item={r} />)}</div></>}</>;
}

function ReservationCard({ item, onCancel }: { item: Reservation; onCancel?: () => Promise<void> }) {
  const date = new Date(item.start_time);
  return <article className="card reservation-card"><div className="date-block"><span>{date.toLocaleDateString("en-US", { month: "short" })}</span><strong>{date.getDate()}</strong></div><div><h3>{item.amenity?.label || "Amenity reservation"}</h3><p>{prettyTime(item.start_time)}–{prettyTime(item.end_time)}{item.guests ? ` · ${item.guests} guest${item.guests > 1 ? "s" : ""}` : ""}</p></div>{onCancel ? <button className="danger-button" onClick={onCancel}>Cancel</button> : <span className="badge">Completed</span>}</article>;
}

function ScheduledView({ items, types, amenityLabels, loading, onUpdated, onCancel }: { items: Scheduled[]; types: AmenityType[]; amenityLabels: Record<string, string>; loading: boolean; onUpdated: () => Promise<void>; onCancel: (id: string, scope: "occurrence" | "series") => Promise<void> }) {
  const typeLabels = Object.fromEntries(types.map((type) => [type.id, type.name]));
  const [editing, setEditing] = useState<Scheduled | null>(null);
  const [actionError, setActionError] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  async function stop(id: string, scope: "occurrence" | "series") {
    setWorking(id); setActionError("");
    try { await onCancel(id, scope); } catch (error) { setActionError(error instanceof Error ? error.message : "Could not stop this search."); }
    finally { setWorking(null); }
  }
  return <>
    <div className="page-heading"><div><span className="section-label">Automation</span><h1>Scheduled bookings</h1></div><p>Upcoming auto-bookings and searches watching for openings.</p></div>
    {actionError && <div className="notice error" role="alert">{actionError}</div>}
    {editing && <MonitorEditor key={editing.id} item={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await onUpdated(); }} />}
    {loading && !items.length ? <p>Loading…</p> : items.length ? <div className="reservation-grid">{sortScheduledBookings(items).map((item) => {
      const date = new Date(`${item.booking_date}T12:00:00`);
      const amenityLabel = item.amenity_label || amenityLabels[amenityKey(item.amenity_type_id, item.amenity_id)] || typeLabels[item.amenity_type_id] || "Amenity reservation";
      return <article className="card reservation-card" key={item.id}>
        <div className="date-block"><span>{date.toLocaleDateString("en-US", { month: "short" })}</span><strong>{date.getDate()}</strong></div>
        <div>
          <h3>{item.booked_amenity_label || amenityLabel}</h3>
          {item.flexible_preferences && <span className={`badge ${item.status}`} role="status">{({ watching: "Watching for openings", needs_login: "Sign in to resume", review_required: "Check your reservations", booked: "Booked", expired: "Search ended", stopped: "Stopped" } as Record<string, string>)[item.monitor_state || "watching"]}</span>}
          {item.recurrence_group_id && <span className="series-label">{recurrenceLabel(item.recurrence_frequency)} · {item.recurrence_occurrence_index} of {item.recurrence_occurrence_count}</span>}
          {item.flexible_preferences && <p>{(clockMinutes(item.end_time) - clockMinutes(item.start_time))} minutes · {prettyTime(item.flexible_preferences.window_start)}–{prettyTime(item.flexible_preferences.window_end)} · {item.flexible_preferences.notice_minutes} min notice<br />{item.flexible_preferences.preference === "earliest" ? "Any opening, earliest first" : "Closest available to preferred time"}{item.last_checked_at && <><br />Last checked {new Date(item.last_checked_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET</>}</p>}
          {item.booked_start_time && item.booked_end_time && <p>Confirmed: {new Date(item.booked_start_time).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}–{new Date(item.booked_end_time).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" })}</p>}
          <p>{item.flexible_preferences ? "Preferred: " : ""}{prettyTime(item.start_time)}–{prettyTime(item.end_time)}{item.held_reservation_id ? <><br />Holding {prettyTime(item.held_start_time || item.start_time)}–{prettyTime(item.held_end_time || plusThirty(item.start_time))} while the full range opens.</> : item.error_message ? <><br />{item.error_message}</> : null}</p>
        </div>
        <div className="card-actions">
          {item.status === "pending" ? <><button className="danger-button" disabled={working === item.id} onClick={() => void stop(item.id, "occurrence")}>{item.flexible_preferences ? "Stop searching" : "Remove"}</button>{item.recurrence_group_id && !item.flexible_preferences && <button className="quiet-button" disabled={working === item.id} onClick={() => { if (window.confirm("Remove every remaining booking in this series?")) void stop(item.id, "series"); }}>Remove series</button>}</> : !item.flexible_preferences && <span className={`badge ${item.status}`}>{item.status}</span>}
          {item.status !== "pending" && !item.flexible_preferences && <button className="danger-button" disabled={working !== null} title="Remove this queue entry. Confirmed reservations remain unchanged." onClick={() => void stop(item.id, "occurrence")}>Remove</button>}
          {item.status !== "success" && !item.held_reservation_id && !item.booking_intent && (item.flexible_preferences || item.status === "failed") && item.booking_date >= newYorkDate() && <button className="quiet-button" onClick={() => setEditing(item)}>{item.flexible_preferences ? "Edit search" : "Find another time"}</button>}
        </div>
      </article>;
    })}</div> : <div className="card empty-panel"><div><span className="big-symbol">00</span><strong>No scheduled bookings</strong><p>Future booking requests will appear here.</p></div></div>}
  </>;
}

function MonitorEditor({ item, onClose, onSaved }: { item: Scheduled; onClose: () => void; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState<FlexiblePreferences>(item.flexible_preferences || defaultFlexiblePreferences(item.start_time, item.end_time, [item.amenity_id]));
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    api(`club-amenities?type=${item.amenity_type_id}`).then(data => { if (active) setAmenities(data.filter((a: Amenity) => a.is_active !== false)); }).catch(() => { if (active) setError("Could not load locations. Close and try again."); });
    return () => { active = false; };
  }, [item.amenity_type_id]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const preferences = validateFlexiblePreferences(value, item);
      if (!candidateTimes(item, preferences, Date.now()).length) throw new Error("All acceptable starts have passed their notice cutoff.");
      await api("update-monitor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, flexible_preferences: preferences }) });
      await onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save this search."); }
    finally { setBusy(false); }
  }
  return <form className="card card-pad monitor-editor" onSubmit={save} aria-label="Edit flexible search">
    <h2 className="card-title">Find a time on {item.booking_date}</h2>
    <p className="card-subtitle">Prefer {prettyTime(item.start_time)}–{prettyTime(item.end_time)}. These changes apply only to this date.</p>
    {error && <div className="notice error" role="alert">{error}</div>}
    <FlexibleFields value={value} onChange={setValue} amenities={amenities} />
    <div className="editor-actions"><button className="quiet-button" type="button" disabled={busy} onClick={onClose}>Close</button><button className="primary-button" disabled={busy || !amenities.length}>{busy ? "Saving…" : "Save and start watching"}</button></div>
  </form>;
}
