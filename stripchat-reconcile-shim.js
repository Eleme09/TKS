// Compatibilidad temporal para la reconciliacion historica de Stripchat.
// server.js usa studioWallToMs en esa ruta; este preload expone el helper puro
// de chaturbate-lib mientras se mantiene el cambio pequeno y seguro.
const { studioWallToMs } = require('./chaturbate-lib');

if (typeof studioWallToMs === 'function') {
  global.studioWallToMs = studioWallToMs;
  console.log('Stripchat reconcile shim activo: studioWallToMs disponible.');
}
