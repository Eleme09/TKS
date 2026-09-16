# PLACER SERVICES — Chaturbate token/payroll tracker


**Historial detallado de bugs ya resueltos, investigaciones día-a-día y
diagnósticos pasados: ver `HISTORIAL.md` en la raíz del repo.** Ese archivo
NO se carga automático como este (`CLAUDE.md` sí se inyecta entero en cada
sesión, gasta tokens en cada turno aunque no haga falta) — ábrelo con Read
solo si necesitas el detalle puntual de algo. Este archivo se mantiene con
lo que una sesión futura necesita saber ANTES de tocar código: arquitectura
actual, reglas de negocio vigentes y qué no volver a romper — no la crónica
de cómo se llegó ahí.

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

## Multi-terminal work — always persist, never leave it only in chat

The user works from several terminals/devices on this same project and does
not have time to re-explain context to a fresh session every time. Any
output that took real work to produce — a document, a checklist, a
generated file, a reusable procedure — must end up somewhere durable
(this repo, or a Supabase table) before the turn is considered done, not
just shown in chat. Chat history does not carry over between terminals;
the repo and the DB do.

Concretely: `public.cb_kit_docs` (id text primary key, content text,
updated_at) holds reference documents that aren't code but that the user
needs from any device — right now: `skill-studio-tracker-setup.md` (mirror
of `.claude/skills/studio-tracker-setup/SKILL.md`), `ficha-alta.html` and
`ficha-cliente.html` (the two onboarding checklists for replicating this
project to a new studio — see that skill), and the sales funnel:
`sales-script.md` / `sales-email.md` (first cold contact — problem/
solution pitch, ends by offering a demo with invented numbers, never
mentions a price) and `post-demo-proposal.md` (sent only after the
prospect approves the demo — the $250.000 deposit ask, the real data
ficha, and the actual pricing menu). **Current pricing (2026-09-03,
confirm with the user before reusing — these numbers change, and
already changed once this same day, see below):** there is NO one-time
build fee anymore — $500.000 every quincena is the base recurring
charge just for having the site up and running (6-day build, Jeiner
hosts on his own Render/Supabase, client gets a normal `administrador`
account for their own day-to-day — this does NOT include the "rol
avanzado" of technical superuser actions like password resets/force-
logout/reconnect, which stays with Jeiner unless sold separately); an
optional **+$80.000/quincena** on top of that (total $580.000) if the
client also wants Jeiner actively monitoring/maintaining the page
instead of just leaving it running; $4.500.000 one-time full buyout —
client gets their own Render/Supabase accounts plus the editable source
code, delivered clean (see below), and pays no more recurring fee after
that; $40.000/$100.000 per incident for fixing bugs a THIRD-PARTY
programmer introduced (not Jeiner's own bugs). No verified market data
exists on whether real prospects will accept the $500-580k/quincena
recurring price — it's a reasoned comparison only (roughly what a
part-time bookkeeper doing this by hand would cost, in a niche with no
direct competitor), not a confirmed fact; test it on the first 2-3 real
prospects rather than assuming it's right or wrong. The real
pitch, always: "we consolidate your platforms' numbers into one clean
place," never "the platforms hide income from you" — see the correction
in the Chaturbate-income section below for exactly why that second
framing is wrong. **Clean delivery for the 4.5M tier:** verified
2026-09-03 that only `CLAUDE.md`, `.claude/skills/`, and one line in
`iniciar.bat` mention "Claude" anywhere in this repo — `server.js`,
`chaturbate-lib.js`, `index.html`, `schema.sql` have zero AI-authorship
tells. A client handoff for that tier means excluding those files and
shipping without git history (or a squashed single-commit history with
no Claude co-author trailer) — normal delivery hygiene, not deception,
and never fabricate a false human author name for it. Query it from any
terminal with
(A neon sign-on splash intro for the opening of a sales demo was tried
and discarded 2026-09-03 — the user didn't like it after seeing the
polished version. Don't re-suggest a splash/intro animation for either
the daily tool or the demo flow unless the user brings it up again.)
Query it from any terminal with
`select id, content from cb_kit_docs where id = '...'` instead of asking
the user to re-upload or re-describe something already produced once. If
the skill or the fichas change, re-upsert the matching row here too — the
repo file and the DB row are meant to stay in sync, not one abandoned.

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
  auto-sync, `GMAIL_USER`/`GMAIL_APP_PASSWORD` for the critical-alert
  email backup below — all optional, not required to start). Never
  hardcode secret values in source — the server intentionally refuses to
  start without them as env vars. Locally they live in `env.bat` (in
  .gitignore, not in the repo — if missing, regenerate values from the
  Render dashboard's Environment tab, which is the source of truth, or
  ask the user). `iniciar.bat` sources `env.bat` then runs `node
  server.js`.
- **Uptime**: production is now on a **paid Render plan** (upgraded
  2026-09-04, confirmed by the user in chat — not independently verified
  from this session, since no browser tool is available here to check the
  Render dashboard directly). A paid plan doesn't sleep on inactivity and
  has no monthly instance-hour cap, so the old free-tier problem this
  section used to describe no longer applies. **The UptimeRobot monitor
  is now redundant and can be removed** — it existed only to ping the
  site every 5 min so the old free tier wouldn't spin down. If a future
  session finds it still configured, that's leftover cleanup, not a sign
  something's wrong; removing it is safe once the paid plan is confirmed
  active in the Render dashboard.
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
  **Still true regardless of the API — correction 2026-09-03:** an
  earlier version of this file said the user had personally set "never
  script a login to Stripchat" as their own fraud-prevention rule. The
  user says that's wrong — they never asked for that, don't want it
  documented as their own rule, and want full automation. Attribution
  fixed. The substance still stands anyway, as Claude's own standing
  engineering judgment, independent of who asked for it: scripted/
  automated *login* (not the API key above — that's fine) to Stripchat
  or Chaturbate from this server risks the real broadcaster account
  getting flagged/suspended for automated access outside the platform's
  sanctioned API, on money-generating accounts that aren't ours to
  gamble with, and it can't be verified safely since both domains are
  blocked from this tool's own browsing (see below) — building
  auth-bypassing scraper code blind, for something this high-stakes, is
  a bad idea regardless of who signs off on it. A future session asked
  to do this should re-raise the same concern, not silently comply
  because a past session's note got corrected. Also worth knowing:
  `stripchat.com` and every
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

## Noticias (added 2026-09-02)

A fourth tab, visible to all three roles (unlike Cuentas). `administrador`
and `ceo` publish posts (title + body) via `POST /api/news/create`; **any**
logged-in role (including `modelo`) can reply in that post's thread via
`POST /api/news/comment` — this was a deliberate choice, not an oversight:
the feature is meant to be a two-way board, not a pure broadcast. Only
`administrador` can delete a post or a single comment (moderation).
`GET /api/news` returns posts with their comments already nested
(`sbListNewsCommentsForPosts` groups by `post_id` server-side) — no
separate per-post fetch needed. Tables: `cb_news_posts` /
`cb_news_comments`, both carry `author_username`, `author_role`, and
`author_gender` (the last one purely so `roleBadgeHtml` can render a
correctly-colored CEO badge without a join — pulled straight from
`session.gender` at write time). **This was explicitly scoped as v1**:
messages/threads only, no polls/surveys yet — the user chose that scope
deliberately when asked, so don't add polls without checking first if
they still want that as a separate phase.

## Noticias — later additions (2026-09-02, same day as the feature itself)

- **Post type**: `post_type` on `cb_news_posts` is `'hilo'` (comments
  allowed, the default) or `'aviso'` (no comments — the comment box is
  hidden client-side, and `/api/news/comment` also rejects server-side
  by checking `sbFetchNewsPostType`, so it's not just a UI-level
  restriction). Chosen by admin/CEO at creation time via a `<select>`
  in the create form; can't be changed after a post is published.
- **Read tracking**: `cb_news_reads` (`post_id, username, role,
  read_at`, unique on `(post_id, username)`) — any `GET /api/news` call
  marks every returned post as read for that session (fire via
  `sbMarkNewsRead`, upsert so re-reading doesn't duplicate). The
  response only includes a `viewers` array (model usernames who've
  read it) when the requesting session is `administrador` or `ceo` —
  filtered server-side to `role = 'modelo'` rows only
  (`sbListNewsModeloReadsForPosts`); a `modelo` session never sees who
  else viewed anything. Rendered as a small eye-icon line, admin/CEO
  only.
- **Custom display name**: `cb_admins.display_name` — self-service,
  `administrador` role only, via `POST /api/me/set-display-name`
  (separate from the login `username`, which never changes). Like
  `author_anonymous`, it's snapshotted into `author_display_name` on
  `cb_news_posts`/`cb_news_comments` at write time — pulled from
  `sbFindAdmin(session.username).display_name` right when the post/
  comment is created, not looked up at render time. **Anonymous still
  wins**: if `hide_name` is on, render "Anónimo" regardless of
  `display_name`. **Gotcha already hit once**: `sbFindAdmin`'s SELECT
  must include `display_name` (and `hide_name`) or every post silently
  gets `author_display_name: null` — both `sbFindAdmin` and
  `sbListAdmins` need to stay in sync on which columns they select;
  they drifted once already (fixed same day).
- Platform icons on the model card (replacing plain "CB"/"SC" text):
  hotlinked favicons (`https://chaturbate.com/favicon.ico`,
  `https://stripchat.com/favicon.ico` — confirmed loading fine as of
  2026-09-02) via `platformIconHtml()`, with an `onerror` fallback to a
  small colored initials badge if a favicon ever stops loading. This is
  the *website's own visitor* loading those images directly in their
  browser — unrelated to, and not blocked by, the domain restrictions
  that apply to *my own* browsing tools (see the Stripchat section
  above).

## More fixes (2026-09-02, later same day)

- **The Stripchat paste-and-parse form is gone from the UI** — removed
  entirely once the Studio API auto-sync made it redundant (explicit
  user call: "bórralo"). The backend endpoints
  (`/api/stripchat/parse`, `/api/stripchat/save`) are still there,
  untouched, as a dormant manual fallback if the API key ever breaks —
  just nothing in the frontend calls them anymore. If you ever need to
  bring manual entry back, the server side already works; you'd only
  need to re-add UI.
- **Static files now send `Cache-Control: no-cache`** (`serveStatic` in
  server.js). Without it, a browser could silently keep serving a
  stale `index.html` after a deploy — suspected cause of a user report
  that a just-shipped feature "wasn't there" on their PC.
- **Push notification `tag` bug, fixed**: `sw.js`'s `showNotification`
  used one hardcoded tag (`'placer-online'`) for *every* push type —
  browsers silently replace a shown notification with a new one that
  shares its tag, so a news notification could clobber an online-status
  one (or vice versa) without re-alerting the user. Now each call site
  passes its own `tag` through the push payload
  (`sendPushToRole(role, body, { tag, excludeUsername })` — see
  `sendOnlineNotifications`/`sendConnectionAlert`/
  `sendNewsNotification`), and `sw.js` falls back to a unique
  `'placer-' + Date.now()` if none is given. Keep giving every new push
  type its own tag.
- **News posts now push a notification** (`sendNewsNotification`) to
  all subscribers except the post's own author. **Diagnosed why "online"
  notifications seemed to never arrive**: as of 2026-09-02, the *only*
  push subscriptions in `cb_push_subscriptions` belong to `Elemee`
  (administrador, 3 devices) — no `ceo` account has ever clicked the
  bell. Since "modelo conectada" is deliberately CEO-only
  (`sendPushToRole('ceo', ...)`), there was never a valid recipient —
  correct behavior, not a bug. It'll start working the moment a CEO
  account subscribes.
- **`logo-icon.svg`** (new file) is `logo-placer-studios.svg` plus one
  opaque `<rect>` background, used *only* for
  favicon/apple-touch-icon/manifest icon. Deliberately kept separate
  from the original file — `logo-placer-studios.svg` is also the CSS
  `background-image` for the on-page `.brand-cat`/`.login-bg-cat` logo,
  which needs to stay transparent (already sits on the page's own dark
  background). Got this wrong once already this same day (edited the
  shared file directly, darkened the on-page logo by accident, user
  caught it immediately) — if the logo ever needs a visual tweak,
  think about which of the two files (or both) it should apply to
  before editing.
- `.time12 select` (the hour/minute/AM-PM pickers in Extras) now use a
  custom compact arrow (`appearance: none` + inline SVG chevron)
  instead of each browser's native dropdown arrow, which was cramped
  in such narrow selects — best-effort fix for a user report of
  "overlapping icons" in that picker on mobile; unconfirmed on a real
  device since I can't fully replicate mobile Safari's native `<select>`
  rendering myself.

## Push notifications now open to `modelo` too (2026-09-02, later still)

Originally push (`/api/push/*`, the bell button) was gated to
administrador/CEO only — built before Noticias existed. Once Noticias
became something models read and comment on, that gate stopped making
sense, so it's now open to any authenticated role. **Important:**
`sendPushToRole` accepts a role, an *array* of roles, or `null`
(everyone) — don't casually pass `null` for a new notification type
without thinking about whether `modelo` should actually receive it now
that she can subscribe. Current scoping, keep it this way unless the
user asks otherwise: `sendOnlineNotifications` → `'ceo'` only;
`sendConnectionAlert` → `['administrador', 'ceo']` (a model can't act
on a broken tracker); `sendNewsNotification` → everyone except the
post's author (`null` + `excludeUsername`, deliberately unrestricted
since Noticias is meant to reach models); **`sbLogApiError` → `'administrador'`
only (added 2026-09-03)** — every Chaturbate Stats/Stripchat API failure
or shape-change now also pushes an immediate notification (tag
`placer-api-error`) instead of only waiting for the next daily vigía run
or a manual `cb_api_errors` query. Scoped to `administrador` only (not
`ceo`, per explicit user request) since this is the same kind of
technical/actionable alert as a connection drop — a role that can't
act on it doesn't need to be woken up by it. Verified end-to-end for
real: a temporary admin-only `GET /api/test-error-notification` was
deployed, hit once from the user's own logged-in browser, confirmed
delivering the push notification to his device, then removed again —
the codebase carries no trace of that test endpoint. `npm test` 32/32
throughout.

Push subscriptions are **per-device**, not per-account — a user
subscribing on their PC does not enable notifications on their phone,
and vice versa; each browser/device needs its own click on the bell.
Confirmed via the real `cb_push_subscriptions` table more than once
this day that this — not a code bug — was behind more than one "notifications
aren't arriving" report. Before assuming a push bug, check that table
first (`select username, role, endpoint from cb_push_subscriptions`)
to see who's actually subscribed from where.

**Real bug found the same day, DB-side, not code:** opening
`/api/push/subscribe` to `modelo` wasn't enough — `cb_push_subscriptions`
still had a leftover foreign key,
`cb_push_subscriptions_username_fkey`, tying `username` to
`cb_admins(username)` only (from when this table was admin/CEO-only).
Any model trying to subscribe got a silent `23503` FK violation → my
own generic "no se pudo guardar" error, no useful detail. **Dropped the
constraint** (`alter table cb_push_subscriptions drop constraint
cb_push_subscriptions_username_fkey`) — same pattern as
`cb_news_posts.author_username`, which never had this problem because
it was never FK-constrained in the first place. If a *new* table ever
needs a `username` column that can be either an admin/CEO or a model,
don't add a single-table FK to `cb_admins` — there's no clean two-table
FK in Postgres, so these columns are deliberately left unconstrained at
the DB level and trusted at the application level instead, matching
existing pattern for author_username across cb_news_*.

## Email backup for critical alerts (added 2026-09-04)

Push-only alerts have a real gap, found via a real case: the user (role
`administrador`) got a `chaturbate_stats` HTTP 403 push on his PC (Edge)
but the same push never showed on his iPhone, even though his Apple Web
Push subscription for that device was still present and valid in
`cb_push_subscriptions` (no 404/410 came back, so `sendPushToRole` never
auto-deleted it — the failure is device-side: iOS silently stops
delivering to a PWA that's not on the home screen anymore, or has
notifications toggled off in Settings, without ever telling the server).
Root cause is unfixable from this codebase — it's an iOS platform
behavior, not a bug here. The user's actual worry: if a *genuinely*
serious one lands exactly when his phone's push is silently broken, he
finds out late or not at all.

**Fix: the two alerts worth waking up for now also go out by email**,
independent of push and independent of any device's subscription state
— `sendConnectionAlert` (a model's tracker actually dropped — we stop
seeing her live tips) and `sbLogApiError` (Chaturbate/Stripchat API
broken or changed shape). Both still push as before; email is pure
redundancy, not a replacement. `sendOnlineNotifications` and
`sendNewsNotification` deliberately do NOT get this — they're not
"wake up for this" material.

- `sendAlertEmail(subject, body)` in server.js, right after the VAPID
  setup block. Uses `nodemailer` (new dependency,
  `npm install nodemailer`) with Gmail SMTP
  (`nodemailer.createTransport({ service: 'gmail', auth: {...} })`).
  Destination is hardcoded `ALERT_EMAIL_TO = 'menajeiner@gmail.com'`
  (the user's own address, not a secret — same address the vigía
  triggers already email, see below).
- **Optional, same pattern as VAPID/Stripchat**: needs `GMAIL_USER` +
  `GMAIL_APP_PASSWORD` env vars (a Gmail *app password* — generated at
  myaccount.google.com/apppasswords, requires 2-Step Verification on
  that Google account; NOT the account's normal login password). Without
  both, `EMAIL_ALERT_ENABLED` is false and the server runs exactly as
  before, just without this backup — verified by booting a scratch
  instance both with and without these two vars set (`SOLO_UI=1`, dummy
  Supabase creds) and confirming a clean boot log either way. Fire-and-
  forget, no retries, wrapped in try/catch — this is a diagnostic
  redundancy channel, not money, so it must never throw or block the
  caller (`sendConnectionAlert`/`sbLogApiError` both already run
  fire-and-forget themselves).
- **As of 2026-09-04 these env vars are not yet set anywhere** (not in
  Render, not local) — the user asked for this to be built, but hadn't
  generated the app password yet. A future session: check
  `GMAIL_USER`/`GMAIL_APP_PASSWORD` are actually in Render's Environment
  tab before assuming this is live; if missing, the feature is dormant
  by design (see "optional" above), not broken.
- **Don't confuse this with the vigía's emails** (daily system-health
  check + the one-shot cashout-hour check, both described further down)
  — those are sent from *this Claude Code session's own* Gmail MCP
  access, which only exists while a session is actively running/
  scheduled. This new mechanism sends straight from the running
  server.js process on Render, so it fires the instant the real event
  happens, with no dependency on any Claude session being alive.
- If a third alert type ever earns "wake up for this" status, wire it
  the same way: one `sendAlertEmail(...)` call alongside its existing
  `sendPushToRole(...)` call, fire-and-forget. Don't build a generic
  every-push-also-emails switch — that would just spam the inbox with
  low-stakes stuff (online status, news posts) the user explicitly
  doesn't want waking him up.


## Automatización de Chaturbate/Stripchat — reglas fijas (detalle en HISTORIAL.md)

- **Nunca scriptear login** a chaturbate.com ni stripchat.com desde este
  servidor (Playwright/Puppeteer u otro) — riesgo real de que la cuenta de
  la modelo (dinero real, no nuestra) quede marcada por acceso automatizado
  fuera de la API oficial. Solo usar las APIs oficiales autenticadas por
  token (`stats_api_token` de Chaturbate, `STRIPCHAT_API_KEY`). Confirmado
  además que el login de Chaturbate está bloqueado por un challenge de
  Cloudflare desde el primer request — no es una limitación nuestra a
  resolver, no reinvestigar.
- `stripchat.com` y todos sus subdominios (incluido `docs.stripchat.com`)
  están bloqueados a nivel de herramienta para mi propio browsing (WebFetch,
  browser en sandbox, Claude in Chrome) — bloqueo de categoría, no de auth.
  Pedir captura/pegado directo al usuario para cualquier cosa de ese dominio.
- `resolveChaturbateTokens` (`chaturbate-lib.js`) es la ÚNICA función por la
  que debe pasar cualquier total de tokens de Chaturbate — ya documentada
  con comentarios ahí mismo. No reimplementar esta lógica en otro lado.
- El balance se sondea denso (cada 60s) solo en la ventana 04:18–04:30 UTC
  (el corte diario de Chaturbate cae ahí) — **nunca subir esa frecuencia**:
  ya causó un bloqueo HTTP 403 real de 17 minutos (2026-09-04). Hay un
  patrón de HTTP 403 aislado, ~1 por hora, benigno y ya diagnosticado
  (rotando de modelo, autorecuperado siempre) — no es motivo de alarma por
  sí solo; el filtro de racha en `sbLogApiError` ya distingue esto de un
  bloqueo real. Investigación completa en HISTORIAL.md.

## Tests (added 2026-09-03)

`npm test` runs `node --test` (Node's built-in test runner, no new
dependency added). Only the money/date math is tested —
`chaturbate-lib.js` holds every pure function this project has (no
`fetch`, no Supabase, no server state): `getQuincena`/
`getQuincenaHistory`/`toDateStr`, `sanitizeUsername`, `hashPassword`/
`verifyPassword`, the Chaturbate CSV parser
(`parseCsvLine`/`parseChaturbateTransactionsCsv`/
`sumChaturbateCsvEarningsForPeriod`), `isNearChaturbateCashout`, and
**`resolveChaturbateTokens`** — the function every Chaturbate total in
the app goes through. `server.js` requires this module instead of
defining these functions itself; don't redefine any of them back in
`server.js`, and don't add a new pure function there either — put it in
`chaturbate-lib.js` and export it so it stays testable.
`chaturbate-lib.test.js` includes a regression test named after the
exact bug it guards (base-freeze not falling back to ongoing tips) —
if you ever touch `resolveChaturbateTokens`, run `npm test` before
pushing, not just a manual scratch-instance check. `server.js` itself
still has zero test coverage (it needs real Supabase/Chaturbate to do
anything) — end-to-end verification against the real Supabase project
via a scratch instance on another port remains the way to test
anything that touches the DB or a live API, same as always.


## Vigía automático del sistema (added 2026-09-03)

Chequeo diario programado (Routine, `mcp__Claude_Code_Remote__create_trigger`,
corre 12:00 UTC contra esta sesión) que revisa señales reales en la base y
solo avisa (chat + correo a menajeiner@gmail.com) si encuentra algo —
silencioso el resto de los días. Cubre: `cb_unhandled_events` con método
nuevo, `cb_api_errors` (incluye rachas de HTTP 4xx/5xx vía el filtro de
`sbLogApiError`), balance de modelo con `stats_api_token` sin actualizar
hace 2h+, y sync de Stripchat sin actualizar hace 24h+. Trigger actual:
`trig_01BXcfPNvAetGc9gcNcJUa7m` ("Vigía diario del sistema"). Límite real:
no puede resolver una credencial vencida por sí solo, solo detectar y
avisar qué modelo/plataforma. Si hace falta una quinta señal o cambiar el
formato del correo, `update_trigger` con el prompt completo (reemplaza el
anterior entero) — un solo chequeo diario, no uno nuevo por señal. Historial
completo de lo encontrado día a día en HISTORIAL.md.

## Asistencia — entrada/salida, justificaciones y excusas (added 2026-09-04)

Sexta pestaña, visible para los tres roles. Sustituye la idea de una tabla
suelta donde cada modelo anotaba su hora a mano.

**El flujo de la entrada, que es lo que tiene chiste:**
1. La modelo pulsa "Reportar mi llegada" → se crea una fila `pendiente` en
   `cb_attendance_days` con `reported_at` = ese instante. **Todavía no cuenta
   nada.**
2. El `administrador` la valida (CEO no: es lectura). Tiene tres salidas, y
   esto fue una mejora deliberada sobre lo que pidió el usuario, que era
   "la hora vale desde que yo la valido":
   - **"Sí llegó a esa hora"** (`source: 'reportada'`) — vale `reported_at`.
   - **"Llegó ahora"** (`source: 'ahora'`) — vale el instante de la
     validación. Este es exactamente el caso que planteó el usuario ("Conni
     reportó a las 4 PM y no estaba").
   - **"Otra hora…"** (`source: 'manual'`) — el admin escribe la hora real.
   - o **Rechazar**, con motivo.
   **Por qué no se implementó tal cual "vale desde que yo valido":** ahí la
   modelo paga la demora del admin. Si llega puntual a las 4:00 y el admin
   valida a las 4:40, quedaría con 40 min de retraso que no son suyos — y ese
   retraso acumulado decide quién paga su seguridad social, así que es plata.
   Con los tres botones el caso que el usuario quería sigue funcionando igual
   ("Llegó ahora"), pero el caso normal no castiga a nadie por la latencia del
   admin. `reported_at` y `official_at` se guardan las dos, siempre, para poder
   auditar la diferencia. **No lo simplifiques a un solo botón.**
3. `late_minutes` = `official_at` − hora del turno, **ya con el margen de
   tolerancia aplicado** (ver abajo). Positivo tarde, negativo temprano. Sin
   horario asignado en `cb_attendance_schedule`, no se calcula retraso (queda
   `null`, no 0).

**Turnos (definidos por el usuario 2026-09-04).** Dos turnos con nombre en
`ATTENDANCE_SHIFTS` (`chaturbate-lib.js`): **Mañana 07:30–15:30** y **Tarde
16:00–00:00**. Se asignan de un botón en Asistencia → Horarios y umbral;
`POST /api/attendance/schedule` acepta `{username, shift}` (el servidor pone
las horas, para que el botón no dependa de que el navegador las mande bien) o
`{username, entry_time, exit_time}` para un horario distinto. Si las horas
escritas a mano coinciden con un turno, se guarda como ese turno. El turno de
la tarde **cruza medianoche**, que es justo el caso que `pickWorkDate` cubre.

### Margen de tolerancia de entrada — ELIMINADO (2026-09-10, ver sección al final del archivo)

Esta sección documentaba un margen de 12 minutos que perdonaba los primeros
minutos de retraso de cada turno. **Ya no existe** — el usuario pidió
quitarlo explícitamente, hora normal desde el minuto 1. `ATTENDANCE_GRACE_MINUTES`
y `applyLateGrace` fueron borrados de `chaturbate-lib.js`, no solo puestos en
0 — no queda ningún mecanismo de margen en el código. Detalle completo del
cambio (y de la migración de datos que hizo falta) en la sección dedicada al
final de este archivo.

**La salida la anota ella y no se valida** (decisión explícita del usuario).

**Zona horaria — ojo con esto.** El estudio es colombiano y las modelos
trabajan de noche: una jornada que arranca 8 p.m. cae al día siguiente en UTC,
que es donde corre Render. Todo lo de asistencia usa un offset fijo de UTC-5
(`STUDIO_UTC_OFFSET_HOURS` en `chaturbate-lib.js`; Colombia no tiene horario de
verano, así que el offset fijo es exacto). Nunca uses `toDateStr`/hora del
servidor para asistencia. Además, `pickWorkDate` decide a qué turno pertenece
una llegada comparando contra el horario de hoy **y el de ayer**, y se queda
con el más cercano: sin eso, llegar 00:30 a un turno de 8 p.m. contaba como
"19 h temprano" del día siguiente en vez de "4 h 30 tarde" del turno de anoche.

**Privacidad:** el filtrado es server-side en `buildAttendancePayload` — una
`modelo` solo recibe sus propias filas, y ni siquiera vienen los campos de
staff (`pending`, `models`). No mandes todo y escondas en el navegador.
`GET /api/attendance/excuse?id=N` también valida dueño: una modelo abriendo la
excusa de otra recibe 403 (verificado con dos cuentas reales).

**Notificaciones** (`administrador` + `ceo`, salvo la primera): llegada
reportada pendiente de validar; al validar, "X llegó a las HH:MM — N min de
retraso" / "llegó temprano" / "llegó justo a la hora"; excusa médica subida; y
si al validar ya entraron todas las que tienen horario y ninguna llegó tarde,
**"TODAS TUS MODELOS ENTRARON A TIEMPO"**, una sola vez por día
(`cb_attendance_daily_notice` tiene la fecha como primary key, así que el
segundo intento choca y no repite).

**Deuda por retrasos y seguridad social — reglas confirmadas por el usuario
el 2026-09-04, ya no son inventadas:**
- **$10.000 COP por cada HORA COMPLETA** de retraso acumulado en la quincena.
  Se cobra por hora alcanzada, **no proporcional**: 59 minutos acumulados no
  deben nada, 60 deben una hora entera (`lateDebtHours`/`lateDebtCop` en
  `chaturbate-lib.js`, con tests).
- **Pasadas 6 horas (360 min)** acumuladas, la modelo asume su propia
  seguridad social esa quincena. Antes el umbral era 300 min, que era un
  número que me inventé como valor de arranque; 360 es el real.
- Los dos valores son configurables desde Asistencia → Horarios y umbral
  (`late_threshold_minutes` y `late_hour_fee_cop` en
  `cb_attendance_settings`). La tarifa se pasa como parámetro a
  `lateDebtCop`, no está fija dentro de la función.
- **La deuda NO se resta automáticamente del desprendible por tokens.** Se
  muestra como su propio total, y la UI dice explícitamente que se descuenta
  al pagar. Cambiar eso a un descuento automático es una decisión de plata
  que el usuario no ha pedido — preguntar antes.
- Llegar temprano NO descuenta retrasos de otros días (`sumLateMinutes` solo
  suma los positivos), si no se podría "compensar" un retraso grande.

**Separación deliberada tokens / retrasos:** los tokens (ingreso, viene de
APIs externas) viven en Modelos y Desprendibles; los retrasos y su deuda
(disciplina, dato interno) viven en Asistencia. Se mantienen separados a
propósito: mezclarlos haría que una modelo que reclama su pago tenga que
desenredar dos cosas que no tienen nada que ver. El punto donde se juntan es
al momento de pagar, y ahí la deuda entra como una línea de descuento aparte,
no recalculada dentro del desprendible.

**Excusas médicas:** el archivo va en base64 dentro de
`cb_attendance_excuses` (tope 2.5 MB, solo JPG/PNG/WEBP/PDF, validado en el
servidor). Es más simple que un bucket aparte para el volumen real; si esa
tabla crece mucho, esa es la señal para mudarlo a almacenamiento de archivos.

**Correcciones del administrador (2026-09-04):** solo el rol
`administrador` (el CEO ve pero no corrige, y una modelo no puede bajar lo
que ya escribió).
- `POST /api/attendance/justification/delete` `{id}` — baja un justificante.
- `POST /api/attendance/day/reset` `{id, mode}` — `'revalidar'` deja la
  jornada pendiente otra vez, borra hora válida/salida/retraso y **vuelve a
  leer el turno vigente** de esa modelo (que es lo que hace falta cuando el
  turno estaba mal en el momento en que ella fichó); `'borrar'` la elimina y
  ella puede reportar ese día desde cero.
- Los dos guardan en `cb_audit_log` lo que había antes. Eso ya sirvió para
  recuperar una jornada borrada por error, así que **no le quites el
  `sbLogAudit` a estas dos rutas**: son las únicas acciones de asistencia que
  destruyen datos sin deshacer.
- Los botones viven en `asistencia.html`, en la tabla de jornadas y en cada
  justificante, y solo se pintan si `data.role === 'administrador'`.

**La deuda se muestra como un solo número**, sin párrafo explicativo: "Total
a pagar por retraso" grande y debajo, en chico, "N h × $10.000 COP por hora"
— el mismo tratamiento que la tasa del dólar en los desprendibles. Una modelo
(o la hoja filtrada por una) ve **solo su total**; la lista comparativa de
quién debe qué es únicamente para administración sin filtro.

**Aviso de seguridad social — ahora configurable por cliente (2026-09-05).**
`cb_attendance_settings.social_security_enabled` (boolean, default `true` en
la fila real de Placer Studios, default `false` en `schema.sql` para un
cliente nuevo). Motivo: "asume su propia seguridad social al pasar el
umbral" es un concepto laboral colombiano específico de este estudio, no
algo que deba salir por defecto en el sistema que se vende a otros — un
pedido explícito del usuario para separar la plantilla de venta del cliente
actual. Administrador lo prende/apaga desde Asistencia → Horarios y umbral
(checkbox nuevo junto al umbral/tarifa). Server-side, `buildAttendancePayload`
calcula `owes_social_security: socialSecurityEnabled && lateMinutes >=
threshold` — con el flag en `false`, esa expresión es siempre `false` para
todos, así que el banner (`renderAttendanceWarning` en `index.html`) nunca
aparece y el pill de cada modelo (`index.html`/`asistencia.html`) siempre
muestra "al día", sin tocar ni un solo lugar del frontend aparte de agregar
el checkbox — toda la lógica de ocultamiento vive en el servidor.
**Corrección sobre el propio flag (2026-09-05, misma tarde):** cuando este
flag se escribió arriba, esta sesión afirmó con seguridad que "no existe ni
existió un techo de $50.000 que resetea la multa a 0" — **eso era falso**, y
el error fue metodológico: se verificó contra un checkout local desactualizado
sin volver a traer `origin/master` primero, justo lo que la sección "Antes de
tocar nada" de este archivo pide no hacer. Otra sesión, en paralelo el mismo
día, había confirmado con el usuario y ya mergeado a `master`
`lateDebtCopCapped(lateMinutes, feeCop, thresholdMinutes)` en
`chaturbate-lib.js`: pasado el umbral (6h/360min por defecto) la deuda en
plata SÍ pasa a `$0` en vez de seguir subiendo — con la tarifa de $10.000/h,
el tope natural bajo el umbral son 5 horas completas, exactamente los
$50.000 que el usuario había descrito. `debt_hours` (las horas reales) nunca
tuvo tope, solo el cobro en COP se detiene.
**Cómo queda reconciliado con `social_security_enabled`:** `debt_cop` en
`buildAttendancePayload` ahora es `socialSecurityEnabled ?
lateDebtCopCapped(lateMinutes, feeCop, threshold) : lateDebtCop(lateMinutes,
feeCop)` — con el flag en `true` (Placer Studios) se comporta como la otra
sesión lo confirmó: tope a `$0` al pasar el umbral. Con el flag en `false`
(código de venta a un cliente nuevo, sin ese concepto laboral) la multa
crece sin tope, tal como el usuario pidió explícitamente en esta misma
conversación ("este no tendrá ese tope... debería seguir normal para el
código de venta") — el tope siempre estuvo atado al mismo concepto que el
aviso de seguridad social, así que gatearlos con el mismo flag es correcto,
no una coincidencia. Ver la sección "Tope de multas y bloqueo de extras/
recuperaciones por incumplimiento" más abajo para el resto de lo que trajo
esa sesión paralela (Extras con tipo/hora de salida, bloqueo por 3
incumplimientos) — no relacionado con este flag, se mergeó sin conflicto.
**Lección para la próxima sesión:** `git fetch origin master` y comparar
antes de afirmar categóricamente "esto no existe en el código", sobre todo
en un proyecto que este mismo archivo ya advierte que se edita desde varios
dispositivos en paralelo.
**Permisos, corregido también:** `/api/attendance/settings` sigue siendo
`requireAdmin` (solo `administrador`, NO `ceo`) — otra idea que circuló en
chat y que el código no respalda; si en algún momento se quiere que `ceo`
también pueda cambiar la tarifa/umbral, es un cambio de permisos deliberado
que hay que pedir explícitamente, no algo que ya esté así.
Probado en vivo contra la base real: cuenta admin temporal (`qa_temp_admin`,
creada y borrada en la misma sesión), instancia `SOLO_UI=1` en otro puerto,
apagado → verificado `owes_social_security` se cae solo en la respuesta →
restaurado a `true` (estado real de Placer Studios) antes de cerrar. Como el
código ya desplegado en producción no lee esta columna todavía, alternar su
valor en la base real durante la prueba no tuvo ningún efecto en el sitio
en vivo.

**Al probar contra la base real, filtra por tus propias cuentas de prueba.**
El 2026-09-04 se tomó `days[0]` de la respuesta para probar el borrado y esa
fila resultó ser del usuario, no de la cuenta de prueba: se borró una jornada
real. Se pudo restaurar desde `cb_audit_log`, pero nunca agarres "el primero
de la lista" en una base compartida — filtra por el prefijo de tus cuentas.

**Gotcha al probar con cuentas falsas:** una fila de prueba en `cb_models` con
`role: 'modelo'` la levanta el poller de Stripchat **de producción** (no el
scratch), que le pide sus ganancias y se come un 404 por modelo por ciclo,
ensuciando `cb_api_errors` y pudiendo disparar una falsa alarma del vigía
diario. Pasó el 2026-09-04 con dos cuentas `qa_asist_*`; las filas se borraron
a mano. Si vuelves a crear modelos de prueba, bórralas rápido y revisa
`cb_api_errors` después.

**Tabla estilo planilla + `public/asistencia.html` (2026-09-04, segunda
pasada, a pedido del usuario):**
- Las tablas de jornadas ahora traen **Día · [Modelo] · Entrada · Salida ·
  Retraso · Problemática · Justificante · Estado**. "Problemática" es el
  `kind` de la justificación (Retraso / Internet / Conexión / Room / Salud /
  Otro — se agregó `internet` a la lista) y "Justificante" es el texto, ambos
  cruzados por `username|work_date` contra `cb_attendance_justifications`.
  La columna Entrada muestra la hora que cuenta y, si el admin la corrigió,
  debajo en chico lo que la modelo había reportado — sin eso se pierde la
  única pista visible de que hubo corrección.
- **Encabezados-ícono en móvil** (`attTh()` + `.th-txt`/`.th-ico`): bajo 640px
  el texto del `<th>` se oculta y queda el ícono de la columna. El usuario
  pidió esto porque los títulos a 10px "parecen metidos a la fuerza" en el
  teléfono. El nombre real queda siempre en `title`/`aria-label`, así que el
  ícono nunca es la única pista. La primera columna queda `position: sticky`
  para no perder de vista el día al desplazar de lado.
- Un justificante largo se recorta a dos líneas (`-webkit-line-clamp`) y se
  abre al tocarlo. **Sin ese recorte una fila con texto largo estira toda la
  tabla** y deja las demás columnas con un hueco enorme al lado — pasó y se
  vio en las capturas antes de arreglarlo.
- **`public/asistencia.html`**: la hoja sola, como página independiente,
  abierta desde el botón "Abrir la hoja completa" (`target="_blank"`). Usa la
  misma sesión (cookie) y el mismo `GET /api/attendance`; si no hay sesión
  muestra un aviso en vez de romperse. Repite los tokens de color/fuentes de
  `index.html` a propósito: es una página suelta que tiene que poder abrirse,
  recargarse e imprimirse por su cuenta (tiene `@media print`). **Si cambian
  los colores de marca, cambiarlos en los dos archivos.**

**Barra superior y pestañas compactadas en móvil (2026-09-04, tercera
pasada):** la barra superior eran cuatro renglones apilados ("ocultar mi
nombre", "cerrar mis sesiones en todos lados" y un "Salir" de ancho completo)
que se comían ~200px antes del primer dato; ahora el nombre va en una línea y
las cuatro acciones quedan en una fila de iconos (`.topbar-actions`,
`.btnAnon-ico`/`.btnAnon-txt`). Las 6 pestañas pasaron a icono-arriba /
etiqueta-abajo (`.tabIcon` en columna), que es el patrón estándar de barra
inferior: **todas siguen con texto visible**, no se repitió el error de dejar
pestañas solo-icono. **Ojo:** hay JS que antes hacía `textContent` sobre
`#btnToggleAnon` y `#tabBtnModelos` — ahora escribe sobre el `<span>` interno,
porque tocar el `textContent` del botón entero borraría su icono.

**Acceso a la hoja de una sola modelo:** cada fila del resumen de admin/CEO
tiene "Ver su hoja" → `/asistencia.html?modelo=<username>`, que abre la
planilla ya filtrada. El parámetro solo se aplica si esa modelo existe en la
lista; un `?modelo=` inventado no deja el selector en un valor fantasma.
La hoja también trae **"Descargar CSV"**, que exporta las jornadas que se
están viendo (respeta el filtro) más una sección con la deuda calculada.

**`SOLO_UI=1`** (nuevo en server.js): levanta el servidor sin ningún sondeo
externo. Es para probar la interfaz desde una instancia suelta en otro puerto
sin duplicar el tráfico a Chaturbate — dos instancias sondeando lo mismo es
exactamente lo que provocó el 403 del 2026-09-04. Nunca en producción: sin
sondeos no se registra ni una propina.

## Tope de multas y bloqueo de extras/recuperaciones por incumplimiento (2026-09-05)

- **Tope de la deuda por retrasos**: la deuda en plata (`debt_cop`) ya NO crece
  sin límite pasado el umbral de seguridad social. `lateDebtCopCapped(lateMinutes,
  feeCop, thresholdMinutes)` en `chaturbate-lib.js` devuelve 0 si
  `lateMinutes >= thresholdMinutes` (6h por defecto); por debajo del umbral el
  tope natural ya es 5 horas completas ($50.000 con la tarifa de $10.000/h,
  porque 6h es exactamente el punto de corte). `debt_hours` (las horas reales)
  NUNCA tiene tope — se sigue contando siempre, solo el cobro en COP se
  detiene. `buildAttendancePayload` en `server.js` es el único call site; no
  reintroduzcas el cálculo viejo (`lateDebtCop` sin capar) ahí.
- **Extras/recuperaciones — `cb_shifts` tiene ahora `kind` (`'extra'` |
  `'recuperacion'`, elegido por admin/CEO al publicar) y `attendance_status`
  (`'pendiente'` | `'cumplio'` | `'no_cumplio'`, marcado por admin/CEO en el
  calendario con los botones ✓/✗ sobre cada pastilla reclamada).** `end_time`
  ya existía en el schema sin usarse — ahora se pide junto con la hora de
  entrada y se muestra como rango en la pastilla. El campo "Nota (opcional)"
  se quitó del formulario a pedido del usuario (la columna `note` sigue en la
  tabla, solo no se llena más).
- **Bloqueo por 3 incumplimientos**: `isShiftClaimBlocked(noShowCount,
  hasOverride)` en `chaturbate-lib.js` — a la 3ra vez que una modelo se apunta
  a una extra/recuperación y queda marcada `no_cumplio` **en la quincena
  actual**, `/api/shifts/claim` la rechaza (403) hasta que empiece la próxima
  quincena o admin/CEO le otorgue un permiso puntual vía
  `POST /api/shifts/override` (tabla `cb_shift_overrides`, clave
  `username + period_start` — por eso expira solo, sin cron: al cambiar de
  quincena el `period_start` ya no coincide). **Esto NO mueve plata, es
  puramente un sistema de cumplimiento sí/no** — no lo conectes al cálculo de
  deuda ni de pago. `computeShiftBlockInfo` en `server.js` calcula todo esto
  reusando `sbListShifts()` (ya trae todo el historial), sin queries nuevas
  por request salvo `sbListShiftOverrides`.
- **Modelos**: el dato "Va ganando más" ahora separa el nombre (línea propia,
  rosa, mono) de los tokens (línea propia, chico, muted) — antes era un solo
  string corrido tipo `abigail_f00x (9689 tok.)` en una fuente uniforme,
  reportado como difícil de leer.
- Migración aplicada directo en Supabase (`apply_migration`, no vive como
  archivo `.sql` en el repo — `schema.sql` documenta el estado base, no cada
  migración incremental): `alter table cb_shifts add column kind ... ,
  add column attendance_status ...` + `create table cb_shift_overrides`.
- Probado end-to-end contra el Supabase real (instancia `SOLO_UI=1` en el
  puerto 3001, cuentas `qa_shift_admin`/`qa_shift_model` borradas al terminar
  junto con los turnos de prueba) y visualmente con Claude in Chrome antes de
  hacer push. `npm test`: 84/84. Push directo a `master` (sin pasar por `dev`/
  `tks-staging`) dado el nivel de verificación ya hecho — si el próximo cambio
  es más riesgoso, volver al flujo normal de la sección "Where things live".

## Cuatro features de Asistencia/Noticias/Extras + horas transmitidas (2026-09-09)

Pedido en un solo mensaje (4 features) más un quinto agregado a mitad de la
misma sesión. Los cinco viven ahora en `chaturbate-lib.js` (lógica pura,
con tests) + `server.js` (endpoints/schedulers) + `public/index.html` +
`public/asistencia.html`. `npm test`: 105/105. Probado end-to-end contra el
Supabase real (`SOLO_UI=1`, puerto 3001, cuentas `qa_temp_admin`/
`qa_temp_model` y sus filas de asistencia/turnos/noticias borradas al
terminar — verificado con una consulta aparte que no quedó rastro, ni en
`cb_api_errors`). Push directo a `master`.

1. **Admin agrega/corrige hora a mano en cualquier día** —
   `POST /api/attendance/day/edit` (solo `administrador`): a diferencia de
   `/api/attendance/day/reset` (que reabre una fila EXISTENTE), esta CREA la
   fila si hace falta — cubre el caso de una modelo que nunca reportó ese
   día. Acepta `entry_time` y/o `exit_time` (HH:MM), deja `official_source`/
   `exit_source` en `'manual'`. UI: card "Agregar o corregir hora
   manualmente" en `asistencia.html` (modelo + fecha + las dos horas) y un
   botón "Editar hora" por fila en la columna Corregir que solo prellena esa
   card (no duplica el formulario). `studioInstantAfter(workDate, timeStr,
   referenceTime)` en `chaturbate-lib.js` decide si una hora de salida
   escrita a mano cae al día siguiente (turno tarde cruza medianoche) — si
   `timeStr` es igual o anterior a `referenceTime`, suma un día. Verificado
   con el turno tarde real: entrada 16:10 + salida "00:05" dio
   `2026-08-02T05:05:00Z` (día siguiente), correcto.

2. **Salida automática tras 1h sin marcar** — `checkAutoExits()` en
   `server.js`, corre cada 5 min (`startAutoExitChecking`, gateado por
   `!UI_ONLY` igual que los demás pollers — **nunca lo saques de ese gate**:
   un scratch de prueba con los pollers prendidos escribiría salidas
   automáticas y mandaría push sobre datos reales). Revisa jornadas
   `validada` de los últimos 3 días sin `exit_at`; el fin de turno se calcula
   desde `official_at` (la entrada REAL, no la programada — si llegó tarde
   su turno también se corre) más `shiftDurationMinutes(entry_time,
   exit_time)`. Pasada 1h de ese fin de turno, marca `exit_at` = fin de
   turno (no el instante en que el chequeo la detectó) y `exit_source:
   'auto'`, avisa a administrador/ceo por push con el nombre y la hora.
   `shiftDurationMinutes` maneja el cruce de medianoche del turno tarde
   (16:00→00:00 da 480 min, no negativo). La UI muestra "automática" en
   chico bajo la hora, mismo patrón que "reportó HH:MM" en la entrada.

3. **Noticias: cambiar hilo↔aviso después de publicada** —
   `POST /api/news/set-type` (solo `administrador`, el CEO puede publicar
   pero no cambiar el tipo después). El badge de color (rosa=aviso,
   gris=hilo) YA era visible a los 3 roles desde antes de este cambio — lo
   único que faltaba era poder cambiarlo; para `administrador` el badge pasa
   a ser un `<select>` funcional en vez de solo texto. Si un hilo con
   comentarios pasa a aviso, los comentarios existentes se ocultan en la UI
   (mismo `isAviso ? '' : commentsHtml` que ya existía) pero NO se borran de
   la base — solo se bloquean comentarios nuevos
   (`sbFetchNewsPostType` ya validaba esto server-side).

4. **Confirmación de extra/recuperación 6h antes + botón manual en
   Cuentas** — columnas nuevas `cb_shifts.confirmation_sent_at` / `confirmed`
   (migración `shift_confirmation_and_exit_source`, aplicada directo en
   Supabase, no en `schema.sql` — mismo patrón que `kind`/`attendance_status`
   del 2026-09-05). `checkShiftConfirmations()` corre cada 10 min
   (`startShiftConfirmationChecking`, mismo gate `!UI_ONLY`): a una extra/
   recuperación reclamada que empieza en las próximas 6h y no tiene
   `confirmation_sent_at`, le manda push a la MODELO puntual (nueva función
   `sendPushToUser`, primera vez que se pushea a una cuenta específica en vez
   de por rol) preguntando si la va a tomar. `POST /api/shifts/confirm`
   (modelo): `confirm:true` solo guarda `confirmed=true`; `confirm:false`
   llama a `sbUnclaimShift` (que ahora también resetea
   `confirmation_sent_at`/`confirmed` a null — si no, la siguiente modelo que
   reclame ese turno heredaría el estado de confirmación de la anterior) y
   avisa a administrador/ceo que el cupo quedó libre.
   `POST /api/shifts/send-confirmation` (admin/CEO): igual pero a cualquier
   hora, sin esperar las 6h, y SIEMPRE vuelve a preguntar (resetea
   `confirmed` a null aunque ya hubiera una respuesta) — botón "Enviar
   confirmación ahora" en la nueva card "Confirmación de extras y
   recuperaciones" en Cuentas, que lista las próximas reclamadas. En el
   calendario de Extras, la modelo ve botones Sí/No en su propia pastilla
   mientras la confirmación esté pendiente (mismo patrón visual que los
   botones ✓/✗ de asistencia del admin, pero con `data-confirm-id` en vez de
   `data-id` para no pisar el listener del admin — los dos comparten la
   clase `.shift-mark-btn`).

5. **Horas transmitidas en la hoja de asistencia, con color** (pedido a
   mitad de la misma conversación, no estaba en el mensaje original). Nuevas
   funciones puras en `chaturbate-lib.js`: `computeBroadcastSummary(events,
   windowStartMs, windowEndMs)` reconstruye segmentos start/stop de
   `cb_broadcast_events` recortados a la ventana del turno y devuelve
   `onlineMinutes` + `maxGapMinutes` (el hueco de desconexión más grande,
   solo EL QUE QUEDA ENTRE dos segmentos — no cuenta el tiempo antes del
   primer start ni después del último stop, eso ya es tema de retraso de
   entrada/salida, no de "reconexión"); `classifyBroadcastColor(...)` decide
   el color: **rosa** si esa modelo tuvo una extra/recuperación reclamada ese
   `work_date` (gana sobre cualquier otro criterio), **gris apagado** si
   transmitió su turno completo (`onlineMinutes >= shiftDurationMinutes`),
   **rojo** si transmitió menos Y tuvo un hueco de 30+ min
   (`BROADCAST_GAP_ALERT_MINUTES`) — cualquier otro caso (menos horas pero
   sin hueco grande) no lleva color especial. `buildAttendancePayload` en
   `server.js` calcula esto para cada día con `scheduled_at` + horario con
   `exit_time`: un solo fetch de `cb_broadcast_events` para TODA la quincena
   y todas las modelos relevantes (`sbListBroadcastEventsRange`), no uno por
   día por modelo. La ventana de un turno en curso se recorta a `now` (nunca
   se cuenta tiempo "transmitido" en el futuro). Verificado end-to-end con
   eventos reales insertados a mano: turno tarde con 415 min transmitidos de
   480 (menos del turno) y un hueco de 45 min → color `rojo`, exactamente lo
   esperado. Columna nueva "Transmitido" en ambas tablas (`index.html` y
   `asistencia.html` — recordar tocar las dos si esto cambia, ya es la
   tercera vez que el patrón de columnas pareadas aparece en este archivo).

## Corrección del mismo día: edición manual de horas debe ser invisible (2026-09-09, misma tarde)

El usuario corrigió el punto 1 de la sección anterior apenas lo vio en uso:
**"A la hora que yo coloque, se vera como si la Modelo entro o salio a esa
hora. No que yo edite o que ella reporto otra hora."** `/api/attendance/day/edit`
ya NO guarda `official_source: 'manual'` ni `exit_source: 'manual'` — guarda
`official_source: 'reportada'` y **pisa `reported_at` con la misma hora que
el admin puso**, sin importar lo que ella hubiera reportado antes ("no
importa a la hora que se reporte, se borra y queda la nueva entrada").
`exit_source` queda en `null` (nunca `'manual'`). Con esto la fila es
indistinguible de una entrada/salida normal en la tabla Y en el CSV
(`asistencia.html` tiene una columna "Reportó" separada de "Entrada" — si
`reported_at` no se pisara, esa columna delataría la edición aunque la
tabla principal la escondiera). Las ramas de UI que mostraban "editado por
admin" (`exit_source === 'manual'`) se borraron de `index.html` y
`asistencia.html` — ya no se escriben, dejarlas habría sido código muerto
con el riesgo de que alguien las reactive sin saber que están prohibidas.
**También se sacó el push de `notifyAttendanceValidated`** que este endpoint
mandaba: pedido explícito, "no enviar notificaciones cuando rol admin edita
horas y menos de días pasados" — cero avisos desde `day/edit`, sin
excepción. El registro en `cb_audit_log` (interno, nunca visible en la UI)
se mantiene intacto — la trazabilidad interna para el propio admin no es lo
que se pidió esconder, solo lo que ve/podría inferir la modelo.
**Ojo si se toca esto de nuevo:** el flujo de `/api/attendance/validate`
("Llegó ahora" / "Otra hora…", para una llegada que SÍ se reportó y está
pendiente de validar) es una función distinta, con su propia razón de ser
documentada arriba (detectar reportes falsos tipo "Conni reportó a las 4 y
no estaba") — esta corrección NO le aplica a ese flujo, solo a
`day/edit`. No fusionar ambos sin que el usuario lo pida.

## Desprendible del estudio — tarifa distinta a la de las modelos (2026-09-09)

`STUDIO_PAYOUT_RATE_USD_PER_TOKEN = 0.05` (server.js, junto a
`PAYOUT_RATE_USD_PER_TOKEN = 0.023`) — lo que el ESTUDIO recibe por token es
una tarifa totalmente distinta a lo que el estudio le paga a cada modelo.
Pedido explícito del usuario, confirmado con capturas: la card "RESUMEN DEL
ESTUDIO — QUINCENA ACTUAL" (arriba de la lista de modelos, `#summaryCard`,
ya admin+ceo únicamente — `showSummary = role === 'administrador' || role
=== 'ceo'`, sin cambios ahí) tiene un stat "Desprendible del estudio
(estimado)" que **antes** sumaba el `payoutUSD` de cada modelo (o sea, el
total a 0.023) y **ahora** es `tokens totales del estudio × 0.05 × dólar
Paxum` — la misma operación que el desprendible de cada modelo pero con la
tarifa del estudio en vez de la de la modelo. `GET /api/models` manda
`studio_rate_usd_per_token` en la respuesta (no hardcodeado en el frontend,
mismo patrón que `dollar.rate`); `updateSummary(models, dollar, studioRate)`
en `index.html` hace `totalTokens * studioRate` en vez de sumar
`m.payoutUSD`. **El desprendible individual de cada modelo (Modelos y
Desprendibles) NO cambia — sigue en `PAYOUT_RATE_USD_PER_TOKEN` (0.023),
sin tocar.**
**Corregida la misma noche:** se implementó primero en 0.5 (un error de un
orden de magnitud, no un redondeo) — el usuario avisó que el número real es
0.05 y se corrigió de inmediato. Verificado contra el Supabase real las dos
veces: con 0.5 dio 71.819 tokens × 0.5 × $2.922 = $35.909,50 USD; con el
0.05 correcto, 72.687 tokens × 0.05 × dólar Paxum dio $3.634,35 USD ≈
$10.620.797 COP — el número que quedó en producción.
**Por qué esto es sensible:** revela el margen real del estudio por token
frente a lo que recibe la modelo (0.05 vs 0.023, poco más del doble) — por
eso importa que este stat quede SIEMPRE admin+ceo, nunca modelo; no relajar
ese gate sin que el usuario lo pida explícitamente.

## Limpieza de código muerto + Cuentas ahora también para CEO (2026-09-09, noche)

- **"Otros ingresos de Chaturbate" eliminado de la UI** — pedido explícito
  ("fue una función de cuando no sabíamos automatizar Chaturbate, ya no la
  necesitamos"). Se borró la card completa de `index.html`
  (`chaturbateExtraCard`) y sus tres funciones JS (`loadChaturbateExtraPeriods`,
  `loadChaturbateExtraCurrent`, `saveChaturbateExtra`). **Los endpoints
  (`/api/chaturbate-extra/periods|current|save`) y la tabla
  `cb_chaturbate_extra_earnings` se dejaron intactos, dormidos** — mismo
  patrón ya establecido con el paste-and-parse de Stripchat y el upload de
  CSV. Razón para NO borrarlos también: `resolveChaturbateTokens` todavía
  los lee como fallback para reconciliar quincenas **históricas** de antes
  del 2026-09-03 (cuando no todas las modelos tenían `stats_api_token`
  activo) — borrar la tabla podría hacer que un desprendible viejo ya
  pagado se recalcule más bajo de lo que realmente fue. Si algún día se
  confirma que ninguna quincena histórica depende ya de esto, ahí sí se
  puede borrar de raíz.
- **Auditoría del resto de la web, pedida explícitamente** ("verifica toda
  la web de funciones que no necesitemos... aun tengamos ocupando espacio y
  codigo"): se corrió un chequeo sistemático de funciones JS de
  `index.html` sin ningún otro uso y de endpoints de `server.js` sin
  ningún `fetch` que los llame. Encontrado y borrado: `fmtPayout(m)` en
  `index.html` (definida, nunca llamada — quedó huérfana en algún
  refactor). **Confirmado que NO hay funciones huérfanas en `server.js`**
  (las 135 funciones definidas tienen al menos un caller). Los únicos
  endpoints sin caller en el frontend son los tres ya documentados como
  dormidos a propósito (Stripchat paste/parse/save, CSV upload, y ahora
  chaturbate-extra) — ninguno es cruft accidental, los tres son fallback
  deliberado. No se tocó nada de eso. Sin archivos sueltos en `public/`
  ni en la raíz del repo. Si se vuelve a pedir esta auditoría: mismo
  método — `grep -oE "function NOMBRE\("` contando ocurrencias por
  archivo, cuidado con los falsos positivos de IIFEs
  (`(function algo() {...})()` cuenta 1 sola vez en un grep de texto
  plano aunque SÍ se ejecuten — verificar el patrón antes de borrar).
- **Cuentas ahora también la abre `ceo`** (antes solo `administrador`),
  pero con SOLO dos cards — pedido explícito, no relajar sin que el
  usuario lo pida de nuevo:
  - "Confirmación de extras y recuperaciones" (`shiftConfirmCard`) — CEO
    ya podía gestionar el calendario de turnos (`requireAdminOrCeo` en los
    endpoints de `/api/shifts/*`), esto solo la hace visible desde Cuentas
    también.
  - "Contraseñas y sesiones — modelos" (`modelAccountsCard`) — **esto SÍ
    es una ampliación real de permisos de CEO**: antes CEO era "solo
    lectura salvo el calendario de turnos"; ahora también puede resetear
    la contraseña de cualquier modelo y forzar el cierre de sus sesiones.
    `POST /api/models/set-password` pasó de `requireAdmin` a
    `requireAdminOrCeo`. `POST /api/accounts/logout-everywhere` quedó
    dividido: `type: 'model'` → `requireAdminOrCeo`; `type: 'admin'` →
    sigue `requireAdmin` a secas — **CEO nunca puede forzar el logout de
    otra cuenta admin/CEO**, solo de modelos. Verificado con curl real:
    CEO contra `type:'admin'` da 403, contra `type:'model'` da 200.
  - Las demás cards de Cuentas (Cuentas administrativas, Automatizar
    Chaturbate, Mi nombre en Noticias, Registro de actividad) siguen
    ocultas para CEO (`el.adminAccountsCard`/`chaturbateAutoCard`/
    `displayNameCard`/`auditLogCard` con `display:none` cuando el rol no
    es `administrador`) — el gateo es 100% client-side para la UI, pero
    los endpoints de esas cards siguen `requireAdmin` puro, así que CEO no
    podría usarlos ni pegándole directo a la API.
  - "Mejorar la fuente" del apartado de confirmación (pedido explícito):
    la fila de cada turno reclamado pasó de un párrafo corrido en fuente
    plana a la jerarquía ya usada en Asistencia (`.att-row`/
    `.att-row-head`/`.att-row-name` — nombre en mono bold arriba, pill de
    estado al lado, fecha/hora/tipo en `.meta-small` debajo, botón en su
    propia línea). Mismo patrón visual que ya se usa en otras listas de la
    app — no se inventó una clase nueva.
  - Probado end-to-end con Playwright contra el Supabase real (cuentas
    `qa_temp_admin4`/`qa_temp_ceo4`/`qa_temp_model4`, borradas al
    terminar): capturas confirmando que CEO ve exactamente las 2 cards y
    administrador sigue viendo las 6.
  - **Gotcha de esta misma sesión, para no repetirlo:** al probar
    `/api/accounts/logout-everywhere` con `type:'model'` se usó por
    descuido `amaranta_f00x` (modelo real de producción) en vez de una
    cuenta `qa_temp_*` — le forzó un cierre de sesión real (invalida su
    `session_version`, tiene que volver a loguearse, no borra ni cambia
    ningún dato de plata). Sin consecuencia real, pero es exactamente el
    tipo de descuido que la sección "Al probar contra la base real..."
    de este archivo ya advierte — usar SIEMPRE una cuenta `qa_temp_*`
    propia para probar acciones que tocan cuentas reales, nunca una
    modelo real "porque total no pasa nada".

## Panel de retraso/motivación para la modelo en Asistencia (2026-09-09, noche)

Nuevo panel `#attRetrasoPanel` en `index.html`, **solo para rol `modelo`**,
siempre visible cuando tiene horario asignado (no depende de cruzar ningún
umbral, a diferencia del aviso de seguridad social que ya existía). Se
renderiza junto con `renderAttendanceWarning()` cada vez que se refresca
Asistencia (`renderAttendanceRetrasoPanel()`), usando `attData.my_total`:
- `late_minutes > 0` → banner rojo "LLEVAS N DE RETRASO" (mismo estilo
  `.att-warning` ya existente).
- `late_minutes <= 0` (a tiempo o llegó temprano) → banner verde nuevo
  (`.att-warning.att-good`) "VAS AL DÍA" con una frase motivacional elegida
  al azar de `ATT_GOOD_PHRASES` (5 frases, ver el array en `index.html`) —
  cambia en cada refresco, no es siempre la misma línea.
Sin horario asignado (`entry_time == null`) el panel no se muestra —
no tiene sentido felicitar o advertir sobre un retraso que ni se está
calculando. Verificado con capturas reales (Playwright, dos cuentas de
prueba con horario asignado, una con entrada tarde y otra a tiempo, ambas
borradas al terminar): el estado rojo y el verde se ven exactamente como
se diseñaron.
**No confundir con `renderAttendanceWarning()`** (el aviso de seguridad
social) — siguen siendo dos paneles separados con propósitos distintos: uno
es el estado general de cada visita, el otro es la consecuencia real de
cruzar el umbral configurado. Los dos pueden aparecer a la vez si
corresponde.
**Frase motivacional rotando bajo el ícono de cada pestaña — implementado
2026-09-09, misma noche.** El usuario propuso que el ícono decorativo
desapareciera y una frase ocupara su lugar; se le hizo ver el problema real
(el ícono da identidad visual a cada pestaña, y hacerlo desaparecer+la
frase ocupando el mismo hueco corre el layout cada vez que cambia, sobre
todo en móvil) y se ofrecieron 3 alternativas — **el usuario eligió: ícono
SIEMPRE fijo, frase chica debajo con fade in/out, sin sacar nada del
diseño existente.**
- `.banner-phrase` (un `<div>` nuevo, vacío, agregado dentro de CADA uno de
  los 6 `.section-banner` — Modelos/Extras/Desprendibles/Noticias/
  Asistencia/Cuentas — justo después del `<svg class="banner-icon">`).
  `min-height:16px` reserva el renglón siempre, así ni con la frase vacía
  hay salto de layout; `opacity` con `transition .6s` para el fade.
- `BANNER_PHRASES` (7 frases genéricas, `index.html`) — **distinto** del
  array `ATT_GOOD_PHRASES` del panel de retraso: estas son de propósito
  general (no hablan de horario), pensadas para cualquier pestaña.
- `startBannerPhraseRotation()`/`bannerPhraseTick()`/
  `stopBannerPhraseRotation()`: arrancan/paran junto con `pollTimer`
  (login/logout, mismo patrón). El tick corre cada 9s, saca la clase
  `.show` (fade out), y 650ms después pone una frase nueva al azar y
  vuelve a poner `.show` (fade in) — **solo si `currentRole === 'modelo'`**,
  administrador/CEO nunca ven esto. `currentTabName` (variable nueva,
  actualizada dentro de `switchTab`) le dice al tick en qué pestaña
  buscar el `.banner-phrase` a animar — así sigue a la modelo si cambia de
  pestaña sin reiniciar el ciclo.
- Verificado con Playwright: la frase aparece bajo el ícono de Modelos,
  y al cambiar a Extras (el ícono del reloj de arena, sin tocarlo) aparece
  una frase nueva ahí después del siguiente ciclo — confirma que sigue a
  la pestaña activa correctamente.

## Eliminado el margen de tolerancia de 12 min en Asistencia — hora normal (2026-09-10)

Pedido explícito: "Eliminaremos los 12 min internos que tenemos en el
horario, hora normal. 7:30 - 3:30" + "Y el de la tarde igual y acomodame
los horarios de acuerdo a este nuevo tiempo". Los turnos en sí **no
cambiaron** (Mañana 07:30–15:30, Tarde 16:00–00:00 — ya eran esos horarios,
el usuario los citó para confirmar cuál turno). Lo que se pidió eliminar es
el margen de gracia de 12 minutos que perdonaba el inicio de cada turno
(documentado hasta ahora como "⚠ CONFIDENCIAL" más arriba en este archivo)
— y aplica a los DOS turnos por igual, porque el margen era un único
parámetro global (`ATTENDANCE_GRACE_MINUTES`), nunca algo por-turno.

**No se dejó en 0 como parámetro — se borró el mecanismo entero:**
`ATTENDANCE_GRACE_MINUTES` y `applyLateGrace()` ya no existen en
`chaturbate-lib.js` (antes vivían justo después de `ATTENDANCE_SHIFTS`).
`server.js` ya no los importa; los dos call sites que los usaban
(`/api/attendance/validate` y `/api/attendance/day/edit`) ahora guardan
`late_minutes` directamente desde `computeLateMinutes(officialMs,
scheduledMs)`, sin ningún ajuste después. Se eligió borrar en vez de
poner el parámetro en 0 porque dejar viva una función/constante y toda la
sección "CONFIDENCIAL" de este archivo para un margen que ya no existe es
exactamente el tipo de código muerto que este proyecto ya se propuso evitar
(ver "Limpieza de código muerto" del 2026-09-09) — y la propia razón de ser
confidencial (que las modelos no dedujeran el margen) deja de aplicar si el
margen no existe.

**Migración de datos — la parte que hacía falta para que "cuente" de
verdad ahora mismo, no solo hacia adelante.** `late_minutes` en
`cb_attendance_days` es un valor que se CALCULA UNA VEZ al validar y se
GUARDA — no se recalcula en cada lectura. Eso significa que las 18 filas ya
validadas de la quincena en curso (2026-09-08 a 2026-09-10 al momento del
cambio) tenían el retraso viejo horneado adentro con los 12 min ya
restados (ej. un retraso real de 19 min guardado como 7). Se corrigieron
las 18 con una sola consulta SQL directa contra Supabase:
`update cb_attendance_days set late_minutes =
round(extract(epoch from (official_at - scheduled_at))/60)::int where
scheduled_at is not null and official_at is not null;` — usa exactamente
`scheduled_at`/`official_at`, los dos timestamps crudos que la sección de
arriba ya garantizaba que nunca se perdían, así que no fue necesario
reconstruir nada a mano. Verificado fila por fila antes y después
(ej. id 48 abigail_f00x: guardado 7 → recalculado 19; id 39 kitty_f00x:
guardado 6 → recalculado 18 — la diferencia es siempre +12 para los que
tenían retraso real por encima del margen, y sin cambio para los que
llegaron temprano). Esto solo tocó la quincena en curso porque es la única
con filas en la tabla — no hubo que decidir un corte de fecha, no había
historia más vieja que arrastrar.

Probado end-to-end contra el Supabase real (`SOLO_UI=1`, puerto 3013,
cuentas `qa_temp_grace`/`qa_temp_adminG`, turno Mañana asignado, borradas
al terminar): un reporte con 32 min de retraso real validó con
`late_minutes: 32` (antes hubiera dado 20), y una hora cargada a mano por
admin 5 minutos tarde vía `/api/attendance/day/edit` guardó
`late_minutes: 5` (antes hubiera dado 0). `npm test`: 101/101 (se borraron
los tests que verificaban el comportamiento del margen — ya no aplica — y
se agregó uno que confirma que `applyLateGrace`/`ATTENDANCE_GRACE_MINUTES`
ya no existen en el módulo, para que una reintroducción accidental no pase
desapercibida).

## El rosa de "horas transmitidas" se eliminó del todo (2026-09-10, misma tarde)

Apenas arreglado el bug 2 de la sección anterior (el solape por horario en
vez de por fecha), el usuario pidió ir más lejos: **sacar el color rosa por
completo**. Razón, en sus palabras: "Es confuso, la hora de la extra se
hara aqui manual, nosotros solo llevamos el tiempo de jornada" — o sea, la
hora de una extra/recuperación se va a llevar aparte, a mano, y este número
("horas transmitidas") debe limitarse a la jornada normal, sin intentar
mezclar o "perdonar" nada por tener una extra reclamada ese día.

- `classifyBroadcastColor` en `chaturbate-lib.js` ya no acepta `hadExtra` —
  solo mira `onlineMinutes`/`maxGapMinutes`/`shiftDurationMinutes`. Ahora
  únicamente devuelve `'gris'` (cumplió el turno completo), `'rojo'`
  (transmitió menos Y tuvo un hueco real de 30+ min) o `null` (cualquier
  otro caso). El comentario de la función deja constancia de que el rosa
  existió y por qué se sacó, para que no se reintroduzca sin que el
  usuario lo pida de nuevo.
- La función `intervalsOverlap` (recién agregada en el fix anterior,
  la misma tarde) se borró también — ya no tenía ningún uso una vez que
  el concepto de "extra que se solapa" dejó de existir. Con ella se fue
  todo el bloque de `server.js` que armaba `extraWindowsByKey` a partir de
  `sbListShifts()`; el fetch de turnos para esto ya no hace falta (síguelo
  usando en otros endpoints, no se tocó esa función).
- CSS: `.att-bcast-rosa` (`index.html`) y `.bcast-rosa` (`asistencia.html`)
  se borraron — eran las únicas reglas que usaban ese color para esta
  columna, quedaban muertas sin el tercer valor posible.
- Verificado en vivo (`SOLO_UI=1`, puerto 3015, cuenta `qa_temp_norosa`,
  borrada al terminar): el turno de mañana de `tamar4_f00x` del
  2026-09-10 (la misma que disparó el reporte original) da
  `broadcast_color: null` a pesar de tener la recuperación de tarde
  reclamada — ya no hay forma de que una extra pinte nada en esta
  columna, sea cual sea su horario. `npm test`: 104/104 (se sacaron los
  tests de `intervalsOverlap` y del caso `hadExtra: true` → rosa; se
  agregó uno que confirma que un `hadExtra: true` ya NO pisa el criterio
  real — con un hueco de 200 min dentro del objeto de prueba, el
  resultado es `'rojo'` por el criterio real, no `'rosa'`).

## Bug real de dinero: Modelos y Desprendibles mostraban tokens distintos (2026-09-11)

Causa: PostgREST tapa cada respuesta a 1000 filas por defecto, en silencio
(sin error). `buildModelReports()` (pestaña Modelos, `/api/models`) traía
tips y balance-ticks de TODAS las modelos de la quincena en una sola
consulta sin `username` — con 7 modelos eso ya supera 1000 filas, y el
sobrante se perdía en silencio, cada vez peor conforme avanza la quincena.
`/api/payslips` (Desprendibles) consulta por modelo (bajo volumen), por eso
siempre tuvo el número correcto — la pestaña Modelos era la que fallaba,
nunca al revés.

Fix: `sbFetchAllRows(table, qs)` (junto a `SB_HEADERS` en `server.js`) pagina
con el header `Range` (1000 filas por página) hasta traer todo. Aplicado a
`sbFetchTipsInRange`, `sbFetchUserTipsSince`, `sbFetchBalanceTicksInRange`,
`sbFetchUserBalanceTicksSince` y `sbListBroadcastEventsRange` — cualquier
consulta que traiga datos de más de una modelo a la vez sin filtrar por
`username`. Las consultas de una fila por modelo por periodo (Stripchat,
extra earnings, period_base) no se tocaron — nunca se acercan a 1000 filas.

No hizo falta migrar datos (nada se guardaba mal, se calculaba corto al
vuelo). Verificado contra Supabase real: las 7 modelos dan ahora el mismo
número en Modelos y Desprendibles. `npm test`: 104/104.

**Regla para el futuro:** si algún total de una tabla `cb_*` se queda corto
y empeora con el tiempo/volumen (nunca un valor random ni un error visible),
sospechar primero de este límite antes que de la lógica de negocio — ¿la
consulta trae filas de más de una modelo a la vez sin filtrar por
`username`? Si sí, usar `sbFetchAllRows`, no un `fetch` simple. Investigación
completa (números reales verificados paso a paso) en HISTORIAL.md.

## Bug real: "horas transmitidas" mostraba hasta 15h en un turno de 8h (2026-09-15)

Reporte del usuario: modelos con jornadas desfasadas hasta 15h. Causa en
`computeBroadcastSummary` (`chaturbate-lib.js`): un "stop" huérfano (sin
"start" previo) se aceptaba SIEMPRE como "ya transmitía desde el inicio del
turno", sin chequear si ese stop caía dentro de la ventana del día que se
está calculando. Como `events` es el historial COMPLETO de la modela para
toda la quincena (un solo fetch para todos los días), un glitch real y
recurrente — dos "stop" seguidos sin "start" entre medio, visto en varios
días de varias modelos — generaba un segmento fantasma `[inicio de ESTA
ventana, ese stop de OTRO día]` que cubría el turno ENTERO de un día que no
tenía nada que ver, sumándose sin deduplicar sobre el segmento real.
Reproducido y confirmado con los eventos reales de amaranta_f00x: el cálculo
daba 1431 min para un turno de 8h (480 min) — un doble "stop stop" del
2026-09-13 y otro del 2026-09-14 sumaban +480 min fantasma cada uno sobre
los ~471 min reales del 2026-09-10.

**Fix**: el "stop" huérfano solo cuenta si (a) cae dentro de la ventana que
se está calculando Y (b) es el PRIMER huérfano de todo el historial, antes
de haber visto cualquier "start" real — un huérfano que aparece DESPUÉS de
al menos un start ya visto es un duplicado/glitch, no una señal de que
venía transmitiendo desde antes. Regresión con los datos reales de
amaranta_f00x en `chaturbate-lib.test.js`. Verificado contra Supabase real
(`SOLO_UI=1`): las 7 modelos, cero días con `broadcast_minutes` por encima
de su turno tras el fix (antes: amaranta, abigail y tamar4 con varios días
inflados). `npm test`: 106/106. No hizo falta migrar nada — este valor se
calcula al vuelo en cada `GET /api/attendance`, nunca se guarda.

## Salud del sistema manual en Cuentas (2026-09-15)

Pedido explícito: si el usuario se queda sin cuota de Claude, el vigía diario
(que depende de una sesión de Claude activa) no corre ese día. Nueva card
"Salud del sistema" en Cuentas (admin-only) con un botón "Revisar ahora" que
corre las MISMAS 4 señales del vigía (`GET /api/system-health`, admin-only):
eventos sin clasificar, rachas de errores 4xx/5xx o mensajes con forma
distinta a "HTTP <código> para <modelo>", balances sin actualizar 2h+,
sync de Stripchat sin actualizar 24h+. Solo lectura, no manda push ni
correo — el vigía automático (Routine, sigue igual) es el único que avisa
proactivamente; esto es el respaldo manual para cuando ese automático no
corrió. `sbCheck*` en `server.js`, junto a `sbListAuditLog`. Verificado
contra Supabase real (`SOLO_UI=1`): devuelve exactamente los mismos números
que la corrida del vigía del mismo día.

## Marcar falta (no vino) + aviso anticipado de seguridad social (2026-09-15)

Dos features relacionadas, pedidas juntas.

**Marcar falta**: `POST /api/attendance/day/no-show` (admin O ceo —
`requireAdminOrCeo`, a diferencia de `day/edit` que sigue siendo solo
admin) `{username, work_date, note}`. Cuenta como jornada completa de falta:
`late_minutes` = duración de su turno completo (480 min en los dos turnos
actuales), `official_at`/`exit_at` quedan en `null` (invalidados),
`official_source: 'falta'`, `status: 'validada'` (para que fluya sin tocar
nada por `sumLateMinutes`/`owes_social_security`/`debt_cop`, que ya filtran
por ese status). `note` es el motivo — "No se presentó" / "Retardo
injustificado" / uno libre, UI en `asistencia.html` (card nueva "Marcar
falta", visible a admin+ceo, reusa modelo+fecha). Entrada se renderiza
mostrando el motivo en vez de una hora (`index.html` y `asistencia.html`,
buscar `official_source === 'falta'`). Si ya había una fila para ese día,
la sobreescribe (no hace falta borrar antes).

**Aviso anticipado**: cuando a una modelo le falta 1 hora o menos para
CRUZAR el umbral (pero todavía no lo cruza) — distinto del banner reactivo
`owes_social_security` que ya existía. `approaching_social_security`/
`approaching_message` se calculan en vivo en cada `GET /api/attendance`
(en `totals`, ventana `[threshold-60, threshold)`) para que la lista en
pantalla siempre refleje el estado real; ADEMÁS un poller
(`checkApproachingSocialSecurity`, cada 10 min, gateado `!UI_ONLY`) manda
push a administrador+ceo y a la propia modelo (`sendPushToUser`), UNA sola
vez por modelo por quincena (candado `cb_attendance_approaching_notice`,
mismo patrón que `cb_attendance_daily_notice`). Mensaje personalizable por
admin O ceo en cualquier momento (`POST /api/attendance/approaching-alert-message`,
`cb_attendance_settings.approaching_alert_message`, texto libre con
`{modelo}` como placeholder) — vacío restablece el default
(`resolveApproachingAlertMessage` en `chaturbate-lib.js`, con tests). UI:
card "Aviso anticipado de seguridad social" en Asistencia (`index.html`,
admin+ceo) con el textarea + lista en vivo de modelos próximas; banner
propio para la modelo (solo ella, admin/ceo ya lo ven en la lista).

Verificado end-to-end contra Supabase real (`SOLO_UI=1`, cuentas
`qa_temp_noshow_admin`/`_ceo`/`_model`, borradas al terminar): CEO marcó la
falta de la modelo QA (480 min, `owes_social_security: true`, `debt_cop: 0`
por el tope ya existente); bajando `late_minutes` a 320 (umbral 360) dio
`approaching_social_security: true` con el mensaje default resuelto
correctamente; CEO personalizó el mensaje y se reflejó al toque; modelo
recibió 403 en los dos endpoints nuevos (son admin/ceo, no modelo). `npm
test`: 109/109.

## "Automatizar Chaturbate por completo" eliminado de Cuentas (2026-09-15)

Pedido explícito: card redundante — las 7 modelos ya están activadas con
`stats_api_token`, no queda nadie a quien activarle nada. Se borró la card
completa de `index.html` (`chaturbateAutoCard`) y sus tres funciones JS
(`loadCtbStatsStatus`, el listener de `btnSaveCtbStats`). **Los endpoints
(`/api/chaturbate-stats-token/status`, `/api/chaturbate-stats-token/set`)
se dejaron intactos, dormidos** — mismo patrón que Stripchat paste/parse,
CSV upload y "Otros ingresos de Chaturbate". Razón para NO borrarlos
también: si algún día se suma una modelo NUEVA al estudio, hace falta
alguna forma de activarle el token — sin UI, el endpoint sigue siendo
callable directo (curl) mientras no se decida traer la UI de vuelta o
armar una nueva. Si se confirma que el estudio no va a sumar modelos
nunca más, ahí sí se puede borrar de raíz.

## Corrección: el aviso REACTIVO de seguridad social también debe ser personalizable (2026-09-16)

El usuario corrigió el alcance de la feature anterior: no bastaba con poder
personalizar el aviso ANTICIPADO (1h antes) — el texto fijo que ya existía
para cuando una modelo YA CRUZÓ el umbral ("por incumplimiento de horario y
acumulación de horas...") asumía siempre retraso acumulado día a día, pero
eso no es el único caso: con "Marcar falta" (sección de arriba) una modelo
puede cruzar el umbral de una sola vez por faltar un día completo por
decisión propia, no por acumular tarde tras tarde — y el texto tenía que
poder explicar cuál de las dos cosas pasó.

`resolveOwesAlertMessage` (`chaturbate-lib.js`, mismo mecanismo de
`{modelo}` que `resolveApproachingAlertMessage`, factorizado en una función
común `resolveAlertMessage(template, username, fallbackDefault)`) resuelve
el mensaje de `cb_attendance_settings.owes_alert_message`
(`POST /api/attendance/owes-alert-message`, admin O ceo, igual que el
anticipado) con su propio default. `totals[].owes_message` en
`buildAttendancePayload` reemplaza el texto fijo que antes tenía
`renderAttendanceWarning()` en `index.html` — tanto la vista de la modelo
(su propio mensaje) como la de staff (un mensaje resuelto por cada modelo
que deba, ya no una sola frase con la lista de nombres pegada). UI: la
card "Aviso anticipado de seguridad social" pasó a llamarse "Avisos de
seguridad social", con dos textareas independientes (anticipado / al
cruzar el umbral), cada uno con su Guardar y Restablecer predeterminado.

Verificado end-to-end contra Supabase real (`SOLO_UI=1`, cuentas
`qa_temp_owes_admin`/`_model`, borradas al terminar): una falta marcada
cruzó el umbral con el mensaje default; personalizado a mano explicando
"faltó un día completo por decisión propia, no por retraso acumulado" se
reflejó igual en la vista de admin y en la de la propia modelo. `npm
test`: 111/111.

## Aviso anticipado (1h antes) eliminado; mensaje de seguridad social pasa a ser por modelo (2026-09-16)

Pedido explícito: "La opción de mandar mensaje antes de 1h eliminala. Esa
opción solo se soluciona con la notificación y el mensaje debe ser
personalizado a cada modelo." Se interpretó (y confirma con el diseño
final) como dos cambios:

1. **El aviso ANTICIPADO (1h antes de cruzar el umbral) se borró del
   todo** — no se dejó dormido, se eliminó: `checkApproachingSocialSecurity`/
   `startApproachingSocialSecurityChecking`/`sbClaimApproachingNotice`/
   `sbUpdateApproachingAlertMessage` de `server.js`,
   `resolveApproachingAlertMessage`/`DEFAULT_APPROACHING_ALERT_MESSAGE` de
   `chaturbate-lib.js`, el endpoint `POST /api/attendance/approaching-alert-message`,
   la card de configuración, el banner de la modelo y la lista en pantalla
   de `index.html`. Tabla `cb_attendance_approaching_notice` y columna
   `cb_attendance_settings.approaching_alert_message` borradas de Supabase
   (`drop table`/`drop column`, no solo dejadas sin usar) — el pedido fue
   "eliminala", no "escóndela", mismo criterio que
   `ATTENDANCE_GRACE_MINUTES` en 2026-09-10. Sigue existiendo el aviso
   REACTIVO (cuando YA cruza el umbral) — ese es "la notificación" a la
   que se refería el pedido, ya la había push+en pantalla desde antes.

2. **El mensaje del aviso reactivo pasó de una plantilla GLOBAL compartida
   a un mensaje PERSONALIZADO POR MODELO.** Antes había un solo campo
   `cb_attendance_settings.owes_alert_message` que aplicaba igual a las 7 —
   ahora vive en `cb_attendance_schedule.owes_message` (columna nueva, una
   por modelo). `POST /api/attendance/owes-alert-message` ahora recibe
   `{username, message}` en vez de solo `{message}` (sigue admin O ceo);
   sin mensaje asignado a esa modelo, se usa `DEFAULT_OWES_ALERT_MESSAGE`
   (sin cambios). UI: la card pasó de "Avisos de seguridad social" (con
   dos textareas) a **"Mensaje de seguridad social por modelo"**, con un
   selector de modelo (igual patrón que "Horarios y umbral") + un solo
   textarea que se prellena con el mensaje YA guardado de la modelo
   elegida al cambiar el select. `resolveOwesAlertMessage` en
   `chaturbate-lib.js` no cambió de firma — solo cambió DE DÓNDE viene el
   `template` que recibe (antes `settings.owes_alert_message`, ahora
   `scheduleByUser[username].owes_message`).

Verificado end-to-end contra Supabase real (`SOLO_UI=1`, cuentas
`qa_temp_pm_admin`/`_ceo`/`_model`, borradas al terminar): falta marcada →
mensaje default; CEO personalizó el mensaje SOLO para esa modelo → otra
modelo cualquiera siguió con `owes_message: null` (sin contaminarse);
modelo vio su propio mensaje personalizado; modelo rechazada (403) al
intentar el endpoint; `/api/attendance/approaching-alert-message` devuelve
404 (ya no existe). `npm test`: 109/109.

## Salida temprano ya no cuenta como retraso — se marca aparte y exige motivo (2026-09-15)

Pedido explícito: "no se valida como retardo [que] una modelo haya ido a
trabajar y marque una hora diferente a la que sale. Se marca como salida
temprano y el apartado de justificante deberá especificarse por que salió
temprano" (el usuario había dicho "rechazo" primero, corrigió a "retardo"
en el siguiente mensaje).

`POST /api/attendance/exit` (server.js) ahora compara la hora real contra
la hora de salida programada de esa modelo, usando `studioInstantAfter`
(ya existía, mismo que usa `day/edit` para saber si una hora de salida
escrita a mano cruza medianoche) con `entry_time` como referencia — así el
turno de la tarde (16:00–00:00) compara bien contra medianoche del día
siguiente. Si sale antes de esa hora:
- El servidor devuelve 400 con `{early_exit: true}` y **no cierra la
  jornada todavía** si no viene un `reason` en el body — el frontend
  (`attRegisterExit` en `index.html`) atrapa ese flag y pide el motivo con
  un `prompt()` (mismo patrón ya usado para "¿por qué rechazas esta
  llegada?"), reintenta con `{reason}`.
- Con motivo, la jornada cierra con `exit_source: 'temprano'` (nuevo valor,
  junto a `null`/`'auto'` que ya existían) y el motivo se guarda como una
  justificación más, `kind: 'salida_temprano'` (nuevo valor en el mismo
  set de siempre: retraso/internet/conexion/room/salud/otro) — visible en
  la misma lista de justificantes de siempre, nada nuevo que mantener.
- **Esto NUNCA toca `late_minutes` ni la deuda de seguridad social** — esos
  siguen midiéndose solo contra la hora de ENTRADA
  (`computeLateMinutes`/`ATTENDANCE_SHIFTS.entry`), que es justo lo que el
  usuario pidió al decir "no se valida como retardo". Sin horario asignado
  (o sin `exit_time`) no hay nada contra qué comparar, así que se acepta
  igual que siempre, sin marcar nada.

UI: `index.html` y `asistencia.html` muestran "salida temprano" en chico
bajo la hora de salida (mismo lugar donde ya se mostraba "automática" para
`exit_source: 'auto'`), y el nuevo kind se agregó a los dos mapas de
etiquetas (`attKindLabel`/`attKindShort` en `index.html`, `kindShort` en
`asistencia.html` — tres lugares, ya es el patrón conocido de columnas
pareadas de este archivo). No hay columna ni constraint nuevos en Supabase:
`cb_attendance_days.exit_source` y `cb_attendance_justifications.kind` ya
eran texto libre sin `CHECK` (confirmado contra el schema real vía MCP de
Supabase), así que el valor nuevo entra sin migración.

**Nivel de verificación de esta sesión, más bajo que el de sesiones
anteriores — decirlo así de claro:** esta sesión corrió en un contenedor
remoto sin `env.bat` ni las credenciales de producción (`SUPABASE_ANON_KEY`,
`SESSION_SECRET`), así que **no se pudo** levantar una instancia
`SOLO_UI=1` real y probar el endpoint HTTP completo con curl/cuentas
`qa_temp_*`, como sí se hizo en sesiones anteriores documentadas arriba en
este archivo. Lo que sí se verificó: `node -c` sobre los tres archivos
tocados, `npm test` (109/109, sin tests nuevos — la lógica nueva es solo
orquestación sobre funciones puras ya testeadas), un script Node aparte que
llama a `studioInstantAfter` con los horarios reales de los dos turnos y
confirma que la hora de corte cae donde debe (incluido el cruce de
medianoche del turno tarde), y una consulta SQL directa contra el Supabase
real (vía MCP) confirmando que `exit_source` y `cb_attendance_justifications.kind`
no tienen ningún `CHECK constraint` que fuera a rechazar los valores nuevos.
**Lo que falta por probar de verdad, la próxima vez que haya una sesión con
las credenciales completas:** el flujo HTTP end-to-end (marcar salida
temprano sin motivo → recibir el 400 → reintentar con motivo → ver la fila
y el justificante en pantalla) contra una cuenta `qa_temp_*` real, antes de
confiar en esto al 100%.

## "Salud del sistema" ahora también arregla, no solo avisa (2026-09-15)

Pedido explícito: "no quiero ver si tengo errores, quiero tener la forma
manual de arreglarlos en caso tal de no tener cuota de claude." La card ya
mostraba las 4 señales del vigía (solo lectura); de las 4, **solo una tiene
arreglo real posible desde un botón**: balance de Chaturbate sin actualizar
(token de Stats API vencido). Las otras tres no — un evento sin clasificar o
una racha de errores necesitan un cambio de código, y Stripchat sin
sincronizar necesita actualizar una variable de entorno en Render — ninguna
de esas tres tiene un botón inventado, sería falsa sensación de arreglo.

Cuando `staleBalances` trae una modelo, la línea ahora tiene un botón
"Renovar token" que pide (con `prompt()`, mismo patrón ya usado en otros
lados de esta app) el token nuevo de Stats API y llama al endpoint que YA
existía y funcionaba pero estaba huérfano de UI desde que se borró la card
"Automatizar Chaturbate por completo" (`POST
/api/chaturbate-stats-token/set` — valida el token contra Chaturbate de
verdad antes de guardarlo, así que un token inválido nunca se guarda
silenciosamente). `renewStatsToken()` en `index.html`, vuelve a correr el
chequeo solo al terminar para confirmar que la señal desapareció.

## Auditoría de seguridad/código/UX + arreglos empezando por lo más fácil (2026-09-15/16)

El usuario pidió una auditoría completa "como programador externo que nunca
participó" — sin tocar código, solo diagnóstico. Se entregó como Artifact
(informe en español, sin tecnicismos, verificado contra el Supabase real vía
MCP —RLS, políticas, advisors— y con capturas reales de Chromium usando datos
de prueba inventados, nunca datos reales). Encontró 4 críticos, 7 importantes,
7 mejoras, 2 opcionales — texto completo del informe no vive en el repo (es
un Artifact), pero el hallazgo #1 crítico (RLS completamente abierto al rol
`anon` en las 24 tablas `cb_*`, `cmd: ALL, qual: true`) confirma por escrito
lo que esta misma sección del archivo ya documentaba como "tradeoff
aceptado" — no es nuevo, solo la primera vez que se verificó por escrito
contra la configuración real en vez de asumirlo.

El usuario pidió arreglar de más fácil a más difícil, sin pedir permiso en
cada paso. Primer lote (commit de esta fecha):

1. **Texto desactualizado de permisos del CEO en Cuentas** — la descripción
   decía "acceso de solo lectura a todas las modelos", pero desde 2026-09-09
   el CEO ya gestiona turnos y contraseñas/sesiones de modelos. Corregido el
   texto para reflejar los permisos reales.
2. **Mínimo de contraseña subido de 4 a 8 caracteres** — `MIN_PASSWORD_LENGTH`
   (server.js) para las tres rutas que fijan contraseña
   (`/api/admins/create`, `/api/admins/set-password`,
   `/api/models/set-password`), copys del frontend actualizados a juego.
3. **Cambio de contraseña obligatorio para las cuentas que ya existían**
   (pedido explícito del usuario apenas vio el punto 2: "si las contraseñas
   actuales no cumplen los parámetros, haz que se queden así forzadamente
   hasta que se cambien"). Como las contraseñas se guardan hasheadas
   (scrypt, un solo sentido), no hay forma de verificar retroactivamente si
   una contraseña ya existente cumple los 8 caracteres — la única opción
   honesta es marcar a TODAS las cuentas que ya existían y obligarlas a
   cambiarla, aunque algunas ya cumplieran el mínimo por casualidad.
   - Migración aplicada directo en Supabase (`must_change_password_flag`,
     vía `apply_migration`, mismo patrón que otras migraciones incrementales
     de este proyecto): columna `must_change_password boolean not null
     default false` en `cb_admins` y `cb_models`, puesta en `true` para las
     10 cuentas reales que ya existían (3 admin/CEO + 7 modelos). Cualquier
     cuenta NUEVA nace con `false` por el default — nunca hace falta
     tocarlo a mano al crear.
   - `sbFindAdmin`/`sbFindModelAuth` ahora traen esta columna.
     `sbSetAdminPassword`/`sbSetModelPassword` la ponen en `false` en el
     mismo PATCH que cambia la contraseña — así CUALQUIER cambio de
     contraseña (reset de un admin, o el cambio propio de abajo) la limpia
     sola, sin una función aparte.
   - `getSession` ahora devuelve `must_change_password` en el payload de
     sesión, resuelto desde el mismo cache de `session_version` que ya
     existía (`sessionVersionCache`, ahora guarda `{version,
     mustChangePassword, updatedAt}` en vez de solo la versión) — no hubo
     que agregar una consulta nueva a Supabase por request.
   - `requireSession` bloquea con 403 (`{must_change_password: true}`)
     CUALQUIER ruta mientras el flag siga en `true`, salvo la única lista
     blanca: `/api/me/change-password` (nueva, ver abajo). Esto es lo que
     lo hace "forzado" de verdad y no solo un aviso en pantalla — como pasa
     por `requireSession`, alcanza automáticamente a `requireAdmin`/
     `requireAdminOrCeo` también, sin tocarlos.
   - **`POST /api/me/change-password`** (nueva): a diferencia de
     `/api/admins|models/set-password` (un ADMIN reseteando la de OTRA
     cuenta), esta es la propia cuenta cambiando la suya — pide la
     contraseña ACTUAL y la verifica contra el hash antes de aceptar la
     nueva (para que una sesión robada justo después del login no pueda
     cambiarla sin saber la actual). Es la única ruta que sigue funcionando
     con `must_change_password: true`.
   - Frontend: card nueva `forcePasswordCard` (`index.html`), pantalla
     bloqueante que reemplaza tanto el login como la app — se activa desde
     dos lugares: la respuesta de `/api/login` y `/api/me` en `init()`
     (recarga de página). **También cubre el caso de una sesión YA
     abierta** en el momento del despliegue: `refresh()`/`refreshShifts()`
     (los dos sondeos de 4s) revisan si la respuesta es 403 con
     `must_change_password` y llaman a `handleMustChangePassword()`
     (vuelve a pedir `/api/me` para reconstruir la sesión completa, porque
     rol/género no se guardan en ninguna variable global aparte) en vez de
     dejar la pantalla con datos viejos sin explicación. Un enlace "¿Cuenta
     equivocada? Salir" evita que alguien quede atrapado si entró con una
     cuenta que no era.
   - **Verificación de esta sesión, con la misma limitación ya documentada
     arriba (sin `env.bat`/credenciales de producción en este contenedor
     remoto):** migración confirmada por consulta SQL directa (las 10
     cuentas reales con el flag en `true`); `node -c` + `npm test` (109/109,
     sin tests nuevos — es orquestación sobre patrones ya existentes, no
     lógica pura nueva); flujo completo del frontend probado con Chromium +
     respuestas simuladas (nunca contra Supabase real): pantalla bloqueante
     se muestra, valida contraseña corta, valida que las dos nuevas
     coincidan, y al tener éxito pasa a la app normal. **Lo que falta
     probar de verdad** la próxima vez que haya sesión con credenciales
     completas: el round-trip HTTP real contra Supabase (login con una
     cuenta real → pantalla forzada → cambiarla → confirmar que
     `must_change_password` quedó en `false` en la base).
   - **Impacto real e inmediato en cuanto esto llegue a producción:** las
     10 cuentas reales (Elemee, CAMILO, LUZ ADRIANA, y las 7 modelos) van a
     quedar bloqueadas del sistema en su próxima acción hasta que cada una
     cambie su contraseña — esto es exactamente lo que se pidió, pero hay
     que avisarles de antemano para que no piensen que el sistema se
     rompió.

Quedan pendientes, en orden de dificultad creciente según la auditoría: el
resto de arreglos fáciles (dejar de mandarle `studio_rate_usd_per_token` a
las modelos, mensajes de error genéricos, cabeceras de seguridad básicas),
luego los de dificultad media (arreglar el freno de login contra
`X-Forwarded-For` falsificado, reorganizar Asistencia), y al final lo más
difícil: cerrar el RLS abierto de Supabase (el hallazgo más crítico de
todos, pero el que más riesgo de romper el sistema tiene si se hace mal,
porque HOY el servidor entero depende de que el rol `anon` tenga acceso
total — arreglarlo bien requiere migrar a la `service_role` key o escribir
políticas por tabla calcadas a lo que el servidor realmente necesita, no un
cambio de una línea).

## Segundo lote de arreglos fáciles de la auditoría (2026-09-16)

Siguiendo el orden "de lo más fácil a lo más difícil":

- **`studio_rate_usd_per_token` ya no viaja a una sesión `modelo`** en
  `/api/models` — antes se mandaba a los 3 roles y solo se escondía en
  pantalla (ver la auditoría, hallazgo crítico #4). Ahora el propio servidor
  omite el campo por completo cuando `session.role === 'modelo'`.
- **Mensajes de error genéricos hacia el cliente**: los 3 lugares que
  devolvían `e.message` crudo en la respuesta HTTP (`/api/models`,
  `/api/payslips`, `/api/system-health`) ahora devuelven un mensaje fijo;
  el detalle real solo queda en el log del servidor (`console.error`), no
  en lo que ve quien hizo la petición.
- **Cabeceras de seguridad básicas en toda respuesta**: `setSecurityHeaders`
  (server.js, se llama una sola vez al inicio de cada request) agrega
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` y
  `Referrer-Policy: strict-origin-when-cross-origin` siempre, más
  `Strict-Transport-Security` solo cuando `x-forwarded-proto` dice `https`
  (Render lo manda así — nunca forzar HSTS sobre HTTP plano, rompería
  pruebas locales). **No se agregó Content-Security-Policy** a propósito:
  `index.html`/`asistencia.html` dependen de un `<script>` inline enorme, y
  una CSP sin `unsafe-inline` los rompería enteros — eso requeriría mover
  todo ese JS a un archivo `.js` aparte primero, que es un cambio de otro
  tamaño, no de esta tanda.

Verificado: `node -c` + `npm test` (109/109) + una instancia `SOLO_UI=1`
real con `curl -I` confirmando las 3 cabeceras siempre presentes y la
cuarta apareciendo solo con `x-forwarded-proto: https`. No se pudo probar
`studio_rate_usd_per_token` contra una sesión modelo real (misma limitación
de esta sesión: sin credenciales de producción en este contenedor) — se
revisó en cambio que el frontend nunca lee ese campo salvo dentro del
`if (showSummary)` que ya es admin/ceo-only, así que quitarlo para modelo
no le rompe nada a nadie.

## Tercer lote de arreglos fáciles de la auditoría — dos de UX (2026-09-16)

- **Botones de la barra superior ya no son solo-ícono en el celular**
  ("ocultar mi nombre", "cerrar mis sesiones en todos lados", "Salir") —
  mismo patrón que ya se usaba en las 6 pestañas principales (`.tabIcon`):
  ícono arriba, etiqueta chica abajo, nunca el ícono solo. Antes el texto
  se ocultaba del todo en pantallas angostas y solo quedaba el `title` (sin
  hover en el teléfono, invisible). El botón de la campana (`btnEnablePush`)
  se dejó igual a propósito — nunca tuvo texto ni siquiera en escritorio,
  es un ícono de campana reconocible por sí solo, no es el mismo caso que
  el resto.
- **La tarjeta de una sola modelo ya no queda estirada a todo el ancho de
  la pantalla en escritorio.** Causa real: `.models` usaba
  `grid-template-columns: repeat(auto-fill, ...)` — con `auto-fill` (a
  diferencia de `auto-fit`) el grid reserva columnas vacías invisibles
  hasta llenar el ancho disponible, así que una sola tarjeta quedaba
  angosta con dos columnas fantasma ocupando el resto de la fila. Cambiado
  a `auto-fit` (colapsa esas columnas vacías) + `max-width: 460px` en
  `.model` (para que, ya sin columnas fantasma, la tarjeta no se estire
  ella misma a los 1200px+ de una pantalla ancha con las estadísticas de
  adentro perdidas en el espacio). Verificado que la vista con varias
  modelos (admin/CEO) queda idéntica a antes — el tope de 460px nunca se
  activa ahí porque el grid ya las deja más angostas que eso.

Verificado con Chromium + capturas reales (datos de prueba, nunca datos
reales) en las dos resoluciones: la vista de una sola modelo ya no tiene el
hueco vacío, y la vista de 6 modelos no cambió ni un píxel. `npm test`:
109/109.

## Cuarto arreglo fácil de la auditoría: índices faltantes en Supabase (2026-09-16)

Migración pura de base de datos (`add_missing_foreign_key_indexes`, vía
`apply_migration`), sin ningún cambio de código: se agregaron los 5 índices
que el propio advisor de rendimiento de Supabase señalaba como faltantes
(`cb_balance_resets.username`, `cb_balance_ticks.username`,
`cb_news_comments.post_id`, `cb_shifts.claimed_by`,
`cb_unhandled_events.username`). Sin riesgo — solo aceleran consultas
futuras, no cambian ningún dato ni comportamiento. Confirmado con el
advisor que la alerta de "llaves foráneas sin índice" ya no aparece (queda
un aviso informativo de "índice sin uso todavía", esperable recién
creados y sin tráfico real — se resuelve solo con el uso normal).

## Copias de seguridad de Supabase — sin resolver, decisión pendiente del usuario (2026-09-16)

Confirmado con `get_organization` (MCP de Supabase): el proyecto real
(`STUDIO`, org `aloxugskfwhhpnplondm`) está en el **plan gratuito** — sin
copias de seguridad automáticas. Se le preguntó directo al usuario (subir a
Pro ~US$25/mes con backups diarios, dejarlo así por ahora, o pensarlo) y
eligió **pensarlo, seguir con el resto de la auditoría mientras tanto**.
Queda como riesgo conocido y explícitamente aplazado, no resuelto — no
asumir que ya se activó nada. Si se retoma, es una decisión de plata
recurrente que solo el usuario aprueba, no algo para activar solo.

## Arreglo de dificultad media: freno de login esquivable + bug real de estabilidad encontrado de paso (2026-09-16)

**El freno de intentos de login (`getClientIp`) ya no se puede esquivar
falsificando `X-Forwarded-For`.** Antes tomaba el PRIMER valor de esa
cabecera (`fwd.split(',')[0]`) — pero ese primer valor lo puede escribir
quien hace la petición, no el proxy de Render. Ahora toma el ÚLTIMO valor
de la cadena, que es el que agrega el proxy de Render mismo (el único salto
en el que se confía) — un atacante puede inventar cualquier valor al
principio, pero no puede tocar lo que Render agrega al final. Si Render
algún día reemplaza el header entero en vez de agregarle algo (cadena de
un solo valor), esto se comporta exactamente igual que antes.

**Verificado de verdad, no solo leído**: instancia `SOLO_UI=1` +  un
servidor HTTP falso en el puerto 3096 haciendo de Supabase (devuelve `[]` a
cualquier consulta, así el login llega hasta el freno de intentos sin
necesitar credenciales reales). Con la IP real fija pero el primer salto de
`X-Forwarded-For` cambiando en cada intento (simulando al atacante), el
intento 7 ya da 429 — el freno agarra los 6 intentos como si vinieran todos
de la misma IP, que es lo correcto. Una IP real distinta en paralelo no
queda bloqueada por los intentos de la otra (control aparte).

**Bug real de estabilidad encontrado de paso, no buscado — y arreglado
también**: mientras se armaba la prueba de arriba, con el Supabase de
mentira apagado (URL que no resuelve), un login tiró **todo el proceso de
Node abajo**, no solo esa petición — `sbFindAdmin` hace un `fetch` a
Supabase sin try/catch en `/api/login`, y como el handler de cada request
nunca tenía nada que atajara una excepción escapada, Node mata el proceso
entero ante una promesa rechazada sin manejar (comportamiento por defecto
desde Node 15). En producción esto significa: si Supabase queda
inalcanzable un instante (DNS, red, un incidente de su lado) justo cuando
alguien intenta iniciar sesión, se cae el servidor COMPLETO — todas las
modelos pierden su conexión en vivo de golpe, no solo esa petición.

Arreglado sin reindentar las 1300+ líneas del manejador de rutas: el
cuerpo entero (antes `http.createServer(async (req, res) => {...})`) pasó
a ser una función nombrada `async function handleRequest(req, res) {...}`
sin tocar una sola línea de adentro, y `http.createServer` ahora es un
wrapper chiquito que la llama y atrapa cualquier error con `.catch(...)`,
devolviendo un 500 limpio en vez de tirar el proceso. Reproducido el
arreglo contra el mismo escenario que lo causó (Supabase inalcanzable): 8
intentos de login dieron 500 limpio cada uno, y una petición normal
después confirmó que el servidor seguía vivo y respondiendo.

`node -c` + `npm test` (109/109, sin tests nuevos — ninguno de los dos
arreglos es lógica pura, chaturbate-lib.js no cambió). No se probó contra
el Supabase real de producción (misma limitación de esta sesión, sin
credenciales en este contenedor remoto) — se probó contra un servidor HTTP
de mentira que imita las respuestas de Supabase, suficiente para ejercitar
la lógica real de las dos rutas afectadas.

## How this user likes to work

Non-technical, moves fast, dislikes long back-and-forth or being asked
to test things himself. Test every change yourself end-to-end (spin up
a scratch instance on a different port, hit it with curl and/or the
browser tool, against the real Supabase project) before saying
something works or asking him to check. Keep any engineering
justification ("we did X because Chaturbate's API doesn't support Y")
out of the product's own UI copy — that reasoning belongs in chat only.
