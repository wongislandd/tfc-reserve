import assert from "node:assert/strict";
import test from "node:test";
import { buildDayAvailability, slotIsPast } from "../app/slot-availability.ts";

const today = "2026-09-07";
const expected = { slots: ["09:00", "10:00", "10:30", "11:00", "11:30"], note: "Posted hours." };
const build = (published, date = today) => buildDayAvailability(published, expected, date, today, "10:00");

test("today's unpublished later times are selectable auto-book slots", () => {
  const day = build({ "10:30": {} });
  assert.deepEqual(day.prediction.slots, ["11:00", "11:30"]);
  assert.deepEqual(day.daySlots["11:00"], {});
  assert.equal(day.daySlots["09:00"], undefined);
  assert.equal(day.daySlots["10:00"], undefined);
});

test("listed slots outside the booking window are queued even on today's date", () => {
  const day = build({ "10:30": {}, "11:00": { is_out_of_range: true } });
  assert.ok(day.prediction.slots.includes("11:00"));
  assert.ok(!day.prediction.slots.includes("10:30"));
});

test("booked and past statuses are preserved and excluded from auto-booking", () => {
  const published = {
    "09:00": { is_out_of_range: true },
    "10:00": { is_out_of_range: true },
    "10:30": { is_out_of_range: true, has_reservation: true },
    "11:00": { is_out_of_range: true, is_in_past: true },
    "11:30": {},
  };
  const day = build(published);
  assert.equal(day.prediction, null);
  assert.deepEqual(day.daySlots, published);
  assert.equal(slotIsPast(today, "09:00", {}, today, "10:00"), true);
  assert.equal(slotIsPast(today, "10:00", {}, today, "10:00"), true);
  assert.equal(slotIsPast(today, "11:00", published["11:00"], today, "10:00"), true);
});

test("a fully unpublished day includes only future times today, and all hours on future dates", () => {
  assert.deepEqual(build({}).prediction.slots, ["10:30", "11:00", "11:30"]);
  assert.deepEqual(build({}, "2026-09-08").prediction.slots, expected.slots);
  assert.equal(build({}, "2026-09-06").prediction, null);
});

test("ordinary open slots remain immediate bookings and published gaps stay closed", () => {
  const day = build({ "10:30": {}, "11:30": {} });
  assert.equal(day.prediction, null);
  assert.equal(day.daySlots["11:00"], undefined);
  assert.equal(slotIsPast(today, "10:30", {}, today, "10:00"), false);
});

import { queuedSlotTimes } from "../app/slot-availability.ts";

test("queued ranges cover every half hour and match date, type, and court", () => {
  const booking = { booking_date: today, start_time: "11:00:00", end_time: "12:00:00", status: "pending", amenity_type_id: 1, amenity_id: 2 };
  const items = [booking, { ...booking }, { ...booking, start_time: "13:00", end_time: "14:00", status: "cancelled" }, { ...booking, amenity_id: 3, start_time: "14:00", end_time: "15:00" }];
  assert.deepEqual(queuedSlotTimes(items, 1, 2, today), ["11:00", "11:30"]);
  assert.deepEqual(queuedSlotTimes(items, 9, 2, today), []);
  assert.deepEqual(queuedSlotTimes(items, 1, 2, "2026-09-08"), []);
  for (const status of ["completed", "failed", "cancelled"]) assert.deepEqual(queuedSlotTimes([{ ...booking, status }], 1, 2, today), []);
});

test("queued times support timestamp values and recurring occurrences", () => {
  const booking = { booking_date: today, start_time: `${today}T11:00:00-04:00`, end_time: `${today}T11:30:00-04:00`, status: "pending", amenity_type_id: 1, amenity_id: 2 };
  assert.deepEqual(queuedSlotTimes([booking, { ...booking, booking_date: "2026-09-08" }], 1, 2, "2026-09-08"), ["11:00"]);
});
