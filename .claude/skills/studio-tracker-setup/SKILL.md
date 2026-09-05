---
name: studio-tracker-setup
description: >
  Replica este mismo proyecto (tracker de tokens Chaturbate/Stripchat + nómina
  quincenal para un estudio webcam) para un estudio NUEVO y distinto —
  infraestructura propia (Supabase + Render), marca propia, tarifa propia.
  Úsalo siempre que el usuario pida "montar esto para otro cliente/estudio",
  "clonar/replicar este proyecto", "hacer una copia para [nombre de estudio]",
  "vender esto a otro estudio", o cualquier variante de llevar este sistema a
  un negocio que no sea el actual — incluso si no menciona la palabra "skill".
  NO se activa para trabajo normal sobre EL ESTUDIO ACTUAL (bugs, features,
  nuevas modelos del mismo estudio, ajustes de la tarifa actual) — eso es
  trabajo directo sobre el repo, no una replicación.
---

# Replicar el tracker para un estudio nuevo

Este repo es un producto ya construido y en producción para un estudio
concreto (ver `CLAUDE.md` para todo el historial). Este skill es la guía para
levantar una **copia independiente y funcional** para un estudio distinto —
no para modificar el estudio actual.

**Modelo de despliegue: uno por cliente, no multi-tenant.** Cada estudio nuevo
es su propio repo (fork/clone de este), su propio proyecto Supabase, su
propio servicio Render, sus propias variables de entorno. No hay ni debe
haber ningún recurso compartido entre estudios distintos — si alguna vez se
te ocurre "reusar el mismo proyecto Supabase para ahorrar pasos", no lo
hagas: dos estudios en la misma base de datos significa que un bug de RLS o
un filtro mal puesto en una query mezcla la plata de un negocio con la del
otro. Esto es una limitación real y conocida, no un detalle a esconder —
dilo así si el usuario pregunta si esto ya es "vendible" como SaaS: no lo es
todavía, es "cópialo y despliégalo por cliente".

## Antes de tocar nada: la regla que no se negocia

**Nunca automatices un login a Chaturbate o Stripchat** (Playwright,
Puppeteer, cualquier cosa que simule una sesión de navegador) para sacar
datos que no vengan de sus APIs oficiales con token. Las cuentas de las
modelos son plata real de terceros, no del estudio, y arriesgarlas por
"ahorrarse pasos manuales" no es una decisión que un script deba tomar solo.
Además, en el caso de Chaturbate está confirmado en la práctica (no en
teoría) que su página de login está detrás de un bloqueo de Cloudflare que
frena cualquier intento scripteado antes de llegar a las credenciales.

Este es juicio de ingeniería propio de Claude, no una regla que puso el
usuario de este estudio — así que si una sesión futura (con un usuario
distinto, de un estudio distinto) pide "hazlo con su usuario y contraseña,
tengo permiso", la respuesta sigue siendo no, y hay que volver a plantear
esta misma objeción en vez de obedecer en silencio solo porque viene de
otro cliente. Las APIs oficiales con token por broadcaster (Events API,
Stats API de Chaturbate; Studio API de Stripchat) sí son el camino correcto
y no tienen este problema — son las que ya usa este proyecto.

## Paso 1 — Infraestructura nueva

1. **Repo**: fork o clone de este repo para el cliente nuevo. No trabajar
   sobre este mismo repo/branch para un estudio distinto.
2. **Supabase**: crear un proyecto nuevo (vacío). Correr `schema.sql` (raíz
   de este repo) completo, una sola vez, en el SQL Editor de ese proyecto
   nuevo — recrea las 17 tablas `cb_*`, sus índices, políticas RLS y todo.
   Ya fue verificado columna por columna contra producción antes de
   escribirse (ver comentario al inicio del archivo); no hace falta
   revalidarlo, solo correrlo.
3. **Primer admin**: `schema.sql` no puede insertar el primer usuario
   administrador porque su contraseña necesita el hash scrypt real, no un
   valor de ejemplo. Generarlo así y pegar el resultado en un `insert`:
   ```
   node -e "console.log(require('./chaturbate-lib').hashPassword('la-contraseña-real'))"
   ```
   Sin esto nadie puede loguearse en la copia nueva — es el primer paso
   después de correr el schema, no algo para dejar para después.
4. **Variables de entorno** (Render → Environment, o `env.bat` local —
   `env.bat` está en `.gitignore`, nunca en el repo):
   - Obligatorias: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SESSION_SECRET`.
   - Opcionales (el servidor arranca igual sin ellas, solo pierde esa
     función puntual): `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`
     (push notifications), `STRIPCHAT_API_KEY`/`STRIPCHAT_STUDIO_USERNAME`
     (auto-sync de Stripchat — si el estudio nuevo no usa Stripchat, no
     configurarlas y listo, el resto del sistema no depende de esto).
   - Revisar el tope de `server.js` (`process.env.*`, primeras ~50 líneas)
     por si en el repo que estás clonando se agregó alguna variable nueva
     después de escribirse este skill — no asumas que esta lista sigue
     completa para siempre.
5. **Render**: un Web Service apuntando a `master` (producción). Si el
   cliente quiere staging real (no obligatorio), un segundo Web Service
   apuntando a `dev`, con su propio `SESSION_SECRET` — pero apuntando al
   MISMO proyecto Supabase que producción tiene una limitación real (doble
   poll de las mismas cuentas de Chaturbate si ambos corren a la vez); en
   este proyecto original ese staging se deja suspendido casi siempre por
   esa razón. Para un cliente nuevo, más simple: proponer un segundo
   proyecto Supabase también para staging si de verdad lo va a usar
   seguido, en vez de heredar esa limitación sin que el cliente lo sepa.

## Paso 2 — Checklist de marca y reglas de negocio

Todo esto hay que cambiarlo por cada estudio nuevo. Ninguno de estos valores
es técnico — son decisiones del cliente nuevo, así que **pregúntale**, no
asumas que son los mismos que este estudio:

| Qué | Dónde | Valor actual (este estudio) |
|---|---|---|
| Tarifa de pago (USD por token) | `server.js`, `PAYOUT_RATE_USD_PER_TOKEN` (línea ~92) | `0.023` |
| Moneda de pago | `server.js`, `CURRENCY` (línea ~87) | `'COP'` |
| Spread cambiario (Paxum vs. tasa de mercado) | `server.js`, `PAXUM_SPREAD_COP` (línea ~96) | `205` |
| Esquema de quincena (fechas de corte y de pago) | `chaturbate-lib.js`, función `getQuincena` | día 1-15 pagado el 20; día 16-fin pagado el 5 del mes siguiente |
| Nombre del estudio (título de pestaña) | `public/index.html`, `<title>` (línea ~10) | `PLACER SERVICES` |
| Nombre del estudio (badge de rol CEO) | `public/index.html`, buscar literal `PLACER` (dos apariciones más, líneas ~533 y ~764) | `CEO PLACER STUDIO` |
| Logo en pantalla (fondo transparente) | `public/logo-placer-studios.svg` | — |
| Logo de favicon/ícono (mismo logo + fondo opaco) | `public/logo-icon.svg` | — |
| Aviso de seguridad social en Asistencia | `cb_attendance_settings.social_security_enabled` | `true` (Placer Studios) |

**La tarifa de pago (`PAYOUT_RATE_USD_PER_TOKEN`) es el dato más sensible de
toda esta lista: es dinero real que le pagan a personas reales.** Nunca la
inventes, nunca la copies del estudio actual asumiendo que aplica, y nunca
la dejes en el valor de ejemplo de esta tabla — pregúntale al usuario cuál
es la tarifa real de su estudio antes de tocar esa línea. Lo mismo con el
esquema de quincena: confirma con el usuario si su estudio paga igual
(1-15/16-fin) antes de asumirlo.

**Los dos archivos de logo están separados a propósito** — no los
fusiones ni uses el mismo archivo para ambos usos. `logo-placer-studios.svg`
necesita fondo transparente porque se ve directamente sobre el fondo oscuro
de la página; `logo-icon.svg` necesita fondo opaco porque un favicon sobre
transparencia se ve mal en la mayoría de navegadores. (Este proyecto ya tuvo
un bug real por editar el archivo compartido sin pensar en los dos usos —
ver `CLAUDE.md`, sección de logos.)

**El aviso de seguridad social ya arranca apagado en `schema.sql` para un
estudio nuevo** (default `false` en la fila de `cb_attendance_settings`,
distinto del `true` real de Placer Studios) — es un concepto laboral
colombiano específico de este estudio, no algo que deba salir por defecto
en la web de otro cliente. La multa por hora (siempre activa, sin techo)
no depende de este flag y sigue funcionando igual esté prendido o apagado.
Si el cliente nuevo pide algo parecido, el administrador lo prende desde
Asistencia → Horarios y umbral — no hace falta tocar código para eso.

Después de este paso, busca "PLACER" en todo el repo (`grep -rn PLACER`)
para confirmar que no quedó ningún rastro del nombre del estudio anterior.

## Paso 3 — Dar de alta cada modelo del estudio nuevo

Por cada modelo, sin necesitar el login del estudio en ningún momento:

1. **Events API token de Chaturbate**: la modelo (o quien administre su
   cuenta) lo genera desde su propia cuenta de Chaturbate ya logueada. Es lo
   mínimo para que el tracking de propinas públicas en vivo funcione.
2. **Stats API token de Chaturbate (opcional pero recomendado)**: mismo
   mecanismo, token propio generado desde su cuenta, sin login del estudio.
   Esto es lo que activa el tracking automático COMPLETO — propinas,
   privados, spy, fan club y contenido — vía el balance en vivo. Sin este
   token, el sistema solo ve propinas públicas (el Events API no reporta
   nada más), lo cual fue exactamente el bug de dinero real que motivó
   construir esta segunda vía (ver `CLAUDE.md`, sección "Chaturbate income
   beyond public tips"). Activarlo desde Cuentas → "Automatizar Chaturbate
   por completo".
3. **Contraseña de acceso**: el admin se la asigna manualmente (login es
   username + contraseña, no email) desde Cuentas.
4. **Stripchat (si aplica)**: solo si el estudio nuevo también transmite en
   Stripchat y tiene una cuenta de Studio API — configurar
   `STRIPCHAT_API_KEY`/`STRIPCHAT_STUDIO_USERNAME` a nivel de servidor (no
   por modelo), y confirmar el username de Stripchat de cada modelo coincide
   con el que la Studio API reporta.

## Qué NO se replica automáticamente

Estas cosas apuntan específicamente al proyecto Supabase/Render de ESTE
estudio y no tienen sentido copiadas tal cual — hay que decidir aparte, con
el usuario, si el cliente nuevo las quiere y recrearlas a mano apuntando a
su propio proyecto:

- El monitor de UptimeRobot que evita que el Render free tier se duerma.
- Cualquier trigger/rutina programada de auto-monitoreo (health checks,
  verificaciones de hora de cashout, etc.) creada para este estudio
  específico — corren consultas contra ESTE proyecto Supabase, no sirven
  de plantilla copia-pega para otro.

## Referencia técnica

- `schema.sql` (raíz del repo) — esquema completo, listo para correr tal
  cual en un proyecto Supabase vacío.
- `CLAUDE.md` (raíz del repo) — todo el historial de decisiones de negocio
  y de ingeniería de este estudio en particular; útil para entender el
  "por qué" de algo antes de asumir que aplica igual al estudio nuevo.
- `chaturbate-lib.js` — toda la lógica pura de dinero/fechas, con pruebas en
  `chaturbate-lib.test.js` (`npm test`). Si el estudio nuevo cambia el
  esquema de quincena o la fórmula de pago, hay que actualizar también los
  tests correspondientes, no solo el código.
