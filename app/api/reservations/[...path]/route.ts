import { COOKIE_PATH } from "../../../app-path";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE = "tfc-reservation-session";
const allowed = new Set(["amenity-types", "reservations/upcoming", "reservations/past", "reservations/scheduled", "schedule", "club-amenities", "book", "cancel", "schedule-auto-book", "cancel-scheduled", "update-monitor", "preferences"]);
const apiBase = () => {
  const configured = process.env.TFC_RESERVE_API_BASE_URL
    || process.env.RESERVATION_API_BASE_URL;
  if (!configured) throw new Error("Reservation API is not configured");
  return configured.replace(/\/$/, "");
};

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await context.params;
  const path = parts.join("/");
  if (!allowed.has(path)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const jar = await cookies();
  const deviceId = jar.get(COOKIE)?.value;
  if (!deviceId) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  try {
    const target = new URL(`${apiBase()}/${path}`);
    request.nextUrl.searchParams.forEach((value, key) => target.searchParams.set(key, value));
    const headers: Record<string, string> = { "x-tfc-device-id": deviceId };
    const contentType = request.headers.get("content-type");
    if (contentType) headers["content-type"] = contentType;
    const upstream = await fetch(target, { method: request.method, headers, body: request.method === "GET" ? undefined : await request.text() });
    const text = await upstream.text();
    const response = new NextResponse(text, { status: upstream.status, headers: { "Content-Type": upstream.headers.get("content-type") || "application/json" } });
    if (upstream.status === 401 && text.includes("needs_login")) response.cookies.set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: COOKIE_PATH, maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ error: "The reservation service is unavailable." }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
