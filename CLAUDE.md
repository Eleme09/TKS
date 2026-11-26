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

## Permiso de deploy (2026-11-09)

El usuario dio permiso permanente: cuando termines un cambio que él pidió y
`npm test` pase, pushea directo a `master` (Render despliega solo). No le
preguntes antes de mergear lo que él mismo pidió. Revisa `list_deploys` de
Render después para confirmar que quedó `live`.

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

## Reglas vigentes de las secciones movidas (resumen — el detalle histórico está en HISTORIAL.md)

**Noticias:** admin y CEO publican; cualquier rol comenta en hilos; solo administrador borra posts/comentarios y cambia `hilo`↔`aviso` después de publicar. Lectura por sesión (`cb_news_reads`); quién leyó solo lo ven admin/CEO y solo modelos. Nombre visible del admin: `cb_admins.display_name`, con "Anónimo" siempre por encima. Cada push nuevo lleva su propio `tag`.

**Notificaciones push:** por rol. "Modelo conectada" → solo `ceo`. Caída de tracker y alerta de API → `administrador` (+`ceo` en caída). Noticias → todos menos el autor. Nunca pasar `null` para un tipo nuevo sin decidir quién lo recibe. Las suscripciones son por dispositivo: antes de decir "no llega", revisar `cb_push_subscriptions`. `cb_push_subscriptions.username` y similares no llevan FK a `cb_admins` a propósito.

**Correo de alertas (solo dos):** `sendConnectionAlert` y `sbLogApiError` además de push. No añadir más tipos sin pedido explícito. Requiere `GMAIL_USER`/`GMAIL_APP_PASSWORD` en Render; sin ellas queda apagado, no roto.

**Asistencia — reglas de negocio:**
- Llegada: el admin tiene tres salidas ("Sí llegó a esa hora" / "Llegó ahora" / "Otra hora…") o rechazar. No simplificar a un botón. Se guardan `reported_at` y `official_at`.
- Turnos: Mañana 07:30–15:30 y Tarde 16:00–00:00. Sin margen de tolerancia (el margen se eliminó el 2026-09-10 y no debe volver).
- Zona horaria de asistencia: UTC-5 fijo (`STUDIO_UTC_OFFSET_HOURS`). Nunca `toDateStr` ni la hora del servidor. Domingos: horarios cruzados, no cuentan para retraso ni salida temprana.
- Privacidad: el filtro por modelo es server-side. Una modelo nunca recibe campos de staff.
- Deuda por retrasos: $10.000 COP por cada hora completa; tope a $0 al pasar 6 h (360 min) cuando `social_security_enabled` está activo. La deuda NO se resta automáticamente del desprendible: se muestra aparte. Tokens y retrasos viven separados a propósito.
- `social_security_enabled` por cliente: en `false`, la multa crece sin tope y no hay aviso de seguridad social.
- Retraso justificado (`late_excused`): no suma a deuda ni a umbral; el número real se sigue mostrando.
- Salida temprana: se marca aparte (`early_exit_minutes`). Cobro PAUSADO con `EARLY_EXIT_CHARGE_ENABLED = false`; no reactivar sin pedido.
- `/api/attendance/day/edit`: la edición del admin queda invisible para la modelo (`official_source: 'reportada'`, sin `manual`) y no manda push.
- Correcciones destructivas (`day/reset`, `day/no-show`, `justification/delete`): siempre con `sbLogAudit`. No quitarlo.
- `/api/attendance/settings`: solo `administrador`, no `ceo`.
- Admin y CEO pueden editar el texto de un justificante; solo administrador lo borra.
- Auto-validación a los 15 min: usa la rama "Sí llegó a esa hora"; trazada en `cb_audit_log`.
- Hojas: un solo selector de modelo por vista, nunca "Todas". Modelos, Extras y Cuentas sí muestran todas (son dashboards).

**Cuentas y permisos:**
- Centralizado en Cuentas. Contraseña de modelo: admin o CEO. Forzar logout de admin/CEO: solo administrador.
- "Entrar como" (impersonación): administrador puede entrar a modelos, CEO y administradores. El estado viaja en el cookie firmado (`admin_return`). CEO no puede impersonar.
- Eliminar modelo: administrador o CEO, con doble confirmación escribiendo el nombre completo. El borrado es en cascada; devuelve error si falla.
- Cambio de contraseña obligatorio (`must_change_password`): bloquea todas las rutas salvo `/api/me/change-password`.
- Mínimo de contraseña: 8 caracteres.

**Quincena y dinero:**
- El corte es 23:30 Colombia (04:30 UTC), en `payrollDateStr`/`getQuincena`. No mover a medianoche ni a las 2 a.m.
- Stripchat usa `stripchatQuincenaWindow` (corte a medianoche). No usar `getQuincena` para sus rangos.
- Ventana de sondeo post-corte de Chaturbate: 04:18–04:36 UTC, cada 60 s. No subir la frecuencia.
- Desprendible del estudio: 0,05 USD por token, solo admin y CEO. El de la modelo sigue en 0,023.
- Todo total de una tabla `cb_*` que venga de más de una modelo debe paginarse con `sbFetchAllRows` (límite de 1.000 filas de PostgREST).

**Automatización y consumo de Supabase:**
- Nunca scriptear login en Chaturbate ni Stripchat. Solo APIs con token.
- Cursor de Chaturbate: se guarda como mucho cada 5 min (`CURSOR_SAVE_MIN_INTERVAL_MS`). Eventos sin valor (`userEnter`, `userLeave`, `chatMessage`, `follow`, `unfollow`, `roomSubjectChange`) no se guardan.
- Si el consumo sube de nuevo, el primer sospechoso es código propio (queries sin caché, sin índice, o demasiado frecuentes), no el proveedor. No proponer cambiar de proveedor sin pedido.
- No pausar `venta-webs` (otro negocio, misma organización).

**Pruebas:**
- Cuentas de prueba solo `qa_temp_*`. Nunca una modelo real, ni el primero de una lista. Borrar las cuentas de prueba al terminar.
- Modelos de prueba con `role: 'modelo'` las levanta el poller de Stripchat: revisar `cb_api_errors` después.
- `SOLO_UI=1` nunca en producción.

**Operación (lecciones):**
- Después de cada push a `master`, revisar en Render que el deploy esté *live* (`list_deploys`). Un deploy fallido deja corriendo el código viejo sin que nadie lo note.
- Antes de borrar un archivo que pueda ser de arranque (`-r`, `NODE_OPTIONS`, `postinstall`), revisar también las variables de entorno de Render: no viven en el repo.
- Antes de afirmar que algo "no existe", hacer `git fetch origin master`.
- Un 402 de Supabase tira toda la API. Para diagnosticarlo, pegarle directo a la API con la clave, no usar el login como prueba.

**Pendientes del dueño:** cerrar el acceso anónimo de Supabase (requiere `SUPABASE_SERVICE_KEY` en Render). Copias de seguridad: decisión tomada, no volver a proponerla.

## Historial detallado

Las secciones datadas (2026-09-02 en adelante) se movieron a `HISTORIAL.md`, sección "Archivo movido desde CLAUDE.md (2026-11-26)". Abrir solo si se necesita el detalle de algo puntual.

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

## Vigía de pérdida de tokens de Chaturbate (2026-11-14)

El usuario pidió saber si se pierden tokens de Chaturbate (había pasado días sin
Claude). Auditoría de 16 oct–14 nov contra Supabase real: **el libro cuadra
exacto** — en cada corte diario `cb_balance_resets.from_balance` = suma de
`cb_balance_ticks` del ciclo (cero diferencias). Lo único que puede perderse es
lo ganado entre la última lectura y el corte de las 04:30 UTC, y como máximo
fue ~62 tokens en 16-31 oct (jax 62, pinky 21) y ~39 en 1-14 nov (conni 22,
pinky 10, jax 7): menos del 0,5% del total, ≈ US$3. Es un tope estimado con
`cb_tips` (la API de eventos), no una pérdida confirmada, y **no se acreditó
nada**: sumar tokens "estimados" mueve plata y requiere OK del usuario.
La rutina diaria (trig_01BXcfPNvAetGc9gcNcJUa7m) tiene ahora el punto 7 con tres
chequeos (integridad del libro, tope de pérdida en la ventana del corte, lecturas
fallidas cerca del corte) y, si alguno da alarma, debe investigar y arreglar el
código sola (push a master), no solo avisar. Las queries exactas viven en el
prompt de la rutina (`get_trigger`).

## How this user likes to work

Non-technical, moves fast, dislikes long back-and-forth or being asked
to test things himself. Test every change yourself end-to-end (spin up
a scratch instance on a different port, hit it with curl and/or the
browser tool, against the real Supabase project) before saying
something works or asking him to check. Keep any engineering
justification ("we did X because Chaturbate's API doesn't support Y")
out of the product's own UI copy — that reasoning belongs in chat only.

## Tienda (autoservicio / fiado) embebida — carpeta `tienda/`

La tienda de autoservicio (antes repo `TIENDA-`, servicio `tienda-fiado`) vive
dentro de este mismo servicio de Render para no depender de un servicio
gratuito (que se suspende al agotar las 750 h/mes). Es una app Express
independiente: `tienda/server.js` exporta `{ app, init }`.

- `server.js` (raíz) la atiende SOLO si la petición llega por el host
  `TIENDA_HOST` (ej. `tienda.placerstudios.online`); cualquier otro host va a
  TKS como siempre. Sin `TIENDA_HOST`, o si la tienda falla al cargar, TKS no
  cambia (el `require` va en try/catch).
- Variables de entorno (Render → TKS): `TIENDA_HOST`, `TIENDA_SUPABASE_URL`,
  `TIENDA_SUPABASE_SERVICE_ROLE_KEY`, `TIENDA_SESSION_SECRET`. Llevan prefijo
  porque TKS ya usa `SUPABASE_URL`/`SESSION_SECRET`. La tienda usa **su propio**
  proyecto de Supabase (tablas `tf_*`, ver `tienda/schema.sql`), no el de TKS.
- Ya no tiene lectura de facturas por foto (OCR): se quitó para no cargar
  `tesseract.js` (memoria) en el proceso de TKS.
- Los cambios a la tienda se hacen aquí; el repo `TIENDA-` queda como histórico.

