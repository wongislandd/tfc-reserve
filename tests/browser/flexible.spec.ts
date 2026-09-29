import { test, expect } from "@playwright/test";

for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });
    test("configure a booked preference, then recover and stop a failed request", async ({ page }) => {
      await page.clock.setFixedTime(new Date("2026-09-26T12:00:00-04:00"));
      const preferences = { version: 1, window_start: "11:00", window_end: "18:00", notice_minutes: 120, preference: "earliest", amenity_ids: [1, 2] };
      let scheduled = [{ activity_log: [{ at: "2026-09-26T16:00:00Z", kind: "checked", message: "Availability checked. Still watching for a matching opening." }, { at: "2026-09-26T16:05:00Z", kind: "attempt", message: "Opening found. Attempting to book.", court: "Tennis Court 2", start: "2026-09-27T19:00:00Z", end: "2026-09-27T20:00:00Z" }], id: "failed", booking_date: "2026-09-27", start_time: "14:00", end_time: "15:00", amenity_type_id: 1, amenity_id: 1, amenity_label: "Tennis Court 1", status: "failed", error_message: "Could not hold first slot" }] as Record<string, unknown>[];
      const requests: { path: string; body: Record<string, unknown> }[] = [];
      await page.route("**/api/**", async route => {
        const url = new URL(route.request().url());
        const path = url.pathname.replace(/^\/tfc-amenities(?=\/)/, "");
        let body: unknown = {};
        if (path === "/api/session") body = { authenticated: true, displayName: "Resident", serviceAvailable: true };
        else if (path.endsWith("/amenity-types")) body = { results: [{ id: 1, name: "Tennis", max_reservation_length: "01:00", open_time: "07:00", close_time: "22:00" }] };
        else if (path.endsWith("/club-amenities")) body = [{ id: 1, label: "Tennis Court 1", is_active: true }, { id: 2, label: "Tennis Court 2", is_active: true }];
        else if (path.endsWith("/schedule")) body = { results: { "Tennis Court 1": { "2026-09-27": { "14:00": { has_reservation: true }, "14:30": { has_reservation: true } } } } };
        else if (path.endsWith("/reservations/scheduled")) body = { results: scheduled };
        else if (path.endsWith("/schedule-auto-book")) {
          requests.push({ path, body: route.request().postDataJSON() }); body = { id: "new" };
        } else if (path.endsWith("/update-monitor")) {
          const request = route.request().postDataJSON(); requests.push({ path, body: request });
          scheduled = [{ ...scheduled[0], flexible_preferences: request.flexible_preferences, monitor_state: "watching", status: "pending", error_message: "Watching for openings" }];
        } else if (path.endsWith("/cancel-scheduled")) scheduled = [{ ...scheduled[0], status: "failed", monitor_state: "stopped" }];
        else body = { results: [] };
        await route.fulfill({ json: body });
      });
      await page.goto(process.env.TFC_BROWSER_BASE_PATH || "/");
      await page.getByRole("button", { name: /Tennis View availability/ }).click();
      await page.getByLabel("Find another time if my preference is unavailable").check();
      const cell = page.getByRole("button", { name: "Tennis Court 1, Sunday, September 27 at 2:00 PM, booked", exact: true });
      await expect(cell).toBeEnabled(); await cell.click();
      await page.getByLabel("Duration", { exact: true }).selectOption("60");
      await page.getByLabel("Earliest start", { exact: true }).fill("11:00");
      await page.getByLabel("Finish by", { exact: true }).fill("18:00");
      await page.getByLabel("Which opening should we take?").selectOption("earliest");
      await page.getByRole("button", { name: "Start watching", exact: true }).click();
      await expect.poll(() => requests.length).toBe(1);
      expect(requests[0].body.flexible_preferences).toEqual(preferences);
      expect(requests[0].body.start_time).toBe("14:00"); expect(requests[0].body.end_time).toBe("15:00");
      await expect(page.getByRole("status")).toContainText("Flexible search started");

      await page.getByRole("button", { name: /Auto-book queue/ }).filter({ visible: true }).click();
      await page.getByRole("button", { name: "Find another time", exact: true }).click();
      await page.getByLabel("Earliest start", { exact: true }).fill("11:00");
      await page.getByLabel("Finish by", { exact: true }).fill("18:00");
      await page.getByRole("checkbox", { name: "Tennis Court 2" }).check();
      await page.getByRole("button", { name: "Save and start watching" }).click();
      await expect(page.getByText("Watching for openings", { exact: true }).first()).toBeVisible();
      expect(requests[1].body.id).toBe("failed");
      await page.locator(".search-activity summary").click();
      await expect(page.locator(".search-activity li").first()).toContainText("Opening found. Attempting to book.");
      await expect(page.locator(".search-activity")).toContainText("Tennis Court 2 · 3:00 PM–4:00 PM");
      await expect(page.locator(".search-activity li").last()).toContainText("Availability checked");
      await page.screenshot({ path: `outputs/flexible-${viewport.width}.png`, fullPage: true });
      await page.getByRole("button", { name: "Stop searching" }).click();
      await expect(page.getByText("Stopped", { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });
}

for (const width of [1280, 390]) {
  test(`future search shows its release date at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      const body = path.endsWith('/session') ? { authenticated: true, displayName: 'Resident', serviceAvailable: true }
        : path.endsWith('/reservations/scheduled') ? { results: [{ id: 'future', booking_date: '2026-10-11', start_time: '14:00', end_time: '15:00', amenity_type_id: 1, amenity_id: 1, amenity_label: 'Tennis Court 1', status: 'pending', monitor_state: 'waiting', next_check_at: '2026-10-04T04:00:00Z', flexible_preferences: { version: 1, window_start: '11:00', window_end: '18:00', notice_minutes: 120, preference: 'closest', amenity_ids: [1] } }] } : { results: [] };
      await route.fulfill({ json: body });
    });
    await page.goto(process.env.TFC_BROWSER_BASE_PATH || '/');
    await page.getByRole('button', { name: /Auto-book queue/ }).filter({ visible: true }).click();
    await expect(page.getByText('Waiting for booking window', { exact: true })).toBeVisible();
    await expect(page.getByText(/Checks begin Oct 4, 12:00 AM ET/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop searching' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
