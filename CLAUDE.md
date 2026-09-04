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

### ⚠ CONFIDENCIAL — margen de tolerancia de entrada

`ATTENDANCE_GRACE_MINUTES = 12` en `chaturbate-lib.js`. Los primeros 12
minutos de cada turno no cuentan como retraso; pasado ese margen el retraso
cuenta desde ahí (llegar 20 tarde cuenta como 8, no como 20).

**Esto NO puede aparecer en ningún texto de la web.** El usuario lo pidió así
explícitamente: si las modelos supieran del margen, llegarían tarde a
propósito esos 12 minutos. No lo pongas en la interfaz, ni en mensajes de
error, ni lo mandes en la respuesta de la API — se aplica en `server.js` al
validar y lo que viaja al navegador es únicamente el número ya ajustado.
Verificado que no aparece en `public/` ni en ninguna respuesta.

**Límite honesto que el usuario debe saber:** una modelo que sepa su hora de
turno y vea su propio retraso puede restar y deducir el margen (llega 4:20,
la app le muestra 8 minutos → dedujo los 12). No hay forma de mostrar un
número consistente y a la vez esconder del todo la resta. Lo que sí está
garantizado es que en ningún lado se lo decimos.

El dato crudo no se pierde: `scheduled_at` y `official_at` quedan guardados
en `cb_attendance_days`, así que el retraso real siempre se recalcula.

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

## How this user likes to work

Non-technical, moves fast, dislikes long back-and-forth or being asked
to test things himself. Test every change yourself end-to-end (spin up
a scratch instance on a different port, hit it with curl and/or the
browser tool, against the real Supabase project) before saying
something works or asking him to check. Keep any engineering
justification ("we did X because Chaturbate's API doesn't support Y")
out of the product's own UI copy — that reasoning belongs in chat only.
