# Historial — PLACER SERVICES

Este archivo NO se carga automático en las sesiones de Claude Code (a
diferencia de `CLAUDE.md`, que sí). Léelo solo cuando necesites el
detalle de cómo se llegó a una decisión, un incidente puntual, o el
rastro día a día de algo — no para trabajo normal. `CLAUDE.md` tiene
las reglas y el estado actual; esto es la bitácora.

## 2026-09-02

**Push notification bug en iPhone, resuelto.** Dos cosas:
1. El usuario estaba en **Safari** en iPhone, no Chrome como creía
   (confirmado por captura — chrome de Safari, ícono sparkle/AI en la
   barra de direcciones). No es bug real: Apple solo expone la Push API
   en iOS cuando la página está instalada en la pantalla de inicio — un
   tab de Safari (o cualquier navegador iOS, todos WebKit por debajo)
   nunca tiene `PushManager`, por diseño de la plataforma.
2. El bug real: el handler de `el.btnEnablePush` chequeaba
   `pushUnsupportedReason()` genérico ANTES que el chequeo específico de
   iOS (`isIos() && !isStandalone()`), así que los usuarios de iOS veían
   el mensaje genérico "no soportado" en vez de las instrucciones
   accionables de "agregar a pantalla de inicio primero". Arreglado
   reordenando — el chequeo de iOS corre primero ahora.

Lección: ante un reporte de "mensaje de capacidad del navegador raro",
pedir captura antes de asumir que el código está mal — "estoy en Chrome"
no es autorreporte confiable en iOS, donde todo navegador es WebKit por
debajo y el usuario a veces no distingue.

**Desprendibles payslip history, rediseñado.** Las filas de historial por
quincena en `refreshPayslips()` eran una sola línea densa de texto
(período + estado + tokens + desglose CB/SC + USD + COP todo concatenado
con " · "), difícil de leer sobre todo en móvil. Reescrito para reusar
las clases `.model`/`.model-head`/`.model-grid`/`.stat`/`.stat.hero` que
ya usan las cards de la pestaña Modelos — bloques etiquetados Tokens/
Desprendible en vez de una oración corrida, mismo tratamiento de íconos
de plataforma que las cards de modelo. Si se toca el markup de las cards
de nuevo, revisar si las filas de payslip necesitan el mismo cambio (y
viceversa) — quedaron visualmente pareadas por diseño.

**Más arreglos, misma tarde:**
- El formulario de pegar-y-parsear de Stripchat se sacó de la UI por
  completo una vez que el auto-sync de la Studio API lo hizo redundante
  (pedido explícito: "bórralo"). Los endpoints del backend
  (`/api/stripchat/parse`, `/api/stripchat/save`) quedaron intactos,
  dormidos, como fallback manual si la API key se rompe algún día — solo
  el frontend dejó de llamarlos.
- Archivos estáticos ahora mandan `Cache-Control: no-cache`
  (`serveStatic` en server.js). Sin esto, un navegador podía seguir
  sirviendo un `index.html` viejo tras un deploy — causa sospechada de
  un reporte de que una feature recién publicada "no estaba" en la PC
  del usuario.
- Bug de `tag` en push, arreglado: `sw.js`'s `showNotification` usaba un
  tag fijo (`'placer-online'`) para TODO tipo de push — los navegadores
  reemplazan en silencio una notificación mostrada por una nueva que
  comparte tag, así que una notificación de noticias podía tapar una de
  estado-online sin volver a alertar. Ahora cada call site pasa su
  propio `tag` en el payload del push
  (`sendPushToRole(role, body, { tag, excludeUsername })`), y `sw.js`
  cae a un `'placer-' + Date.now()` único si no viene ninguno.
- Las publicaciones de Noticias ahora mandan push (`sendNewsNotification`)
  a todos los suscriptores salvo el propio autor. Se diagnosticó por qué
  las notificaciones "online" parecían nunca llegar: a esa fecha, las
  únicas suscripciones en `cb_push_subscriptions` eran de `Elemee`
  (administrador, 3 dispositivos) — ninguna cuenta `ceo` había tocado la
  campana nunca. Como "modelo conectada" es deliberadamente solo-CEO,
  nunca hubo destinatario válido — comportamiento correcto, no bug.
- `logo-icon.svg` (archivo nuevo) es `logo-placer-studios.svg` más un
  `<rect>` opaco de fondo, usado solo para favicon/apple-touch-icon/
  manifest icon. Deliberadamente separado del archivo original —
  `logo-placer-studios.svg` también es el `background-image` CSS del
  logo en página (`.brand-cat`/`.login-bg-cat`), que necesita quedar
  transparente. Se erró una vez esa misma tarde (se editó el archivo
  compartido directo, oscureciendo el logo en página por accidente,
  el usuario lo notó de inmediato).
- `.time12 select` (los pickers de hora/minuto/AM-PM en Extras) ahora usa
  una flecha compacta custom (`appearance: none` + chevron SVG inline) en
  vez de la flecha nativa de cada navegador, que quedaba apretada en
  selects tan angostos — mejor esfuerzo ante un reporte de "íconos
  superpuestos" en ese picker en móvil; sin confirmar en dispositivo real.

**Push abierto a `modelo` también, más tarde todavía.** Originalmente el
push (`/api/push/*`, el botón de campana) estaba limitado a
administrador/CEO — se construyó antes de que existiera Noticias. Una vez
que Noticias se volvió algo que las modelos leen y comentan, ese límite
dejó de tener sentido. Verificado que `sendPushToRole` acepta un rol, un
array de roles, o `null` (todos).

Suscripciones de push son **por dispositivo**, no por cuenta — suscribirse
en la PC no activa notificaciones en el teléfono, y viceversa. Confirmado
vía la tabla real `cb_push_subscriptions` más de una vez esa tarde que
esto — no un bug de código — estaba detrás de más de un reporte de
"no me llegan las notificaciones".

**Bug real encontrado ese día, del lado de la base, no del código:** abrir
`/api/push/subscribe` a `modelo` no alcanzaba — `cb_push_subscriptions`
todavía tenía una foreign key vieja,
`cb_push_subscriptions_username_fkey`, atando `username` a
`cb_admins(username)` solamente (de cuando esta tabla era solo admin/CEO).
Cualquier modelo intentando suscribirse recibía una violación de FK
`23503` silenciosa. Se eliminó la constraint.

## 2026-09-03

**`sbLogApiError` abierto a `administrador` (push).** Cada falla de la
Stats API de Chaturbate/Stripchat ahora también empuja una notificación
inmediata (tag `placer-api-error`) en vez de esperar solo al chequeo
diario del vigía o una consulta manual a `cb_api_errors`. Escopado a
`administrador` solamente (no `ceo`, por pedido explícito) ya que es el
mismo tipo de alerta técnica/accionable que una caída de conexión — un
rol que no puede actuar sobre ella no necesita que lo despierte. Verificado
en vivo con un endpoint temporal `GET /api/test-error-notification`
(desplegado, probado una vez, eliminado — sin rastro en el código).
`npm test` 32/32 en ese momento.

**Chaturbate income beyond public tips — investigación completa.**

El problema, encontrado por el usuario comparando números reales: la
Events API solo dispara `tip` para propinas públicas en sala. Chaturbate
también paga por shows privados, spy shows, fan club joins y compras de
contenido, y casi nada de eso llegaba como evento de la Events API en ese
momento (esto se corrigió parcialmente al día siguiente, ver abajo).

Para pinky_f00x esto fue un subconteo del 63%: 71 tokens contados vs 192+
reales para los mismos días, y el número propio del tracker para su
quincena ago 16-31 quedó **11.898 tokens** corto de su total real de
Chaturbate antes de este arreglo.

**Corrección (2026-09-03, más tarde el mismo día):** una versión anterior
de esta nota describió esa brecha de 11.898 tokens como plata que la
modelo ya había dejado de recibir y solo se recuperó gracias a este
arreglo. El usuario corrigió eso: está mal. A Pinky se le pagó
correctamente esa quincena de todas formas — la brecha era solo en el
número propio del dashboard de este sistema, consecuencia de estar mal
configurado contra la API de Chaturbate (solo propinas públicas), no una
falta real en lo que recibió. No citar este episodio como "a una modelo
le pagamos de menos y lo agarramos" — la afirmación correcta es más
angosta: el total del tracker estaba mal por esa cantidad antes del
arreglo, que sigue siendo la razón real por la que importa el arreglo de
polling de balance (`resolveChaturbateTokens`, tracking en vivo) — un
número de dashboard incorrecto es un problema real en sí mismo aunque esa
vez no haya terminado causando un pago de menos real.

Lo que se descartó, y por qué (no re-litigar sin evidencia nueva):
- **Login scripteado/automatizado** (Playwright/Puppeteer logueándose a
  chaturbate.com para scrapear la página de Earnings/Token Stats) — postura
  más dura que la regla de login de Stripchat: no es solo "no lo hagas",
  está verificado técnicamente bloqueado. Un `curl`/`fetch` sin autenticar
  a `https://es.chaturbate.com/tipping/csv/history/` redirige a
  `/auth/login/` y ese mismo redirect de login devuelve un challenge de
  bot de Cloudflare ("Just a moment…") en la primera solicitud —
  confirmado en vivo, no teórico.
- **Campo `tips_in_last_hour` de la Stats API** — confirmado vía la
  documentación propia de Chaturbate (`chaturbate.com/statsapi/authtoken/`,
  capturada por el usuario) que está limitado a propinas solamente, misma
  categoría que la Events API ya da en vivo y con más precisión.
- **API de "estadísticas de afiliado"** (`/affiliates/apistats/`) —
  estadísticas de referidos, no relacionado con ganancias de sala propia.
- **CB Cam Insights** (herramienta de terceros) — investigada a fondo;
  solo lee el feed de propinas en vivo visible durante una transmisión,
  mismo alcance que la Events API propia. No es una pista.

Lo que sí funciona, en orden de cómo se encontró:

1. `cb_unhandled_events` — el switch de eventos de `pollLoop` ahora tiene
   un catch-all `else` que loguea cualquier método de evento que no
   maneja, en vez de descartarlo. Fire-and-forget (diagnóstico, no
   dinero). Chequear periódicamente
   (`select method, count(*) from cb_unhandled_events group by method`)
   por si Chaturbate empieza a mandar un tipo de evento con tokens
   adentro.

2. Backfill histórico por CSV (`cb_chaturbate_period_base`). Chaturbate
   deja a una modelo descargar su propio ledger de transacciones completo
   desde su sesión logueada — un botón real, no scraping. Sumar cada fila
   positiva de "Token change" en un rango de fechas reproduce el número
   "Ganancias del período" propio de Chaturbate exactamente — verificado
   token por token contra la UI real (289 y 11.906 para dos períodos
   distintos, ambos exactos). Usado una vez para rellenar la quincena
   actual + anterior de las 6 modelos.
   - Gotcha de retención, verificado con datos reales: el export solo
     cubre ~30 días de detalle línea por línea. Una quincena que empieza
     antes de la fila más vieja del archivo queda silenciosamente
     incompleta (se agarró un caso: el archivo decía 4549, el total real
     era 6829). `oldestDateStr` se chequea por período antes de guardar;
     un período no cubierto se salta y se reporta `saved: false`.
   - `covers_until` se marca en el momento de la SUBIDA, no el timestamp
     de la última fila del CSV — deliberadamente conservador.
   - **UI para esto se sacó el mismo 2026-09-03**, una vez que el tracking
     en vivo (abajo) cubrió las 6 modelos. El endpoint
     (`/api/chaturbate-csv/upload`) sigue intacto y llamable directo como
     fallback dormido.

3. Tracking automático en vivo (`cb_models.stats_api_token` /
   `last_balance` / `last_balance_at`, `cb_balance_ticks`,
   `cb_balance_resets`). Chaturbate tiene una segunda API oficial,
   autenticada por token (no login):
   `https://chaturbate.com/statsapi/?username=X&token=Y`. Su campo
   `token_balance` es el balance de billetera que se ve arriba en la UI
   de Chaturbate, y sube por CUALQUIER categoría de ingreso. Chaturbate
   corre un cashout diario automático que vacía el balance a exactamente
   $0 (verificado en el CSV real: toda fila "Tokens cashed out" termina en
   balance de precisamente 0). Sumar el balance pre-cashout de cada día
   reproduce el total oficial exactamente.
   - `pollChaturbateBalances()` compara el nuevo balance con
     `last_balance`: un aumento es ganancia real nueva → fila en
     `cb_balance_ticks`; una baja es el cashout diario, no una pérdida →
     logueada en `cb_balance_resets` para auditoría, nunca restada de nada
     ganado.
   - Dense polling antes del cashout diario: `isNearChaturbateCashout`
     sube el sondeo en la ventana 04:18–04:30 UTC.
   - `pollChaturbateBalances` tiene guard de reentrancia
     `balancePollRunning` (agregado en el code-review del 2026-09-03) —
     sin esto, un ciclo lento durante la ventana densa podía superponerse
     con el siguiente y duplicar el mismo tick.
   - Activado por modelo vía `POST /api/chaturbate-stats-token/set`
     (admin-only), que valida el token contra la API real antes de
     guardar. Las 6 modelos fueron activadas el 2026-09-03.

`resolveChaturbateTokens` — con una fila base de CSV para ese período, el
total es `base_tokens + max(ticks de balance después de covers_until,
propinas después de covers_until)` — el máximo, no solo ticks. Bug real
agarrado en el review del 2026-09-03: tomar solo ticks congela en
silencio el total de una modelo en la base del CSV para siempre si nunca
se le activó un `stats_api_token` (el listener de propinas de la Events
API corre para TODA modelo sin importar si se le está sondeando el
balance).

Limitación conocida, no arreglada: el bucketing de fecha del CSV toma los
primeros 10 caracteres del timestamp sin conversión de zona horaria desde
el reloj Pacific de Chaturbate. Puede correr un puñado de tokens justo en
la medianoche entre dos quincenas adyacentes. Verificado que el efecto es
despreciable en los dos períodos probados.

## 2026-09-04

**Corrección importante sobre `mediaPurchase` (encontrada por el vigía
diario).** Una versión anterior de la nota del 2026-09-03 decía que NADA
de lo de privados/spy/compras llegaba nunca como evento, "solo
userEnter/userLeave/follow". Eso ya no es cierto: `cb_unhandled_events`
registró **`mediaPurchase`** con tokens adentro, en
`object.media.tokens` — tres compras de contenido de abigail_f00x el
2026-09-03 (125, 130 y 66 tokens, mismo comprador). O sea que las compras
de contenido SÍ llegan por la Events API, con el monto exacto. Con el
tiempo también aparecieron `privateMessage`, `chatMessage`,
`roomSubjectChange` y `unfollow`, sin tokens. Los privados y spy shows
siguen sin aparecer. Esa plata no se perdió: abigail tenía
`stats_api_token` activo y los ticks de balance de esa franja (76 a las
18:48, 501 a las 18:54, 395 a las 19:00) cubren los 321 tokens de sobra.
Verificado fila por fila. `fanclubJoin` todavía no ha aparecido.

**Incidente de bloqueo masivo y falsa alarma sobre la hora de cashout —
leer antes de tocar el sondeo denso.** La primera noche que corrió el
sondeo denso (cada 20s × 6 modelos = 18 consultas/min), Chaturbate
devolvió HTTP 403 a TODO, de 04:23:00 a 04:40:40 — 174 errores en
`cb_api_errors`, todas las modelos, todas las consultas. Dos
consecuencias:
1. El bloqueo cayó justo encima del corte diario — última lectura buena
   antes: 04:21:40, siguiente: 04:40:40. 19 minutos ciegos.
2. Se sacó una conclusión falsa: como los tres retiros (jax_f00x
   1314→24, abigail_f00x 1925→0, pinky_f00x 420→2) quedaron con
   `detected_at` = 04:40:40, pareció que el corte real era ~10 min más
   tarde, y se movió la ventana a 04:15–04:45. Estaba mal: 04:40:40 es
   solo cuándo la API volvió a responder, no el momento del corte. Ya se
   revirtió. **Regla:** un `detected_at` de `cb_balance_resets` solo
   significa algo si hubo lecturas exitosas continuas antes — cruzar
   SIEMPRE contra `cb_api_errors` en esa franja antes de concluir nada
   sobre la hora.

Arreglos que quedaron: sondeo denso a 60s en vez de 20s
(`BALANCE_DENSE_EVERY_TICKS`) — la propia Stats API se refresca sola cada
5 min según la documentación de Chaturbate, así que consultar cada 20s no
daba dato extra, solo bloqueo; y un cooldown de 5 min ante 403/429
(`BALANCE_RATE_LIMIT_COOLDOWN_MS` + `chaturbateRateLimitedUntil`) — ese
día se siguió golpeando la API 17 minutos seguidos, lo que probablemente
estiró el bloqueo. No volver a subir la frecuencia del sondeo "para no
perderse el pico" — eso fue justo lo que lo provocó.

**Segundo patrón distinto, mismo día, tarde (~18:00-22:00 UTC):** un HTTP
403 aislado en `chaturbate_stats`, uno por hora, cada ~62 minutos, siempre
en el minuto ~42-50, rotando de modelo. No es el mismo bloqueo masivo
(ese fue 17 min seguidos a las 6 modelos a la vez). Verificado con SQL
real. Esa regularidad tan exacta no encaja con flakiness random ni con
nada propio del proyecto — apunta a algo del lado de Chaturbate que se
repite cada hora. No confirmado. Cada vez se recuperó solo en la
siguiente consulta.

**Uptime a plan pago de Render** (confirmado por el usuario en chat, no
verificado independientemente). Ya no aplica el problema del free tier;
UptimeRobot quedó redundante.

**Asistencia — feature completa agregada este día.** Ver `CLAUDE.md` para
el estado final vigente. El margen de tolerancia de 12 min
(`ATTENDANCE_GRACE_MINUTES`) y por qué es confidencial está documentado
ahí, no repetido acá.

**Gotchas de pruebas contra la base real, este día:**
- Al probar el borrado de asistencia se tomó `days[0]` de la respuesta
  para probar, y esa fila resultó ser del usuario real, no de una cuenta
  de prueba — se borró una jornada real (se pudo restaurar desde
  `cb_audit_log`). Nunca agarrar "el primero de la lista" en una base
  compartida — filtrar por el prefijo de las cuentas de prueba.
- Una fila de prueba en `cb_models` con `role: 'modelo'` la levanta el
  poller de Stripchat de PRODUCCIÓN (no un scratch aparte), pidiendo sus
  ganancias y comiéndose un 404 por ciclo, ensuciando `cb_api_errors` y
  pudiendo disparar una falsa alarma del vigía. Pasó con dos cuentas
  `qa_asist_*`; se borraron a mano.

## 2026-09-05

**Confirmado día 2 del patrón de 403 horario.** Siguió toda la noche
igual — 18 errores en 24h, ~1 por hora, rotando entre las 6 modelos, cada
vez recuperado en la siguiente consulta. Ni escaló ni bajó de frecuencia.
El vigía de ese día no avisó — deliberado, continuación de un patrón ya
diagnosticado sin nada nuevo.

**Aviso de seguridad social — se hizo configurable, y se corrigió un
error metodológico propio.** Cuando se agregó
`cb_attendance_settings.social_security_enabled`, esta misma clase de
sesión afirmó con seguridad que "no existe ni existió un techo de $50.000
que resetea la multa a 0" — eso era falso. El error fue metodológico: se
verificó contra un checkout local desatrasado sin traer `origin/master`
primero primero, justo lo que "Antes de tocar nada" pide no hacer. Otra
sesión, en paralelo el mismo día, ya había confirmado con el usuario y
mergeado `lateDebtCopCapped` a `master`. Lección: `git fetch origin
master` y comparar antes de afirmar categóricamente "esto no existe",
sobre todo en un proyecto editado desde varios dispositivos en paralelo.
El estado final de este tope está documentado en `CLAUDE.md`, sección
Business rules → Asistencia.

Probado en vivo contra la base real: cuenta admin temporal
(`qa_temp_admin`), instancia `SOLO_UI=1` en otro puerto.

## 2026-09-06

**Día 3 del patrón 403 horario — primera variación real, todavía menor.**
24 errores en 24h, mismo patrón, pero por primera vez dos cayeron
separados solo 7 min (04:25:32 tamar4_f00x, 04:32:32 jax_f00x) en vez de
los ~62 min habituales. Técnicamente cumple el criterio de "dos en la
misma hora", pero en sustancia sigue siendo el mismo tipo de fallo:
aislado, autorecuperado, nunca las 6 a la vez. No se avisó — un solo blip
de 7 min no es la escalada sostenida que ameritaría alerta.

## 2026-09-09

**Filtro de racha en `sbLogApiError`.** Tras 5 días seguidos del mismo
patrón horario benigno, `sbLogApiError` estaba mandando push+correo cada
~62 min sin aportar nada nuevo — el usuario pidió explícitamente reducir
el ruido. Se agregó `isHttpStatusApiError`/`evaluateApiErrorBurst` en
`chaturbate-lib.js` (con tests que reproducen tanto el patrón de 5 días
como el incidente real del 2026-09-04). Estado final documentado en
`CLAUDE.md`.

**Día 6 del vigía — el patrón cambió de forma, todavía benigno.** Ya no
es solo HTTP 403 — aparecieron 429, 500, 503 y 504 mezclados. El
2026-09-08 a las 14:07:17 hubo un burst real de 4 (504/503 en el mismo
segundo, 4 modelos) — cruza el umbral y el filtro nuevo lo habría marcado
como racha correctamente. Se concentró de forma desigual en kitty_f00x
(19 de 30 errores de las últimas 24h) — verificado que NO es un token
vencido (`last_balance_at` tan fresco como cualquiera). No se avisó — nada
tocó la plata ni dejó a nadie con el balance atascado.

**Cuatro features + un quinto agregado a mitad de sesión.** Implementados
este día: edición manual de hora con creación de fila si no existe, salida
automática tras 1h sin marcar, cambio hilo↔aviso post-publicación,
confirmación de extra/recuperación 6h antes + botón manual, y horas
transmitidas con color en la hoja de asistencia. Estado final de cada uno
documentado en `CLAUDE.md`. Probado end-to-end contra el Supabase real
(`SOLO_UI=1`, cuentas `qa_temp_admin`/`qa_temp_model`, borradas al
terminar). `npm test`: 105/105.

**Corrección la misma tarde: edición manual de horas debe ser invisible.**
El usuario corrigió apenas lo vio en uso: "A la hora que yo coloque, se
vera como si la Modelo entro o salio a esa hora. No que yo edite o que
ella reporto otra hora." `/api/attendance/day/edit` dejó de guardar
`official_source: 'manual'`/`exit_source: 'manual'` y pasó a pisar
`reported_at` con la misma hora que el admin puso, indistinguible de una
entrada/salida normal en tabla y CSV. Se sacó también el push de
`notifyAttendanceValidated` que este endpoint mandaba (pedido explícito:
cero avisos desde `day/edit`). El registro interno en `cb_audit_log` se
mantuvo intacto — la trazabilidad para el propio admin no es lo que se
pidió esconder. Estado final ya reflejado en `CLAUDE.md`, no como
corrección aparte.

**Bugs visuales encontrados con Playwright.** Reporte del usuario:
"veo botones unos encima de otro" + "el cuadro de aviso o anuncio no es
distinto el uno del otro". Diagnosticado con Playwright contra una
instancia `SOLO_UI=1` en vez de adivinar a ciegas:
1. El `<select>` de tipo de Noticias se estiraba al ancho completo de la
   card — causa: `index.html` tiene una regla global `input, select {
   width: 100%; }` que le gana a cualquier estilo inline sin `width`
   explícito. Regla para el futuro: cualquier `<select>` nuevo que deba
   verse como badge/pill necesita `width:auto; display:inline-block;`
   explícito en su propio estilo inline.
2. La columna "Corregir" de `asistencia.html` (3 botones) quedaba
   apretada sin `min-width` propio. Fix: `.fix-actions` con
   `min-width: 200px`, `min-width` de la tabla subió de 900px a 1000px.

Método que sirvió, repetible ante un reporte visual sin captura:
`npm install playwright` en `/tmp` (fuera del repo) con
`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` y
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (Chromium ya preinstalado, usar
versión reciente de playwright, no una vieja fija — v1.48 chocó con el
binario preinstalado, v1.63 sí funcionó). Lanzar con
`executablePath: '/opt/pw-browsers/chromium-<build>/chrome-linux/chrome'`
y `args: ['--no-sandbox']`. Cuentas de prueba creadas y borradas en la
misma sesión.
**Falso positivo a no perseguir:** en una captura `fullPage` de
Playwright, la barra de pestañas fija (`position:fixed`) aparece flotando
encima del contenido de más abajo — artefacto de cómo Chromium compone el
`fixed` al capturar más allá del viewport, no un bug real.

**Desprendible del estudio — tarifa distinta, corregida el mismo día.**
Se implementó primero en 0.5 (error de un orden de magnitud) — el usuario
avisó que el número real es 0.05 y se corrigió de inmediato. Verificado
las dos veces contra el Supabase real: con 0.5 dio 71.819 tokens × 0.5 ×
$2.922 = $35.909,50 USD; con el 0.05 correcto, 72.687 tokens × 0.05 ×
dólar Paxum dio $3.634,35 USD ≈ $10.620.797 COP — el número que quedó en
producción. Estado final (tasa, gate admin+ceo) en `CLAUDE.md`.

**Limpieza de código muerto + Cuentas también para CEO.** Auditoría
pedida explícitamente ("verifica toda la web de funciones que no
necesitemos"): grep sistemático de funciones JS sin uso y endpoints sin
caller. Se encontró y borró `fmtPayout(m)` en `index.html` (huérfana). Se
confirmó que no hay funciones huérfanas en `server.js` (135 funciones,
todas con al menos un caller). Los únicos endpoints sin caller en
frontend son los tres ya documentados como dormidos a propósito. Método
para repetir esta auditoría: `grep -oE "function NOMBRE\("` contando
ocurrencias por archivo, cuidado con falsos positivos de IIFEs (cuentan 1
sola vez en grep de texto plano aunque sí se ejecuten).
Gotcha de esa misma sesión: al probar `/api/accounts/logout-everywhere`
con `type:'model'` se usó por descuido `amaranta_f00x` (modelo real) en
vez de una cuenta `qa_temp_*` — le forzó un cierre de sesión real (sin
consecuencia real, pero exactamente el tipo de descuido a evitar).

**Panel de retraso/motivación — tres pasadas el mismo día.** Se
implementó, luego se corrigió el tono (nada de voseo — varias frases y
textos cercanos usaban "vos"/"sos"/modismos rioplatenses, corregidos a
tuteo neutro), la frecuencia (9s→5s, 7→10 frases), la tipografía (a
'Unbounded' itálica), y el color (rosa neón → blanco `var(--text)`, pedido
explícito: "Déjala blanca con el concepto que tienes"). Después una
segunda pasada: tamaño de fuente 12.5px→10.5px, se abrió a los 3 roles
(antes solo modelo), y se instrumentó un muestreo de opacidad/texto cada
60ms (90 muestras) para investigar un reporte de "frases sobrepuestas" —
no se pudo reproducir un solape real, pero se encontró un punto no
defendido (`bannerPhraseTick` no guardaba referencia al `setTimeout`
pendiente, así que dos ticks superpuestos en el tiempo podían escribir
sin orden garantizado) y se corrigió guardando el timer en
`el._phraseFadeTimer`. La animación pasó de fade plano 0.6s a fade+slide
0.45s con `cubic-bezier(.2,.8,.3,1)` (misma curva que `.tabpanel`).
Estado final consolidado en `CLAUDE.md`, sin el historial de iteraciones.
