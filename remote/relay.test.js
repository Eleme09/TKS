// Tests del relay de control remoto: servidor HTTP local, Supabase simulado
// (findDevice/touchDevice/getSession inyectados), clientes `ws` reales.
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const WebSocket = require('ws');
const relayLib = require('./relay');

const DEV_ID = '11111111-2222-3333-4444-555555555555';
const DEV2_ID = '66666666-2222-3333-4444-555555555555';
const TOKEN = 'secreto-del-agente';

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function makeEnv(opts = {}) {
  const audits = [];
  const state = {
    sessionValid: true,
    findCalls: 0,
    findThrows: false,
    devices: {
      [DEV_ID]: { id: DEV_ID, name: 'PC prueba', token_hash: relayLib.sha256hex(TOKEN) },
      [DEV2_ID]: { id: DEV2_ID, name: 'PC dos', token_hash: relayLib.sha256hex(TOKEN) },
    },
  };
  const relay = relayLib.create({
    SUPABASE_URL: 'http://supabase.invalid',
    SB_HEADERS: {},
    getSession: async (req) => {
      if (!state.sessionValid) return null;
      if (!/sess=admin/.test(String(req.headers.cookie || ''))) return null;
      return { username: 'admin', role: 'administrador' };
    },
    sbLogAudit: async (actor, action, target, details) => { audits.push({ action, target, details }); },
    sendJson: () => {},
    readBody: async () => ({}),
    findDevice: async (id) => {
      state.findCalls++;
      if (state.findThrows) throw new Error('fetch failed');
      return state.devices[id] || null;
    },
    touchDevice: async () => {},
    limits: Object.assign({ heartbeatIntervalMs: 60 * 60 * 1000 }, opts.limits || {}),
  });
  const server = http.createServer((req, res) => { res.end('ok'); });
  relay.attach(server);
  return { relay, server, audits, state };
}

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

// Cliente con cola de mensajes para poder esperar uno concreto.
function client(url, headers) {
  const ws = new WebSocket(url, { headers });
  ws.msgs = [];
  ws.frames = [];
  ws.closed = new Promise((r) => ws.on('close', (code) => r(code)));
  ws.on('message', (data, isBinary) => {
    if (isBinary) ws.frames.push(data);
    else { try { ws.msgs.push(JSON.parse(data.toString())); } catch (e) { /* noop */ } }
  });
  ws.on('error', () => {});
  ws.opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('unexpected-response', (req, res) => reject(new Error('HTTP ' + res.statusCode)));
    ws.on('error', reject);
  });
  return ws;
}

async function waitFor(fn, ms = 1500) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await delay(10);
  }
  return fn();
}

describe('relay de control remoto', () => {
  let env, port, open;

  beforeEach(async () => {
    env = makeEnv();
    port = await listen(env.server);
    open = [];
  });
  afterEach(async () => {
    for (const ws of open) { try { ws.terminate(); } catch (e) { /* noop */ } }
    env.relay.shutdown();
    await new Promise((r) => env.server.close(r));
  });

  function agent() {
    const ws = client('ws://127.0.0.1:' + port + '/ws/remote/agent');
    open.push(ws);
    return ws;
  }
  function viewer(device = DEV_ID, cookie = 'sess=admin') {
    const ws = client('ws://127.0.0.1:' + port + '/ws/remote/viewer?device=' + device,
      { Origin: 'http://127.0.0.1:' + port, Cookie: cookie });
    open.push(ws);
    return ws;
  }
  async function authedAgent(device = DEV_ID) {
    const a = agent();
    await a.opened;
    a.send(JSON.stringify({ t: 'auth', device, token: TOKEN }));
    assert.ok(await waitFor(() => a.msgs.find((m) => m.t === 'authok')), 'authok');
    return a;
  }
  async function connectedPair({ consent = true } = {}) {
    const a = await authedAgent();
    const v = viewer();
    await v.opened;
    assert.ok(await waitFor(() => a.msgs.find((m) => m.t === 'session_start')));
    if (consent !== null) {
      a.send(JSON.stringify({ t: 'consent', ok: consent }));
      await waitFor(() => v.msgs.find((m) => m.t === 'consent'));
    }
    return { a, v };
  }

  it('rechaza un token de agente incorrecto', async () => {
    const a = agent();
    await a.opened;
    a.send(JSON.stringify({ t: 'auth', device: DEV_ID, token: 'malo' }));
    assert.strictEqual(await a.closed, 4003);
  });

  it('rechaza un visor sin sesión admin', async () => {
    const v = viewer(DEV_ID, 'sess=nadie');
    await assert.rejects(v.opened, /HTTP 401/);
  });

  it('rechaza un visor con Origin ajeno', async () => {
    const ws = client('ws://127.0.0.1:' + port + '/ws/remote/viewer?device=' + DEV_ID,
      { Origin: 'http://malo.example', Cookie: 'sess=admin' });
    open.push(ws);
    await assert.rejects(ws.opened, /HTTP 403/);
  });

  it('auth del agente con payload grande (>4 KB) se corta', async () => {
    const a = agent();
    await a.opened;
    a.send('x'.repeat(5000));
    assert.strictEqual(await a.closed, 1009);
  });

  it('sin consentimiento no pasan input ni frames', async () => {
    const { a, v } = await connectedPair({ consent: null });
    v.send(JSON.stringify({ t: 'mouse', a: 'move', x: 0.5, y: 0.5 }));
    a.send(Buffer.alloc(100, 1));
    await delay(150);
    assert.strictEqual(a.msgs.filter((m) => m.t === 'mouse').length, 0);
    assert.strictEqual(v.frames.length, 0);
  });

  it('con consentimiento pasan input y frames', async () => {
    const { a, v } = await connectedPair();
    v.send(JSON.stringify({ t: 'mouse', a: 'down', b: 0, x: 0.25, y: 0.75, extra: 'fuera' }));
    a.send(Buffer.alloc(100, 1));
    const m = await waitFor(() => a.msgs.find((x) => x.t === 'mouse'));
    assert.deepStrictEqual(m, { t: 'mouse', a: 'down', b: 0, x: 0.25, y: 0.75 });
    assert.ok(await waitFor(() => v.frames.length === 1));
  });

  it('rechazo en el equipo cierra la sesión del visor', async () => {
    const { v } = await connectedPair({ consent: false });
    await v.closed;
    assert.strictEqual(env.relay._viewers.size, 0);
    assert.ok(env.audits.find((x) => x.action === 'remote_session_end'));
  });

  it('descarta mensajes inválidos del visor', async () => {
    const { a, v } = await connectedPair();
    const bad = [
      { t: 'mouse', a: 'move', x: 2, y: 0.5 },
      { t: 'mouse', a: 'move', x: '0.5', y: 0.5 },
      { t: 'mouse', a: 'down', b: 4, x: 0.1, y: 0.1 },
      { t: 'mouse', a: 'wheel', d: 5 },
      { t: 'mouse', a: 'drag', x: 0.1, y: 0.1 },
      { t: 'key', a: 'down', code: 'Key A; rm -rf' },
      { t: 'key', a: 'press', code: 'KeyA' },
      { t: 'text', text: 'x'.repeat(201) },
      { t: 'quality', q: 7 },
      { t: 'exec', cmd: 'calc' },
    ];
    for (const b of bad) v.send(JSON.stringify(b));
    v.send('no es json');
    v.send(JSON.stringify({ t: 'key', a: 'down', code: 'KeyA' })); // válido, marca el final
    await waitFor(() => a.msgs.find((m) => m.t === 'key'));
    const forwarded = a.msgs.filter((m) => ['mouse', 'key', 'text', 'quality', 'exec'].includes(m.t));
    assert.deepStrictEqual(forwarded, [{ t: 'key', a: 'down', code: 'KeyA' }]);
  });

  it('un segundo visor (aunque sea a otro equipo) es rechazado', async () => {
    await connectedPair();
    const v2 = viewer(DEV2_ID);
    await v2.opened;
    assert.strictEqual(await v2.closed, 4005);
    assert.strictEqual(env.relay._viewers.size, 1);
  });

  it('un error de findDevice no lanza ni tumba el proceso', async () => {
    env.state.findThrows = true;
    const a = agent();
    await a.opened;
    a.send(JSON.stringify({ t: 'auth', device: DEV_ID, token: TOKEN }));
    assert.strictEqual(await a.closed, 4003);
    const v = viewer();
    await assert.rejects(v.opened, /HTTP 404/);
    // El servidor sigue atendiendo.
    env.state.findThrows = false;
    await authedAgent();
  });

  it('caché negativo: un id inexistente no reconsulta Supabase', async () => {
    const ghost = '99999999-2222-3333-4444-555555555555';
    for (let i = 0; i < 3; i++) {
      const a = agent();
      await a.opened;
      a.send(JSON.stringify({ t: 'auth', device: ghost, token: TOKEN }));
      await a.closed;
    }
    assert.strictEqual(env.state.findCalls, 1);
  });

  it('tope de frames por segundo', async () => {
    const { a, v } = await connectedPair();
    for (let i = 0; i < 60; i++) a.send(Buffer.alloc(50, i));
    await delay(200);
    assert.ok(v.frames.length <= 30, 'frames: ' + v.frames.length); // maxFps subió de 8 a 30 (2026-11-20)
    assert.ok(v.frames.length >= 1);
  });

  it('revalidación: si la sesión admin deja de valer, se corta', async () => {
    const { v } = await connectedPair();
    env.state.sessionValid = false;
    const s = env.relay._viewers.get(DEV_ID);
    s.lastRevalidate = 0;
    env.relay._heartbeat();
    await v.closed;
    assert.strictEqual(env.relay._viewers.size, 0);
  });

  it('heartbeat: un visor que no responde se termina y libera el equipo', async () => {
    const { v } = await connectedPair();
    for (const ws of env.relay._viewers.values()) ws.ws._relayLastPong = 0;
    env.relay._heartbeat();
    await v.closed;
    assert.ok(await waitFor(() => env.relay._viewers.size === 0));
  });

  it('corte por inactividad', async () => {
    const { v } = await connectedPair();
    env.relay._viewers.get(DEV_ID).lastInput = 0;
    env.relay._heartbeat();
    await v.closed;
    assert.ok(env.audits.find((x) => x.action === 'remote_session_end' && x.details.reason === 'inactividad'));
  });

  it('consent con unattended:true queda auditado', async () => {
    const a = await authedAgent();
    const v = viewer();
    await v.opened;
    await waitFor(() => a.msgs.find((m) => m.t === 'session_start'));
    a.send(JSON.stringify({ t: 'consent', ok: true, unattended: true }));
    await waitFor(() => v.msgs.find((m) => m.t === 'consent'));
    const ev = env.audits.find((x) => x.action === 'remote_session_consent');
    assert.ok(ev && ev.details.ok === true && ev.details.unattended === true);
  });

  it('consent sin unattended no agrega el campo a la auditoría', async () => {
    await connectedPair();
    const ev = env.audits.find((x) => x.action === 'remote_session_consent');
    assert.ok(ev && !('unattended' in ev.details));
  });

  it('teclas Win y combos se reenvían al agente (compatibilidad control total)', async () => {
    const { a, v } = await connectedPair();
    for (const code of ['MetaLeft', 'MetaRight', 'ContextMenu', 'AltLeft', 'ControlRight', 'F5', 'PrintScreen']) {
      v.send(JSON.stringify({ t: 'key', a: 'down', code }));
    }
    await waitFor(() => a.msgs.filter((m) => m.t === 'key').length >= 7);
    const codes = a.msgs.filter((m) => m.t === 'key').map((m) => m.code);
    assert.deepStrictEqual(codes, ['MetaLeft', 'MetaRight', 'ContextMenu', 'AltLeft', 'ControlRight', 'F5', 'PrintScreen']);
  });

  it('ack/caps se reenvían al agente y NO cuentan como actividad', async () => {
    const { a, v } = await connectedPair();
    env.relay._viewers.get(DEV_ID).lastInput = 0; // simula sesión "inactiva" hace mucho
    v.send(JSON.stringify({ t: 'caps', tiles: true }));
    v.send(JSON.stringify({ t: 'ack', seq: 3, resync: true }));
    await waitFor(() => a.msgs.find((m) => m.t === 'ack'));
    assert.ok(a.msgs.find((m) => m.t === 'caps' && m.tiles === true));
    assert.ok(a.msgs.find((m) => m.t === 'ack' && m.seq === 3 && m.resync === true));
    assert.strictEqual(env.relay._viewers.get(DEV_ID).lastInput, 0, 'ack/caps no deben actualizar lastInput');
  });

  it('ack/caps pasan incluso en modo solo-ver', async () => {
    const a = await authedAgent();
    const v = viewer();
    await v.opened;
    await waitFor(() => a.msgs.find((m) => m.t === 'session_start'));
    a.send(JSON.stringify({ t: 'consent', ok: true, viewOnly: true }));
    await waitFor(() => v.msgs.find((m) => m.t === 'consent'));
    v.send(JSON.stringify({ t: 'ack', seq: 1 }));
    v.send(JSON.stringify({ t: 'mouse', a: 'move', x: 0.1, y: 0.1 })); // esto SÍ se bloquea en solo-ver
    await waitFor(() => a.msgs.find((m) => m.t === 'ack'));
    await delay(80);
    assert.strictEqual(a.msgs.filter((m) => m.t === 'mouse').length, 0);
  });

  it('reenvía {t:stat} del agente al visor, saneado', async () => {
    const { a, v } = await connectedPair();
    a.send(JSON.stringify({ t: 'stat', rtt: 45, fps: 22, kbps: 310, mode: 'completa', extra: 'fuera' }));
    const m = await waitFor(() => v.msgs.find((x) => x.t === 'stat'));
    assert.deepStrictEqual(m, { t: 'stat', rtt: 45, fps: 22, kbps: 310, mode: 'completa' });
  });
});

describe('límite de conexiones sin autenticar', () => {
  let env, port;
  before(async () => {
    env = makeEnv({ limits: { maxPendingPerIp: 2 } });
    port = await listen(env.server);
  });
  after(async () => {
    env.relay.shutdown();
    await new Promise((r) => env.server.close(r));
  });

  it('una tercera conexión pendiente desde la misma IP se rechaza', async () => {
    const socks = [];
    for (let i = 0; i < 2; i++) {
      const ws = client('ws://127.0.0.1:' + port + '/ws/remote/agent');
      socks.push(ws);
      await ws.opened;
    }
    const third = client('ws://127.0.0.1:' + port + '/ws/remote/agent');
    socks.push(third);
    await assert.rejects(third.opened, /HTTP 503/);
    for (const s of socks) s.terminate();
  });
});

describe('sanitizeViewerMessage', () => {
  const s = relayLib.sanitizeViewerMessage;
  it('acepta las formas válidas', () => {
    assert.deepStrictEqual(s({ t: 'mouse', a: 'wheel', d: -1 }), { t: 'mouse', a: 'wheel', d: -1 });
    assert.deepStrictEqual(s({ t: 'text', text: 'hola' }), { t: 'text', text: 'hola' });
    assert.deepStrictEqual(s({ t: 'quality', q: 2 }), { t: 'quality', q: 2 });
    assert.deepStrictEqual(s({ t: 'key', a: 'up', code: 'ArrowLeft' }), { t: 'key', a: 'up', code: 'ArrowLeft' });
    assert.deepStrictEqual(s({ t: 'key', a: 'down', code: 'MetaLeft' }), { t: 'key', a: 'down', code: 'MetaLeft' });
    assert.deepStrictEqual(s({ t: 'key', a: 'down', code: 'ContextMenu' }), { t: 'key', a: 'down', code: 'ContextMenu' });
    assert.deepStrictEqual(s({ t: 'ack', seq: 42 }), { t: 'ack', seq: 42 });
    assert.deepStrictEqual(s({ t: 'ack', seq: 0, resync: true }), { t: 'ack', seq: 0, resync: true });
    assert.deepStrictEqual(s({ t: 'ack', seq: 5, resync: false }), { t: 'ack', seq: 5 });
    assert.deepStrictEqual(s({ t: 'caps', tiles: true }), { t: 'caps', tiles: true });
  });
  it('rechaza basura', () => {
    assert.strictEqual(s(null), null);
    assert.strictEqual(s([1]), null);
    assert.strictEqual(s({ t: 'mouse', a: 'move', x: NaN, y: 0 }), null);
    assert.strictEqual(s({ t: 'text', text: '' }), null);
    assert.strictEqual(s({ t: 'quality', q: 0 }), null);
    assert.strictEqual(s({ t: 'ack', seq: -1 }), null);
    assert.strictEqual(s({ t: 'ack', seq: 1.5 }), null);
    assert.strictEqual(s({ t: 'ack', seq: 4294967296 }), null);
    assert.strictEqual(s({ t: 'ack' }), null);
    assert.strictEqual(s({ t: 'caps', tiles: false }), null);
    assert.strictEqual(s({ t: 'caps' }), null);
  });
  it('rechaza texto largo (>200 caracteres)', () => {
    assert.deepStrictEqual(s({ t: 'text', text: 'a'.repeat(200) }), { t: 'text', text: 'a'.repeat(200) });
    assert.strictEqual(s({ t: 'text', text: 'a'.repeat(201) }), null);
  });
});
