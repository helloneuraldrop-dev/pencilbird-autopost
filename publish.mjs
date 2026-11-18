// Publishes every schedule.json post that is due (its time has passed, less than 6 h ago) and not yet in data/posted.json,
// then adds its first comment. Run by GitHub Actions; safe to run any time, nothing goes out twice.
//   node publish.mjs            publish what is due
//   node publish.mjs --check    no posting: validate files, show what is due, and test the token if one is set
//   node publish.mjs --now=<id> publish that one post now (manual run)
//   node publish.mjs --trial-test  ask Instagram whether this account can post trial reels (posts nothing)
import fs from "node:fs";
import { env, log, p, readJson, writeJson } from "./lib.mjs";
import { comment, publishCarousel, publishReel, trialProbe, whoami } from "./instagram.mjs";

// in GitHub Actions, show any error on the run summary page (not only inside the log)
if (process.env.GITHUB_ACTIONS) for (const ev of ["uncaughtException", "unhandledRejection"]) process.on(ev, (e) => { console.log(`::error::${e?.message ?? e}`); process.exit(1); });
const CHECK = process.argv.includes("--check");
if (process.argv.includes("--trial-test")) {
  if (!env("IG_ACCESS_TOKEN") || !env("IG_USER_ID")) { console.log("no token in .env yet (see README step 2)"); process.exit(1); }
  const err = await trialProbe();
  console.log(err ? `✗ trial reels NOT available: ${err}` : "✓ trial reels available (a test container was made and never published)");
  process.exit(0);
}
const NOW = process.argv.find((a) => a.startsWith("--now="))?.slice(6);
const WINDOW_H = 6;  // a post more than 6 h late is skipped (better to repost by hand than post at 3 AM)
const schedule = readJson(p("schedule.json"), []);
const postedFile = p("data", "posted.json");
const posted = readJson(postedFile, {});
// public URL of this repo's files, e.g. https://raw.githubusercontent.com/<user>/<repo>/main
const BASE = (env("MEDIA_BASE") || (process.env.GITHUB_REPOSITORY ? `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/${process.env.GITHUB_REF_NAME || "main"}` : "")).replace(/\/$/, "");
const url = (f) => `${BASE}/${f}`;

for (const it of schedule) {  // every file must exist before anything is posted
  for (const f of [...(it.images ?? []), it.video, it.cover].filter(Boolean)) if (!fs.existsSync(p(f))) throw new Error(`${it.id}: missing ${f}`);
  if (it.caption.length > 2200) throw new Error(`${it.id}: caption over 2,200 characters`);
  if ((it.caption.match(/#/g) ?? []).length > 30 || (it.firstComment.match(/#/g) ?? []).length > 30) throw new Error(`${it.id}: over 30 hashtags`);
}

// A reel marked "trial" goes out as a trial reel 24 h before its slot (trialAt), and you share it to followers in the app at the slot.
// If Instagram refuses the trial, or the trial slot was missed, the reel goes out normally at its own slot.
const ageAt = (t) => (Date.now() - Date.parse(t)) / 3600e3;
const inWindow = (t) => ageAt(t) >= 0 && ageAt(t) < WINDOW_H;
const done = (it) => Boolean(posted[it.id]?.mediaId);
const phase = (it) => {
  if (done(it)) return null;
  if (NOW) return it.id === NOW ? "normal" : null;
  if (it.trialAt && !posted[it.id] && inWindow(it.trialAt)) return "trial";
  return inWindow(it.at) ? "normal" : null;
};
const due = schedule.filter((it) => phase(it));
if (NOW && !due.length) throw new Error(`${NOW}: not in schedule.json, or already posted`);

if (CHECK) {
  for (const it of schedule) console.log(`${it.ist}  ${it.type.padEnd(8)} ${it.id.padEnd(14)} ${it.trialAt ? `trial ${new Date(Date.parse(it.trialAt) + 19800e3).toISOString().slice(0, 16)} IST  ` : ""}${posted[it.id]?.permalink ?? (phase(it) ? `DUE NOW (${phase(it)})` : posted[it.id]?.trialRefused ? "trial refused, normal at slot" : "waiting")}`);
  if (env("IG_ACCESS_TOKEN") && env("IG_USER_ID")) {
    const me = await whoami();
    console.log(`token ok: @${me.username}, ${me.media_count} posts`);
    if (me.username !== "pencilbirdofficial") throw new Error(`token is for @${me.username}, not @pencilbirdofficial`);
  } else {
    console.log("no token in .env yet (see README step 2)");
    if (process.env.GITHUB_ACTIONS) throw new Error("IG_USER_ID / IG_ACCESS_TOKEN secrets are missing in GitHub");
  }
  if (!BASE) console.log("MEDIA_BASE not set: carousels need it outside GitHub Actions");
  process.exit(0);
}

if (!due.length) { log("nothing due"); process.exit(0); }
if (!BASE && due.some((it) => it.type === "carousel" || it.cover)) throw new Error("MEDIA_BASE is not set, so Instagram cannot fetch the images");

let failed = 0;
for (const it of due) {
  const trial = phase(it) === "trial";
  log(`posting ${it.id} (${trial ? "trial reel" : it.type}, slot ${it.ist} IST)`);
  try {
    let res;
    try {
      res = it.type === "carousel"
        ? await publishCarousel({ urls: it.images.map(url), caption: it.caption })
        : await publishReel({ video: p(it.video), caption: it.caption, coverUrl: it.cover ? url(it.cover) : undefined, trial });
    } catch (e) {
      // only an error about the trial itself; anything else may have half-posted, so it stays a failure
      if (!trial || !/trial/i.test(e.message)) throw e;
      posted[it.id] = { trialRefused: e.message.slice(0, 200), at: new Date().toISOString() };
      writeJson(postedFile, posted);
      log(`trial refused, ${it.id} will go out as a normal reel at ${it.ist} IST`);
      continue;
    }
    posted[it.id] = { ...res, trial, at: new Date().toISOString() };
    if (trial) log(`TRIAL: share it to followers in the Instagram app at ${it.ist} IST`);
    writeJson(postedFile, posted);  // saved before the comment, so a failed comment never causes a second post
    try { await comment(res.mediaId, it.firstComment); posted[it.id].firstComment = true; log("first comment posted"); }
    catch (e) { log(`first comment failed (add it by hand): ${e.message}`); }
    writeJson(postedFile, posted);
  } catch (e) {
    failed++;
    log(`✗ ${it.id} failed: ${e.message}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error::${it.id} failed: ${e.message.slice(0, 500)}`); // visible on the run page without signing in
  }
}
if (failed) process.exit(1);  // red run in GitHub Actions, so the failure is visible
