# HISTORIAL — PLACER SERVICES

Este archivo guarda la crónica detallada de bugs ya resueltos, investigaciones
día a día y diagnósticos pasados que `CLAUDE.md` resumió o movió aquí para no
cargar tokens de más en cada sesión (`CLAUDE.md` se inyecta entero en cada
turno; este archivo no — se lee con la herramienta Read solo cuando hace
falta el detalle puntual de algo). Es un registro histórico, no una fuente de
reglas vigentes — para eso está `CLAUDE.md`. Si algo de acá contradice el
código actual o `CLAUDE.md`, gana el código, igual que ya advierte
`CLAUDE.md` sobre sí mismo.

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

## Dos bugs de Asistencia reportados con captura real (2026-09-10)

El usuario mandó una captura de `asistencia.html` preguntando por qué el
"25 min" de horas transmitidas de `tamar4_f00x` salía en rosa, y aparte
reportó que modelos que llegan justo a su hora (ej. las 4:00 en punto)
quedaban marcadas con 1 minuto de retraso — pidió corregir el mismo
problema para las de la mañana también.

**Bug 1 — retraso redondeado hacia arriba/abajo por segundos, no minutos
completos.** `computeLateMinutes` usaba `Math.round`. Caso real encontrado
en `cb_attendance_days`: `conni_f00x` (turno tarde) llegó 46.977 segundos
después de su hora — `Math.round(46.977/60) = 1`, quedó guardada con "1
minuto de retraso" cuando en la práctica llegó puntual. Mismo problema al
revés con `tamar4_f00x` (turno mañana): llegó 33.141 segundos ANTES de su
hora y quedó en "-1" en vez de 0. **Cambiado a `Math.trunc`**: solo cuenta
minutos COMPLETOS transcurridos, en cualquiera de los dos sentidos —
consistente con cómo ya se cobra la deuda (por hora ALCANZADA, no
redondeada, ver `lateDebtHours`). `Math.trunc` de un valor negativo entre
-1 y 0 da `-0`; se normalizó con `|| 0` para que nunca se vea ni se compare
un cero negativo. Como `late_minutes` se calcula una vez y se guarda (mismo
problema que la sección anterior), se corrigieron con SQL directo las 18
filas ya validadas: `update cb_attendance_days set late_minutes =
trunc(extract(epoch from (official_at - scheduled_at))/60)::int where
scheduled_at is not null and official_at is not null;` — `conni_f00x`
2026-09-08 pasó de 1 a 0, `tamar4_f00x` 2026-09-08 pasó de -1 a 0, y de
paso varios otros valores bajaron 1 minuto por el mismo cambio de redondeo
a truncado (ej. kitty_f00x 13→12) — no son casos sueltos, es el mismo fix
aplicado parejo a todos los valores, no solo a los que rozan el minuto
exacto.

**Bug 2 — el rosa de "horas transmitidas" se decidía solo por FECHA, no por
HORARIO.** `hadExtra` (en `classifyBroadcastColor`) se armaba con un
`Set` de `username|fecha` sacado de `cb_shifts` — cualquier extra o
recuperación reclamada ESE DÍA pintaba de rosa (sin juzgar) la fila
completa, sin importar a qué hora era esa extra. Caso real: `tamar4_f00x`
tenía una recuperación reclamada para el 2026-09-10 de 16:00 a 20:00
(turno tarde) — su turno normal de MAÑANA (07:30-15:30) del mismo día
salía en rosa por esa recuperación, aunque son bloques de horario que no
se tocan para nada. Fix: nueva función pura `intervalsOverlap(aStart,
aEnd, bStart, bEnd)` en `chaturbate-lib.js` (con tests, incluyendo el caso
real de tamar4_f00x reproducido exacto); `server.js` ahora guarda el rango
real (`start_time`/`end_time` convertidos a ms) de cada extra/recuperación
reclamada por `username|fecha`, y `hadExtra` exige que ese rango se
solape con la ventana del turno que se está clasificando — mismo día ya
no alcanza, tiene que ser el mismo bloque de horas. Verificado en vivo
(`SOLO_UI=1`, puerto 3014, cuenta `qa_temp_bcheck`, borrada al terminar):
antes del fix el turno de mañana de tamar4_f00x del 2026-09-10 daba
`broadcast_color: "rosa"`, después del fix da `null` (se juzga con el
criterio normal, que es lo correcto ya que a esa hora su recuperación de
tarde ni siquiera había empezado).

`npm test`: 107/107. No hizo falta migrar datos para el bug 2 —
`broadcast_color` se calcula en cada lectura de `/api/attendance`, nunca
se guarda, así que el fix aplica solo con el redeploy.

## Bug real de dinero: Modelos y Desprendibles mostraban tokens distintos para la misma quincena (2026-09-11)

El usuario mandó dos capturas de `amaranta_f00x` (misma quincena, ~1 minuto
de diferencia): Modelos mostraba 19.773 tokens (CB 8.434 + SC 11.339) y
Desprendibles mostraba 25.203 (CB 11.903 + SC ~13.3xx) — **inconsistencia
interna real entre dos pantallas de la propia app**, no una comparación
contra el dashboard de Chaturbate. Investigado y confirmado con datos reales
de Supabase (no solo lectura de código): Modelos SIEMPRE quedaba corto
frente al total real, y el corto se agrava a medida que avanza la quincena.

**Causa raíz: PostgREST tapa cada respuesta a 1000 filas por defecto, en
silencio (200/206, sin ningún error) — confirmado pidiendo directamente
`Range: 0-99999` a la API real de este proyecto Supabase y recibiendo de
vuelta solo 1000 filas (`content-range: 0-999/4767`).** `buildModelReports()`
(pestaña Modelos, `/api/models`) trae los tips y los balance-ticks de **TODAS
las modelos de toda la quincena en una sola consulta sin username**
(`sbFetchTipsInRange`, `sbFetchBalanceTicksInRange`) — con 7 modelos activas
eso ya suma miles de filas por quincena (4.767 tips solo en lo que va de la
quincena actual al momento de este fix), muy por encima de 1000. El corte
cae, por orden de inserción, en algún punto temprano de la quincena (para
este caso, ~el 4 de septiembre a las 00:28) — así que `buildModelReports()`
solo estaba viendo los primeros días de cada quincena y arrastrando eso como
si fuera el total completo, cada vez más corto cuanto más avanza el periodo.
`/api/payslips` (Desprendibles), en cambio, consulta por-usuario
(`sbFetchUserTipsSince`/`sbFetchUserBalanceTicksSince`, acotadas por
`username=eq.`), así que en la práctica se mantenía casi siempre bajo las
1000 filas y mostraba el número correcto — **Desprendibles no estaba "mal",
Modelos era el que estaba corto**; el "25.203 más alto que 19.773" que vio
el usuario es justo lo que se espera si Modelos pierde datos: subestima,
nunca sobreestima.

**Verificado con los cinco pasos, no solo leyendo el código:**
1. Se sacó a mano el total real de tips/ticks de amaranta para la quincena
   actual directo de Supabase vía SQL — sin ningún límite de fila (la
   consulta SQL directa no pasa por PostgREST, así que no sufre el mismo
   tope).
2. Se replicó a mano la fórmula de `resolveChaturbateTokens` con esos
   números completos: `770 (base) + max(9029 ticks después de covers_until,
   3321 tips después de covers_until) = 9799` tokens de Chaturbate.
3. Se golpeó la API real de Supabase directo (no vía server.js) con
   `Range: 0-99999` para la consulta multi-modelo de `sbFetchTipsInRange` y
   se confirmó que SÍ vuelve truncada a 1000 filas pese a pedir más — el
   límite es del lado del servidor PostgREST, no algo que el cliente pueda
   evitar sin paginar.
4. Se confirmó que pedir explícitamente páginas siguientes
   (`Range: 1000-1999`, etc.) SÍ funciona y trae el resto — la paginación
   por header `Range` es la solución real, no un límite duro sin salida.
5. Antes y después del fix se comparó `/api/models` contra
   `/api/payslips?username=X` para las 7 modelos, en una instancia
   `SOLO_UI=1` contra el Supabase real: antes, Desprendibles ganaba a
   Modelos en las 7; después del fix, los dos endpoints devuelven
   exactamente los mismos números en las 7 (ej. amaranta_f00x: ambos dan
   CB 9799 / SC 11339 / total 21138).

**El fix:** `sbFetchAllRows(table, qs)` (nuevo, junto a `SB_HEADERS` en
`server.js`) pagina con el header `Range` (1000 filas por página) hasta
traer todo, en vez de una sola consulta sin límite. Aplicado a las cinco
consultas que traen datos de más de una modelo a la vez y que por eso
pueden superar 1000 filas: `sbFetchTipsInRange`, `sbFetchUserTipsSince`,
`sbFetchBalanceTicksInRange`, `sbFetchUserBalanceTicksSince` (estas dos
"Since" son por-usuario, pero de todos modos pueden acumular miles de filas
a lo largo de las 6 quincenas que consulta Desprendibles — hoy no se nota
para ninguna modelo porque el balance-ticks manda sobre tips en el max(),
pero es el mismo bug en potencia) y `sbListBroadcastEventsRange` (usada por
`buildAttendancePayload` para "horas transmitidas" — mismo patrón
multi-modelo-sin-limite, no dinero pero sí un dato que se muestra). Se le
agregó `order=id.asc` (o `,id.asc` como desempate donde ya ordenaba por
fecha) a las cinco, porque paginar con `Range` sin un orden explícito y
estable no garantiza páginas consistentes entre pedidos sucesivos según la
propia documentación de PostgREST. Las consultas de un solo valor por
modelo por quincena (`sbFetchStripchatEarningsForPeriod`,
`sbFetchChaturbateExtraEarningsForPeriod`, `sbFetchPeriodBaseForPeriod` y
sus pares `...ForUserSince`) NO se tocaron — nunca se acercan a 1000 filas
por diseño (una fila por modelo por periodo), así que no tenían este riesgo.

**No hizo falta migrar ningún dato.** A diferencia de otros bugs de este
archivo (retrasos, tolerancia), acá nada se guarda mal en la base — el
número corto se calculaba al vuelo en cada `GET /api/models` y nunca se
persistía, así que el fix aplica solo con el redeploy, sin ningún `update`
de por medio. Tampoco afectó nunca ningún pago ya hecho: `/api/payslips`
(el que realmente alimenta el desprendible que se paga) siempre tuvo el
número correcto para las quincenas que se han pagado hasta ahora — el
riesgo real era que alguien mirara la pestaña Modelos y AHÍ SÍ tomara una
decisión de pago con el número corto, o que el "Desprendible del estudio"
del resumen (que también sale de `buildModelReports`) se viera más bajo de
lo real.

**Si esto se repite en cualquier otra tabla `cb_*` a futuro:** el síntoma es
siempre el mismo — un total que se queda corto y que empeora con el tiempo
o con más modelos/eventos, nunca un valor al azar ni un error visible.
Antes de sospechar de la lógica de negocio, preguntar primero: ¿esta
consulta trae filas de MÁS DE UNA modela a la vez, sin filtrar por
`username`, para un rango que puede acumular volumen (toda una quincena,
todo el historial)? Si la respuesta es sí, es candidata a este mismo bug —
usar `sbFetchAllRows` en vez de un `fetch` simple.

## Archivo movido desde CLAUDE.md (2026-11-26)

Secciones datadas de CLAUDE.md, copiadas literalmente. Las reglas vigentes de estas secciones están resumidas en CLAUDE.md, sección "Reglas vigentes".

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

## Copias de seguridad de Supabase — decisión del usuario: NO por ahora (2026-09-16)

Confirmado con `get_organization` (MCP de Supabase): el proyecto real
(`STUDIO`, org `aloxugskfwhhpnplondm`) está en el **plan gratuito** — sin
copias de seguridad automáticas. Se le preguntó directo al usuario (subir a
Pro ~US$25/mes con backups diarios, dejarlo así por ahora, o pensarlo).
**Respuesta explícita, misma fecha: "Elimina [esto de la lista de
pendientes]. No lo haré o no lo haré hasta que realmente lo necesite. No
quiero indicaciones de ello de momento."**

Esto NO es un riesgo que quedó sin resolver por descuido — es una decisión
tomada. **No lo vuelvas a sacar en ninguna lista de pendientes, auditoría,
resumen de "qué falta", ni lo menciones proactivamente en ningún chat
futuro.** El usuario ya conoce el riesgo (sin plan pago, un borrado
accidental o un incidente de Supabase no tiene forma de recuperarse) y
decidió asumirlo por ahora. Si algún día quiere retomarlo, lo va a pedir
él mismo — hasta entonces, silencio total sobre este tema, incluida
cualquier auditoría nueva que se le proponga a futuro (no listarlo ahí
tampoco).

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

## BUG REAL DE PLATA: la quincena cambiaba hasta 5 horas antes de tiempo (2026-09-16)

Encontrado en vivo, no en una auditoría: el usuario notó que "Modelos" y el
"Resumen del estudio" mostraban los totales de la quincena en 0 y avisó
("Para seguir con lo previsto. Arregla los numeros de cada modelo y estudio
a como estaban. Se ha perdido información en el cambio"). Diagnóstico
verificado contra el Supabase real (no supuesto): eran las 00:37 UTC del
2026-09-16, y `getQuincena` (`chaturbate-lib.js`) ya daba por iniciada la
quincena "16-30" — pero en hora de Colombia todavía eran las 7:37 p.m. del
día 15.

**Causa raíz**: `getQuincena`/`toDateStr` calculaban el día/mes/año con
`new Date(now).getFullYear()/getMonth()/getDate()` — getters que devuelven
la fecha según la ZONA HORARIA DEL PROCESO DE NODE, no la de Colombia. En
Render (y en cualquier contenedor sin `TZ` seteado, confirmado con
`Intl.DateTimeFormat().resolvedOptions().timeZone` → `UTC`) esa zona es UTC.
Asistencia ya tenía este mismo problema resuelto desde antes
(`STUDIO_UTC_OFFSET_HOURS`/`studioDateStr`, sección "Asistencia" más arriba)
— pero `getQuincena`, el que maneja la PLATA, nunca se corrigió con el mismo
mecanismo. Nadie lo notó hasta ahora porque el síntoma solo se ve unos
minutos/horas alrededor de cada corte de quincena (dos veces al mes).

**Corregido en dos pasadas la misma sesión:**

1. Primera pasada: `getQuincena` pasó a leer el día en hora de Colombia
   (`studioDateStr`) en vez de la del servidor — mismo patrón que
   Asistencia. Esto ya arreglaba el caso reportado.
2. El usuario corrigió el corte exacto en el mismo hilo: **"la quincena
   acaba 11:30 hora colombia"** — no medianoche. 11:30 p.m. Colombia = 04:30
   UTC = el mismo instante en que Chaturbate vacía automáticamente el
   balance de cada modelo (`CHATURBATE_CASHOUT_UTC_HOUR`/`MINUTE`, ya usado
   para el sondeo denso antes del retiro — ver la sección de
   automatización). Segunda pasada: se agregó `PAYROLL_DAY_OFFSET_HOURS`
   (-4.5, en vez de los -5 de Colombia a secas) y
   `payrollDateStr`/`payrollWallToMs` (mismo mecanismo de siempre: offset
   fijo + getters UTC sobre el instante desplazado), y `getQuincena` corta
   la quincena ahí: el día 15 termina y el 16 arranca exactamente a las
   23:30 Colombia, no a medianoche. `toDateStr` es ahora un alias de
   `payrollDateStr` (no de `studioDateStr`) — necesario porque, con este
   corte, el instante real de "inicio" de la quincena 1-15 de un mes es
   literalmente "31 a las 23:30" del mes anterior, y las columnas `date` de
   `cb_chaturbate_period_base`/`cb_stripchat_earnings` necesitan seguir
   etiquetadas "01", no "31".
   **`fmtStripchatDateTime`** (server.js, arma el `periodStart`/`periodEnd`
   que se le manda a la Studio API de Stripchat) tenía el mismo bug de fondo
   (hora del servidor, no de Colombia) y se corrigió aparte — usa
   `studioDateStr` (la fecha LITERAL del instante, no la etiqueta de
   nómina), porque a Stripchat hay que mandarle el instante real, no cómo
   decidimos etiquetarlo internamente.
   **Ojo si se vuelve a tocar esto**: `toDateStr` (dinero, corte 23:30) y
   `studioDateStr` (asistencia, corte medianoche) YA NO SON EQUIVALENTES a
   propósito — dan una fecha distinta para cualquier instante entre las
   23:30 y la medianoche Colombia. Asistencia sigue con medianoche sin
   tocar: el ciclo de retiro de Chaturbate no tiene nada que ver con la
   hora de entrada/salida de una modelo.

**Impacto real confirmado con SQL directo contra la base de producción**
(no fue un cálculo teórico): comparando `cb_tips` con el corte viejo
(medianoche UTC, el bug) contra el corte correcto (23:30 Colombia), la
quincena 1-15 de septiembre 2026 en curso tenía **pinky_f00x subvaluada en
479 tokens** y jax_f00x en 60 — tokens que el bug ya había reasignado a la
quincena siguiente, la que arranca hoy. Ningún dato se perdió en la base
(`cb_tips` nunca se tocó) — el bug estaba solo en qué rango de fechas se
consultaba para sumar cada quincena, así que se corrige solo con el
despliegue, sin migración.

**Tests**: se reescribieron los de `getQuincena`/`toDateStr` que
construían su "now" con `new Date(y,m,d)` (constructor LOCAL — exactamente
el antipatrón de este bug, así que sin darse cuenta probaban el
comportamiento viejo) para usar `studioWallToMs`/`payrollWallToMs` en su
lugar, más una regresión exacta del caso real (00:37 UTC del 16 = 7:37 p.m.
Colombia del 15) y del corte exacto de las 23:30. `npm test`: 113/113.
Verificado también con un script Node aparte contra la hora real del
momento y con SQL directo contra Supabase (arriba). Misma limitación que
el resto de esta sesión: sin `env.bat`/credenciales de producción en este
contenedor remoto, no se pudo levantar una instancia `SOLO_UI=1` real y
pegarle con curl — la verificación fue con los tests, un script aparte
llamando a las funciones puras directamente, y SQL contra el Supabase real.

## Reorganizar Asistencia — separar "Hoy" de "Configuración" (2026-09-16)

Siguiente ítem de la lista pendiente de la auditoría (hallazgo "Mejoras #01":
la pestaña Asistencia mezclaba uso diario con configuración en un solo
scroll eterno). Dentro de `attStaffArea` (la vista de `administrador`/`ceo`
— la vista de `modelo`, `attModelArea`, no tenía este problema y no se
tocó) se agregó un sub-nav de dos botones (`.att-subnav`/`.att-subnav-btn`,
`id="attSubnav"`, `sticky top:0` para que no se pierda al hacer scroll en
una lista larga — recordar: **la app es primordialmente de celular**, así
que los dos botones son grandes, con texto siempre visible, nunca
solo-ícono, mismo criterio que el resto de la barra de pestañas):

- **"Hoy"** (`#attSubHoy`, activo por defecto): Llegadas por validar,
  Resumen de la quincena, Hojas de todas las modelos, Excusas médicas,
  Justificaciones — todo lo que se usa día a día.
- **"Configuración"** (`#attSubConfig`, oculto por defecto): Horarios y
  umbral (`attConfigCard`, admin-only) y Mensaje de seguridad social por
  modelo (`attOwesMsgCard`, admin+ceo) — lo que se toca una vez cada tanto.

No se creó una pestaña nueva en la barra principal (la auditoría sugería
explícitamente evitar eso) — es un sub-menú dentro de la pestaña
Asistencia que solo alterna `display` vía CSS, sin re-pedir datos al
servidor. El gateo de permisos por rol dentro de cada card
(`attConfigCard`/`attOwesMsgCard` en `renderAttendanceStaff()`) no cambió
— sigue decidiendo qué card se ve; el sub-nav solo decide qué SECCIÓN
(Hoy/Configuración) está visible. El listener de los botones del sub-nav
vive junto a los demás listeners estáticos de Asistencia (son botones
fijos en el HTML, no se regeneran en cada refresh de 4s — agregarlo
dentro de `renderAttendanceStaff()` habría duplicado el handler en cada
poll).

**Sobre el otro hallazgo relacionado ("Mejoras #02", tarjetas y tabla
mostrando "lo mismo" dos veces):** revisado el código — no hay duplicación
real que corregir. Las tarjetas de "Resumen de la quincena" (`attTotalsList`)
muestran el retraso ACUMULADO de la quincena + la deuda; la tabla de
"Hojas de todas las modelos" (`attStaffTable`) muestra el retraso DÍA POR
DÍA junto con entrada/salida/transmitido/justificante — son dos niveles de
detalle distintos (resumen vs. detalle diario), exactamente la separación
que la propia auditoría recomendaba como solución. No se tocó nada ahí.

**Verificación de esta sesión — misma limitación ya documentada arriba
(sin `env.bat`/credenciales de producción en este contenedor remoto):**
no se pudo levantar `SOLO_UI=1` contra el Supabase real. Se verificó en
cambio con Chromium (Playwright) sirviendo `public/index.html` desde un
servidor estático local y con todas las llamadas a `/api/*` interceptadas
y respondidas con datos de prueba inventados (nunca datos reales) — se
confirmó en viewport de celular (390×844) que: el sub-nav aparece debajo
del banner de Asistencia, "Hoy" muestra las 5 cards de uso diario con
"Configuración" oculta, tocar "Configuración" oculta "Hoy" y muestra
exactamente lo que corresponde a cada rol (administrador: Horarios+umbral
y Mensaje de seguridad social; CEO: solo Mensaje de seguridad social, sin
Horarios+umbral), y volver a "Hoy" restaura el estado original sin dejar
nada residual. `node -c` sobre el `<script>` inline extraído confirmó que
no se rompió la sintaxis JS. `npm test`: 113/113 (sin tests nuevos — es un
cambio de UI, `chaturbate-lib.js` no se tocó). **Falta por probar de
verdad** la próxima vez que haya sesión con credenciales completas: el
flujo real contra el Supabase de producción con las 6 modelos reales.

Queda pendiente de la auditoría, en orden: el resto de "Mejoras" (algunas
ya resueltas en sesiones previas — ver más arriba), y al final lo más
difícil: cerrar el RLS abierto de Supabase (hallazgo crítico #01, sigue
sin tocar — requiere migrar a `service_role` o escribir políticas por
tabla, alto riesgo de romper el sistema si se hace mal).

## Cuarta vuelta de la frontera de quincena: revertida la extensión a las 2 a.m. (2026-09-22)

La tercera vuelta (2026-09-16, ver arriba) había estirado la frontera ENTRE
dos quincenas hasta las 2:00 a.m. Colombia para no cortar el turno de una
modelo a mitad de camino. **El usuario la revirtió explícitamente**: "el
problema es cuando la modelo trasnocha se mezclan quincenas... no quiero
que cierre después de las 12 y 11:30 como dije" — Stripchat cierra su
propio día a las 12 (medianoche Colombia) y Chaturbate a las 11:30 p.m.
(23:30 Colombia, el mismo instante ya conocido como
`CHATURBATE_CASHOUT_UTC_HOUR/MINUTE`). Un tercer corte propio (2 a.m.) que
no coincidía con NINGUNO de los dos hacía que los números de una quincena
cerrada no cuadraran contra lo que el usuario veía directo en
Chaturbate/Stripchat — confirmado antes de este cambio con una corrección
real de la quincena 1-15 de septiembre 2026 (ver más abajo).

**Diagnóstico importante antes de revertir nada:** se investigó la
quincena 1-15 de septiembre con una foto que el usuario pasó de los
números reales por modelo/plataforma. El hallazgo real: **4 de las 7
modelos ya cuadraban exacto** con lo que el sistema calculaba — el
problema NO era un desfase de horario parejo para todas, sino un gap de
tracking real y puntual en 3 modelos (conni_f00x, jax_f00x, pinky_f00x —
justamente las que vienen con más 403 de la Stats API de Chaturbate en el
vigía diario). Se corrigieron esas 3 a mano contra el Supabase real
(`cb_chaturbate_period_base` con `covers_until` congelado al final del
período para Chaturbate; `cb_stripchat_earnings.tokens` directo para
Stripchat) — esto ya estaba pagado desde el 20, así que la corrección de
números no mueve plata ya transferida; eso quedó en manos del usuario
resolverlo con las modelos afectadas (conni pagada de más, jax y pinky de
menos). Esta investigación fue la que confirmó que SÍ hacía falta separar
el corte por plataforma, no solo revertir a un corte único de medianoche
como la "segunda vuelta".

**Implementación (`chaturbate-lib.js`):**
- `getQuincena(now)` vuelve a clasificar "ahora" con `payrollDateStr` (el
  mismo corte de nómina de siempre, 23:30 Colombia) y construye
  `start`/`end` con `payrollWallToMs` en vez de `studioWallToMs(...,2,0,0,0)`.
  Ya no hace falta ningún caso especial de madrugada ("retroceder un día"):
  `payrollDateStr` ya resuelve sola que la madrugada antes de las 23:30
  pertenece al día de nómina siguiente. Con esto, `getQuincena` vuelve a
  coincidir exactamente con `payrollDateStr`/`toDateStr`, tal como antes de
  la tercera vuelta.
- **Nueva función `stripchatQuincenaWindow(now)`**, separada de
  `getQuincena` a propósito — NO es solo "el mismo rango con otro corte".
  Entre las 23:30 y la medianoche Colombia del último día de cada
  quincena, el reloj de NÓMINA (Chaturbate) ya cambió de quincena pero el
  de MEDIANOCHE (Stripchat) todavía no. Si `pollStripchatEarnings` usara
  `getQuincena` para decidir qué quincena es "actual" y solo le cambiara el
  corte del rango, durante esos ~30 minutos le pediría a Stripchat la
  ventana de la quincena NUEVA (que para el reloj de medianoche todavía no
  empezó) — y como una quincena cerrada nunca se vuelve a consultar, esos
  últimos ~30 minutos de actividad real de Stripchat en el día que cierra
  se perderían PARA SIEMPRE. `stripchatQuincenaWindow` clasifica "ahora"
  aparte con `studioDateStr` (medianoche), así que durante esa misma
  ventana sigue diciendo "todavía es la quincena vieja" — coincide con el
  reloj real de Stripchat — y solo pasa a la nueva justo a medianoche, sin
  gap. Costo cosmético aceptado: por esos mismos ~30 min, el total
  combinado puede mostrar el aporte de Stripchat de la quincena nueva en
  cero hasta el siguiente sondeo (10 min) — se autocorrige solo, nunca se
  pierde nada.
- Lógica de "qué mitad del mes y hasta qué día" factorizada en
  `quincenaHalf(year, month, day)`, compartida entre las dos funciones para
  que nunca puedan desincronizarse en cuál es el último día de cada mitad.
- `pollStripchatEarnings` en `server.js` es el ÚNICO call site que pedía
  datos en vivo a Stripchat — ahora usa `stripchatQuincenaWindow` (nunca
  `getQuincena`) tanto para el rango que le manda a la Studio API como
  para las claves `period_start`/`period_end` con las que guarda en
  `cb_stripchat_earnings`. Los endpoints dormidos de paste-and-parse
  manual (`/api/stripchat/*`) siguen usando `getQuincenaHistory` sin tocar
  — son solo para elegir/mostrar la etiqueta de una de las últimas 3
  quincenas, no para pedirle nada a la API en vivo.
- `startDate`/`endDate` (las claves estables YYYY-MM-DD) no cambiaron de
  mecanismo — siguen construidas directo desde year/month/startDay/endDay,
  ahora en las dos funciones.

**`npm test`: 131/131** — se reescribió el describe de `getQuincena` quitando
los tests de la ventana de gracia de las 2 a.m. (ya no existe) y agregando
la regresión directa del motivo de este cambio (trasnochar hasta la 1am ya
NO se queda en la quincena vieja) más los casos de frontera exactos
(23:29 vs 23:30 Colombia). Nuevo describe `stripchatQuincenaWindow` con el
caso que justifica que exista aparte (23:45 Colombia: nómina ya cambió,
Stripchat todavía no). Verificado también con un script Node aparte contra
la hora real del momento. No se tocó `studioQuincenaRange` (asistencia) —
totalmente independiente, confirmado antes de tocar nada.

## Sesión paralela encontrada al hacer push de la cuarta vuelta (2026-09-22, mismo día)

Justo el ejemplo de "trabajo en paralelo desde varios dispositivos" que
este archivo advierte arriba: al hacer `git push` de la cuarta vuelta,
`origin/master` ya tenía 4 commits nuevos de una sesión del 2026-09-19 (3
días antes) que:
1. Había reconstruido la MISMA extensión a las 2 a.m. de la tercera vuelta
   (`Fix quincena cutoff: grace only at period end` +
   `Corrige corte quincenal a las 2am Colombia`) — sin aportar nada nuevo,
   solo reafirmaba el diseño que esta cuarta vuelta ya revierte. Se
   descartaron sin conflicto real de fondo (mi `getQuincena` los reemplaza
   entero).
2. Había agregado un mecanismo de reconciliación real y útil:
   `syncStripchatEarningsForPeriod`/`reconcileStripchatPeriodsPendingApiReconcile`
   en `server.js` — al iniciar el servidor, re-sincroniza contra la API
   oficial cualquier fila de `cb_stripchat_earnings` marcada
   `entered_by: 'admin-reconcile-2am-boundary'` (de alguna reconciliación
   manual hecha mientras la frontera vivió en las 2 a.m.), y deja de
   tocarla una vez re-sincronizada. **Este mecanismo tenía un bug real que
   lo dejaba muerto**: llamaba a `studioWallToMs` sin importarlo, y el
   "arreglo" de esa sesión fue un archivo `stripchat-reconcile-shim.js`
   que exponía la función como GLOBAL — pero ese archivo nunca se cargaba
   desde ningún lado (`package.json`/`iniciar.bat` solo hacen `node
   server.js`, sin `-r`), así que `reconcileStripchatPeriodsPendingApiReconcile`
   tiraba un `ReferenceError` silencioso (atrapado por su propio
   try/catch) en cada arranque, sin reconciliar nunca nada. **Arreglado de
   verdad en este merge**: se agregó `studioWallToMs` al `require` normal
   de `chaturbate-lib` al inicio de `server.js` y se borró el shim muerto.
   Además, esa función ahora usa `stripchatQuincenaWindow` (no
   `getQuincena`) para reconstruir el periodo a reconciliar — es dato de
   Stripchat, tiene que clasificarse con el reloj de medianoche, no con el
   de nómina.
   **Verificado contra el Supabase real**: al momento de este merge, cero
   filas en `cb_stripchat_earnings` tienen
   `entered_by = 'admin-reconcile-2am-boundary'` — el mecanismo queda
   arreglado y listo, pero hoy no tiene nada pendiente que reconciliar
   (inerte hasta que exista una fila así). Si en el futuro alguien hace
   una reconciliación manual con ese `entered_by` exacto, el próximo
   arranque del servidor la va a recoger sola.

`npm test`: 131/131 después del merge. Push directo a `master` dado el
nivel de verificación ya hecho en la cuarta vuelta (ver sección de arriba)
más este merge explícito.

## Fusionadas "Excusas médicas" + "Justificaciones" en Asistencia (2026-09-22)

El usuario se quejó del desorden general de la app ("la distribución de la
página está demasiado mala, hay cosas repetidas... funciones que no van...
una bola grande que se sigue extendiendo"). Se auditó el código de verdad
(no la opinión de una sesión anterior) y se encontró que el problema real
estaba acotado a la pestaña Asistencia, no a toda la app: "Excusas médicas"
y "Justificaciones" eran dos sistemas paralelos (dos tablas, dos
formularios, dos listas) para la misma idea de fondo — explicar por qué
pasó algo raro un día. El usuario confirmó la dirección propuesta ("empieza
a corregir").

**Fusión real, no solo visual** — se unificó también la base de datos:
- `cb_attendance_justifications` ganó 4 columnas nuevas, todas opcionales:
  `excuse_filename`, `excuse_mime_type`, `excuse_size_bytes`,
  `excuse_content_base64`. Una justificación ahora puede llevar, o no, un
  archivo adjunto — ya no hace falta un sistema aparte solo para eso.
- Las 4 filas reales que existían en `cb_attendance_excuses` (todas de
  kitty_f00x, ninguna con `note`) se migraron a `cb_attendance_justifications`
  con `kind: 'salud'` y `body: 'Excusa médica'` (no había texto de nota que
  preservar), conservando `created_at`/`work_date`/el archivo tal cual.
  Verificado fila por fila (largo del base64 igual al original) antes de
  borrar la tabla vieja. **`cb_attendance_excuses` ya no existe** — no se
  dejó dormida a propósito, a diferencia de otros dormidos de este proyecto
  (Stripchat paste/parse, CSV, chaturbate-extra): esos eran fallbacks
  operativos que alguien podría necesitar reactivar; esto era duplicación
  de estructura pura, sin ningún caso de uso futuro razonable para
  mantenerla aparte.
- `schema.sql` actualizado a juego (columnas `excuse_*` en la tabla de
  justificaciones, tabla/policy/índice de `cb_attendance_excuses`
  eliminados) — sin esto, montar el proyecto desde cero habría creado una
  tabla que ya no existe en producción.

**server.js:**
- `sbListAttendanceJustifications` pasó de `select=*` a una lista explícita
  de columnas que **excluye `excuse_content_base64`** — mismo patrón
  cauteloso que ya usaba la vieja `sbListAttendanceExcuses` (esta lista se
  recarga cada 4s con el poll normal de Asistencia; arrastrar el archivo
  completo en cada refresco habría inflado la respuesta). El frontend
  recibe `excuse_filename`/`excuse_mime_type`/`excuse_size_bytes` (alcanza
  para mostrar el link) y pide el contenido real aparte.
- `POST /api/attendance/justification` ahora acepta, opcionalmente,
  `excuse_filename`/`excuse_mime_type`/`excuse_content_base64` — misma
  validación de siempre (2.5 MB, solo JPG/PNG/WEBP/PDF). Si viene archivo,
  push a administrador/ceo (`tag: 'placer-asistencia-excusa'`, igual que
  antes) y `sbLogAudit('attendance_justification_excuse_upload', ...)`.
- Nuevo `GET /api/attendance/justification/excuse?id=N` (reemplaza al viejo
  `GET /api/attendance/excuse`) sirve el archivo con el mismo chequeo de
  dueño (una modelo solo abre los suyos). Los dos endpoints viejos
  (`POST`/`GET /api/attendance/excuse`) se borraron del todo — la tabla que
  usaban ya no existe, dejarlos habría sido código muerto que además
  tiraría error si alguien los llamara.
- `buildAttendancePayload` ya no trae `excuses` por separado.

**Frontend (`index.html` + `asistencia.html`):**
- Vista de la modelo: las cards "Justificaciones" y "Excusa médica" se
  fusionaron en una sola — el formulario de justificación ahora tiene un
  campo de archivo opcional ("Adjuntar archivo (opcional)"), sin un campo
  de nota aparte (el textarea "Qué pasó" ya cumple ese rol). Con esto la
  vista de la modelo bajó de 4 tarjetas a 3 (Mi jornada / Justificaciones /
  Mi quincena) — no se le agregó un sub-menú (a diferencia de lo que se
  había insinuado en la conversación con el usuario): con solo 3 tarjetas
  ya no hace falta, y meter un sub-menú ahí habría sido justo el tipo de
  "opción de más" que el usuario dijo no querer seguir viendo.
- Vista de staff: "Excusas médicas" y "Justificaciones" (dentro del sub-nav
  "Hoy") se fusionaron en una sola card "Justificaciones" — bajó de 5 a 4
  tarjetas en esa sección.
- `asistencia.html`: mismo merge en su sección de solo lectura (dos
  `<h2>` separados → uno solo, "Justificantes escritos").
- `attJustListHtml`/`justificantesHtml` ahora muestran un link de descarga
  al final de cada fila cuando `excuse_filename` está presente;
  `attExcuseListHtml`/`excusasHtml` se borraron (ya no tienen ningún caso
  de uso).

**Verificación de esta sesión — misma limitación de siempre en este
contenedor remoto (sin `env.bat`/credenciales de producción):** no se pudo
levantar `SOLO_UI=1` y probar el flujo HTTP completo con curl. Se verificó
en cambio: la migración de las 4 filas reales contra Supabase (antes/
después, largo de base64 igual); el nombre exacto de las columnas nuevas
contra el schema real vía MCP (para que el `select` explícito de
`sbListAttendanceJustifications` no tuviera un typo silencioso); `node -c`
sobre `server.js` y los `<script>` inline de `index.html`/`asistencia.html`;
`npm test` 131/131 (sin tests nuevos — este cambio es orquestación server/
frontend y un `select` de columnas, no lógica pura nueva). **Falta por
probar de verdad** la próxima vez que haya sesión con credenciales
completas: subir una excusa médica real desde el formulario fusionado y
confirmar que se ve y se descarga bien en las dos vistas (modelo y staff).

## "No quiero que aparezcan todas las modelos" — un solo select por vista, nunca "Todas" (2026-09-22)

Segunda queja de UX de la misma conversación que trajo la fusión de arriba.
Pedido explícito: "No quiero que aparezcan todas las modelos. Ni en
justificaciones, ni de tablas, etcétera... detecta este problema en toda la
web." Auditado el código real (no supuesto): Desprendibles (`payslipUser`)
ya hacía esto bien desde antes — arranca en una modelo (la primera
alfabética) y nunca ofrece "Todas". Asistencia era la única pestaña con el
patrón contrario en 5 lugares. Confirmado con el usuario que Modelos
(dashboard en vivo), Extras (calendario compartido) y Cuentas (gestión de
cuentas/turnos) quedan afuera a propósito — ahí mostrar todas las modelos a
la vez es el propósito de esa vista, no un descuido.

Aplicado el mismo patrón de Desprendibles a los 5 puntos de Asistencia,
usando una función compartida nueva `attPopulateModelSelect(selectEl,
models, prevValue)` (`index.html`) — llena el `<select>` sin ninguna opción
"Todas"/valor vacío, conserva la selección previa si sigue siendo válida, y
si no hay ninguna cae en la primera modelo de la lista:

1. **"Hojas de todas las modelos" → "Hoja de asistencia"** (`attStaffFilter`):
   ya tenía el select, solo se le quitó `<option value="">Todas</option>` y
   el default pasó de "sin selección" a la primera modelo.
2. **"Resumen de la quincena"** (`attTotalsList`): no tenía ningún select —
   mostraba las 7 modelos apiladas siempre. Se agregó `attTotalsFilter`
   (nuevo) + `renderAttendanceTotalsList()` que filtra por la modelo
   elegida, reusando el html de cada fila factorizado en `attTotalRowHtml(t,
   pastTense)` (el `pastTense` es lo único que distinguía el texto de Hoy
   —"asume"— del de Historial —"asumió"—, antes duplicado dos veces).
3. **"Justificaciones"** (`attStaffJustList`): mismo caso, select nuevo
   `attJustFilter` + `renderAttendanceStaffJustList()`. Con la lista ya
   filtrada a una sola modelo, `attJustListHtml(list, withName)` se llama
   con `withName=false` — repetir su nombre en cada fila ya es redundante.
4. **"Historial de quincenas"** (`attHistFilter`): mismo fix que #1, y de
   paso el resumen de arriba de esa card (`attHistTotalsList`, que
   mostraba todas las modelos SIN filtro incluso con `attHistFilter` ya
   existiendo para la tabla de abajo) también quedó atado al mismo select
   — `renderAttendanceHistoryTotals()` nueva, y el listener de
   `attHistFilter` ahora llama a las dos funciones (`renderAttendanceHistoryTotals`
   + `renderAttendanceHistoryTable`). Antes eran incoherentes entre sí: la
   tabla ya filtraba, el resumen de arriba no.
5. **`public/asistencia.html`** (`el.filtro`, la hoja standalone): mismo
   fix — sin `<option value="">Todas</option>`, cae a la primera modelo si
   no hay nada más específico. Como `pintarTotales`/`pintarDeuda`/
   `pintarTabla`/`descargarCsv` ya usaban `el.filtro.value` con un ternario
   (`f ? ... : todos`), no hubo que tocar sus cuerpos — al ser `f` siempre
   verdadero ahora (siempre hay una modelo seleccionada), esas ramas
   "sin filtro" quedan sin uso en la práctica pero se dejaron en el código
   como resguardo defensivo para el caso límite de que `data.models` venga
   vacío (no hay ninguna modelo dada de alta todavía) — no se borraron
   porque siguen siendo alcanzables en ese caso y no son código muerto en
   sentido estricto. `el.sub` (el subtítulo de la página) se reordenó para
   leer `el.filtro.value` DESPUÉS de poblarlo (antes se armaba antes y
   siempre decía "Todas las modelos" para staff).

**No tocado a propósito** (confirmado con el usuario en la ronda de
diagnóstico anterior a este fix): Modelos, Extras y Cuentas siguen
mostrando todas las modelos a la vez — es el propósito de esas tres
pestañas, no la "bola grande" de la que se quejó.

**Verificación de esta sesión — misma limitación de siempre en este
contenedor remoto (sin `env.bat`/credenciales de producción, y esta vez
tampoco hay Playwright instalado en el proyecto para simular el DOM):**
no se pudo levantar `SOLO_UI=1` ni renderizar la página real con datos de
prueba. Se verificó en cambio: `node -c` sobre `server.js` (sin cambios
de servidor en este fix — es 100% frontend) y sobre los `<script>` inline
extraídos de `index.html`/`asistencia.html` (sin errores de sintaxis);
`npm test` 131/131 sin cambios (este fix no toca `chaturbate-lib.js`);
lectura manual línea por línea del diff completo de los dos archivos HTML
confirmando que cada `el.xxxFilter.value` que antes dependía de un string
vacío ("Todas") para significar "sin filtro" ahora siempre recibe un
username real. **Falta por probar de verdad** la próxima vez que haya
sesión con credenciales/Playwright disponibles: abrir Asistencia como
administrador contra el Supabase real y confirmar visualmente que las 4
cards de `index.html` y la hoja standalone arrancan mostrando una sola
modelo (no una lista larga) y que cambiar el select en cada una actualiza
solo esa sección.

## INCIDENTE REAL: producción quedó caída 3 deploys seguidos por un env var huérfano (2026-09-22/23)

Justo después de pushear la fusión de "Excusas médicas + Justificaciones" y
el fix de "no listar todas las modelos", el usuario mandó una captura de su
iPhone: notificación de Render, "build failed for TKS... Exited with status
1". Investigado con el MCP de Render (`list_deploys`/`list_logs`): **los
últimos 3 deploys a `master` fallaron en build**, no solo el último — el
último deploy realmente `live` en producción era del **2026-09-19**, o sea
que producción llevaba corriendo código de HACE 3 DÍAS (sin la reversión de
la frontera de quincena, sin el merge de excusas, sin nada de esta sesión)
sin que nadie se diera cuenta, porque cada deploy fallido deja el anterior
sirviendo tráfico en silencio.

**Causa raíz**: el log de build decía `Cannot find module
'./stripchat-reconcile-shim.js'`, disparado desde `internal/preload` — o
sea, algo estaba forzando a Node a precargar ese archivo en CADA invocación
(hasta durante el `npm install` del build, antes de que arrancara
`server.js` siquiera). Ese shim es justo el archivo que esta misma sesión
borró horas antes (ver "Sesión paralela encontrada al hacer push de la
cuarta vuelta" más arriba) — la sesión paralela del 2026-09-19 lo había
dejado vivo NO solo referenciado en `package.json`/`iniciar.bat` (eso sí se
revisó y estaba limpio) sino **en una variable de entorno `NODE_OPTIONS`
puesta directo en el dashboard de Render**, invisible desde el repo. Borrar
el archivo sin revisar las env vars de Render dejó esa variable apuntando a
la nada.

**Fix**: `mcp__Render__update_environment_variables` con `NODE_OPTIONS: ""`
sobre el servicio `srv-daaqf93tqb8s73dsu850` (workspace
`tea-daaqd92d0e5s738va9u0`) — dispara un redeploy automático. Confirmado
`live` en `dep-daplkgbbc2fs73b6695g` (04:49–04:50 UTC 2026-09-23), logs de
arranque sin errores.

**Lección para la próxima sesión — esto es nuevo, no estaba en este
archivo:** este proyecto ya advertía sobre revisar `package.json`/
`iniciar.bat` antes de borrar un archivo que otra sesión dejó como
mecanismo de carga (ver la sección de la cuarta vuelta), pero **nunca
advertía sobre las variables de entorno del propio servicio en Render** —
que no viven en el repo, no las ve `git log`, y no hay forma de listarlas
por este MCP (`mcp__Render__update_environment_variables` solo permite
poner/mezclar, no hay un `list_environment_variables`). Antes de borrar
cualquier archivo que pudiera ser un mecanismo de arranque/preload
(`-r`, `NODE_OPTIONS`, un `postinstall` de `package.json`, etc.), y sobre
todo si lo dejó una sesión paralela sin avisar, conviene asumir que también
pudo tocar el dashboard de Render y no solo el repo. Si algo vuelve a fallar
con `Cannot find module` apuntando a un archivo que ya no existe, revisar
`NODE_OPTIONS` en Render antes que nada.

**Cómo se detectó y qué NO hacer distinto:** el usuario mandó una captura
de la notificación push de Render (no algo que este archivo hubiera podido
prevenir con más pruebas locales — `node -c`/`npm test` corren sobre el
código, no sobre variables de entorno del servicio real, así que esto
nunca iba a aparecer en la verificación local de ninguna sesión). Lo que sí
cambia: revisar el estado real de los últimos deploys en Render
(`list_deploys`) después de cualquier push a `master`, no asumir que "el
push salió bien" significa "quedó desplegado" — son cosas distintas y esta
vez se desincronizaron por 3 commits seguidos sin que nadie lo notara hasta
que Render mandó la notificación.

## Retraso justificado — no debe sumar deuda ni disparar seguridad social (2026-09-23)

Pedido explícito, con un caso real de por medio: "hay gente que entra
después del horario habitual pero presenta justificación... necesito que
esto quede tipificado y no salte la alerta ni el cobro por hora de retardo
ya que se presentó la debida justificación." Caso concreto: kitty_f00x
presentó una excusa pero su hora de llegada real ya había quedado guardada
con 141 minutos de retraso (2h21m) — y ese número, sin este cambio, sigue
sumando hacia `debt_cop`/`debt_hours`/`owes_social_security` sin importar
que haya excusa de por medio.

**Diseño — reutiliza un patrón que ya existía, no inventa uno nuevo.**
"Marcar falta" (2026-09-15/17) ya resolvía el mismo problema para una
falta de día completo: con `justified: true` guarda `late_minutes: 0` en
vez del turno completo. Para un retraso puntual (no una falta), guardar
`late_minutes: 0` habría borrado el dato real de qué tan tarde llegó — mejor
mantener el número real (para que la fila no mienta) y sacarlo de la SUMA
que alimenta deuda/umbral. Por eso es una columna nueva, no una reutilización
de `justified`:

- **`cb_attendance_days.late_excused`** (boolean, default `false`, migración
  `attendance_late_excused` vía `apply_migration`, agregada también a
  `schema.sql`). `sumLateMinutes` en `chaturbate-lib.js` ahora salta
  cualquier día con `late_excused: true` — como es el ÚNICO punto donde se
  suma retraso hacia totales (confirmado con `grep`, es el que alimenta
  `buildAttendancePayload` Y `buildAttendanceHistoryPayload`), este solo
  cambio ya corrige debt_cop, debt_hours, owes_social_security y el
  carryover de seguridad social de la quincena anterior — sin tocar ninguna
  de esas fórmulas directamente.
- **`POST /api/attendance/day/excuse-late`** `{id, excused}` (`server.js`,
  junto a `day/edit`) — **solo `administrador`**, mismo criterio que
  `day/edit`/`day/reset`/`justification/delete`: es una corrección que
  cancela una penalización, el CEO ve pero no corrige. No borra ni
  recalcula `late_minutes` — la fila sigue mostrando la hora real y cuánto
  tardó. Reversible: mandar `excused:false` vuelve a contarlo, por si se
  marcó por error. Con audit log (`attendance_day_excuse_late`).
- **UI**: el botón "Justificar retraso" / "Quitar justificación" vive
  SOLO en `public/asistencia.html` (columna Corregir), no en `index.html` —
  siguiendo el patrón ya establecido de que TODAS las correcciones por fila
  (Editar hora, Reiniciar, Borrar) viven ahí, nunca en la tabla de
  `index.html`, que es de solo lectura/glance y linkea a la hoja completa
  ("Ver su hoja") para corregir. Solo aparece cuando `late_minutes > 0` —
  no tiene sentido justificar un día sin retraso. `retrasoHtml`/
  `attRetrasoHtml` (los dos archivos, patrón ya conocido de columnas
  pareadas) ahora aceptan un segundo parámetro `excused`: con él en `true`
  el número sigue mostrándose pero atenuado, con "justificado, no cuenta"
  debajo — nunca oculta el dato real.
- **Aplicado de inmediato a kitty_f00x** (día 2026-09-22, fila id 121, 141
  min) directo por SQL contra Supabase, con un `insert` manual en
  `cb_audit_log` calcando el mismo `action`/`details` que dejaría el
  endpoint — para que quede la misma trazabilidad que si se hubiera usado
  el botón, ya que se aplicó antes de que el código llegara a producción.

`npm test`: 133/133 (2 tests nuevos sobre `sumLateMinutes` con
`late_excused`). Misma limitación de siempre en este contenedor remoto (sin
`env.bat`/credenciales de producción): no se pudo probar el endpoint HTTP
completo con curl contra una cuenta `qa_temp_*`; se verificó con `node -c`
sobre los tres archivos tocados, el chequeo de sintaxis de los `<script>`
inline extraídos, y la migración/corrección de kitty_f00x confirmadas por
consulta SQL directa contra el Supabase real. **Falta por probar de
verdad** la próxima vez que haya sesión con credenciales completas: tocar
el botón "Justificar retraso" desde el navegador contra una cuenta
`qa_temp_*` y confirmar que el número de deuda/aviso de seguridad social
baja al toque en pantalla.

## Auto-validación de llegada tras 15 min sin confirmar (2026-09-26)

Pedido explícito: "Después de 15 minutos sin confirmar entrada de modelo, se
asume que la modelo entró a la hora que reportó y se marca sola." Nueva
función `checkAutoValidateArrivals()` en `server.js`, mismo patrón que
`checkAutoExits` (poller cada 5 min, gateado por `!UI_ONLY`, flag
`autoValidateArrivalsRunning` para no solaparse si una corrida tarda más
que el intervalo): revisa jornadas `pendiente` de los últimos 3 días y, si
pasaron 15+ min desde `reported_at` sin que el administrador la valide, la
valida sola **exactamente como la rama "Sí llegó a esa hora"** de
`POST /api/attendance/validate` (`official_at = reported_at,
official_source: 'reportada'`, con la misma relectura de horario si al
reportar todavía no tenía uno asignado) — no es una cuarta opción de
validación nueva, reusa la lógica existente para no duplicarla.

**Por qué esta rama y no "Llegó ahora":** el pedido fue puntual — "se
asume que llegó a la hora que reportó" — que es literalmente lo que ya
hace `source: 'reportada'`. Elegir "ahora" habría penalizado a la modelo
con minutos de retraso que no le corresponden solo porque nadie la validó
a tiempo, exactamente el problema que la sección "El flujo de la entrada"
de este archivo ya documentaba como la razón de tener tres botones en vez
de uno. Reusar `official_source: 'reportada'` también significa que la
fila queda **indistinguible** en la tabla de una validación manual con
"Sí llegó a esa hora" — no hizo falta tocar `index.html` ni
`asistencia.html` para nada de renderizado.

`validated_by` guarda el texto fijo `'sistema (15 min sin validar)'` (no
es un username real) — confirmado que ese campo no se lee en ningún lugar
del frontend, así que no hay riesgo de que aparezca texto raro en pantalla;
es solo para que quien mire la fila cruda en Supabase sepa que no fue un
click humano. La trazabilidad real de "esto se auto-validó" vive en
`cb_audit_log` (`action: 'attendance_auto_validate'`, actor sintético
`{username: 'sistema', role: 'sistema'}`) — mismo criterio que las otras
correcciones administrativas que sí auditan (`day/edit`, `day/reset`,
`day/no-show`), porque esto también decide `late_minutes`/deuda y merece
poder rastrearse después. Al validar, dispara el mismo
`notifyAttendanceValidated(...)` que usa la validación manual — mismo
push "X llegó a las HH:MM — N min de retraso", y si con esto ya entraron
todas sin nadie tarde, el mismo aviso único "TODAS TUS MODELOS ENTRARON A
TIEMPO" (con su candado de una vez por día, sin cambios).

Si el administrador valida ANTES de los 15 minutos (por cualquiera de las
tres vías), la fila deja de estar `pendiente` y esta rutina simplemente la
ignora en su próxima corrida — no hay condición de carrera real: el peor
caso es que las dos escrituras coincidan en la misma ventana de 5 min del
poller, y como ambas llegan al mismo resultado para `source: 'reportada'`
(o el admin elige otra cosa y gana porque corrió primero — Postgres no
tiene forma de que las dos actualicen a la vez sobre la misma fila sin que
una gane), no hay inconsistencia posible.

`npm test`: 133/133 sin cambios (esto es orquestación en `server.js`, no
toca ninguna función pura de `chaturbate-lib.js` — reusa
`computeLateMinutes` tal cual ya estaba). **Verificación de esta sesión,
misma limitación de siempre en este contenedor remoto (sin
`env.bat`/credenciales de producción):** no se pudo levantar `SOLO_UI=1`
y esperar 15 minutos reales contra el Supabase real para confirmar el
disparo del poller. Se verificó en cambio: `node -c` sobre `server.js`,
lectura línea por línea del diff comparándolo contra la rama `'reportada'`
ya existente y probada de `/api/attendance/validate` (mismo cálculo de
`scheduledMs`/`lateMinutes`, mismo patch a `cb_attendance_days`), y que
`startAutoValidateArrivalsChecking()` quedó registrado junto a los demás
pollers bajo el mismo gate `!UI_ONLY` (confirmado con `grep`, no se le
olvidó el gate como hubiera sido fácil de hacer). **Falta por probar de
verdad** la próxima vez que haya sesión con credenciales completas: dejar
una llegada reportada sin validar 15+ minutos contra una cuenta `qa_temp_*`
real y confirmar que se auto-valida con el `late_minutes` correcto y llega
el push.

## Tres arreglos de UX en Asistencia + mensaje de seguridad social (2026-09-26)

Pedido en varios mensajes seguidos, con capturas reales cada vez.

**1. BUG REAL: filas de "Jornadas de la quincena" con huecos gigantes en
`asistencia.html`.** Reportado con capturas: cada fila de la tabla medía
70-100px con casi todo el espacio vacío, y al desplazar de lado el texto
parecía "no coincidir" con su columna. Diagnosticado con Chromium real
(no adivinado): la columna "Corregir" tiene hasta 4 botones (Editar hora /
Justificar retraso / Reiniciar / Borrar, el cuarto agregado el 2026-09-23)
dentro de `.fix-actions`, que tenía `flex-wrap: wrap` + `min-width: 200px`
— con 4 botones eso envuelve a 2 líneas, y como todas las celdas de una
fila de tabla comparten la misma altura, esa columna (aunque quede fuera de
vista al desplazar la tabla) infla la fila ENTERA a 70-100px, dejando las
columnas visibles (fecha, entrada...) con su texto arriba y un hueco vacío
abajo. Medido con Playwright antes/después: filas de 73-103px con
`flex-wrap: wrap` bajaron a 38-54px con `flex-wrap: nowrap` (sin
`min-width`, ya no hace falta — la tabla ya se desplaza de lado a
propósito, así que la columna Corregir simplemente se vuelve más ancha, no
más alta). Captura de pantalla propia contra datos de prueba confirmó el
arreglo visualmente antes de hacer push.

**2. Incoherencia real en `asistencia.html`: selectores de modelo
duplicados.** La hoja ya tiene UN selector "Modelo" arriba (`el.filtro`,
título "Hoja de asistencia — <modelo>") que decide toda la página desde el
2026-09-22 (sin "Todas"). Pero "Agregar o corregir hora manualmente" y
"Marcar falta" tenían cada una su PROPIO `<select>` de modelo
(`manualUser`/`faltaUser`), independiente del de arriba — reportado con
capturas reales mostrando el encabezado en `amaranta_f00x` mientras esas
dos cards mostraban `abigail_f00x` (el default alfabético de un select sin
tocar). Como la tabla de abajo YA es siempre de una sola modelo (la del
selector de arriba), esos dos selects eran 100% redundantes. Se borraron
del todo — `manualUser`/`faltaUser` ya no existen ni en el HTML ni en el
`el` map — y `guardarManual()`/`guardarFalta()` ahora leen `el.filtro.value`
directo. `manualPrefill(workDate)` perdió el parámetro `username` (ya no
hace falta: el botón "Editar hora" de una fila siempre pertenece a la
modelo que ya está seleccionada arriba, nunca a otra).
**Esto también responde "dónde están las excusas médicas":** desde la
fusión Excusas+Justificaciones del 2026-09-22, viven dentro de
"Justificantes escritos", filtradas por la MISMA modelo del selector de
arriba — para verlas, elegí ahí a la modelo que subió la excusa (ej.
kitty_f00x) y bajá hasta esa card; ya no hay una card separada "Excusas
médicas".
**Corrección (2026-09-26, misma tarde):** esta sección afirmó que
`index.html` no tenía el mismo problema — **eso era falso**. La pestaña
Asistencia → "Hoy" de `index.html` tenía exactamente el mismo bug
(Resumen/Hoja/Justificaciones con tres selects independientes, cada uno
pudiendo mostrar una modelo distinta a la vez), y el usuario lo encontró
con una captura minutos después de leer esto. Ver la sección "Unificar
selector de modelo en index.html" más abajo por el arreglo real. Lo que
sigue siendo cierto: Modelos, Extras y Cuentas de `index.html` sí muestran
todas las modelos a propósito (son dashboards de más de una modelo a la
vez) — esos no cambiaron.

**3. Textos de descripción acortados** (pedido explícito: "eliminar esa
explicación extensa y ser resumido... en todas"). Se acortaron las
descripciones largas bajo el título de: "Mensaje de seguridad social por
modelo", "Horarios y umbral", "Confirmación de extras y recuperaciones",
"Salud del sistema" (esta última además dejó de mencionar la sesión de
Claude/cuota como razón interna — mismo criterio ya establecido en este
archivo de no meter razonamiento de ingeniería en la copy del producto),
"Justificaciones" (vista modelo), "Desprendible del estudio", y en
`asistencia.html` las de "Agregar o corregir hora manualmente" y "Marcar
falta" (esta última bajó de 3 oraciones a 1). Margen de los botones
"Guardar"/"Marcar falta" en esas dos cards subido de 12px a 16px para que
no queden pegados al campo de arriba.

**4. Mensaje predeterminado de seguridad social, ampliado.** Pedido
explícito: agregar que además de asumir su propia seguridad social, la
modelo pierde el acceso a "la meta" (el incentivo por tope de tokens) —
**sin explicar en el texto qué es la meta**, porque eso es contexto interno
para quien programa, no algo que haga falta explicarle a una modelo del
estudio. `DEFAULT_OWES_ALERT_MESSAGE` (`chaturbate-lib.js`) pasó de
"...superó el límite de retraso o inasistencia acumulado {periodo} y asume
su propia seguridad social." a "...superó el límite de retraso o
inasistencia injustificada {periodo}: asume su propia seguridad social y
pierde el acceso a la meta." (corregido "acumulada" → "injustificada": el
pedido decía "inasistencia justificada", pero una inasistencia JUSTIFICADA
nunca penaliza en este sistema — ver `justified`/`late_excused` — así que
tiene que haber sido un error de dictado; "injustificada" es la única
lectura consistente con cómo funciona el resto del código). Esto es solo
el DEFAULT — una modelo con mensaje personalizado en
`cb_attendance_schedule.owes_message` no se ve afectada. El placeholder del
textarea en `index.html` (`attOwesMsg`) se actualizó a juego para no quedar
desincronizado del texto real.

`npm test`: 134/134 (2 tests de `resolveOwesAlertMessage` actualizados al
nuevo default — comprobaban la palabra "acumulado" que ya no está en esa
posición del texto — más 1 test nuevo confirmando que el default menciona
la meta). Verificado con Chromium real (Playwright global en
`/opt/node22/lib/node_modules/playwright`, no está en el `package.json` del
proyecto): server estático local sirviendo `public/`, `/api/attendance`
interceptado con datos de prueba inventados calcados de la estructura real
(nunca datos reales), captura de pantalla completa de `asistencia.html`
confirmando visualmente que el selector único arriba controla todo, las
filas de la tabla quedaron compactas, y las descripciones cortas se ven
bien. **Sigue pendiente probar de verdad** contra el Supabase real con
datos reales de producción — misma limitación de siempre en este
contenedor (sin `env.bat`/credenciales de producción).

## Unificar selector de modelo en index.html + editar justificantes (2026-09-26, misma tarde)

Continuación de la sección anterior: el usuario encontró el mismo bug de
selectores redundantes en `index.html` (captura real de la pestaña
Asistencia → "Hoy": "Resumen de la quincena" mostraba `conni_f00x` y "Hoja
de asistencia" mostraba `abigail_f00x` al mismo tiempo). Mismo arreglo que
ya se había aplicado en `asistencia.html`: las tres tarjetas (Resumen /
Hoja de asistencia / Justificaciones) pasaron a compartir un único
`<select id="attStaffFilter">` en una tarjeta propia arriba de las tres,
con el texto "Elegí la modelo — controla el resumen, la hoja y las
justificaciones de acá abajo." `attTotalsFilter`/`attJustFilter` (los
selects independientes que esta misma sesión había agregado horas antes,
sin darse cuenta de que reintroducían el problema) se borraron del todo —
del HTML, del mapa `el`, y sus tres listeners de `change` separados se
colapsaron en uno solo sobre `attStaffFilter` que llama a
`renderAttendanceTotalsList()`, `renderAttendanceStaffTable()` y
`renderAttendanceStaffJustList()` juntas. Verificado con `node -c` sobre
el `<script>` inline y `grep` confirmando cero referencias colgantes a los
selects borrados. `npm test`: 134/134 sin cambios (fix 100% frontend).

**Segundo pedido de la misma conversación: editar el texto de un
justificante ya escrito, para administrador O ceo** (a diferencia de
"Bajar este justificante", que sigue siendo solo administrador — mismo
criterio ya usado en otras correcciones administrativas, pero el usuario
pidió explícitamente que ESTA sí la tenga el CEO también).
- `POST /api/attendance/justification/edit` `{id, body}` (`server.js`,
  `requireAdminOrCeo`) — valida texto no vacío (mismo límite de 1000
  caracteres que al crearla), usa `sbUpdateAttendanceJustificationBody(id,
  text)` (PATCH directo a `cb_attendance_justifications`), y audita con
  `sbLogAudit('attendance_justification_edit', ..., {id, before, after})`
  — igual que `day/edit`/`day/reset`, esto corrige un dato ya guardado, así
  que queda trazado.
- **Solo en `asistencia.html`**, no en `index.html` — sigue el patrón ya
  establecido de que todas las correcciones por fila (Editar hora,
  Reiniciar, Borrar, Justificar retraso) viven en la hoja completa, nunca
  en la vista de solo lectura/glance de `index.html`. Botón "Editar" nuevo
  junto a "Bajar este justificante" en `justificantesHtml`, visible para
  administrador Y ceo (el de borrar sigue solo para administrador).
- Sin modal de texto libre en `asistencia.html` (ese archivo solo tiene
  `uiConfirm`/`uiToast`, no el `uiPrompt` que sí existe en `index.html`) —
  se usó `window.prompt()` directo, precargado con el texto actual.
  Construir un modal de texto libre completo para un solo botón habría
  sido una abstracción de más para lo que se pidió.
- Verificado con Playwright (servidor estático local + `/api/attendance`
  mockeado con datos inventados, dos sesiones de página — una `role:
  'administrador'`, otra `role: 'ceo'`): administrador ve "Editar" +
  "Bajar este justificante"; ceo ve solo "Editar", confirmando el gateo
  correcto sin pegarle al Supabase real. `npm test`: 134/134 sin tests
  nuevos (endpoint de orquestación simple, sin lógica pura nueva en
  `chaturbate-lib.js`). **Falta por probar de verdad** la próxima vez que
  haya sesión con credenciales de producción: editar un justificante real
  desde el navegador contra una cuenta `qa_temp_*` y confirmar que el
  cambio se refleja en la hoja y en `cb_audit_log`.

## Bug real de alineación: íconos de cabecera centrados vs. datos a la izquierda (2026-09-26, misma tarde)

Tercera captura de la misma conversación: "Las letras de la hoja se ven
corridas y no estan acorde a lo que señala arriba... no tiene orden en la
hoja". Antes de tocar nada se midió con Playwright (`getBoundingClientRect`
de cada `<th>` contra su `<td>` correspondiente) para descartar un bug
estructural — resultado: los bordes izquierdo/derecho de cada columna
coincidían EXACTO entre cabecera y dato en las dos tablas (`index.html` y
`asistencia.html`). El bug no era de estructura, era de alineación visual:
en el `@media (max-width: 640px)` de las dos tablas, `th { text-align:
center }` centra el ÍCONO dentro de su columna, pero los `<td>` siguen
`text-align: left` (nunca tuvieron override) — en una columna angosta esto
no se nota, pero en una ancha como Justificante (220px) el ícono queda
flotando ~100px a la derecha de donde arranca el texto real, dando la
sensación de que el valor "no corresponde" al ícono de arriba. Fix en las
dos tablas: `text-align: center` → `text-align: left` en esa misma regla —
ahora el ícono cae exactamente sobre el borde izquierdo de la columna,
igual que el texto de abajo. Verificado visualmente con Playwright
(capturas recortadas a `.att-table-wrap`/`.table-wrap` en distintos puntos
de scroll horizontal, viewport 390px, datos de prueba con una justificación
real ("Me siento enferma") y una salida temprano): el ícono de
Problemática/Justificante ahora queda pegado al inicio de "Salud"/"Me
siento enferma", no flotando en el medio de la columna. `npm test`:
134/134 sin cambios (fix 100% CSS).

## Polling de index.html bajado de 4s a 1 minuto — cuota de Supabase (2026-09-26)

El usuario reportó que Supabase le avisó cuota excedida y no puede pagar.
Diagnosticado (no supuesto): el proyecto de producción (`yklqqalnmficsbyabbrn`)
está sano — 142MB de 500MB, sin problema. El problema real es a nivel de
**organización** (plan gratis "STUDIO", `aloxugskfwhhpnplondm`), que tiene 3
proyectos (TKS, `venta-webs`, `venta-webs-demo` — estos dos últimos son otro
negocio del usuario, nada que ver con Placer Studios) y el plan gratis solo
permite **2 proyectos activos a la vez** — confirmado con el error real de
`mcp__Supabase__restore_project` al intentar reactivar el tercero:
`"menajeiner@gmail.com (2 project limit)"`. Aparte de eso, el dashboard del
usuario (captura real) mostró el consumo del ciclo actual: **Egress 12.6/5
GB (252%) y Log Ingestion 5.41/1 GB (541%)** — los dos únicos realmente
pasados; Database size (165/500MB), Monthly active users y File storage
están bien.

**Causa identificada por razonamiento, no medida directamente**: `index.html`
hacía polling de `/api/attendance`+`/api/models`+`/api/shifts` cada **4
segundos** (`pollTimer`) mientras la pestaña estuviera abierta, multiplicado
por hasta 9 sesiones simultáneas (7 modelos + administrador + CEO) las 24h —
el candidato obvio para el Egress/Log Ingestion pasados, ya que es tráfico
constante e independiente del uso real de Chaturbate/Stripchat (esos van por
otro lado, sin tocar). **Fix, pedido explícito del usuario tras confirmar que
no afecta el registro de dinero ni las notificaciones push**: `pollTimer`
pasó de `4000` a `60000` ms (línea junto a `showApp()`, con comentario
explicando el motivo). Nada más cambió — mismo `refresh()`/`refreshShifts()`,
mismo mecanismo, solo el intervalo. `npm test`: 134/134 sin cambios (fix
100% frontend, un solo número).

**Lo que esto NO resuelve**: el límite de 2-proyectos-activos-por-cuenta
sigue igual (no es un problema de tráfico, es un tope de cuenta) — para
reactivar `venta-webs-demo` el usuario tiene que pausar/borrar uno de los
otros dos primero, o pagar Pro. Esto es una decisión suya sobre SU otro
negocio, no algo para resolver desde esta sesión de TKS.

**No verificado con datos reales de consumo antes/después** (no hay acceso
a un dashboard de uso vía MCP, solo lo que el usuario compartió por
captura) — la expectativa de que esto baje "bastante" el consumo es
razonamiento sobre el patrón de tráfico (15x menos requests desde el
dashboard), no una medición confirmada. Si el próximo ciclo de facturación
sigue mostrando Egress/Log Ingestion pasados después de este cambio, el
siguiente sospechoso a mirar sería el `Cache-Control: no-cache` de
`serveStatic` (obliga a redescargar `index.html`/`asistencia.html` enteros
en cada carga de página, no solo en cada poll) — no tocado esta vez porque
el usuario no lo pidió y tiene su propia razón de ser (evitar que quede
una versión vieja cacheada tras un deploy, ver la sección de 2026-09-02).

## Segunda vuelta contra la cuota de Supabase — Fair Use Policy real, no un supuesto (2026-09-26)

El usuario pasó la captura real del banner de Supabase: **grace period activo,
termina el 27 sep 2026** (mañana desde esta sesión); si para entonces la
organización sigue pasada de cuota, aplica la Fair Use Policy y **las
requests a los proyectos empiezan a devolver HTTP 402**. Esto confirma que
NO es un aviso cosmético — un 402 sostenido rompe TKS de verdad (el
dashboard deja de cargar, y escrituras de propinas que fallan tras los 3
reintentos de `sbWriteCritical` se pierden de verdad, no solo se demoran).

**Auditoría pedida por el usuario (con un análisis de ChatGPT como punto de
partida) — verificada contra `pg_stat_statements` real antes de tocar nada,
no contra los números que traía ese análisis.** Hallazgo clave: esas cifras
NO eran de 24h como decía el prompt — `pg_stat_statements_info.stats_reset`
es `2026-08-31 16:50 UTC`, o sea 26 días acumulados. Con esa corrección:

- **El consumidor #1 por lejos, y no era el que ChatGPT señaló como más
  grande**: `UPDATE cb_models SET last_cursor` — **1.541.061 llamadas en 26
  días** (~59.000/día, ~41/min sin parar). Causa: en `pollLoop`,
  `sbSaveCursor` se llamaba en CADA respuesta del long-poll de la Events API
  de Chaturbate, y eso incluye `userEnter`/`userLeave`/`follow`/
  `chatMessage`, no solo tips — una sala activa genera muchísimos de esos
  eventos. Cada PATCH es barato para Postgres (0.166ms) pero cada uno es un
  request HTTP completo con su propia línea de log — el sospechoso principal
  del 541% en Log Ingestion.
- **#2**: `INSERT INTO cb_unhandled_events` — ~219.171 en 26 días (~8.400/
  día). Esto sí coincidía en orden de magnitud con lo que traía el análisis
  de ChatGPT.
- **#3, no estaba en ese análisis**: `buildModelReports()` (lo que arma la
  pestaña Modelos vía `/api/models`) se recalculaba desde cero en CADA
  request — sin ningún cache — re-trayendo el historial completo de propinas
  y balances de TODAS las modelos de la quincena en curso cada vez. Con
  hasta 9 sesiones sondeando, eran ~9 recálculos completos por minuto,
  re-transfiriendo lo mismo una y otra vez.

**Verificación de seguridad ANTES de tocar `sbSaveCursor`** (el usuario pidió
explícitamente no borrar `last_cursor` sin entender antes para qué sirve):
`cb_tips` y `cb_broadcast_events` tienen `UNIQUE(username, event_id)` — si el
cursor guardado queda unos segundos viejo y Chaturbate reenvía al reconectar
un evento ya procesado, ese constraint lo bloquea. No hay forma de duplicar
plata espaciando el guardado del cursor, solo se arriesga reenviar un puñado
de eventos ya vistos que la base ya sabe rechazar. (Hallazgo lateral, no
arreglado esta vuelta: el `ON CONFLICT` que genera PostgREST para
`Prefer: resolution=ignore-duplicates` apunta al `id` autonumérico de
`cb_tips`, no al `UNIQUE(username, event_id)` — así que un duplicado real no
se ignora silencioso, falla y `sbWriteCritical` reintenta 3 veces antes de
loguear el fallo. No duplica dinero, pero es más ruidoso de lo que sugiere
el nombre "dedup". Si se quiere un ignore limpio, es cambiar `on_conflict=
username,event_id` en la URL del POST — no se tocó porque no era lo que
se pidió esta vez.)

**Cambios aplicados** (autorización explícita del usuario: "haz lo que
salve mi entrada de dinero"), los dos más chicos y seguros de los tres
candidatos, dejando el tercero (revisar qué métodos de
`cb_unhandled_events` son ruido puro) para después porque necesita mirar
antes cuáles son esos ~130 métodos distintos:

1. **Cache de 20s sobre `buildModelReportsCached()`** (nueva función,
   envuelve a `buildModelReports()` sin tocarla) — único call site es
   `/api/models`, así que el cache no le esconde datos frescos a ningún
   otro flujo. 20s es invisible para un dashboard de tokens/pago; no aplica
   a Asistencia (endpoint separado, sin tocar).
2. **`sbSaveCursor` limitado a 1 vez cada `CURSOR_SAVE_MIN_INTERVAL_MS`
   (10s) por modelo** — `tracker.lastCursorSaveAt` nuevo en el objeto
   tracker (`startTracker`). El `nextUrl` local para el próximo fetch sigue
   actualizándose siempre; lo único que se espacía es CUÁNDO se persiste a
   Supabase. Debería tumbar la mayoría de esas 1.5M llamadas.

**Nivel de verificación — misma limitación de siempre en este contenedor
remoto (sin `env.bat`/credenciales de producción reales, y esta vez además
sin poder ejercitar el long-poll real de Chaturbate desde acá, que
requeriría credenciales reales de las modelos):** `node -c`, `npm test`
(134/134 sin tests nuevos — ninguno de los dos cambios es lógica pura, no
tocan `chaturbate-lib.js`), y un boot real en `SOLO_UI=1` con credenciales
falsas confirmando arranque limpio y una request de verdad respondida
(200). **No se pudo probar en vivo** que el throttle de `sbSaveCursor`
realmente corta el volumen de PATCH ni que el cache de `buildModelReports`
sigue devolviendo números correctos contra el Supabase real — eso solo se
confirma mirando `pg_stat_statements`/el dashboard de Supabase un rato
después de que esto llegue a producción.

**Actualización misma sesión, mismo día: el tercer punto pendiente ya no
está pendiente.** El usuario pidió explícitamente seguir ("Y que mas toca
hacer pa salvar el proyecto") tras confirmar los dos primeros cambios en
producción. `select method, count(*) from cb_unhandled_events group by
method` contra el Supabase real dio solo **9 métodos distintos** (no ~130
como se especuló antes de mirar) — la tabla real:

```
userLeave        88.336
userEnter        86.732
privateMessage   27.564
chatMessage       8.244
follow            4.909
roomSubjectChange 2.819
unfollow            770
mediaPurchase        29
fanclubJoin           6
```

`userEnter`+`userLeave` son el **80% del volumen** (175.068 de ~217k filas)
y son pura presencia en la sala — nunca llevan tokens, a diferencia de
`privateMessage`/`mediaPurchase`/`fanclubJoin` que sí son candidatos
reales a plata no contada (el motivo original de esta tabla) y por eso NO
se tocaron. Además, **`sbCheckUnhandledEvents` (el vigía) ya los ignora**:
`KNOWN_UNHANDLED_EVENT_METHODS` (server.js) lista exactamente estos 9
métodos como "conocidos" y los salta al buscar métodos nuevos — o sea que
guardar `userEnter`/`userLeave` no le servía ni siquiera a la única función
que lee esa tabla. `pollLoop` ahora los descarta antes de llamar a
`sbInsertUnhandledEvent` en vez de guardarlos y filtrarlos después. Cero
riesgo, cero cambio de comportamiento visible en ningún lado — confirmado
`node -c` + `npm test` 134/134, y desplegado.

**Sobre "qué más falta" para el 27**: intenté confirmar contra la
documentación oficial de Supabase (Fair Use Policy) si "seguir pasado de
cuota" al terminar el grace period se evalúa contra el ciclo de
facturación EN CURSO (en cuyo caso estos arreglos sí ayudan a tiempo) o
contra el ciclo YA CERRADO que disparó el aviso (en cuyo caso no hay nada
que el código pueda hacer para esa fecha puntual). **No lo pude confirmar
— los intentos de `WebFetch` a las páginas de billing de Supabase no
traen esa letra chica.** Se lo dije así de claro al usuario en vez de
adivinar. Lo que SÍ es cierto y verificado: el cupo es a nivel de
ORGANIZACIÓN, compartido con `venta-webs` (el otro negocio del usuario,
proyecto separado) — si ese proyecto también genera tráfico significativo,
optimizar solo TKS puede no alcanzar. Fuera del alcance de esta sesión
tocarlo (pedido explícito: no tocar `venta-webs`), pero vale que el
usuario lo sepa para decidir si pausarlo temporalmente por su cuenta.

**Corrección de esa misma hipótesis, verificada y descartada la misma
tarde:** se chequeó `venta-webs` de verdad (`pg_stat_statements` de ese
proyecto, solo lectura, sin tocar nada) — apenas 1.669 llamadas en 2 días,
nada comparado con los millones de TKS. Pausarlo no habría ayudado en
nada; se lo dijo así al usuario en vez de sugerir una acción inútil.

**El usuario cortó en seco cualquier mención de plan pago** ("No tengo
plata. Deja de persuadirme, solo soluciones") — la sección de arriba ya
había mencionado subir a Pro como opción, y no se debe volver a traer el
tema salvo que el usuario lo pida él mismo. Dos acciones más, ambas
gratis, ambas ejecutadas en el momento:
- **Polling de `index.html` bajado de 1 min a 3 min** (`pollTimer`,
  mismo mecanismo, sin tocar nada más) — margen extra sin costo, ya que
  no había ninguna urgencia real en mantenerlo en 1 min y quedaba a mitad
  de camino del análisis original (3 min).
- **Borrador de mensaje a soporte de Supabase**, dejado en el scratchpad
  de la sesión (no en el repo, es contenido para el usuario, no código):
  explica que la causa de raíz ya se corrigió y pide revisión/extensión
  del plazo. Gratis, sin garantía de que funcione, pero es una vía real
  que no depende de pagar.

## El 402 de Supabase sí llegó — caída real de ~34h, recuperada sola (2026-09-28/10-01)

Pasó exactamente lo que se temía: la organización siguió pasada de cuota
después del grace period y Supabase empezó a devolver HTTP 402 en TODA la
API REST (PostgREST) del proyecto — no solo escrituras, también lecturas,
confirmado pegándole directo a la API con la misma anon key que usa
`server.js`: `{"message":"Service for this project is restricted due to
the following violations: exceed_egress_quota..."}`. Empezó
~2026-09-28 22:32 UTC (confirmado por el primer "FALLO GUARDANDO tip" en
logs y por que las 7 modelos dejaron de actualizar balance/Stripchat
exactamente a esa hora) y se resolvió sola, sin ninguna acción de nuestro
lado, en algún momento entre el 30 y la madrugada del 1 de octubre (primera
escritura nueva confirmada: 2026-10-01 ~02:22-03:07 UTC) — coincide con el
reseteo del ciclo de facturación que Supabase había anunciado para el 30.
**Lección real para la próxima vez que esto pase:** mi propio login daba
"usuario o contraseña incorrectos" con la cuenta real del usuario durante
la caída, y casi lo diagnostico mal — probé primero con un usuario
inexistente y como un 402 y un "no existe" dan la MISMA respuesta externa
(`sbFindAdmin`/`sbFindModelAuth` hacen `if (!r.ok) return null`, sin
loguear el motivo), esa prueba no sirve para distinguir "la API está caída"
de "la contraseña está mal". La prueba real es pegarle directo a
`{SUPABASE_URL}/rest/v1/...` con la anon key y mirar el status code, no
usar el login de la app como proxy.

**Qué quedó realmente perdido y qué no, confirmado con datos reales (no
supuesto):**
- **Asistencia**: el 28 el sistema siguió andando hasta la tarde/noche (las
  7 modelos ya tenían su entrada normal reportada ese día) — la caída real
  de asistencia es **solo 29 y 30 de septiembre**, y solo para las modelos
  que no alcanzaron a reportar antes de las 22:32 UTC del 28. `abigail_f00x`
  y `amaranta_f00x` sí lograron reportar el 29/30 (conectividad parcial,
  intermitente) — las demás (`conni_f00x`, `jax_f00x`, `kitty_f00x`,
  `pinky_f00x`, `tamar4_f00x`) no tienen fila en `cb_attendance_days` para
  esos días. **No se inventó ningún dato para rellenar ese hueco** — hace
  falta que el admin cargue las horas reales a mano vía
  `/api/attendance/day/edit` con la hora que cada modelo reportó por
  WhatsApp durante la caída, no asumir un horario uniforme.
- **Tokens de Chaturbate**: intenté la reconciliación automática (vía
  `cb_balance_ticks`) antes de pedir CSV, tal como pide `resolveChaturbateTokens`.
  **No alcanza por sí sola** — Chaturbate vacía el balance de cada modelo
  TODOS LOS DÍAS a las 04:30 UTC (23:30 Colombia), y durante la caída no se
  pudo capturar ningún tick de balance antes de esos vaciados (el último
  tick bueno de la mayoría es de la tarde/noche del 28, antes de que
  empezara la caída) — hubo 2-3 vaciados ciegos por modelo (noches del 28,
  29 y 30) sin ningún registro de cuánto había justo antes. Confirmado con
  SQL real: las 7 modelos tienen el mismo hueco en `cb_balance_ticks` entre
  el 28 de tarde y el 1 de octubre de madrugada. **La única forma real de
  recuperar esos tres días es el CSV de "historial de transacciones" de
  Chaturbate, por modelo**, vía `/api/chaturbate-csv/upload` — este
  endpoint **no tiene UI** (se removió junto con "Otros ingresos de
  Chaturbate", ver sección de 2026-09-15, pero el upload de CSV es un
  endpoint aparte que sigue intacto) — hay que llamarlo directo con curl
  usando la sesión de un admin logueado. Si una futura sesión necesita
  volver a hacer esto: el endpoint acepta `{username, csvText}`, valida
  contra quincenas completamente cubiertas por el rango de fechas del
  archivo, y el CSV de Chaturbate normalmente solo cubre ~30 días — pedirlo
  pronto, no dejarlo pasar.
- **Stripchat**: se recuperó solo, sin intervención — el sync trae el
  acumulado de la quincena desde la API de Stripchat, no un log de eventos,
  así que no tiene el mismo problema de "vaciado diario ciego" que
  Chaturbate.
- **No hizo falta reiniciar nada**: los pollers de Chaturbate/Stripchat se
  recuperaron solos apenas Supabase volvió a aceptar escrituras (ya tienen
  reintentos/backoff incorporados desde antes) — confirmado con
  `last_balance_at`/`cb_stripchat_earnings.updated_at` frescos para las 7
  modelos sin tocar nada. Forzar un restart de los trackers en este punto
  no habría arreglado nada más rápido y sí corre el riesgo real ya
  documentado de pollers zombie si no se hace con el patrón correcto de
  `startTracker`.

## Admin ahora puede subir una justificación de asistencia por una modelo (2026-10-01)

Pedido explícito, directamente relacionado con la caída de arriba: con el
login roto, las modelos reportaban su hora por WhatsApp y no había forma de
dejar esa justificación en el sistema salvo que ella jurísto rendiera y
iniciara sesión. `POST /api/attendance/justification` aceptaba
`session.role !== 'modelo'` como el único 403 — ahora también acepta
`administrador` (no `ceo`, no se pidió): si el que llama es admin, toma
`body.username` (validado contra `cb_models`, mismo patrón que
`/api/chaturbate-csv/upload`) en vez de `session.username`. El audit log
registra `attendance_justification_admin_create` con la modelo real como
`target` — distinto de `attendance_justification_excuse_upload` (el de
autoservicio), para no mezclar "la modelo subió esto" con "el admin lo
cargó por ella". No se manda push en el caso admin (el push existente es
para avisarle a admin/ceo que UNA MODELO subió algo — no tiene sentido
avisarle al propio admin de su propia acción). **Sin UI todavía** — se pidió
la capacidad en el backend primero; si hace falta el botón en
`asistencia.html`, es un formulario más junto a "Agregar o corregir hora
manualmente" (mismo selector de modelo ya existente en esa página).
`npm test`: 134/134 sin cambios (es orquestación, no toca
`chaturbate-lib.js`).

## Octava modelo (Iris_f00x) + corrección real sobre el throttle de cursor (2026-10-01)

**Iris_f00x** sumada al estudio: `/api/start` (Events API token), `/api/chaturbate-stats-token/set`
(Stats API, balance inicial confirmado: 2 tokens), contraseña temporal vía
`/api/models/set-password`, turno Tarde. Mismo flujo de 4 pasos para
cualquier modelo nueva futura — no hay un único endpoint "crear modelo",
son estas 4 llamadas admin en secuencia.

**Corrección real sobre el fix del 2026-09-26 (cache + throttle de cursor),
pedida por el usuario ("verifica consumo de Supabase... ¿nos estamos
pasando?") apenas se sumó la 8va modelo.** El throttle de `sbSaveCursor`
(máximo 1 PATCH cada N ms por modelo) se puso en 10s esa vez, asumiendo
que cortaría el volumen drásticamente. **Verificado con pg_stat_statements
real que eso era falso**: con el sistema ya totalmente recuperado y las 8
modelos activas normalmente (ventana de 16h, nada de outage de por medio),
el conteo de PATCH a `last_cursor` seguía subiendo a ~57.000/día — casi
igual a los ~59.000/día SIN NINGÚN control que había antes de toda la
crisis del 402. Causa: el ritmo natural de eventos por modelo ya rondaba,
en promedio, una frecuencia parecida a 10s, así que ese throttle rara vez
llegaba a activarse de verdad — el 23.000/día que se había calculado el
26 de septiembre como "ya arreglado" estaba midiendo un período que
incluía las ~34h de la caída total (con el tráfico en cero), no el
rendimiento real del throttle bajo operación normal. **Los otros dos
arreglos de esa misma fecha SÍ funcionan como se pensó** (el cache de 20s
sobre `buildModelReports` y el filtro de `userEnter`/`userLeave` en
`cb_unhandled_events`, este último confirmado en 0 inserciones nuevas
desde que se desplegó) — el error de cálculo fue específico al throttle de
cursor, no a los tres cambios en bloque.

**Fix real aplicado**: `CURSOR_SAVE_MIN_INTERVAL_MS` subido de 10s a 60s
— baja el techo real de 8.640/día/modelo a 1.440/día/modelo. Sigue siendo
100% seguro por el mismo motivo de siempre (documentado junto a la
constante y junto a `sbSaveCursor`): el `UNIQUE(username, event_id)` de
`cb_tips`/`cb_broadcast_events` bloquea cualquier evento reenviado tras un
resume con cursor algo viejo, así que no hay forma de duplicar plata
espaciando más el guardado — lo único que se arriesga es reenviar un
puñado de eventos ya vistos que la base ya sabe rechazar.
`npm test`: 134/134 sin cambios (no es lógica pura, no toca
`chaturbate-lib.js`).

**Lo que sigue sin poder verificarse desde este contenedor, decirlo
claro**: no hay ninguna herramienta MCP que muestre "GB de Egress/Log
Ingestion consumidos en lo que va de este ciclo" — solo `pg_stat_statements`
(conteo y tiempo de ejecución de queries, no bytes de red ni líneas de
log reales) y el dashboard de Supabase, al que esta sesión no tiene
acceso visual. Si se vuelve a pedir "revisa el consumo", el método es
este: comparar el conteo de `pg_stat_statements` de las queries más
pesadas contra un checkpoint anterior ya documentado (hay varios en este
archivo, con fecha), nunca asumir que un número aislado sin punto de
comparación significa algo.

## Revisión completa de pg_stat_statements (31 días) — segundo lever real encontrado (2026-10-01)

Pedido explícito del usuario tras el fix del throttle de arriba: "revisa
todos los datos históricos y da una solución de acuerdo a ello". Se agrupó
`pg_stat_statements` completo (desde el `stats_reset` del 31 de agosto, 31
días) por tabla y tipo de operación, ordenado por `calls` y por tiempo total
de ejecución — no solo las 2-3 queries que ya se conocían de la crisis.

**Hallazgo real, no estaba en los análisis anteriores**: `SELECT` a
`cb_tips` acumulaba **840 segundos de tiempo de ejecución total** — más que
cualquier otra consulta del sistema, incluida la UPDATE de `last_cursor`
(que gana en cantidad de llamadas pero es barata por llamada, 0.169ms).
Junto con ella, `cb_balance_ticks`, `cb_shifts`, `cb_stripchat_earnings`,
`cb_chaturbate_extra_earnings` y `cb_chaturbate_period_base` tenían todas
entre 45.000 y 150.000 SELECT — las mismas 6 tablas que `buildModelReports()`
lee en una sola corrida, confirmando que el patrón es uno solo: esa función
se sigue recalculando con más frecuencia de la necesaria.

**Dos arreglos aplicados, ambos de bajo riesgo y verificables:**

1. **`MODEL_REPORTS_CACHE_MS` subido de 20s a 60s** (server.js, mismo
   mecanismo de `buildModelReportsCached()` del 2026-09-26, sin tocar su
   lógica). El poll del frontend ya está en 180s (`pollTimer`,
   `index.html`) — un cache de 20s dejaba la mayor parte de ese margen sin
   aprovechar. 60s sigue siendo invisible para un dashboard de tokens/pago,
   igual que se razonó la primera vez con 20s.
2. **Dos índices nuevos en Supabase** (`add_created_at_indexes_for_studio_wide_range_scans`,
   vía `apply_migration`): `idx_cb_tips_created_at` en `cb_tips(created_at)`
   e `idx_cb_balance_ticks_sampled_at` en `cb_balance_ticks(sampled_at)`.
   Causa real del costo por llamada alto en `cb_tips` (5.7ms, el más caro
   de las consultas frecuentes): `sbFetchTipsInRange`/
   `sbFetchBalanceTicksInRange` filtran por fecha para TODAS las modelos a
   la vez, sin `username` (ver el bug de dinero del 2026-09-11, por diseño
   no filtran por modelo) — el único índice que ya existía en `cb_tips`
   empieza por `username`, así que Postgres no podía usarlo para un rango
   que no lo incluye y terminaba escaneando la tabla entera. Un índice
   simple sobre la columna de fecha sola resuelve esto. Migración pura,
   sin cambio de datos ni de comportamiento — mismo patrón que el "Cuarto
   arreglo fácil de la auditoría" del 2026-09-16.

`npm test`: 134/134 sin cambios (ninguno de los dos arreglos es lógica
pura). **No verificado con una medición de "antes/después" en vivo** —
igual que con el throttle de cursor, haría falta otro checkpoint de
`pg_stat_statements` más adelante para confirmar cuánto bajó de verdad el
volumen; la lógica y el mecanismo ya están verificados (tests, sintaxis,
`EXPLAIN` no corrido pero el patrón de índice es el estándar para este
tipo de filtro).

**Tercer lever, misma auditoría, cerrado el mismo día**: `cb_shifts`
(SELECT, 65.493 llamadas en los mismos 31 días — tercero más alto después
de `cb_tips`/`last_cursor`). `sbListShiftsCached()` (`server.js`), mismo
patrón exacto que `buildModelReportsCached`: envuelve `sbListShifts()` sin
tocarla, TTL 30s, aplicado en `GET /api/shifts` y `POST /api/shifts/claim`
(el chequeo de bloqueo por incumplimientos tolera 30s de margen de sobra,
no mueve plata). `checkShiftConfirmations()` (poller de 10 min) se dejó
con la llamada sin cache a propósito — su propio intervalo ya es 20x más
largo que el TTL, cachear ahí no aporta nada. `npm test`: 134/134 sin
cambios.

**Corrección del usuario sobre el alcance de esta auditoría — guía
permanente para cualquier sesión futura que toque el tema de consumo de
Supabase:** en algún punto de esta misma conversación interpreté mal un
pedido de investigación y me puse a comparar Supabase contra otros
proveedores (Neon, Railway, Render Postgres, etc.). El usuario cortó esto
en seco: *"dije investigar las soluciones en el Supabase, no que me buscar
las alternativas... me estoy refiriendo a que investigues las soluciones a
este tipo de proyectos, no que me des alternativas a un Supabase."* — y
más tarde, sobre el consumo en general: *"Debe ser error de código...
investiga todos los errores de código que tú mismo puedas tener."* Conclusión
para el futuro: **si el consumo de Supabase vuelve a dispararse, el primer
sospechoso es código propio de este proyecto (queries sin cache, sin
índice, o corriendo con más frecuencia de la necesaria) — no el proveedor.**
No proponer migrar de Supabase ni comparar proveedores salvo que el usuario
lo pida él mismo explícitamente; mantenerse en `pg_stat_statements` +
auditoría de los call sites en `server.js`, igual que las tres pasadas de
esta sesión.

## Pequeño desfase CSV-vs-Chaturbate en el corte de quincena (2026-10-01)

Al cargar el CSV histórico de Iris (recuperación post-caída, ver sección de
arriba) y compararlo contra la propia pantalla "Period Earnings" de
Chaturbate (captura real del usuario), el total calculado por
`sumChaturbateCsvEarningsForPeriod` dio 6725 contra 6723 oficiales — 2
tokens de diferencia. Causa: esa función corta el período comparando
`r.dateStr` (los primeros 10 caracteres del timestamp crudo del CSV, SIN
ajuste de zona horaria) contra `periodStartStr`/`periodEndStr` — si una
transacción cae muy cerca de la medianoche del corte, puede quedar del lado
equivocado según cuál zona horaria use Chaturbate internamente para su
propio corte de período, que no necesariamente coincide con el corte literal
del string de fecha del CSV. **Se guardó el número oficial de Chaturbate
(6723), no el calculado por el CSV** — criterio para cualquier caso futuro:
si el usuario tiene la pantalla oficial de Chaturbate, esa gana siempre
sobre el cálculo local del CSV.

**Chequeo de si esto afectó a las otras 6 modelos ya cargadas esta misma
sesión (amaranta, abigail, kitty, tamar4, jax, conni, pinky):** revisadas
las transacciones de cada CSV en la ventana 21:00-23:59 del 30 de
septiembre (el borde real del corte). `amaranta_f00x`, `abigail_f00x`,
`kitty_f00x` y `tamar4_f00x` solo tienen ahí líneas de "Tokens cashed out"
(negativas, ya excluidas del cálculo por el filtro `r.change > 0`) — sin
ninguna transacción POSITIVA pegada al borde, no hay mecanismo real para
que el desfase les afecte. `jax_f00x`, `conni_f00x` y `pinky_f00x` sí
tienen transacciones positivas en esa ventana (propinas/shows privados) —
ahí el mismo desfase de un par de tokens es posible, pero **no se puede
confirmar sin la captura de "Period Earnings" de Chaturbate de esas 3
modelos**, igual que se hizo con Iris (no hay forma de verificarlo por mi
cuenta — login a Chaturbate está prohibido por la regla de este archivo).
Si el usuario quiere el número exacto al 100% para esas 3, hace falta que
pida la misma captura; si no, el margen de error conocido es de un puñado
de tokens, no una cifra que mueva el pago de forma relevante.

## Simplificado "Marcar falta": un solo campo en vez de motivo+especificar+justificante (2026-10-03)

Pedido explícito con captura real: "La logica de justificar y especificar hace
lo mismo. Solo deja el justificante ya que sale dos veces en hoja y con una
palabra basta." El formulario tenía un select "Motivo" (3 opciones, una
"Otro" que abría un input "Especificar motivo") MÁS, si se marcaba "¿Envió
justificante?", un textarea "Justificante" aparte — dos campos de texto para
describir lo mismo. `public/asistencia.html`: se borraron `faltaMotivo`/
`faltaMotivoOtroWrap`/`faltaMotivoOtro`/`faltaJustificanteWrap` del HTML y del
mapa `el`; queda un solo `faltaJustificanteTexto` SIEMPRE visible (no detrás
del checkbox) + el checkbox "¿Envió justificante?" (que sigue existiendo,
controla si penaliza o no — eso NO es redundante, es una decisión de negocio
distinta de qué texto describe el día). `guardarFalta()` manda ese mismo
texto como `note` (siempre) y como `justification_body` (si está marcado el
checkbox) — antes había que escribirlo dos veces para el mismo caso ("Dia
Rojo" en el motivo Y "Dia rojo" otra vez en el justificante, viéndose en la
captura que disparó el pedido). **`server.js` no cambió** — `/api/attendance/day/no-show`
ya aceptaba `note`/`justified`/`justification_body` como campos independientes;
mandar el mismo texto en los dos ya resuelve la duplicación sin tocar el
backend. `node -c` + `npm test` 134/134 sin cambios (fix 100% frontend).

## "Entrar como ella" — admin accede a cualquier cuenta de modelo sin contraseña (2026-10-03)

Pedido explícito: "poder darle click sobre [una modelo] e iniciar sin
necesidad de contraseña a cualquier cuenta de modelo y poder volver a mi
cuenta admin sin problema." Botón nuevo "Entrar como ella" en Cuentas →
"Contraseñas y sesiones — modelos", junto a "Contraseña"/"Cerrar sesiones".

**Solo `administrador`, no `ceo`** — decisión deliberada, no pedida así mismo
por el usuario: esta card ya la ve CEO desde 2026-09-09 (puede resetear
contraseña/forzar logout de modelos), pero tomar la cuenta COMPLETA sin que
la modelo se entere es un nivel de acceso más alto que resetear su
contraseña — se restringió más a propósito. Si se pide que CEO también lo
tenga, es un cambio de permisos a pedir aparte, no algo que ya esté así.

**Mecanismo — importante entender esto antes de tocar nada de sesiones**:
las sesiones de este proyecto son un cookie firmado con HMAC
(`SESSION_SECRET`) SIN estado en el servidor (`signSession`/`verifySession`,
ver "Sesiones" arriba en server.js) — no hay tabla de sesiones activas donde
guardar "la sesión admin quedó en pausa" mientras se usa la de la modelo. La
solución: la identidad del admin que inició el préstamo viaja DENTRO del
mismo cookie firmado, en un campo `admin_return: {type, username, role,
gender}`. Como el cookie entero está firmado, nadie puede alterar ese campo
desde el navegador sin invalidar la firma completa (verificado a propósito,
ver abajo). Mientras dura el préstamo, la sesión actúa 100% como esa modelo
— mismo `type`/`role`/`v` que si ella hubiera iniciado sesión con su propia
contraseña — así que el admin ve EXACTAMENTE su panel (sin pestaña Cuentas,
sin nada de más), ni un panel especial de "admin viendo a través de ella".

- `POST /api/accounts/impersonate` `{username}` (admin-only): valida que la
  modelo exista (`sbFindModelAuth`), firma un cookie nuevo tipo `model` con
  su `session_version` actual + el `admin_return` embebido, y audita
  (`admin_impersonate_start`, target la modelo).
- `POST /api/accounts/stop-impersonation` (sin body): **no exige rol admin**
  — exige que el cookie ACTUAL traiga `admin_return` (osea, que de verdad se
  esté en un préstamo). Vuelve a traer la versión ACTUAL de la cuenta admin
  (`getSessionAccountInfo`, no la que viajaba guardada desde que empezó el
  préstamo) antes de firmar el cookie de vuelta — si en el medio alguien le
  reseteó la contraseña o le forzó el logout a ESE admin, "volver" respeta
  eso en vez de reabrirle una sesión vieja. Audita `admin_impersonate_end`
  con el admin como actor y la modelo como target.
- `GET /api/me` ahora devuelve `impersonating: {username: <admin>} | null`.
  `index.html`: banda roja nueva (`#impersonateBanner`, mismo estilo
  `.att-warning` que ya existía) entre el topbar y las pestañas, "ESTÁS
  VIENDO COMO X" + botón "Volver a mi cuenta admin" — se muestra/oculta en
  `showApp(session)` según ese campo. El botón está FUERA de cualquier tab
  panel a propósito: tiene que verse sin importar en qué pestaña esté parado
  (y mientras se está "siendo" la modelo, la pestaña Cuentas ni siquiera
  existe para volver por ahí).

**Verificado de verdad, no solo leído** (instancia `SOLO_UI=1` + un Supabase
falso en otro puerto que devuelve hashes de contraseña reales para dos
cuentas de prueba, igual al patrón ya usado en la sesión del freno de login
del 2026-09-16) — con curl, los 10 casos: login admin → impersonar →
`/api/me` confirma `role:modelo` + `impersonating` → volver → `/api/me`
confirma `role:administrador` sin `impersonating`; una modelo real
intentando `/api/accounts/impersonate` da 403; un admin que nunca impersonó
llamando a `stop-impersonation` da 403 "No estás en una sesión prestada";
**el cookie manipulado a mano (un carácter cambiado en el `admin_return`
embebido) da 401** — confirma que no se puede forjar desde el navegador;
**forzar el logout de la modelo MIENTRAS alguien la está impersonando
invalida esa sesión prestada también** (mismo chequeo de `session_version`
que ya protegía las sesiones normales, heredado gratis). Los audit log
quedaron con el admin real como actor en los dos eventos. Además, capturas
reales con Playwright confirmando visualmente la banda apareciendo/
desapareciendo y que la vista impersonada es la vista real de modelo (sin
pestaña Cuentas). `node -c` + `npm test` 134/134 sin cambios (ninguna lógica
nueva es pura, todo vive en `server.js`/frontend).

## Límite de excusas médicas subido de 2.5 MB a 5 MB (2026-10-03)

Pedido explícito, preguntando si 5 MB "es muy pesado": no lo es para este
caso (una foto de incapacidad médica desde el celular ya suele pesar
2-4 MB sin comprimir, así que el tope viejo de 2.5 MB probablemente
rechazaba fotos reales de cámara). `ATTENDANCE_EXCUSE_MAX_BYTES`
(server.js) subió de 2.5 a 5 MB. **Ojo con esto si se vuelve a tocar**:
hay un SEGUNDO límite, `ATTENDANCE_EXCUSE_BODY_LIMIT` — el tope del
cuerpo HTTP completo que entra a `readBody`, no el tamaño del archivo —
que también tuvo que subir (de 5 a 7 MB) porque el archivo viaja
codificado en base64 dentro del JSON, y eso infla el tamaño real ~33%
(5 MB de foto ≈ 6.7 MB en base64 solo, sin contar el resto del JSON). Si
algún día se sube el tope de archivo de nuevo, estos dos números van
juntos — subir solo `ATTENDANCE_EXCUSE_MAX_BYTES` sin tocar
`ATTENDANCE_EXCUSE_BODY_LIMIT` habría dejado un rango roto (ej. con el
viejo límite de 5 MB en el body, un archivo de 3.8-5 MB real pasaba la
validación de tamaño de archivo pero el cuerpo HTTP ya lo cortaba antes de
llegar, con el mensaje genérico "Archivo demasiado grande o inválido" en
vez del mensaje real). Se actualizaron los 3 lugares con el número viejo
hardcodeado: el mensaje de error del servidor, el check + mensaje del lado
del cliente en `index.html` (el único archivo con formulario de subida —
`asistencia.html` solo tiene el link de descarga, nunca subida) y el
comentario de `schema.sql`.

**Sobre el costo real de esto (el usuario no lo preguntó pero vale
dejarlo escrito, dado el historial reciente de cuota de Supabase):** el
archivo se guarda en base64 DENTRO de la fila de Postgres, no en un bucket
aparte — así que cada excusa ahora puede pesar hasta ~6.7 MB en la base en
vez de ~3.3 MB. Esto es tamaño de base de datos (`Database size`, hoy
174/500 MB en el plan gratis), no Egress/Log Ingestion (lo que causó la
caída de 402 de septiembre) — subir este límite no reintroduce ese
problema, porque no es tráfico recurrente: una excusa se sube una vez y se
descarga manualmente de vez en cuando, nunca en el polling de 3 minutos
(`sbListAttendanceJustifications` excluye `excuse_content_base64` del
select de siempre, a propósito, desde la fusión del 2026-09-22). El
volumen real de excusas subidas en la vida del proyecto hasta ahora es
bajo (un puñado), así que no hay riesgo inmediato — pero si esto se vuelve
un hábito frecuente de varias modelos, el tamaño de la tabla es la señal
a vigilar, no el tráfico.

Verificado de verdad con la misma instancia `SOLO_UI=1` + Supabase falso
de sesiones anteriores: tres archivos sintéticos (3.8 MB, 4.9 MB, 5.3 MB)
contra `/api/attendance/justification` con sesión de modelo real — los dos
primeros se aceptaron e insertaron con el `size_bytes` exacto esperado
(3.800.001 y 4.900.002), el de 5.3 MB se rechazó con el mensaje nuevo ("no
puede pesar más de 5 MB"). `node -c` + `npm test` 134/134 sin cambios (fix
de límites, no toca `chaturbate-lib.js`).

## Ajustes de celular: etiquetas, botones táctiles y formularios plegados (2026-10-20)

- Barra superior: en el celular, Anónimo/Mostrar, Avisos (campana) y Cerrar todo
  llevan etiqueta corta bajo el ícono. En escritorio siguen solo-ícono (pedido
  anterior que no se revirtió). `applyAnonButtonState` escribe "Anónimo"/"Mostrar"
  en el span; el title/aria-label sigue con el texto largo.
- Bajo 640px, los botones de Cuentas/Noticias/Asistencia tienen `min-height: 40px`.
  También `.att-sheet-link`, `.fix-btn` y los checkboxes (22px). `.newsTypeSelect`
  queda en 34px, porque a 40px se veía como un botón gordo.
- `details.fold`: "Publicar noticia" (`index.html`) y, en `asistencia.html`,
  "Agregar o corregir hora" y "Marcar falta" arrancan plegados. Así la tabla de
  jornadas queda arriba. `manualPrefill` abre `#manualFold` antes de hacer scroll.

## Domingos = día de extras + salida detectada por transmisión (2026-10-20)

- **Domingo** (`isStudioSunday(work_date)` en `chaturbate-lib.js`): ese día los
  horarios se cruzan (las de la mañana entran en la tarde y al revés), así que
  no cuenta como jornada normal. `sumLateMinutes`/`sumEarlyExitMinutes` lo
  saltan, y como el filtro va en la suma también aplica a domingos pasados.
  `/api/attendance/exit` no calcula salida temprano ese día, y
  `findPendingExcuses` lo ignora. `notifyAttendanceValidated` solo avisa "entró
  a las X (domingo)", sin retraso ni "todas a tiempo". `late_minutes` se guarda
  igual en la fila, pero no se cobra.
- `annotateSundays` (server.js) pone `d.special_day` = `'recuperacion'` si
  reclamó una recuperación ese domingo en `cb_shifts`; si no, `'extra'` (pudo
  ser algo hablado). Se usa en el payload actual y en el de historial. Ese día
  no se calculan horas transmitidas.
- Las dos hojas (`index.html` y `asistencia.html`) pintan la fila con
  `tr.day-extra` (verde) o `tr.day-recuperacion` (azul), con una etiqueta bajo
  la fecha y "domingo, no cuenta" en Retraso. Los botones de justificar se
  ocultan en esas filas.
- **Salida por transmisión**: si la modelo nunca toca "Salir",
  `checkAutoExits` usa `findBroadcastEarlyExit`. Toma el último `stop` dentro
  de su jornada; si no vuelve a transmitir en 3 h
  (`BROADCAST_EARLY_EXIT_CONFIRM_MS`), la salida queda a la hora de ese corte
  como `exit_source: 'temprano'` con `early_exit_minutes`, y se cobra igual que
  una salida temprano sin justificar. Mientras no pasen las 3 h, espera. Si sigue
  en línea al final o no hay eventos, la salida automática sigue como antes. No
  aplica el domingo. Se audita como `attendance_auto_exit_broadcast`.
- Prueba: 7 tests nuevos (151/151) y payload/capturas contra un Supabase falso.
  El poller real no se corrió localmente, porque sin `SOLO_UI` se conectaría a
  Chaturbate de verdad.
- Ojo al probar: `pkill -f "node server.js"` dentro de un comando compuesto
  mata la propia shell. Usa `kill` con el PID.
- **Extras/recuperaciones entre semana (misma fecha, segunda parte):** su turno
  normal se juzga igual. Si reclamó una extra o recuperación en el calendario y
  admin/CEO la marcó `cumplio`, `annotateSpecialShifts` (antes
  `annotateSundays`) pone `d.extra_shifts = [{kind, minutes}]` en la fila de
  ese día. `minutes` es lo que transmitió dentro de la ventana de la extra
  (`computeBroadcastSummary`). La hoja muestra, al lado de "Transmitido", una
  pastilla "+Xh extra" (verde) o "+Xh recup." (azul), y en Problemática la
  etiqueta "Hizo extra"/"Recuperó". Las que siguen pendientes o quedaron
  `no_cumplio` no salen. Si ese día no tiene fila de asistencia, no aparece en
  la hoja.

## Tabla de asistencia: "Novedad" en vez de "Problemática", justificante una sola vez (2026-10-20)

Pedido: el justificante salía dos veces, una como título (tipo) en
"Problemática" y otra como texto, y en una falta además el texto salía en
Entrada. "Problemática: hizo extra" tampoco tenía sentido. Así quedó, en las
dos hojas y en el CSV:
- **Novedad**: lo que pasó ese día según el sistema. Muestra "Falta" (rojo),
  "Falta justificada" (gris), "Hizo extra" (verde) o "Recuperó" (azul). Ya no
  muestra el tipo del justificante.
- **Justificante**: solo el texto. En una falta, si no hay fila de
  justificación aparte, muestra el `note` que escribió el admin, que sale del
  mismo campo del formulario.
- **Entrada** en una falta muestra "—", ya no el motivo.
- **Retraso** en una falta justificada muestra "—", no "a tiempo".
- El tipo del justificante (`kind`) se sigue guardando y sale en la lista de
  la card "Justificantes", solo que ya no en la tabla.

## Salida puesta a mano por el admin sí se ve y se puede justificar (2026-10-21)

Caso real: kitty y tamar4 salieron temprano el 2026-10-19, el admin les puso la
hora de salida a mano ese día, pero esas filas quedaron con `early_exit_minutes`
vacío (la edición se hizo antes de que `day/edit` calculara ese campo). Sin
minutos, no se cobraba y tampoco salía el botón "Justificar salida". Se arreglaron
las dos filas con un UPDATE (210 y 214 min, con registro en `cb_audit_log`,
acción `attendance_backfill_early_exit`). Además, la columna Salida muestra "−X
antes · sin justificar, se cobra" siempre que `early_exit_minutes > 0`, aunque la
hora la haya puesto el admin (`exit_source` null). La edición manual sigue sin
dejar rastro de que la hizo el admin. Solo se ve el hecho de que salió antes. Si
no hay justificante, se cobra. El botón "Justificar salida" está en la hoja
completa (`asistencia.html`), columna Corregir, solo para administrador.

## Cobro por salida antes de tiempo PAUSADO (2026-10-21)

Pedido del usuario: "no borrar la lógica, pero quitarlo un momento porque lo
voy a consultar con el dueño; que no aparezca el cobro por esos minutos". Quedó
detrás de un interruptor: `EARLY_EXIT_CHARGE_ENABLED = false` en
`chaturbate-lib.js`. Con eso en false:
- `sumLateMinutes`/`sumEarlyExitMinutes` NO suman `early_exit_minutes`, así que
  no afecta retraso acumulado, deuda ni seguridad social. El retraso de entrada
  sigue igual.
- La hoja solo informa "salió −3 h 30 min antes", sin "se cobra" ni "sin
  justificar". Los botones "Justificar/Rechazar salida" no salen. La card
  "Justificantes por revisar" no lista salidas (`findPendingExcuses`). Los
  payloads mandan `early_exit_charge` para que el frontend lo sepa.
- Sigue calculándose y guardándose `early_exit_minutes` (salida manual,
  salida de la modelo, salida detectada por transmisión), así que al reactivar
  no se pierde nada. Para reactivar, pon el interruptor en `true`. Los tests
  usan `{ chargeEarlyExit: true }` para probar la lógica completa.
- Las filas corregidas a mano el 2026-10-21 (kitty 210 min, tamar4 214 min del
  19 de octubre) quedaron guardadas, pero no cobran mientras esté pausado.

## Borrar una modelo de verdad (2026-10-22)

`/api/delete` antes solo borraba la fila de `cb_models` y respondía "ok" aunque
fallara: balances, bases de quincena y otras tablas la referencian sin
`ON DELETE CASCADE`, así que el borrado se rechazaba en silencio. Ahora
`sbDeleteModel` borra primero lo dependiente (tandas de 1.000 para las tablas
grandes: eventos sin clasificar, balances, propinas, transmisiones, porque el rol
anon corta consultas largas), después asistencia, horarios, Stripchat, bases de
quincena, suscripciones push y lecturas de noticias, y al final la modelo.
Devuelve error (500) si la fila sigue ahí. Las noticias y comentarios que
escribió se dejan. El botón "Eliminar" de Modelos ahora muestra el error si falla.
Antes de borrar a amaranta y kitty se guardaron sus números de la quincena
16–31 de octubre en `cb_audit_log` (acción `delete_model_snapshot`): amaranta
Chaturbate 0 + Stripchat 286, kitty Chaturbate 137 + Stripchat 960.
La herramienta de SQL del MCP de Supabase se cuelga con cualquier DELETE (ni una
sola fila pasa): no la uses para borrar, usa el endpoint de la app.
La tienda usa otra base de datos que este MCP no ve: ahí se desactivan o borran
las personas desde el panel de la propia tienda.

## Corrección quincena 1–15 nov y ventana de sondeo post-corte (2026-11-17)

Contra las pantallas oficiales "Period Earnings" de Chaturbate (capturas del usuario), el sistema
tenía de menos: jax +20, conni +55, pinky +21, iris +30 (abigail exacta). Se fijaron con
`cb_chaturbate_period_base` (period 2026-11-01..15, `covers_until` 2026-11-16 04:30 UTC,
`manual-correction`, `Elemee-correccion-2026-11-17`). Los totales de Stripchat no se pueden
contrastar desde aquí. Causa: el vaciado real a veces cae unos minutos DESPUÉS de las 04:30 UTC
(conni 2026-11-12 sumaba a las 04:30:02 y el retiro se vio a las 04:36) y fuera de la ventana el
sondeo era cada 2 min. Fix: `CASHOUT_POST_WINDOW_MINUTES = 6` en `chaturbate-lib.js` — se sigue
sondeando cada 60 s (misma frecuencia de siempre, NO subirla) hasta 04:36 UTC. Si vuelve a
aparecer un 403 en esa franja, volver a revisar `cb_api_errors` antes de tocar nada.
Si el usuario manda otra captura "Period Earnings" que no cuadre, repetir la corrección igual.
