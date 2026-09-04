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
// Chaturbate (US Pacific) = 04:30 UTC, y de ahi salio la primera version de
// esta constante.
//
// MEDIDO CONTRA DATOS REALES (2026-09-04, primer retiro observado desde que
// existe el sondeo de balance): las 3 modelos con balance ese dia — jax_f00x
// 1314->24, abigail_f00x 1925->0, pinky_f00x 420->2 — cayeron todas en el
// MISMO ciclo de sondeo, detectadas a las 04:40:40 UTC. El ciclo anterior
// fuera de la ventana densa corre 2 min antes (BALANCE_TICK_MS 20s x
// BALANCE_NORMAL_EVERY_TICKS 6), asi que el vaciado real ocurrio entre
// 04:38:40 y 04:40:40 UTC — unos 10 minutos DESPUES de las 04:30. No es que
// el 21:30 del CSV este mal: lo mas probable es que ese sea el momento
// logico del corte y el balance tarde unos minutos en vaciarse de verdad.
//
// Por eso la ventana ahora apunta a las 04:45 y dura 30 min (04:15-04:45):
// cubre tanto las 04:30 originales como el ~04:40 medido, con margen. Es una
// sola observacion, no varias — si aparecen mas dias de datos en
// cb_balance_resets y se concentran en una hora mas precisa, se puede
// ajustar y angostar. Verificar siempre contra cb_balance_resets.detected_at,
// nunca adivinar una hora nueva.
const CHATURBATE_CASHOUT_UTC_HOUR = 4;
const CHATURBATE_CASHOUT_UTC_MINUTE = 45;
const CASHOUT_WINDOW_MINUTES = 30;

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

module.exports = {
  MESES,
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
