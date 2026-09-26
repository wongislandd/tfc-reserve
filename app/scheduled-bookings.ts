type ScheduledEntry = { id: string; status: string; booking_date: string; start_time: string };

// Upcoming work comes first; finished attempts follow with the most recent first.
export function sortScheduledBookings<T extends ScheduledEntry>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aPending = a.status === "pending";
    const bPending = b.status === "pending";
    if (aPending !== bPending) return aPending ? -1 : 1;
    const dateOrder = a.booking_date.localeCompare(b.booking_date);
    const timeOrder = (a.start_time.match(/(?:T|^)(\d{2}:\d{2})/)?.[1] || a.start_time)
      .localeCompare(b.start_time.match(/(?:T|^)(\d{2}:\d{2})/)?.[1] || b.start_time);
    return (aPending ? 1 : -1) * (dateOrder || timeOrder) || a.id.localeCompare(b.id);
  });
}
