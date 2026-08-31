// Chaturbate token tracker — minimal backend, zero npm dependencies.
// Listens to the official Events API server-side (no CORS issue, unlike a browser)
// and persists tips to a local JSON file per model so a real quincena report can be
// built over time. Tracks multiple models at once.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const EVENTS_BASE = 'https://eventsapi.chaturbate.com/events/';

// Fuente de tipo de cambio USD -> moneda local. Cambia CURRENCY si hace falta.
const CURRENCY = 'COP';
const RATE_CACHE_MS = 10 * 60 * 1000;
let rateCache = { rate: null, updatedAt: 0, error: null };

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

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Un tracker en memoria por cada modelo activa. La clave es el username en minúsculas.
// El token SOLO vive aquí en memoria, nunca se escribe a disco.
const trackers = new Map();

function sanitizeUsername(u) {
  if (typeof u !== 'string') return null;
  const clean = u.trim();
  if (!/^[a-zA-Z0-9_\-]{1,50}$/.test(clean)) return null;
  return clean;
}

function dataFile(username) {
  return path.join(DATA_DIR, username.toLowerCase() + '.json');
}

function loadTips(username) {
  const file = dataFile(username);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [];
  }
}

function appendTip(username, tokens, id) {
  const file = dataFile(username);
  const list = loadTips(username);
  if (list.some((t) => t.id === id)) return; // dedupe
  list.push({ tokens, ts: Date.now(), id });
  fs.writeFileSync(file, JSON.stringify(list));
}

function knownUsernames() {
  const set = new Set();
  for (const key of trackers.keys()) set.add(trackers.get(key).username);
  if (fs.existsSync(DATA_DIR)) {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (f.endsWith('.json')) set.add(f.slice(0, -5));
    }
  }
  return Array.from(set);
}

function buildReport(username) {
  const all = loadTips(username);
  const now = Date.now();
  const period = getQuincena(now);
  const inPeriod = all.filter((t) => t.ts >= period.start && t.ts <= period.end);
  const total = inPeriod.reduce((sum, t) => sum + t.tokens, 0);

  let trackingSince = null;
  let periodCoveragePct = 0;
  if (all.length > 0) {
    trackingSince = Math.min(...all.map((t) => t.ts));
    const trackedFrom = Math.max(trackingSince, period.start);
    const trackedTo = Math.min(now, period.end);
    const periodLenMs = period.end - period.start;
    periodCoveragePct = Math.max(0, Math.min(100, ((trackedTo - trackedFrom) / periodLenMs) * 100));
  }

  const tr = trackers.get(username.toLowerCase());
  const online = tr
    ? { state: tr.isOnline === true ? 'online' : tr.isOnline === false ? 'offline' : 'unknown', since: tr.onlineSince }
    : { state: 'unknown', since: null };

  return {
    account: username,
    period: { label: period.label, payoutLabel: period.payoutLabel },
    totalTokensPeriod: total,
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
      await sleep(5000);
      continue;
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      tracker.status = 'error';
      if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
        tracker.lastError = 'Token o username inválido (HTTP ' + resp.status + ')';
        tracker.running = false;
        break;
      }
      tracker.lastError = 'HTTP ' + resp.status + ' — ' + body.slice(0, 200);
      await sleep(5000);
      continue;
    }

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      tracker.status = 'error';
      tracker.lastError = 'Respuesta no-JSON de la API';
      await sleep(5000);
      continue;
    }

    tracker.status = 'connected';
    tracker.lastError = null;

    const events = data.events || [];
    for (const ev of events) {
      if (ev.method === 'tip' && ev.object && ev.object.tip) {
        appendTip(username, ev.object.tip.tokens || 0, ev.id);
      } else if (ev.method === 'broadcastStart') {
        tracker.isOnline = true;
        tracker.onlineSince = Date.now();
      } else if (ev.method === 'broadcastStop') {
        tracker.isOnline = false;
        tracker.onlineSince = null;
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
    const rate = data && data.rates ? data.rates[CURRENCY] : null;
    if (rate) {
      rateCache = { rate, updatedAt: now, error: null };
    } else {
      rateCache = { rate: rateCache.rate, updatedAt: rateCache.updatedAt, error: 'Moneda ' + CURRENCY + ' no encontrada' };
    }
  } catch (e) {
    rateCache = { rate: rateCache.rate, updatedAt: rateCache.updatedAt, error: e.message };
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

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

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

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === '/api/start' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = sanitizeUsername(body.username);
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!username || !token) return sendJson(res, 400, { error: 'username o token inválido' });

    const key = username.toLowerCase();
    const existing = trackers.get(key);
    if (existing && existing.abortCtl) existing.abortCtl.abort();

    const tracker = {
      username, token, running: true, status: 'connecting', lastError: null, abortCtl: null,
      isOnline: existing ? existing.isOnline : null,
      onlineSince: existing ? existing.onlineSince : null,
    };
    trackers.set(key, tracker);
    pollLoop(tracker);
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/stop' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: 'JSON inválido' }); }
    const username = sanitizeUsername(body.username);
    if (!username) return sendJson(res, 400, { error: 'username inválido' });
    const tracker = trackers.get(username.toLowerCase());
    if (tracker) {
      tracker.running = false;
      if (tracker.abortCtl) tracker.abortCtl.abort();
      tracker.status = 'idle';
    }
    return sendJson(res, 200, { ok: true });
  }

  if (parsed.pathname === '/api/models' && req.method === 'GET') {
    const usernames = knownUsernames();
    const models = usernames.map(buildReport).sort((a, b) => a.account.localeCompare(b.account));
    const dollar = await getDollarRate();
    return sendJson(res, 200, { models, dollar: { ...dollar, currency: CURRENCY } });
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
});
