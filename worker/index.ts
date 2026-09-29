/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";
import { APP_BASE_PATH } from "../app/app-path";

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const worker = {
  async fetch(request: Request, env: TfcWebEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (APP_BASE_PATH && url.pathname === "/") return Response.redirect(new URL(`${APP_BASE_PATH}${url.search}`, url), 302);
    if (APP_BASE_PATH && url.pathname !== APP_BASE_PATH && !url.pathname.startsWith(`${APP_BASE_PATH}/`)) {
      // Cloudflare's route wildcard also catches similar prefixes; preserve their origin behavior.
      return url.hostname === "pocketpowered.org" ? fetch(request) : new Response("Not found", { status: 404 });
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
