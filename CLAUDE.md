# PLACER SERVICES — Chaturbate token/payroll tracker

Internal tool for a Chaturbate webcam studio: tracks each model's token
earnings live, computes biweekly payroll (quincenas), runs an overtime
shift sign-up calendar, and gates everything behind 3 roles.

**Este archivo es solo el estado ACTUAL y las reglas que importan hoy —
no un diario.** El detalle de incidentes, correcciones día a día, y cómo
se llegó a cada decisión vive en `docs/historial.md` (no se carga
automático, se lee bajo demanda). Si algo acá te parece raro o falta
contexto, buscalo ahí antes de asumir que falta información.

## Before touching anything

Run `git log --oneline -30` and skim recent commit messages, then read
the actual current `server.js` / `public/index.html`. **This project has
been developed from multiple, disconnected Claude Code sessions on
different devices, sometimes in parallel.** Don't trust any prior
session's description of "current state" (including sections below) —
trust the repo. If something below conflicts with what the code
actually does, the code wins; fix this file to match.

**Cuando edites este archivo:** reemplazá el estado viejo, no lo apiles
al lado. Si algo cambia, la sección de acá pasa a describir el estado
nuevo directamente — la historia de cómo cambió va a `docs/historial.md`,
no queda una "corrección de la corrección" enterrada en el medio.

## Multi-terminal work — always persist, never leave it only in chat

El usuario trabaja desde varios terminales/dispositivos en este mismo
proyecto y no tiene tiempo de reexplicar contexto a una sesión nueva cada
vez. Cualquier output que costó trabajo real producir — un documento, un
checklist, un archivo generado, un procedimiento reusable — tiene que
terminar en algún lugar durable (este repo, o una tabla de Supabase) antes
de dar el turno por terminado, no solo mostrado en el chat. El historial
del chat no pasa entre terminales; el repo y la base sí.

`public.cb_kit_docs` (id text primary key, content text, updated_at)
guarda documentos de referencia que no son código pero que el usuario
necesita desde cualquier dispositivo: `skill-studio-tracker-setup.md`
(espejo de `.claude/skills/studio-tracker-setup/SKILL.md`),
`ficha-alta.html` y `ficha-cliente.html` (los dos checklists de onboarding
para replicar este proyecto a un estudio nuevo — ver esa skill), y el
embudo de ventas: `sales-script.md` / `sales-email.md` (primer contacto
frío — problema/solución, termina ofreciendo una demo con números
inventados, nunca menciona precio) y `post-demo-proposal.md` (se manda
solo después de que el prospecto aprueba la demo — el pedido de depósito
de $250.000, la ficha con datos reales, y el menú de precios real).
Consultalo desde cualquier terminal con
`select id, content from cb_kit_docs where id = '...'` en vez de pedirle
al usuario que resuba o redescriba algo ya producido una vez. Si la skill
o las fichas cambian, reupsertear la fila acá también.

**Precio actual (confirmar con el usuario antes de reusar — estos números
cambian):** no hay fee único de construcción — $500.000 cada quincena es
el cargo recurrente base solo por tener el sitio funcionando (build de 6
días, Jeiner hostea en su propio Render/Supabase, el cliente tiene una
cuenta `administrador` normal para su día a día — esto NO incluye el "rol
avanzado" de superusuario técnico como reset de contraseñas/force-logout/
reconexión, que se queda con Jeiner a menos que se venda aparte); opcional
**+$80.000/quincena** encima (total $580.000) si el cliente también quiere
a Jeiner monitoreando/manteniendo activamente la página en vez de solo
dejarla corriendo; $4.500.000 pago único de compra completa — el cliente
se queda con sus propias cuentas de Render/Supabase más el código fuente
editable, entregado limpio (ver abajo), y no paga más fee recurrente
después de eso; $40.000/$100.000 por incidente para arreglar bugs que
introdujo un programador TERCERO (no bugs propios de Jeiner). No hay dato
de mercado verificado sobre si prospectos reales van a aceptar el precio
recurrente de $500-580k/quincena — es una comparación razonada nomás
(aproximadamente lo que costaría un contador part-time haciendo esto a
mano, en un nicho sin competencia directa), no un hecho confirmado;
probarlo en los primeros 2-3 prospectos reales en vez de asumir que está
bien o mal. El pitch real, siempre: "consolidamos los números de tus
plataformas en un solo lugar limpio", nunca "las plataformas te esconden
ingresos" — ver la sección de ingresos de Chaturbate más abajo para
entender por qué ese segundo framing está mal.

**Entrega limpia para el tier de 4.5M:** verificado que solo `CLAUDE.md`,
`.claude/skills/`, y una línea en `iniciar.bat` mencionan "Claude" en
algún lado de este repo — `server.js`, `chaturbate-lib.js`, `index.html`,
`schema.sql` no tienen ninguna marca de autoría de IA. Un handoff a
cliente en ese tier significa excluir esos archivos y entregar sin
historial de git (o un historial de un solo commit aplastado sin trailer
de co-autor de Claude) — higiene de entrega normal, no engaño, y nunca
inventar un nombre de autor humano falso para eso.

*(Un intro tipo splash con letrero de neón para abrir una demo de ventas
se probó y se descartó — al usuario no le gustó tras verlo pulido. No
volver a sugerir una animación de splash/intro para la herramienta diaria
ni el flujo de demo salvo que el usuario lo traiga de nuevo.)*

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
- **Uptime**: production is on a **paid Render plan** (confirmed by the
  user in chat, not independently verified). Doesn't sleep on inactivity,
  no monthly instance-hour cap. UptimeRobot monitor is redundant — safe to
  remove if found still configured.
- **Staging**: a second Render free web service, `tks-staging`
  (`tks-staging.onrender.com`), same repo, branch `dev`, same three
  secrets (but its own `SESSION_SECRET`, different from production's).
  Normally **suspended** — resume it manually in Render only to test
  something live, then re-suspend. It shares the same Supabase tables as
  production, so leaving it running double-polls Chaturbate (tip dedup on
  `event_id` prevents double-counted money, but it's wasteful and not a
  real isolated environment). Workflow: commit → push to `dev` → resume
  `tks-staging` → verify → push/merge to `master` for the real deploy.
- **Browser access**: Claude in Chrome (the user's real, logged-in
  Chrome) has working sessions for GitHub, Render, and Supabase —
  confirmed working for SQL directly in the Supabase SQL Editor and for
  managing Render end to end. `git push` from this machine's shell works
  directly (credentials configured) — no need to route through GitHub
  Desktop.

## Reliability notes (read before touching pollLoop / tracker logic)

- Each model's Chaturbate Events API long-poll cursor (`nextUrl`) is
  persisted to `cb_models.last_cursor` after every successful poll cycle,
  and reconnect (`reconnectAllModels`, `/api/start`, `/api/reconnect`)
  resumes from it instead of starting fresh. This closes a real
  money-loss window: without it, any tip arriving during a server
  restart was silently lost forever. If the saved cursor is stale/
  rejected, the code falls back to a fresh connection automatically —
  don't treat that fallback path as a bug.
- Online/offline status is **in-memory only** (`tracker.online`). On a
  fresh add (no saved cursor) it starts `false` until a real event
  arrives. On a **resume from a saved cursor** (the normal restart/
  redeploy case), `pollLoop` seeds `tracker.online` from
  `cb_broadcast_events`' last recorded event for that model
  (`sbFetchLastBroadcastEvent`) — a valid cursor resume has no event gap,
  so the DB's last event is trustworthy. If the saved cursor turns out
  rejected further down (falls back to `freshUrl`), the seed is
  explicitly reverted to `false`/unknown. Don't revert to unconditional
  `false`-on-restart — a model live before a restart would show
  "desconectada" for hours instead of minutes. Purely a monitoring/UI
  concern, not money — `totalTokensPeriod` only ever comes from
  `cb_tips`, never online status.
  A `start` event can itself be stale if its matching `stop` was lost
  historically. `ONLINE_SEED_MAX_AGE_MS` (12h): a `start` older than that
  is not trusted for seeding. If this recurs for a model, insert a real
  `stop` row into `cb_broadcast_events` for her, then `/api/stop` +
  `/api/reconnect` to force re-seed immediately.
- `startTracker(username, token, savedCursor)` **must** set
  `existing.running = false` on the tracker it's replacing before
  aborting its fetch — aborting alone does not stop that old poll loop
  (its `while (tracker.running)` check would still pass), so it becomes
  a "zombie" polling the same account forever in parallel with the new
  one. `/api/stop` and `/api/delete` have the correct pattern to copy.
- `pollLoop` must not retry the exact same failing `nextUrl` forever on a
  flat interval — Chaturbate can reject a URL (HTTP 400, "You waited too
  long") in a way a flat 5s retry never recovers from. Fix: back off up
  to 60s based on `tracker.consecutiveErrors`, force `nextUrl` back to
  the cursor-less `freshUrl` every 3rd consecutive failure. A model stuck
  showing "error" and never reconnecting is this bug if it recurs —
  check `consecutiveErrors`/backoff logic first.
- Supabase writes that represent real tip/broadcast data go through
  `sbWriteCritical` (retries 3x, logs loudly on final failure instead of
  swallowing it silently). Use it — or something at least as resilient —
  for any new write that represents money.

## Business rules (stable — confirm before changing)

- **Quincena**: día 1–15 de un mes se paga el 20 de ese mes; día 16–fin
  de mes se paga el 5 del mes siguiente.
- **Payout de modelo**: `tokens × 0.023 USD/token`, convertido a COP a
  una tasa diaria en vivo (cacheada ~5 min). Ese USD/token es dato
  financiero del negocio — nunca cambiarlo sin que el usuario lo pida
  explícitamente. Cifras COP históricas (quincenas pasadas) son
  aproximadas (tasa de hoy, no la histórica) — etiquetarlas como tales.
- **Payout del estudio**: `STUDIO_PAYOUT_RATE_USD_PER_TOKEN = 0.05` en
  server.js, distinto y separado del 0.023 de las modelos — lo que el
  estudio recibe por token frente a lo que le paga a cada modelo. El stat
  "Desprendible del estudio (estimado)" en `#summaryCard` es
  `tokens totales del estudio × 0.05 × dólar Paxum`. `GET /api/models`
  manda `studio_rate_usd_per_token` (no hardcodeado en frontend).
  **Sensible:** revela el margen real del estudio (0.05 vs 0.023, poco
  más del doble) — ese stat queda SIEMPRE admin+ceo, nunca modelo; no
  relajar ese gate sin pedido explícito. El desprendible individual de
  cada modelo no cambia, sigue en 0.023.
- **Roles**: `administrador` (control total), `ceo` (badge "CEO PLACER
  STUDIO", solo lectura en ganancias/estado de modelos pero gestiona el
  calendario de turnos + desde 2026-09-09 también Cuentas → 2 cards
  específicas, ver abajo), `modelo` (ve/gestiona solo sus propios datos,
  loguea con su username de Chaturbate + contraseña que le asigna admin,
  no email).
- **Cuentas (tab)**: único lugar donde viven los controles de reset de
  contraseña y force-logout, para todo tipo de cuenta. Admin/CEO
  ("Cuentas administrativas") y modelos ("Contraseñas y sesiones —
  modelos", `refreshModelAccounts()`). No re-agregar el botón
  "Contraseña" por-modelo en la pestaña Modelos, pertenece solo acá.
  `POST /api/accounts/logout-everywhere` (`{type: 'admin'|'model',
  username}`): `type: 'model'` → `requireAdminOrCeo`; `type: 'admin'` →
  `requireAdmin` a secas — **CEO nunca puede forzar logout de otra cuenta
  admin/CEO**, solo de modelos. `POST /api/models/set-password` también
  `requireAdminOrCeo`.
  Desde Cuentas, CEO ve solo 2 cards: "Confirmación de extras y
  recuperaciones" y "Contraseñas y sesiones — modelos". Las demás
  (Cuentas administrativas, Automatizar Chaturbate, Mi nombre en
  Noticias, Registro de actividad) siguen ocultas para CEO — el gateo de
  esas 4 es 100% client-side para la UI, pero sus endpoints siguen
  `requireAdmin` puro, así que CEO no podría usarlos ni pegándole directo
  a la API.
- **Push notifications**, escopado final por tipo:
  `sendOnlineNotifications` → `'ceo'` solo; `sendConnectionAlert` →
  `['administrador', 'ceo']`; `sendNewsNotification` → todos salvo el
  autor (`null` + `excludeUsername`); `sbLogApiError` → `'administrador'`
  solo. `sendPushToRole` acepta un rol, un array de roles, o `null`
  (todos) — no pasar `null` para un tipo nuevo sin decidir a propósito si
  `modelo` debe recibirlo. Suscripciones son **por dispositivo**, no por
  cuenta — antes de asumir un bug de push, chequear
  `select username, role, endpoint from cb_push_subscriptions`. Si una
  tabla nueva necesita una columna `username` que puede ser admin/CEO o
  modelo, no agregarle FK a `cb_admins` — no hay FK limpia a dos tablas
  en Postgres; dejarla sin constraint y confiar a nivel de aplicación
  (mismo patrón que `author_username` en `cb_news_*`).

## Noticias

Cuarta pestaña, visible a los 3 roles. `administrador`/`ceo` publican
posts vía `POST /api/news/create`; cualquier rol logueado (incluida
`modelo`) puede responder en el hilo vía `POST /api/news/comment` —
deliberado, es un tablero de dos vías, no un broadcast puro. Solo
`administrador` borra un post o comentario. `GET /api/news` devuelve
posts con comentarios ya anidados.

- **Tipo de post**: `post_type` en `cb_news_posts` es `'hilo'`
  (comentarios permitidos, default) o `'aviso'` (sin comentarios,
  rechazado también server-side vía `sbFetchNewsPostType`). Elegido por
  admin/CEO al crear. **`administrador` puede cambiarlo después**
  (`POST /api/news/set-type`, CEO puede publicar pero no cambiar tipo) —
  el badge de color (rosa=aviso, gris=hilo) es un `<select>` funcional
  solo para `administrador`. Si un hilo con comentarios pasa a aviso, los
  comentarios existentes se ocultan en la UI pero no se borran de la
  base; solo se bloquean comentarios nuevos.
- **Read tracking**: `cb_news_reads` (`post_id, username, role,
  read_at`, unique en `(post_id, username)`) — cada `GET /api/news`
  marca como leído (`sbMarkNewsRead`, upsert). El `viewers` array
  (modelos que leyeron) solo viene si la sesión es `administrador`/`ceo`
  — filtrado server-side a `role = 'modelo'`; una `modelo` nunca ve quién
  más vio algo.
- **Nombre custom**: `cb_admins.display_name` — self-service, solo
  `administrador`, vía `POST /api/me/set-display-name`. Snapshotted en
  `author_display_name` al momento de escribir (no en render). Anónimo
  siempre gana: si `hide_name` está activo, renderiza "Anónimo" sin
  importar `display_name`. **Gotcha ya agarrado una vez:** `sbFindAdmin`
  y `sbListAdmins` tienen que mantenerse sincronizados en qué columnas
  seleccionan (ambos deben incluir `display_name`/`hide_name`), o los
  posts salen con `author_display_name: null` en silencio.
- Íconos de plataforma en la card de modelo: favicons hotlinkeados
  (`chaturbate.com/favicon.ico`, `stripchat.com/favicon.ico`) vía
  `platformIconHtml()`, con fallback `onerror` a badge de iniciales.
- Explícitamente v1: solo mensajes/hilos, sin encuestas — no agregar
  encuestas sin confirmar primero si el usuario todavía las quiere.

## Email backup para alertas críticas

Push-only tiene un hueco real: iOS puede dejar de entregar push a un
dispositivo en silencio sin avisarle al servidor (PWA no está en pantalla
de inicio, o notificaciones apagadas en Settings) — root cause no
arreglable desde este código, es comportamiento de plataforma.

**Fix:** las dos alertas que ameritan "despertate por esto" también salen
por email, independiente del estado de push de cualquier dispositivo —
`sendConnectionAlert` (tracker de una modelo cayó de verdad) y
`sbLogApiError` (API de Chaturbate/Stripchat rota o cambió de forma).
Las dos siguen pusheando igual; el email es redundancia pura.
`sendOnlineNotifications` y `sendNewsNotification` deliberadamente NO
tienen esto.

- `sendAlertEmail(subject, body)` en server.js, usa `nodemailer` con
  Gmail SMTP. Destino hardcodeado `ALERT_EMAIL_TO = 'menajeiner@gmail.com'`
  (no es secreto, es la dirección del usuario).
- Opcional, mismo patrón que VAPID/Stripchat: necesita `GMAIL_USER` +
  `GMAIL_APP_PASSWORD` (app password de Gmail, no la contraseña normal).
  Sin ambos, `EMAIL_ALERT_ENABLED` es false y el servidor arranca igual,
  sin este backup. Fire-and-forget, sin reintentos, nunca debe tirar ni
  bloquear al caller.
- **Chequear si `GMAIL_USER`/`GMAIL_APP_PASSWORD` ya están en el
  Environment tab de Render antes de asumir que esto está vivo** — al
  2026-09-04 no estaban seteados en ningún lado; el usuario pidió esto
  construido pero no había generado la app password todavía. Verificar
  el estado actual, no asumir ninguno de los dos.
- No confundir con los correos del vigía (más abajo) — esos salen desde
  el acceso Gmail MCP de la propia sesión de Claude Code, que solo existe
  mientras una sesión está activa/programada. Este mecanismo sale directo
  del proceso server.js corriendo en Render, sin depender de que una
  sesión de Claude esté viva.
- Si una tercera alerta gana estatus de "despertate por esto", cablearla
  igual: un `sendAlertEmail(...)` junto a su `sendPushToRole(...)`
  existente, fire-and-forget. No construir un switch genérico de
  "todo push también manda email" — eso saturaría la bandeja con cosas de
  bajo impacto (estado online, posts de noticias) que el usuario
  explícitamente no quiere que lo despierten.

## Ingresos de Chaturbate más allá de las propinas públicas

La Events API solo dispara `tip` de forma confiable para propinas
públicas en sala. Privados, spy shows y fan club joins casi nunca llegan
como evento; compras de contenido (`mediaPurchase`) sí llegan, con el
monto exacto en `object.media.tokens` (confirmado, no siempre fue así de
claro — ver `docs/historial.md` 2026-09-03/04 si hace falta el detalle).

**Descartado, no re-investigar sin evidencia nueva:**
- Login scripteado a chaturbate.com — verificado técnicamente bloqueado
  (Cloudflare bot challenge en el primer redirect de login, no solo "mala
  idea"). Tampoco hacerlo a Stripchat: aunque no está verificado
  bloqueado igual, es riesgo real de suspensión de una cuenta que genera
  plata real y no es nuestra para arriesgar — no construir scraping con
  login automatizado a ninguna de las dos plataformas, sea quien sea que
  lo pida.
- `tips_in_last_hour` de la Stats API — confirmado limitado a propinas
  solamente, no ayuda con el hueco de privados/spy.
- API de "estadísticas de afiliado" — no relacionado, es de referidos.
- CB Cam Insights (herramienta de terceros) — mismo alcance que nuestra
  Events API, no es una pista.

**Lo que sí funciona — tres fuentes que reconcilia
`resolveChaturbateTokens`** (la única función por la que pasa todo total
de Chaturbate, en `buildModelReports` y `/api/payslips`):

1. `cb_unhandled_events` (username, method, payload jsonb, created_at) —
   catch-all en el switch de eventos de `pollLoop`, fire-and-forget
   (diagnóstico, no dinero, nunca `sbWriteCritical` acá). Chequear
   periódicamente por si aparece un tipo de evento nuevo con tokens.
2. Backfill histórico por CSV (`cb_chaturbate_period_base`) — endpoint
   `/api/chaturbate-csv/upload` dormido (sin UI), fallback manual si hace
   falta rellenar una quincena vieja. Gotcha: el export de Chaturbate solo
   cubre ~30 días de detalle; un período que empieza antes de eso se
   salta (`saved: false`) en vez de guardarse a medias.
3. **Tracking automático en vivo** (`cb_models.stats_api_token`,
   `last_balance`/`last_balance_at`, `cb_balance_ticks`,
   `cb_balance_resets`) — el mecanismo real de largo plazo. Segunda API
   oficial de Chaturbate, autenticada por token (no login):
   `chaturbate.com/statsapi/?username=X&token=Y`. `token_balance` sube
   por CUALQUIER categoría de ingreso. Chaturbate vacía el balance a $0
   cada día (cashout automático) — una baja se loguea en
   `cb_balance_resets`, nunca se resta de lo ganado; una subida es un
   tick real en `cb_balance_ticks`.
   - Sondeo denso (`isNearChaturbateCashout`) sube a **60s** (no menos —
     ver `docs/historial.md` 2026-09-04 para el incidente de bloqueo que
     causó bajarlo de 20s) en la ventana 04:18–04:30 UTC
     (`CHATURBATE_CASHOUT_UTC_HOUR/MINUTE` = 4:30, en
     `chaturbate-lib.js`). Cooldown de 5 min ante 403/429
     (`BALANCE_RATE_LIMIT_COOLDOWN_MS`). **No subir la frecuencia para
     "no perderse el pico" — eso fue justo lo que causó perdérselo una
     vez.**
   - `pollChaturbateBalances` tiene guard de reentrancia
     (`balancePollRunning`) para no duplicar ticks si un ciclo lento se
     superpone con el siguiente.
   - Activado por modelo vía `POST /api/chaturbate-stats-token/set`
     (admin-only, Cuentas → "Automatizar Chaturbate por completo"),
     valida el token contra la API real antes de guardar. Las 6 modelos
     activas.
   - **Regla al leer `cb_balance_resets`.detected_at**: solo significa
     algo si hubo lecturas exitosas continuas antes — cruzar SIEMPRE
     contra `cb_api_errors` en esa franja antes de sacar una conclusión
     sobre a qué hora ocurrió realmente un cashout.

`resolveChaturbateTokens`: con fila base de CSV, total =
`base_tokens + max(ticks de balance después de covers_until, propinas
después de covers_until)` — el máximo, no ticks solo (si no, una modelo
sin `stats_api_token` activado queda congelada en la base del CSV para
siempre, porque su `cb_tips` sigue creciendo pero `cb_balance_ticks` no).
Sin fila base: `max(ticks total, tips + corrección manual)` — nunca
regresa por debajo de lo ya conocido.

**Limitación conocida, no arreglada:** el bucketing de fecha del CSV
(`parseChaturbateTransactionsCsv`) no convierte zona horaria desde el
reloj Pacific de Chaturbate — puede correr un puñado de tokens en la
medianoche entre dos quincenas. Efecto verificado despreciable, no tocar
salvo que se observe que importa.

**Fallback manual, ahora secundario:** card "Otros ingresos de
Chaturbate" — **eliminada de la UI** (funciones JS y card borradas de
`index.html`), pero endpoints (`/api/chaturbate-extra/*`) y tabla
`cb_chaturbate_extra_earnings` quedaron intactos, dormidos: siguen siendo
fallback de `resolveChaturbateTokens` para reconciliar quincenas
**históricas** de antes de 2026-09-03. No borrar la tabla sin confirmar
que ninguna quincena histórica depende todavía de esto.

**Stripchat, mismo patrón de reconciliación:** `totalTokensPeriod` de una
modelo = tips de Chaturbate + tokens de Stripchat de esa quincena, luego
el único 0.023 USD/token aplica al total combinado. Fuente primaria: la
Studio API oficial de Stripchat — `GET
https://stripchat.com/api/stats/v2/studios/username/{studioUsername}/models/username/{modelUsername}`,
header `API-Key: <key>`, `STRIPCHAT_API_KEY`/`STRIPCHAT_STUDIO_USERNAME`
(`Pleasure_09`) opcionales — sin ellos el servidor corre igual, solo sin
auto-sync. `pollStripchatEarnings()` cada `STRIPCHAT_POLL_INTERVAL_MS`
(10 min), upsert en `cb_stripchat_earnings`. Entrada manual (pegar texto,
`parseStripchatPaste()`) es fallback si la API key se rompe — **UI
eliminada** (endpoints `/api/stripchat/parse`/`/save` siguen intactos,
dormidos). `stripchat.com` y subdominios están hard-bloqueados para mis
herramientas de browsing (WebFetch, browser sandboxeado, Claude-in-
Chrome) — bloqueo de categoría de contenido, no de auth; pedirle al
usuario que capture/pegue directo cualquier cosa de ese dominio.

## Tests

`npm test` corre `node --test` (test runner nativo de Node, sin
dependencia nueva). Solo se testea la lógica pura de plata/fechas —
`chaturbate-lib.js` tiene TODA función pura del proyecto (sin `fetch`,
sin Supabase, sin estado de servidor): `getQuincena`/
`getQuincenaHistory`/`toDateStr`, `sanitizeUsername`, `hashPassword`/
`verifyPassword`, el parser de CSV de Chaturbate, `isNearChaturbateCashout`,
`resolveChaturbateTokens`, `isHttpStatusApiError`/`evaluateApiErrorBurst`,
`lateDebtCop`/`lateDebtCopCapped`, `isShiftClaimBlocked`,
`computeBroadcastSummary`/`classifyBroadcastColor`,
`studioInstantAfter`/`shiftDurationMinutes`. `server.js` requiere este
módulo en vez de redefinir estas funciones — no redefinir ninguna de
vuelta en `server.js`, y no agregar una función pura nueva ahí tampoco;
va en `chaturbate-lib.js` y se exporta para que quede testeable.
`server.js` en sí sigue sin cobertura de tests (necesita Supabase/
Chaturbate real) — verificación end-to-end vía instancia scratch en otro
puerto contra el Supabase real sigue siendo el método para todo lo que
toca la base o una API en vivo. Si tocás `resolveChaturbateTokens` o
cualquier función con tests, correr `npm test` antes de pushear, no solo
un chequeo manual.

## Vigía automático del sistema

Chequeo diario programado (Routine, `mcp__Claude_Code_Remote__create_trigger`,
corre a las 12:00 UTC contra esta sesión), silencioso salvo que encuentre
algo real. Cubre:

1. `cb_unhandled_events` — método nuevo que no sea userEnter/userLeave/
   follow/privateMessage/chatMessage/roomSubjectChange/unfollow/
   mediaPurchase.
2. `cb_api_errors` (source, message, created_at) — cada falla de
   `fetchChaturbateBalance`/`fetchStripchatModelEarnings` (HTTP no-ok,
   excepción, o cambio de forma en la respuesta) queda logueada ahí
   además de `console.error` — sin esto, un cambio de API silencioso solo
   se veía en logs de Render, que esta sesión no puede leer.
3. Balance de una modelo con `stats_api_token` activo sin actualizarse
   hace más de 2h — probable token revocado, necesita que regenere uno
   nuevo en `chaturbate.com/statsapi/authtoken/`.
4. Sync de Stripchat sin actualizarse en 24h — probable API key vencida o
   cambio de API.

**Patrón benigno conocido, no re-alertar por esto solo:** HTTP
403/429/500/503/504 aislado en `chaturbate_stats`, ~1 por hora, rotando
entre modelos, autorecuperado en la siguiente consulta, nunca las 6 a la
vez, nunca toca `last_balance_at`. Confirmado activo desde 2026-09-04 sin
escalar (detalle día a día en `docs/historial.md`). Por eso existe el
filtro de racha en `sbLogApiError`
(`isHttpStatusApiError`/`evaluateApiErrorBurst` en `chaturbate-lib.js`):
todo error se sigue escribiendo en `cb_api_errors` sin excepción (el
vigía ve el conteo completo), pero push+email solo disparan si (a) el
mensaje no tiene la forma `HTTP <código> para <modelo>` (eso avisa
siempre, es justo lo que agarra un cambio de forma de API), o (b) se
juntan `API_ERROR_BURST_THRESHOLD` (3+) dentro de `API_ERROR_BURST_WINDOW_MS`
(15 min) — eso sí es una racha real. Si un patrón nuevo escala (deja de
recuperarse solo, o pasa a las 6 modelos a la vez), esa sí es una alerta
real a reportar.

**El límite real, sin vuelta que darle:** cualquier diagnóstico que
requiera loguearse a algo (probar un token nuevo, ver una pantalla de
Chaturbate/Stripchat) sigue necesitando que el usuario genere la
credencial y la pase acá — el vigía puede *detectar* que algo se rompió y
decir *qué* modelo/plataforma, pero nunca puede *resolverlo* solo si la
causa es una credencial vencida. Intencional, no una limitación a
mejorar.

Trigger actual: `trig_01BXcfPNvAetGc9gcNcJUa7m` ("Vigía diario del
sistema"). Si hace falta agregar una señal nueva o cambiar el formato del
correo, `update_trigger` con el prompt completo (reemplaza el anterior
entero) — no crear un trigger nuevo por señal.

Dónde llegan los avisos: cuando el vigía encuentra algo real, además del
chat manda un correo por Gmail a `menajeiner@gmail.com` con formato fijo
— DÓNDE (archivo/función/tabla exacta), QUÉ PASÓ (para que un programador
o una futura sesión sin memoria lo resuelva sin investigar desde cero), y
CÓMO SE VE EN LA WEB (el síntoma visible, o decir explícitamente que
todavía no hay ninguno — no inventar uno). Si Gmail no está disponible,
avisa eso en el chat en vez de fallar en silencio, sin reintentar por su
cuenta.

## Diseño / UI — reglas vigentes (auditoría de accesibilidad y móvil)

- **Contraste**: `--muted-dim: #85858d` (~5.4:1 sobre `--bg`, ~4.7:1
  sobre `--surface-2`), `--muted: #9a9aa2`. Si tocás estos dos valores,
  verificá contra ambos fondos, no solo contra el más oscuro.
- **`.btn-primary`**: clase para acción principal de una card (rosa
  translúcido con borde). El blanco sólido (`#btnLogin`) es exclusivo del
  login — no uses ese estilo para nada más nuevo.
- **Toda pestaña necesita texto visible**, nunca solo ícono — en móvil no
  hay hover. `.tablabel`/`<span>` con el nombre siempre presente.
- **Cualquier `<select>` nuevo que deba verse como badge/pill** necesita
  `width:auto; display:inline-block;` explícito en su propio estilo
  inline — `index.html` tiene una regla global `input, select { width:
  100%; }` (línea ~156) que gana sobre cualquier estilo sin `width`
  explícito.
- `.time12 select` (pickers de hora en Extras): el grid del form es
  `minmax(185px,1fr)` — una columna en móvil, así entran los 3 selects
  sin cortarse.
- Filas de cuentas (`.admin-list-row`) apilan nombre-arriba/botones-abajo
  bajo 640px. Una columna de acciones con varios botones en una tabla
  angosta necesita su propio `min-width` (ver `.fix-actions`,
  `min-width: 200px`) o se aprieta al mínimo.
- `.banner-icon` (ícono decorativo de cada pestaña): en móvil
  `min(84px,34%)`, no más grande — empuja demasiado el contenido real
  hacia abajo si crece.
- **Tono de texto de cara al usuario: tuteo neutro, nada de voseo**
  ("vos"/"sos"/"podés"/etc.) — pedido explícito del usuario, aplica a
  cualquier copy nuevo (banners, ayudas, mensajes de error).
- **Falso positivo a no perseguir**: en una captura `fullPage` de
  Playwright, la barra de pestañas fija (`position:fixed`) aparece
  flotando encima del contenido — artefacto de cómo Chromium compone el
  `fixed` al capturar más allá del viewport, no un bug real. Confirmar
  con viewport normal antes de reportarlo.

## Asistencia — entrada/salida, justificaciones y excusas

Sexta pestaña, visible para los tres roles. Sustituye una tabla suelta
donde cada modelo anotaba su hora a mano.

**Flujo de entrada:**
1. La modelo pulsa "Reportar mi llegada" → fila `pendiente` en
   `cb_attendance_days` con `reported_at` = ese instante. Todavía no
   cuenta nada.
2. Solo `administrador` la valida (CEO es lectura). Tres salidas:
   - **"Sí llegó a esa hora"** (`source: 'reportada'`) — vale
     `reported_at`.
   - **"Llegó ahora"** (`source: 'ahora'`) — vale el instante de la
     validación (caso: reporte falso, llegó tarde pero reportó a horario).
   - **"Otra hora…"** (`source: 'manual'`) — admin escribe la hora real.
   - o Rechazar, con motivo.
   `reported_at` y `official_at` se guardan siempre las dos, para auditar
   la diferencia. Con esto, la demora del propio admin en validar nunca
   se le carga a la modelo como retraso suyo — no simplificar a un solo
   botón "vale desde que valido".
3. `late_minutes` = `official_at` − hora del turno, **ya con el margen de
   tolerancia aplicado** (ver confidencial abajo). Sin horario asignado
   en `cb_attendance_schedule`, no se calcula retraso (`null`, no 0).

**Turnos**: `ATTENDANCE_SHIFTS` en `chaturbate-lib.js` — Mañana
07:30–15:30, Tarde 16:00–00:00 (cruza medianoche, cubierto por
`pickWorkDate`). `POST /api/attendance/schedule` acepta `{username,
shift}` o `{username, entry_time, exit_time}` a medida.

### ⚠ CONFIDENCIAL — margen de tolerancia de entrada

`ATTENDANCE_GRACE_MINUTES = 12` en `chaturbate-lib.js`. Los primeros 12
minutos de cada turno no cuentan como retraso; pasado eso, el retraso
cuenta desde ahí. **No puede aparecer en ningún texto de la web** —
pedido explícito: si las modelos supieran del margen, llegarían tarde a
propósito esos 12 minutos. No en interfaz, ni mensajes de error, ni en
ninguna respuesta de API — solo el número ya ajustado viaja al navegador.
Límite honesto: una modelo que sepa su hora de turno y vea su propio
retraso puede deducir el margen restando. No hay forma de evitar eso del
todo; lo garantizado es que en ningún lado se lo decimos directamente.
`scheduled_at` y `official_at` quedan guardados crudos, así que el
retraso real siempre se recalcula si hace falta.

**Salida**: la anota ella y no se valida (decisión explícita).

**Edición manual de admin** (`POST /api/attendance/day/edit`, solo
`administrador`): CREA la fila si no existe (a diferencia de
`/api/attendance/day/reset`, que reabre una EXISTENTE) — cubre a una
modelo que nunca reportó ese día. **La hora que el admin ponga se ve
como si la modelo hubiera entrado/salido a esa hora — nunca como
"editado" ni "reportó otra cosa".** Guarda `official_source: 'reportada'`
y pisa `reported_at` con la misma hora que el admin puso, sin importar lo
que ella hubiera reportado antes; `exit_source` queda `null`, nunca
`'manual'`. Indistinguible de una entrada/salida normal en tabla y CSV.
**Cero notificaciones desde este endpoint** — pedido explícito, ni push
ni el aviso de "todas entraron a tiempo". El registro en `cb_audit_log`
(interno, nunca visible en UI) se mantiene intacto — es trazabilidad
para el propio admin, no lo que se pidió esconder.
`studioInstantAfter(workDate, timeStr, referenceTime)` decide si una hora
de salida escrita a mano cae al día siguiente (turno tarde cruza
medianoche).

**Salida automática tras 1h sin marcar**: `checkAutoExits()` cada 5 min,
gateado por `!UI_ONLY` (nunca sacarlo de ese gate — un scratch de prueba
con pollers prendidos escribiría salidas automáticas sobre datos reales).
Revisa jornadas `validada` de los últimos 3 días sin `exit_at`; el fin de
turno se calcula desde `official_at` (la entrada REAL) + duración del
turno (`shiftDurationMinutes`, maneja cruce de medianoche). Pasada 1h de
ese fin, marca `exit_at` = fin de turno (no el instante de detección) y
`exit_source: 'auto'`, avisa a administrador/ceo por push.

**Zona horaria**: todo Asistencia usa offset fijo UTC-5
(`STUDIO_UTC_OFFSET_HOURS` — Colombia no tiene horario de verano, así que
es exacto). Nunca usar `toDateStr`/hora del servidor para asistencia.
`pickWorkDate` compara contra el horario de hoy Y el de ayer, se queda
con el más cercano — sin esto, llegar 00:30 a un turno de 8pm contaba
como "19h temprano" del día siguiente en vez de "4h30 tarde" del turno de
anoche.

**Privacidad**: filtrado server-side en `buildAttendancePayload` — una
`modelo` solo recibe sus propias filas, sin los campos de staff
(`pending`, `models`). `GET /api/attendance/excuse?id=N` valida dueño —
otra modelo abriendo la excusa de alguien más recibe 403.

**Notificaciones** (administrador + ceo, salvo la primera): llegada
reportada pendiente de validar; al validar, mensaje con minutos de
retraso/temprano/justo; excusa médica subida; y si al validar ya entraron
todas las que tienen horario y ninguna llegó tarde, "TODAS TUS MODELOS
ENTRARON A TIEMPO" una sola vez por día
(`cb_attendance_daily_notice`, fecha como primary key).

**Deuda por retrasos y seguridad social:**
- **$10.000 COP por cada HORA COMPLETA** de retraso acumulado en la
  quincena, por hora alcanzada, no proporcional (59 min no deben nada, 60
  deben una hora entera — `lateDebtCop`/`lateDebtCopCapped` en
  `chaturbate-lib.js`).
- Pasadas **6 horas (360 min)** acumuladas, la modelo asume su propia
  seguridad social esa quincena — **solo si `social_security_enabled`
  está en `true`** (`cb_attendance_settings`, default `true` en la fila
  real de Placer Studios, default `false` en `schema.sql` para un cliente
  nuevo — concepto laboral colombiano específico, no algo que deba salir
  por defecto en código de venta). Con el flag apagado,
  `owes_social_security` es siempre `false` y ni el banner ni el pill de
  "debe seguridad social" aparecen en ningún lado del frontend — toda la
  lógica de ocultamiento vive en el servidor.
- **Tope de la deuda en plata**, atado al mismo flag: con
  `social_security_enabled: true`, `debt_cop` = `lateDebtCopCapped(...)`
  — pasado el umbral, la deuda en plata pasa a `$0` en vez de seguir
  subiendo (con $10.000/h, el tope natural bajo el umbral ya son 5 horas
  = $50.000). `debt_hours` (las horas reales) NUNCA tiene tope, solo el
  cobro en COP se detiene. Con el flag en `false` (código de venta), la
  multa crece sin tope — pedido explícito del usuario, el tope siempre
  estuvo atado al mismo concepto que el aviso de seguridad social.
- Los dos valores (umbral, tarifa) son configurables desde Asistencia →
  Horarios y umbral (`cb_attendance_settings`), pasados como parámetro a
  `lateDebtCopCapped`, no fijos en la función. Endpoint
  `/api/attendance/settings` sigue `requireAdmin` puro (NO `ceo`).
- La deuda NO se resta automáticamente del desprendible por tokens — se
  muestra como su propio total, la UI dice que se descuenta al pagar.
  Cambiar eso a descuento automático es decisión de plata que el usuario
  no ha pedido.
- Llegar temprano no compensa retrasos de otros días (`sumLateMinutes`
  solo suma los positivos).
- La deuda se muestra como un número solo ("Total a pagar por retraso" +
  debajo en chico "N h × $10.000 COP por hora"), sin párrafo explicativo.
  Una modelo ve solo su propio total; la lista comparativa de quién debe
  qué es solo para administración.

**Correcciones del administrador** (solo `administrador`, CEO ve pero no
corrige):
- `POST /api/attendance/justification/delete` `{id}` — baja un
  justificante.
- `POST /api/attendance/day/reset` `{id, mode}` — `'revalidar'` deja la
  jornada pendiente de nuevo, borra hora válida/salida/retraso y vuelve a
  leer el turno vigente; `'borrar'` la elimina. Las dos guardan en
  `cb_audit_log` lo que había antes — no quitarle `sbLogAudit`, son las
  únicas acciones de asistencia que destruyen datos sin deshacer.

**Excusas médicas**: archivo en base64 dentro de
`cb_attendance_excuses` (tope 2.5 MB, solo JPG/PNG/WEBP/PDF, validado
server-side).

**Extras/recuperaciones — cumplimiento** (`cb_shifts`): `kind` (`'extra'`
| `'recuperacion'`) y `attendance_status` (`'pendiente'`|`'cumplio'`|
`'no_cumplio'`, marcado por admin/CEO con ✓/✗ sobre la pastilla). A la
3ra vez que una modelo se apunta y queda `no_cumplio` **en la quincena
actual**, `/api/shifts/claim` la rechaza (403) hasta la próxima quincena
o hasta que admin/CEO le otorgue permiso puntual (`POST
/api/shifts/override`, tabla `cb_shift_overrides`, clave `username +
period_start` — expira solo al cambiar de quincena, sin cron). Esto es
puramente cumplimiento sí/no, no lo conectes al cálculo de deuda ni de
pago.

**Confirmación de extra/recuperación 6h antes**: `checkShiftConfirmations()`
cada 10 min (mismo gate `!UI_ONLY`) — a una reclamada que empieza en las
próximas 6h y no tiene `confirmation_sent_at`, le manda push a la MODELO
puntual (`sendPushToUser`) preguntando si la va a tomar. `POST
/api/shifts/confirm`: `confirm:false` llama `sbUnclaimShift` (que también
resetea `confirmation_sent_at`/`confirmed` — si no, la siguiente modelo
que reclame heredaría el estado de confirmación de la anterior). `POST
/api/shifts/send-confirmation` (admin/CEO): igual pero a cualquier hora,
siempre vuelve a preguntar.

**Horas transmitidas, con color** (columna "Transmitido" en
`index.html` y `asistencia.html` — tocar las dos si esto cambia):
`computeBroadcastSummary(events, windowStartMs, windowEndMs)` reconstruye
segmentos start/stop de `cb_broadcast_events` recortados a la ventana del
turno, devuelve `onlineMinutes` + `maxGapMinutes` (hueco más grande ENTRE
segmentos, no antes del primer start ni después del último stop — eso es
tema de retraso de entrada/salida, no de reconexión).
`classifyBroadcastColor`: **rosa** si tuvo extra/recuperación reclamada
ese `work_date` (gana sobre cualquier otro criterio), **gris apagado** si
transmitió el turno completo, **rojo** si transmitió menos Y tuvo un
hueco de 30+ min (`BROADCAST_GAP_ALERT_MINUTES`). Un solo fetch de
`cb_broadcast_events` para toda la quincena y todas las modelos por
request, no uno por día por modelo. La ventana de un turno en curso se
recorta a `now`.

**Panel de retraso/motivación para la modelo** (`#attRetrasoPanel`,
`index.html`, visible a los 3 roles): `late_minutes > 0` → banner rojo
"LLEVAS N DE RETRASO"; `late_minutes <= 0` → banner verde "VAS AL DÍA"
con frase motivacional al azar de `ATT_GOOD_PHRASES` (distinto de
`BANNER_PHRASES`, que rota bajo el ícono de cada una de las 6 pestañas,
propósito general no ligado a horario). Sin horario asignado, el panel no
se muestra. `BANNER_PHRASES`: rotación cada 5s, fuente `--font-display`
itálica 10.5px, color `var(--text)` (blanco), tuteo neutro, animación
fade+slide 0.45s `cubic-bezier(.2,.8,.3,1)`, timer de fade guardado en
`el._phraseFadeTimer` por elemento (evita que dos ticks superpuestos
escriban sin orden sobre el mismo nodo).

**Descarga**: cada fila del resumen admin/CEO tiene "Ver su hoja" →
`/asistencia.html?modelo=<username>` (solo si esa modelo existe en la
lista). `asistencia.html` trae "Descargar CSV" (respeta el filtro
activo, incluye sección de deuda calculada) y es la hoja completa como
página independiente — usa la misma cookie de sesión, repite tokens de
color/fuente de `index.html` a propósito (tiene que abrirse/imprimirse
sola, `@media print`) — **si cambian los colores de marca, cambiarlos en
los dos archivos**.

**`SOLO_UI=1`** en server.js: levanta el servidor sin ningún sondeo
externo, para probar la interfaz desde una instancia suelta en otro
puerto sin duplicar tráfico a Chaturbate. Nunca en producción — sin
sondeos no se registra ni una propina.

## Endpoints dormidos a propósito (no son cruft, no borrar sin confirmar)

- `/api/stripchat/parse`, `/api/stripchat/save` — fallback si
  `STRIPCHAT_API_KEY` se rompe.
- `/api/chaturbate-csv/upload` — fallback de backfill histórico.
- `/api/chaturbate-extra/periods|current|save` + tabla
  `cb_chaturbate_extra_earnings` — fallback de reconciliación para
  quincenas históricas de antes del tracking en vivo.

Ninguno tiene UI ni caller en frontend; todos siguen funcionando si se
llaman directo (curl / script). Confirmado (auditoría 2026-09-09) que no
hay funciones huérfanas en `server.js` aparte de estas tres, ni archivos
sueltos en `public/`.

## How this user likes to work

No técnico, se mueve rápido, no le gusta el ida-y-vuelta largo ni que le
pidan probar cosas él mismo. **Probar cada cambio end-to-end vos mismo**
(instancia scratch en otro puerto vía `SOLO_UI=1`, curl y/o Playwright,
contra el Supabase real — cuentas `qa_temp_*` creadas y borradas en la
misma sesión, nunca una cuenta real "porque total no pasa nada") antes de
decir que algo funciona o pedirle que lo revise. Para bugs visuales sin
captura, levantar Playwright contra una instancia real (ver nota de
Playwright en la sección de Diseño/UI arriba) en vez de adivinar a ciegas
o pedirle que describa el problema con más detalle. Mantené cualquier
justificación de ingeniería ("hicimos X porque la API de Chaturbate no
soporta Y") fuera del copy de la propia UI del producto — esa razón va
en el chat, nunca en pantalla.
