// Instagram Graph API publishing for @pencilbirdofficial. Adapted from neuraldrop/pipeline/instagram.ts.
// Reels go up from the local file (resumable upload, no hosting). Carousel images and reel covers must be public JPEG URLs.
import fs from "node:fs";
import { env, log, sleep } from "./lib.mjs";

const VER = () => env("GRAPH_VERSION") || "v24.0";
const graph = () => `https://graph.facebook.com/${VER()}`;
const token = () => env("IG_ACCESS_TOKEN", true);
const igUser = () => env("IG_USER_ID", true);

async function call(method, url, params = {}) {
  const u = new URL(url);
  const body = new URLSearchParams(params);
  if (method === "GET") for (const [k, v] of body) u.searchParams.set(k, v);
  const res = await fetch(u, { method, headers: { Authorization: `OAuth ${token()}` }, body: method === "POST" ? body : undefined });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Graph API ${res.status}: ${JSON.stringify(json.error ?? json)}`);
  return json;
}

async function waitFinished(id, tries, every, what) {
  for (let i = 0; i < tries; i++) {
    const st = await call("GET", `${graph()}/${id}`, { fields: "status_code,status" });
    if (st.status_code === "FINISHED") return;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new Error(`${what} ${st.status_code}: ${st.status}`);
    await sleep(every);
  }
  throw new Error(`${what} processing timed out`);
}

async function publish(creationId) {
  const published = await call("POST", `${graph()}/${igUser()}/media_publish`, { creation_id: creationId });
  const info = await call("GET", `${graph()}/${published.id}`, { fields: "permalink" });
  log(`published ${info.permalink}`);
  return { mediaId: published.id, permalink: info.permalink };
}

async function uploadChunks(containerId, bytes, chunk) {
  for (let off = 0; off < bytes.length; off += chunk) {
    const part = bytes.subarray(off, Math.min(bytes.length, off + chunk));
    const up = await fetch(`https://rupload.facebook.com/ig-api-upload/${VER()}/${containerId}`, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${token()}`,
        offset: String(off),
        file_size: String(bytes.length),
        "Content-Type": "application/octet-stream", // without it the upload server receives 0 bytes but still says FINISHED
        "Content-Length": String(part.length),
      },
      body: new Uint8Array(part),
      signal: AbortSignal.timeout(180000),
    });
    const text = await up.text();
    const last = off + part.length >= bytes.length;
    if (last ? up.status !== 200 : up.status !== 206 && up.status !== 200) {
      log(`upload chunk @${off} failed: ${up.status} ${text.slice(0, 140)}`);
      return false;
    }
  }
  const st = await call("GET", `${graph()}/${containerId}`, { fields: "video_status" });
  return Number(st.video_status?.uploading_phase?.bytes_transferred ?? 0) === bytes.length;
}

/** Reel from a local mp4 (keep it under ~20 MB: Instagram rejects big uploads at the last chunk). */
export async function publishReel({ video, caption, coverUrl, trial }) {
  const params = { media_type: "REELS", upload_type: "resumable", caption, share_to_feed: "true" };
  // trial reel: shown to non-followers only. MANUAL = you share it to followers in the app (the API cannot do that step).
  if (trial) params.trial_params = JSON.stringify({ graduation_strategy: "MANUAL" });
  if (coverUrl) params.cover_url = coverUrl;
  else params.thumb_offset = "0";
  const bytes = fs.readFileSync(video);
  let containerId = "";
  for (const [n, mb] of [2, 1, 0.5, 2, 1].entries()) {  // the upload server sometimes refuses a file for a few minutes
    if (n === 3) { log("upload refused, waiting 2 min…"); await sleep(120000); }
    const c = await call("POST", `${graph()}/${igUser()}/media`, params);
    if (await uploadChunks(c.id, bytes, mb * 1048576)) { containerId = c.id; break; }
    await sleep(5000);
  }
  if (!containerId) throw new Error("reel upload failed after retries");
  log(`uploaded ${(bytes.length / 1e6).toFixed(1)} MB, container ${containerId}`);
  await waitFinished(containerId, 60, 10000, "reel");
  return publish(containerId);
}

/** Carousel of 2-10 public JPEG URLs (the Graph API takes JPEG only for images). */
export async function publishCarousel({ urls, caption }) {
  const children = [];
  for (const url of urls.slice(0, 10)) children.push((await call("POST", `${graph()}/${igUser()}/media`, { image_url: url, is_carousel_item: "true" })).id);
  const album = await call("POST", `${graph()}/${igUser()}/media`, { media_type: "CAROUSEL", children: children.join(","), caption });
  await waitFinished(album.id, 30, 4000, "carousel");
  return publish(album.id);
}

/** Our own comment on our post (needs instagram_manage_comments). */
export const comment = (mediaId, message) => call("POST", `${graph()}/${mediaId}/comments`, { message });

/** Who the token belongs to, for the setup check. */
export const whoami = () => call("GET", `${graph()}/${igUser()}`, { fields: "username,media_count" });

/** Asks Instagram for a trial reel container and never publishes it (unused containers expire after 24 h).
 *  Returns null if the trial is accepted, or Instagram's error message if this account cannot post trial reels. */
export async function trialProbe() {
  try {
    await call("POST", `${graph()}/${igUser()}/media`, { media_type: "REELS", upload_type: "resumable", caption: "trial check",
      trial_params: JSON.stringify({ graduation_strategy: "MANUAL" }) });
    return null;
  } catch (e) { return e.message; }
}
