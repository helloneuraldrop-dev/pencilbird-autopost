// Turns the short-lived Graph API Explorer token into a NON-EXPIRING Page token for @pencilbirdofficial and saves
// IG_USER_ID + IG_ACCESS_TOKEN into .env. Adapted from neuraldrop/pipeline/token.ts.
//
// Put these 3 lines in .env first (never paste them in chat):
//   FB_APP_ID=...
//   FB_APP_SECRET=...
//   FB_SHORT_TOKEN=...      (from developers.facebook.com/tools/explorer)
// then run:  node token.mjs
import fs from "node:fs";
import { env, p } from "./lib.mjs";

const HANDLE = "pencilbirdofficial";
const appId = env("FB_APP_ID"), appSecret = env("FB_APP_SECRET"), shortToken = env("FB_SHORT_TOKEN");
if (!appId || !appSecret || !shortToken) {
  console.log("Missing FB_APP_ID, FB_APP_SECRET or FB_SHORT_TOKEN in .env (see the top of token.mjs).");
  process.exit(1);
}
const G = `https://graph.facebook.com/${env("GRAPH_VERSION") || "v24.0"}`;
const get = async (url) => {
  const j = await (await fetch(url)).json();
  if (j.error) throw new Error(`${j.error.type ?? "Error"}: ${j.error.message}`);
  return j;
};

const long = await get(`${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`);
const pages = await get(`${G}/me/accounts?fields=name,access_token,instagram_business_account{id,username}&access_token=${long.access_token}`);
const withIg = (pages.data || []).filter((pg) => pg.instagram_business_account);
const page = withIg.find((pg) => pg.instagram_business_account.username === HANDLE);
if (!page) {  // never save another account's token
  console.log(`✗ @${HANDLE} is not in this token. Pages with Instagram in it: ${withIg.map((pg) => `${pg.name} → @${pg.instagram_business_account.username}`).join(", ") || "none"}`);
  console.log("Fix: Instagram → Edit profile → Page → connect the Pencilbird Page; then in Graph API Explorer generate a new token and tick that Page AND @pencilbirdofficial.");
  process.exit(1);
}
const dbg = await get(`${G}/debug_token?input_token=${page.access_token}&access_token=${appId}|${appSecret}`);
const scopes = dbg.data.scopes ?? [];
const needed = ["instagram_basic", "instagram_content_publish", "instagram_manage_comments", "pages_show_list", "pages_read_engagement"];
const missing = needed.filter((s) => !scopes.includes(s));

const envFile = p(".env");
let text = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
for (const [k, v] of [["IG_USER_ID", page.instagram_business_account.id], ["IG_ACCESS_TOKEN", page.access_token]]) {
  const re = new RegExp(`^${k}=.*$`, "m");
  text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.trimEnd()}\n${k}=${v}\n`;
}
fs.writeFileSync(envFile, text);
console.log(`✓ Page: ${page.name}  →  Instagram: @${HANDLE}`);
console.log(`✓ IG_USER_ID and IG_ACCESS_TOKEN saved to .env (token not shown)`);
console.log(`✓ Token expires: ${dbg.data.expires_at ? new Date(dbg.data.expires_at * 1000).toISOString() : "never"}`);
console.log(missing.length ? `⚠ Missing permissions: ${missing.join(", ")}. Generate a new Explorer token with them ticked.` : "✓ All permissions present");
