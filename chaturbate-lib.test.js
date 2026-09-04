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
