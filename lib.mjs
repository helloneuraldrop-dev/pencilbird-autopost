// Small helpers shared by the autopost scripts. Reads .env next to this file (never committed).
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
export const p = (...parts) => path.join(ROOT, ...parts);

const envFile = p(".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

export const env = (name, required = false) => {
  const v = process.env[name]?.trim();
  if (required && !v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v || "";
};
export const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const readJson = (file, fallback) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback);
export const writeJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 1) + "\n");
