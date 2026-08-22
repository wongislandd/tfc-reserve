import { readFile, writeFile } from "node:fs/promises";

const configPath = new URL("../dist/server/wrangler.json", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));

// Sites rejects nodejs_compat on runtimes where it is already the default.
// Vinext currently emits an empty compatibility_flags array even when the
// source configuration omits it, so remove the generated property entirely.
if (
  Array.isArray(config.compatibility_flags)
  && config.compatibility_flags.every((flag) => flag === "nodejs_compat")
) {
  delete config.compatibility_flags;
  await writeFile(configPath, JSON.stringify(config));
}
