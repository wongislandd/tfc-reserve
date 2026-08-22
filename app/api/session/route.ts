import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE = "tfc-reservation-session";
const NAME_COOKIE = "tfc-reservation-name";
const apiBase = () => {
  const configured = process.env.TFC_RESERVE_API_BASE_URL
    || process.env.RESERVATION_API_BASE_URL;
  if (!configured) throw new Error("Reservation API is not configured");
  return configured.replace(/\/$/, "");
};

export async function GET() {
  const jar = await cookies();
  let serviceAvailable = false;
  try {
    const health = await fetch(apiBase(), { method: "OPTIONS", signal: AbortSignal.timeout(2500) });
    serviceAvailable = health.ok;
  } catch { /* Report the service unavailable when the backend cannot be reached. */ }
  return NextResponse.json({
    authenticated: serviceAvailable && Boolean(jar.get(COOKIE)?.value),
    displayName: jar.get(NAME_COOKIE)?.value || null,
    serviceAvailable,
  });
}

export async function POST(request: NextRequest) {
  const payload = await request.json() as { username?: string; password?: string; occupant_id?: string };
  const jar = await cookies();
  const deviceId = jar.get(COOKIE)?.value || crypto.randomUUID();
  try {
    const upstream = await fetch(`${apiBase()}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, device_id: deviceId, platform: "web" }),
    });
    const text = await upstream.text();
    const response = new NextResponse(text, { status: upstream.status, headers: { "Content-Type": "application/json" } });
    if (upstream.ok) {
      const result = JSON.parse(text);
      response.cookies.set(COOKIE, result.device_id || deviceId, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
      response.cookies.set(NAME_COOKIE, result.display_name || "Resident", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
    }
    return response;
  } catch {
    return NextResponse.json({ error: "The reservation service is unavailable. Please try again shortly." }, { status: 503 });
  }
}

export async function DELETE() {
  const jar = await cookies();
  const deviceId = jar.get(COOKIE)?.value;
  if (deviceId) {
    try { await fetch(`${apiBase()}/logout`, { method: "POST", headers: { "x-tfc-device-id": deviceId } }); } catch { /* Clear the browser session even if upstream is unavailable. */ }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(COOKIE); response.cookies.delete(NAME_COOKIE);
  return response;
}
