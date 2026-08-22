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
  const deviceId = jar.get(COOKIE)?.value;
  let serviceAvailable = false;
  let authenticated = false;
  let verifiedDisplayName: string | null = null;
  let clearStaleSession = false;
  try {
    const upstream = deviceId
      ? await fetch(`${apiBase()}/session`, {
          headers: { "x-tfc-device-id": deviceId },
          signal: AbortSignal.timeout(5000),
        })
      : await fetch(apiBase(), { method: "OPTIONS", signal: AbortSignal.timeout(2500) });
    serviceAvailable = upstream.status < 500;
    if (deviceId && upstream.ok) {
      const session = await upstream.json() as { authenticated?: boolean; display_name?: string | null };
      authenticated = session.authenticated === true;
      verifiedDisplayName = session.display_name ?? null;
    } else if (deviceId && upstream.status === 401) {
      clearStaleSession = true;
    }
  } catch { /* Report the service unavailable when the backend cannot be reached. */ }
  const response = NextResponse.json({
    authenticated,
    displayName: verifiedDisplayName || jar.get(NAME_COOKIE)?.value || null,
    serviceAvailable,
  });
  if (clearStaleSession) {
    response.cookies.delete(COOKIE);
    response.cookies.delete(NAME_COOKIE);
  }
  return response;
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
