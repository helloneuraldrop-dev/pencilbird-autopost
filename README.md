# Pencilbird autopost

Posts the finished carousels and reels to @pencilbirdofficial on schedule, with their first comment.
GitHub Actions runs `publish.mjs` at 13:30 and 21:00 IST (plus a backup run 30 min later). No server, no npm packages.
**Trial reels are off for now** (the account gets them at about 200 followers). To turn them on, add `true` at the end of a reel's line in `prepare.mjs`
and run `node publish.mjs --trial-test` first. A reel marked trial goes out as a trial reel 24 h before its slot (non-followers only). The API cannot share a trial reel to followers,
so at the slot open the reel in the Instagram app and tap Share to followers. If Instagram refuses the trial (account not eligible)
or the trial run was missed, the reel goes out as a normal reel at its slot. Turn trial off for a reel: drop `true` from its line in `prepare.mjs`.
Stories are NOT posted: the Graph API cannot add Poll or Link stickers, so stories stay manual (`marketing/posts/stories/stories.md`).

| File | What it does |
|---|---|
| `prepare.mjs` | Copies each piece from `marketing/` into `media/<id>/` (PNG slides → JPEG, reels re-encoded) and writes `schedule.json`. Caption and first comment come from each piece's `post.md`. |
| `publish.mjs` | Posts whatever is due (time passed, less than 6 h ago) and not in `data/posted.json`, then adds the first comment. `--check` posts nothing. `--now=<id>` posts one now. |
| `instagram.mjs` | Graph API calls (adapted from neuraldrop): resumable reel upload, carousel, comment. |
| `token.mjs` | Turns a Graph API Explorer token into a never-expiring Page token and saves it to `.env`. |

## Setup (once)

1. **Meta app.** developers.facebook.com → My Apps → Create App → use case **Other**, type **Business**, name `Pencilbird Publisher`.
   App settings → Basic: note the **App ID** and **App Secret**. The app can stay in Development mode: posting to your own account needs no App Review.
2. **Token.** @pencilbirdofficial must be a Business or Creator account linked to the Pencilbird Facebook Page.
   developers.facebook.com/tools/explorer → pick the app → Get User Access Token with
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `pages_show_list`, `pages_read_engagement`, `business_management`
   → Generate → tick the Pencilbird Page and @pencilbirdofficial.
   Copy `.env.example` to `.env`, fill `FB_APP_ID`, `FB_APP_SECRET`, `FB_SHORT_TOKEN`, then run `node token.mjs`.
   Then `node publish.mjs --check` must print `token ok: @pencilbirdofficial`.
3. **GitHub repo.** Create a **public** repo (Instagram must be able to fetch the carousel images from `raw.githubusercontent.com`;
   nothing secret is in the repo, the token lives in GitHub secrets). Push this folder to it.
   Settings → Secrets and variables → Actions → add `IG_USER_ID` and `IG_ACCESS_TOKEN` (values from `.env`).
4. **Test.** Actions → Post to Instagram → Run workflow → leave `post_now` empty: it should say "nothing due".

## After changing any post

Rebuild the piece in `marketing/`, then `git pull` (the bot commits `data/posted.json`), `node prepare.mjs`, `node publish.mjs --check`, commit and push.
To move a post, change its time in the `PIECES` list in `prepare.mjs` and run it again.
