// Builds media/<id>/ and schedule.json from the finished marketing pieces. Run on the PC after any rebuild:
//   node prepare.mjs
// Caption and first comment are read from each piece's post.md ("## Caption" / "## First comment" code blocks),
// so post.md stays the one place to edit copy. Carousel PNGs become JPEGs (the Graph API only takes JPEG images).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { p, writeJson } from "./lib.mjs";

const MKT = "G:/Pencilbird/marketing";
const PIECES = [  // id, IST date+time, type, source folder, video (reels), cover (reels), trial reel a day early (true/false)
  ["c1-by-age", "2026-11-17T13:30", "carousel", "posts/c1-by-age"],
  ["reel-wall", "2026-11-18T21:00", "reel", "reels/reel-wall", "reel-wall.mp4", "cover.jpg"],
  ["c2-solve-this", "2026-11-19T13:30", "carousel", "posts/c2-solve-this"],
  ["reel-b", "2026-11-20T21:00", "reel", "reels/reel-b", "renders/reel-b.mp4", null],
  ["reel-c", "2026-11-23T21:00", "reel", "reels/reel-c", "renders/reel-c.mp4", "cover.jpg"],
  ["reel-pencil", "2026-11-24T21:00", "reel", "reels/reel-pencil", "renders/reel-pencil.mp4", "cover.jpg"],
  ["c3-the-maths", "2026-11-25T13:30", "carousel", "posts/c3-the-maths"],
  ["c4-hindi", "2026-11-26T13:30", "carousel", "posts/c4-hindi"],
  ["reel-d-maze", "2026-11-27T21:00", "reel", "reels/reel-d-maze", "renders/reel-d-maze.mp4", "cover.jpg"],
  ["reel-quiet", "2026-11-30T21:00", "reel", "reels/reel-quiet", "renders/reel-quiet.mp4", "cover.jpg"],
];

const block = (md, heading) => {
  const m = md.match(new RegExp(`## ${heading}\\s*\\n+\`\`\`\\n([\\s\\S]*?)\\n\`\`\``));
  if (!m) throw new Error(`no "${heading}" block`);
  return m[1].trim();
};
const ffmpeg = (...args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args]);

const schedule = [];
for (const [id, ist, type, src, video, cover, trial] of PIECES) {
  const dir = path.join(MKT, src), out = p("media", id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const md = fs.readFileSync(path.join(dir, "post.md"), "utf8").replace(/\r\n/g, "\n");
  const item = { id, at: new Date(`${ist}:00+05:30`).toISOString(), ist, type, caption: block(md, "Caption"), firstComment: block(md, "First comment") };
  if (type === "carousel") {
    const slides = fs.readdirSync(path.join(dir, "out")).filter((f) => /^slide-\d+\.png$/.test(f)).sort();
    if (slides.length < 2 || slides.length > 10) throw new Error(`${id}: ${slides.length} slides`);
    item.images = slides.map((f) => {
      const jpg = f.replace(".png", ".jpg");
      ffmpeg("-i", path.join(dir, "out", f), "-q:v", "2", path.join(out, jpg));
      return `media/${id}/${jpg}`;
    });
  } else {
    // re-encode to stay well under Instagram's upload limits (H.264 high, 30 fps, AAC, faststart)
    ffmpeg("-i", path.join(dir, video), "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-maxrate", "8M", "-bufsize", "16M", "-pix_fmt", "yuv420p",
      "-r", "30", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", path.join(out, "reel.mp4"));
    item.video = `media/${id}/reel.mp4`;
    if (trial) item.trialAt = new Date(Date.parse(item.at) - 24 * 3600e3).toISOString();  // trial reel a day early
    if (cover) { fs.copyFileSync(path.join(dir, cover), path.join(out, "cover.jpg")); item.cover = `media/${id}/cover.jpg`; }
  }
  schedule.push(item);
  const mb = fs.readdirSync(out).reduce((s, f) => s + fs.statSync(path.join(out, f)).size, 0) / 1e6;
  console.log(`${item.ist}  ${type.padEnd(8)} ${id.padEnd(14)} ${(item.images?.length ?? 1)} file(s), ${mb.toFixed(1)} MB`);
}
writeJson(p("schedule.json"), schedule);
console.log(`schedule.json: ${schedule.length} posts`);
