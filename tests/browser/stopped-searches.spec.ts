import { test, expect, type Page } from "@playwright/test";

const preferences = {
  version: 1,
  window_start: "01:00",
  window_end: "18:00",
  notice_minutes: 120,
  preference: "closest",
  amenity_ids: [1, 2],
};

type QueueEntry = Record<string, unknown> & { id: string; amenity_label: string };
type Mutation = { method: string; path: string; query: string; body: unknown };

function stopped(id: string, label: string, overrides: Record<string, unknown> = {}): QueueEntry {
  return {
    id,
    amenity_label: label,
    booking_date: "2026-10-25",
    start_time: "14:00",
    end_time: "15:00",
    amenity_type_id: 1,
    amenity_id: 1,
    status: "failed",
    monitor_state: "stopped",
    flexible_preferences: preferences,
    error_message: "Search stopped. Existing reservations are unchanged.",
    ...overrides,
  };
}

function card(page: Page, label: string) {
  return page.getByRole("article").filter({ has: page.getByRole("heading", { name: label, exact: true }) });
}

async function mockQueue(page: Page, entries: QueueEntry[]) {
  await page.clock.setFixedTime(new Date("2026-10-19T12:00:00-04:00"));
  const state = {
    entries: structuredClone(entries),
    mutations: [] as Mutation[],
    failNext: new Map<string, string>(),
    pauseNext: new Map<string, Promise<void>>(),
  };
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/tfc-amenities(?=\/)/, "");
    let body: unknown = { results: [] };
    if (request.method() === "POST") {
      state.mutations.push({ method: request.method(), path, query: url.search, body: request.postData() ? request.postDataJSON() : null });
    }
    const pause = state.pauseNext.get(path);
    if (pause) {
      state.pauseNext.delete(path);
      await pause;
    }
    if (request.method() === "POST") {
      const error = state.failNext.get(path);
      if (error) {
        state.failNext.delete(path);
        await route.fulfill({ status: 409, json: { error } });
        return;
      }
    }
    if (path === "/api/session") body = { authenticated: true, displayName: "Resident", serviceAvailable: true };
    else if (path.endsWith("/amenity-types")) body = { results: [{ id: 1, name: "Tennis", max_reservation_length: "01:00", open_time: "07:00", close_time: "22:00" }] };
    else if (path.endsWith("/club-amenities")) body = [{ id: 1, label: "Tennis Court 1", is_active: true }, { id: 2, label: "Tennis Court 2", is_active: true }];
    else if (path.endsWith("/reservations/scheduled")) body = { results: state.entries };
    else if (path.endsWith("/update-monitor")) {
      const update = request.postDataJSON();
      state.entries = state.entries.map(entry => entry.id === update.id ? {
        ...entry,
        flexible_preferences: update.flexible_preferences,
        status: "pending",
        monitor_state: "watching",
        error_message: "Watching for openings",
      } : entry);
      body = { success: true };
    } else if (path.endsWith("/cancel-scheduled")) {
      const id = url.searchParams.get("id");
      state.entries = state.entries.flatMap(entry => entry.id !== id ? [entry] : url.searchParams.get("action") === "remove" ? [] : [{
        ...entry,
        status: "failed",
        monitor_state: "stopped",
        error_message: "Search stopped. Existing reservations are unchanged.",
      }]);
      body = { success: true };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(process.env.TFC_BROWSER_BASE_PATH || "/");
  await page.getByRole("button", { name: /Auto-book queue/ }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Scheduled bookings", exact: true })).toBeVisible();
  return state;
}

for (const width of [1280, 390]) {
  test.describe(`stopped searches at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test("resume, stop, and remove only the selected occurrence", async ({ page }) => {
      const target = stopped("stopped-occurrence", "Stopped occurrence", {
        recurrence_group_id: "weekly-series",
        recurrence_frequency: "weekly",
        recurrence_occurrence_index: 4,
        recurrence_occurrence_count: 12,
      });
      const sibling = stopped("next-occurrence", "Next occurrence", {
        booking_date: "2026-11-01",
        recurrence_group_id: "weekly-series",
        recurrence_frequency: "weekly",
        recurrence_occurrence_index: 5,
        recurrence_occurrence_count: 12,
      });
      const active = stopped("active", "Active search", { status: "pending", monitor_state: "watching", error_message: "Watching for openings" });
      const booked = stopped("booked", "Booked search", { status: "success", monitor_state: "booked", error_message: null, booked_start_time: "2026-10-25T18:00:00Z", booked_end_time: "2026-10-25T19:00:00Z" });
      const state = await mockQueue(page, [target, sibling, active, booked]);
      const targetCard = card(page, target.amenity_label);

      await expect(targetCard.getByText("Stopped", { exact: true })).toBeVisible();
      await expect(targetCard.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toBeVisible();
      await targetCard.screenshot({ path: `work/stopped-search-${width}.png` });
      await targetCard.getByRole("button", { name: "Resume search", exact: true }).click();
      await expect(targetCard.getByText("Watching for openings", { exact: true }).first()).toBeVisible();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toHaveCount(0);
      await expect(targetCard.getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
      expect(state.mutations).toEqual([{
        method: "POST", path: "/api/reservations/update-monitor", query: "",
        body: { id: target.id, flexible_preferences: preferences },
      }]);

      await targetCard.getByRole("button", { name: "Stop searching", exact: true }).click();
      await expect(targetCard.getByText("Stopped", { exact: true })).toBeVisible();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toBeEnabled();
      await targetCard.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(targetCard).toHaveCount(0);
      expect(state.mutations.slice(1)).toEqual([
        { method: "POST", path: "/api/reservations/cancel-scheduled", query: `?id=${target.id}`, body: null },
        { method: "POST", path: "/api/reservations/cancel-scheduled", query: `?id=${target.id}&action=remove`, body: null },
      ]);
      expect(state.entries).toEqual([sibling, active, booked]);
      await expect(card(page, sibling.amenity_label).getByRole("button", { name: "Resume search", exact: true })).toBeVisible();
      await expect(card(page, active.amenity_label).getByRole("button", { name: "Stop searching", exact: true })).toBeVisible();
      await expect(card(page, booked.amenity_label).getByText("Booked", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test("failed resume and remove keep the stopped search available for retry", async ({ page }) => {
      const target = stopped("retry-search", "Retry search");
      const state = await mockQueue(page, [target]);
      const targetCard = card(page, target.amenity_label);
      state.failNext.set("/api/reservations/update-monitor", "Could not resume this search. Try again.");
      await targetCard.getByRole("button", { name: "Resume search", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Could not resume this search. Try again.");
      await expect(targetCard.getByText("Stopped", { exact: true })).toBeVisible();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toBeEnabled();
      await expect(targetCard.getByRole("button", { name: "Remove", exact: true })).toBeEnabled();
      expect(state.entries).toEqual([target]);

      await targetCard.getByRole("button", { name: "Resume search", exact: true }).click();
      await expect(targetCard.getByRole("button", { name: "Stop searching", exact: true })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await targetCard.getByRole("button", { name: "Stop searching", exact: true }).click();
      await expect(targetCard.getByText("Stopped", { exact: true })).toBeVisible();

      state.failNext.set("/api/reservations/cancel-scheduled", "Could not remove this search. Try again.");
      await targetCard.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("Could not remove this search. Try again.");
      await expect(targetCard.getByText("Stopped", { exact: true })).toBeVisible();
      await expect(targetCard.getByRole("button", { name: "Remove", exact: true })).toBeEnabled();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toBeEnabled();
      expect(state.entries).toEqual([target]);

      await targetCard.getByRole("button", { name: "Remove", exact: true }).click();
      await expect(targetCard).toHaveCount(0);
      await expect(page.getByText("No scheduled bookings", { exact: true })).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(state.mutations).toHaveLength(5);
      expect(state.entries).toEqual([]);
    });

    test("locks queue actions until resume finishes", async ({ page }) => {
      const target = stopped("resume-in-flight", "Search being resumed");
      const active = stopped("other-active", "Another active search", { status: "pending", monitor_state: "watching", error_message: "Watching for openings" });
      const state = await mockQueue(page, [target, active]);
      let releaseResume!: () => void;
      state.pauseNext.set("/api/reservations/update-monitor", new Promise<void>(resolve => { releaseResume = resolve; }));
      const targetCard = card(page, target.amenity_label);

      await targetCard.getByRole("button", { name: "Resume search", exact: true }).click();
      await expect.poll(() => state.mutations.length).toBe(1);
      await expect(targetCard.getByText("Stopped", { exact: true })).toBeVisible();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toBeDisabled();
      await expect(targetCard.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
      await expect(targetCard.getByRole("button", { name: "Edit search", exact: true })).toBeDisabled();
      await expect(card(page, active.amenity_label).getByRole("button", { name: "Stop searching", exact: true })).toBeDisabled();
      expect(state.entries).toEqual([target, active]);

      releaseResume();
      await expect(targetCard.getByRole("button", { name: "Stop searching", exact: true })).toBeEnabled();
      await expect(card(page, active.amenity_label).getByRole("button", { name: "Stop searching", exact: true })).toBeEnabled();
      expect(state.mutations).toHaveLength(1);
    });

    test("an editor locks stale card actions through save and refresh", async ({ page }) => {
      const target = stopped("editing-search", "Search being edited");
      const active = stopped("other-active", "Another active search", { status: "pending", monitor_state: "watching", error_message: "Watching for openings" });
      const state = await mockQueue(page, [target, active]);
      const targetCard = card(page, target.amenity_label);
      const activeCard = card(page, active.amenity_label);

      await targetCard.getByRole("button", { name: "Edit search", exact: true }).click();
      const editor = page.getByRole("form", { name: "Edit flexible search" });
      await expect(editor.getByRole("button", { name: "Save and start watching", exact: true })).toBeEnabled();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toBeDisabled();
      await expect(targetCard.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
      await expect(activeCard.getByRole("button", { name: "Stop searching", exact: true })).toBeDisabled();
      await editor.getByRole("button", { name: "Close", exact: true }).click();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toBeEnabled();
      await expect(activeCard.getByRole("button", { name: "Stop searching", exact: true })).toBeEnabled();

      await targetCard.getByRole("button", { name: "Edit search", exact: true }).click();
      await editor.getByLabel("Earliest start", { exact: true }).fill("10:00");
      let releaseSave!: () => void;
      let releaseRefresh!: () => void;
      state.pauseNext.set("/api/reservations/update-monitor", new Promise<void>(resolve => { releaseSave = resolve; }));
      state.pauseNext.set("/api/reservations/reservations/scheduled", new Promise<void>(resolve => { releaseRefresh = resolve; }));
      await editor.getByRole("button", { name: "Save and start watching", exact: true }).click();
      await expect.poll(() => state.mutations.length).toBe(1);
      await expect(editor.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toBeDisabled();
      await expect(targetCard.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
      releaseSave();

      // The successful save must not expose buttons carrying the old preferences
      // while the queue refresh is still in flight.
      await expect.poll(() => state.pauseNext.has("/api/reservations/reservations/scheduled")).toBe(false);
      await expect(targetCard.getByText("Stopped", { exact: true })).toBeVisible();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toBeDisabled();
      await expect(targetCard.getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
      await expect(activeCard.getByRole("button", { name: "Stop searching", exact: true })).toBeDisabled();
      releaseRefresh();

      await expect(editor).toHaveCount(0);
      await expect(targetCard.getByRole("button", { name: "Stop searching", exact: true })).toBeEnabled();
      await expect(targetCard.getByRole("button", { name: "Resume search", exact: true })).toHaveCount(0);
      await expect(targetCard).toContainText("10:00 AM–6:00 PM");
      await expect(activeCard.getByRole("button", { name: "Stop searching", exact: true })).toBeEnabled();
      expect(state.mutations).toEqual([{
        method: "POST", path: "/api/reservations/update-monitor", query: "",
        body: { id: target.id, flexible_preferences: { ...preferences, window_start: "10:00" } },
      }]);
    });

    test("only stopped searches with safe future candidates can resume", async ({ page }) => {
      const entries = [
        stopped("past", "Past date", { booking_date: "2026-10-18" }),
        stopped("cutoff", "Notice cutoff passed", { booking_date: "2026-10-19", start_time: "12:00", end_time: "13:00", flexible_preferences: { ...preferences, window_start: "11:00", window_end: "14:00" } }),
        stopped("held", "Reservation held", { held_reservation_id: "held-reservation", held_start_time: "14:00", held_end_time: "14:30" }),
        stopped("uncertain", "Booking needs review", { booking_intent: { start_time: "14:00", end_time: "15:00" } }),
        stopped("confirmed", "Confirmed reservation attached", { confirmed_reservation_id: "confirmed-reservation" }),
        stopped("today", "Later today", { booking_date: "2026-10-19" }),
        stopped("active", "Active search", { status: "pending", monitor_state: "watching", error_message: "Watching for openings" }),
        stopped("booked", "Booked search", { status: "success", monitor_state: "booked", error_message: null }),
      ];
      const state = await mockQueue(page, entries);

      for (const entry of entries.slice(0, 5)) {
        await expect(card(page, entry.amenity_label).getByRole("button", { name: "Resume search", exact: true })).toHaveCount(0);
        await expect(card(page, entry.amenity_label).getByRole("button", { name: "Remove", exact: true })).toBeVisible();
      }
      for (const label of ["Reservation held", "Booking needs review", "Confirmed reservation attached"]) {
        await expect(card(page, label).getByRole("button", { name: "Remove", exact: true })).toBeDisabled();
        await expect(card(page, label).getByRole("button", { name: "Edit search", exact: true })).toHaveCount(0);
      }
      await expect(card(page, "Later today").getByRole("button", { name: "Resume search", exact: true })).toBeEnabled();
      await expect(card(page, "Active search").getByRole("button", { name: "Stop searching", exact: true })).toBeVisible();
      for (const label of ["Active search", "Booked search"]) {
        await expect(card(page, label).getByRole("button", { name: "Resume search", exact: true })).toHaveCount(0);
        await expect(card(page, label).getByRole("button", { name: "Remove", exact: true })).toHaveCount(0);
      }
      await card(page, "Past date").getByRole("button", { name: "Remove", exact: true }).click();
      await expect(card(page, "Past date")).toHaveCount(0);
      expect(state.entries).toEqual(entries.slice(1));
      expect(state.mutations).toEqual([{ method: "POST", path: "/api/reservations/cancel-scheduled", query: "?id=past&action=remove", body: null }]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}
