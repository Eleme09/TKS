// Tests de las funciones puras de calculo de dinero y fechas. No tocan
// Supabase ni Chaturbate — corren offline. `npm test` (node --test).
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const lib = require('./chaturbate-lib');

describe('getQuincena', () => {
  test('día 1 del mes cae en la quincena 1-15, se paga el 20', () => {
    const p = lib.getQuincena(new Date(2026, 8, 1).getTime()); // 1 sept 2026
    assert.equal(new Date(p.start).getDate(), 1);
    assert.equal(new Date(p.end).getDate(), 15);
    assert.equal(new Date(p.payout).getDate(), 20);
    assert.equal(new Date(p.payout).getMonth(), 8); // mismo mes (septiembre)
  });

  test('día 15 todavía cae en la quincena 1-15 (límite inclusivo)', () => {
    const p = lib.getQuincena(new Date(2026, 8, 15, 23, 59).getTime());
    assert.equal(new Date(p.start).getDate(), 1);
    assert.equal(new Date(p.end).getDate(), 15);
  });

  test('día 16 cae en la quincena 16-fin de mes, se paga el 5 del mes siguiente', () => {
    const p = lib.getQuincena(new Date(2026, 8, 16).getTime());
    assert.equal(new Date(p.start).getDate(), 16);
    assert.equal(new Date(p.payout).getDate(), 5);
    assert.equal(new Date(p.payout).getMonth(), 9); // octubre
  });

  test('la quincena 16-fin llega hasta el último día real del mes (febrero, 28 días)', () => {
    const p = lib.getQuincena(new Date(2026, 1, 20).getTime()); // feb 2026 (no bisiesto)
    assert.equal(new Date(p.end).getDate(), 28);
  });

  test('diciembre 16-31 paga en enero del año siguiente', () => {
    const p = lib.getQuincena(new Date(2026, 11, 20).getTime());
    assert.equal(new Date(p.payout).getFullYear(), 2027);
    assert.equal(new Date(p.payout).getMonth(), 0);
  });
});

describe('getQuincenaHistory', () => {
  test('devuelve `count` quincenas consecutivas, la actual primero, sin huecos ni superposiciones', () => {
    const periods = lib.getQuincenaHistory(6, new Date(2026, 8, 3).getTime());
    assert.equal(periods.length, 6);
    for (let i = 0; i < periods.length - 1; i++) {
      // la quincena siguiente (mas vieja) debe terminar justo antes de que
      // empiece la actual, sin dias sueltos entre medio
      assert.equal(periods[i + 1].end, periods[i].start - 1);
    }
  });
});

describe('toDateStr', () => {
  test('formatea YYYY-MM-DD con ceros a la izquierda', () => {
    assert.equal(lib.toDateStr(new Date(2026, 0, 5).getTime()), '2026-01-05');
    assert.equal(lib.toDateStr(new Date(2026, 8, 15).getTime()), '2026-09-15');
  });
});

describe('sanitizeUsername', () => {
  test('acepta letras, números, guion y guion bajo, y lo pasa a minúsculas', () => {
    assert.equal(lib.sanitizeUsername('Pinky_F00x'), 'pinky_f00x');
    assert.equal(lib.sanitizeUsername('  abigail-1  '), 'abigail-1');
  });
  test('rechaza espacios internos, símbolos, vacío y no-strings', () => {
    assert.equal(lib.sanitizeUsername('nombre con espacio'), null);
    assert.equal(lib.sanitizeUsername('nombre@raro'), null);
    assert.equal(lib.sanitizeUsername(''), null);
    assert.equal(lib.sanitizeUsername(null), null);
    assert.equal(lib.sanitizeUsername(undefined), null);
  });
});

describe('hashPassword / verifyPassword', () => {
  test('una contraseña correcta verifica true, una incorrecta false', () => {
    const hash = lib.hashPassword('mi-clave-segura');
    assert.equal(lib.verifyPassword('mi-clave-segura', hash), true);
    assert.equal(lib.verifyPassword('otra-clave', hash), false);
  });
  test('dos hashes de la misma contraseña son distintos (salt aleatorio) pero ambos verifican', () => {
    const h1 = lib.hashPassword('igual');
    const h2 = lib.hashPassword('igual');
    assert.notEqual(h1, h2);
    assert.equal(lib.verifyPassword('igual', h1), true);
    assert.equal(lib.verifyPassword('igual', h2), true);
  });
  test('verifyPassword no truena con datos corruptos o vacíos', () => {
    assert.equal(lib.verifyPassword('x', ''), false);
    assert.equal(lib.verifyPassword('x', 'sin-dos-puntos'), false);
    assert.equal(lib.verifyPassword('x', null), false);
  });
});

describe('parseCsvLine', () => {
  test('separa campos simples por coma', () => {
    assert.deepEqual(lib.parseCsvLine('a,b,c'), ['a', 'b', 'c']);
  });
  test('respeta comas dentro de comillas (ej. el campo Note del CSV real)', () => {
    assert.deepEqual(
      lib.parseCsvLine('"2026-09-02 21:30:17",-289,0,"Tokens cashed out","","nota, con coma"'),
      ['2026-09-02 21:30:17', '-289', '0', 'Tokens cashed out', '', 'nota, con coma']
    );
  });
  test('maneja comillas escapadas ("" dentro de un campo entre comillas)', () => {
    assert.deepEqual(lib.parseCsvLine('"dijo ""hola"""'), ['dijo "hola"']);
  });
});

describe('parseChaturbateTransactionsCsv', () => {
  const sampleCsv = [
    '"Timestamp","Token change","Token balance","Transaction type","User","Note"',
    '"2026-09-02 21:30:17.835922",-289,0,"Tokens cashed out","",""',
    '"2026-09-02 20:15:09.674191",1,289,"Private show","kxbsnflf",""',
    '"2026-09-01 02:51:35.994054",11,278,"Tip received","someone",""',
  ].join('\n');

  test('parsea filas reales del formato de Chaturbate a {dateStr, change}', () => {
    const rows = lib.parseChaturbateTransactionsCsv(sampleCsv);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], { dateStr: '2026-09-02', change: -289 });
    assert.deepEqual(rows[1], { dateStr: '2026-09-02', change: 1 });
    assert.deepEqual(rows[2], { dateStr: '2026-09-01', change: 11 });
  });

  test('devuelve null si al archivo le faltan las columnas esperadas (formato irreconocible)', () => {
    assert.equal(lib.parseChaturbateTransactionsCsv('"Foo","Bar"\n"1","2"'), null);
  });

  test('devuelve null para un archivo vacío', () => {
    assert.equal(lib.parseChaturbateTransactionsCsv(''), null);
    assert.equal(lib.parseChaturbateTransactionsCsv(null), null);
  });
});

describe('sumChaturbateCsvEarningsForPeriod', () => {
  const rows = [
    { dateStr: '2026-08-31', change: 50 },   // fuera del rango (quincena anterior)
    { dateStr: '2026-09-01', change: 100 },  // dentro, límite inicial inclusivo
    { dateStr: '2026-09-10', change: 20 },
    { dateStr: '2026-09-15', change: 30 },   // dentro, límite final inclusivo
    { dateStr: '2026-09-16', change: 999 },  // fuera (quincena siguiente)
    { dateStr: '2026-09-05', change: -80 },  // retiro (negativo): nunca se resta
  ];

  test('suma solo cambios positivos dentro del rango de fechas, ambos límites inclusivos', () => {
    assert.equal(lib.sumChaturbateCsvEarningsForPeriod(rows, '2026-09-01', '2026-09-15'), 150);
  });

  test('un retiro (Token change negativo) nunca se resta del total', () => {
    // si restara, el resultado bajaria a 70 (150 - 80) en vez de mantenerse en 150
    assert.equal(lib.sumChaturbateCsvEarningsForPeriod(rows, '2026-09-01', '2026-09-15'), 150);
  });

  test('un rango sin filas da 0, no error', () => {
    assert.equal(lib.sumChaturbateCsvEarningsForPeriod(rows, '2026-01-01', '2026-01-31'), 0);
  });
});

describe('isNearChaturbateCashout (ventana pre-retiro, 04:18-04:30 UTC)', () => {
  const at = (iso) => new Date(iso).getTime();
  test('12 minutos antes del corte: true (límite inicial de la ventana)', () => {
    assert.equal(lib.isNearChaturbateCashout(at('2026-09-03T04:18:00Z')), true);
  });
  test('13 minutos antes del corte: false (justo fuera de la ventana)', () => {
    assert.equal(lib.isNearChaturbateCashout(at('2026-09-03T04:17:00Z')), false);
  });
  test('en el minuto exacto del corte: true', () => {
    assert.equal(lib.isNearChaturbateCashout(at('2026-09-03T04:30:00Z')), true);
  });
  test('un minuto después del corte: false (ya no hay nada que rescatar)', () => {
    assert.equal(lib.isNearChaturbateCashout(at('2026-09-03T04:31:00Z')), false);
  });
  test('mediodía, lejos de la ventana: false', () => {
    assert.equal(lib.isNearChaturbateCashout(at('2026-09-03T12:00:00Z')), false);
  });
  // Regresion de la falsa alarma del 2026-09-04: se movio la ventana a
  // 04:15-04:45 creyendo que el corte era ~04:40, cuando en realidad la Stats
  // API estuvo devolviendo 403 entre 04:23 y 04:40 y el detected_at tardio era
  // solo el momento en que volvio a responder. La ventana correcta sigue
  // siendo la del CSV (21:30 US-Pacific = 04:30 UTC).
  test('04:40 NO está en la ventana (el 403 no probó que el corte fuera ahí)', () => {
    assert.equal(lib.isNearChaturbateCashout(at('2026-09-03T04:40:00Z')), false);
  });
});

describe('resolveChaturbateTokens — reconciliación de las 3 fuentes (sin duplicar, sin perder plata)', () => {
  test('sin base, sin ticks: usa tips + corrección manual', () => {
    const total = lib.resolveChaturbateTokens({ base: null, ticks: [], tips: [{ tokens: 40 }, { tokens: 31 }], extraTokens: 218 });
    assert.equal(total, 40 + 31 + 218);
  });

  test('sin base, con ticks de balance: usa el mayor entre ticks y (tips + extra), no los suma los dos', () => {
    const ticks = [{ tokens: 200 }];
    const tips = [{ tokens: 40 }, { tokens: 31 }]; // 71, menor que los 200 de balance
    const total = lib.resolveChaturbateTokens({ base: null, ticks, tips, extraTokens: 0 });
    assert.equal(total, 200); // no 271 — el balance ya incluye las propinas
  });

  test('con base (CSV congelado): suma base + lo posterior al corte (covers_until)', () => {
    const base = { base_tokens: 289, covers_until: '2026-09-03T14:44:32.869Z' };
    const ticks = [
      { tokens: 5, sampled_at: '2026-09-03T14:00:00.000Z' },  // antes del corte: ya está en la base, no se cuenta de nuevo
      { tokens: 15, sampled_at: '2026-09-03T14:50:00.000Z' }, // despues del corte: se suma
    ];
    const total = lib.resolveChaturbateTokens({ base, ticks, tips: [], extraTokens: 0 });
    assert.equal(total, 289 + 15);
  });

  test('BUG REAL arreglado en la revisión de código (2026-09-03): con base pero SIN balance activado, sigue sumando las propinas nuevas en vez de congelarse para siempre', () => {
    // Escenario exacto que causaba el bug: una modelo sube su CSV (queda una
    // fila en cb_chaturbate_period_base) pero nunca se le activa el
    // stats_api_token — cb_balance_ticks para ella queda vacío por completo,
    // mientras que la conexión en vivo (Events API) sigue sumando cb_tips.
    // Antes del fix, resolveChaturbateTokens solo miraba `ticks` y el total
    // quedaba pegado en 289 para siempre. Ahora debe seguir subiendo.
    const base = { base_tokens: 289, covers_until: '2026-09-03T14:44:32.869Z' };
    const ticks = []; // nunca se activó el balance en vivo para esta modelo
    const tips = [
      { tokens: 10, created_at: '2026-09-03T15:00:00.000Z' }, // despues del corte
      { tokens: 7, created_at: '2026-09-03T16:00:00.000Z' },  // despues del corte
    ];
    const total = lib.resolveChaturbateTokens({ base, ticks, tips, extraTokens: 0 });
    assert.equal(total, 289 + 17, 'no debe quedar congelado en 289 solo porque no hay ticks de balance');
  });

  test('con base: activar el balance en vivo nunca puede hacer bajar el total ya conocido por tips', () => {
    // simetrico al bug de arriba: si HAY ticks pero son menos que lo que las
    // propinas ya venian sumando desde el corte, no hay que preferir el
    // numero mas chico.
    const base = { base_tokens: 100, covers_until: '2026-09-03T00:00:00.000Z' };
    const ticks = [{ tokens: 3, sampled_at: '2026-09-03T01:00:00.000Z' }]; // recien activado, casi nada capturado todavia
    const tips = [{ tokens: 50, created_at: '2026-09-03T01:00:00.000Z' }]; // la conexion en vivo ya venia contando mucho mas
    const total = lib.resolveChaturbateTokens({ base, ticks, tips, extraTokens: 0 });
    assert.equal(total, 100 + 50);
  });

  test('verificado contra números reales: pinky_f00x, base=289 + tick real de +15 después del corte = 304', () => {
    const base = { base_tokens: 289, covers_until: '2026-09-03 14:44:32.869+00' };
    const ticks = [{ tokens: 15, sampled_at: '2026-09-03 14:50:00+00' }];
    assert.equal(lib.resolveChaturbateTokens({ base, ticks, tips: [], extraTokens: 0 }), 304);
  });
});

describe('asistencia — dia laboral en hora del estudio (Colombia, UTC-5 fijo)', () => {
  test('8 p.m. Colombia sigue siendo el mismo día laboral aunque en UTC ya sea el siguiente', () => {
    // 2026-09-05T01:00Z = 2026-09-04 20:00 en Colombia
    assert.equal(lib.studioDateStr(Date.parse('2026-09-05T01:00:00Z')), '2026-09-04');
  });
  test('2 a.m. Colombia (madrugada) todavía cuenta como la jornada del día anterior en UTC', () => {
    // 2026-09-05T07:00Z = 2026-09-05 02:00 en Colombia
    assert.equal(lib.studioDateStr(Date.parse('2026-09-05T07:00:00Z')), '2026-09-05');
  });
  test('studioTimeStr devuelve la hora de Colombia, no la del servidor', () => {
    assert.equal(lib.studioTimeStr(Date.parse('2026-09-04T21:00:00Z')), '16:00');
  });
  test('studioScheduledMs: 16:00 del estudio son las 21:00 UTC', () => {
    assert.equal(lib.studioScheduledMs('2026-09-04', '16:00'), Date.parse('2026-09-04T21:00:00Z'));
  });
  test('studioScheduledMs acepta "HH:MM:SS" (formato que devuelve Postgres para time)', () => {
    assert.equal(lib.studioScheduledMs('2026-09-04', '16:00:00'), Date.parse('2026-09-04T21:00:00Z'));
  });
  test('studioScheduledMs con basura devuelve null en vez de NaN', () => {
    assert.equal(lib.studioScheduledMs('', ''), null);
    assert.equal(lib.studioScheduledMs('2026-09-04', 'xx:yy'), null);
  });
});

describe('asistencia — cálculo de retraso y acumulado', () => {
  test('llegó 23 minutos tarde', () => {
    const scheduled = lib.studioScheduledMs('2026-09-04', '16:00');
    assert.equal(lib.computeLateMinutes(Date.parse('2026-09-04T21:23:00Z'), scheduled), 23);
  });
  test('llegó 10 minutos temprano: negativo', () => {
    const scheduled = lib.studioScheduledMs('2026-09-04', '16:00');
    assert.equal(lib.computeLateMinutes(Date.parse('2026-09-04T20:50:00Z'), scheduled), -10);
  });
  test('sin hora oficial todavía: null, no 0 (0 sería "llegó puntual", que es distinto)', () => {
    assert.equal(lib.computeLateMinutes(null, 123), null);
  });
  test('bug real 2026-09-10: llegar 47 segundos tarde NO cuenta como 1 minuto de retraso', () => {
    // conni_f00x, turno tarde, 2026-09-08: official_at 46.977s despues del
    // horario -> con Math.round quedaba guardado como 1 minuto de retraso.
    const scheduled = lib.studioScheduledMs('2026-09-08', '16:00');
    assert.equal(lib.computeLateMinutes(scheduled + 46977, scheduled), 0);
  });
  test('mismo bug, llegando temprano: 33 segundos antes NO cuenta como 1 minuto temprano', () => {
    // tamar4_f00x, turno mañana, 2026-09-08: official_at 33.141s antes del
    // horario -> con Math.round quedaba guardado como -1.
    const scheduled = lib.studioScheduledMs('2026-09-08', '07:30');
    assert.equal(lib.computeLateMinutes(scheduled - 33141, scheduled), 0);
  });
  test('pasado un minuto completo, sí cuenta (no se perdonan minutos enteros)', () => {
    const scheduled = lib.studioScheduledMs('2026-09-08', '16:00');
    assert.equal(lib.computeLateMinutes(scheduled + 62748, scheduled), 1);
  });
  test('el acumulado solo suma retrasos; llegar temprano no borra un retraso anterior', () => {
    const days = [
      { status: 'validada', late_minutes: 30 },
      { status: 'validada', late_minutes: -45 },
      { status: 'validada', late_minutes: 12 },
    ];
    assert.equal(lib.sumLateMinutes(days), 42);
  });
  test('un día pendiente o rechazado no suma al acumulado', () => {
    const days = [
      { status: 'pendiente', late_minutes: 60 },
      { status: 'rechazada', late_minutes: 90 },
      { status: 'validada', late_minutes: 15 },
    ];
    assert.equal(lib.sumLateMinutes(days), 15);
  });
});

describe('asistencia — quincena en fechas del estudio', () => {
  test('día 4 cae en la primera quincena del mes', () => {
    assert.deepEqual(lib.studioQuincenaRange('2026-09-04'), { start: '2026-09-01', end: '2026-09-15' });
  });
  test('día 15 sigue en la primera quincena (límite inclusivo)', () => {
    assert.deepEqual(lib.studioQuincenaRange('2026-09-15'), { start: '2026-09-01', end: '2026-09-15' });
  });
  test('día 16 abre la segunda quincena, que llega al último día real del mes', () => {
    assert.deepEqual(lib.studioQuincenaRange('2026-09-16'), { start: '2026-09-16', end: '2026-09-30' });
  });
  test('febrero no bisiesto termina el 28', () => {
    assert.deepEqual(lib.studioQuincenaRange('2026-02-20'), { start: '2026-02-16', end: '2026-02-28' });
  });
  test('febrero bisiesto termina el 29', () => {
    assert.deepEqual(lib.studioQuincenaRange('2028-02-20'), { start: '2028-02-16', end: '2028-02-29' });
  });
  test('enero: mes de un solo dígito queda con cero a la izquierda', () => {
    assert.deepEqual(lib.studioQuincenaRange('2026-01-03'), { start: '2026-01-01', end: '2026-01-15' });
  });
  test('fecha inválida devuelve null', () => {
    assert.equal(lib.studioQuincenaRange('basura'), null);
  });
});

describe('asistencia — a qué turno pertenece una llegada (pickWorkDate)', () => {
  const at = (iso) => Date.parse(iso);
  test('llegada normal al turno del día: se queda en ese día', () => {
    // 2026-09-04T20:10 Colombia = 2026-09-05T01:10Z, turno 20:00
    assert.equal(lib.pickWorkDate(at('2026-09-05T01:10:00Z'), '20:00', []), '2026-09-04');
  });
  test('llegada pasada la medianoche cuenta contra el turno de anoche, no contra el de mañana', () => {
    // 2026-09-05T00:30 Colombia = 2026-09-05T05:30Z. El turno de las 20:00 más
    // cercano es el del 4, al que llegó 4h30 tarde — no el del 5, que sería
    // 19h30 "temprano".
    assert.equal(lib.pickWorkDate(at('2026-09-05T05:30:00Z'), '20:00', []), '2026-09-04');
  });
  test('si anoche ya había fichado, la llegada va al día de hoy y no pisa el registro anterior', () => {
    assert.equal(lib.pickWorkDate(at('2026-09-05T05:30:00Z'), '20:00', ['2026-09-04']), '2026-09-05');
  });
  test('llegar temprano al turno de hoy no se confunde con el de ayer', () => {
    // 2026-09-04T15:50 Colombia = 2026-09-04T20:50Z, turno 16:00
    assert.equal(lib.pickWorkDate(at('2026-09-04T20:50:00Z'), '16:00', []), '2026-09-04');
  });
  test('sin horario asignado es simplemente el día del estudio', () => {
    assert.equal(lib.pickWorkDate(at('2026-09-05T05:30:00Z'), null, []), '2026-09-05');
  });
});

describe('asistencia — deuda por retraso (se cobra por hora alcanzada)', () => {
  test('menos de una hora acumulada no debe nada', () => {
    assert.equal(lib.lateDebtHours(59), 0);
    assert.equal(lib.lateDebtCop(59, 10000), 0);
  });
  test('la hora exacta ya cuenta como hora alcanzada', () => {
    assert.equal(lib.lateDebtHours(60), 1);
    assert.equal(lib.lateDebtCop(60, 10000), 10000);
  });
  test('no es proporcional: 119 minutos siguen siendo una sola hora', () => {
    assert.equal(lib.lateDebtHours(119), 1);
    assert.equal(lib.lateDebtCop(119, 10000), 10000);
  });
  test('6 horas justas: 6 horas de deuda', () => {
    assert.equal(lib.lateDebtCop(360, 10000), 60000);
  });
  test('retraso negativo (llegó temprano) o cero no genera deuda', () => {
    assert.equal(lib.lateDebtCop(-200, 10000), 0);
    assert.equal(lib.lateDebtCop(0, 10000), 0);
  });
  test('la tarifa es un parámetro, no un número fijo adentro', () => {
    assert.equal(lib.lateDebtCop(180, 25000), 75000);
  });
});

describe('asistencia — tope de la multa en $50.000 (5 horas) y aviso de seguridad social', () => {
  test('por debajo del umbral cobra normal, sin tope explícito porque 5h ya es el máximo natural', () => {
    assert.equal(lib.lateDebtCopCapped(299, 10000, 360), 40000); // 4h
    assert.equal(lib.lateDebtCopCapped(300, 10000, 360), 50000); // 5h — el tope
    assert.equal(lib.lateDebtCopCapped(359, 10000, 360), 50000); // sigue en 5h
  });
  test('al llegar al umbral (6h) la deuda en plata pasa a CERO, no sigue subiendo', () => {
    assert.equal(lib.lateDebtCopCapped(360, 10000, 360), 0);
    assert.equal(lib.lateDebtCopCapped(500, 10000, 360), 0);
  });
  test('lateDebtHours no tiene tope: las horas reales se siguen contando siempre', () => {
    assert.equal(lib.lateDebtHours(500), 8);
  });
  test('sin threshold (undefined) se comporta como el lateDebtCop de siempre, sin tope', () => {
    assert.equal(lib.lateDebtCopCapped(500, 10000), 80000);
  });
});

describe('extras/recuperaciones — bloqueo por 3 incumplimientos', () => {
  test('menos de 3 no-shows no bloquea', () => {
    assert.equal(lib.isShiftClaimBlocked(0, false), false);
    assert.equal(lib.isShiftClaimBlocked(2, false), false);
  });
  test('a la 3ra vez queda bloqueada', () => {
    assert.equal(lib.isShiftClaimBlocked(3, false), true);
    assert.equal(lib.isShiftClaimBlocked(5, false), true);
  });
  test('un permiso explícito de admin/CEO levanta el bloqueo aunque el conteo siga en 3+', () => {
    assert.equal(lib.isShiftClaimBlocked(3, true), false);
    assert.equal(lib.isShiftClaimBlocked(9, true), false);
  });
  test('SHIFT_NO_SHOW_LIMIT es 3, tal como lo pidió el usuario', () => {
    assert.equal(lib.SHIFT_NO_SHOW_LIMIT, 3);
  });
});

describe('asistencia — turnos con nombre', () => {
  test('los dos turnos del estudio tienen las horas que definió el usuario', () => {
    assert.equal(lib.ATTENDANCE_SHIFTS.manana.entry, '07:30');
    assert.equal(lib.ATTENDANCE_SHIFTS.manana.exit, '15:30');
    assert.equal(lib.ATTENDANCE_SHIFTS.tarde.entry, '16:00');
    assert.equal(lib.ATTENDANCE_SHIFTS.tarde.exit, '00:00');
  });
  test('normalizeClock acepta el "HH:MM:SS" que devuelve Postgres', () => {
    assert.equal(lib.normalizeClock('07:30:00'), '07:30');
    assert.equal(lib.normalizeClock('7:5'), '07:05');
    assert.equal(lib.normalizeClock(null), null);
    assert.equal(lib.normalizeClock('basura'), null);
  });
  test('reconoce el turno a partir de las horas guardadas', () => {
    assert.equal(lib.shiftFromTimes('07:30:00', '15:30:00'), 'manana');
    assert.equal(lib.shiftFromTimes('16:00:00', '00:00:00'), 'tarde');
  });
  test('un horario que no es ninguno de los dos queda como personalizado, no forzado a un turno', () => {
    assert.equal(lib.shiftFromTimes('09:00:00', '17:00:00'), 'personalizado');
  });
  test('sin horario no hay turno', () => {
    assert.equal(lib.shiftFromTimes(null, null), null);
  });
  test('la etiqueta muestra el rango completo del turno', () => {
    assert.equal(lib.shiftLabel('manana'), 'Mañana (07:30–15:30)');
    assert.equal(lib.shiftLabel('tarde'), 'Tarde (16:00–00:00)');
    assert.equal(lib.shiftLabel('personalizado', '09:00:00', '17:00:00'), 'Personalizado (09:00–17:00)');
    assert.equal(lib.shiftLabel(null, null, null), 'sin asignar');
  });
});

describe('asistencia — el turno de la tarde cruza medianoche', () => {
  test('llegar 00:20 se cuenta contra el turno de la tarde de anoche, no contra el de mañana', () => {
    // 2026-09-05T05:20Z = 2026-09-05 00:20 en Colombia; turno tarde 16:00
    assert.equal(lib.pickWorkDate(Date.parse('2026-09-05T05:20:00Z'), '16:00', []), '2026-09-04');
  });
  test('el turno de la mañana no se confunde con el del día anterior', () => {
    // 2026-09-04T12:40Z = 2026-09-04 07:40 en Colombia; turno manana 07:30
    assert.equal(lib.pickWorkDate(Date.parse('2026-09-04T12:40:00Z'), '07:30', []), '2026-09-04');
  });
});

describe('asistencia — sin margen de tolerancia, hora normal (eliminado 2026-09-10)', () => {
  test('una hora de deuda se alcanza a los 60 min exactos de retraso, sin ningún ajuste', () => {
    assert.equal(lib.lateDebtCop(59, 10000), 0);
    assert.equal(lib.lateDebtCop(60, 10000), 10000);
  });
  test('applyLateGrace ya no existe en el módulo', () => {
    assert.equal(lib.applyLateGrace, undefined);
    assert.equal(lib.ATTENDANCE_GRACE_MINUTES, undefined);
  });
});

describe('isHttpStatusApiError — distingue blip de red de un cambio real de API', () => {
  test('un HTTP contra una modelo puntual es un blip de red', () => {
    assert.equal(lib.isHttpStatusApiError('HTTP 403 para pinky_f00x'), true);
    assert.equal(lib.isHttpStatusApiError('HTTP 429 para amaranta_f00x'), true);
    assert.equal(lib.isHttpStatusApiError('HTTP 503 para tamar4_f00x'), true);
  });
  test('un mensaje de forma-de-respuesta-cambio NUNCA es un blip de red', () => {
    assert.equal(lib.isHttpStatusApiError('Falta el campo token_balance en la respuesta'), false);
    assert.equal(lib.isHttpStatusApiError('totalEarnings no es un número'), false);
  });
});

describe('evaluateApiErrorBurst — blip horario vs racha real (regla del 2026-09-09)', () => {
  const WINDOW = lib.API_ERROR_BURST_WINDOW_MS;
  const THRESHOLD = lib.API_ERROR_BURST_THRESHOLD;
  test('un solo error no es racha', () => {
    const r = lib.evaluateApiErrorBurst([], 1000, WINDOW, THRESHOLD);
    assert.equal(r.count, 1);
    assert.equal(r.isBurst, false);
  });
  test('el patrón horario ya diagnosticado (uno cada ~62 min) nunca junta 3 en la ventana', () => {
    let timestamps = [];
    let now = 0;
    for (let i = 0; i < 5; i++) {
      const r = lib.evaluateApiErrorBurst(timestamps, now, WINDOW, THRESHOLD);
      timestamps = r.timestamps;
      assert.equal(r.isBurst, false, 'no debería marcarse racha en el iteración ' + i);
      now += 62 * 60 * 1000;
    }
  });
  test('3 o más HTTP-status dentro de la ventana sí es una racha real', () => {
    let timestamps = [];
    let now = 0;
    let last;
    for (let i = 0; i < THRESHOLD; i++) {
      last = lib.evaluateApiErrorBurst(timestamps, now, WINDOW, THRESHOLD);
      timestamps = last.timestamps;
      now += 60 * 1000; // 1 min de diferencia entre cada uno, bien dentro de la ventana
    }
    assert.equal(last.isBurst, true);
    assert.equal(last.count, THRESHOLD);
  });
  test('errores fuera de la ventana se descartan, no acumulan para siempre', () => {
    const timestamps = [0, 1000, 2000]; // ya pasaron THRESHOLD-1 hace mucho
    const r = lib.evaluateApiErrorBurst(timestamps, WINDOW * 10, WINDOW, THRESHOLD);
    assert.equal(r.count, 1); // los 3 viejos se descartaron, solo queda el nuevo
    assert.equal(r.isBurst, false);
  });
  test('reproduce el incidente real del 2026-09-04 (174 errores en 17 min) como racha', () => {
    let timestamps = [];
    let now = 0;
    let last;
    for (let i = 0; i < 174; i++) {
      last = lib.evaluateApiErrorBurst(timestamps, now, WINDOW, THRESHOLD);
      timestamps = last.timestamps;
      now += (17 * 60 * 1000) / 174;
    }
    assert.equal(last.isBurst, true);
  });
});

describe('studioInstantAfter', () => {
  test('hora normal del mismo dia cuando es posterior a la referencia', () => {
    const ms = lib.studioInstantAfter('2026-09-09', '15:30', '07:30');
    assert.equal(lib.studioDateStr(ms), '2026-09-09');
    assert.equal(lib.studioTimeStr(ms), '15:30');
  });
  test('hora igual o anterior a la referencia cae al dia siguiente (turno que cruza medianoche)', () => {
    const ms = lib.studioInstantAfter('2026-09-09', '00:15', '16:00');
    assert.equal(lib.studioDateStr(ms), '2026-09-10');
    assert.equal(lib.studioTimeStr(ms), '00:15');
  });
});

describe('shiftDurationMinutes', () => {
  test('turno de mañana (07:30-15:30) da 8 horas', () => {
    assert.equal(lib.shiftDurationMinutes('07:30', '15:30'), 480);
  });
  test('turno de tarde que cruza medianoche (16:00-00:00) también da 8 horas', () => {
    assert.equal(lib.shiftDurationMinutes('16:00', '00:00'), 480);
  });
  test('sin alguna de las dos horas, devuelve null', () => {
    assert.equal(lib.shiftDurationMinutes('16:00', null), null);
    assert.equal(lib.shiftDurationMinutes(null, '16:00'), null);
  });
});

describe('computeBroadcastSummary', () => {
  const H = 3600000;
  test('un start y un stop completos dentro de la ventana suman exacto', () => {
    const events = [
      { event_type: 'start', created_at: new Date(1000).toISOString() },
      { event_type: 'stop', created_at: new Date(1000 + 2 * H).toISOString() },
    ];
    const r = lib.computeBroadcastSummary(events, 0, 8 * H);
    assert.equal(r.onlineMinutes, 120);
    assert.equal(r.maxGapMinutes, 0);
  });
  test('un stop sin start previo visible se cuenta desde el inicio de la ventana (ya venía transmitiendo)', () => {
    const events = [{ event_type: 'stop', created_at: new Date(2 * H).toISOString() }];
    const r = lib.computeBroadcastSummary(events, 0, 8 * H);
    assert.equal(r.onlineMinutes, 120);
  });
  test('un start sin stop posterior se cierra al final de la ventana (sigue transmitiendo)', () => {
    const events = [{ event_type: 'start', created_at: new Date(6 * H).toISOString() }];
    const r = lib.computeBroadcastSummary(events, 0, 8 * H);
    assert.equal(r.onlineMinutes, 120);
  });
  test('detecta el hueco más grande ENTRE dos segmentos, no antes del primero ni después del último', () => {
    const events = [
      { event_type: 'start', created_at: new Date(1 * H).toISOString() },
      { event_type: 'stop', created_at: new Date(2 * H).toISOString() }, // sale
      { event_type: 'start', created_at: new Date(2.75 * H).toISOString() }, // vuelve 45 min después
      { event_type: 'stop', created_at: new Date(6 * H).toISOString() },
    ];
    const r = lib.computeBroadcastSummary(events, 0, 8 * H);
    assert.equal(r.maxGapMinutes, 45);
    assert.equal(r.onlineMinutes, (1 + 3.25) * 60);
  });
  test('sin eventos en la ventana, cero transmitido y cero hueco', () => {
    const r = lib.computeBroadcastSummary([], 0, 8 * H);
    assert.equal(r.onlineMinutes, 0);
    assert.equal(r.maxGapMinutes, 0);
  });
  test('un stop huérfano de OTRO día (fuera de esta ventana) no contamina el cálculo (bug real 2026-09-15, amaranta_f00x: un "stop stop" seguido sin start en un día metía un segmento fantasma que cubría toda la ventana de TODOS los demás días de la quincena, dando 1431 min en vez de 471)', () => {
    const events = [
      { event_type: 'start', created_at: new Date(1 * H).toISOString() },
      { event_type: 'stop', created_at: new Date(3 * H).toISOString() },
      // "stop" huérfano de un día distinto -- muy anterior a la ventana.
      { event_type: 'stop', created_at: new Date(-5 * H).toISOString() },
      // "stop" huérfano de un día distinto -- muy posterior a la ventana.
      { event_type: 'stop', created_at: new Date(50 * H).toISOString() },
    ];
    const r = lib.computeBroadcastSummary(events, 0, 8 * H);
    assert.equal(r.onlineMinutes, 120);
  });
  test('un stop huérfano que SÍ cae dentro de la ventana sigue contando desde el inicio (comportamiento real, no se rompió)', () => {
    const events = [
      { event_type: 'stop', created_at: new Date(2 * H).toISOString() },
      { event_type: 'stop', created_at: new Date(-5 * H).toISOString() },
    ];
    const r = lib.computeBroadcastSummary(events, 0, 8 * H);
    assert.equal(r.onlineMinutes, 120);
  });
});

describe('classifyBroadcastColor', () => {
  test('turno normal cumplido de punta a punta, gris', () => {
    assert.equal(lib.classifyBroadcastColor({ onlineMinutes: 480, maxGapMinutes: 0, shiftDurationMinutes: 480 }), 'gris');
  });
  test('menos de su turno y un hueco de 30+ min, rojo', () => {
    assert.equal(lib.classifyBroadcastColor({ onlineMinutes: 400, maxGapMinutes: 35, shiftDurationMinutes: 480 }), 'rojo');
  });
  test('menos de su turno pero sin hueco grande, sin color especial', () => {
    assert.equal(lib.classifyBroadcastColor({ onlineMinutes: 400, maxGapMinutes: 10, shiftDurationMinutes: 480 }), null);
  });
  test('el rosa por extra/recuperación se eliminó (2026-09-10): un "hadExtra" ya no pisa el criterio real', () => {
    // Antes "hadExtra: true" ganaba sobre cualquier otro criterio y daba
    // rosa sin más. Ahora ya no existe ese concepto acá — con un hueco de
    // 200 min esto es "rojo" por el criterio real (desconexión grande), no
    // "rosa" por tener una extra reclamada ese día.
    assert.equal(lib.classifyBroadcastColor({ onlineMinutes: 10, maxGapMinutes: 200, shiftDurationMinutes: 480, hadExtra: true }), 'rojo');
  });
});

describe('resolveOwesAlertMessage', () => {
  test('sin mensaje personalizado para esa modelo, usa el default con el nombre reemplazado', () => {
    const r = lib.resolveOwesAlertMessage(null, 'pinky_f00x');
    assert.match(r, /^pinky_f00x /);
    assert.match(r, /asume su propia seguridad social/);
    assert.equal(r.indexOf('{modelo}'), -1);
  });
  test('mensaje personalizado por modelo con {modelo} lo reemplaza donde corresponda', () => {
    const r = lib.resolveOwesAlertMessage('{modelo} faltó un día completo y por eso asume su salud esta quincena.', 'conni_f00x');
    assert.equal(r, 'conni_f00x faltó un día completo y por eso asume su salud esta quincena.');
  });
  test('mensaje personalizado sin {modelo} le agrega el nombre al final para no dejarlo ambiguo', () => {
    const r = lib.resolveOwesAlertMessage('Faltó por decisión propia.', 'jax_f00x');
    assert.equal(r, 'Faltó por decisión propia. (jax_f00x)');
  });
});
