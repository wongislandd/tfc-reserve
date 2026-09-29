export type SlotStatus = { has_reservation?: boolean; is_in_past?: boolean; is_out_of_range?: boolean };
type Prediction = { slots: string[]; note: string };

export function slotIsPast(date: string, time: string, status: SlotStatus | undefined, today: string, currentTime: string) {
  return Boolean(status?.is_in_past) || date < today || (date === today && time <= currentTime);
}

export function buildDayAvailability(published: Record<string, SlotStatus>, expected: Prediction | null, value: string, today: string, currentTime: string) {
  const latestPublishedTime = Object.keys(published).filter((time) => !published[time].is_out_of_range).sort().at(-1);
  const unpublishedSlots = expected?.slots.filter((time) => (
    !published[time]
    && (!latestPublishedTime || time > latestPublishedTime)
    && !slotIsPast(value, time, undefined, today, currentTime)
  )) || [];
  const pendingSlots = Object.keys(published).filter((time) => (
    published[time].is_out_of_range
    && !published[time].has_reservation
    && !slotIsPast(value, time, published[time], today, currentTime)
  ));
  const autoBookSlots = [...unpublishedSlots, ...pendingSlots].sort();
  return {
    value,
    prediction: autoBookSlots.length ? {
      slots: autoBookSlots,
      note: unpublishedSlots.length ? expected?.note || "" : "Based on this amenity’s published schedule.",
    } : null,
    daySlots: {
      ...Object.fromEntries(unpublishedSlots.map((time) => [time, {} as SlotStatus])),
      ...published,
    },
  };
}

export type QueuedBooking = {
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  amenity_type_id: number;
  amenity_id: number;
};

export function queuedSlotTimes(items: QueuedBooking[], typeId: number, amenityId: number, date: string) {
  const times = new Set<string>();
  for (const item of items) {
    if (item.status !== "pending" || item.amenity_type_id !== typeId || item.amenity_id !== amenityId || item.booking_date !== date) continue;
    const start = item.start_time.match(/(?:T|^)(\d{2}):(\d{2})/);
    const end = item.end_time.match(/(?:T|^)(\d{2}):(\d{2})/);
    if (!start || !end) continue;
    const endMinutes = Number(end[1]) * 60 + Number(end[2]);
    for (let minute = Number(start[1]) * 60 + Number(start[2]); minute < endMinutes; minute += 30) {
      times.add(`${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
    }
  }
  return [...times].sort();
}
