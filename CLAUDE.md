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

## Chaturbate income beyond public tips — resolved (2026-09-03)

**The problem, found by the user comparing real numbers:** the Events API
only ever fires `tip` for public in-room tips. Chaturbate también paga por
private shows, spy shows, fan club joins y compras de contenido, y casi nada
de eso llega como evento de la Events API.

**Corrección importante (2026-09-04, encontrada por el vigía diario):** la
versión anterior de esta sección decía que NADA de eso llegaba nunca como
evento, "solo userEnter/userLeave/follow". **Eso ya no es cierto.**
`cb_unhandled_events` registró **`mediaPurchase`** con tokens adentro, en
`object.media.tokens` — tres compras de contenido de abigail_f00x el
2026-09-03 (125, 130 y 66 tokens, mismo comprador). O sea que las compras de
contenido SÍ llegan por la Events API, con el monto exacto. Con el tiempo
también aparecieron `privateMessage`, `chatMessage`, `roomSubjectChange` y
`unfollow`, que no traen tokens. Los privados y spy shows siguen sin aparecer.
**Esa plata NO se perdió:** abigail tiene `stats_api_token` activo y los ticks
de balance de esa franja (76 a las 18:48, 501 a las 18:54, 395 a las 19:00)
cubren los 321 tokens de sobra, porque el balance sube por toda categoría.
Verificado fila por fila, no asumido.

**Lo que esto habilita, y por qué NO se implementó al vuelo:** para una modelo
SIN `stats_api_token`, hoy solo se cuentan sus propinas públicas — sumarle
`mediaPurchase` mejoraría su número real. Para una modelo CON token no cambia
nada, porque `resolveChaturbateTokens` ya toma `max(ticks, tips)` y los ticks
lo incluyen. Hoy las 6 tienen token, así que es resiliencia, no un agujero
abierto. Si se implementa: va a `cb_tips` (o tabla equivalente que entre por
el lado `tips` del max), NUNCA sumado aparte, o se duplica la plata de las
que sí tienen balance activo.

For pinky_f00x this was a **63% undercount**: 71 tokens
counted vs 192+ real for the same days, and the tracker's own number for
her ago 16-31 quincena was **11,898 tokens** short of her real Chaturbate
total before this fix.

**Correction (2026-09-03, later the same day):** an earlier version of
this file described that 11,898-token gap as money the model had
already been underpaid and only recovered thanks to this fix. The user
corrected that: it's wrong. Pinky was paid correctly for that quincena
regardless — the gap was only in this system's own dashboard/number, a
consequence of being poorly set up against Chaturbate's API (public-tips
-only), not an actual shortfall in what she received. Don't cite this
episode as "a model was underpaid and we caught it" — the accurate
claim is narrower: the tracker's own total was wrong by that much before
the fix, which is still the real reason the balance-polling fix
(`resolveChaturbateTokens`, live tracking) matters — a wrong dashboard
number is a real problem on its own even when it didn't end up causing
an actual underpayment this time.

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
   **Ya apareció uno: `mediaPurchase`, el 2026-09-03, con el monto en
   `object.media.tokens`** — ver la corrección al principio de esta
   sección. `fanclubJoin` todavía no. Este chequeo sirve, no lo quites.

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
     sube el sondeo a **cada 60s** (no 20s, ver abajo) en la ventana
     **04:18–04:30 UTC** (`CHATURBATE_CASHOUT_UTC_HOUR/MINUTE` = 4:30,
     `CASHOUT_WINDOW_MINUTES` = 12, en `chaturbate-lib.js`), para leer el
     balance más alto posible antes de que se vacíe. La hora sale del CSV
     real: los retiros figuran ~21:30 (reloj US-Pacific de Chaturbate) y
     la web se lo muestra al usuario colombiano como 11:30 p.m. (UTC-5) —
     el mismo instante, 04:30 UTC.
   - **Incidente y falsa alarma del 2026-09-04 — leer antes de tocar esto
     otra vez.** La primera noche que corrió el sondeo denso (cada 20s ×
     6 modelos = 18 consultas/min) **Chaturbate nos devolvió HTTP 403 a
     todo, de 04:23:00 a 04:40:40** — 174 errores en `cb_api_errors`,
     todas las modelos, todas las consultas. Dos consecuencias:
     1. **El bloqueo cayó justo encima del corte diario**, que es
        exactamente el momento que la ventana densa existe para no
        perderse. Última lectura buena antes: 04:21:40. Siguiente:
        04:40:40. 19 minutos ciegos.
     2. **Se sacó una conclusión falsa de eso.** Como los tres retiros
        (jax_f00x 1314→24, abigail_f00x 1925→0, pinky_f00x 420→2)
        quedaron con `detected_at` = 04:40:40, pareció que el corte real
        era ~10 min más tarde de lo asumido, y se movió la ventana a
        04:15–04:45. **Estaba mal**: las 04:40:40 son solo el momento en
        que la API volvió a responder, no el del corte. El vaciado ocurrió
        en algún punto de la ventana ciega, que incluye las 04:30. Ya se
        revirtió. **Regla: un `detected_at` de `cb_balance_resets` solo
        significa algo si hubo lecturas exitosas continuas antes — cruzar
        SIEMPRE contra `cb_api_errors` en esa franja antes de concluir
        nada sobre la hora.**
     Arreglos que quedaron: sondeo denso a 60s en vez de 20s
     (`BALANCE_DENSE_EVERY_TICKS`) — y no se pierde nada, porque **la
     propia Stats API se refresca sola una vez cada 5 minutos** según la
     documentación de Chaturbate, así que las consultas cada 20s no daban
     ni un dato extra, solo bloqueo; y un cooldown de 5 min ante un
     403/429 (`BALANCE_RATE_LIMIT_COOLDOWN_MS` +
     `chaturbateRateLimitedUntil`) para dejar de insistir en vano — ese
     día se siguió golpeando la API 17 minutos seguidos, lo que
     probablemente estiró el bloqueo. **No vuelvas a subir la frecuencia
     del sondeo "para no perderse el pico": eso es justamente lo que
     provocó perdérselo.**
     Ojo también: los `to_balance` de ese retiro fueron 24, 0 y 2 — no
     todos exactamente 0 como dice la nota del CSV más arriba; son
     propinas que entraron entre el vaciado y el momento en que el sondeo
     lo detectó.
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
sistema"). El one-shot `trig_01Wn2Q8ZTrL6dpzJ6bx4PPuf` ("Verificar hora
real del retiro diario de Chaturbate") **ya se disparó el 2026-09-04 a
las 04:40Z y se auto-deshabilitó** — no existe más como pendiente; lo
que encontró (y la conclusión equivocada que sacó) está en la sección
del incidente del 2026-09-04, más arriba. Si hace falta agregar una
quinta señal al chequeo diario o cambiar el formato del correo,
`update_trigger` con el prompt completo (reemplaza el anterior entero,
no es un parche) — no crear un trigger nuevo para cada señal nueva, un
solo chequeo diario que las cubra todas es más fácil de mantener que
varios sueltos.

**Señal nueva que conviene que cubra el vigía diario (a partir del
incidente del 2026-09-04):** un pico de `cb_api_errors` con HTTP 403/429
en `chaturbate_stats` — no es "una API que cambió", es Chaturbate
limitándonos por consultar de más, y el síntoma es una ventana ciega en
el balance justo cuando más importa.

**Segundo patrón distinto, mismo día, tarde (2026-09-04, ~18:00-22:00
UTC):** un HTTP 403 aislado en `chaturbate_stats`, **uno por hora, cada
~62 minutos, siempre en el minuto ~42-50**, rotando de modelo (pinky_f00x
tres veces seguidas, luego kitty_f00x) — no es el mismo bloqueo masivo del
incidente de la madrugada (ese fue 17 min seguidos a las 6 modelos a la
vez). Verificado con SQL real (`select date_trunc('hour', created_at),
message, count(*) from cb_api_errors where source='chaturbate_stats' and
created_at > '2026-09-04 04:41:00+00' group by 1,2 order by 1`): exactamente
un error por hora, ninguna hora con más de uno, ninguna hora sin ninguno.
Esa regularidad tan exacta no encaja con "flakiness" random ni con nada
propio del proyecto (nada nuestro corre cada 62 min — el sondeo normal es
cada 2 min, el vigía es una vez al día) — apunta a algo del lado de
Chaturbate que se repite cada hora y golpea la consulta que le toque en
ese instante, sea de quien sea. **No confirmado, no inventar una causa
más allá de esto.** Cada vez se recuperó solo en la siguiente consulta
(nunca quedó pegado ni escaló a bloqueo largo). Si esto sigue apareciendo
día tras día a este ritmo, es la pista a seguir; si el vigía diario llega
a ver esto, que lo reporte como patrón horario distinto del incidente de
madrugada, no como el mismo bug.

**Confirmado día 2 (vigía del 2026-09-05, 12:01 UTC):** siguió toda la
noche exactamente igual — 18 errores en 24h, ~1 por hora, rotando entre
pinky_f00x/kitty_f00x/abigail_f00x/conni_f00x/amaranta_f00x/jax_f00x, cada
vez recuperado en la siguiente consulta. Ni escaló a bloqueo largo ni bajó
de frecuencia. El vigía de ese día **no avisó por chat ni correo** —
deliberado, no un fallo del trigger: es la continuación exacta de un
patrón ya diagnosticado el día anterior (arriba), sin nada nuevo que
justifique repetir la misma alerta. Balance (`last_balance_at`) y sync de
Stripchat (`cb_stripchat_earnings.updated_at`) seguían al día en el mismo
chequeo — el 403 horario sigue sin tocar la plata. Si en algún chequeo
futuro este patrón escala (dos errores en la misma hora, deja de
recuperarse solo, o pasa a las 6 modelos a la vez), eso sí es una alerta
nueva y real — reportarla entonces, no antes.

**Día 3 (vigía del 2026-09-06, 12:01 UTC): primera variación real, todavía
menor.** 24 errores en 24h, mismo patrón rotando entre modelos, pero por
primera vez dos cayeron separados solo 7 min en vez de los ~62 min
habituales (04:25:32 tamar4_f00x, 04:32:32 jax_f00x — verificado con los
timestamps exactos, no solo el conteo por hora). Técnicamente cumple el
criterio de "dos errores en la misma hora" de la nota de arriba, pero en
sustancia sigue siendo el mismo tipo de fallo: aislado a una consulta por
vez, autorecuperado de inmediato, nunca los 6 modelos a la vez, sin tocar
`last_balance_at` ni el sync de Stripchat. **No se avisó por chat ni
correo** — un solo blip de 7 min no es la escalada sostenida que la nota
de arriba busca detectar; se documenta para no perder el dato, no porque
haya ameritado una alerta. Si esto se repite (varios pares seguidos, o el
espaciado sigue encogiéndose noche tras noche), ahí sí es la señal real de
que algo cambió y toca investigar en serio.

**Filtro de racha en `sbLogApiError` — dejó de avisar por cada blip aislado
(2026-09-09).** Después de 5 días seguidos del mismo patrón horario
benigno (arriba), `sbLogApiError` estaba mandando push+correo cada ~62 min
sin aportar nada nuevo — el usuario pidió explícitamente reducir ese ruido.
Ahora `sbLogApiError` sigue escribiendo TODO en `cb_api_errors` sin
excepción (el vigía diario sigue viendo el conteo completo, esto no cambió),
pero solo dispara push+correo cuando de verdad amerita:
- Un mensaje que **no** tenga la forma `HTTP <código> para <modelo>` (ej.
  "cambió la forma de la respuesta, falta el campo `token_balance`") avisa
  siempre, al toque — eso es justo lo que este registro existe para agarrar,
  nunca se filtra.
- Un HTTP 4xx/5xx contra una modelo puntual solo avisa si se juntan
  `API_ERROR_BURST_THRESHOLD` (3) o más dentro de `API_ERROR_BURST_WINDOW_MS`
  (15 min) — eso es una racha real (ej. el bloqueo masivo del 2026-09-04,
  174 en 17 min), no el blip aislado de una vez por hora.
`isHttpStatusApiError`/`evaluateApiErrorBurst` viven en `chaturbate-lib.js`
(puras, con tests que reproducen tanto el patrón horario de 5 días como el
incidente real del 2026-09-04 — `npm test`: 91/91) porque server.js no debe
llevar lógica sin probar; server.js solo guarda `recentHttpStatusApiErrors`
(un array en memoria, se resetea en cada redeploy — aceptable, es
diagnóstico, no dinero) entre llamadas y llama a las funciones puras.
**Si algún día una fuente nueva de error empieza a mandar mensajes que
por casualidad calzan con `HTTP <código> para <algo>` sin ser un fallo de
red real, revisar este regex antes de asumir que el filtro está roto.**

**Día 6 (vigía del 2026-09-09): el patrón sigue vivo pero cambió de forma,
todavía benigno.** Dos cosas nuevas respecto a los primeros 5 días:
1. **Ya no es solo HTTP 403** — aparecieron 429, 500, 503 y 504 mezclados
   en la misma franja. El 2026-09-08 a las 14:07:17 hubo un burst real de
   4 (504 abigail_f00x, 503 kitty_f00x/amaranta_f00x/tamar4_f00x, los 4 en
   el mismo segundo) — eso cruza `API_ERROR_BURST_THRESHOLD` y el filtro
   nuevo lo habría marcado como racha correctamente (se recuperó solo en
   el siguiente ciclo, balance de las 4 sigue al día).
2. **Se concentró de forma desigual en kitty_f00x** — 19 de los 30 errores
   de las últimas 24h son de ella, casi uno por ciclo horario seguido
   durante casi un día entero, mientras las otras 5 solo cayeron 1-2 veces
   cada una. Se verificó específicamente que esto NO es un token vencido:
   `last_balance_at` de kitty_f00x está tan fresco como el de cualquiera
   (actualizado hace minutos), así que sigue teniendo éxito en la mayoría
   de sus ciclos — solo le está tocando fallar más seguido que a las
   demás. Punto 3 del chequeo (staleness > 2h) sigue limpio para las 6.
**No se avisó por chat ni correo** — nada de esto tocó la plata ni dejó a
nadie con el balance atascado; el burst real del 09-08 ya habría generado
su propio aviso en el momento (vía el filtro de racha) si el usuario
estaba mirando el chat en ese instante, no hace falta repetirlo acá. Si
kitty_f00x específicamente empieza a mostrar `last_balance_at` atrasado
(no solo errores), ahí sí es momento de pedirle que regenere su Stats API
token — hoy no es el caso.

## Auditoría de diseño / móvil (2026-09-03)

Revisión hecha con capturas reales (Playwright + Chromium, instancia
scratch en otro puerto, cuenta admin temporal borrada al terminar) en
375×812 / 768×1024 / 1440×900, las 5 pestañas. Lo arreglado:

- **Contraste**: `--muted-dim` era `#55555b` sobre `#0a0a0b` → ~2.5:1,
  muy por debajo del mínimo WCAG AA de 4.5:1, y es el color de **todos**
  los `label` de formulario, `.meta-small`, notas de tasa de cambio,
  días del calendario y estados vacíos. Ahora `#85858d` (~5.4:1 sobre
  el fondo, ~4.7:1 sobre `--surface-2`, que es donde se usa dentro de
  `.stat`/`.shift-day`). `--muted` subió a `#9a9aa2` para conservar el
  escalón de jerarquía. **Si tocas estos dos valores, verificá contra
  ambos fondos** (`--bg` y `--surface-2`), no solo contra el más oscuro.
- **`.btn-primary`** (nueva clase): antes 6 botones no tenían ningún
  estilo y caían al botón gris nativo del navegador, en una UI que por
  lo demás está toda tematizada — `btnCreateShift`, `btnNewsCreate`,
  `btnSaveDisplayName`, `btnSaveCtbStats`, `btnSaveCtbExtra` y
  `.btnNewsComment`. La regla vieja `#btnAdd, #btnLogin, #btnCreateAdmin`
  (bloque blanco sólido) quedó reducida a **`#btnLogin` solamente** —
  el resto migró a `.btn-primary` (rosa translúcido con borde). Regla
  para lo que venga: acción principal de una card = `.btn-primary`; el
  blanco sólido es exclusivo del login. Ojo con la especificidad: una
  regla por `#id` le gana a `.btn-primary`.
- **Pestañas**: Desprendibles y Noticias eran solo ícono (el texto vivía
  únicamente en `title`/`aria-label`) — en móvil no hay hover, así que
  una modelo no tenía forma de saber qué eran sin tocarlas. Ahora las 5
  tienen texto visible (`<span class="tablabel">`); en móvil los dos
  SVG se ocultan y el texto pasa a `text-transform:none` / 10px para
  que "Desprendibles" entre en la barra inferior de 375px. No vuelvas a
  dejar una pestaña sin texto visible.
- **Área de toque**: `.btnAnon` ("ocultar mi nombre", "cerrar mis
  sesiones en todos lados") tenía 10.5px de texto y 2px de padding.
  Ahora 11.5px + `padding: 8px 6px`, y color `--muted` en vez de
  `--muted-dim`.
- **Picker de hora en Extras**: el `<select>` de AM/PM se cortaba en
  móvil ("AN" con el chevron encima). Causa real: el grid del form era
  `minmax(140px,1fr)`, así que a 375px seguía en 2 columnas y los 3
  selects quedaban con ~41px cada uno. Ahora `minmax(185px,1fr)` → una
  columna en móvil. **Esto es lo que el usuario había reportado como
  "íconos encima" en ese picker**; el arreglo anterior (chevron custom
  con `appearance:none`) no era la causa raíz.
- **Filas de cuentas** (`.admin-list-row`): en móvil los 3 botones se
  amontonaban contra el borde derecho; ahora la fila apila
  nombre-arriba / botones-abajo bajo 640px.
- **Ícono decorativo** de cada pestaña (`.banner-icon`): en móvil bajó
  de `min(110px,46%)` a `min(84px,34%)` y el margen del bloque se
  redujo — empujaba demasiado el contenido real hacia abajo en cada
  cambio de pestaña. En desktop quedó igual.

Lo que se revisó y **está bien, no lo "arregles"**: la `.tabnav` fija
abajo en móvil con `body { padding-bottom: 64px + safe-area }` es
deliberada (alcance del pulgar) y está correcta. En una captura
`fullPage` de Playwright esa barra aparece flotando en mitad del
contenido — es un artefacto de cómo Chromium compone `position:fixed`
al capturar más allá del viewport, no un bug real; no lo persigas.

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

## Bugs visuales encontrados con Playwright el mismo día (2026-09-09)

Reporte del usuario: "veo botones unos encima de otro" + "el cuadro de
aviso o anuncio no es distinto el uno del otro". Diagnosticado con
Playwright + Chromium contra una instancia `SOLO_UI=1` (cuentas
`qa_temp_admin2`/`qa_temp_model2`, borradas al terminar) en vez de adivinar
a ciegas — capturas reales encontraron dos bugs concretos:

1. **El `<select>` de tipo de Noticias (hilo/aviso) se estiraba al ancho
   completo de la card** en vez de verse como una etiqueta chica — causa:
   `index.html` tiene una regla global `input, select { width: 100%; ... }`
   (línea ~156) que le gana a cualquier estilo inline que no fije `width`
   explícitamente. El `<select>` que se agregó para que admin cambie el
   tipo no traía `width`, así que heredó el 100%. **Cualquier `<select>`
   nuevo que deba verse como badge/pill tiene que traer `width:auto;
   display:inline-block;` en su propio estilo inline** — si no, hereda el
   100% global sin avisar. De paso, eso hacía que HILO y AVISO se vieran
   casi iguales (misma barra ancha, colores sutiles) — ahora además de
   arreglar el ancho, AVISO quedó con fondo rosa sólido y texto oscuro
   (mucho más "cartel de aviso" que un simple borde de color), y la CARD
   completa de un aviso lleva un tinte rosa de fondo/borde
   (`cardStyle` en `refreshNews()`), no solo el badge — así se distingue de
   un vistazo, no solo mirando la esquina.
2. **La columna "Corregir" de `asistencia.html`** (Editar hora / Reiniciar
   / Borrar, 3 botones desde que se agregó "Editar hora") quedaba
   apretada en una sola columna angosta con los 3 botones apilados muy
   pegados uno encima del otro en móvil — la tabla se calcula con
   `min-width` fijo y esa columna no tenía uno propio, así que se achicaba
   al mínimo. Fix: `.fix-actions` con `min-width: 200px` (entran 2 botones
   por fila en vez de 3 filas sueltas) y el `min-width` de la tabla subió
   de 900px a 1000px para darle el espacio real. Verificado con Playwright
   scrolleando la tabla horizontalmente y capturando esa columna puntual
   (`el.scrollLeft = el.scrollWidth`) — antes y después.

**Método que sirvió, repetirlo cuando el usuario reporte algo visual sin
captura:** `npm install playwright` en un directorio aparte (`/tmp`, fuera
del repo — no tocar `package.json` del proyecto) con
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` y
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (el Chromium ya viene preinstalado ahí,
no hace falta bajarlo de nuevo); usar la versión más reciente de playwright
(`@latest`), no una vieja — una v1.48 fija chocó con el binario de Chromium
preinstalado ("Old Headless mode has been removed"), v1.63 sí funcionó.
Lanzar con `executablePath: '/opt/pw-browsers/chromium-<build>/chrome-linux/chrome'`
(el nombre de carpeta exacto varía, listar `/opt/pw-browsers/` primero) y
`args: ['--no-sandbox']`. Cuentas de prueba creadas y borradas en la misma
sesión, igual que con curl — nada de esto es nuevo, solo automatiza lo que
ya se hacía a mano.
**Falso positivo a no perseguir (ya documentado arriba, confirmado de
nuevo):** en una captura `fullPage` de Playwright, la barra de pestañas
fija (`position:fixed`) aparece flotando encima del contenido de más abajo
— es como Chromium compone el `fixed` al capturar más allá del viewport
real, no un bug del sitio. Si algo parece "tapado" por la barra de abajo
solo en una captura fullPage, no es real; confirmar con un viewport normal
o scrolleando antes de reportarlo como bug.

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

## Corrección de tono y ritmo de la frase motivacional (2026-09-09, misma noche)

El usuario revisó la frase del banner recién implementada y pidió tres
ajustes puntuales sobre lo ya construido, no una feature nueva:

- **Tono: nada de voseo.** Varias frases y dos textos cercanos (la
  descripción de la card "Confirmación de extras y recuperaciones" en
  Cuentas, el cuerpo del panel de retraso en Asistencia, y la ayuda del
  token de Chaturbate en Cuentas) usaban "vos"/"sos"/"podés"/"generá"/
  "pegalo"/"acá" — modismos rioplatenses que no encajan con "un acento
  forma y general... tuteado. Nada de vos, o sos nada de esos modismos."
  Corregido a tuteo neutro en las 6 líneas encontradas por grep
  (`\bvos\b|\bsos\b|podés|tenés|querés|sabés|decís|Seguí\b|llegá\b|
  mirá\b|fijate|dale\b|acá\b`, case-insensitive, corrido contra
  `index.html` completo — `asistencia.html` no tenía ninguna instancia
  real, solo un "acá" dentro de un comentario de código, invisible al
  usuario, que no hacía falta tocar). `ATT_GOOD_PHRASES` ya estaba en
  tuteo correcto desde que se creó, no necesitó cambios.
- **Más frecuente**: `bannerPhraseTimer` bajó de 9000ms a 5000ms.
  `BANNER_PHRASES` pasó de 7 a 10 frases (se agregaron 3 nuevas, todas en
  tuteo) para que la rotación más rápida no se sienta repetitiva.
- **Fuente distinta**: `.banner-phrase` pasó de heredar la tipografía
  normal del body a `font-family: var(--font-display)` (la misma fuente
  de los títulos, 'Unbounded') en itálica — antes era texto plano en
  `var(--muted)` a 11.5px, ahora se distingue con claridad del resto del
  texto de la pestaña.
- **Color: pedido aparte a mitad de esta misma corrección** — la primera
  versión de este cambio dejó la frase en rosa neón (`var(--pink)`) para
  que hiciera juego con el resto de la estética; el usuario pidió
  explícitamente "Déjala blanca con el concepto que tienes" (o sea:
  mantener itálica + fuente display + cadencia de 5s, solo cambiar el
  color). Quedó en `var(--text)` (blanco casi puro, `#f5f5f7`).
- Confirmado que las 6 pestañas siguen con su `.banner-phrase` intacto y
  que el patrón de "solo rota en la pestaña activa, la siguiente pestaña
  muestra su frase recién en el próximo ciclo global" (documentado en la
  sección anterior) sigue funcionando igual — no se tocó esa lógica, solo
  el intervalo, la fuente/color y el contenido de los arrays de frases.
  Verificado con Playwright contra el Supabase real (cuentas
  `qa_temp_phrase2`/`qa_temp_phrase3`, borradas al terminar cada una):
  capturas confirmando fuente itálica display, texto en tuteo, cadencia
  de 5s (misma frase o distinta entre ticks es aleatorio — con 10 frases
  hay ~10% de chance de repetir dos veces seguidas, no es un bug) y color
  blanco en la versión final. `npm test`: 105/105.

## Segunda pasada sobre la frase motivacional (2026-09-09, todavía la misma noche)

Tres pedidos más sobre lo mismo, en un solo mensaje: bajar más el tamaño de
fuente, abrir la frase a `administrador`/`ceo` (antes exclusiva de
`modelo`), y corregir un reporte de "frases sobrepuestas" buscando una
animación más fluida.

- **Tamaño de fuente**: 12.5px → 10.5px. `min-height` del contenedor bajó
  de 18px a 15px a juego.
- **Ahora la ven los 3 roles**: el gate `if (currentRole !== 'modelo')
  return;` en `bannerPhraseTick`/`startBannerPhraseRotation` pasó a
  `if (!currentRole) return;` — cualquier sesión logueada (administrador,
  ceo, modelo) la ve. `showApp()` ya llamaba `startBannerPhraseRotation()`
  sin filtrar por rol de entrada, así que no hizo falta tocar ese call
  site. Verificado con Playwright: cuenta admin de prueba viendo la frase
  en la pestaña Modelos.
- **"Frases sobrepuestas"**: no se pudo reproducir un solape real
  DOM/visual con el código anterior — se instrumentó un muestreo de
  `opacity`/`textContent` cada 60ms durante un ciclo completo (90 muestras)
  contra una instancia real y dio 0 anomalías (nunca cambió el texto
  mientras la opacidad anterior seguía por encima de 0.15). Aun así, el
  mecanismo tenía un punto real y no defendido: `bannerPhraseTick` no
  guardaba referencia al `setTimeout` pendiente en el propio elemento, así
  que si dos ticks llegaban a superponerse en el tiempo (throttling del
  navegador en background, pestaña reactivada, etc.) podían quedar dos
  `setTimeout` escribiendo sobre el mismo `.banner-phrase` sin ningún
  orden garantizado — la causa más plausible de un flash de texto
  encimado que solo el usuario, en su propio dispositivo, llegó a ver.
  Fix defensivo: cada `.banner-phrase` ahora guarda su propio timer en
  `el._phraseFadeTimer`; un tick nuevo cancela primero cualquier fade
  pendiente en ese mismo elemento antes de programar el suyo — nunca hay
  dos escrituras en carrera sobre el mismo nodo.
- **Animación más fluida**: la transición pasó de un fade plano de 0.6s
  (`ease`) a 0.45s con `cubic-bezier(.2,.8,.3,1)` (la misma curva que ya
  usa `.tabpanel` para la animación de entrada de pestaña — reutilizada
  por consistencia, no inventada) combinando opacidad con un desplazamiento
  vertical sutil (`translateY(3px)` → `translateY(0)`), en vez de opacidad
  sola — se ve como un fade+slide, más suave que el fade lineal anterior.
  `will-change: opacity, transform` para ayudar a que el navegador lo
  composite en su propia capa (menos probabilidad de parpadeo/ghosting en
  Safari/iOS al animar texto, que es la otra hipótesis técnica del reporte
  de "sobrepuestas" si el navegador del usuario llegó a redibujar mal el
  cross-fade). El `setTimeout` interno se ajustó de 650ms a 470ms para
  coincidir con la nueva duración de transición (0.45s + margen).
  Verificado con Playwright (cuentas `qa_temp_phrase4`/`qa_temp_adminph4`,
  borradas al terminar): capturas confirmando la fuente más chica y que
  administrador ve la frase; `npm test`: 105/105.

## Primera racha real que cruzó el filtro de `sbLogApiError` (2026-09-10)

El usuario recibió el push nuevo del filtro de racha (agregado 2026-09-09,
ver sección de arriba): *"Error en chaturbate_stats: HTTP 403 para
jax_f00x (van 3 HTTP 4xx/5xx en los últimos 15 min — ya no es un blip
aislado)"*, a las 04:45 UTC (11:45 p.m. hora Colombia). Investigado contra
`cb_api_errors` real: los 3 errores que cruzaron el umbral fueron
`tamar4_f00x` (04:33:29), `jax_f00x` (04:39:27) y `jax_f00x` (04:45:27) —
tres blips sueltos del mismo patrón horario benigno ya documentado (Días
1-6 arriba), que esta vez cayeron lo bastante juntos (12 min de punta a
punta) como para tocar el umbral de `API_ERROR_BURST_THRESHOLD` (3 en 15
min) por coincidencia, no por una caída sostenida como la del 2026-09-04.
**Cero errores nuevos después de las 04:45**, y las 7 modelos con
`stats_api_token` (abigail/amaranta/conni/jax/kitty/pinky/tamar4 — ya son
7, no 6, `tamar4_f00x` se sumó en algún momento sin que quedara nota
explícita de cuándo) tenían `last_balance_at` actualizado a menos de un
minuto al momento de revisar — se recuperó solo, sin ventana ciega
sostenida, sin dato de plata afectado.
**Conclusión: el filtro funcionó exactamente como se diseñó** — el umbral
de 3-en-15-min existe justamente para agarrar algo como el bloqueo masivo
del 2026-09-04 temprano, y no puede distinguir de antemano si un cruce del
umbral es el inicio de un incidente real o una coincidencia benigna; solo
lo sabe en retrospectiva, revisando si se recuperó. Esto NO es un bug del
filtro ni motivo para subir el umbral — subirlo reduciría también la
sensibilidad para detectar una racha real. Se documenta como precedente:
si este tipo de push (3 en 15 min, distintas modelos, autorecuperado) se
vuelve frecuente y empieza a sentirse como ruido, ahí sí valdría la pena
ajustar el umbral o la ventana — hoy, con una sola ocurrencia en varios
días, no amerita tocar nada.

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

## How this user likes to work

Non-technical, moves fast, dislikes long back-and-forth or being asked
to test things himself. Test every change yourself end-to-end (spin up
a scratch instance on a different port, hit it with curl and/or the
browser tool, against the real Supabase project) before saying
something works or asking him to check. Keep any engineering
justification ("we did X because Chaturbate's API doesn't support Y")
out of the product's own UI copy — that reasoning belongs in chat only.
