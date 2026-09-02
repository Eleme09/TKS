# PLACER SERVICES — Chaturbate token/payroll tracker

Internal tool for a Chaturbate webcam studio: tracks each model's token
earnings live, computes biweekly payroll (quincenas), runs an overtime
shift sign-up calendar, and gates everything behind 3 roles.

## Before touching anything

Run `git log --oneline -30` and skim recent commit messages, then read
the actual current `server.js` / `public/index.html`. **This project has
been developed from multiple, disconnected Claude Code sessions on
different devices, sometimes in parallel.** Don't trust any prior
session's description of "current state" (including sections below) —
trust the repo. If something below conflicts with what the code
actually does, the code wins; fix this file to match.

## Where things live

- **Code**: this repo (`Eleme09/TKS`, private GitHub repo). Deploy flow:
  commit → push `master` (via GitHub Desktop, the user's tool of choice)
  → Render auto-deploys `tks-4zsh.onrender.com`.
- **Database**: Supabase project ref `yklqqalnmficsbyabbrn`. All tables
  belonging to this app are prefixed `cb_` — that Supabase project has
  other, unrelated tables too (the user's other work); never touch
  non-`cb_` tables. Row Level Security is deliberately open to the
  `anon` role on `cb_*` tables (accepted tradeoff since the anon key
  never leaves server-side env vars).
- **Secrets**: at minimum `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SESSION_SECRET`; check server.js top-of-file for any others that may
  have been added since (e.g. `VAPID_*` for push notifications,
  `STRIPCHAT_API_KEY`/`STRIPCHAT_STUDIO_USERNAME` for the Stripchat
  auto-sync — those two are optional, not required to start). Never
  hardcode secret values in source — the server intentionally refuses to
  start without them as env vars. Locally they live in `env.bat` (in
  .gitignore, not in the repo — if missing, regenerate values from the
  Render dashboard's Environment tab, which is the source of truth, or
  ask the user). `iniciar.bat` sources `env.bat` then runs `node
  server.js`.
- **Uptime**: a free UptimeRobot monitor pings the live site every 5 min
  so Render's free tier doesn't sleep. Drop it if/when the studio
  upgrades to a paid Render plan.
- **Staging**: a second Render free web service, `tks-staging`
  (`tks-staging.onrender.com`), same repo, branch `dev`, same three
  secrets (but its own `SESSION_SECRET`, different from production's).
  It is normally **suspended** — resume it manually in Render only when
  you need to test something live, then re-suspend when done. Reason:
  it shares the same Supabase tables as production, so if it's left
  running it double-polls Chaturbate for the same models production
  already tracks (tip dedup on `event_id` prevents double-counted money,
  but it's still wasteful and not a real isolated environment — don't
  treat it as one for anything that writes meaningfully different data
  than production). Workflow: commit → push to `dev` → resume
  `tks-staging` → verify → push/merge to `master` for the real deploy.
- **Browser access**: Claude in Chrome (the user's real, logged-in
  Chrome) has working sessions for GitHub, Render, and Supabase — confirmed
  working for running SQL directly in the Supabase SQL Editor and for
  managing Render services end to end. Also, `git push` from this
  machine's shell works directly (credentials are already configured) —
  no need to route pushes through GitHub Desktop.

## Reliability notes (read before touching pollLoop / tracker logic)

- Each model's Chaturbate Events API long-poll cursor (`nextUrl`) is
  persisted to `cb_models.last_cursor` after every successful poll cycle,
  and reconnect (`reconnectAllModels`, `/api/start`, `/api/reconnect`)
  resumes from it instead of starting fresh. This closes a real
  money-loss window: without it, any tip arriving during a server
  restart (redeploy, crash, Render free-tier sleep) was silently lost
  forever. If the saved cursor is stale/rejected, the code falls back to
  a fresh connection automatically — don't treat that fallback path as a
  bug.
- Online/offline status is **in-memory only** (`tracker.online`). On a
  fresh add (no saved cursor) it starts `false` until a real event
  arrives — trusting DB history there would be unsafe since there's no
  guarantee no `broadcastStop` was missed. But on a **resume from a
  saved cursor** (the normal case on every restart/redeploy), `pollLoop`
  seeds `tracker.online` from `cb_broadcast_events`' last recorded event
  for that model (fixed 2026-09-02, see `sbFetchLastBroadcastEvent`) —
  a valid cursor resume has no event gap (Chaturbate still delivers
  everything that happened during the downtime), so the DB's last event
  is trustworthy at that point. If the saved cursor turns out rejected
  further down (falls back to `freshUrl`), the seed is explicitly
  reverted to `false`/unknown, since only then is there a real gap. Why
  this mattered: without it, a model already live *before* a restart
  would show "desconectada" for potentially hours (until she happens to
  stop/restart streaming) instead of a few minutes, since the resumed
  cursor starts past her original `broadcastStart` and no new event
  fires while she keeps streaming continuously. Don't revert to
  unconditional `false`-on-restart — that reintroduces the bug the user
  reported on 2026-09-02. This is purely a monitoring/UI concern, not
  money — `totalTokensPeriod` only ever comes from `cb_tips`, never from
  online status.
  **Caveat found the same day:** a `start` event can itself be stale if
  its matching `stop` was lost historically (e.g. from the
  zombie-poller/stuck-retry bugs, now fixed) — happened to conni_f00x
  (a single `start` from Aug 31 with no `stop` ever, so she showed
  "online" for a day+ until corrected by hand). Fixed with
  `ONLINE_SEED_MAX_AGE_MS` (12h): a `start` older than that is not
  trusted for seeding. If this recurs for a model, fix it directly —
  insert a real `stop` row into `cb_broadcast_events` for her, then
  `/api/stop` + `/api/reconnect` to force her tracker to re-seed
  immediately rather than waiting for the next full redeploy.
- `startTracker(username, token, savedCursor)` **must** set
  `existing.running = false` on the tracker it's replacing before
  aborting its fetch — aborting alone does not stop that old poll loop
  (its `while (tracker.running)` check would still pass), so it becomes
  a "zombie" that keeps polling Chaturbate for the same account forever
  in parallel with the new one. This was a real bug (fixed 2026-09-02);
  don't reintroduce it if this function gets refactored. `/api/stop` and
  `/api/delete` already had the correct pattern to copy.
- `pollLoop` must not retry the exact same failing `nextUrl` forever on
  a flat interval — Chaturbate can reject a URL (e.g. "You waited too
  long. Please start over using 'nextUrl'", HTTP 400) in a way that a
  flat 5s retry never recovers from. The fix: back off up to 60s based
  on `tracker.consecutiveErrors`, and force `nextUrl` back to the
  cursor-less `freshUrl` every 3rd consecutive failure. A model stuck
  showing "error" and never reconnecting on its own is this bug if it
  recurs — check `consecutiveErrors`/backoff logic first before assuming
  it's something else.
- Supabase writes that represent real tip/broadcast data go through
  `sbWriteCritical` (retries 3x, logs loudly to console on final
  failure instead of swallowing it silently). Keep using it — or
  something at least as resilient — for any new write that represents
  money, rather than a bare `fetch(...).catch(() => {})`.

## Business rules (stable — confirm before changing)

- Quincena: day 1–15 of a month is paid the 20th of that month; day
  16–end of month is paid the 5th of the next month.
- Payout formula: `tokens × 0.023 USD/token`, converted to COP at a live
  daily rate (cached ~5 min). That USD-per-token rate is business
  financial data — never change it without the user explicitly asking.
  Historical (past-quincena) COP figures are approximate (today's rate,
  not the historical one) since exchange rates aren't archived per day;
  label them as such rather than presenting them as exact.
- **Stripchat is combined into the same payout** (added 2026-09-02): a
  model's `totalTokensPeriod` = Chaturbate tips + Stripchat tokens for
  that quincena, then the single 0.023 USD/token rate applies to the
  combined total — the user's explicit instruction ("misma operación...
  se unen ambas estadísticas de página para pagar").
  **Primary source (added later same day): Stripchat's official Studio
  API.** Turns out it exists and is documented at `docs.stripchat.com`
  (a Swagger/OpenAPI page — blocked for me to browse directly, see
  below, but the user copy-pasted the relevant parts). Endpoint: `GET
  https://stripchat.com/api/stats/v2/studios/username/{studioUsername}/models/username/{modelUsername}`,
  auth via header `API-Key: <key>`, query params `periodStart`/
  `periodEnd` as `YYYY-MM-DD HH:MM:SS` (no timezone offset — the API
  echoes back whatever literal wall-clock string you send, tagged `Z`;
  formatted here with local `Date` getters via `fmtStripchatDateTime`,
  same convention as `toDateStr`, so it lines up with `getQuincena`'s
  own boundaries whatever timezone the server happens to run in).
  Response field `totalEarnings` (integer) is the token total for that
  window — verified it equals the sum of every individual category
  field (tip, privateShow, spyOnPrivate, etc.) in the same response.
  Credentials: `STRIPCHAT_API_KEY` and `STRIPCHAT_STUDIO_USERNAME`
  (studio username confirmed as `Pleasure_09`) — both optional env vars;
  the server runs fine without them, just skips the auto-sync.
  `pollStripchatEarnings()` runs once at startup and then every
  `STRIPCHAT_POLL_INTERVAL_MS` (10 min), fetching every `role: 'modelo'`
  account's *current* quincena `totalEarnings` and upserting into
  `cb_stripchat_earnings` with `entered_by: 'stripchat-api'` — same
  table the manual form writes to, so nothing else downstream changed.
  Verified for real against all 6 models before shipping (matched a
  manual Swagger "Try it out" call exactly: amaranta_f00x = 1101 for the
  same window).
  **Manual entry is now the fallback**, not the primary path: admin
  pastes the "Ganancias por modelo" table text into a textarea,
  `parseStripchatPaste()` matches each known model's username against a
  line of that text and takes the largest number on that line as her
  token count, admin reviews/edits the parsed preview, then confirms to
  save. Useful if the API key ever breaks/rotates, or to backfill a
  quincena the poller didn't cover (it only ever writes the *current*
  period — there's no automatic historical backfill). Data lives in
  `cb_stripchat_earnings` (columns: `username, period_start date,
  period_end date, tokens, entered_by, created_at, updated_at`,
  `unique(username, period_start, period_end)` so re-saving a period —
  by either path — corrects it via upsert instead of duplicating).
  Endpoints: `GET /api/stripchat/periods` (current + 2 prior quincenas),
  `POST /api/stripchat/parse` (text → matched/unmatched preview, no
  write), `POST /api/stripchat/save` (admin-only, upserts). Wired into
  `buildModelReports()` (current quincena, exposes
  `chaturbateTokensPeriod`/`stripchatTokensPeriod` alongside the combined
  `totalTokensPeriod`) and `/api/payslips` (same breakdown per historical
  period).
  **Still true regardless of the API:** the studio's Stripchat *master
  account login* (browsing stripchat.com as a logged-in user) stays
  locked to one specific browser as the user's own fraud-prevention
  measure — never attempt scripted/automated *login* to Stripchat from
  this server; that's a different thing from the API key above and
  remains off-limits. Also worth knowing: `stripchat.com` and every
  subdomain (including `docs.stripchat.com`) are hard-blocked for me at
  the tool level (WebFetch, my sandboxed browser, and Claude-in-Chrome
  all refuse it, regardless of which connected browser/account) — it's
  a content-category policy block, not an auth issue, and retrying
  doesn't help. Get anything from that domain by asking the user to
  screenshot/paste it directly.
- Roles: `administrador` (full control), `ceo` (badge "CEO PLACER
  STUDIO", read-only on model earnings/status but can manage the shift
  calendar), `modelo` (sees/manages only her own data, logs in with her
  Chaturbate username + a password the admin assigns her, not an
  email).
- **Account/security management is centralized in the "Cuentas" tab**
  (added 2026-09-02, `tabBtnCuentas`/`isAdmin`-gated — already
  administrador-only before this, just expanded). It's the *only* place
  password-reset and force-logout controls live for every account type:
  admin/CEO (existing "Cuentas administrativas" card) and models (new
  "Contraseñas y sesiones — modelos" card, `refreshModelAccounts()`).
  The per-model "Contraseña" button was deliberately removed from the
  Modelos tab card — don't re-add it there, it belongs in Cuentas only.
  `POST /api/accounts/logout-everywhere` (admin-only, `{type: 'admin'|
  'model', username}`) force-logs-out *any* account, unlike
  `/api/me/logout-everywhere` which is self-service-only. Both go
  through `sbBumpSessionVersion`.
- **Push notifications are now role-scoped** (added 2026-09-02): "modelo
  X está en línea" goes to `ceo` subscribers only (`sendPushToRole('ceo',
  ...)`) — explicit user request, administrador does not want these.
  Connection-drop alerts still go to everyone subscribed
  (`sendPushToRole(null, ...)`, unchanged). Subscriptions are tagged
  with the subscriber's role in `cb_push_subscriptions.role` at
  subscribe time (`/api/push/subscribe` passes `session.role`) — don't
  add a new push notification type without deciding which role(s) it's
  for.

## How this user likes to work

Non-technical, moves fast, dislikes long back-and-forth or being asked
to test things himself. Test every change yourself end-to-end (spin up
a scratch instance on a different port, hit it with curl and/or the
browser tool, against the real Supabase project) before saying
something works or asking him to check. Keep any engineering
justification ("we did X because Chaturbate's API doesn't support Y")
out of the product's own UI copy — that reasoning belongs in chat only.
