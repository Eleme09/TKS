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
function getQuincena(now) {
  const d = new Date(now);
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  let start, end, payout;
  if (day <= 15) {
    start = new Date(year, month, 1, 0, 0, 0, 0);
    end = new Date(year, month, 15, 23, 59, 59, 999);
    payout = new Date(year, month, 20);
  } else {
    start = new Date(year, month, 16, 0, 0, 0, 0);
    const lastDay = new Date(year, month + 1, 0).getDate();
    end = new Date(year, month, lastDay, 23, 59, 59, 999);
    payout = new Date(year, month + 1, 5);
  }
  const label = start.getDate() + ' al ' + end.getDate() + ' de ' + MESES[month] + ' ' + year;
  const payoutLabel = payout.getDate() + ' de ' + MESES[payout.getMonth()] + ' ' + payout.getFullYear();
  return { start: start.getTime(), end: end.getTime(), payout: payout.getTime(), label, payoutLabel };
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

// Fecha YYYY-MM-DD en hora local (misma que usa getQuincena para construir
// start/end), para guardar/consultar en columnas `date` de Postgres sin
// desfases de zona horaria.
function toDateStr(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

// Minutos de retraso: positivo = llego tarde, negativo = llego temprano.
function computeLateMinutes(officialMs, scheduledMs) {
  if (officialMs == null || scheduledMs == null) return null;
  return Math.round((officialMs - scheduledMs) / 60000);
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

// Solo los retrasos suman deuda de horario; llegar temprano NO descuenta
// retrasos de otros dias (si no, una modelo podria "compensar" un retraso
// grande llegando temprano varios dias y el control perderia sentido).
function sumLateMinutes(days) {
  let total = 0;
  for (const d of days) {
    if (d.status === 'validada' && typeof d.late_minutes === 'number' && d.late_minutes > 0) {
      total += d.late_minutes;
    }
  }
  return total;
}

module.exports = {
  MESES,
  STUDIO_UTC_OFFSET_HOURS,
  studioDateStr,
  studioTimeStr,
  studioScheduledMs,
  studioQuincenaRange,
  pickWorkDate,
  computeLateMinutes,
  sumLateMinutes,
  getQuincena,
  getQuincenaHistory,
  toDateStr,
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
};
