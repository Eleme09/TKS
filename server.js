// Chaturbate token tracker — backend con persistencia real en Supabase.
// Escucha la Events API oficial server-side (sin problema de CORS) y guarda
// cada tip / evento de transmision en Postgres, para que el historial
// sobreviva reinicios y redespliegues (a diferencia de un archivo local).

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const webpush = require('web-push');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const EVENTS_BASE = 'https://eventsapi.chaturbate.com/events/';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SESSION_SECRET) {
  console.error('Faltan variables de entorno (SUPABASE_URL, SUPABASE_ANON_KEY, SESSION_SECRET). Revisa env.bat (local) o las Environment Variables en Render.');
  process.exit(1);
}

// Notificaciones push: opcionales. Si faltan las llaves VAPID, el servidor sigue
// funcionando normal, solo que sin poder mandar notificaciones al celular.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;
const PUSH_ENABLED = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
if (PUSH_ENABLED) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.log('Notificaciones push desactivadas (faltan VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY o VAPID_SUBJECT).');
}
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: 'Bearer ' + SUPABASE_ANON_KEY,
  'Content-Type': 'application/json',
};

// Fuente de tipo de cambio USD -> moneda local. Cambia CURRENCY si hace falta.
const CURRENCY = 'COP';
const RATE_CACHE_MS = 5 * 60 * 1000;
let rateCache = { rate: null, marketRate: null, updatedAt: 0, error: null };

// Tarifa de pago a la modelo: USD por token.
const PAYOUT_RATE_USD_PER_TOKEN = 0.023;

// Paxum (con lo que realmente se paga) cambia el dolar mas barato que la tasa
// general del mercado. La diferencia ronda los 200-210 COP; usamos el punto medio.
const PAXUM_SPREAD_COP = 205;

// Cuantos intentos seguidos fallidos (a 5s cada uno) antes de avisar que una
// modelo lleva un rato sin poder conectar, para no avisar por un tropiezo suelto.
const ERROR_ALERT_THRESHOLD = 6;

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// Quincena del estudio: día 1-15 se paga el 20 del mismo mes;
// día 16-fin de mes se paga el 5 del mes siguiente.
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

// Un tracker en memoria por cada modelo activa. La clave es el username en minúsculas.
// El token SOLO vive aquí en memoria, nunca se escribe a disco ni a la base de datos.
const trackers = new Map();

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

// ---- Sesiones (cookie firmada, sin estado en el servidor) ----

function signSession(payload) {
  const body = { ...payload, exp: Date.now() + SESSION_MAX_AGE_MS };
  const b64 = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return b64 + '.' + sig;
}

function verifySession(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Cache corta del session_version actual de cada cuenta, para no consultar
// Supabase en cada request autenticado. Al "cerrar sesiones" el cambio tarda
// hasta SESSION_VERSION_CACHE_MS en notarse en sesiones ya abiertas en otros
// dispositivos, lo cual es aceptable para esta herramienta interna.
const sessionVersionCache = new Map(); // key: type+':'+username -> { version, updatedAt }
const SESSION_VERSION_CACHE_MS = 15 * 1000;

async function getCurrentSessionVersion(type, username) {
  const key = type + ':' + username;
  const cached = sessionVersionCache.get(key);
  const now = Date.now();
  if (cached && now - cached.updatedAt < SESSION_VERSION_CACHE_MS) return cached.version;
  const row = type === 'model' ? await sbFindModelAuth(username) : await sbFindAdmin(username);
  const version = row ? (row.session_version || 1) : null;
  if (version != null) sessionVersionCache.set(key, { version, updatedAt: now });
  return version;
}

async function getSession(req) {
  const cookies = parseCookies(req);
  const payload = verifySession(cookies.session);
  if (!payload) return null;
  const currentVersion = await getCurrentSessionVersion(payload.type, payload.username);
  if (currentVersion == null) return null; // la cuenta ya no existe
  if ((payload.v || 1) < currentVersion) return null; // sesion cerrada remotamente
  return payload;
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV !== 'development' ? '; Secure' : '';
  res.setHeader('Set-Cookie', 'session=' + encodeURIComponent(token) + '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(SESSION_MAX_AGE_MS / 1000) + secure);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

// ---- Supabase (Postgres via REST/PostgREST) ----

async function sbUpsertModel(username, token) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_models?on_conflict=username', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ username, role: 'modelo', token }),
  }).catch(() => {});
}

async function sbDeleteModel(username) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_models?username=eq.' + encodeURIComponent(username), {
    method: 'DELETE',
    headers: SB_HEADERS,
  }).catch(() => {});
}

async function sbFetchModelsWithTokens() {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_models?select=username,token&token=not.is.null', { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchSavedToken(username) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_models?username=eq.' + encodeURIComponent(username) + '&select=token', { headers: SB_HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.length ? rows[0].token : null;
}

async function sbFindAdmin(username) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_admins?username=eq.' + encodeURIComponent(username) + '&select=username,password_hash,role,gender,session_version', { headers: SB_HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.length ? rows[0] : null;
}

async function sbFindModelAuth(username) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_models?username=eq.' + encodeURIComponent(username) + '&select=password_hash,session_version', { headers: SB_HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.length ? rows[0] : null;
}

async function sbCreateAdmin(username, passwordHash, role, gender) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_admins', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ username, password_hash: passwordHash, role, gender: gender || null }),
  });
  return resp.ok;
}

async function sbListAdmins() {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_admins?select=username,role,gender,hide_name,created_at&order=created_at.asc', { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbSetAdminPassword(username, passwordHash) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_admins?username=eq.' + encodeURIComponent(username), {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ password_hash: passwordHash }),
  });
  return resp.ok;
}

async function sbSetAdminHideName(username, hide) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_admins?username=eq.' + encodeURIComponent(username), {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ hide_name: !!hide }),
  });
  return resp.ok;
}

// ---- Notificaciones push (cuando una modelo se conecta) ----

async function sbSaveSubscription(username, sub) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_push_subscriptions?on_conflict=username,endpoint', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ username, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }),
  });
  return resp.ok;
}

async function sbDeleteSubscriptionByEndpoint(endpoint) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), {
    method: 'DELETE',
    headers: SB_HEADERS,
  }).catch(() => {});
}

async function sbListPushSubscriptions() {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_push_subscriptions?select=username,endpoint,p256dh,auth', { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

// Manda una notificacion push a todos los administradores y CEO que la hayan activado.
async function sendPushToAdmins(body) {
  if (!PUSH_ENABLED) return;
  const subs = await sbListPushSubscriptions();
  if (!subs.length) return;
  const payload = JSON.stringify({ title: 'Placer Studios', body });
  await Promise.all(subs.map(async (row) => {
    const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    try {
      await webpush.sendNotification(sub, payload);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await sbDeleteSubscriptionByEndpoint(row.endpoint);
      }
    }
  }));
}

async function sendOnlineNotifications(modelUsername) {
  await sendPushToAdmins(modelUsername + ' está en línea ahora.');
}

// Avisa cuando el tracker de una modelo se cae de verdad (token vencido/invalido,
// o lleva un rato sin poder conectar), para que no pase desapercibido.
async function sendConnectionAlert(modelUsername, reason) {
  await sendPushToAdmins('Se cayó la conexión de ' + modelUsername + ': ' + reason);
}

async function sbDeleteAdmin(username) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_admins?username=eq.' + encodeURIComponent(username), {
    method: 'DELETE',
    headers: SB_HEADERS,
  }).catch(() => {});
}

async function sbSetModelPassword(username, passwordHash) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_models?username=eq.' + encodeURIComponent(username), {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ password_hash: passwordHash }),
  }).catch(() => {});
}

// Invalida todas las sesiones existentes de una cuenta (admin o modelo).
// Se usa al resetear una contraseña y en el boton "cerrar mis sesiones".
async function sbBumpSessionVersion(type, username) {
  const table = type === 'model' ? 'cb_models' : 'cb_admins';
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?username=eq.' + encodeURIComponent(username) + '&select=session_version', { headers: SB_HEADERS });
  const rows = await r.json().catch(() => []);
  const current = rows && rows[0] ? (rows[0].session_version || 1) : 1;
  await fetch(SUPABASE_URL + '/rest/v1/' + table + '?username=eq.' + encodeURIComponent(username), {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ session_version: current + 1 }),
  }).catch(() => {});
  sessionVersionCache.delete(type + ':' + username);
}

// ---- Registro de auditoria ----

async function sbLogAudit(session, action, target, details) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_audit_log', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({
      actor_username: session.username,
      actor_role: session.role,
      action,
      target: target || null,
      details: details || null,
    }),
  }).catch(() => {});
}

async function sbListAuditLog(limit) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_audit_log?select=*&order=created_at.desc&limit=' + (limit || 100), { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

// ---- Turnos / horas extra ----

async function sbListShifts() {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_shifts?select=*&order=shift_date.asc,start_time.asc', { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbCreateShift(shiftDate, startTime, note) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_shifts', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ shift_date: shiftDate, start_time: startTime, note: note || null }),
  });
  return resp.ok;
}

async function sbDeleteShift(id) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_shifts?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: SB_HEADERS,
  }).catch(() => {});
}

// Solo reclama si claimed_by todavia es null (evita que dos se apunten al mismo horario a la vez).
async function sbClaimShift(id, username) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_shifts?id=eq.' + encodeURIComponent(id) + '&claimed_by=is.null', {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ claimed_by: username, claimed_at: new Date().toISOString() }),
  });
  if (!resp.ok) return false;
  const rows = await resp.json();
  return rows.length > 0;
}

async function sbUnclaimShift(id) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_shifts?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ claimed_by: null, claimed_at: null }),
  }).catch(() => {});
}

async function sbFetchShift(id) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_shifts?id=eq.' + encodeURIComponent(id) + '&select=*', { headers: SB_HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.length ? rows[0] : null;
}

async function sbInsertTip(username, tokens, eventId) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_tips', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ username, tokens, event_id: eventId }),
  }).catch(() => {});
}

async function sbInsertBroadcastEvent(username, eventType, eventId) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_broadcast_events', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ username, event_type: eventType, event_id: eventId }),
  }).catch(() => {});
}

async function sbFetchAllModels() {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_models?select=username,role,created_at&order=username.asc', { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchTipsInRange(startIso, endIso) {
  const qs = '?select=username,tokens&created_at=gte.' + encodeURIComponent(startIso) + '&created_at=lte.' + encodeURIComponent(endIso);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_tips' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchUserTipsSince(username, sinceIso) {
  const qs = '?select=tokens,created_at&username=eq.' + encodeURIComponent(username) + '&created_at=gte.' + encodeURIComponent(sinceIso);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_tips' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function buildModelReports() {
  const now = Date.now();
  const period = getQuincena(now);
  const startIso = new Date(period.start).toISOString();
  const endIso = new Date(period.end).toISOString();

  const [models, tips] = await Promise.all([
    sbFetchAllModels(),
    sbFetchTipsInRange(startIso, endIso),
  ]);

  const tipsByUser = {};
  for (const t of tips) tipsByUser[t.username] = (tipsByUser[t.username] || 0) + t.tokens;

  return models.map((m) => {
    const tr = trackers.get(m.username);
    const trackingSince = new Date(m.created_at).getTime();
    const trackedFrom = Math.max(trackingSince, period.start);
    const trackedTo = Math.min(now, period.end);
    const periodLenMs = period.end - period.start;
    const periodCoveragePct = Math.max(0, Math.min(100, ((trackedTo - trackedFrom) / periodLenMs) * 100));

    // El estado en linea se toma SOLO del evento recibido en esta conexion en vivo (tr.online),
    // nunca del historico en la base: si el servidor estuvo dormido (spin-down de Render) y se
    // perdio un broadcastStop, el ultimo evento guardado queda como "start" para siempre y la
    // modelo aparece en linea sin estarlo. Por eso cada reconexion arranca en "desconocida" hasta
    // que llega un evento real durante esa sesion.
    const online = tr && tr.online
      ? { state: 'online', since: tr.onlineSince || now }
      : { state: 'offline', since: null };

    return {
      account: m.username,
      role: m.role || 'modelo',
      period: { label: period.label, payoutLabel: period.payoutLabel },
      totalTokensPeriod: tipsByUser[m.username] || 0,
      reportGeneratedAt: now,
      trackingSince,
      periodCoveragePct,
      online,
      connection: {
        running: !!(tr && tr.running),
        status: tr ? tr.status : 'idle',
        lastError: tr ? tr.lastError : null,
      },
    };
  });
}

function startTracker(username, token) {
  const existing = trackers.get(username);
  if (existing && existing.abortCtl) existing.abortCtl.abort();
  const tracker = { username, token, running: true, status: 'connecting', lastError: null, abortCtl: null, online: false, onlineSince: null, consecutiveErrors: 0, errorNotified: false };
  trackers.set(username, tracker);
  pollLoop(tracker);
}

async function reconnectAllModels() {
  const models = await sbFetchModelsWithTokens();
  for (const m of models) {
    startTracker(m.username, m.token);
  }
  if (models.length) console.log('Reconectadas ' + models.length + ' modelo(s) automáticamente.');
}

function noteTrackerError(tracker) {
  tracker.consecutiveErrors++;
  if (tracker.consecutiveErrors === ERROR_ALERT_THRESHOLD && !tracker.errorNotified) {
    tracker.errorNotified = true;
    sendConnectionAlert(tracker.username, 'lleva varios intentos seguidos sin poder conectar (' + tracker.lastError + ').').catch(() => {});
  }
}

async function pollLoop(tracker) {
  const username = tracker.username;
  let nextUrl = EVENTS_BASE + encodeURIComponent(username) + '/' + encodeURIComponent(tracker.token) + '/?timeout=10';

  while (tracker.running) {
    tracker.abortCtl = new AbortController();
    let resp;
    try {
      resp = await fetch(nextUrl, { signal: tracker.abortCtl.signal });
    } catch (e) {
      if (!tracker.running) break;
      tracker.status = 'error';
      tracker.lastError = 'Error de red: ' + e.message;
      noteTrackerError(tracker);
      await sleep(5000);
      continue;
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      tracker.status = 'error';
      if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
        tracker.lastError = 'Token o username inválido (HTTP ' + resp.status + ')';
        tracker.running = false;
        sendConnectionAlert(username, 'el token quedó inválido, hay que agregarla de nuevo.').catch(() => {});
        break;
      }
      tracker.lastError = 'HTTP ' + resp.status + ' — ' + body.slice(0, 200);
      noteTrackerError(tracker);
      await sleep(5000);
      continue;
    }

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      tracker.status = 'error';
      tracker.lastError = 'Respuesta no-JSON de la API';
      noteTrackerError(tracker);
      await sleep(5000);
      continue;
    }

    tracker.status = 'connected';
    tracker.lastError = null;
    tracker.consecutiveErrors = 0;
    tracker.errorNotified = false;

    const events = data.events || [];
    for (const ev of events) {
      if (ev.method === 'tip' && ev.object && ev.object.tip) {
        await sbInsertTip(username, ev.object.tip.tokens || 0, ev.id);
      } else if (ev.method === 'broadcastStart') {
        const wasOffline = !tracker.online;
        tracker.online = true;
        tracker.onlineSince = Date.now();
        await sbInsertBroadcastEvent(username, 'start', ev.id);
        if (wasOffline) sendOnlineNotifications(username).catch(() => {});
      } else if (ev.method === 'broadcastStop') {
        tracker.online = false;
        tracker.onlineSince = null;
        await sbInsertBroadcastEvent(username, 'stop', ev.id);
      }
    }

    if (data.nextUrl) nextUrl = data.nextUrl;
  }

  if (tracker.status !== 'error') tracker.status = 'idle';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDollarRate() {
  const now = Date.now();
  if (rateCache.rate && now - rateCache.updatedAt < RATE_CACHE_MS) return rateCache;
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await resp.json();
    const marketRate = data && data.rates ? data.rates[CURRENCY] : null;
    if (marketRate) {
      rateCache = { rate: marketRate - PAXUM_SPREAD_COP, marketRate, updatedAt: now, error: null };
    } else {
      rateCache = { rate: rateCache.rate, marketRate: rateCache.marketRate, updatedAt: rateCache.updatedAt, error: 'Moneda ' + CURRENCY + ' no encontrada' };
    }
  } catch (e) {
    rateCache = { rate: rateCache.rate, marketRate: rateCache.marketRate, updatedAt: rateCache.updatedAt, error: e.message };
  }
  return rateCache;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; if (chunks.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(chunks ? JSON.parse(chunks) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

// ---- Limite de intentos de login (por IP) ----

const loginAttempts = new Map(); // ip -> { count, firstAttemptAt, lockedUntil }
const LOGIN_MAX_ATTEMPTS = 6;
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function isLoginLocked(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  const now = Date.now();
  if (entry.lockedUntil) {
    if (entry.lockedUntil > now) return true;
    loginAttempts.delete(ip);
    return false;
  }
  if (now - entry.firstAttemptAt > LOGIN_ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return false;
  }
  return false;
}

function registerLoginFailure(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAttemptAt > LOGIN_ATTEMPT_WINDOW_MS) {
    entry = { count: 0, firstAttemptAt: now, lockedUntil: null };
  }
  entry.count++;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
  loginAttempts.set(ip, entry);
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

async function requireSession(req, res) {
  const session = await getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'No autenticado' });
    return null;
  }
  return session;
}

async function requireAdmin(req, res) {
  const session = await requireSession(req, res);
  if (!session) return null;
  if (session.role !== 'administrador') {
    sendJson(res, 403, { error: 'No autorizado' });
    return null;
  }
  return session;
}

async function requireAdminOrCeo(req, res) {
  const session = await requireSession(req, res);
  if (!session) return null;
  if (session.role !== 'administrador' && session.role !== 'ceo') {
    sendJson(res, 403, { error: 'No autorizado' });
    return null;
  }
  return session;
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  // ---- Auth ----

  if (parsed.pathname === '/api/login' && req.method === 'POST') {
    const clientIp = getClientIp(req);
    if (isLoginLocked(clientIp)) {
      return sendJson(res, 429, { error: 'Demasiados intentos fallidos. Espera unos minutos e intenta de nuevo.' });
    }
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const usernameRaw = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!usernameRaw || !password) return sendJson(res, 400, { error: 'Completa usuario y contraseña' });

    const admin = await sbFindAdmin(usernameRaw);
    if (admin && verifyPassword(password, admin.password_hash)) {
      clearLoginFailures(clientIp);
      const token = signSession({ type: 'admin', username: admin.username, role: admin.role, gender: admin.gender || null, v: admin.session_version || 1 });
      setSessionCookie(res, token);
      return sendJson(res, 200, { ok: true, role: admin.role, username: admin.username, gender: admin.gender || null });
    }

    const modelUsername = sanitizeUsername(usernameRaw);
    if (modelUsername) {
      const modelAuth = await sbFindModelAuth(modelUsername);
      if (modelAuth && verifyPassword(password, modelAuth.password_hash)) {
        clearLoginFailures(clientIp);
        const token = signSession({ type: 'model', username: modelUsername, role: 'modelo', v: modelAuth.session_version || 1 });
        setSessionCookie(res, token);
        return sendJson(res, 200, { ok: true, role: 'modelo', username: modelUsername });
      }
    }

    registerLoginFailure(clientIp);
    return sendJson(res, 401, { error: 'Usuario o contraseña incorrectos' });
  }

  if (parsed.pathname === '/api/logout' && req.method === 'POST') {
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/me' && req.method === 'GET') {
    const session = await getSession(req);
    if (!session) return sendJson(res, 401, { error: 'No autenticado' });
    return sendJson(res, 200, { username: session.username, role: session.role, gender: session.gender || null });
  }

  // Invalida todas las sesiones abiertas de esta cuenta (este dispositivo incluido).
  if (parsed.pathname === '/api/me/logout-everywhere' && req.method === 'POST') {
    const session = await requireSession(req, res);
    if (!session) return;
    await sbBumpSessionVersion(session.type, session.username);
    await sbLogAudit(session, 'logout_everywhere', session.username);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  // Oculta/muestra el nombre del administrador ante otros administradores (funcion exclusiva de rol administrador).
  if (parsed.pathname === '/api/me/toggle-name' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const hide = !!body.hide;
    const ok = await sbSetAdminHideName(session.username, hide);
    if (!ok) return sendJson(res, 400, { error: 'No se pudo actualizar' });
    return sendJson(res, 200, { ok: true, hide });
  }

  // ---- Notificaciones push (administrador y CEO) ----

  if (parsed.pathname === '/api/push/public-key' && req.method === 'GET') {
    if (!(await requireAdminOrCeo(req, res))) return;
    return sendJson(res, 200, { enabled: PUSH_ENABLED, publicKey: PUSH_ENABLED ? VAPID_PUBLIC_KEY : null });
  }

  if (parsed.pathname === '/api/push/subscribe' && req.method === 'POST') {
    const session = await requireAdminOrCeo(req, res);
    if (!session) return;
    if (!PUSH_ENABLED) return sendJson(res, 400, { error: 'Las notificaciones no estan configuradas en el servidor' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return sendJson(res, 400, { error: 'Suscripcion invalida' });
    }
    const ok = await sbSaveSubscription(session.username, sub);
    if (!ok) return sendJson(res, 400, { error: 'No se pudo guardar la suscripcion' });
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/push/unsubscribe' && req.method === 'POST') {
    const session = await requireAdminOrCeo(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    if (body.endpoint) await sbDeleteSubscriptionByEndpoint(body.endpoint);
    return sendJson(res, 200, { ok: true });
  }

  // ---- Gestion de cuentas (solo administrador) ----

  if (parsed.pathname === '/api/admins' && req.method === 'GET') {
    if (!(await requireAdmin(req, res))) return;
    const admins = await sbListAdmins();
    return sendJson(res, 200, { admins });
  }

  if (parsed.pathname === '/api/audit-log' && req.method === 'GET') {
    if (!(await requireAdmin(req, res))) return;
    const entries = await sbListAuditLog(100);
    return sendJson(res, 200, { entries });
  }

  if (parsed.pathname === '/api/admins/create' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const gender = body.gender === 'f' ? 'f' : body.gender === 'm' ? 'm' : null;
    if (!username || password.length < 4) return sendJson(res, 400, { error: 'Usuario y contraseña (min. 4 caracteres) son requeridos' });
    const ok = await sbCreateAdmin(username, hashPassword(password), 'ceo', gender);
    if (!ok) return sendJson(res, 400, { error: 'No se pudo crear (¿el usuario ya existe?)' });
    await sbLogAudit(session, 'create_account', username, { role: 'ceo' });
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/admins/delete' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!username) return sendJson(res, 400, { error: 'username inválido' });
    await sbDeleteAdmin(username);
    await sbLogAudit(session, 'delete_account', username);
    return sendJson(res, 200, { ok: true });
  }

  // Permite recuperar el acceso de otra cuenta admin/CEO sin tocar la base de datos a mano.
  if (parsed.pathname === '/api/admins/set-password' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || password.length < 4) return sendJson(res, 400, { error: 'Contraseña de al menos 4 caracteres requerida' });
    const ok = await sbSetAdminPassword(username, hashPassword(password));
    if (!ok) return sendJson(res, 400, { error: 'No se pudo cambiar la contraseña' });
    await sbBumpSessionVersion('admin', username);
    await sbLogAudit(session, 'reset_admin_password', username);
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/models/set-password' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = sanitizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || password.length < 4) return sendJson(res, 400, { error: 'Contraseña de al menos 4 caracteres requerida' });
    await sbSetModelPassword(username, hashPassword(password));
    await sbBumpSessionVersion('model', username);
    await sbLogAudit(session, 'reset_model_password', username);
    return sendJson(res, 200, { ok: true });
  }

  // ---- Tracking (solo administrador) ----

  if (parsed.pathname === '/api/start' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = sanitizeUsername(body.username);
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!username || !token) return sendJson(res, 400, { error: 'username o token inválido' });

    await sbUpsertModel(username, token);
    startTracker(username, token);
    await sbLogAudit(session, 'add_model', username);
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/reconnect' && req.method === 'POST') {
    if (!(await requireAdmin(req, res))) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = sanitizeUsername(body.username);
    if (!username) return sendJson(res, 400, { error: 'username inválido' });
    const token = await sbFetchSavedToken(username);
    if (!token) return sendJson(res, 400, { error: 'Esta modelo no tiene un token guardado. Agrégala de nuevo con su token.' });
    startTracker(username, token);
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/stop' && req.method === 'POST') {
    if (!(await requireAdmin(req, res))) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = sanitizeUsername(body.username);
    if (!username) return sendJson(res, 400, { error: 'username inválido' });
    const tracker = trackers.get(username);
    if (tracker) {
      tracker.running = false;
      if (tracker.abortCtl) tracker.abortCtl.abort();
      tracker.status = 'idle';
    }
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/delete' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = sanitizeUsername(body.username);
    if (!username) return sendJson(res, 400, { error: 'username inválido' });
    const tracker = trackers.get(username);
    if (tracker) {
      tracker.running = false;
      if (tracker.abortCtl) tracker.abortCtl.abort();
      trackers.delete(username);
    }
    await sbDeleteModel(username);
    await sbLogAudit(session, 'delete_model', username);
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/models' && req.method === 'GET') {
    const session = await requireSession(req, res);
    if (!session) return;
    try {
      const [rawModels, dollar] = await Promise.all([buildModelReports(), getDollarRate()]);
      let allModels = rawModels.map((m) => {
        const payoutUSD = m.totalTokensPeriod * PAYOUT_RATE_USD_PER_TOKEN;
        const payoutCOP = dollar.rate ? payoutUSD * dollar.rate : null;
        return { ...m, payoutUSD, payoutCOP };
      });
      let models = allModels;
      if (session.role === 'modelo') {
        models = allModels.filter((m) => m.account === session.username);
      } else if (session.role === 'ceo') {
        models = allModels.map((m) => ({ ...m, connection: { running: m.connection.running, status: m.connection.status, lastError: null } }));
      }
      return sendJson(res, 200, { models, dollar: { ...dollar, currency: CURRENCY }, session: { username: session.username, role: session.role, gender: session.gender || null } });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error consultando la base de datos: ' + e.message });
    }
  }

  // ---- Desprendibles (historial por quincena) ----

  if (parsed.pathname === '/api/payslips' && req.method === 'GET') {
    const session = await requireSession(req, res);
    if (!session) return;
    let username = sanitizeUsername(parsed.query.username);
    if (session.role === 'modelo') username = session.username;
    if (!username) return sendJson(res, 400, { error: 'username requerido' });

    try {
      const now = Date.now();
      const periods = getQuincenaHistory(6, now);
      const oldestStart = periods[periods.length - 1].start;
      const [tips, dollar] = await Promise.all([
        sbFetchUserTipsSince(username, new Date(oldestStart).toISOString()),
        getDollarRate(),
      ]);

      const rows = periods.map((p, idx) => {
        const total = tips
          .filter((t) => { const ts = new Date(t.created_at).getTime(); return ts >= p.start && ts <= p.end; })
          .reduce((sum, t) => sum + t.tokens, 0);
        const payoutUSD = total * PAYOUT_RATE_USD_PER_TOKEN;
        const payoutCOP = dollar.rate ? payoutUSD * dollar.rate : null;
        return {
          label: p.label,
          payoutLabel: p.payoutLabel,
          totalTokens: total,
          payoutUSD,
          payoutCOP,
          copIsApproximate: idx !== 0,
          closed: idx !== 0,
        };
      });

      return sendJson(res, 200, { username, periods: rows, currency: CURRENCY });
    } catch (e) {
      return sendJson(res, 500, { error: 'Error consultando la base de datos: ' + e.message });
    }
  }

  // ---- Turnos / horas extra ----

  if (parsed.pathname === '/api/shifts' && req.method === 'GET') {
    const session = await requireSession(req, res);
    if (!session) return;
    const shifts = await sbListShifts();
    return sendJson(res, 200, { shifts });
  }

  if (parsed.pathname === '/api/shifts/create' && req.method === 'POST') {
    if (!(await requireAdminOrCeo(req, res))) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const shiftDate = typeof body.shift_date === 'string' ? body.shift_date.trim() : '';
    const startTime = typeof body.start_time === 'string' ? body.start_time.trim() : '';
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate)) return sendJson(res, 400, { error: 'Fecha inválida' });
    if (!/^\d{2}:\d{2}$/.test(startTime)) return sendJson(res, 400, { error: 'Hora inválida' });
    const ok = await sbCreateShift(shiftDate, startTime, note);
    if (!ok) return sendJson(res, 400, { error: 'No se pudo crear el horario' });
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/shifts/delete' && req.method === 'POST') {
    if (!(await requireAdminOrCeo(req, res))) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const id = Number(body.id);
    if (!id) return sendJson(res, 400, { error: 'id inválido' });
    await sbDeleteShift(id);
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/shifts/claim' && req.method === 'POST') {
    const session = await requireSession(req, res);
    if (!session) return;
    if (session.role !== 'modelo') return sendJson(res, 403, { error: 'Solo las modelos pueden apuntarse a un horario' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const id = Number(body.id);
    if (!id) return sendJson(res, 400, { error: 'id inválido' });
    const claimed = await sbClaimShift(id, session.username);
    if (!claimed) return sendJson(res, 400, { error: 'Ese horario ya no está disponible' });
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/shifts/unclaim' && req.method === 'POST') {
    const session = await requireSession(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const id = Number(body.id);
    if (!id) return sendJson(res, 400, { error: 'id inválido' });
    if (session.role === 'modelo') {
      const shift = await sbFetchShift(id);
      if (!shift || shift.claimed_by !== session.username) return sendJson(res, 403, { error: 'No es tu horario' });
    } else if (session.role !== 'administrador' && session.role !== 'ceo') {
      return sendJson(res, 403, { error: 'No autorizado' });
    }
    await sbUnclaimShift(id);
    return sendJson(res, 200, { ok: true });
  }

  return serveStatic(req, res, parsed.pathname);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('');
    console.log('===========================================================');
    console.log('El rastreador YA está corriendo en otra ventana.');
    console.log('No necesitas hacer nada más: abre tu navegador en');
    console.log('http://localhost:' + PORT);
    console.log('Puedes cerrar esta ventana, la otra sigue funcionando.');
    console.log('===========================================================');
  } else {
    console.log('Error inesperado al iniciar: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log('Chaturbate token tracker corriendo en http://localhost:' + PORT);
  reconnectAllModels();
});
