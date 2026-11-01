# Notes for future Claude

Read this before working on purrfect, and update it in the same change when the architecture, conventions or known gaps move. The user writes in Russian and wants replies and all UI text in Russian. `CLAUDE.md` in the root is binding.

## Map

npm workspaces monorepo. `data/` (SQLite and uploads) is gitignored.

| Where | What |
| --- | --- |
| `server/src/app.ts` | `buildApp()`: plugins, error handler, CSRF hook, session loading, static files |
| `server/src/db.ts` | The whole schema (`CREATE TABLE IF NOT EXISTS`), `Ctx` type |
| `server/src/http.ts` | `HttpError`, `requireUser`, `idParam`, `limit(n)` |
| `server/src/images.ts` | Upload pipeline |
| `server/src/achievements.ts` | Achievement list, XP SQL, `checkAchievements` |
| `server/src/routes/*` | `auth`, `posts` (feed, reactions, comments), `social` (users, follows, notifications, collections), `cats`, `games` (match, battle, leaderboard, daily) |
| `server/src/seed.ts` | Demo data; cats are generated SVGs, bots have random passwords |
| `server/test/api.test.ts` | API and security tests using `app.inject` |
| `client/src/api.ts` | Types, `api()` fetch wrapper, `useMe`, `useFeed`, `patchPost` |
| `client/src/ui.tsx` | Shared components: `PostCard`, `Masonry`, `ReactionBar`, `SaveButton`, states |
| `client/src/fun.ts` | Toasts, theme, purr sound (WebAudio), particles, `timeAgo` |
| `client/src/pages/*` | One file per route; routes are declared in `App.tsx` |
| `client/src/styles.css` | All styles; colours are CSS variables, dark theme via `data-theme` |

## Security rules to keep

Each of these has a test or a reason. Don't weaken them to make something work.

- **CSRF:** every non-GET `/api` request needs `X-Requested-With: purrfect` (the client's `api()` sends it), plus SameSite=Lax. There is deliberately no CORS.
- **Sessions:** random token in an httpOnly cookie, only its SHA-256 is in the DB. Changing the password revokes all sessions.
- **Passwords:** argon2. Login takes the same path and gives the same error for unknown users.
- **Uploads:** always decoded and re-encoded to WebP by sharp (strips EXIF/GPS), random filenames, format allowlist, no SVG. Never serve a file as received.
- **Authorization:** check ownership in the route. Private collections return 404 to strangers, not 403.
- **Game integrity:** the server picks battle pairs and stores them, each pair votes once per user, no voting on your own posts. XP is computed from current data, never accumulated, so it can't be farmed by toggling.
- **SQL:** always bound parameters. LIKE input is escaped. The `weekAgo` interpolation in `posts.ts` is a server-side number, not user input.
- **CSP:** strict `script-src 'self'`, `font-src 'self'`. This is why `assetsInlineLimit: 0` is set in Vite. Dev mode doesn't get the CSP on Vite's own pages, so **CSP bugs only show on the production build**; check `npm run build && npm start` after adding assets or external resources.

## Gotchas learned the hard way

- The API port variable is `API_PORT`, not `PORT`: the preview launcher sets `PORT=5173`, which made the API fight Vite for the port.
- `useSyncExternalStore` subscribe must return a function returning void; returning `Set.delete` directly crashes React (`destroy is not a function`) with a blank screen.
- Multipart order matters: the `meta` field must be appended before the file, or `file.fields.meta` is empty.
- Sticker sizes in the editor use `cqw` units and need `container-type: inline-size` on `.editor-canvas`. Preview and canvas export draw separately (`exportImage`, `drawCaption`), so change both together.
- Battle uses `POST /battle/new` inside `useQuery`. It's safe because an unfinished battle is returned again rather than a new one being created.
- Feed paging is offset-based, so the client de-duplicates posts.

## How to verify

- `npm test` covers the API; `npx tsc --noEmit` in `client` and `server` (the client's `npm run build` also does it).
- UI: `.claude/launch.json` has `purrfect-dev` for the browser pane. To test production without touching dev data, use `DATA_DIR=<temp> API_PORT=3100 INSECURE_COOKIES=1 npm start` after a seed with the same `DATA_DIR`.
- There are no automated frontend tests. UI flows were checked by hand in the browser.

## Known gaps

- No moderation: no reports, no admin role, no check that a picture is actually a cat. Needed before opening to the public.
- No email, so no password recovery.
- No schema migrations: `CREATE TABLE IF NOT EXISTS` won't alter existing tables. Add a migration mechanism before the first schema change on real data.
- Uploads live on local disk and SQLite is single-node. Fine for one server; moving to S3 and Postgres is the path for growth.
- Rate limits are per IP and in memory. Behind a proxy, `trustProxy` must be configured or all users share one limit.
- Notifications are polled every 30 seconds, not pushed.
- GIFs lose animation (flattened on a canvas and by the server).
- The main JS bundle is about 490 KB (155 KB gzipped); routes aren't code-split.
