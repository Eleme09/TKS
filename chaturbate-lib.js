// Funciones puras (sin fetch, sin Supabase, sin estado de red) que hacen los
// calculos de dinero y fechas del proyecto. Separadas de server.js
// unicamente para poder testearlas sin levantar el servidor completo
// (server.js exige las variables de entorno de Supabase y arranca el
// polling real apenas se lo importa). Cualquier cambio en el calculo de
// quincenas, en como se reconcilian tips/balance/CSV, o en la ventana del
// retiro diario de Chaturbate, va aca — server.js solo hace require() de
// este archivo.

const crypto = require('crypto');

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Quincena del estudio: dia 1-15 se paga el 20 del mismo mes;
// dia 16-fin de mes se paga el 5 del mes siguiente.
//
// BUG REAL arreglado 2026-09-16: esto se calculaba con `new Date(now)` +
// getters locales (getFullYear/getMonth/getDate), que devuelven el dia segun
// la ZONA HORARIA DEL PROCESO DE NODE -- en Render eso es UTC, no Colombia.
// Resultado: la quincena cambiaba a las 00:00 UTC = 7:00 p.m. hora Colombia,
// 5 horas ANTES de lo que le tocaba. Detectado en vivo el mismo 2026-09-16:
// a las 00:37 UTC (7:37 p.m. Colombia) el sistema ya mostraba la quincena
// nueva con los totales en 0.
//
// CORREGIDO OTRA VEZ el mismo dia (segunda vuelta): el usuario pidio primero
// que el corte fuera 23:30 Colombia (el retiro automatico de Chaturbate) en
// vez de medianoche -- eso ya NO es la frontera de quincena (ver mas abajo),
// pero sigue siendo el corte de un DIA DE NOMINA cualquiera
// (`payrollDateStr`/`toDateStr`, usado para etiquetar filas individuales
// como `cb_chaturbate_period_base`/`cb_stripchat_earnings` -- eso no se
// toco en esta vuelta).
//
// TERCERA VUELTA (2026-09-16): la FRONTERA ENTRE DOS QUINCENAS se estiro
// hasta las 2:00 a.m. Colombia del dia siguiente para no cortar el turno de
// una modelo a mitad de camino. REVERTIDA en la CUARTA VUELTA (2026-09-22,
// pedido explicito del usuario: "el problema es cuando la modelo trasnocha
// se mezclan quincenas... no quiero que cierre despues de las 12 y 11:30
// como dije"). La extension a las 2 a.m. sonaba bien pero generaba
// EXACTAMENTE el problema que decia evitar: Chaturbate y Stripchat NO
// comparten un mismo corte de dia -- Chaturbate vacia el balance de cada
// modelo a las 23:30 Colombia (`CHATURBATE_CASHOUT_UTC_HOUR/MINUTE`,
// confirmado con incidentes reales, ver mas abajo) y Stripchat corta a
// medianoche Colombia. Al usar un tercer corte propio (2 a.m.) que no
// coincide con NINGUNO de los dos, una modelo que trasnocha quedaba con sus
// tokens de los primeros minutos del dia siguiente unas veces atribuidos a
// la quincena vieja y otras a la nueva de forma inconsistente con lo que
// cada plataforma ya habia decidido por su cuenta -- confirmado con
// numeros reales de la quincena 1-15 de septiembre 2026 que no cuadraban
// contra lo que el usuario veia directo en Chaturbate/Stripchat.
//
// CUARTA VUELTA: se vuelve al corte de NOMINA (`payrollWallToMs`, 23:30
// Colombia, el mismo instante en que Chaturbate ya vacia el balance) para
// `start`/`end` -- asi getQuincena vuelve a coincidir exactamente con
// `payrollDateStr`/`toDateStr`, sin ningun caso especial de madrugada: ya
// no hace falta "retroceder un dia" porque `payrollDateStr(now)` YA
// considera que la madrugada (antes de las 23:30 del "dia de calendario"
// anterior) pertenece al dia de nomina siguiente. `startDate`/`endDate` no
// cambian: siguen siendo las etiquetas de calendario estables de siempre,
// construidas directo desde year/month/startDay/endDay. Para Stripchat
// (corte de MEDIANOCHE, no de nomina) NO se agrega un campo aparte aca --
// ver `stripchatQuincenaWindow` mas abajo y por que necesita su PROPIA
// clasificacion de "que quincena es ahora", no solo un corte distinto sobre
// la misma. Asistencia sigue con su propia medianoche Colombia
// (`studioQuincenaRange`), totalmente aparte -- el ciclo de pago no tiene
// nada que ver con el horario de entrada/salida de una modelo.
//
// Logica de "que mitad del mes y hasta que dia" compartida entre
// getQuincena (corte de nomina) y stripchatQuincenaWindow (corte de
// medianoche) -- separada para que las dos NUNCA puedan quedar
// desincronizadas en cual es el ultimo dia de cada mitad.
function quincenaHalf(year, month, day) {
  let startDay, endDay;
  if (day <= 15) {
    startDay = 1;
    endDay = 15;
  } else {
    startDay = 16;
    endDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }
  let endNextDay = endDay + 1, endNextMonth = month, endNextYear = year;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (endNextDay > daysInMonth) {
    endNextDay = 1;
    endNextMonth += 1;
    if (endNextMonth > 11) { endNextMonth = 0; endNextYear += 1; }
  }
  return { startDay, endDay, endNextDay, endNextMonth, endNextYear };
}

function getQuincena(now) {
  const dateStr = payrollDateStr(now);
  const parts = dateStr.split('-').map(Number);
  const year = parts[0];
  const month = parts[1] - 1;
  const day = parts[2];
  const h = quincenaHalf(year, month, day);
  let payoutY = year, payoutM = month, payoutD;
  if (h.startDay === 1) {
    payoutD = 20;
  } else {
    payoutM = month + 1;
    payoutD = 5;
  }
  if (payoutM > 11) { payoutM -= 12; payoutY += 1; }
  const start = payrollWallToMs(year, month, h.startDay, 0, 0, 0, 0);
  const end = payrollWallToMs(h.endNextYear, h.endNextMonth, h.endNextDay, 0, 0, 0, 0) - 1;
  // El dia de pago es solo una etiqueta (20 o 5, calendario normal) -- no
  // necesita alinearse a ningun corte especial.
  const payout = studioWallToMs(payoutY, payoutM, payoutD, 0, 0, 0, 0);
  const label = h.startDay + ' al ' + h.endDay + ' de ' + MESES[month] + ' ' + year;
  const payoutLabel = payoutD + ' de ' + MESES[payoutM] + ' ' + payoutY;
  const pad = (n) => String(n).padStart(2, '0');
  // Etiquetas ESTABLES "YYYY-MM-DD" para las tablas de una fila por quincena
  // (cb_stripchat_earnings, cb_chaturbate_extra_earnings,
  // cb_chaturbate_period_base) -- construidas directo desde
  // year/month/startDay/endDay, NO desde los timestamps start/end de arriba.
  const startDate = year + '-' + pad(month + 1) + '-' + pad(h.startDay);
  const endDate = year + '-' + pad(month + 1) + '-' + pad(h.endDay);
  return { start, end, payout, label, payoutLabel, startDate, endDate };
}

// Igual que getQuincena, pero clasificando "ahora" y construyendo el rango
// con el corte de MEDIANOCHE Colombia (`studioDateStr`/`studioWallToMs`) en
// vez del de nomina -- el que de verdad usa Stripchat para cerrar su propio
// dia. Usar SIEMPRE esta funcion (nunca getQuincena) para decidir que
// ventana pedirle a la Studio API de Stripchat, y que startDate/endDate usar
// como clave al guardar en cb_stripchat_earnings.
//
// Por que hace falta una funcion APARTE y no solo "el mismo rango con otro
// reloj": entre las 23:30 y la medianoche Colombia del ultimo dia de cada
// quincena, el reloj de NOMINA (Chaturbate) ya cambio de quincena pero el de
// MEDIANOCHE (Stripchat) todavia no. Si `pollStripchatEarnings` clasificara
// "que quincena es ahora" con getQuincena (nomina) y solo le cambiara el
// corte del rango, durante esos ~30 minutos estaria pidiendole a Stripchat
// la ventana de la quincena NUEVA (que todavia no empieza para el reloj de
// medianoche) -- y como una quincena cerrada nunca se vuelve a consultar,
// los ultimos ~30 minutos de actividad real de Stripchat en el dia que
// cierra se perderian para siempre. Clasificando aparte con studioDateStr,
// durante esa misma ventana esta funcion sigue diciendo "todavia es la
// quincena vieja" (coincide con el reloj real de Stripchat) y solo pasa a
// la nueva justo a medianoche -- sin gap. El unico costo es cosmetico: por
// esos mismos ~30 minutos, el total combinado (Chaturbate ya en la
// quincena nueva + Stripchat todavia en la vieja) puede mostrar el aporte
// de Stripchat de la quincena nueva en cero hasta que el siguiente sondeo
// (10 min) ya cruce la medianoche -- se autocorrige solo, nunca se pierde
// nada.
function stripchatQuincenaWindow(now) {
  const dateStr = studioDateStr(now);
  const parts = dateStr.split('-').map(Number);
  const year = parts[0];
  const month = parts[1] - 1;
  const day = parts[2];
  const h = quincenaHalf(year, month, day);
  const start = studioWallToMs(year, month, h.startDay, 0, 0, 0, 0);
  const end = studioWallToMs(h.endNextYear, h.endNextMonth, h.endNextDay, 0, 0, 0, 0) - 1;
  const pad = (n) => String(n).padStart(2, '0');
  const startDate = year + '-' + pad(month + 1) + '-' + pad(h.startDay);
  const endDate = year + '-' + pad(month + 1) + '-' + pad(h.endDay);
  return { start, end, startDate, endDate };
}

// Devuelve las ultimas `count` quincenas, la actual primero.
function getQuincenaHistory(count, now) {
  const periods = [];
  let cursor = now;
  for (let i = 0; i < count; i++) {
    const p = getQuincena(cursor);
    periods.push(p);
    cursor = p.start - 1;
  }
  return periods;
}

// Fecha YYYY-MM-DD del "dia de nomina" (corte 23:30 Colombia) al que
// pertenece este instante -- para etiquetar filas individuales
// (tips/balance-ticks) o cualquier instante suelto que NO sea period.end de
// getQuincena.
//
// Es un alias de `payrollDateStr`, NO de `studioDateStr` -- a proposito, ver
// el comentario de payrollDateStr. Desde la CUARTA VUELTA (2026-09-22,
// ver comentario de getQuincena) `period.start`/`period.end` vuelven a ser
// instantes de nomina (23:30 Colombia), asi que toDateStr(period.start) y
// toDateStr(period.end) vuelven a coincidir con la etiqueta de calendario
// de siempre. Aun asi, seguir usando SIEMPRE period.startDate/period.endDate
// para las tablas de una fila por quincena (cb_stripchat_earnings,
// cb_chaturbate_extra_earnings, cb_chaturbate_period_base) -- son la fuente
// de verdad, calculadas aparte dentro de getQuincena, y no dependen de que
// esta coincidencia se mantenga. Ojo especial con
// `period.stripchatStart`/`period.stripchatEnd`: esos usan el corte de
// MEDIANOCHE (no el de nomina), asi que toDateStr() sobre ellos SI puede
// dar una fecha distinta a startDate/endDate -- no usar toDateStr() sobre
// los campos stripchat*, solo para pedirle el rango a la Studio API.
function toDateStr(ms) {
  return payrollDateStr(ms);
}

function sanitizeUsername(u) {
  if (typeof u !== 'string') return null;
  const clean = u.trim();
  if (!/^[a-zA-Z0-9_\-]{1,50}$/.test(clean)) return null;
  return clean.toLowerCase();
}

// ---- Contraseñas (scrypt, sin dependencias externas) ----

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = crypto.scryptSync(password, salt, 64);
  return hashBuf.length === testBuf.length && crypto.timingSafeEqual(hashBuf, testBuf);
}

// ---- Chaturbate: reconciliar tips / balance en vivo / base de CSV ----

// El total de Chaturbate de una modelo en una quincena, con las tres fuentes
// posibles resueltas sin duplicar ni perder nada:
//  - Con base congelada (CSV subido): base + lo posterior a lo que cubre —
//    tomando el MAYOR entre ticks de balance y propinas posteriores, nunca
//    solo ticks. Bug real encontrado en revision de codigo (2026-09-03): la
//    subida de CSV estuvo disponible para que una modelo la hiciera ella
//    misma SIN tener el balance en vivo activado (eso lo activa el admin
//    aparte). Si solo se mirara "ticks despues de la base" y nunca hubo
//    stats_api_token, ticks siempre da vacio y el total quedaria congelado
//    en la base para siempre, perdiendo en silencio cada propina nueva que
//    la conexion en vivo (Events API, que corre siempre, tenga o no token de
//    stats) siga sumando el resto de la quincena.
//  - Sin base pero con ticks: los ticks (ya incluyen propinas, no se suma cb_tips).
//  - Sin nada de lo anterior: el esquema viejo, propinas + correccion manual.
function resolveChaturbateTokens({ base, ticks, tips, extraTokens }) {
  if (base) {
    const coversUntilMs = new Date(base.covers_until).getTime();
    const ticksAfter = ticks
      .filter((t) => new Date(t.sampled_at).getTime() > coversUntilMs)
      .reduce((sum, t) => sum + t.tokens, 0);
    const tipsAfter = tips
      .filter((t) => new Date(t.created_at).getTime() > coversUntilMs)
      .reduce((sum, t) => sum + t.tokens, 0);
    return base.base_tokens + Math.max(ticksAfter, tipsAfter);
  }
  const ticksTotal = ticks.reduce((sum, t) => sum + t.tokens, 0);
  const tipsTotal = tips.reduce((sum, t) => sum + t.tokens, 0);
  if (ticksTotal > 0) return Math.max(ticksTotal, tipsTotal + extraTokens);
  return tipsTotal + extraTokens;
}

// Chaturbate le vacia el balance a 0 a cada modelo una vez al dia (retiro
// automatico). El CSV registra el retiro a las ~21:30 hora del servidor de
// Chaturbate (US Pacific) = 04:30 UTC, y la web se lo muestra al usuario
// colombiano como 11:30 p.m. (UTC-5): el mismo instante. De ahi salen estas
// constantes y sigue siendo la mejor estimacion que hay.
//
// OJO — FALSA ALARMA DEL 2026-09-04, no repetirla: ese dia los 3 retiros
// observados (jax_f00x 1314->24, abigail_f00x 1925->0, pinky_f00x 420->2)
// figuran detectados a las 04:40:40 UTC, y eso parecia probar que el corte
// real era ~10 min mas tarde de lo asumido. Es mentira. Entre las 04:23:00 y
// las 04:40:40 la Stats API devolvio HTTP 403 a las 6 modelos, en TODAS las
// consultas (174 errores en cb_api_errors): el ultimo balance leido con exito
// antes del corte fue a las 04:21:40 y el siguiente recien a las 04:40:40.
// O sea que el vaciado ocurrio en algun punto de esa ventana ciega de 19
// minutos — que incluye las 04:30 — y las 04:40:40 son solo el momento en que
// la API volvio a responder, no el momento del corte. Antes de "corregir"
// esta hora con datos de cb_balance_resets, cruzar SIEMPRE contra
// cb_api_errors: un detected_at solo significa algo si hubo lecturas exitosas
// continuas antes.
const CHATURBATE_CASHOUT_UTC_HOUR = 4;
const CHATURBATE_CASHOUT_UTC_MINUTE = 30;
const CASHOUT_WINDOW_MINUTES = 12;

// Devuelve true si falta poco para el retiro automatico diario: ahi se sondea
// denso para leer el balance mas alto posible antes de que se vacie a 0.
function isNearChaturbateCashout(nowMs) {
  const d = new Date(nowMs);
  const minutesNow = d.getUTCHours() * 60 + d.getUTCMinutes();
  const cashoutMinutes = CHATURBATE_CASHOUT_UTC_HOUR * 60 + CHATURBATE_CASHOUT_UTC_MINUTE;
  // Solo la franja ANTES del retiro (incluido el minuto exacto), no despues:
  // despues del vaciado no hay nada que rescatar.
  const minutesUntil = cashoutMinutes - minutesNow;
  return minutesUntil >= 0 && minutesUntil <= CASHOUT_WINDOW_MINUTES;
}

// Corte de quincena (pedido explicito del usuario 2026-09-16, "la quincena
// acaba 11:30 hora colombia" -- no medianoche): un "dia de nomina" empieza y
// termina justo cuando Chaturbate vacia el balance (04:30 UTC = 23:30
// Colombia), no a medianoche. Asi el dia 15 de la quincena queda cerrado
// exactamente cuando Chaturbate mismo cierra su balance, en vez de un corte
// a medianoche que no coincide con nada real. OJO: esto es SOLO para
// dinero/quincena -- la jornada de asistencia de una modelo (turnos,
// retrasos) sigue usando medianoche Colombia (`studioDateStr`), sin tocar,
// porque ahi si importa el reloj de pared real, no el ciclo de Chaturbate.
const PAYROLL_DAY_OFFSET_HOURS = -(CHATURBATE_CASHOUT_UTC_HOUR + CHATURBATE_CASHOUT_UTC_MINUTE / 60); // -4.5

// "YYYY-MM-DD" del "dia de nomina" (ver comentario de arriba) al que
// pertenece este instante.
function payrollDateStr(ms) {
  return new Date(ms + PAYROLL_DAY_OFFSET_HOURS * 3600000).toISOString().slice(0, 10);
}

// Instante real (ms) de un año/mes/dia/hora en el "reloj de nomina" (mismo
// mecanismo que studioWallToMs, con el offset de nomina en vez del de
// Colombia a secas).
function payrollWallToMs(year, month, day, hour, minute, second, msPart) {
  return Date.UTC(year, month, day, hour, minute, second, msPart) - PAYROLL_DAY_OFFSET_HOURS * 3600000;
}

// El "historial de transacciones" que Chaturbate deja descargar desde la
// propia cuenta (boton "Descargar el historial de transacciones" en
// Estadisticas de las fichas) trae TODAS las categorias por separado
// (Tip received, Private show, Spy on private show, Photos/videos sold,
// Fan club membership, y "Tokens cashed out" como retiro, no ganancia).
// Formato real observado: columnas entre comillas para texto, numeros sin
// comillas — parser propio en vez de un split(',') porque el campo "Note"
// podria traer una coma adentro.
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseChaturbateTransactionsCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return null;
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idxTimestamp = header.indexOf('Timestamp');
  const idxChange = header.indexOf('Token change');
  if (idxTimestamp === -1 || idxChange === -1) return null;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    const timestamp = f[idxTimestamp];
    const change = parseInt(f[idxChange], 10);
    if (!timestamp || !Number.isFinite(change)) continue;
    rows.push({ dateStr: timestamp.slice(0, 10), change });
  }
  return rows;
}

// Suma cualquier cambio POSITIVO de tokens dentro del rango — no se filtra por
// nombre de categoria a proposito: "Tokens cashed out" (retiro) es la unica
// fila negativa que existe, asi que cualquier cambio positivo en este libro
// mayor es ganancia real por definicion, incluyendo categorias nuevas que
// Chaturbate agregue despues sin que haya que tocar este codigo.
function sumChaturbateCsvEarningsForPeriod(rows, periodStartStr, periodEndStr) {
  let total = 0;
  for (const r of rows) {
    if (r.change > 0 && r.dateStr >= periodStartStr && r.dateStr <= periodEndStr) total += r.change;
  }
  return total;
}

// ---- Asistencia (hora de entrada/salida de las modelos) ----
//
// El estudio es colombiano y las modelos trabajan de noche: una jornada que
// arranca 8 p.m. hora Colombia cae al DIA SIGUIENTE en UTC, que es la zona en
// la que corre el servidor de Render. Si el "dia laboral" se calculara con la
// hora del servidor, media jornada quedaria partida en dos fechas distintas y
// el conteo de retrasos saldria mal. Por eso todo lo de asistencia se calcula
// con un offset fijo de UTC-5: Colombia NO tiene horario de verano, asi que el
// offset fijo es exacto todo el año, sin necesidad de math de zonas horarias.
// Usado tambien por getQuincena/toDateStr (dinero) desde 2026-09-16 -- el
// mismo problema de fondo (hora del servidor != hora de Colombia) tambien
// hacia que la quincena cambiara 5 horas antes de tiempo, ver el comentario
// junto a getQuincena mas arriba en este archivo.
const STUDIO_UTC_OFFSET_HOURS = -5;

// "YYYY-MM-DD" del dia laboral segun la hora del estudio, no la del servidor.
function studioDateStr(ms) {
  return new Date(ms + STUDIO_UTC_OFFSET_HOURS * 3600000).toISOString().slice(0, 10);
}

// "HH:MM" en hora del estudio.
function studioTimeStr(ms) {
  return new Date(ms + STUDIO_UTC_OFFSET_HOURS * 3600000).toISOString().slice(11, 16);
}

// Instante real (ms) en que le tocaba entrar: workDate "YYYY-MM-DD" a las
// entryTime "HH:MM" (o "HH:MM:SS"), interpretado en hora del estudio.
function studioScheduledMs(workDate, entryTime) {
  const parts = String(workDate).split('-').map(Number);
  const clock = String(entryTime).split(':').map(Number);
  if (parts.length < 3 || clock.length < 2) return null;
  if (parts.some(isNaN) || clock.slice(0, 2).some(isNaN)) return null;
  return Date.UTC(parts[0], parts[1] - 1, parts[2], clock[0], clock[1], 0, 0)
    - STUDIO_UTC_OFFSET_HOURS * 3600000;
}

// Igual que studioScheduledMs pero con año/mes/dia/hora/min/seg/ms sueltos en
// vez de strings -- lo usa getQuincena para construir el instante real de la
// medianoche/fin de dia de Colombia sin pasar por ningun getter local.
function studioWallToMs(year, month, day, hour, minute, second, msPart) {
  return Date.UTC(year, month, day, hour, minute, second, msPart) - STUDIO_UTC_OFFSET_HOURS * 3600000;
}

// Minutos de retraso: positivo = llego tarde, negativo = llego temprano.
// Math.trunc, NO Math.round: solo cuenta minutos COMPLETOS transcurridos, en
// cualquiera de los dos sentidos. Con round, llegar 47 segundos tarde (0.78
// min) redondeaba a "1 minuto de retraso" para alguien que en la practica
// llego puntual — mismo problema al reves, 33 segundos temprano marcaba "-1
// minuto". trunc(0.78) = 0 y trunc(-0.55) = 0, que es lo correcto: no ha
// pasado ni un minuto completo todavia. Consistente con como ya se cobra la
// deuda (por HORA alcanzada, no redondeada) — ver lateDebtHours mas abajo.
function computeLateMinutes(officialMs, scheduledMs) {
  if (officialMs == null || scheduledMs == null) return null;
  // El "|| 0" normaliza un -0 (llegar unos segundos temprano trunca a -0) a
  // un 0 limpio — mismo valor en cualquier comparacion o al mostrarlo, pero
  // evita el signo negativo raro si algo lo imprime directo.
  return Math.trunc((officialMs - scheduledMs) / 60000) || 0;
}

// A que dia laboral pertenece una llegada.
//
// Sin horario asignado es simplemente el dia del estudio. Con horario, se elige
// el dia cuya hora de entrada queda MAS CERCA del momento de la llegada. El
// caso que esto resuelve: turno que empieza 8 p.m. y la modelo aparece a las
// 00:30 — para el reloj ya es el dia siguiente, asi que contarlo contra el
// turno de ese dia nuevo la dejaria "19 horas temprano" en vez de "4 horas
// tarde". Comparando contra los dos dias, gana el de anoche, que es el turno
// al que realmente llego.
//
// takenDates son los dias que esa modelo ya tiene registrados: si anoche ya
// habia fichado, no se toca ese registro y la llegada va al dia de hoy.
function pickWorkDate(nowMs, entryTime, takenDates) {
  const today = studioDateStr(nowMs);
  if (!entryTime) return today;
  const yesterday = studioDateStr(nowMs - 24 * 3600000);
  if ((takenDates || []).indexOf(yesterday) !== -1) return today;
  const schedToday = studioScheduledMs(today, entryTime);
  const schedYesterday = studioScheduledMs(yesterday, entryTime);
  if (schedToday == null || schedYesterday == null) return today;
  return Math.abs(nowMs - schedYesterday) < Math.abs(nowMs - schedToday) ? yesterday : today;
}

// Los dos turnos del estudio (definidos por el usuario 2026-09-04). El
// retraso siempre se mide contra `entry` del turno que tenga asignado la
// modelo. `exit` la anota ella y nadie la valida/aprueba -- pero si marca
// antes de esa hora, el servidor SI la compara (ver /api/attendance/exit en
// server.js) para exigirle un motivo y marcar la jornada como salida
// temprano; eso nunca se suma al retraso de entrada, son cosas separadas.
// El turno de la tarde termina a medianoche, o sea que cruza de dia — por eso
// pickWorkDate compara contra el turno de hoy y el de ayer.
const ATTENDANCE_SHIFTS = {
  manana: { id: 'manana', label: 'Mañana', entry: '07:30', exit: '15:30' },
  tarde: { id: 'tarde', label: 'Tarde', entry: '16:00', exit: '00:00' },
};

// Postgres devuelve las columnas `time` como "HH:MM:SS"; adentro se comparan
// siempre como "HH:MM".
function normalizeClock(t) {
  if (!t) return null;
  const parts = String(t).split(':');
  if (parts.length < 2) return null;
  return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
}

function shiftById(id) {
  return ATTENDANCE_SHIFTS[id] || null;
}

// A que turno corresponde un horario guardado. Si no coincide con ninguno de
// los dos, es un horario personalizado y se dice asi en vez de forzarlo a
// alguno de los turnos.
function shiftFromTimes(entryTime, exitTime) {
  const entry = normalizeClock(entryTime);
  if (!entry) return null;
  const exit = normalizeClock(exitTime);
  for (const key of Object.keys(ATTENDANCE_SHIFTS)) {
    const s = ATTENDANCE_SHIFTS[key];
    if (s.entry === entry && (exit == null || exit === s.exit)) return s.id;
  }
  return 'personalizado';
}

function shiftLabel(id, entryTime, exitTime) {
  const s = shiftById(id);
  if (s) return s.label + ' (' + s.entry + '–' + s.exit + ')';
  const entry = normalizeClock(entryTime);
  if (!entry) return 'sin asignar';
  const exit = normalizeClock(exitTime);
  return exit ? 'Personalizado (' + entry + '–' + exit + ')' : 'Personalizado (' + entry + ')';
}

// El margen de tolerancia de 12 min que existia aca fue eliminado a pedido
// del usuario (2026-09-10): el retraso ahora es SIEMPRE hora normal, sin
// ningun ajuste interno — computeLateMinutes ya es el numero final.

// Deuda por retraso: se cobra por HORA ALCANZADA, no proporcional. 59 minutos
// de retraso acumulado no deben nada; a los 60 se debe una hora completa.
// Regla del estudio (confirmada por el usuario 2026-09-04): $10.000 COP por
// hora, y pasadas las 6 horas acumuladas en la quincena la modelo asume su
// propia seguridad social. La tarifa y el umbral son configurables — esta
// función recibe la tarifa en vez de tenerla fija adentro.
function lateDebtHours(lateMinutes) {
  if (!lateMinutes || lateMinutes <= 0) return 0;
  return Math.floor(lateMinutes / 60);
}

function lateDebtCop(lateMinutes, feePerHourCop) {
  return lateDebtHours(lateMinutes) * (feePerHourCop || 0);
}

// Tope de la multa por retrasos (regla confirmada por el usuario 2026-09-05):
// la deuda en plata solo se cobra hasta que la modelo llega al umbral de
// seguridad social (por defecto 6h/360min, ver ATTENDANCE_DEFAULTS en
// server.js) — hasta ahi el tope natural ya es 5 horas completas (300-359 min
// siguen en la hora 5), o sea $50.000 con la tarifa de $10.000/hora. Cruzado
// el umbral, la deuda en plata pasa a ser CERO (no se sigue cobrando ni se
// queda "pegada" en el ultimo valor) y en su lugar corresponde solo el aviso
// de que la modelo asume su propia seguridad social esa quincena
// (owes_social_security, calculado aparte). `lateDebtHours` sigue devolviendo
// las horas reales de retraso sin tope — el conteo de horas nunca se detiene,
// solo el cobro en pesos.
function lateDebtCopCapped(lateMinutes, feePerHourCop, thresholdMinutes) {
  if (thresholdMinutes != null && lateMinutes >= thresholdMinutes) return 0;
  return lateDebtCop(lateMinutes, feePerHourCop);
}

// Bloqueo de agendamiento de extras/recuperaciones por incumplimiento
// (regla confirmada por el usuario 2026-09-05): estas horas NO se cobran, es
// un sistema de cumplimiento si/no. A la 3ra vez que una modelo se apunta a
// una extra o recuperacion y no llega (`attendance_status: 'no_cumplio'`) en
// la quincena actual, queda bloqueada para agendar nuevas hasta la proxima
// quincena — o antes, si admin/CEO le otorga un permiso explicito
// (`cb_shift_overrides`, ver server.js) para esa misma quincena.
const SHIFT_NO_SHOW_LIMIT = 3;

function isShiftClaimBlocked(noShowCount, hasOverride) {
  if (hasOverride) return false;
  return (noShowCount || 0) >= SHIFT_NO_SHOW_LIMIT;
}

// Rango de la quincena actual expresado en fechas "YYYY-MM-DD" del estudio.
// Se calcula sobre la fecha del estudio (no sobre la del servidor) para que la
// asistencia use exactamente los mismos limites de quincena que el pago, sin
// que una jornada de madrugada caiga en la quincena equivocada.
function studioQuincenaRange(dateStr) {
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return null;
  const [year, month, day] = parts;
  const pad = (n) => String(n).padStart(2, '0');
  if (day <= 15) {
    return { start: year + '-' + pad(month) + '-01', end: year + '-' + pad(month) + '-15' };
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: year + '-' + pad(month) + '-16', end: year + '-' + pad(month) + '-' + pad(lastDay) };
}

// Suma/resta dias de calendario a un "YYYY-MM-DD", sin tocar zona horaria --
// son dos fechas del estudio, la aritmetica es de calendario puro.
function dateStrAddDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Dado el "end" de una quincena de asistencia, la fecha en que esa quincena
// se paga -- mismo dia 20/dia 5 que ya usa getQuincena para nomina (end en 15
// paga el 20 del mismo mes; end en el ultimo dia del mes paga el 5 del mes
// siguiente), pero como string simple para poder compararla contra la fecha
// de HOY de asistencia sin mezclar el corte de 23:30 de nomina con el corte
// de medianoche de asistencia.
function quincenaPayoutDateStr(endDateStr) {
  const [year, month, day] = String(endDateStr).split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  if (day === 15) return year + '-' + pad(month) + '-20';
  let payoutY = year, payoutM = month + 1;
  if (payoutM > 12) { payoutM = 1; payoutY += 1; }
  return payoutY + '-' + pad(payoutM) + '-05';
}

// La quincena de asistencia INMEDIATAMENTE ANTERIOR a la que contiene
// `dateStr`, con la fecha en que esa quincena se paga. Pedido explicito del
// usuario 2026-09-16: el aviso de "asume su propia seguridad social" no debe
// desaparecer apenas arranca la quincena nueva -- la modelo que cruzo el
// umbral sigue debiendo esa plata hasta que se le paga de verdad (5 dias
// despues del corte: el 20 para la quincena 1-15, el 5 del mes siguiente
// para la 16-fin de mes). buildAttendancePayload usa esto para decidir si
// todavia hay que mostrar el aviso de la quincena que acaba de terminar,
// ademas del resumen normal de la quincena en curso (las dos cosas conviven:
// la nueva quincena sigue acumulando su propio retraso desde el dia 1/16).
function previousAttendancePeriod(dateStr) {
  const curr = studioQuincenaRange(dateStr);
  if (!curr) return null;
  const dayBefore = dateStrAddDays(curr.start, -1);
  const prev = studioQuincenaRange(dayBefore);
  if (!prev) return null;
  const payoutDate = quincenaPayoutDateStr(prev.end);
  const [sy, sm, sd] = prev.start.split('-').map(Number);
  const ed = Number(prev.end.split('-')[2]);
  const [py, pm, pd] = payoutDate.split('-').map(Number);
  return {
    start: prev.start,
    end: prev.end,
    payoutDate,
    label: sd + ' al ' + ed + ' de ' + MESES[sm - 1] + ' ' + sy,
    payoutLabel: pd + ' de ' + MESES[pm - 1] + ' ' + py,
  };
}

// Solo los retrasos suman deuda de horario; llegar temprano NO descuenta
// retrasos de otros dias (si no, una modelo podria "compensar" un retraso
// grande llegando temprano varios dias y el control perderia sentido).
// `late_excused` (pedido explicito del usuario 2026-09-23, caso real:
// kitty_f00x llego tarde pero con excusa medica de por medio) marca un dia
// puntual como "tipificado pero no penaliza" -- el retraso real se sigue
// guardando en `late_minutes` para que la fila no mienta sobre lo que pasó,
// pero ese dia queda fuera de la suma que alimenta la deuda en plata Y el
// umbral de seguridad social. Mismo criterio que ya usa "Marcar falta" con
// `justified` (ahi el propio late_minutes se guarda en 0; aca el dia SI
// reporta su retraso real, solo se excluye de la suma), asi que no hizo
// falta duplicar la logica de negocio, solo el punto de exclusion.
function sumLateMinutes(days) {
  let total = 0;
  for (const d of days) {
    if (d.late_excused) continue;
    if (d.status === 'validada' && typeof d.late_minutes === 'number' && d.late_minutes > 0) {
      total += d.late_minutes;
    }
  }
  return total;
}

// Aviso REACTIVO de seguridad social (ya cruzo el umbral) -- el aviso
// ANTICIPADO de 1h antes que existio brevemente (2026-09-15) se elimino del
// todo a pedido del usuario (2026-09-16): "esa opcion solo se soluciona con
// la notificacion" -- o sea, esto solo, sin ventana previa. Y en vez de una
// sola plantilla compartida por texto libre ("{modelo}" + fallback), el
// mensaje ahora es PERSONALIZADO POR MODELO
// (`cb_attendance_schedule.owes_message`, ver server.js) -- porque no todos
// los casos son iguales: una modelo puede cruzar el umbral por retraso
// acumulado dia a dia, otra por una sola falta de dia completo (ver "Marcar
// falta"), y el texto correcto para cada una es distinto. Sin mensaje
// personalizado para esa modelo, se usa este default.
//
// `{periodo}` (agregado 2026-09-17): este mismo mensaje se reusa en DOS
// contextos con periodos distintos -- el aviso normal (quincena EN CURSO) y
// el "carryover" (deuda pendiente de la quincena que ACABA de cerrar, ver
// buildAttendancePayload en server.js). Antes el texto tenia "esta quincena"
// fijo, asi que bajo el titulo "pendiente de la quincena pasada" el cuerpo
// seguia diciendo "esta quincena" -- contradictorio (reportado por el
// usuario con captura real). Ahora el llamador pasa el periodo como tercer
// argumento y el placeholder lo resuelve; sin `{periodo}` en el texto (un
// mensaje personalizado viejo, o el fallback sin periodo) el comportamiento
// es igual a antes.
// Actualizado 2026-09-26 a pedido del usuario: agrega la consecuencia sobre
// la meta (incentivo por tokens) al cruzar el umbral -- sin explicar qué es
// la meta en el propio texto, solo que se pierde, porque las modelos ya
// saben qué es y no hace falta un párrafo aparte para eso.
const DEFAULT_OWES_ALERT_MESSAGE = '{modelo} superó el límite de retraso o inasistencia injustificada {periodo}: asume su propia seguridad social y pierde el acceso a la meta.';

function resolveOwesAlertMessage(template, username, periodo) {
  let t = (template && String(template).trim()) || DEFAULT_OWES_ALERT_MESSAGE;
  t = t.indexOf('{periodo}') !== -1 ? t.split('{periodo}').join(periodo || 'esta quincena') : t;
  return t.indexOf('{modelo}') !== -1 ? t.split('{modelo}').join(username) : t + ' (' + username + ')';
}

// Un fallo de API externo con forma "HTTP <codigo> para <modelo>" es un
// blip de red/rate-limit contra una cuenta puntual; cualquier otro mensaje
// (ej. "cambio la forma de la respuesta, falta el campo token_balance") es
// un diagnostico real que siempre debe avisar, nunca pasar por el filtro de
// racha de abajo.
const API_ERROR_HTTP_STATUS_RE = /^HTTP \d+ para /;
function isHttpStatusApiError(message) {
  return API_ERROR_HTTP_STATUS_RE.test(message);
}

// Ventana y umbral para distinguir el blip horario ya diagnosticado (un
// HTTP 4xx/5xx aislado, se recupera solo, nunca mas de 1 cada ~62 min) de
// una racha real como el bloqueo masivo del 2026-09-04 (174 errores en 17
// min). Confirmado con datos reales de 5 dias seguidos: el patron benigno
// nunca junta 3 en 15 minutos, la racha real sí.
const API_ERROR_BURST_WINDOW_MS = 15 * 60 * 1000;
const API_ERROR_BURST_THRESHOLD = 3;

// Pura: recibe la lista de timestamps (ms) de errores HTTP-status recientes
// y el instante actual, descarta lo que ya salió de la ventana, agrega el
// nuevo, y dice si el conteo resultante ya cuenta como racha (no blip).
function evaluateApiErrorBurst(recentTimestamps, now, windowMs, threshold) {
  const pruned = (recentTimestamps || []).filter((t) => now - t < windowMs);
  pruned.push(now);
  return { timestamps: pruned, count: pruned.length, isBurst: pruned.length >= threshold };
}

// Instante real (ms) de una hora "HH:MM" en workDate, salvo que esa hora sea
// igual o anterior a referenceTime (la entrada del turno) — ahi se asume que
// cae al dia SIGUIENTE. Cubre el turno de la tarde (16:00-00:00, cruza
// medianoche) y cualquier hora de salida escrita a mano que sea "antes" que
// la entrada del mismo dia.
function studioInstantAfter(workDate, timeStr, referenceTime) {
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  let d = workDate;
  if (referenceTime != null && toMin(timeStr) <= toMin(referenceTime)) {
    const dt = new Date(workDate + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() + 1);
    d = dt.toISOString().slice(0, 10);
  }
  return studioScheduledMs(d, timeStr);
}

// Duracion de un turno en minutos, entrada -> salida. Si la salida es igual o
// anterior a la entrada (turno de la tarde: 16:00-00:00) se asume que cruza
// medianoche, sumando 24h — asi "16:00" a "00:00" da 480 min (8h), no un
// numero negativo.
function shiftDurationMinutes(entryTime, exitTime) {
  if (!entryTime || !exitTime) return null;
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
  const e = toMin(entryTime);
  const x = toMin(exitTime);
  let diff = x - e;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

// ---- Horas transmitidas dentro de un turno (cb_broadcast_events) ----
//
// Reconstruye, a partir del historial de eventos start/stop de una modelo,
// cuanto tiempo estuvo realmente transmitiendo dentro de una ventana de turno
// [windowStartMs, windowEndMs), y el hueco de desconexion mas largo que tuvo
// EN MEDIO de esa ventana (no cuenta el tiempo antes del primer start ni
// despues del ultimo stop: eso ya lo cubre el retraso de entrada/salida en
// otro lado, no es una "reconexion").
//
// events puede venir con mas rango del pedido a proposito (se recomienda
// pedir con margen): un 'stop' que aparece antes de que haya un 'start'
// visible significa que ya estaba transmitiendo desde antes de la ventana
// pedida, asi que el segmento se abre desde windowStartMs; un 'start' sin
// 'stop' posterior significa que seguia transmitiendo al cierre de la
// ventana (o sigue en vivo ahora), asi que se cierra en windowEndMs.
function computeBroadcastSummary(events, windowStartMs, windowEndMs) {
  if (windowStartMs == null || windowEndMs == null || windowEndMs <= windowStartMs) {
    return { onlineMinutes: 0, maxGapMinutes: 0 };
  }
  const sorted = (events || [])
    .map((e) => ({ type: e.event_type, ms: typeof e.created_at === 'number' ? e.created_at : Date.parse(e.created_at) }))
    .filter((e) => Number.isFinite(e.ms) && (e.type === 'start' || e.type === 'stop'))
    .sort((a, b) => a.ms - b.ms);

  const segments = [];
  let openStart = null;
  // sawStart: solo el PRIMER "stop" huerfano de todo el historial (antes de
  // ver cualquier "start") puede significar "ya transmitia desde antes de
  // que empezara a llegar data" -- se asume online desde el inicio de ESTA
  // ventana. Cualquier otro "stop" huerfano posterior (uno que aparece
  // DESPUES de haber visto al menos un start real) no es eso: es un
  // duplicado/glitch (bug real encontrado 2026-09-15, amaranta_f00x: un
  // "stop stop" seguido sin start entre medio, mismo dia). Antes se
  // aceptaba cualquier huerfano como si fuera el primero, y como `events`
  // es el historial COMPLETO de la modela para toda la quincena (un solo
  // fetch para todos los dias), un huerfano de OTRO dia ademas creaba un
  // segmento fantasma [windowStartMs, ese stop] que cubria la ventana
  // ENTERA de un dia que no tenia nada que ver, inflando su total muy por
  // encima de la duracion real del turno (1431 min en vez de 471).
  let sawStart = false;
  for (const e of sorted) {
    if (e.type === 'start') {
      sawStart = true;
      if (openStart == null) openStart = e.ms;
    } else if (openStart != null) {
      segments.push([openStart, e.ms]);
      openStart = null;
    } else if (!sawStart && e.ms > windowStartMs && e.ms < windowEndMs) {
      segments.push([windowStartMs, e.ms]);
    }
  }
  if (openStart != null) segments.push([openStart, windowEndMs]);

  let onlineMs = 0;
  const clipped = [];
  for (const [s, e] of segments) {
    const cs = Math.max(s, windowStartMs);
    const ce = Math.min(e, windowEndMs);
    if (ce > cs) {
      clipped.push([cs, ce]);
      onlineMs += ce - cs;
    }
  }
  clipped.sort((a, b) => a[0] - b[0]);

  let maxGapMs = 0;
  for (let i = 1; i < clipped.length; i++) {
    const gap = clipped[i][0] - clipped[i - 1][1];
    if (gap > maxGapMs) maxGapMs = gap;
  }

  return { onlineMinutes: Math.round(onlineMs / 60000), maxGapMinutes: Math.round(maxGapMs / 60000) };
}

// Umbral de desconexion que cuenta como "problema real" (no un blip de unos
// minutos) dentro de un turno — pedido explicito del usuario 2026-09-09.
const BROADCAST_GAP_ALERT_MINUTES = 30;

// Color de la celda "horas transmitidas" en la hoja de asistencia (pedido
// 2026-09-09): gris apagado si cumplio el turno completo, rojo si
// transmitio menos que su turno Y tuvo una desconexion real en medio.
// Cualquier otro caso (menos de su turno pero sin hueco grande) no tiene
// color especial: se muestra la hora sin marcar nada.
//
// Hubo un tercer color, rosa, para cuando la modelo tenia una extra/
// recuperacion reclamada ese dia (pensado para no "juzgarla" con el
// criterio normal). Se sacó del todo el 2026-09-10, a pedido del usuario:
// la hora de la extra/recuperación se maneja aparte, a mano — este
// numero solo lleva el tiempo de la jornada normal, sin mezclar las dos
// cosas. No reintroducir sin que el usuario lo pida.
function classifyBroadcastColor({ onlineMinutes, maxGapMinutes, shiftDurationMinutes }) {
  if (shiftDurationMinutes != null && onlineMinutes >= shiftDurationMinutes) return 'gris';
  if (maxGapMinutes >= BROADCAST_GAP_ALERT_MINUTES) return 'rojo';
  return null;
}

module.exports = {
  MESES,
  STUDIO_UTC_OFFSET_HOURS,
  studioDateStr,
  studioTimeStr,
  studioScheduledMs,
  studioWallToMs,
  studioQuincenaRange,
  dateStrAddDays,
  quincenaPayoutDateStr,
  previousAttendancePeriod,
  pickWorkDate,
  lateDebtHours,
  lateDebtCop,
  lateDebtCopCapped,
  SHIFT_NO_SHOW_LIMIT,
  isShiftClaimBlocked,
  ATTENDANCE_SHIFTS,
  normalizeClock,
  shiftById,
  shiftFromTimes,
  shiftLabel,
  computeLateMinutes,
  sumLateMinutes,
  DEFAULT_OWES_ALERT_MESSAGE,
  resolveOwesAlertMessage,
  getQuincena,
  getQuincenaHistory,
  stripchatQuincenaWindow,
  toDateStr,
  payrollDateStr,
  payrollWallToMs,
  PAYROLL_DAY_OFFSET_HOURS,
  sanitizeUsername,
  hashPassword,
  verifyPassword,
  resolveChaturbateTokens,
  CHATURBATE_CASHOUT_UTC_HOUR,
  CHATURBATE_CASHOUT_UTC_MINUTE,
  CASHOUT_WINDOW_MINUTES,
  isNearChaturbateCashout,
  parseCsvLine,
  parseChaturbateTransactionsCsv,
  sumChaturbateCsvEarningsForPeriod,
  isHttpStatusApiError,
  API_ERROR_BURST_WINDOW_MS,
  API_ERROR_BURST_THRESHOLD,
  evaluateApiErrorBurst,
  studioInstantAfter,
  shiftDurationMinutes,
  computeBroadcastSummary,
  BROADCAST_GAP_ALERT_MINUTES,
  classifyBroadcastColor,
};
