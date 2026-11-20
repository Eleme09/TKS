// Control remoto de equipos (2026-11-14) — relay WebSocket dentro del propio TKS.
//
// Piezas:
//   - Agente (remote-agent/, .exe de Windows): se conecta a /ws/remote/agent,
//     se autentica con {t:'auth', device, token}, manda pantalla (JPEG binario)
//     y ejecuta el input que llegue.
//   - Visor (public/remoto.html): se conecta a /ws/remote/viewer?device=ID con
//     la cookie de sesión de un ADMINISTRADOR. Nadie más puede entrar.
//   - Este módulo solo retransmite. Reglas de seguridad que viven aquí:
//       * el visor solo entra con sesión administrador + Origin del propio sitio,
//         y esa sesión se revalida cada minuto mientras dura la conexión;
//       * el token del agente se guarda como sha256, comparación timing-safe;
//       * el input del visor NO llega al agente hasta que el agente confirme
//         el consentimiento (el agente le muestra un aviso a quien está en el
//         computador); los frames del agente tampoco pasan antes de eso;
//       * UNA sola sesión de visor a la vez en todo el sistema; duración máxima
//         y corte por inactividad;
//       * todo mensaje del visor se valida campo por campo y se reenvía
//         reconstruido (nunca el objeto crudo);
//       * tope de frames por segundo y de bytes por segundo hacia el visor;
//       * heartbeat ping/pong: una conexión que no responde se termina;
//       * límite de conexiones sin autenticar (global y por IP), payload de
//         4 KB hasta que el agente se autentica, freno por IP a intentos
//         fallidos y caché negativo de ids inexistentes (no se consulta
//         Supabase por cada intento basura);
//       * ningún fallo de Supabase/fetch puede escaparse como excepción: todo
//         handler async va envuelto (una promesa rechazada sin manejar tumba
//         el proceso entero de TKS);
//       * inicio y fin de cada sesión quedan en cb_audit_log.
//
// 2026-11-20: control de flujo "sin lag" + icono de bandeja + modo
// desatendido. El relay no decodifica el video — solo retransmite bytes —
// así que lo nuevo acá es: dejar pasar {t:'ack',seq,resync?} y
// {t:'caps',tiles:true} del visor (compatibilidad: un visor viejo nunca los
// manda y todo sigue igual, JPEG completo de siempre); reenviar {t:'stat',...}
// del agente al visor (medidor de RTT/fps/KB/s); auditar el campo opcional
// unattended:true de {t:'consent'} cuando ese equipo tiene esa opción activa
// en su config.json (decisión LOCAL del equipo, nunca algo que el servidor
// pueda prender); ack/caps no cuentan para el corte por inactividad (igual
// que ping) ni se bloquean en modo solo-ver (ahí también hay frames que
// confirmar). maxFps/maxBytesPerSec subieron (8→30, 4→6 MB/s): el control de
// flujo por ack ya evita que se acumule nada, así que el tope solo protege
// contra un agente roto, no limita la fluidez normal.
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const DEFAULT_LIMITS = {
  maxFrameBytes: 6 * 1024 * 1024,      // un frame JPEG, ya autenticado
  preAuthMaxPayload: 4 * 1024,         // hasta autenticar, y siempre para el visor
  maxControlBytes: 2048,               // mensaje JSON de control
  authTimeoutMs: 10000,
  viewerMaxMsgPerSec: 250,
  viewerBackpressureBytes: 1.5 * 1024 * 1024,
  maxFps: 30,                          // frames/seg hacia el visor (control de flujo por ack evita que esto se acumule)
  maxBytesPerSec: 6 * 1024 * 1024,     // bytes/seg de frames hacia el visor
  lastSeenWriteMs: 5 * 60 * 1000,      // last_seen en Supabase: cada 5 min
  heartbeatIntervalMs: 15000,
  heartbeatTimeoutMs: 45000,
  revalidateMs: 60 * 1000,
  maxSessionMs: 4 * 60 * 60 * 1000,
  idleMs: 15 * 60 * 1000,
  maxPendingGlobal: 50,                // conexiones sin autenticar, total
  maxPendingPerIp: 5,                  // conexiones sin autenticar, por IP
  authFailWindowMs: 10 * 60 * 1000,
  authFailMaxPerIp: 10,                // intentos fallidos por IP en la ventana
  negativeCacheMs: 60 * 1000,          // id de equipo inexistente: no reconsultar
};

const MOUSE_ACTIONS = new Set(['move', 'down', 'up', 'wheel']);
const KEY_ACTIONS = new Set(['down', 'up']);
const KEY_CODE_RE = /^[A-Za-z0-9]{1,20}$/;
const MAX_TEXT_CHARS = 200;
const MAX_SEQ = 4294967295; // uint32, mismo tope que usa el agente para sus números de secuencia

function sha256hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'hex');
  const bb = Buffer.from(String(b), 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUnit(n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1; }

// Valida un mensaje del visor y devuelve una copia limpia para reenviar, o null.
// Solo los campos conocidos pasan; cualquier otro se descarta.
function sanitizeViewerMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  switch (msg.t) {
    case 'ping': return { t: 'ping' };
    case 'mouse': {
      if (!MOUSE_ACTIONS.has(msg.a)) return null;
      if (msg.a === 'wheel') {
        if (msg.d !== -1 && msg.d !== 1) return null;
        return { t: 'mouse', a: 'wheel', d: msg.d };
      }
      if (!isUnit(msg.x) || !isUnit(msg.y)) return null;
      if (msg.a === 'move') return { t: 'mouse', a: 'move', x: msg.x, y: msg.y };
      if (!Number.isInteger(msg.b) || msg.b < 0 || msg.b > 2) return null;
      return { t: 'mouse', a: msg.a, b: msg.b, x: msg.x, y: msg.y };
    }
    case 'key': {
      if (!KEY_ACTIONS.has(msg.a)) return null;
      if (typeof msg.code !== 'string' || !KEY_CODE_RE.test(msg.code)) return null;
      return { t: 'key', a: msg.a, code: msg.code };
    }
    case 'text': {
      if (typeof msg.text !== 'string' || msg.text.length === 0 || msg.text.length > MAX_TEXT_CHARS) return null;
      return { t: 'text', text: msg.text };
    }
    case 'quality': {
      if (!Number.isInteger(msg.q) || msg.q < 1 || msg.q > 3) return null;
      return { t: 'quality', q: msg.q };
    }
    case 'ack': {
      // Control de flujo "sin lag": el visor confirma hasta qué paquete ya
      // dibujó; el agente nunca manda más de 2 sin confirmar y, si el visor
      // va atrasado, descarta los viejos en vez de encolarlos. resync: true
      // pide un refresco completo (p.ej. tras perder un paquete).
      if (!Number.isInteger(msg.seq) || msg.seq < 0 || msg.seq > MAX_SEQ) return null;
      const out = { t: 'ack', seq: msg.seq };
      if (msg.resync === true) out.resync = true;
      return out;
    }
    case 'caps': {
      // El visor declara qué soporta (hoy solo "tiles": actualización por
      // regiones). Un agente/visor viejo que nunca manda esto sigue en el
      // modo de siempre (JPEG completo), así que es compatible hacia atrás.
      if (msg.tiles !== true) return null;
      return { t: 'caps', tiles: true };
    }
    default: return null;
  }
}

// IP del cliente: último salto de X-Forwarded-For (el que agrega el proxy de
// Render, no falsificable por el cliente), igual que getClientIp de server.js.
function clientIp(req) {
  const fwd = String((req.headers && req.headers['x-forwarded-for']) || '');
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return (req.socket && req.socket.remoteAddress) || 'desconocida';
}

function create(deps) {
  const { SUPABASE_URL, SB_HEADERS, getSession, sendJson, readBody } = deps;
  const L = Object.assign({}, DEFAULT_LIMITS, deps.limits || {});
  const now = deps.now || Date.now;

  // sbLogAudit nunca debe tumbar nada (puede ser async y rechazar).
  function audit(...args) {
    try {
      const p = deps.sbLogAudit(...args);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { /* auditoría best-effort */ }
  }

  // deviceId -> { ws, name, info, lastTouch }
  const agents = new Map();
  // deviceId -> sesión de visor (a lo sumo UNA en total, ver onViewer)
  const viewers = new Map();
  // Conexiones sin autenticar: total y por IP.
  let pendingGlobal = 0;
  const pendingByIp = new Map();
  // Intentos fallidos por IP: ip -> { count, windowStart }
  const authFails = new Map();
  // Ids de equipo que no existen: id -> expira
  const negativeCache = new Map();
  // Todos los sockets vivos, para el heartbeat.
  const liveSockets = new Set();

  async function defaultFindDevice(id) {
    const r = await fetch(SUPABASE_URL + '/rest/v1/cb_remote_devices?id=eq.' + id + '&select=*', { headers: SB_HEADERS });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0] || null;
  }
  const findDeviceImpl = deps.findDevice || defaultFindDevice;

  // Nunca lanza: un error de red cuenta como "no encontrado" (sin cachearlo).
  async function sbFindDevice(id) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
    const exp = negativeCache.get(id);
    if (exp && exp > now()) return null;
    let dev = null;
    try { dev = await findDeviceImpl(id); } catch (e) { return null; }
    if (!dev) {
      negativeCache.set(id, now() + L.negativeCacheMs);
      if (negativeCache.size > 5000) negativeCache.clear();
    }
    return dev || null;
  }

  function sbTouchDevice(id) {
    if (deps.touchDevice) {
      try { Promise.resolve(deps.touchDevice(id)).catch(() => {}); } catch (e) { /* noop */ }
      return;
    }
    try {
      fetch(SUPABASE_URL + '/rest/v1/cb_remote_devices?id=eq.' + id, {
        method: 'PATCH',
        headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
        body: JSON.stringify({ last_seen: new Date().toISOString() }),
      }).catch(() => {});
    } catch (e) { /* noop */ }
  }

  function maybeTouch(a, deviceId) {
    const t = now();
    if (t - a.lastTouch >= L.lastSeenWriteMs) { a.lastTouch = t; sbTouchDevice(deviceId); }
  }

  function sendCtl(ws, obj) {
    try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (e) { /* noop */ }
  }

  // ---------- Freno por IP ----------
  function ipBlocked(ip) {
    const f = authFails.get(ip);
    if (!f) return false;
    if (now() - f.windowStart > L.authFailWindowMs) { authFails.delete(ip); return false; }
    return f.count >= L.authFailMaxPerIp;
  }
  function noteAuthFail(ip) {
    const t = now();
    let f = authFails.get(ip);
    if (!f || t - f.windowStart > L.authFailWindowMs) { f = { count: 0, windowStart: t }; authFails.set(ip, f); }
    f.count++;
    if (authFails.size > 10000) authFails.clear();
  }

  function pendingAcquire(ip) {
    if (pendingGlobal >= L.maxPendingGlobal) return false;
    if ((pendingByIp.get(ip) || 0) >= L.maxPendingPerIp) return false;
    pendingGlobal++;
    pendingByIp.set(ip, (pendingByIp.get(ip) || 0) + 1);
    return true;
  }
  function pendingRelease(ip) {
    pendingGlobal = Math.max(0, pendingGlobal - 1);
    const n = (pendingByIp.get(ip) || 1) - 1;
    if (n <= 0) pendingByIp.delete(ip); else pendingByIp.set(ip, n);
  }

  function trackSocket(ws) {
    ws._relayLastPong = now();
    liveSockets.add(ws);
    ws.on('pong', () => { ws._relayLastPong = now(); });
    ws.on('close', () => { liveSockets.delete(ws); });
  }

  function endViewerSession(deviceId, reason) {
    const v = viewers.get(deviceId);
    if (!v) return;
    viewers.delete(deviceId);
    const secs = Math.round((now() - v.startedAt) / 1000);
    audit({ username: v.user, role: 'administrador' }, 'remote_session_end', deviceId,
      { duration_s: secs, consent: v.consent, reason: reason || 'cierre' });
    const a = agents.get(deviceId);
    if (a) sendCtl(a.ws, { t: 'session_end' });
    sendCtl(v.ws, { t: 'session_end', reason: reason || 'cierre' });
    try { v.ws.close(1000, 'fin'); } catch (e) { /* ya cerrado */ }
  }

  // ---------- Agente ----------
  function onAgent(ws, ip) {
    let deviceId = null;
    let pending = true;
    let authBusy = false;
    trackSocket(ws);
    const releasePending = () => { if (pending) { pending = false; pendingRelease(ip); } };
    const authTimer = setTimeout(() => { if (!deviceId) { try { ws.close(4001, 'auth timeout'); } catch (e) { /* noop */ } } }, L.authTimeoutMs);
    if (authTimer.unref) authTimer.unref();

    async function handleAuth(data, isBinary) {
      if (authBusy) return; // un intento a la vez
      authBusy = true;
      try {
        if (isBinary || data.length > L.maxControlBytes) { noteAuthFail(ip); return ws.close(4002, 'auth invalida'); }
        let msg;
        try { msg = JSON.parse(data.toString()); } catch (e) { noteAuthFail(ip); return ws.close(4002, 'auth invalida'); }
        if (!msg || msg.t !== 'auth' || typeof msg.device !== 'string' || typeof msg.token !== 'string' || msg.token.length > 200) {
          noteAuthFail(ip); return ws.close(4002, 'auth invalida');
        }
        if (ipBlocked(ip)) return ws.close(4008, 'demasiados intentos');
        const dev = await sbFindDevice(msg.device);
        if (ws.readyState !== 1) return; // se cerró mientras se consultaba
        if (!dev || typeof dev.token_hash !== 'string' || !safeEqualHex(sha256hex(msg.token), dev.token_hash)) {
          noteAuthFail(ip); return ws.close(4003, 'credenciales');
        }
        clearTimeout(authTimer);
        deviceId = dev.id;
        releasePending();
        // Autenticado: ya puede mandar frames grandes.
        if (ws._receiver) ws._receiver._maxPayload = L.maxFrameBytes;
        // Un solo agente por equipo: el nuevo reemplaza al viejo.
        const prev = agents.get(deviceId);
        if (prev) { try { prev.ws.close(4004, 'reemplazado'); } catch (e) { /* noop */ } }
        const a = { ws, name: dev.name, info: null, lastTouch: 0 };
        agents.set(deviceId, a);
        maybeTouch(a, deviceId);
        sendCtl(ws, { t: 'authok', name: dev.name });
        // Si ya había un visor esperando a este equipo, retomar el aviso de sesión.
        const v = viewers.get(deviceId);
        if (v) { v.consent = null; sendCtl(ws, { t: 'session_start', viewer: v.user }); }
      } finally {
        authBusy = false;
      }
    }

    function handleAuthed(data, isBinary) {
      const a = agents.get(deviceId);
      if (!a || a.ws !== ws) return;
      const v = viewers.get(deviceId);
      if (isBinary) {
        // Frame de pantalla: solo pasa con consentimiento, dentro del tope de
        // fps/bytes por segundo y sin saturar al visor. El exceso se descarta.
        if (!v || v.consent !== true) return;
        if (data.length > L.maxFrameBytes) return;
        const t = now();
        if (t - v.frameWindowStart >= 1000) { v.frameWindowStart = t; v.framesInWindow = 0; v.bytesInWindow = 0; }
        if (v.framesInWindow >= L.maxFps) return;
        if (v.bytesInWindow + data.length > L.maxBytesPerSec) return;
        if (v.ws.readyState !== 1 || v.ws.bufferedAmount > L.viewerBackpressureBytes) return;
        v.framesInWindow++;
        v.bytesInWindow += data.length;
        try { v.ws.send(data, { binary: true }); } catch (e) { /* noop */ }
        return;
      }
      if (data.length > L.maxControlBytes) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'info') {
        a.info = { w: Number(msg.w) || 0, h: Number(msg.h) || 0, host: String(msg.host || '').slice(0, 80), os: String(msg.os || '').slice(0, 40) };
        if (v) sendCtl(v.ws, { t: 'info', ...a.info });
      } else if (msg.t === 'stat') {
        // Estadísticas del agente (rtt/fps/kbps medidos con los ack) para el
        // medidor de latencia del visor. Solo números/texto corto: nunca se
        // reenvía el objeto crudo del agente.
        if (v) {
          sendCtl(v.ws, {
            t: 'stat',
            rtt: Math.max(0, Number(msg.rtt) || 0),
            fps: Math.max(0, Number(msg.fps) || 0),
            kbps: Math.max(0, Number(msg.kbps) || 0),
            mode: String(msg.mode || '').slice(0, 20),
          });
        }
      } else if (msg.t === 'consent') {
        if (!v) return;
        v.consent = msg.ok === true;
        v.viewOnly = msg.viewOnly === true;
        const unattended = msg.unattended === true; // ese equipo tiene "unattended":true en su config.json (decisión local, no del servidor)
        sendCtl(v.ws, { t: 'consent', ok: v.consent, viewOnly: v.viewOnly });
        audit({ username: v.user, role: 'administrador' }, 'remote_session_consent', deviceId,
          unattended ? { ok: v.consent, viewOnly: v.viewOnly, unattended: true } : { ok: v.consent, viewOnly: v.viewOnly });
        if (!v.consent) endViewerSession(deviceId, 'rechazada en el equipo');
      } else if (msg.t === 'ping') {
        maybeTouch(a, deviceId);
      }
    }

    ws.on('message', (data, isBinary) => {
      ws._relayLastPong = now(); // cualquier mensaje cuenta como señal de vida
      try {
        if (!deviceId) {
          handleAuth(data, isBinary).catch((e) => {
            console.error('relay: error autenticando agente: ' + (e && e.message));
            try { ws.close(1011, 'error'); } catch (e2) { /* noop */ }
          });
          return;
        }
        handleAuthed(data, isBinary);
      } catch (e) {
        console.error('relay: error en mensaje de agente: ' + (e && e.message));
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      releasePending();
      if (!deviceId) return;
      const a = agents.get(deviceId);
      if (a && a.ws === ws) {
        agents.delete(deviceId);
        const v = viewers.get(deviceId);
        if (v) sendCtl(v.ws, { t: 'agent_offline' });
      }
    });
    ws.on('error', () => {});
  }

  // ---------- Visor ----------
  function onViewer(ws, deviceId, username, req) {
    trackSocket(ws);
    ws.on('error', () => {});
    // Una sola sesión de visor en todo el sistema.
    if (viewers.size > 0) {
      sendCtl(ws, { t: 'error', error: viewers.has(deviceId) ? 'Ese equipo ya tiene otra sesión abierta' : 'Ya hay otra sesión remota abierta' });
      try { ws.close(4005, 'ocupado'); } catch (e) { /* noop */ }
      return;
    }
    const t0 = now();
    const v = {
      ws, req, user: username, consent: null, viewOnly: false,
      startedAt: t0, lastInput: t0, lastRevalidate: t0, revalidating: false,
      count: 0, windowStart: t0,
      frameWindowStart: t0, framesInWindow: 0, bytesInWindow: 0,
    };
    viewers.set(deviceId, v);
    audit({ username, role: 'administrador' }, 'remote_session_start', deviceId, null);
    const a = agents.get(deviceId);
    if (!a) { sendCtl(ws, { t: 'agent_offline' }); } else {
      sendCtl(ws, { t: 'waiting_consent', name: a.name });
      if (a.info) sendCtl(ws, { t: 'info', ...a.info });
      sendCtl(a.ws, { t: 'session_start', viewer: username });
    }

    ws.on('message', (data, isBinary) => {
      ws._relayLastPong = now();
      try {
        if (isBinary || data.length > L.maxControlBytes) return;
        const t = now();
        if (t - v.windowStart > 1000) { v.windowStart = t; v.count = 0; }
        if (++v.count > L.viewerMaxMsgPerSec) return;
        let raw;
        try { raw = JSON.parse(data.toString()); } catch (e) { return; }
        const msg = sanitizeViewerMessage(raw);
        if (!msg) return;
        if (msg.t === 'ping') return sendCtl(ws, { t: 'pong' });
        const ag = agents.get(deviceId);
        if (!ag) return;
        if (viewers.get(deviceId) !== v) return;
        if (v.consent !== true) return; // sin consentimiento no pasa nada
        // ack/caps son control de flujo del video, no entrada del usuario:
        // pasan también en modo solo-ver (ahí también se reciben frames) y,
        // como el ping, no cuentan para el corte por inactividad.
        if (v.viewOnly && msg.t !== 'quality' && msg.t !== 'ack' && msg.t !== 'caps') return;
        if (msg.t !== 'ack' && msg.t !== 'caps') v.lastInput = t;
        sendCtl(ag.ws, msg);
      } catch (e) {
        console.error('relay: error en mensaje de visor: ' + (e && e.message));
      }
    });
    ws.on('close', () => {
      const cur = viewers.get(deviceId);
      if (cur && cur.ws === ws) endViewerSession(deviceId, 'visor cerrado');
    });
  }

  function sessionStillValid(s) {
    return !!(s && s.role === 'administrador' && !s.must_change_password && !s.admin_return);
  }

  // Duración máxima, inactividad y revalidación de la sesión admin.
  function checkViewerSessions() {
    const t = now();
    for (const [deviceId, v] of viewers) {
      if (t - v.startedAt >= L.maxSessionMs) { endViewerSession(deviceId, 'duración máxima'); continue; }
      if (t - v.lastInput >= L.idleMs) { endViewerSession(deviceId, 'inactividad'); continue; }
      if (!v.revalidating && t - v.lastRevalidate >= L.revalidateMs) {
        v.revalidating = true;
        v.lastRevalidate = t;
        Promise.resolve()
          .then(() => getSession(v.req))
          .then((s) => sessionStillValid(s) && s.username === v.user, () => false)
          .then((ok) => {
            v.revalidating = false;
            if (!ok && viewers.get(deviceId) === v) endViewerSession(deviceId, 'sesión admin inválida');
          })
          .catch(() => { v.revalidating = false; });
      }
    }
  }

  function heartbeat() {
    const t = now();
    for (const ws of liveSockets) {
      if (ws.readyState !== 1) continue;
      if (t - (ws._relayLastPong || 0) > L.heartbeatTimeoutMs) {
        try { ws.terminate(); } catch (e) { /* noop */ }
        continue;
      }
      try { ws.ping(); } catch (e) { /* noop */ }
    }
    try { checkViewerSessions(); } catch (e) { console.error('relay: error revisando sesiones: ' + (e && e.message)); }
  }

  // ---------- Hook al servidor HTTP ----------
  let heartbeatTimer = null;
  const wssList = [];

  function reject(socket, line) {
    try { socket.write('HTTP/1.1 ' + line + '\r\nConnection: close\r\n\r\n'); } catch (e) { /* noop */ }
    try { socket.destroy(); } catch (e) { /* noop */ }
  }

  async function handleUpgrade(wssAgent, wssViewer, req, socket, head) {
    let u;
    try { u = new URL(req.url, 'http://x'); } catch (e) { return socket.destroy(); }
    if (u.pathname !== '/ws/remote/agent' && u.pathname !== '/ws/remote/viewer') return socket.destroy();
    socket.on('error', () => {});
    const ip = clientIp(req);

    if (u.pathname === '/ws/remote/agent') {
      if (ipBlocked(ip)) return reject(socket, '429 Too Many Requests');
      if (!pendingAcquire(ip)) return reject(socket, '503 Service Unavailable');
      let handed = false;
      try {
        wssAgent.handleUpgrade(req, socket, head, (ws) => { handed = true; onAgent(ws, ip); });
      } finally {
        // Si el upgrade falló antes de entregar el socket, liberar el cupo.
        if (!handed) socket.once('close', () => { if (!handed) pendingRelease(ip); });
      }
      return;
    }
    // Visor: Origin debe ser el propio sitio (evita que otra web use la cookie del admin).
    const origin = String(req.headers.origin || '');
    const host = String(req.headers.host || '');
    let originHost = '';
    try { originHost = new URL(origin).host; } catch (e) { /* sin origin */ }
    if (!originHost || originHost !== host) return reject(socket, '403 Forbidden');
    if (ipBlocked(ip)) return reject(socket, '429 Too Many Requests');
    if (!pendingAcquire(ip)) return reject(socket, '503 Service Unavailable');
    let session, dev;
    try {
      session = await Promise.resolve().then(() => getSession(req)).catch(() => null);
      if (!sessionStillValid(session)) { noteAuthFail(ip); return reject(socket, '401 Unauthorized'); }
      dev = await sbFindDevice(u.searchParams.get('device') || '');
      if (!dev) return reject(socket, '404 Not Found');
    } finally {
      pendingRelease(ip);
    }
    if (socket.destroyed) return;
    wssViewer.handleUpgrade(req, socket, head, (ws) => onViewer(ws, dev.id, session.username, req));
  }

  function attach(server) {
    // Agente: 4 KB hasta autenticar (se sube a maxFrameBytes al autenticar).
    const wssAgent = new WebSocketServer({ noServer: true, maxPayload: L.preAuthMaxPayload });
    // Visor: solo manda JSON chico, 4 KB siempre.
    const wssViewer = new WebSocketServer({ noServer: true, maxPayload: L.preAuthMaxPayload });
    wssList.push(wssAgent, wssViewer);
    server.on('upgrade', (req, socket, head) => {
      handleUpgrade(wssAgent, wssViewer, req, socket, head).catch((e) => {
        console.error('relay: error en upgrade: ' + (e && e.message));
        try { socket.destroy(); } catch (e2) { /* noop */ }
      });
    });
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(heartbeat, L.heartbeatIntervalMs);
      if (heartbeatTimer.unref) heartbeatTimer.unref();
    }
  }

  // Para tests / apagado ordenado.
  function shutdown() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    for (const ws of liveSockets) { try { ws.terminate(); } catch (e) { /* noop */ } }
    for (const w of wssList) { try { w.close(); } catch (e) { /* noop */ } }
  }

  // ---------- API admin ----------
  async function handleApi(req, res, pathname, requireAdmin) {
    if (!pathname.startsWith('/api/remote/')) return false;

    if (pathname === '/api/remote/devices' && req.method === 'GET') {
      const session = await requireAdmin(req, res); if (!session) return true;
      const r = await fetch(SUPABASE_URL + '/rest/v1/cb_remote_devices?select=id,name,created_at,last_seen&order=created_at.asc', { headers: SB_HEADERS });
      const rows = r.ok ? await r.json() : [];
      const out = rows.map((d) => ({ ...d, online: agents.has(d.id), busy: viewers.has(d.id), info: (agents.get(d.id) || {}).info || null }));
      sendJson(res, 200, { devices: out });
      return true;
    }

    if (pathname === '/api/remote/devices/create' && req.method === 'POST') {
      const session = await requireAdmin(req, res); if (!session) return true;
      let body;
      try { body = await readBody(req); } catch (e) { sendJson(res, 400, { error: 'JSON inválido' }); return true; }
      const name = String(body.name || '').trim().slice(0, 60);
      if (!name) { sendJson(res, 400, { error: 'Falta el nombre del equipo' }); return true; }
      const token = crypto.randomBytes(24).toString('hex');
      const r = await fetch(SUPABASE_URL + '/rest/v1/cb_remote_devices', {
        method: 'POST',
        headers: { ...SB_HEADERS, Prefer: 'return=representation' },
        body: JSON.stringify({ name, token_hash: sha256hex(token), created_by: session.username }),
      });
      if (!r.ok) { sendJson(res, 500, { error: 'No se pudo crear el equipo' }); return true; }
      const row = (await r.json())[0];
      negativeCache.delete(row.id);
      await deps.sbLogAudit(session, 'remote_device_create', row.id, { name });
      // El token solo se muestra ahora; en la base queda únicamente su hash.
      sendJson(res, 200, { ok: true, id: row.id, name: row.name, token });
      return true;
    }

    if (pathname === '/api/remote/devices/delete' && req.method === 'POST') {
      const session = await requireAdmin(req, res); if (!session) return true;
      let body;
      try { body = await readBody(req); } catch (e) { sendJson(res, 400, { error: 'JSON inválido' }); return true; }
      const id = String(body.id || '');
      if (!UUID_RE.test(id)) { sendJson(res, 400, { error: 'Id inválido' }); return true; }
      const r = await fetch(SUPABASE_URL + '/rest/v1/cb_remote_devices?id=eq.' + id, { method: 'DELETE', headers: { ...SB_HEADERS, Prefer: 'return=minimal' } });
      if (!r.ok) { sendJson(res, 500, { error: 'No se pudo borrar' }); return true; }
      const a = agents.get(id); if (a) { try { a.ws.close(4006, 'borrado'); } catch (e) { /* noop */ } }
      endViewerSession(id, 'equipo borrado');
      await deps.sbLogAudit(session, 'remote_device_delete', id, null);
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 404, { error: 'No encontrado' });
    return true;
  }

  return { attach, handleApi, shutdown, _agents: agents, _viewers: viewers, _heartbeat: heartbeat };
}

module.exports = { create, sha256hex, sanitizeViewerMessage, DEFAULT_LIMITS };
