'use strict';

// Funciones puras (sin fetch, sin Supabase) — mismo patrón que
// venta-webs-lib.js en VENTA-WEB. server.js requiere este módulo.

const crypto = require('crypto');

function sanitizeUsername(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
}

// scrypt nativo de Node (sin dependencia externa). Formato: "salt_hex:hash_hex".
// Se usa tanto para la contraseña del dueño como para el PIN de cada persona.
function hashSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 1) {
    throw new Error('secreto vacío');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifySecret(secret, stored) {
  if (typeof secret !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hashHex] = parts;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(secret, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function sanitizePin(raw) {
  const digits = String(raw ?? '').replace(/[^0-9]/g, '');
  return digits.slice(0, 4);
}

function isValidPin(raw) {
  return /^\d{3,4}$/.test(String(raw ?? ''));
}

// Reporte de quincena: agrupa consumos (ya filtrados por fecha) por persona,
// separando lo vigente de lo anulado. `consumos`: [{ persona_id, persona_nombre,
// cantidad, precio_unitario, anulado }]
function buildReporteQuincena(consumos) {
  const porPersona = new Map();
  for (const c of consumos || []) {
    if (!porPersona.has(c.persona_id)) {
      porPersona.set(c.persona_id, {
        persona_id: c.persona_id,
        persona_nombre: c.persona_nombre,
        total: 0,
        items: 0,
        anulados: 0,
      });
    }
    const entry = porPersona.get(c.persona_id);
    const lineTotal = (Number(c.precio_unitario) || 0) * (Number(c.cantidad) || 0);
    if (c.anulado) {
      entry.anulados += 1;
    } else {
      entry.total += lineTotal;
      entry.items += Number(c.cantidad) || 0;
    }
  }
  return Array.from(porPersona.values()).sort((a, b) => b.total - a.total);
}

module.exports = {
  sanitizeUsername,
  hashSecret,
  verifySecret,
  sanitizePin,
  isValidPin,
  buildReporteQuincena,
};
