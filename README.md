# TFC Amenities

A focused web interface for resident amenity reservations, including live
availability, immediate booking, cancellations, future auto-booking, and
recurring reservation requests.

**[Open TFC Amenities](https://pocketpowered.org/tfc-amenities)**

The original [hosted address](https://tfc-reserve.wongislandd.chatgpt.site/) also remains available.

![TFC Amenities preview](public/og.png)

## Security boundary

This public repository contains only the website. The private reservation
worker, Portico credential-recovery logic, database migrations, production
project identifiers, and secrets are intentionally excluded.

The browser receives an opaque session in a secure HTTP-only cookie. Portico
credentials, refresh tokens, scheduling records, and service-role access remain
server-side. Never add a Supabase secret/service-role key, Portico credential
encryption key, cron secret, or production environment file to this repository.

## Local development

Requires Node.js 22.13 or newer.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Set `TFC_RESERVE_API_BASE_URL` in `.env.local` to your own compatible
reservation Edge Function. The production backend used by the linked site is
not included.

```bash
npm test
```

The application requires a server-capable deployment because its authentication
and reservation proxy use request-time route handlers and HTTP-only cookies. It
is not configured for GitHub Pages.

## Flexible auto-booking

Enable **Find another time if my preference is unavailable**, select a preferred
time and duration, then choose acceptable hours, locations, and advance notice.
Earlier and later starts both qualify. The entire reservation must fit inside
the window on that date, in New York time. Overnight windows are not supported.

**Closest to my preferred time** ranks available starts by proximity (later wins
a tie). **Any opening** ranks the earliest available start first. Either mode
books the first available match without waiting for a better one. Flexible searches
book complete durations, stop after success, and never replace a confirmed booking.
Each possible start expires at its own notice cutoff, so later starts remain
eligible after the preferred time passes.

In **Auto-book queue**, use **Find another time** on a failed request to turn it
into a search. **Edit search** and **Stop searching** affect that date only.
Recurring requests use the same preferences independently for each date. Existing
failed bookings are not automatically reactivated.

The private backend polls cancellations every two minutes and accelerates near
release boundaries. An uncertain booking response pauses the request for review.
Status updates appear in the queue; there are no new email or push notifications.

## Verification and hosting

Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run test:browser`.
The browser tests mock reservation APIs and never place real bookings. Install
Chromium with `npx playwright install chromium` before the first browser test.

`npm run build:pocketpowered` builds the `/tfc-amenities` application and assets.
Deploy the generated `dist/server/wrangler.json`, with `TFC_RESERVE_API_BASE_URL`
supplied as a runtime secret. Only the scoped route in
`wrangler.pocketpowered.json` is changed; the root Pages site and other applications
retain their routes. Cookies use the application path on this shared domain.

For Sites, build with `NEXT_PUBLIC_APP_BASE_PATH=/tfc-amenities npm run build`;
push the matching source commit and package `.openai/` and `dist/` at the archive root. The root
redirects to the app prefix. Keep the production API URL in runtime configuration.
The additive private backend migration and worker must be deployed before this UI.
