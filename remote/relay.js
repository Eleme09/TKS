// Control remoto de equipos (2026-11-14) — relay WebSocket dentro del propio TKS.
//
// Piezas:
//   - Agente (remote-agent/, .exe de Windows): se conecta a /ws/remote/agent,
//     se autentica con {t:'auth', device, token}, manda pantalla (JPEG binario)
//     y ejecuta el input que llegue.
//   - Visor (public/remoto.html): se conecta a /ws/remote/viewer?device=ID con
//     la cookie de sesión de un ADMINISTRADOR. Nadie más puede entrar.
//   - Este módulo solo retransmite. Reglas de seguridad que viven aquí:
//       * el visor solo entra con sesión administrador + Origin del propio sitio;
//       * el token del agente se guarda como sha256, comparación timing-safe;
//       * el input del visor NO llega al agente hasta que el agente confirme
//         el consentimiento (el agente le muestra un aviso a quien está en el
//         computador); los frames del agente tampoco pasan antes de eso;
//       * un solo visor por equipo, límites de tamaño y de ritmo de mensajes;
//       * inicio y fin de cada sesión quedan en cb_audit_log.
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const MAX_FRAME_BYTES = 6 * 1024 * 1024;
const MAX_CONTROL_BYTES = 2048;
const AUTH_TIMEOUT_MS = 10000;
const VIEWER_MAX_MSG_PER_SEC = 250;
const VIEWER_BACKPRESSURE_BYTES = 1.5 * 1024 * 1024;
const LAST_SEEN_WRITE_MS = 60 * 1000;

const VIEWER_TYPES = new Set(['mouse', 'key', 'text', 'quality', 'ping']);

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

function create(deps) {
  const { SUPABASE_URL, SB_HEADERS, getSession, sbLogAudit, sendJson, readBody } = deps;

  // deviceId -> { ws, name, info, lastSeenWritten }
  const agents = new Map();
  // deviceId -> { ws, user, consent, startedAt, msgCount, windowStart }
  const viewers = new Map();

  async function sbFindDevice(id) {
    if (!UUID_RE.test(id)) return null;
    const r = await fetch(SUPABASE_URL + '/rest/v1/cb_remote_devices?id=eq.' + id + '&select=*', { headers: SB_HEADERS });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0] || null;
  }

  async function sbTouchDevice(id) {
    await fetch(SUPABASE_URL + '/rest/v1/cb_remote_devices?id=eq.' + id, {
      method: 'PATCH',
      headers: { ...SB_HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ last_seen: new Date().toISOString() }),
    }).catch(() => {});
  }

  function sendCtl(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  function endViewerSession(deviceId, reason) {
    const v = viewers.get(deviceId);
    if (!v) return;
    viewers.delete(deviceId);
    const secs = Math.round((Date.now() - v.startedAt) / 1000);
    sbLogAudit({ username: v.user, role: 'administrador' }, 'remote_session_end', deviceId,
      { duration_s: secs, consent: v.consent, reason: reason || 'cierre' });
    const a = agents.get(deviceId);
    if (a) sendCtl(a.ws, { t: 'session_end' });
    try { v.ws.close(1000, 'fin'); } catch (e) { /* ya cerrado */ }
  }

  // ---------- Agente ----------
  function onAgent(ws) {
    let deviceId = null;
    const authTimer = setTimeout(() => { if (!deviceId) ws.close(4001, 'auth timeout'); }, AUTH_TIMEOUT_MS);

    ws.on('message', async (data, isBinary) => {
      if (!deviceId) {
        if (isBinary || data.length > MAX_CONTROL_BYTES) return ws.close(4002, 'auth invalida');
        let msg;
        try { msg = JSON.parse(data.toString()); } catch (e) { return ws.close(4002, 'auth invalida'); }
        if (!msg || msg.t !== 'auth' || typeof msg.device !== 'string' || typeof msg.token !== 'string') return ws.close(4002, 'auth invalida');
        const dev = await sbFindDevice(msg.device);
        if (!dev || !safeEqualHex(sha256hex(msg.token), dev.token_hash)) return ws.close(4003, 'credenciales');
        clearTimeout(authTimer);
        deviceId = dev.id;
        // Un solo agente por equipo: el nuevo reemplaza al viejo.
        const prev = agents.get(deviceId);
        if (prev) { try { prev.ws.close(4004, 'reemplazado'); } catch (e) { /* noop */ } }
        agents.set(deviceId, { ws, name: dev.name, info: null, lastTouch: 0 });
        sbTouchDevice(deviceId);
        sendCtl(ws, { t: 'authok', name: dev.name });
        // Si ya había un visor esperando a este equipo, retomar el aviso de sesión.
        const v = viewers.get(deviceId);
        if (v) { v.consent = null; sendCtl(ws, { t: 'session_start', viewer: v.user }); }
        return;
      }
      const a = agents.get(deviceId);
      if (!a || a.ws !== ws) return;
      const v = viewers.get(deviceId);
      if (isBinary) {
        // Frame de pantalla: solo pasa con consentimiento y sin saturar al visor.
        if (!v || v.consent !== true) return;
        if (data.length > MAX_FRAME_BYTES) return;
        if (v.ws.readyState !== 1 || v.ws.bufferedAmount > VIEWER_BACKPRESSURE_BYTES) return;
        v.ws.send(data, { binary: true });
        return;
      }
      if (data.length > MAX_CONTROL_BYTES) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'info') {
        a.info = { w: Number(msg.w) || 0, h: Number(msg.h) || 0, host: String(msg.host || '').slice(0, 80), os: String(msg.os || '').slice(0, 40) };
        if (v) sendCtl(v.ws, { t: 'info', ...a.info });
      } else if (msg.t === 'consent') {
        if (!v) return;
        v.consent = msg.ok === true;
        sendCtl(v.ws, { t: 'consent', ok: v.consent, viewOnly: msg.viewOnly === true });
        v.viewOnly = msg.viewOnly === true;
        sbLogAudit({ username: v.user, role: 'administrador' }, 'remote_session_consent', deviceId, { ok: v.consent, viewOnly: v.viewOnly });
        if (!v.consent) endViewerSession(deviceId, 'rechazada en el equipo');
      } else if (msg.t === 'ping') {
        const now = Date.now();
        if (now - a.lastTouch > LAST_SEEN_WRITE_MS) { a.lastTouch = now; sbTouchDevice(deviceId); }
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
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
  function onViewer(ws, deviceId, username) {
    const existing = viewers.get(deviceId);
    if (existing) { sendCtl(ws, { t: 'error', error: 'Ese equipo ya tiene otra sesión abierta' }); return ws.close(4005, 'ocupado'); }
    const v = { ws, user: username, consent: null, viewOnly: false, startedAt: Date.now(), count: 0, windowStart: Date.now() };
    viewers.set(deviceId, v);
    sbLogAudit({ username, role: 'administrador' }, 'remote_session_start', deviceId, null);
    const a = agents.get(deviceId);
    if (!a) { sendCtl(ws, { t: 'agent_offline' }); } else {
      sendCtl(ws, { t: 'waiting_consent', name: a.name });
      if (a.info) sendCtl(ws, { t: 'info', ...a.info });
      sendCtl(a.ws, { t: 'session_start', viewer: username });
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary || data.length > MAX_CONTROL_BYTES) return;
      const now = Date.now();
      if (now - v.windowStart > 1000) { v.windowStart = now; v.count = 0; }
      if (++v.count > VIEWER_MAX_MSG_PER_SEC) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (!msg || !VIEWER_TYPES.has(msg.t)) return;
      if (msg.t === 'ping') return sendCtl(ws, { t: 'pong' });
      const ag = agents.get(deviceId);
      if (!ag) return;
      if (v.consent !== true) return; // sin consentimiento no pasa nada
      if (v.viewOnly && msg.t !== 'quality') return;
      ag.ws.send(JSON.stringify(msg));
    });
    ws.on('close', () => {
      const cur = viewers.get(deviceId);
      if (cur && cur.ws === ws) endViewerSession(deviceId, 'visor cerrado');
    });
    ws.on('error', () => {});
  }

  // ---------- Hook al servidor HTTP ----------
  function attach(server) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
    server.on('upgrade', async (req, socket, head) => {
      let u;
      try { u = new URL(req.url, 'http://x'); } catch (e) { return socket.destroy(); }
      if (u.pathname !== '/ws/remote/agent' && u.pathname !== '/ws/remote/viewer') return socket.destroy();
      socket.on('error', () => {});

      if (u.pathname === '/ws/remote/agent') {
        wss.handleUpgrade(req, socket, head, (ws) => onAgent(ws));
        return;
      }
      // Visor: Origin debe ser el propio sitio (evita que otra web use la cookie del admin).
      const origin = String(req.headers.origin || '');
      const host = String(req.headers.host || '');
      let originHost = '';
      try { originHost = new URL(origin).host; } catch (e) { /* sin origin */ }
      if (!originHost || originHost !== host) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); return socket.destroy(); }
      const session = await getSession(req).catch(() => null);
      if (!session || session.role !== 'administrador' || session.must_change_password || session.admin_return) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return socket.destroy();
      }
      const deviceId = u.searchParams.get('device') || '';
      const dev = await sbFindDevice(deviceId);
      if (!dev) { socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); return socket.destroy(); }
      wss.handleUpgrade(req, socket, head, (ws) => onViewer(ws, dev.id, session.username));
    });
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
      await sbLogAudit(session, 'remote_device_create', row.id, { name });
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
      await sbLogAudit(session, 'remote_device_delete', id, null);
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 404, { error: 'No encontrado' });
    return true;
  }

  return { attach, handleApi, _agents: agents, _viewers: viewers };
}

module.exports = { create, sha256hex };
