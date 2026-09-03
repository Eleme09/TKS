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
project to a new studio — see that skill). Query it from any terminal with
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

## Push notification bug on iPhone — resolved (2026-09-02)

Turned out to be two things, both fixed:
1. The user was actually on **Safari** on iPhone, not Chrome as they
   believed (confirmed from a screenshot of the alert — Safari's iOS
   chrome, sparkle/AI icon in the address bar, that toolbar layout).
   This isn't really a bug: **Apple only exposes the Push API on iOS
   when the page is installed to the home screen** — a plain Safari (or
   any iOS browser, all of which are WebKit under the hood) tab never
   has `PushManager`, by platform design.
2. The real bug: `el.btnEnablePush`'s click handler checked the
   generic `pushUnsupportedReason()` *before* the iOS-specific
   `isIos() && !isStandalone()` check, so iOS users got the unhelpful
   generic "not supported" message instead of the actionable "add to
   home screen first" instructions. Fixed by reordering — iOS-specific
   check now runs first.

Takeaway for next time a user reports a browser-capability message
that seems wrong: ask for a screenshot before assuming the code is
buggy — "I'm using Chrome" is not reliable self-report on iOS, where
every browser is forced to use WebKit and users often don't distinguish.

## Desprendibles payslip history — redesigned (2026-09-02)

The per-quincena history rows in `refreshPayslips()` used to be one
dense line of text (period + status + tokens + CB/SC breakdown + USD +
COP all concatenated with " · "), hard to parse especially on mobile.
Rewritten to reuse the same `.model`/`.model-head`/`.model-grid`/
`.stat`/`.stat.hero` classes the Modelos tab cards already use —
labeled Tokens/Desprendible blocks instead of a run-on sentence, same
platform-icon treatment as the model cards. If you touch model card
markup again, consider whether payslip rows need the matching change
too (and vice versa) — they're now visually paired by design.

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
since Noticias is meant to reach models).

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

## Chaturbate income beyond public tips — resolved (2026-09-03)

**The problem, found by the user comparing real numbers:** the Events API
only ever fires `tip` for public in-room tips. Chaturbate also pays for
private shows, spy shows, fan club joins, and content purchases — none of
that comes through as any Events API event (confirmed empirically: a
catch-all logger for every non-tip/broadcastStart/broadcastStop event —
see `cb_unhandled_events` below — has run for hours across all 6 models
and only ever seen `userEnter`/`userLeave`/`follow`, never anything
token-bearing). For pinky_f00x this was a **63% undercount**: 71 tokens
counted vs 192+ real for the same days. One already-paid quincena
(pinky, ago 16-31) was short **11,898 tokens** that got recovered before
being noticed by anyone but this fix.

**What was ruled out, and why (don't re-litigate these without new
evidence):**
- **Scripted/automated login** (Playwright/Puppeteer logging into
  chaturbate.com to scrape the Earnings/Token Stats page) — this is a
  distinct, *harder* stance than the Stripchat login rule below: it's not
  just "don't do this," it's independently verified technically blocked.
  A plain unauthenticated `curl`/`fetch` to
  `https://es.chaturbate.com/tipping/csv/history/` (the CSV-history
  endpoint) gets redirected to `/auth/login/` and **that login redirect
  itself returns a Cloudflare "Just a moment…" bot challenge** on the
  very first request — confirmed live, not theoretical. Any scripted
  login attempt hits this before even trying credentials. Don't waste
  time re-investigating this path; the block is Chaturbate's, not a
  missing header or user-agent tweak.
- **`tips_in_last_hour` field on the Stats API** (see below) — confirmed
  via Chaturbate's *own* published docs
  (`chaturbate.com/statsapi/authtoken/`, screenshotted by the user) that
  this is scoped to tips only, same category the Events API already
  gives us live and more precisely. Not useful for the privates/spy gap.
- **"Affiliate statistics" API** (same docs page, different endpoint,
  `/affiliates/apistats/`) — referral/affiliate program stats (who a
  model refers to Chaturbate), unrelated to her own room earnings.
- **CB Cam Insights** (third-party tool built specifically for this
  niche, has a Chrome extension + studio accounts) — investigated in
  depth; it only reads the live tip feed visible during a broadcast,
  same scope as our Events API. Not a lead.

**What actually works — the real fix, in order of how it was found:**

1. **`cb_unhandled_events`** (username, method, payload jsonb,
   created_at): the `pollLoop` event switch now has a catch-all `else`
   that logs any event method it doesn't already handle, instead of
   discarding it. Fire-and-forget (no `await`, no retries — this is
   diagnostic, not money, so it must never block real tip/broadcast
   processing; using `sbWriteCritical` here was an early mistake, fixed
   2026-09-03 in the code-review pass). Check periodically
   (`select method, count(*) from cb_unhandled_events group by method`)
   in case Chaturbate ever starts sending a token-bearing event type
   (`fanclubJoin`, `mediaPurchase` are documented Chaturbate methods
   that would show up here) — if one ever appears, that category can be
   wired into automatic tracking with zero login risk.

2. **CSV historical backfill** (`cb_chaturbate_period_base` table:
   username, period_start, period_end, base_tokens, covers_until,
   source, entered_by). Chaturbate lets a broadcaster download her own
   *full transaction ledger* from her own logged-in session
   ("Estadísticas de las fichas" → "Descargar el historial de
   transacciones") — a real button in a real browser, not scraping.
   That CSV has every category broken out by name (`Tip received`,
   `Private show`, `Spy on private show`, `Photos/videos sold`,
   `Fan club membership`, `Tokens cashed out` as the one withdrawal/
   negative type). Summing every **positive** `Token change` row in a
   date range reproduces Chaturbate's own "Ganancias del período"
   number exactly — verified token-for-token against the real UI
   (289 and 11,906 for two different periods, both exact). Used once to
   backfill all 6 models' current + prior quincena so nothing already
   paid stays wrong.
   - **Retention gotcha, verified with real data:** the export only
     covers roughly the last ~30 days of line-item detail, even though
     the aggregate "Ganancias del período" table remembers further back.
     A quincena starting before the file's oldest row is **silently
     incomplete** in the file (caught one case: file said 4549, real
     total was 6829, missing the first few days) — worse to save a
     partial number than to leave it alone, since it would look
     "already fixed" while still being wrong. `oldestDateStr` is checked
     per period before saving; an uncovered period is skipped and
     reported as `saved: false`, never written half-right.
   - `covers_until` is stamped as the **upload moment**, not the CSV's
     last row timestamp — deliberately conservative, so nothing after
     that instant can possibly double-count against the file (the file
     physically can't contain data from after it was generated). Costs
     a small, accepted gap between "file's last real row" and "admin got
     around to uploading it," same "better short than wrong" tradeoff
     as everywhere else in this feature.
   - **UI for this was removed 2026-09-03**, same day it was added, once
     live tracking (below) covered all 6 models and made ongoing manual
     uploads pointless. The endpoint (`/api/chaturbate-csv/upload`)
     is untouched and still callable directly (curl / one-off script) as
     a dormant fallback for a future backfill — same "removed from UI,
     backend stays dormant" pattern already established for Stripchat's
     paste-and-parse form. Don't re-add UI for it without checking if
     it's still needed; if you do, know that `/api/chaturbate-csv/upload`
     accepts a `modelo` session too, forcing her own username server-side
     regardless of what `username` is in the request body.

3. **Live automatic tracking — the actual long-term fix**
   (`cb_models.stats_api_token` / `last_balance` / `last_balance_at`,
   `cb_balance_ticks`, `cb_balance_resets`). Chaturbate has a second
   official, token-authenticated (not login) API:
   `https://chaturbate.com/statsapi/?username=X&token=Y`, token
   generated once per broadcaster at
   `chaturbate.com/statsapi/authtoken/` while logged into *her own*
   account (same trust model as the Events API token already in use —
   documented at that same URL, screenshotted by the user). Its
   `token_balance` field is literally the wallet-balance number shown at
   the top of the Chaturbate UI, and it goes up for **every** revenue
   category (tip, private, spy, fan club, content) — because it's just
   her balance, not a tips-only metric like `tips_in_last_hour`.
   Chaturbate runs an **automatic daily cashout per broadcaster that
   drains the balance to exactly $0** (verified: every "Tokens cashed
   out" row in the real CSV data goes to a balance of precisely 0, no
   exceptions). Summing each day's pre-cashout balance reproduces the
   official "Ganancias del período" total exactly, same verification as
   the CSV method above.
   - `pollChaturbateBalances()` (started via
     `startChaturbateBalancePolling()` at server boot) polls every model
     with a `stats_api_token` set, compares the new balance to
     `last_balance`: an **increase** is real new earnings → inserted as
     a row in `cb_balance_ticks` (this is the thing summed for payroll,
     same role `cb_tips` plays for the old tip-only tracking); a
     **decrease** is the daily cashout, not a loss → logged to
     `cb_balance_resets` for audit/verification, never subtracted from
     anything earned. First-ever poll for a newly-activated model just
     seeds `last_balance` with no tick (no way to know how much of a
     pre-existing balance was already counted elsewhere).
   - **Dense polling before the daily cashout**: `isNearChaturbateCashout`
     triggers ~20s polling in the 12 minutes before the reset instead of
     the normal ~2min cadence, to catch the highest possible balance
     right before it's zeroed. **The cashout hour is 04:30 UTC, not
     21:30 or 23:30** — worked out from real data: the CSV logs the
     cashout at `21:30` (Chaturbate's own US-Pacific server clock) and
     the web UI shows the *same instant* to the Colombian user as
     `11:30 p.m.` (UTC-5) — both point to `04:30 UTC`. If this ever
     looks wrong, `cb_balance_resets.detected_at` has the real
     observed timestamps to re-derive it from, don't just guess a new
     hour.
   - `pollChaturbateBalances` has a `balancePollRunning` reentrancy
     guard (added in the 2026-09-03 code-review pass) — without it, a
     slow poll cycle during the dense 20s window could overlap the next
     one and double-insert the same tick.
   - Activated per model via `POST /api/chaturbate-stats-token/set`
     (admin-only; UI: Cuentas → "Automatizar Chaturbate por completo"),
     which live-validates the token against the real API before saving
     and seeds `last_balance` immediately so activation itself never
     creates a false tick. All 6 models were activated 2026-09-03.

**How the three sources reconcile — `resolveChaturbateTokens`**
(the single function all Chaturbate-total logic goes through, in both
`buildModelReports` and `/api/payslips`): with a `cb_chaturbate_period_base`
row for that period, the total is `base_tokens + max(balance-ticks after
covers_until, tips after covers_until)` — **the max, not ticks alone**.
Real bug caught in the 2026-09-03 review: taking ticks alone silently
freezes a model's total at the CSV base forever if she never got a
`stats_api_token` activated (the live Events API tip listener runs for
*every* model regardless of whether her balance is being polled, so her
`cb_tips` keeps growing while `cb_balance_ticks` stays empty — max()
against tips is what keeps her total moving instead of stuck). Without a
base row, it's `max(ticks total, tips + manual correction)` — same
"never regress below what's already known" principle, so activating
balance-tracking mid-quincena can only raise a model's shown total, never
drop it out from under an already-correct number.

**Known accepted limitation, not fixed:** the CSV's date bucketing
(`parseChaturbateTransactionsCsv` / `sumChaturbateCsvEarningsForPeriod`)
takes the first 10 characters of the CSV's Timestamp column as the day,
with no timezone conversion from Chaturbate's Pacific-time clock to
whatever timezone quincena boundaries are computed in. This can shift a
handful of tokens right at midnight between two adjacent quincenas.
Verified against real data that the effect is negligible (both tested
periods matched Chaturbate's own totals exactly); a robust fix needs
real DST-aware timezone math, which risks introducing a new bug for a
problem this small. Leave it unless it's actually observed to matter.

**Manual fallback still exists, now explicitly secondary:** the "Otros
ingresos de Chaturbate" card in Cuentas (admin enters one number — the
account's *real total* from her own Token Stats page, no category
breakdown needed) still works, backed by `cb_chaturbate_extra_earnings`.
It only matters for a model with no `stats_api_token` and no
`cb_chaturbate_period_base` row for that period; once either of the
other two mechanisms has data for a period, this one is ignored by
`resolveChaturbateTokens`'s max()/base logic.

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

El usuario preguntó cómo hacer que la base "se auto-sostenga" dado que él
va a seguir siendo el único que puede entregar credenciales nuevas
(login sigue siendo suyo, ver la sección de arriba sobre por qué no se
automatiza). Respuesta: un chequeo diario programado (Routine, vía
`mcp__Claude_Code_Remote__create_trigger`/`update_trigger`, corre a las
12:00 UTC contra esta sesión) que revisa señales reales en la base y
solo avisa si encuentra algo — silencioso el resto de los días. Cubre:

1. `cb_unhandled_events` — método nuevo que no sea userEnter/userLeave/
   follow (ver sección de arriba).
2. **`cb_api_errors`** (tabla nueva: source, message, created_at) — cada
   fallo de `fetchChaturbateBalance` o `fetchStripchatModelEarnings`
   (HTTP no-ok, excepción, o **la forma de la respuesta cambió** — ej.
   si Chaturbate renombra `token_balance` o Stripchat `totalEarnings`,
   esto lo agarra igual que un HTTP 500) queda logueado ahí además de
   por `console.error`. Sin esto, un cambio de API silencioso solo se
   veía en los logs de Render, que esta sesión no puede leer — con esto,
   una consulta SQL alcanza. Sin reintentos, fire-and-forget: es
   diagnóstico, no dinero.
3. Balance de una modelo con `stats_api_token` activo que no se
   actualiza hace más de 2h — probable token revocado, necesita que
   ella regenere uno nuevo en `chaturbate.com/statsapi/authtoken/`.
4. Sync de Stripchat sin actualizarse en 24h — probable API key vencida
   o cambio de API.

**El límite real, sin vuelta que darle:** cualquier diagnóstico que
requiera loguearse a algo (probar si un token nuevo funciona, ver una
pantalla de Chaturbate/Stripchat) sigue necesitando que el usuario
genere la credencial y la pase acá — el vigía puede *detectar* que algo
se rompió y decir *qué* modelo/plataforma, pero nunca puede *resolverlo*
solo si la causa es una credencial vencida. Eso es intencional, no una
limitación a mejorar (ver la sección de arriba sobre por qué no se
scriptea login).

**Dónde llegan los avisos (added 2026-09-03, misma tarde):** un aviso que
solo se escribe en el chat de la sesión solo lo ve el usuario si abre
justo esa sesión puntual (`session_01QshGfHzbioszhKaEjmkEor`) desde
algún dispositivo — el usuario trabaja desde varias terminales y pidió
explícitamente que esto no dependa de eso. Ambos triggers (el vigía
diario y el de verificación de la hora de cashout) ahora, cuando
encuentran algo real, además de avisar en el chat mandan un correo por
Gmail a `menajeiner@gmail.com` con formato fijo: DÓNDE (archivo/función/
tabla exacta), QUÉ PASÓ (explicado para que un programador o una futura
sesión de Claude sin memoria de esta lo resuelva sin investigar desde
cero) y CÓMO SE VE EN LA WEB (el síntoma que notaría el usuario o una
modelo, o decir explícitamente que todavía no hay ninguno visible — no
inventar uno). Si Gmail no está disponible en esa corrida, el trigger
avisa eso en el chat en vez de fallar en silencio, y no reintenta el
envío por su cuenta.

Trigger actual: `trig_01BXcfPNvAetGc9gcNcJUa7m` ("Vigía diario del
sistema") y `trig_01Wn2Q8ZTrL6dpzJ6bx4PPuf` ("Verificar hora real del
retiro diario de Chaturbate", one-shot, fires 2026-09-04T04:40Z). Si
hace falta agregar una quinta señal al chequeo diario o cambiar el
formato del correo, `update_trigger` con el prompt completo (reemplaza
el anterior entero, no es un parche) — no crear un trigger nuevo para
cada señal nueva, un solo chequeo diario que las cubra todas es más
fácil de mantener que varios sueltos.

## How this user likes to work

Non-technical, moves fast, dislikes long back-and-forth or being asked
to test things himself. Test every change yourself end-to-end (spin up
a scratch instance on a different port, hit it with curl and/or the
browser tool, against the real Supabase project) before saying
something works or asking him to check. Keep any engineering
justification ("we did X because Chaturbate's API doesn't support Y")
out of the product's own UI copy — that reasoning belongs in chat only.
