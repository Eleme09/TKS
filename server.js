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
const {
  getQuincena, getQuincenaHistory, toDateStr, sanitizeUsername,
  hashPassword, verifyPassword, resolveChaturbateTokens,
  CHATURBATE_CASHOUT_UTC_HOUR, CHATURBATE_CASHOUT_UTC_MINUTE, CASHOUT_WINDOW_MINUTES,
  isNearChaturbateCashout, parseCsvLine, parseChaturbateTransactionsCsv,
  sumChaturbateCsvEarningsForPeriod,
} = require('./chaturbate-lib');

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
// Integracion con la Studio API oficial de Stripchat: opcional. Si faltan las
// dos variables, el servidor sigue funcionando normal, solo que sin traer los
// tokens de Stripchat solos (el formulario manual de pegar/procesar sigue
// funcionando siempre, con o sin esto).
const STRIPCHAT_API_KEY = process.env.STRIPCHAT_API_KEY;
const STRIPCHAT_STUDIO_USERNAME = process.env.STRIPCHAT_STUDIO_USERNAME;
const STRIPCHAT_ENABLED = !!(STRIPCHAT_API_KEY && STRIPCHAT_STUDIO_USERNAME);
const STRIPCHAT_BASE = 'https://stripchat.com';
const STRIPCHAT_POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos

// Chaturbate Stats API (oficial, con token propio de cada modelo — no es
// login, es el mismo tipo de credencial que el Events API Token). Solo trae
// token_balance, no un desglose, pero el balance sube con CUALQUIER ingreso
// (propina, privado, spy, fan club, contenido) y Chaturbate le hace un retiro
// automatico diario a cada modelo que deja el balance en $0 — verificado con
// datos reales que la suma de esos retiros diarios coincide exacto con
// "Ganancias del periodo" de la propia Chaturbate. Viendo el balance subir
// entre sondeos (y nunca restando cuando baja, porque bajar = retiro, no
// gasto) se reconstruye el total real completo, 100% automatico, sin login.
const CHATURBATE_STATS_BASE = 'https://chaturbate.com/statsapi/';

// Chaturbate le vacia el balance a 0 a cada modelo una vez al dia (retiro
// automatico). El ultimo valor que se alcance a leer ANTES de ese vaciado es
// el total real del dia, asi que cerca de esa hora se sondea denso en vez de
// cada par de minutos. CHATURBATE_CASHOUT_UTC_HOUR/MINUTE y
// CASHOUT_WINDOW_MINUTES ahora viven en chaturbate-lib.js junto con
// isNearChaturbateCashout — ver el require de arriba para la explicacion de
// por que es 04:30 UTC y no 21:30/23:30.
const BALANCE_TICK_MS = 20 * 1000;          // latido base del sondeo
const BALANCE_NORMAL_EVERY_TICKS = 6;       // fuera de la ventana: cada 2 min
// Nota honesta sobre el limite: la Stats API de Chaturbate se refresca sola
// "una vez cada 5 minutos" (su documentacion oficial), asi que sondear cada 20s
// no da mas resolucion real — lo que asegura es leer el valor mas fresco que
// exista justo antes del corte, en vez de arriesgar que el unico sondeo de la
// franja caiga 5 minutos antes del vaciado.

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

// Al retomar desde un cursor guardado, cuanto tan viejo puede ser el ultimo
// "start" registrado para todavia confiar en el y marcar a la modelo como en
// linea de una vez (en vez de esperar un evento nuevo). Mas viejo que esto,
// se asume que el "stop" real se perdio en el pasado y no se confia.
const ONLINE_SEED_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 horas

// Un tracker en memoria por cada modelo activa. La clave es el username en minúsculas.
// El token SOLO vive aquí en memoria, nunca se escribe a disco ni a la base de datos.
const trackers = new Map();

// getQuincena, getQuincenaHistory, toDateStr, sanitizeUsername, hashPassword,
// verifyPassword ahora viven en chaturbate-lib.js (funciones puras,
// testeadas ahi mismo con node --test). Ver el require de arriba.

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
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_models?select=username,token,last_cursor&token=not.is.null', { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchSavedToken(username) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_models?username=eq.' + encodeURIComponent(username) + '&select=token,last_cursor', { headers: SB_HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.length ? rows[0] : null;
}

// Guarda el punto exacto donde se quedo escuchando cada modelo, para que un
// reinicio (por deploy o caida) reconecte desde ahi y no pierda tips que
// hayan llegado justo durante el reinicio.
async function sbSaveCursor(username, nextUrl) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_models?username=eq.' + encodeURIComponent(username), {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ last_cursor: nextUrl }),
  }).catch(() => {});
}

async function sbFindAdmin(username) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_admins?username=eq.' + encodeURIComponent(username) + '&select=username,password_hash,role,gender,hide_name,display_name,session_version', { headers: SB_HEADERS });
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
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_admins?select=username,role,gender,hide_name,display_name,created_at&order=created_at.asc', { headers: SB_HEADERS });
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

async function sbSetAdminDisplayName(username, displayName) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_admins?username=eq.' + encodeURIComponent(username), {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ display_name: displayName }),
  });
  return resp.ok;
}

// ---- Notificaciones push (cuando una modelo se conecta) ----

async function sbSaveSubscription(username, sub, role) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_push_subscriptions?on_conflict=username,endpoint', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ username, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, role }),
  });
  return resp.ok;
}

async function sbDeleteSubscriptionByEndpoint(endpoint) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), {
    method: 'DELETE',
    headers: SB_HEADERS,
  }).catch(() => {});
}

// Sin `role`, trae todas las suscripciones de cualquier rol; con `role` (string
// o arreglo de strings), solo las de ese rol o esos roles.
async function sbListPushSubscriptions(role) {
  let url = SUPABASE_URL + '/rest/v1/cb_push_subscriptions?select=username,endpoint,p256dh,auth';
  if (Array.isArray(role)) {
    url += '&role=in.(' + role.map(encodeURIComponent).join(',') + ')';
  } else if (role) {
    url += '&role=eq.' + encodeURIComponent(role);
  }
  const r = await fetch(url, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sendPushToRole(role, body, options) {
  if (!PUSH_ENABLED) return;
  const opts = options || {};
  let subs = await sbListPushSubscriptions(role);
  if (opts.excludeUsername) subs = subs.filter((row) => row.username !== opts.excludeUsername);
  if (!subs.length) return;
  const payload = JSON.stringify({ title: 'Placer Studios', body, tag: opts.tag });
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

// "Modelo conectada" es un aviso de vitrina para el CEO, no algo accionable
// por el administrador — por eso va solo al rol ceo (2026-09-02, pedido
// explicito del usuario: no quiere estas notificaciones a el mismo).
async function sendOnlineNotifications(modelUsername) {
  await sendPushToRole('ceo', modelUsername + ' está en línea ahora.', { tag: 'placer-online' });
}

// Avisa cuando el tracker de una modelo se cae de verdad (token vencido/invalido,
// o lleva un rato sin poder conectar), para que no pase desapercibido.
// Administrador puede actuar reconectando; CEO al menos se entera de que algo
// esta mal. No incluye a modelo -- es un problema tecnico que ella no puede
// resolver, y ahora que las modelos tambien pueden suscribirse (para
// Noticias) hay que ser explicito aqui en vez de mandarla a todos.
async function sendConnectionAlert(modelUsername, reason) {
  await sendPushToRole(['administrador', 'ceo'], 'Se cayó la conexión de ' + modelUsername + ': ' + reason, { tag: 'placer-conn-alert' });
}

// Avisa a los demas suscritos (admin/CEO) cuando se publica una noticia nueva,
// menos al autor (no tiene sentido notificarlo de su propia publicacion).
async function sendNewsNotification(authorUsername, title) {
  await sendPushToRole(null, 'Nueva noticia: ' + title, { tag: 'placer-news', excludeUsername: authorUsername });
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

// ---- Noticias (anuncios de admin/CEO; el hilo de comentarios queda abierto a todos) ----

async function sbListNewsPosts(limit) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_news_posts?select=*&order=created_at.desc&limit=' + (limit || 50), { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbCreateNewsPost(authorUsername, authorRole, authorGender, authorAnonymous, authorDisplayName, postType, title, body) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_news_posts', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=representation' },
    body: JSON.stringify({ author_username: authorUsername, author_role: authorRole, author_gender: authorGender || null, author_anonymous: !!authorAnonymous, author_display_name: authorDisplayName || null, post_type: postType, title, body }),
  });
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows.length ? rows[0] : null;
}

async function sbDeleteNewsPost(id) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_news_posts?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: SB_HEADERS,
  }).catch(() => {});
}

async function sbFetchNewsPostType(postId) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_news_posts?id=eq.' + encodeURIComponent(postId) + '&select=post_type', { headers: SB_HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.length ? rows[0].post_type : null;
}

async function sbListNewsCommentsForPosts(postIds) {
  if (!postIds.length) return [];
  const qs = '?select=*&post_id=in.(' + postIds.join(',') + ')&order=created_at.asc';
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_news_comments' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbCreateNewsComment(postId, authorUsername, authorRole, authorGender, authorAnonymous, authorDisplayName, body) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_news_comments', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ post_id: postId, author_username: authorUsername, author_role: authorRole, author_gender: authorGender || null, author_anonymous: !!authorAnonymous, author_display_name: authorDisplayName || null, body }),
  });
  return resp.ok;
}

async function sbDeleteNewsComment(id) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_news_comments?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: SB_HEADERS,
  }).catch(() => {});
}

// ---- Noticias: quien vio cada publicacion (solo se muestra a admin/CEO, y solo lectores rol modelo) ----

async function sbMarkNewsRead(postIds, username, role) {
  if (!postIds.length) return;
  const body = postIds.map((id) => ({ post_id: id, username, role }));
  await fetch(SUPABASE_URL + '/rest/v1/cb_news_reads?on_conflict=post_id,username', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function sbListNewsModeloReadsForPosts(postIds) {
  if (!postIds.length) return [];
  const qs = '?select=post_id,username,read_at&post_id=in.(' + postIds.join(',') + ')&role=eq.modelo&order=read_at.asc';
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_news_reads' + qs, { headers: SB_HEADERS });
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

// Escritura critica (mueve dinero): reintenta antes de rendirse, y si aun asi
// falla, lo deja bien visible en los logs en vez de tragarselo en silencio.
async function sbWriteCritical(label, url, body) {
  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { ...SB_HEADERS, Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(body),
      });
      if (resp.ok) return true;
      if (i === attempts) console.error('FALLO GUARDANDO ' + label + ' tras ' + attempts + ' intentos: HTTP ' + resp.status + ' ' + JSON.stringify(body));
    } catch (e) {
      if (i === attempts) console.error('FALLO GUARDANDO ' + label + ' tras ' + attempts + ' intentos: ' + e.message + ' ' + JSON.stringify(body));
    }
    if (i < attempts) await sleep(1000 * i);
  }
  return false;
}

// Igual que sbWriteCritical pero para PATCH (actualizar una fila existente en
// vez de insertar una nueva) — mismo criterio de reintentos, para updates que
// tambien representan dinero (ej. last_balance: si un PATCH falla y se traga
// el error en silencio, el proximo sondeo de balance vuelve a leer el valor
// viejo y contaria de nuevo la misma subida como si fuera plata nueva).
async function sbPatchCritical(label, url, body) {
  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    try {
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      });
      if (resp.ok) return true;
      if (i === attempts) console.error('FALLO ACTUALIZANDO ' + label + ' tras ' + attempts + ' intentos: HTTP ' + resp.status + ' ' + JSON.stringify(body));
    } catch (e) {
      if (i === attempts) console.error('FALLO ACTUALIZANDO ' + label + ' tras ' + attempts + ' intentos: ' + e.message + ' ' + JSON.stringify(body));
    }
    if (i < attempts) await sleep(1000 * i);
  }
  return false;
}

async function sbInsertTip(username, tokens, eventId) {
  await sbWriteCritical('tip', SUPABASE_URL + '/rest/v1/cb_tips', { username, tokens, event_id: eventId });
}

async function sbInsertBroadcastEvent(username, eventType, eventId) {
  await sbWriteCritical('broadcast_event', SUPABASE_URL + '/rest/v1/cb_broadcast_events', { username, event_type: eventType, event_id: eventId });
}

// Cualquier evento de la Events API que no sea tip/broadcastStart/broadcastStop
// (privados, spy shows, fan club, compras de contenido, etc.) se guarda crudo
// aqui en vez de descartarse en silencio, para poder revisar despues si trae
// tokens que hoy no estamos contando en el pago.
// A diferencia de tips/broadcast events, esto es puro diagnostico (no
// dinero) — un solo intento, sin reintentos, y SIN await en el llamador para
// no frenar el procesamiento del resto de eventos del mismo poll si una sala
// con mucho trafico (chatMessage, userEnter/userLeave, follow) genera varios
// de estos seguidos.
async function sbInsertUnhandledEvent(username, method, payload) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_unhandled_events', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ username, method, payload }),
  }).catch(() => {});
}

// Registro liviano de fallos de APIs externas (Chaturbate Stats, Stripchat)
// para poder detectar un cambio de API sin acceso a los logs de Render — un
// chequeo automatico programado revisa esta tabla y avisa si hay un salto de
// errores. Puro diagnostico, sin reintentos. Ademas empuja un push inmediato
// solo al rol administrador (mismo criterio que sendConnectionAlert: es un
// aviso tecnico que solo quien opera el sistema puede accionar), en vez de
// esperar al chequeo diario para enterarse de un error real.
async function sbLogApiError(source, message) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_api_errors', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ source, message }),
  }).catch(() => {});
  sendPushToRole('administrador', 'Error en ' + source + ': ' + message, { tag: 'placer-api-error' }).catch(() => {});
}

async function sbFetchLastBroadcastEvent(username) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_broadcast_events?username=eq.' + encodeURIComponent(username) + '&select=event_type,created_at&order=created_at.desc&limit=1', { headers: SB_HEADERS });
  if (!r.ok) return null;
  const rows = await r.json();
  return rows.length ? rows[0] : null;
}

async function sbFetchAllModels() {
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_models?select=username,role,created_at,stats_api_token&order=username.asc', { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchTipsInRange(startIso, endIso) {
  const qs = '?select=username,tokens,created_at&created_at=gte.' + encodeURIComponent(startIso) + '&created_at=lte.' + encodeURIComponent(endIso);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_tips' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchUserTipsSince(username, sinceIso) {
  const qs = '?select=tokens,created_at&username=eq.' + encodeURIComponent(username) + '&created_at=gte.' + encodeURIComponent(sinceIso);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_tips' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

// ---- Stripchat (sin API oficial de ganancias: se ingresa a mano, pegando el
// reporte "Ganancias por modelo" del panel de Stripchat, o corrigiendo a mano) ----

// Interpreta el texto pegado desde "Ganancias por modelo": para cada modelo ya
// dada de alta busca una linea que contenga su username y toma el numero mas
// grande de esa linea como los tokens (en ese reporte el conteo de tokens es
// la cifra mas alta de la fila, por encima de rankings u otros datos chicos).
function parseStripchatPaste(text, usernames) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const usedLines = new Set();
  const matched = [];
  const unmatched = [];
  for (const uname of usernames) {
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (usedLines.has(i)) continue;
      if (lines[i].toLowerCase().includes(uname.toLowerCase())) {
        const nums = (lines[i].match(/\d[\d.,]*/g) || [])
          .map((n) => parseInt(n.replace(/[.,]/g, ''), 10))
          .filter((n) => Number.isFinite(n));
        if (nums.length) {
          matched.push({ username: uname, tokens: Math.max(...nums) });
          usedLines.add(i);
          found = true;
        }
        break;
      }
    }
    if (!found) unmatched.push(uname);
  }
  return { matched, unmatched };
}

async function sbUpsertStripchatEarningsBatch(rows, enteredBy) {
  if (!rows.length) return true;
  const body = rows.map((r) => ({
    username: r.username,
    period_start: r.period_start,
    period_end: r.period_end,
    tokens: r.tokens,
    entered_by: enteredBy,
    updated_at: new Date().toISOString(),
  }));
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_stripchat_earnings?on_conflict=username,period_start,period_end', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
  return resp.ok;
}

async function sbFetchStripchatEarningsForPeriod(periodStartStr, periodEndStr) {
  const qs = '?select=username,tokens&period_start=eq.' + encodeURIComponent(periodStartStr) + '&period_end=eq.' + encodeURIComponent(periodEndStr);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_stripchat_earnings' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchStripchatEarningsForUserSince(username, sincePeriodStartStr) {
  const qs = '?select=period_start,period_end,tokens&username=eq.' + encodeURIComponent(username) + '&period_start=gte.' + encodeURIComponent(sincePeriodStartStr);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_stripchat_earnings' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

// ---- Chaturbate: ingresos que la Events API no reporta como "tip" (privados,
// spy shows, fan club, contenido pagado) — se ingresan a mano por quincena,
// igual que el respaldo manual de Stripchat, porque Chaturbate no tiene una
// API de estadisticas por estudio como si tiene Stripchat. ----

async function sbUpsertChaturbateExtraEarningsBatch(rows, enteredBy) {
  if (!rows.length) return true;
  const body = rows.map((r) => ({
    username: r.username,
    period_start: r.period_start,
    period_end: r.period_end,
    tokens: r.tokens,
    note: r.note || null,
    entered_by: enteredBy,
    updated_at: new Date().toISOString(),
  }));
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_chaturbate_extra_earnings?on_conflict=username,period_start,period_end', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(body),
  });
  return resp.ok;
}

async function sbFetchChaturbateExtraEarningsForPeriod(periodStartStr, periodEndStr) {
  const qs = '?select=username,tokens,note&period_start=eq.' + encodeURIComponent(periodStartStr) + '&period_end=eq.' + encodeURIComponent(periodEndStr);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_chaturbate_extra_earnings' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchChaturbateExtraEarningsForUserSince(username, sincePeriodStartStr) {
  const qs = '?select=period_start,period_end,tokens&username=eq.' + encodeURIComponent(username) + '&period_start=gte.' + encodeURIComponent(sincePeriodStartStr);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_chaturbate_extra_earnings' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

// ---- Chaturbate: seguimiento automatico del balance (Stats API oficial) ----

async function sbFetchModelsWithStatsToken() {
  const qs = '?select=username,stats_api_token,last_balance,last_balance_at&stats_api_token=not.is.null';
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_models' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbSetStatsApiToken(username, statsToken) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_models?username=eq.' + encodeURIComponent(username), {
    method: 'PATCH',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ stats_api_token: statsToken, last_balance: null, last_balance_at: null }),
  });
  return resp.ok;
}

async function sbUpdateLastBalance(username, balance, sampledAtIso) {
  await sbPatchCritical('last_balance', SUPABASE_URL + '/rest/v1/cb_models?username=eq.' + encodeURIComponent(username), {
    last_balance: balance, last_balance_at: sampledAtIso,
  });
}

async function sbInsertBalanceTick(username, tokens, sampledAtIso) {
  await sbWriteCritical('balance_tick', SUPABASE_URL + '/rest/v1/cb_balance_ticks', { username, tokens, sampled_at: sampledAtIso });
}

// Cada vez que el balance baja (el retiro automatico diario de Chaturbate) se
// registra aca. No es dinero — es el rastro para poder verificar con datos a
// que hora UTC ocurre realmente el vaciado, y ajustar la ventana de sondeo
// denso si hiciera falta.
async function sbInsertBalanceReset(username, fromBalance, toBalance, detectedAtIso) {
  await fetch(SUPABASE_URL + '/rest/v1/cb_balance_resets', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
    body: JSON.stringify({ username, from_balance: fromBalance, to_balance: toBalance, detected_at: detectedAtIso }),
  }).catch(() => {});
}

async function sbFetchBalanceTicksInRange(startIso, endIso) {
  const qs = '?select=username,tokens,sampled_at&sampled_at=gte.' + encodeURIComponent(startIso) + '&sampled_at=lte.' + encodeURIComponent(endIso);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_balance_ticks' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchUserBalanceTicksSince(username, sinceIso) {
  const qs = '?select=tokens,sampled_at&username=eq.' + encodeURIComponent(username) + '&sampled_at=gte.' + encodeURIComponent(sinceIso);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_balance_ticks' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

// ---- Base congelada de la quincena (CSV) ----
// Cuando se sube el historial de transacciones de una modelo que ya tiene el
// seguimiento de balance activo, ese CSV dice exactamente cuanto gano en la
// quincena HASTA su fecha de corte (todo incluido: privados, spy, fan club,
// contenido). Ese numero se congela como "base" junto con hasta cuando cubre,
// y de ahi en adelante solo se le suman los ticks de balance posteriores.
// Asi no se duplica (los ticks nuevos no re-cuentan lo que ya trae la base) ni
// se pierde lo viejo (la base no se descarta cuando los ticks crecen).
async function sbUpsertPeriodBase(row) {
  const resp = await fetch(SUPABASE_URL + '/rest/v1/cb_chaturbate_period_base?on_conflict=username,period_start,period_end', {
    method: 'POST',
    headers: { ...SB_HEADERS, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ ...row, updated_at: new Date().toISOString() }]),
  });
  return resp.ok;
}

async function sbFetchPeriodBaseForPeriod(periodStartStr, periodEndStr) {
  const qs = '?select=username,base_tokens,covers_until&period_start=eq.' + encodeURIComponent(periodStartStr) + '&period_end=eq.' + encodeURIComponent(periodEndStr);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_chaturbate_period_base' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

async function sbFetchPeriodBaseForUserSince(username, sincePeriodStartStr) {
  const qs = '?select=period_start,period_end,base_tokens,covers_until&username=eq.' + encodeURIComponent(username) + '&period_start=gte.' + encodeURIComponent(sincePeriodStartStr);
  const r = await fetch(SUPABASE_URL + '/rest/v1/cb_chaturbate_period_base' + qs, { headers: SB_HEADERS });
  return r.ok ? r.json() : [];
}

// resolveChaturbateTokens ahora vive en chaturbate-lib.js (testeada ahi con
// node --test) — ver el require de arriba.

// Consulta la Stats API oficial de Chaturbate por el balance actual de
// tokens de una modelo. null si algo falla (token invalido, API caida, etc.)
// para que una modelo con problemas no tumbe el sondeo de las demas.
async function fetchChaturbateBalance(username, statsToken) {
  const url = CHATURBATE_STATS_BASE + '?username=' + encodeURIComponent(username) + '&token=' + encodeURIComponent(statsToken);
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      console.error('Chaturbate Stats API respondio ' + resp.status + ' para ' + username);
      sbLogApiError('chaturbate_stats', 'HTTP ' + resp.status + ' para ' + username);
      return null;
    }
    const data = await resp.json();
    if (!data || typeof data.token_balance !== 'number') {
      sbLogApiError('chaturbate_stats', 'respuesta sin token_balance para ' + username + ': ' + JSON.stringify(data));
      return null;
    }
    return data.token_balance;
  } catch (e) {
    console.error('Error consultando Chaturbate Stats API para ' + username + ': ' + e.message);
    sbLogApiError('chaturbate_stats', 'excepcion para ' + username + ': ' + e.message);
    return null;
  }
}

// Corre al iniciar el servidor y despues cada CHATURBATE_BALANCE_POLL_INTERVAL_MS
// para cada modelo que tenga un stats_api_token guardado. La primera vez que se
// sondea una modelo (last_balance null) solo se guarda el balance como punto de
// partida, sin registrar tick — no hay forma de saber cuanto de ese balance ya
// se conto antes por otro medio (tips/CSV), asi que se arranca en limpio desde
// ahi en vez de acreditar de golpe todo lo que tuviera acumulado.
// Evita corridas superpuestas: en la ventana densa pre-retiro (cada 20s) una
// corrida para varias modelos puede tardar mas que el propio intervalo si
// Chaturbate responde lento — sin esta guarda, dos corridas en paralelo leen
// el mismo last_balance viejo antes de que ninguna lo actualice y registran
// el mismo ingreso como dos ticks distintos (plata duplicada).
let balancePollRunning = false;
async function pollChaturbateBalances() {
  if (balancePollRunning) return;
  balancePollRunning = true;
  try {
    const models = await sbFetchModelsWithStatsToken();
    for (const m of models) {
      const balance = await fetchChaturbateBalance(m.username, m.stats_api_token);
      if (balance == null) continue;
      const nowIso = new Date().toISOString();
      if (m.last_balance != null && balance > m.last_balance) {
        await sbInsertBalanceTick(m.username, balance - m.last_balance, nowIso);
      } else if (m.last_balance != null && balance < m.last_balance) {
        // Bajo: es el retiro automatico, no un gasto. No se resta nada del
        // acumulado (lo ya sumado sigue siendo plata que gano), solo se deja
        // rastro y el nuevo balance pasa a ser la base.
        await sbInsertBalanceReset(m.username, m.last_balance, balance, nowIso);
      }
      await sbUpdateLastBalance(m.username, balance, nowIso);
    }
  } catch (e) {
    console.error('Error en el sondeo de balance de Chaturbate: ' + e.message);
  } finally {
    balancePollRunning = false;
  }
}

// isNearChaturbateCashout ahora vive en chaturbate-lib.js — ver el require de arriba.

let balanceTickCount = 0;
function startChaturbateBalancePolling() {
  pollChaturbateBalances();
  setInterval(() => {
    balanceTickCount++;
    if (isNearChaturbateCashout(Date.now()) || balanceTickCount % BALANCE_NORMAL_EVERY_TICKS === 0) {
      pollChaturbateBalances();
    }
  }, BALANCE_TICK_MS);
}

// parseCsvLine, parseChaturbateTransactionsCsv y
// sumChaturbateCsvEarningsForPeriod ahora viven en chaturbate-lib.js — ver
// el require de arriba.

// "YYYY-MM-DD HH:MM:SS" en hora local, formato que pide la Studio API de
// Stripchat para periodStart/periodEnd (misma convencion de hora local que ya
// usa toDateStr, para que coincida exactamente con los limites de la quincena
// tal como los construyo getQuincena).
function fmtStripchatDateTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return toDateStr(ms) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

// Consulta la Studio API oficial de Stripchat (docs.stripchat.com) por los
// tokens de una modelo en un periodo exacto. Devuelve null si algo falla (API
// caida, modelo no existe en Stripchat, etc.) para que el resto del sondeo no
// se caiga por una sola modelo.
async function fetchStripchatModelEarnings(modelUsername, periodStartMs, periodEndMs) {
  const qs = '?periodStart=' + encodeURIComponent(fmtStripchatDateTime(periodStartMs)) + '&periodEnd=' + encodeURIComponent(fmtStripchatDateTime(periodEndMs));
  const url = STRIPCHAT_BASE + '/api/stats/v2/studios/username/' + encodeURIComponent(STRIPCHAT_STUDIO_USERNAME) + '/models/username/' + encodeURIComponent(modelUsername) + qs;
  try {
    const resp = await fetch(url, { headers: { 'API-Key': STRIPCHAT_API_KEY, accept: 'application/json' } });
    if (!resp.ok) {
      console.error('Stripchat API respondio ' + resp.status + ' para ' + modelUsername);
      sbLogApiError('stripchat', 'HTTP ' + resp.status + ' para ' + modelUsername);
      return null;
    }
    const data = await resp.json();
    if (!data || typeof data.totalEarnings !== 'number') {
      sbLogApiError('stripchat', 'respuesta sin totalEarnings para ' + modelUsername + ': ' + JSON.stringify(data));
      return null;
    }
    return Math.round(data.totalEarnings);
  } catch (e) {
    console.error('Error consultando Stripchat API para ' + modelUsername + ': ' + e.message);
    sbLogApiError('stripchat', 'excepcion para ' + modelUsername + ': ' + e.message);
    return null;
  }
}

// Trae y guarda los tokens de Stripchat de la quincena actual para todas las
// modelos, de forma automatica. Se corre al iniciar el servidor y despues
// cada STRIPCHAT_POLL_INTERVAL_MS. El formulario manual de pegar/procesar
// sigue disponible como respaldo (por ejemplo si esta API llegara a fallar).
async function pollStripchatEarnings() {
  if (!STRIPCHAT_ENABLED) return;
  try {
    const models = await sbFetchAllModels();
    const period = getQuincena(Date.now());
    const periodStartStr = toDateStr(period.start);
    const periodEndStr = toDateStr(period.end);
    const rows = [];
    for (const m of models.filter((x) => x.role === 'modelo')) {
      const tokens = await fetchStripchatModelEarnings(m.username, period.start, period.end);
      if (tokens != null) rows.push({ username: m.username, period_start: periodStartStr, period_end: periodEndStr, tokens });
    }
    if (rows.length) await sbUpsertStripchatEarningsBatch(rows, 'stripchat-api');
  } catch (e) {
    console.error('Error en el sondeo de Stripchat: ' + e.message);
  }
}

async function buildModelReports() {
  const now = Date.now();
  const period = getQuincena(now);
  const startIso = new Date(period.start).toISOString();
  const endIso = new Date(period.end).toISOString();

  const [models, tips, stripchat, chaturbateExtra, balanceTicks, periodBases] = await Promise.all([
    sbFetchAllModels(),
    sbFetchTipsInRange(startIso, endIso),
    sbFetchStripchatEarningsForPeriod(toDateStr(period.start), toDateStr(period.end)),
    sbFetchChaturbateExtraEarningsForPeriod(toDateStr(period.start), toDateStr(period.end)),
    sbFetchBalanceTicksInRange(startIso, endIso),
    sbFetchPeriodBaseForPeriod(toDateStr(period.start), toDateStr(period.end)),
  ]);

  const tipsByUser = {};
  const tipRowsByUser = {};
  for (const t of tips) {
    tipsByUser[t.username] = (tipsByUser[t.username] || 0) + t.tokens;
    (tipRowsByUser[t.username] = tipRowsByUser[t.username] || []).push(t);
  }
  const stripchatByUser = {};
  for (const s of stripchat) stripchatByUser[s.username] = (stripchatByUser[s.username] || 0) + s.tokens;
  const chaturbateExtraByUser = {};
  for (const c of chaturbateExtra) chaturbateExtraByUser[c.username] = (chaturbateExtraByUser[c.username] || 0) + c.tokens;
  const ticksByUser = {};
  for (const b of balanceTicks) (ticksByUser[b.username] = ticksByUser[b.username] || []).push(b);
  const baseByUser = {};
  for (const b of periodBases) baseByUser[b.username] = b;

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

    const chaturbateTipsTokensPeriod = tipsByUser[m.username] || 0;
    const chaturbateExtraTokensPeriod = chaturbateExtraByUser[m.username] || 0;
    const userTicks = ticksByUser[m.username] || [];
    const userTips = tipRowsByUser[m.username] || [];
    const userBase = baseByUser[m.username] || null;
    const chaturbateBalanceTokensPeriod = userTicks.reduce((sum, t) => sum + t.tokens, 0);
    const chaturbateTokensPeriod = resolveChaturbateTokens({
      base: userBase,
      ticks: userTicks,
      tips: userTips,
      extraTokens: chaturbateExtraTokensPeriod,
    });
    const stripchatTokensPeriod = stripchatByUser[m.username] || 0;

    return {
      account: m.username,
      role: m.role || 'modelo',
      period: { label: period.label, payoutLabel: period.payoutLabel },
      totalTokensPeriod: chaturbateTokensPeriod + stripchatTokensPeriod,
      chaturbateTokensPeriod,
      chaturbateTipsTokensPeriod,
      chaturbateExtraTokensPeriod,
      chaturbateBalanceTokensPeriod,
      chaturbateAutoTracked: !!m.stats_api_token,
      chaturbateHasBase: !!userBase,
      stripchatTokensPeriod,
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

function startTracker(username, token, savedCursor) {
  const existing = trackers.get(username);
  if (existing) {
    existing.running = false; // sin esto, el poll loop viejo queda "zombie" reintentando para siempre
    if (existing.abortCtl) existing.abortCtl.abort();
  }
  const tracker = { username, token, running: true, status: 'connecting', lastError: null, abortCtl: null, online: false, onlineSince: null, consecutiveErrors: 0, errorNotified: false, savedCursor: savedCursor || null };
  trackers.set(username, tracker);
  pollLoop(tracker);
}

async function reconnectAllModels() {
  const models = await sbFetchModelsWithTokens();
  for (const m of models) {
    startTracker(m.username, m.token, m.last_cursor);
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
  const freshUrl = EVENTS_BASE + encodeURIComponent(username) + '/' + encodeURIComponent(tracker.token) + '/?timeout=10';
  let nextUrl = tracker.savedCursor || freshUrl;
  let triedSavedCursor = !!tracker.savedCursor;

  // Si retomamos desde un cursor guardado no hay hueco de eventos perdidos
  // (Chaturbate los sigue entregando al reconectar con ese cursor), asi que
  // podemos adelantar el estado "en linea" con el ultimo evento conocido en
  // vez de esperar a ciegas un evento nuevo que podria tardar horas si la
  // modelo ya estaba transmitiendo desde antes del reinicio. Si el cursor
  // guardado resulta rechazado mas abajo, esto se revierte: ahi si hay un
  // hueco real y toca volver a "desconocida" como antes.
  if (triedSavedCursor) {
    const lastEvent = await sbFetchLastBroadcastEvent(username).catch(() => null);
    if (lastEvent && lastEvent.event_type === 'start' && tracker.running) {
      const eventAgeMs = Date.now() - new Date(lastEvent.created_at).getTime();
      // Un "start" viejo casi seguro es un "stop" que se perdio en el pasado
      // (antes de los arreglos del cursor/zombie-poller), no una transmision
      // real de tantas horas seguidas. Solo lo confiamos si es reciente.
      if (eventAgeMs <= ONLINE_SEED_MAX_AGE_MS) {
        tracker.online = true;
        tracker.onlineSince = new Date(lastEvent.created_at).getTime();
      }
    }
  }

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
      // Tras varios fallos seguidos con la misma url, no seguir insistiendo con
      // ella para siempre: se descarta y se vuelve a intentar desde cero.
      if (tracker.consecutiveErrors % 3 === 0) nextUrl = freshUrl;
      await sleep(Math.min(5000 * tracker.consecutiveErrors, 60000));
      continue;
    }

    if (!resp.ok) {
      // Si el cursor guardado ya no sirve (expiro, o Chaturbate lo rechaza),
      // no lo tratamos como token invalido: reintentamos desde cero una vez.
      if (triedSavedCursor && nextUrl === tracker.savedCursor) {
        triedSavedCursor = false;
        nextUrl = freshUrl;
        // el cursor guardado fallo: ya no hay garantia de no haber perdido
        // un evento en el hueco, asi que el adelanto de arriba ya no aplica.
        tracker.online = false;
        tracker.onlineSince = null;
        continue;
      }
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
      // Igual que arriba: no insistir para siempre con la misma url si sigue fallando.
      if (tracker.consecutiveErrors % 3 === 0) nextUrl = freshUrl;
      await sleep(Math.min(5000 * tracker.consecutiveErrors, 60000));
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
      } else if (ev.method) {
        sbInsertUnhandledEvent(username, ev.method, ev);
      }
    }

    if (data.nextUrl) {
      nextUrl = data.nextUrl;
      await sbSaveCursor(username, nextUrl);
    }
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

function readBody(req, maxBytes) {
  const limit = maxBytes || 1024 * 1024;
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; if (chunks.length > limit) req.destroy(); });
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
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
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

  // Nombre para mostrar en Noticias (solo administrador) — distinto del username
  // de login, se puede cambiar cuando quiera. Se aplica el que este activo en el
  // momento exacto de publicar, no retroactivamente.
  if (parsed.pathname === '/api/me/set-display-name' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim().slice(0, 60) : '';
    const ok = await sbSetAdminDisplayName(session.username, displayName || null);
    if (!ok) return sendJson(res, 400, { error: 'No se pudo actualizar' });
    await sbLogAudit(session, 'set_display_name', null, { display_name: displayName || null });
    return sendJson(res, 200, { ok: true, display_name: displayName || null });
  }

  // ---- Notificaciones push (administrador y CEO) ----

  if (parsed.pathname === '/api/push/public-key' && req.method === 'GET') {
    if (!(await requireSession(req, res))) return;
    return sendJson(res, 200, { enabled: PUSH_ENABLED, publicKey: PUSH_ENABLED ? VAPID_PUBLIC_KEY : null });
  }

  if (parsed.pathname === '/api/push/subscribe' && req.method === 'POST') {
    const session = await requireSession(req, res);
    if (!session) return;
    if (!PUSH_ENABLED) return sendJson(res, 400, { error: 'Las notificaciones no estan configuradas en el servidor' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const sub = body.subscription;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return sendJson(res, 400, { error: 'Suscripcion invalida' });
    }
    const ok = await sbSaveSubscription(session.username, sub, session.role);
    if (!ok) return sendJson(res, 400, { error: 'No se pudo guardar la suscripcion' });
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/push/unsubscribe' && req.method === 'POST') {
    const session = await requireSession(req, res);
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

  // Cierra las sesiones abiertas de CUALQUIER cuenta (admin, CEO o modelo),
  // sin tener que resetear su contraseña de paso. Distinto de
  // /api/me/logout-everywhere, que solo afecta a la propia cuenta.
  if (parsed.pathname === '/api/accounts/logout-everywhere' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const type = body.type === 'model' ? 'model' : body.type === 'admin' ? 'admin' : null;
    const username = type === 'model' ? sanitizeUsername(body.username) : (typeof body.username === 'string' ? body.username.trim() : '');
    if (!type || !username) return sendJson(res, 400, { error: 'type/username inválido' });
    await sbBumpSessionVersion(type, username);
    await sbLogAudit(session, 'force_logout', username, { type });
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

    const existing = await sbFetchSavedToken(username);
    const resumeCursor = existing && existing.token === token ? existing.last_cursor : null;
    await sbUpsertModel(username, token);
    startTracker(username, token, resumeCursor);
    await sbLogAudit(session, 'add_model', username);
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/reconnect' && req.method === 'POST') {
    if (!(await requireAdmin(req, res))) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = sanitizeUsername(body.username);
    if (!username) return sendJson(res, 400, { error: 'username inválido' });
    const saved = await sbFetchSavedToken(username);
    if (!saved || !saved.token) return sendJson(res, 400, { error: 'Esta modelo no tiene un token guardado. Agrégala de nuevo con su token.' });
    startTracker(username, saved.token, saved.last_cursor);
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
      const [tips, stripchatRows, chaturbateExtraRows, balanceTicks, periodBases, dollar] = await Promise.all([
        sbFetchUserTipsSince(username, new Date(oldestStart).toISOString()),
        sbFetchStripchatEarningsForUserSince(username, toDateStr(oldestStart)),
        sbFetchChaturbateExtraEarningsForUserSince(username, toDateStr(oldestStart)),
        sbFetchUserBalanceTicksSince(username, new Date(oldestStart).toISOString()),
        sbFetchPeriodBaseForUserSince(username, toDateStr(oldestStart)),
        getDollarRate(),
      ]);

      const rows = periods.map((p, idx) => {
        const periodTips = tips
          .filter((t) => { const ts = new Date(t.created_at).getTime(); return ts >= p.start && ts <= p.end; });
        const chaturbateTipsTokens = periodTips.reduce((sum, t) => sum + t.tokens, 0);
        const periodStartStr = toDateStr(p.start);
        const periodEndStr = toDateStr(p.end);
        const chaturbateExtraTokens = chaturbateExtraRows
          .filter((r) => r.period_start === periodStartStr && r.period_end === periodEndStr)
          .reduce((sum, r) => sum + r.tokens, 0);
        const periodTicks = balanceTicks
          .filter((t) => { const ts = new Date(t.sampled_at).getTime(); return ts >= p.start && ts <= p.end; });
        const periodBase = periodBases.find((b) => b.period_start === periodStartStr && b.period_end === periodEndStr) || null;
        const chaturbateTokens = resolveChaturbateTokens({
          base: periodBase,
          ticks: periodTicks,
          tips: periodTips,
          extraTokens: chaturbateExtraTokens,
        });
        const stripchatTokens = stripchatRows
          .filter((r) => r.period_start === periodStartStr && r.period_end === periodEndStr)
          .reduce((sum, r) => sum + r.tokens, 0);
        const total = chaturbateTokens + stripchatTokens;
        const payoutUSD = total * PAYOUT_RATE_USD_PER_TOKEN;
        const payoutCOP = dollar.rate ? payoutUSD * dollar.rate : null;
        return {
          label: p.label,
          payoutLabel: p.payoutLabel,
          totalTokens: total,
          chaturbateTokens,
          stripchatTokens,
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

  // ---- Stripchat (ingreso manual — no hay API oficial de ganancias) ----

  if (parsed.pathname === '/api/stripchat/periods' && req.method === 'GET') {
    if (!(await requireAdmin(req, res))) return;
    const periods = getQuincenaHistory(3, Date.now()).map((p, idx) => ({ index: idx, label: p.label, payoutLabel: p.payoutLabel }));
    return sendJson(res, 200, { periods });
  }

  if (parsed.pathname === '/api/stripchat/current' && req.method === 'GET') {
    if (!(await requireAdmin(req, res))) return;
    const idx = Math.min(2, Math.max(0, parseInt(parsed.query.periodIndex, 10) || 0));
    const period = getQuincenaHistory(3, Date.now())[idx];
    const [models, rows] = await Promise.all([
      sbFetchAllModels(),
      sbFetchStripchatEarningsForPeriod(toDateStr(period.start), toDateStr(period.end)),
    ]);
    const byUser = {};
    for (const r of rows) byUser[r.username] = r.tokens;
    const entries = models.filter((m) => m.role === 'modelo').map((m) => ({ username: m.username, tokens: byUser[m.username] || 0 }));
    return sendJson(res, 200, { period: { label: period.label }, entries });
  }

  if (parsed.pathname === '/api/stripchat/parse' && req.method === 'POST') {
    if (!(await requireAdmin(req, res))) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) return sendJson(res, 400, { error: 'Pega el texto de la tabla primero' });
    const models = await sbFetchAllModels();
    const usernames = models.filter((m) => m.role === 'modelo').map((m) => m.username);
    const result = parseStripchatPaste(text, usernames);
    return sendJson(res, 200, result);
  }

  if (parsed.pathname === '/api/stripchat/save' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const idx = Math.min(2, Math.max(0, parseInt(body.periodIndex, 10) || 0));
    const period = getQuincenaHistory(3, Date.now())[idx];
    const models = await sbFetchAllModels();
    const validUsernames = new Set(models.map((m) => m.username));
    const periodStartStr = toDateStr(period.start);
    const periodEndStr = toDateStr(period.end);
    const rows = [];
    for (const e of entries) {
      const username = sanitizeUsername(e.username);
      const tokens = Math.max(0, Math.floor(Number(e.tokens)));
      if (!username || !validUsernames.has(username) || !Number.isFinite(tokens)) continue;
      rows.push({ username, period_start: periodStartStr, period_end: periodEndStr, tokens });
    }
    if (!rows.length) return sendJson(res, 400, { error: 'No hay entradas válidas para guardar' });
    const ok = await sbUpsertStripchatEarningsBatch(rows, session.username);
    if (!ok) return sendJson(res, 500, { error: 'No se pudo guardar en la base de datos' });
    await sbLogAudit(session, 'stripchat_earnings_save', null, { period: period.label, count: rows.length });
    return sendJson(res, 200, { ok: true, period: period.label, count: rows.length });
  }

  // ---- Chaturbate: ingreso manual de lo que la Events API no reporta como
  // tip (privados, spy shows, fan club, contenido) ----

  if (parsed.pathname === '/api/chaturbate-extra/periods' && req.method === 'GET') {
    if (!(await requireAdmin(req, res))) return;
    const periods = getQuincenaHistory(3, Date.now()).map((p, idx) => ({ index: idx, label: p.label, payoutLabel: p.payoutLabel }));
    return sendJson(res, 200, { periods });
  }

  if (parsed.pathname === '/api/chaturbate-extra/current' && req.method === 'GET') {
    if (!(await requireAdmin(req, res))) return;
    const idx = Math.min(2, Math.max(0, parseInt(parsed.query.periodIndex, 10) || 0));
    const period = getQuincenaHistory(3, Date.now())[idx];
    const [models, tips, extraRows] = await Promise.all([
      sbFetchAllModels(),
      sbFetchTipsInRange(new Date(period.start).toISOString(), new Date(period.end).toISOString()),
      sbFetchChaturbateExtraEarningsForPeriod(toDateStr(period.start), toDateStr(period.end)),
    ]);
    const tipsByUser = {};
    for (const t of tips) tipsByUser[t.username] = (tipsByUser[t.username] || 0) + t.tokens;
    const extraByUser = {};
    for (const r of extraRows) extraByUser[r.username] = { tokens: r.tokens, note: r.note || '' };
    // "realTotal" es lo que el admin ve tal cual en la pagina de Chaturbate — no
    // tiene que separar categorias, solo comparar un numero contra otro. Guardamos
    // internamente nada mas la diferencia (chaturbateTipsTokens) para no duplicar
    // lo que ya cuenta la conexion en vivo.
    const entries = models.filter((m) => m.role === 'modelo').map((m) => {
      const chaturbateTipsTokens = tipsByUser[m.username] || 0;
      const extra = (extraByUser[m.username] && extraByUser[m.username].tokens) || 0;
      return {
        username: m.username,
        chaturbateTipsTokens,
        realTotal: chaturbateTipsTokens + extra,
        note: (extraByUser[m.username] && extraByUser[m.username].note) || '',
      };
    });
    return sendJson(res, 200, { period: { label: period.label }, entries });
  }

  if (parsed.pathname === '/api/chaturbate-extra/save' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const idx = Math.min(2, Math.max(0, parseInt(body.periodIndex, 10) || 0));
    const period = getQuincenaHistory(3, Date.now())[idx];
    const [models, tips] = await Promise.all([
      sbFetchAllModels(),
      sbFetchTipsInRange(new Date(period.start).toISOString(), new Date(period.end).toISOString()),
    ]);
    const validUsernames = new Set(models.map((m) => m.username));
    const tipsByUser = {};
    for (const t of tips) tipsByUser[t.username] = (tipsByUser[t.username] || 0) + t.tokens;
    const periodStartStr = toDateStr(period.start);
    const periodEndStr = toDateStr(period.end);
    const rows = [];
    for (const e of entries) {
      const username = sanitizeUsername(e.username);
      const realTotal = Math.max(0, Math.floor(Number(e.realTotal)));
      if (!username || !validUsernames.has(username) || !Number.isFinite(realTotal)) continue;
      const tokens = Math.max(0, realTotal - (tipsByUser[username] || 0));
      const note = typeof e.note === 'string' ? e.note.slice(0, 200) : null;
      rows.push({ username, period_start: periodStartStr, period_end: periodEndStr, tokens, note });
    }
    if (!rows.length) return sendJson(res, 400, { error: 'No hay entradas válidas para guardar' });
    const ok = await sbUpsertChaturbateExtraEarningsBatch(rows, session.username);
    if (!ok) return sendJson(res, 500, { error: 'No se pudo guardar en la base de datos' });
    await sbLogAudit(session, 'chaturbate_extra_earnings_save', null, { period: period.label, count: rows.length });
    return sendJson(res, 200, { ok: true, period: period.label, count: rows.length });
  }

  if (parsed.pathname === '/api/chaturbate-csv/upload' && req.method === 'POST') {
    // Admin puede subir el historial de cualquier modelo; una modelo solo el
    // suyo — esto es lo que hace que escale con muchas modelos: cada una sube
    // el propio cuando lo tiene a mano, sin que el admin tenga que entrar
    // cuenta por cuenta.
    const session = await requireSession(req, res);
    if (!session) return;
    if (session.role !== 'administrador' && session.role !== 'modelo') {
      return sendJson(res, 403, { error: 'No autorizado' });
    }
    let body;
    try { body = await readBody(req, 10 * 1024 * 1024); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = session.role === 'modelo' ? session.username : sanitizeUsername(body.username);
    const csvText = typeof body.csvText === 'string' ? body.csvText : '';
    if (!username) return sendJson(res, 400, { error: 'Elegí una modelo' });
    if (!csvText.trim()) return sendJson(res, 400, { error: 'El archivo llegó vacío' });
    const models = await sbFetchAllModels();
    if (!models.some((m) => m.username === username)) return sendJson(res, 400, { error: 'Esa modelo no existe' });
    const rows = parseChaturbateTransactionsCsv(csvText);
    if (!rows || !rows.length) {
      return sendJson(res, 400, { error: 'No reconozco el formato de este archivo — ¿es el CSV de "Descargar el historial de transacciones" de Chaturbate?' });
    }

    // Chaturbate no guarda el detalle linea-por-linea para siempre — este
    // archivo suele traer solo los ultimos ~30 dias. Una quincena que arranca
    // ANTES de la fecha mas vieja del archivo esta incompleta ahi (se
    // verifico con datos reales: el archivo daba 4549 para una quincena
    // donde "Ganancias del periodo" en la propia web de Chaturbate marcaba
    // 6829 — el archivo no llegaba al dia 1 completo). Guardar ese numero
    // parcial seria peor que no guardar nada: se veria "ya corregido" sin
    // estarlo. Por eso solo se guardan las quincenas totalmente cubiertas
    // por el rango de fechas del archivo.
    const oldestDateStr = rows.reduce((min, r) => (r.dateStr < min ? r.dateStr : min), rows[0].dateStr);
    // El momento del upload (no la fecha del ultimo renglon del CSV) es el
    // corte seguro: cualquier tick de balance con sampled_at posterior a esto
    // es DEFINITIVAMENTE plata que el archivo no pudo haber visto todavia
    // (el archivo se genero antes), asi que sumarla encima nunca duplica.
    // Puede dejar un huequito de unos minutos entre "ultima fila del CSV" y
    // "se subio el archivo" sin contar — se prefiere ese huequito chico a
    // arriesgar duplicar, mismo criterio de "mejor quedarse corto" del resto
    // de esta funcionalidad.
    const coversUntilIso = new Date().toISOString();
    const periods = getQuincenaHistory(6, Date.now());
    const rowsToSave = [];
    const results = [];
    for (const period of periods) {
      const periodStartStr = toDateStr(period.start);
      const periodEndStr = toDateStr(period.end);
      const covered = periodStartStr >= oldestDateStr;
      const csvTotal = sumChaturbateCsvEarningsForPeriod(rows, periodStartStr, periodEndStr);
      results.push({ label: period.label, csvTotal, saved: covered });
      if (covered) {
        rowsToSave.push({
          username, period_start: periodStartStr, period_end: periodEndStr,
          base_tokens: csvTotal, covers_until: coversUntilIso,
          source: 'csv-upload', entered_by: session.username,
        });
      }
    }
    if (!rowsToSave.length) {
      return sendJson(res, 400, { error: 'El archivo no cubre completa ninguna de las últimas quincenas (llega solo hasta ' + oldestDateStr + ') — no se guardó nada para no dejar un número a medias.' });
    }
    for (const row of rowsToSave) {
      const ok = await sbUpsertPeriodBase(row);
      if (!ok) return sendJson(res, 500, { error: 'No se pudo guardar en la base de datos' });
    }
    await sbLogAudit(session, 'chaturbate_csv_upload', username, { periods: rowsToSave.length });
    return sendJson(res, 200, { ok: true, username, results });
  }

  if (parsed.pathname === '/api/chaturbate-stats-token/set' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = sanitizeUsername(body.username);
    const statsToken = typeof body.statsToken === 'string' ? body.statsToken.trim() : '';
    if (!username) return sendJson(res, 400, { error: 'Elegí una modelo' });
    if (!statsToken) return sendJson(res, 400, { error: 'Pegá el token de Stats API' });
    const models = await sbFetchAllModels();
    if (!models.some((m) => m.username === username)) return sendJson(res, 400, { error: 'Esa modelo no existe' });
    const balance = await fetchChaturbateBalance(username, statsToken);
    if (balance == null) {
      return sendJson(res, 400, { error: 'Chaturbate no respondió válido con ese usuario/token — revisá que sea el de Stats API (chaturbate.com/statsapi/authtoken/), no el de Events API.' });
    }
    const ok = await sbSetStatsApiToken(username, statsToken);
    if (!ok) return sendJson(res, 500, { error: 'No se pudo guardar en la base de datos' });
    await sbUpdateLastBalance(username, balance, new Date().toISOString());
    await sbLogAudit(session, 'chaturbate_stats_token_set', username);
    return sendJson(res, 200, { ok: true, username, currentBalance: balance });
  }

  if (parsed.pathname === '/api/chaturbate-stats-token/status' && req.method === 'GET') {
    if (!(await requireAdmin(req, res))) return;
    const models = await sbFetchAllModels();
    const entries = models.filter((m) => m.role === 'modelo').map((m) => ({ username: m.username, active: !!m.stats_api_token }));
    return sendJson(res, 200, { entries });
  }

  // ---- Noticias ----

  if (parsed.pathname === '/api/news' && req.method === 'GET') {
    const session = await requireSession(req, res);
    if (!session) return;
    const posts = await sbListNewsPosts(50);
    const postIds = posts.map((p) => p.id);
    const comments = await sbListNewsCommentsForPosts(postIds);
    const commentsByPost = {};
    for (const c of comments) (commentsByPost[c.post_id] = commentsByPost[c.post_id] || []).push(c);
    await sbMarkNewsRead(postIds, session.username, session.role);
    let viewersByPost = {};
    if (session.role === 'administrador' || session.role === 'ceo') {
      const reads = await sbListNewsModeloReadsForPosts(postIds);
      for (const r of reads) (viewersByPost[r.post_id] = viewersByPost[r.post_id] || []).push(r.username);
    }
    const withComments = posts.map((p) => ({ ...p, comments: commentsByPost[p.id] || [], viewers: viewersByPost[p.id] || [] }));
    return sendJson(res, 200, { posts: withComments });
  }

  if (parsed.pathname === '/api/news/create' && req.method === 'POST') {
    const session = await requireAdminOrCeo(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    const text = typeof body.body === 'string' ? body.body.trim().slice(0, 5000) : '';
    const postType = body.type === 'aviso' ? 'aviso' : 'hilo';
    if (!title || !text) return sendJson(res, 400, { error: 'Completa título y contenido' });
    const authorAdmin = session.role === 'administrador' ? await sbFindAdmin(session.username) : null;
    const post = await sbCreateNewsPost(session.username, session.role, session.gender, authorAdmin && authorAdmin.hide_name, authorAdmin && authorAdmin.display_name, postType, title, text);
    if (!post) return sendJson(res, 500, { error: 'No se pudo publicar' });
    await sbLogAudit(session, 'news_post_create', null, { title, type: postType });
    sendNewsNotification(session.username, title).catch(() => {});
    return sendJson(res, 200, { ok: true, post: { ...post, comments: [], viewers: [] } });
  }

  if (parsed.pathname === '/api/news/delete' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const id = Number(body.id);
    if (!id) return sendJson(res, 400, { error: 'id inválido' });
    await sbDeleteNewsPost(id);
    await sbLogAudit(session, 'news_post_delete', null, { id });
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/news/comment' && req.method === 'POST') {
    const session = await requireSession(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const postId = Number(body.post_id);
    const text = typeof body.body === 'string' ? body.body.trim().slice(0, 2000) : '';
    if (!postId || !text) return sendJson(res, 400, { error: 'Escribe un mensaje' });
    const postType = await sbFetchNewsPostType(postId);
    if (postType === 'aviso') return sendJson(res, 400, { error: 'Este aviso no admite comentarios' });
    const commentAdmin = session.role === 'administrador' ? await sbFindAdmin(session.username) : null;
    const ok = await sbCreateNewsComment(postId, session.username, session.role, session.gender, commentAdmin && commentAdmin.hide_name, commentAdmin && commentAdmin.display_name, text);
    if (!ok) return sendJson(res, 500, { error: 'No se pudo comentar' });
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/news/comment/delete' && req.method === 'POST') {
    const session = await requireAdmin(req, res);
    if (!session) return;
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const id = Number(body.id);
    if (!id) return sendJson(res, 400, { error: 'id inválido' });
    await sbDeleteNewsComment(id);
    return sendJson(res, 200, { ok: true });
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
  if (STRIPCHAT_ENABLED) {
    console.log('Integración con Stripchat activada (estudio: ' + STRIPCHAT_STUDIO_USERNAME + ') — se sincroniza sola cada ' + (STRIPCHAT_POLL_INTERVAL_MS / 60000) + ' min.');
    pollStripchatEarnings();
    setInterval(pollStripchatEarnings, STRIPCHAT_POLL_INTERVAL_MS);
  } else {
    console.log('Integración con Stripchat desactivada (faltan STRIPCHAT_API_KEY / STRIPCHAT_STUDIO_USERNAME) — usa el formulario manual en Desprendibles.');
  }
  startChaturbateBalancePolling();
});
