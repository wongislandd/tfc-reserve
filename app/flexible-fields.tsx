"use client";

import { useId } from "react";
import type { FlexiblePreferences } from "./flexible-booking";

export default function FlexibleFields({ value, onChange, amenities }: { value: FlexiblePreferences; onChange: (value: FlexiblePreferences) => void; amenities: { id: number; label: string }[] }) {
  const id = useId();
  return <div className="flexible-fields">
    <div className="field"><label htmlFor={`${id}-from`}>Earliest start</label><input id={`${id}-from`} type="time" step="1800" value={value.window_start} onChange={e => onChange({ ...value, window_start: e.target.value })} /></div>
    <div className="field"><label htmlFor={`${id}-until`}>Finish by</label><input id={`${id}-until`} type="time" step="1800" value={value.window_end} onChange={e => onChange({ ...value, window_end: e.target.value })} /></div>
    <div className="field"><label htmlFor={`${id}-rank`}>Which opening should we take?</label><select id={`${id}-rank`} value={value.preference} onChange={e => onChange({ ...value, preference: e.target.value as FlexiblePreferences["preference"] })}><option value="closest">Closest to my preferred time</option><option value="earliest">Any opening — earliest available start</option></select><small>Earlier and later times both qualify. We book an available match without waiting for a better one.</small></div>
    <div className="field"><label htmlFor={`${id}-notice`}>Notice before the start</label><select id={`${id}-notice`} value={value.notice_minutes} onChange={e => onChange({ ...value, notice_minutes: Number(e.target.value) })}><option value={0}>No notice needed</option><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={240}>4 hours</option></select><small>Each possible start has its own cutoff. Times that have started are never booked.</small></div>
    <fieldset className="location-choices"><legend>Acceptable locations</legend>{amenities.map(amenity => <label key={amenity.id}><input type="checkbox" checked={value.amenity_ids.includes(amenity.id)} onChange={e => onChange({ ...value, amenity_ids: e.target.checked ? [...value.amenity_ids, amenity.id] : value.amenity_ids.filter(id => id !== amenity.id) })} />{amenity.label}</label>)}</fieldset>
    <p className="flexible-explanation">All times are New York time, on the selected date. The full reservation must fit inside these hours. We check for cancellations until we book one complete reservation or all start times pass their cutoffs.</p>
  </div>;
}
