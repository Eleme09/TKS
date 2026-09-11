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
