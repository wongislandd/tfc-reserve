import assert from "node:assert/strict";
import test from "node:test";
import { sortScheduledBookings } from "../app/scheduled-bookings.ts";

test("queued bookings sort by date and time before recent history", () => {
  const items = [
    { id: "oct", status: "pending", booking_date: "2026-10-11", start_time: "14:00" },
    { id: "old-failure", status: "failed", booking_date: "2026-09-03", start_time: "07:00" },
    { id: "late", status: "pending", booking_date: "2026-09-14", start_time: "18:30:00" },
    { id: "early", status: "pending", booking_date: "2026-09-14", start_time: "2026-09-14T09:00:00-04:00" },
    { id: "recent-success", status: "success", booking_date: "2026-09-13", start_time: "12:00" },
  ];
  assert.deepEqual(sortScheduledBookings(items).map(x => x.id), ["early", "late", "oct", "recent-success", "old-failure"]);
  assert.equal(items[0].id, "oct");
});

test("history sorts newest time first and ties have a stable order", () => {
  const items = [
    { id: "b", status: "failed", booking_date: "2026-09-07", start_time: "08:00" },
    { id: "c", status: "success", booking_date: "2026-09-07", start_time: "10:00" },
    { id: "a", status: "failed", booking_date: "2026-09-07", start_time: "08:00" },
  ];
  assert.deepEqual(sortScheduledBookings(items).map(x => x.id), ["c", "a", "b"]);
});
