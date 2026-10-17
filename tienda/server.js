'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const lib = require('./lib');

// La tienda corre DENTRO del servicio de TKS (se atiende por el host TIENDA_HOST,
// ver server.js de la raíz). Sus variables llevan prefijo TIENDA_ porque TKS ya
// usa SUPABASE_URL/SESSION_SECRET para su propia base de datos. Si falta alguna
// se lanza un error (no process.exit: no debe tumbar a TKS).
const REQUIRED_ENV = ['TIENDA_SUPABASE_URL', 'TIENDA_SUPABASE_SERVICE_ROLE_KEY', 'TIENDA_SESSION_SECRET'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  throw new Error(`Faltan variables de entorno de la tienda: ${missingEnv.join(', ')}`);
}

const supabase = createClient(process.env.TIENDA_SUPABASE_URL, process.env.TIENDA_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Capa de datos ───────────────────────────────────────────────────────

async function sbGetConfig() {
  const { data, error } = await supabase.from('tf_negocio_config').select('*').eq('id', 1).single();
  if (error) throw error;
  return data;
}

async function sbUpdateConfig(fields) {
  const { data, error } = await supabase
    .from('tf_negocio_config')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function sbListPersonas({ activeOnly = false } = {}) {
  let q = supabase.from('tf_personas').select('id, nombre, activo, created_at').order('nombre');
  if (activeOnly) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

async function sbGetPersona(id) {
  const { data, error } = await supabase.from('tf_personas').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function sbCreatePersona(nombre, pin) {
  const { data, error } = await supabase
    .from('tf_personas')
    .insert({ nombre, pin_hash: lib.hashSecret(pin) })
    .select('id, nombre, activo, created_at')
    .single();
  if (error) throw error;
  return data;
}

async function sbUpdatePersona(id, fields) {
  const { data, error } = await supabase
    .from('tf_personas')
    .update(fields)
    .eq('id', id)
    .select('id, nombre, activo, created_at')
    .single();
  if (error) throw error;
  return data;
}

// Personas iniciales: PIN secuencial de 3 dígitos (001, 002, ...). Se crean
// solo las que faltan por nombre — nunca se pisa el PIN de una persona que
// ya existe.
const PERSONAS_INICIALES = [
  'Samantha', 'Estefanía', 'Valeria', 'Michelle', 'Jazbleidy', 'Maryuri', 'Tatiana', 'Angie', 'Camilo',
];

async function ensurePersonasIniciales() {
  const existentes = await sbListPersonas();
  const nombres = new Set(existentes.map((p) => p.nombre.trim().toLowerCase()));
  for (let i = 0; i < PERSONAS_INICIALES.length; i++) {
    const nombre = PERSONAS_INICIALES[i];
    if (nombres.has(nombre.toLowerCase())) continue;
    await sbCreatePersona(nombre, String(i + 1).padStart(3, '0'));
    console.log('Persona inicial creada: ' + nombre);
  }
}

// "Vaciar lista": borra de verdad todos los consumos de una persona (fase de
// prueba). No toca el stock ni los datos de la persona.
async function sbVaciarConsumosPersona(personaId) {
  const { data, error } = await supabase.from('tf_consumos').delete().eq('persona_id', personaId).select('id');
  if (error) throw error;
  return data.length;
}

async function sbListProductos({ activeOnly = false } = {}) {
  let q = supabase.from('tf_productos').select('*').order('nombre');
  if (activeOnly) q = q.eq('activo', true);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

async function sbCreateProducto(fields) {
  const { data, error } = await supabase.from('tf_productos').insert(fields).select().single();
  if (error) throw error;
  return data;
}

async function sbUpdateProducto(id, fields) {
  const { data, error } = await supabase
    .from('tf_productos')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Solo se puede borrar un producto de verdad si nunca tuvo consumos
// registrados — si los tiene, borrarlo rompería la trazabilidad del
// historial (el consumo quedaría apuntando a un producto que no existe).
// En ese caso la única opción es desactivarlo.
async function sbDeleteProducto(id) {
  const { count, error: countError } = await supabase
    .from('tf_consumos')
    .select('id', { count: 'exact', head: true })
    .eq('producto_id', id);
  if (countError) throw countError;
  if (count > 0) {
    throw Object.assign(
      new Error('Este producto ya tiene consumos registrados — no se puede eliminar, solo desactivar.'),
      { status: 400 }
    );
  }
  const { error } = await supabase.from('tf_productos').delete().eq('id', id);
  if (error) throw error;
}

async function sbCreateConsumo({ personaId, productoId, cantidad, precioUnitario }) {
  const { data, error } = await supabase
    .from('tf_consumos')
    .insert({ persona_id: personaId, producto_id: productoId, cantidad, precio_unitario: precioUnitario })
    .select()
    .single();
  if (error) throw error;

  // Descuento de stock directo (no hay concurrencia crítica: un solo
  // dispositivo autoservicio a la vez en la tienda física).
  const { data: producto } = await supabase.from('tf_productos').select('stock').eq('id', productoId).single();
  if (producto) {
    await supabase
      .from('tf_productos')
      .update({ stock: Number(producto.stock) - Number(cantidad) })
      .eq('id', productoId);
  }
  return data;
}

async function sbGetConsumo(id) {
  const { data, error } = await supabase.from('tf_consumos').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

const MOTIVOS_ANULACION = {
  no_hay: 'No había stock',
  no_quiere: 'La persona no lo quiso',
};

// "no_hay": se anotó pero en realidad no había producto físico — es un
// error de conteo, así que el stock se deja en 0 (no se repone nada,
// porque de haber stock real no se habría anotado esto) y el producto
// queda marcado sin stock hasta que el dueño lo recargue.
// "no_quiere": la persona se arrepintió, el producto vuelve físicamente
// al estante — se repone la cantidad al stock, como antes.
async function sbAnularConsumo(id, tipo) {
  const motivo = MOTIVOS_ANULACION[tipo];
  if (!motivo) throw Object.assign(new Error('Motivo de anulación inválido'), { status: 400 });

  const { data, error } = await supabase
    .from('tf_consumos')
    .update({ anulado: true, motivo_anulacion: motivo, anulado_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;

  if (tipo === 'no_hay') {
    await supabase.from('tf_productos').update({ stock: 0 }).eq('id', data.producto_id);
  } else {
    const { data: producto } = await supabase.from('tf_productos').select('stock').eq('id', data.producto_id).single();
    if (producto) {
      await supabase
        .from('tf_productos')
        .update({ stock: Number(producto.stock) + Number(data.cantidad) })
        .eq('id', data.producto_id);
    }
  }
  return data;
}

async function sbListConsumosByPersona(personaId, limit = 200) {
  const { data, error } = await supabase
    .from('tf_consumos')
    .select('*, tf_productos(nombre)')
    .eq('persona_id', personaId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

async function sbFindAdminByUsername(username) {
  const { data, error } = await supabase.from('tf_admins').select('*').eq('username', username).maybeSingle();
  if (error) throw error;
  return data;
}

async function sbCountAdmins() {
  const { count, error } = await supabase.from('tf_admins').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

async function sbCreateAdmin(username, passwordHash, displayName) {
  const { data, error } = await supabase
    .from('tf_admins')
    .insert({ username, password_hash: passwordHash, display_name: displayName || null })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── App ─────────────────────────────────────────────────────────────────

const app = express();
app.set('trust proxy', 1); // detrás del proxy de Render

app.use(helmet({ contentSecurityPolicy: false }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' },
});

// El PIN de una persona se intenta mucho más seguido que el login del
// dueño (uso normal del día a día) — límite más generoso pero igual
// presente, para que no sea trivial de adivinar por fuerza bruta.
const pinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.' },
});

app.use(express.json());
app.use(
  session({
    secret: process.env.TIENDA_SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: 'auto',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
  })
);

function requireAdmin(req, res, next) {
  if (!req.session.adminUsername) return res.status(401).json({ error: 'No autenticado' });
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => handler(req, res, next).catch(next);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) {
      return cb(Object.assign(new Error('Solo se aceptan imágenes JPG, PNG o WEBP'), { status: 400 }));
    }
    cb(null, true);
  },
});

// Sube una foto de producto a Supabase Storage (bucket "uploads", mismo
// patrón que VENTA-WEB) y devuelve la URL pública.
async function sbUploadImage(buffer, mimetype, originalName, prefix = '') {
  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase();
  const filename = `${prefix}${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const { error } = await supabase.storage.from('uploads').upload(filename, buffer, {
    contentType: mimetype,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from('uploads').getPublicUrl(filename);
  return data.publicUrl;
}

// Verifica el PIN de una persona contra la base. 401 si no coincide.
async function requirePersonaPin(req, res, next) {
  try {
    const personaId = Number(req.body.persona_id || req.params.personaId);
    const pin = lib.sanitizePin(req.body.pin);
    if (!personaId || !lib.isValidPin(pin)) {
      return res.status(400).json({ error: 'Falta persona o PIN inválido' });
    }
    const persona = await sbGetPersona(personaId);
    if (!persona || !persona.activo || !lib.verifySecret(pin, persona.pin_hash)) {
      return res.status(401).json({ error: 'PIN incorrecto' });
    }
    req.persona = persona;
    next();
  } catch (err) {
    next(err);
  }
}

app.get('/health', (req, res) => res.json({ ok: true }));

// ── Rutas públicas (autoservicio, sin login) ────────────────────────────

app.get(
  '/api/negocio',
  asyncRoute(async (req, res) => {
    const config = await sbGetConfig();
    res.json({ name: config.name, currency: config.currency });
  })
);

app.get(
  '/api/personas',
  asyncRoute(async (req, res) => {
    res.json(await sbListPersonas({ activeOnly: true }));
  })
);

app.get(
  '/api/productos',
  asyncRoute(async (req, res) => {
    res.json(await sbListProductos({ activeOnly: true }));
  })
);

// Registro tipo carrito: se manda de una sola vez todo lo elegido (varios
// productos con su cantidad) y queda anotado completo en un solo paso —
// nunca depender de que alguien recuerde apretar "Anotar" producto por
// producto.
app.post(
  '/api/consumos',
  pinLimiter,
  requirePersonaPin,
  asyncRoute(async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0) return res.status(400).json({ error: 'No hay productos para anotar' });

    const productos = await sbListProductos({ activeOnly: true });
    const porAnotar = [];
    for (const item of items) {
      const productoId = Number(item.producto_id);
      const cantidad = Number(item.cantidad);
      if (!productoId || !(cantidad > 0)) return res.status(400).json({ error: 'Producto o cantidad inválidos' });
      const producto = productos.find((p) => p.id === productoId);
      if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
      if (Number(producto.stock) < cantidad) {
        return res.status(400).json({ error: `No hay suficiente stock de "${producto.nombre}"` });
      }
      porAnotar.push({ productoId, cantidad, precioUnitario: producto.precio });
    }

    const consumos = [];
    for (const item of porAnotar) {
      consumos.push(await sbCreateConsumo({ personaId: req.persona.id, ...item }));
    }
    res.json(consumos);
  })
);

app.post(
  '/api/personas/:personaId/deudas',
  pinLimiter,
  requirePersonaPin,
  asyncRoute(async (req, res) => {
    res.json(await sbDeudasPersona(req.persona.id));
  })
);

app.post(
  '/api/personas/:personaId/comprobante',
  pinLimiter,
  upload.single('file'),
  requirePersonaPin,
  asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Falta la foto del comprobante' });
    const cierreId = Number(req.body.cierre_id);
    const deudas = await sbDeudasPersona(req.persona.id);
    if (!deudas.some((d) => d.cierre_id === cierreId)) {
      return res.status(400).json({ error: 'Esa quincena no tiene pago pendiente' });
    }
    const url = await sbUploadImage(req.file.buffer, req.file.mimetype, req.file.originalname, 'comprobantes/');
    await sbRegistrarComprobante(cierreId, req.persona.id, url);
    res.json({ ok: true });
  })
);

app.post(
  '/api/personas/:personaId/consumos',
  pinLimiter,
  requirePersonaPin,
  asyncRoute(async (req, res) => {
    res.json(await sbListConsumosByPersona(req.persona.id));
  })
);

const ANULACION_LIMITE_MS = 15 * 60 * 1000;

app.post(
  '/api/consumos/:id/anular',
  pinLimiter,
  asyncRoute(async (req, res) => {
    const consumoId = Number(req.params.id);
    const pin = lib.sanitizePin(req.body.pin);
    const tipo = String(req.body.tipo || '');
    if (!MOTIVOS_ANULACION[tipo]) return res.status(400).json({ error: 'Motivo de anulación inválido' });
    if (!lib.isValidPin(pin)) return res.status(400).json({ error: 'PIN inválido' });

    const consumo = await sbGetConsumo(consumoId);
    if (!consumo) return res.status(404).json({ error: 'No encontrado' });
    if (consumo.anulado) return res.status(400).json({ error: 'Ya estaba anulado' });
    if (Date.now() - new Date(consumo.created_at).getTime() > ANULACION_LIMITE_MS) {
      return res.status(400).json({ error: 'Ya pasaron más de 15 minutos — no se puede anular.' });
    }

    const persona = await sbGetPersona(consumo.persona_id);
    if (!persona || !lib.verifySecret(pin, persona.pin_hash)) {
      return res.status(401).json({ error: 'PIN incorrecto' });
    }

    res.json(await sbAnularConsumo(consumoId, tipo));
  })
);

// ── Autenticación del dueño ──────────────────────────────────────────────

app.get(
  '/api/admin/needs-setup',
  asyncRoute(async (req, res) => {
    res.json({ needsSetup: (await sbCountAdmins()) === 0 });
  })
);

app.post(
  '/api/admin/setup-first-admin',
  authLimiter,
  asyncRoute(async (req, res) => {
    if ((await sbCountAdmins()) > 0) {
      return res.status(403).json({ error: 'Ya existe un administrador.' });
    }
    const username = lib.sanitizeUsername(req.body.username);
    const password = String(req.body.password || '');
    if (!username || password.length < 8) {
      return res.status(400).json({ error: 'Usuario inválido o contraseña muy corta (mínimo 8 caracteres).' });
    }
    await sbCreateAdmin(username, lib.hashSecret(password), req.body.display_name || null);
    req.session.adminUsername = username;
    res.json({ ok: true, username });
  })
);

app.post(
  '/api/admin/login',
  authLimiter,
  asyncRoute(async (req, res) => {
    const username = lib.sanitizeUsername(req.body.username);
    const password = String(req.body.password || '');
    const admin = await sbFindAdminByUsername(username);
    if (!admin || !lib.verifySecret(password, admin.password_hash)) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    req.session.adminUsername = username;
    res.json({ ok: true, username });
  })
);

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/me', (req, res) => {
  res.json({ username: req.session.adminUsername || null });
});

// ── Panel del dueño ───────────────────────────────────────────────────────

app.get(
  '/api/admin/personas',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await sbListPersonas());
  })
);

app.post(
  '/api/admin/personas',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const nombre = String(req.body.nombre || '').trim();
    const pin = lib.sanitizePin(req.body.pin);
    if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
    if (!lib.isValidPin(pin)) return res.status(400).json({ error: 'El PIN debe tener 3 dígitos' });
    res.json(await sbCreatePersona(nombre, pin));
  })
);

app.post(
  '/api/admin/personas/:id/vaciar',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!id || !(await sbGetPersona(id))) return res.status(404).json({ error: 'Persona no encontrada' });
    res.json({ ok: true, eliminados: await sbVaciarConsumosPersona(id) });
  })
);

app.put(
  '/api/admin/personas/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!id || !(await sbGetPersona(id))) return res.status(404).json({ error: 'Persona no encontrada' });
    const fields = {};
    if (req.body.nombre !== undefined) {
      const nombre = String(req.body.nombre).trim();
      if (!nombre) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
      fields.nombre = nombre;
    }
    if (req.body.pin !== undefined && req.body.pin !== '') {
      const pin = lib.sanitizePin(req.body.pin);
      if (!lib.isValidPin(pin)) return res.status(400).json({ error: 'El PIN debe tener 3 dígitos' });
      fields.pin_hash = lib.hashSecret(pin);
    }
    if (req.body.activo !== undefined) fields.activo = Boolean(req.body.activo);
    res.json(await sbUpdatePersona(id, fields));
  })
);

app.get(
  '/api/admin/productos',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await sbListProductos());
  })
);

app.post(
  '/api/admin/productos',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const nombre = String(req.body.nombre || '').trim();
    const precio = Number(req.body.precio);
    if (!nombre || !(precio >= 0)) return res.status(400).json({ error: 'Nombre o precio inválidos' });
    res.json(
      await sbCreateProducto({
        nombre,
        precio,
        stock: Number(req.body.stock) || 0,
        unidad: req.body.unidad || 'unidad',
        foto_url: req.body.foto_url || null,
      })
    );
  })
);

app.put(
  '/api/admin/productos/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const fields = {};
    if (req.body.nombre !== undefined) fields.nombre = String(req.body.nombre).trim();
    if (req.body.precio !== undefined) fields.precio = Number(req.body.precio);
    if (req.body.stock !== undefined) fields.stock = Number(req.body.stock);
    if (req.body.foto_url !== undefined) fields.foto_url = req.body.foto_url || null;
    if (req.body.activo !== undefined) fields.activo = Boolean(req.body.activo);
    res.json(await sbUpdateProducto(Number(req.params.id), fields));
  })
);

app.delete(
  '/api/admin/productos/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await sbDeleteProducto(Number(req.params.id));
    res.json({ ok: true });
  })
);

// ── Cierre de quincena ─────────────────────────────────────────────────
// Quincena estándar: 1-15 y 16-fin de mes, hora Colombia (UTC-5).
function validarQuincena(inicio, fin) {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inicio || '');
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fin || '');
  if (!m1 || !m2) return false;
  const [y, m, d1] = [Number(m1[1]), Number(m1[2]), Number(m1[3])];
  if (m2[1] !== m1[1] || m2[2] !== m1[2]) return false;
  const d2 = Number(m2[3]);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return (d1 === 1 && d2 === 15) || (d1 === 16 && d2 === ultimo);
}

// Día de pago de una quincena: la 1-15 se paga el 20 del mismo mes; la 16-fin, el 5 del mes siguiente.
function fechaPagoQuincena(inicio) {
  const [y, m, d] = inicio.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  if (d === 1) return `${y}-${pad(m)}-20`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${pad(nm)}-05`;
}

function hoyColombia() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

async function sbListCierres() {
  const { data, error } = await supabase.from('tf_cierres').select('*').order('periodo_inicio', { ascending: false });
  if (error) throw error;
  return data;
}

async function sbCerrarQuincena(inicio, fin) {
  const { data: previo, error: e0 } = await supabase
    .from('tf_cierres').select('id').eq('periodo_inicio', inicio).eq('periodo_fin', fin).maybeSingle();
  if (e0) throw e0;
  if (previo) return { error: 'Esa quincena ya está cerrada', status: 409 };
  const { data, error } = await supabase
    .from('tf_consumos')
    .select('persona_id, cantidad, precio_unitario, anulado, tf_personas(nombre)')
    .gte('created_at', `${inicio}T00:00:00-05:00`)
    .lte('created_at', `${fin}T23:59:59.999-05:00`);
  if (error) throw error;
  const detalle = lib
    .buildReporteQuincena(
      data.map((c) => ({
        persona_id: c.persona_id,
        persona_nombre: c.tf_personas ? c.tf_personas.nombre : '(desconocido)',
        cantidad: c.cantidad,
        precio_unitario: c.precio_unitario,
        anulado: c.anulado,
      }))
    )
    .map((r) => ({ ...r, pagado: false, pagado_at: null }));
  const total = detalle.reduce((s, r) => s + r.total, 0);
  const { data: row, error: e2 } = await supabase
    .from('tf_cierres')
    .insert({ periodo_inicio: inicio, periodo_fin: fin, total, detalle })
    .select()
    .single();
  if (e2) {
    if (e2.code === '23505') return { error: 'Esa quincena ya está cerrada', status: 409 };
    throw e2;
  }
  return { row };
}

// Desprendible por persona: consumo agrupado quincena a quincena (hora Colombia),
// con el detalle de cada línea y, si la quincena está cerrada, su estado de pago.
async function sbDesprendiblesPersona(personaId) {
  const [{ data: consumos, error }, cierres] = await Promise.all([
    supabase
      .from('tf_consumos')
      .select('id, cantidad, precio_unitario, anulado, motivo_anulacion, created_at, tf_productos(nombre)')
      .eq('persona_id', personaId)
      .order('created_at', { ascending: false }),
    sbListCierres(),
  ]);
  if (error) throw error;
  const pad = (n) => String(n).padStart(2, '0');
  const grupos = new Map();
  for (const c of consumos) {
    const d = new Date(new Date(c.created_at).getTime() - 5 * 3600 * 1000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const primera = d.getUTCDate() <= 15;
    const inicio = `${y}-${pad(m)}-${primera ? '01' : '16'}`;
    const fin = `${y}-${pad(m)}-${primera ? '15' : pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
    const key = inicio;
    if (!grupos.has(key)) grupos.set(key, { inicio, fin, total: 0, items: 0, anulados: 0, lineas: [] });
    const g = grupos.get(key);
    const subtotal = (Number(c.precio_unitario) || 0) * (Number(c.cantidad) || 0);
    if (c.anulado) g.anulados += 1;
    else {
      g.total += subtotal;
      g.items += Number(c.cantidad) || 0;
    }
    g.lineas.push({
      fecha: c.created_at,
      producto: c.tf_productos ? c.tf_productos.nombre : '(producto)',
      cantidad: c.cantidad,
      precio_unitario: c.precio_unitario,
      subtotal,
      anulado: c.anulado,
      motivo_anulacion: c.motivo_anulacion,
    });
  }
  const hoy = hoyColombia();
  return Array.from(grupos.values())
    .sort((a, b) => (a.inicio < b.inicio ? 1 : -1))
    .map((g) => {
      const cierre = cierres.find((x) => x.periodo_inicio === g.inicio && x.periodo_fin === g.fin);
      const det = cierre ? cierre.detalle.find((r) => r.persona_id === personaId) : null;
      return {
        ...g,
        estado: cierre ? 'cerrada' : g.fin >= hoy ? 'en_curso' : 'sin_cerrar',
        cierre_id: cierre ? cierre.id : null,
        total_cierre: det ? det.total : null,
        pagado: det ? Boolean(det.pagado) : null,
        comprobante_url: det ? det.comprobante_url || null : null,
      };
    });
}

// Pagos pendientes de una persona: quincenas cerradas con deuda sin pagar
// cuyo día de pago (20 o 5) ya llegó. Antes de ese día no se le pide nada.
async function sbDeudasPersona(personaId) {
  const cierres = await sbListCierres();
  const hoy = hoyColombia();
  const out = [];
  for (const c of cierres) {
    const r = c.detalle.find((x) => x.persona_id === personaId);
    const fechaPago = fechaPagoQuincena(c.periodo_inicio);
    if (r && !r.pagado && Number(r.total) > 0 && hoy >= fechaPago) {
      out.push({ cierre_id: c.id, inicio: c.periodo_inicio, fin: c.periodo_fin, total: r.total, fecha_pago: fechaPago });
    }
  }
  return out;
}

// Subir el comprobante deja la quincena como pagada (el dueño puede revertirlo
// desde el admin si el comprobante no es válido).
async function sbRegistrarComprobante(cierreId, personaId, url) {
  const { data: cierre, error } = await supabase.from('tf_cierres').select('*').eq('id', cierreId).maybeSingle();
  if (error) throw error;
  if (!cierre) return null;
  const now = new Date().toISOString();
  const detalle = cierre.detalle.map((r) =>
    r.persona_id === personaId ? { ...r, pagado: true, pagado_at: now, comprobante_url: url, comprobante_at: now } : r
  );
  const { error: e2 } = await supabase.from('tf_cierres').update({ detalle }).eq('id', cierreId);
  if (e2) throw e2;
  return true;
}

async function sbMarcarPagoCierre(id, personaId, pagado) {
  const { data: cierre, error } = await supabase.from('tf_cierres').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!cierre) return null;
  const detalle = cierre.detalle.map((r) =>
    r.persona_id !== personaId
      ? r
      : pagado
        ? { ...r, pagado: true, pagado_at: new Date().toISOString() }
        : { ...r, pagado: false, pagado_at: null, comprobante_url: null, comprobante_at: null }
  );
  const { data: row, error: e2 } = await supabase.from('tf_cierres').update({ detalle }).eq('id', id).select().single();
  if (e2) throw e2;
  return row;
}

app.get(
  '/api/admin/cierres',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await sbListCierres());
  })
);

app.post(
  '/api/admin/cierres',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { inicio, fin } = req.body || {};
    if (!validarQuincena(inicio, fin)) return res.status(400).json({ error: 'Quincena inválida (1-15 o 16-fin de mes)' });
    if (fin >= hoyColombia()) return res.status(400).json({ error: 'La quincena todavía no termina' });
    const r = await sbCerrarQuincena(inicio, fin);
    if (r.error) return res.status(r.status).json({ error: r.error });
    res.json(r.row);
  })
);

app.get(
  '/api/admin/personas/:id/desprendibles',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await sbDesprendiblesPersona(Number(req.params.id)));
  })
);

app.put(
  '/api/admin/cierres/:id/pago',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const row = await sbMarcarPagoCierre(Number(req.params.id), Number(req.body.persona_id), Boolean(req.body.pagado));
    if (!row) return res.status(404).json({ error: 'Cierre no encontrado' });
    res.json(row);
  })
);

app.get(
  '/api/admin/negocio',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await sbGetConfig());
  })
);

app.put(
  '/api/admin/negocio',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const fields = {};
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
      fields.name = name;
    }
    if (req.body.currency !== undefined) fields.currency = String(req.body.currency).trim().toUpperCase() || 'COP';
    res.json(await sbUpdateConfig(fields));
  })
);

// El dueño puede anular un consumo sin PIN y sin el límite de 15 minutos
// que tiene la persona — para corregir un error que se nota después. El
// motivo sigue siendo uno de los dos fijos (mismo manejo de stock que la
// anulación normal).
app.post(
  '/api/admin/consumos/:id/anular',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const consumoId = Number(req.params.id);
    const tipo = String(req.body.tipo || '');
    if (!MOTIVOS_ANULACION[tipo]) return res.status(400).json({ error: 'Motivo de anulación inválido' });

    const consumo = await sbGetConsumo(consumoId);
    if (!consumo) return res.status(404).json({ error: 'No encontrado' });
    if (consumo.anulado) return res.status(400).json({ error: 'Ya estaba anulado' });

    res.json(await sbAnularConsumo(consumoId, tipo));
  })
);

app.get(
  '/api/admin/personas/:id/consumos',
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json(await sbListConsumosByPersona(Number(req.params.id)));
  })
);

app.post(
  '/api/admin/upload',
  requireAdmin,
  upload.single('file'),
  asyncRoute(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
    const url = await sbUploadImage(req.file.buffer, req.file.mimetype, req.file.originalname);
    res.json({ url });
  })
);

// ── Errores ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  void next;
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Archivo demasiado grande (máx 8MB)' });
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Error interno' : err.message });
});

// Lo llama el servidor de TKS una vez al arrancar (crea las personas iniciales si hace falta).
function init() {
  console.log('Tienda cargada (se atiende por ' + (process.env.TIENDA_HOST || '?') + ')');
  ensurePersonasIniciales().catch((err) => console.error('No se pudieron crear las personas iniciales:', err));
}

module.exports = { app, init };
