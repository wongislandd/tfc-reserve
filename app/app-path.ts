// Build twice when publishing: root for Sites, prefixed for PocketPowered.
export const APP_BASE_PATH = process.env.NEXT_PUBLIC_APP_BASE_PATH || "";
export const COOKIE_PATH = APP_BASE_PATH || "/";
export function appPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("Expected an app-relative path");
  return `${APP_BASE_PATH}${path}`;
}
