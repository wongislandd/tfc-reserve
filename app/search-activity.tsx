export type SearchEvent = { at: string; kind: string; message: string; court?: string; start?: string; end?: string };

function timestamp(value: string, timeOnly = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return date.toLocaleString("en-US", { timeZone: "America/New_York", ...(timeOnly ? {} : { month: "short", day: "numeric" }), hour: "numeric", minute: "2-digit" });
}

export default function SearchActivity({ events = [] }: { events?: SearchEvent[] }) {
  return <details className="search-activity">
    <summary>Activity{events.length ? ` · ${events.length}` : ""}</summary>
    <p>Recent activity · New York time. Routine checks appear at most once an hour; “Last checked” shows the latest completed check.</p>
    {events.length ? <ol>{events.slice().reverse().map((event, index) => <li key={`${event.at}-${index}`}>
      <time dateTime={event.at}>{timestamp(event.at)} ET</time>
      <span>{event.message}</span>
      {event.court && <span className="activity-detail">{event.court}{event.start && event.end ? ` · ${timestamp(event.start, true)}–${timestamp(event.end, true)}` : ""}</span>}
    </li>)}</ol> : <p>No activity recorded yet. History begins with this update; earlier checks are not included.</p>}
    {events.length >= 100 && <p>Showing the latest 100 events.</p>}
  </details>;
}
