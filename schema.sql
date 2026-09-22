-- ============================================================================
-- PLACER SERVICES — schema completo de Supabase (Postgres)
-- ============================================================================
-- Esto recrea desde cero TODAS las tablas cb_* que usa server.js. Generado
-- 2026-09-03 leyendo directamente el proyecto de producción (yklqqalnmficsbyabbrn)
-- vía information_schema/pg_catalog — no es un diseño a mano, es el reflejo
-- exacto de lo que ya corre en vivo (columnas, tipos, defaults, checks, PKs,
-- UNIQUE, FKs, índices y políticas RLS).
--
-- Por qué existe este archivo: hasta ahora cada tabla se creó con llamadas
-- sueltas de migración a lo largo de la sesión, sin un solo lugar que diga
-- "así se arma de cero". Este archivo es ese lugar — para reconstruir el
-- proyecto (recuperación de desastre) o para levantar la base de un estudio
-- nuevo con el mismo producto.
--
-- Cómo usarlo:
--   1. Crear un proyecto Supabase nuevo (vacío).
--   2. Correr este archivo completo una sola vez (SQL Editor de Supabase, o
--      vía MCP con apply_migration).
--   3. Insertar manualmente al menos un admin en cb_admins (ver abajo) — sin
--      eso nadie puede loguearse. La contraseña se hashea con scrypt en
--      server.js (hashPassword en chaturbate-lib.js): no se puede escribir un
--      hash válido a mano en SQL, hay que generarlo con Node.
--   4. Configurar las env vars (SUPABASE_URL, SUPABASE_ANON_KEY,
--      SESSION_SECRET como mínimo — ver CLAUDE.md, sección "Secrets").
--
-- Nota de seguridad: RLS está habilitado en todas las tablas pero con una
-- política abierta "true" para el rol anon en todas — es a propósito
-- (ver CLAUDE.md), porque la anon key nunca sale del server. NO exponer esta
-- misma anon key a un cliente browser directo con este esquema; toda
-- consulta pasa por server.js.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- cb_models — una fila por cada cuenta de modelo (login + estado de tracking)
-- ---------------------------------------------------------------------------
create table public.cb_models (
  username         text primary key,
  role             text not null default 'modelo',
  created_at       timestamptz not null default now(),
  token            text,                 -- Chaturbate Events API token
  password_hash    text,                 -- scrypt "salt:hash", null hasta que el admin le asigna contraseña
  session_version  int4 not null default 1,  -- incrementar fuerza cierre de sesión en todos sus dispositivos
  last_cursor      text,                 -- nextUrl persistido para resumir el long-poll sin perder tips
  stats_api_token  text,                 -- token del Stats API oficial (balance en vivo), opcional
  last_balance     int4,                 -- último token_balance visto, para detectar deltas
  last_balance_at  timestamptz
);


-- ---------------------------------------------------------------------------
-- cb_admins — cuentas administrador/CEO (login con username, no email)
-- ---------------------------------------------------------------------------
create table public.cb_admins (
  id               bigint generated always as identity primary key,
  username         text not null unique,
  password_hash    text not null,
  role             text not null check (role in ('administrador', 'ceo')),
  gender           text check (gender in ('m', 'f')),
  created_at       timestamptz not null default now(),
  hide_name        boolean not null default false,
  session_version  int4 not null default 1,
  display_name     text
);


-- ---------------------------------------------------------------------------
-- cb_tips — cada tip individual recibido vía Chaturbate Events API
-- ---------------------------------------------------------------------------
create table public.cb_tips (
  id          bigint generated always as identity primary key,
  username    text not null references public.cb_models(username),
  tokens      int4 not null,
  event_id    text not null,
  created_at  timestamptz not null default now(),
  unique (username, event_id)   -- dedup: el mismo evento nunca se cuenta dos veces
);
create index cb_tips_username_created_idx on public.cb_tips (username, created_at);


-- ---------------------------------------------------------------------------
-- cb_broadcast_events — historial de start/stop de transmisión (online/offline)
-- ---------------------------------------------------------------------------
create table public.cb_broadcast_events (
  id          bigint generated always as identity primary key,
  username    text not null references public.cb_models(username),
  event_type  text not null check (event_type in ('start', 'stop')),
  event_id    text not null,
  created_at  timestamptz not null default now(),
  unique (username, event_id)
);
create index cb_broadcast_events_username_created_idx on public.cb_broadcast_events (username, created_at desc);


-- ---------------------------------------------------------------------------
-- cb_shifts — calendario de turnos extra (sign-up de horas adicionales)
-- ---------------------------------------------------------------------------
create table public.cb_shifts (
  id          bigint generated always as identity primary key,
  shift_date  date not null,
  start_time  time not null,
  end_time    time,
  note        text,
  claimed_by  text references public.cb_models(username),
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index cb_shifts_date_idx on public.cb_shifts (shift_date, start_time);


-- ---------------------------------------------------------------------------
-- cb_push_subscriptions — suscripciones Web Push, una fila por dispositivo
-- ---------------------------------------------------------------------------
-- Sin FK a propósito: username puede ser de cb_admins O cb_models, y Postgres
-- no permite una FK limpia a dos tablas — se confía a nivel de aplicación
-- (mismo patrón que author_username en cb_news_*). Ver CLAUDE.md.
create table public.cb_push_subscriptions (
  id          bigint generated always as identity primary key,
  username    text not null,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  role        text,   -- rol del suscriptor al momento de suscribirse (para segmentar notificaciones)
  unique (username, endpoint)
);


-- ---------------------------------------------------------------------------
-- cb_audit_log — registro de acciones administrativas sensibles
-- ---------------------------------------------------------------------------
create table public.cb_audit_log (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  actor_username text not null,
  actor_role     text not null,
  action         text not null,
  target         text,
  details        jsonb
);
create index cb_audit_log_created_at_idx on public.cb_audit_log (created_at desc);


-- ---------------------------------------------------------------------------
-- cb_stripchat_earnings — tokens de Stripchat por quincena (API + fallback manual)
-- ---------------------------------------------------------------------------
create table public.cb_stripchat_earnings (
  id            bigint generated always as identity primary key,
  username      text not null references public.cb_models(username),
  period_start  date not null,
  period_end    date not null,
  tokens        int4 not null default 0,
  entered_by    text,   -- 'stripchat-api' o el username del admin que la guardó a mano
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (username, period_start, period_end)
);


-- ---------------------------------------------------------------------------
-- cb_news_posts / cb_news_comments / cb_news_reads — tablón de Noticias
-- ---------------------------------------------------------------------------
create table public.cb_news_posts (
  id                    bigint generated always as identity primary key,
  author_username       text not null,
  author_role           text not null,
  title                 text not null,
  body                  text not null,
  created_at            timestamptz not null default now(),
  author_gender         text,
  author_anonymous      boolean not null default false,
  post_type             text not null default 'hilo',   -- 'hilo' (con comentarios) o 'aviso' (sin comentarios)
  author_display_name   text
);

create table public.cb_news_comments (
  id                    bigint generated always as identity primary key,
  post_id               bigint not null references public.cb_news_posts(id),
  author_username       text not null,
  author_role           text not null,
  body                  text not null,
  created_at            timestamptz not null default now(),
  author_gender         text,
  author_anonymous      boolean not null default false,
  author_display_name   text
);

create table public.cb_news_reads (
  id          bigint generated always as identity primary key,
  post_id     bigint not null references public.cb_news_posts(id),
  username    text not null,
  role        text not null,
  read_at     timestamptz not null default now(),
  unique (post_id, username)
);


-- ---------------------------------------------------------------------------
-- cb_chaturbate_extra_earnings — corrección manual de Chaturbate (fallback,
-- solo aplica si ni balance en vivo ni base de CSV cubren el período)
-- ---------------------------------------------------------------------------
create table public.cb_chaturbate_extra_earnings (
  id            bigint generated always as identity primary key,
  username      text not null references public.cb_models(username),
  period_start  date not null,
  period_end    date not null,
  tokens        int4 not null default 0,
  note          text,
  entered_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (username, period_start, period_end)
);


-- ---------------------------------------------------------------------------
-- cb_unhandled_events — catch-all diagnóstico: cualquier evento de la
-- Events API que el switch de pollLoop no reconozca todavía (vigilar por si
-- Chaturbate empieza a mandar un tipo de evento nuevo con tokens, ej.
-- fanclubJoin / mediaPurchase)
-- ---------------------------------------------------------------------------
create table public.cb_unhandled_events (
  id          bigint generated always as identity primary key,
  username    text not null references public.cb_models(username),
  method      text not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- cb_balance_ticks — incrementos reales de balance detectados por el
-- Stats API oficial de Chaturbate (cubre tips + privados + spy + fan club +
-- contenido — todo lo que el Events API NO reporta)
-- ---------------------------------------------------------------------------
create table public.cb_balance_ticks (
  id          bigint generated always as identity primary key,
  username    text not null references public.cb_models(username),
  tokens      int4 not null,
  sampled_at  timestamptz not null,
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- cb_balance_resets — auditoría de los retiros automáticos diarios de
-- Chaturbate (balance -> 0). Nunca se resta de nada, es solo diagnóstico.
-- ---------------------------------------------------------------------------
create table public.cb_balance_resets (
  id            bigint generated always as identity primary key,
  username      text not null references public.cb_models(username),
  from_balance  int4 not null,
  to_balance    int4 not null,
  detected_at   timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- cb_chaturbate_period_base — base congelada desde el CSV de historial de
-- transacciones de Chaturbate, para backfill de un período ya cerrado
-- ---------------------------------------------------------------------------
create table public.cb_chaturbate_period_base (
  id             bigint generated always as identity primary key,
  username       text not null references public.cb_models(username),
  period_start   date not null,
  period_end     date not null,
  base_tokens    int4 not null,
  covers_until   timestamptz not null,   -- momento de la subida, no la última fila del CSV (conservador)
  source         text,
  entered_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (username, period_start, period_end)
);


-- ---------------------------------------------------------------------------
-- cb_api_errors — errores/formas inesperadas de respuesta de APIs externas
-- (Chaturbate Stats API, Stripchat Studio API) — para detectar cuando alguna
-- de las dos cambia su contrato sin avisar
-- ---------------------------------------------------------------------------
create table public.cb_api_errors (
  id          bigint generated always as identity primary key,
  source      text not null,
  message     text not null,
  created_at  timestamptz not null default now()
);


-- ============================================================================
-- Row Level Security — abierta a `anon` en todas las tablas cb_*
-- ============================================================================
-- Aceptado a propósito: la anon key vive solo en variables de entorno del
-- servidor (nunca llega al browser), así que "abierta a anon" en la práctica
-- significa "solo server.js puede tocar esto". Ver CLAUDE.md.


-- ============================================================================
-- Asistencia: hora de entrada (validada por el admin), hora de salida,
-- justificaciones y excusas medicas. Ver la seccion "Asistencia" de CLAUDE.md.
-- ============================================================================

-- Hora a la que le toca entrar a cada modelo. Sin fila aca, esa modelo no
-- acumula retraso (no hay contra que medirlo).
-- Turno de cada modelo. entry_time es lo que manda para calcular el retraso;
-- shift ('manana' | 'tarde' | null si es personalizado) y exit_time existen
-- para poder asignar el turno de un boton y mostrar el rango completo.
-- Turnos del estudio: manana 07:30-15:30, tarde 16:00-00:00.
create table if not exists public.cb_attendance_schedule (
  username   text primary key,
  entry_time time        not null default '16:00',
  exit_time  time,
  shift      text,
  updated_at timestamptz not null default now()
);

-- Un registro por modelo por dia laboral. reported_at es lo que dice ella;
-- official_at es la hora que realmente cuenta, y solo existe cuando el
-- administrador valida. Las dos se guardan a proposito: sin las dos no hay
-- forma de auditar despues una diferencia entre lo reportado y lo aprobado.
create table if not exists public.cb_attendance_days (
  id              bigserial primary key,
  username        text not null,
  work_date       date not null,
  scheduled_at    timestamptz,
  reported_at     timestamptz not null default now(),
  status          text not null default 'pendiente',  -- pendiente | validada | rechazada
  official_at     timestamptz,
  official_source text,                                -- reportada | ahora | manual
  validated_at    timestamptz,
  validated_by    text,
  reject_reason   text,
  late_minutes    int,                                 -- positivo = tarde, negativo = temprano
  exit_at         timestamptz,                         -- la anota ella, no se valida
  note            text,
  created_at      timestamptz not null default now(),
  unique (username, work_date)
);
create index if not exists cb_attendance_days_user_date on public.cb_attendance_days (username, work_date desc);

-- excuse_* son opcionales: una justificacion puede llevar un archivo adjunto
-- (ej. la foto/PDF de una incapacidad medica) en vez de vivir en una tabla
-- aparte -- fusionado 2026-09-22, ver CLAUDE.md. El archivo va en base64 en
-- la propia fila (tope 2.5 MB por archivo, validado en el servidor); para el
-- volumen real de esto es mas simple que montar un bucket aparte, y si la
-- tabla crece mucho esa es la señal para mudarlo.
create table if not exists public.cb_attendance_justifications (
  id                     bigserial primary key,
  username               text not null,
  work_date              date not null,
  kind                   text not null default 'otro',   -- retraso | conexion | room | salud | otro
  body                   text not null,
  created_at             timestamptz not null default now(),
  excuse_filename        text,
  excuse_mime_type       text,
  excuse_size_bytes      int,
  excuse_content_base64  text
);
create index if not exists cb_attendance_just_user_date on public.cb_attendance_justifications (username, work_date desc);

-- Fila unica (id = 1). El umbral es cuanto retraso acumulado en la quincena
-- hace que la modelo asuma su propia seguridad social (6 h, confirmado por el
-- usuario 2026-09-04). La tarifa se cobra por cada HORA COMPLETA de retraso
-- acumulado, no proporcional: 59 minutos no deben nada.
create table if not exists public.cb_attendance_settings (
  id                       int primary key default 1,
  late_threshold_minutes   int not null default 360,
  late_hour_fee_cop        int not null default 10000,
  -- Aviso de "asume su propia seguridad social" al pasar el umbral: es un
  -- concepto laboral colombiano especifico de Placer Studios (donde esta
  -- columna vive en true), no algo que aplique por defecto a un estudio
  -- nuevo. Para un cliente nuevo arranca en false -- solo la multa por hora
  -- (siempre activa, sin techo) aplica hasta que ese cliente pida algo
  -- parecido. Administrador lo prende/apaga desde Asistencia -> Horarios y
  -- umbral.
  social_security_enabled boolean not null default false,
  updated_at               timestamptz not null default now()
);
insert into public.cb_attendance_settings (id, late_threshold_minutes, late_hour_fee_cop, social_security_enabled)
values (1, 360, 10000, false) on conflict (id) do nothing;

-- Evita que el aviso de "todas entraron a tiempo" salga repetido: la fecha es
-- la primary key, asi que el segundo intento del dia choca y no manda nada.
create table if not exists public.cb_attendance_daily_notice (
  work_date date primary key,
  sent_at   timestamptz not null default now()
);

alter table public.cb_models                      enable row level security;
alter table public.cb_admins                       enable row level security;
alter table public.cb_tips                         enable row level security;
alter table public.cb_broadcast_events             enable row level security;
alter table public.cb_shifts                       enable row level security;
alter table public.cb_push_subscriptions           enable row level security;
alter table public.cb_audit_log                    enable row level security;
alter table public.cb_stripchat_earnings           enable row level security;
alter table public.cb_news_posts                   enable row level security;
alter table public.cb_news_comments                enable row level security;
alter table public.cb_news_reads                   enable row level security;
alter table public.cb_chaturbate_extra_earnings    enable row level security;
alter table public.cb_unhandled_events             enable row level security;
alter table public.cb_balance_ticks                enable row level security;
alter table public.cb_balance_resets               enable row level security;
alter table public.cb_chaturbate_period_base       enable row level security;
alter table public.cb_api_errors                   enable row level security;
alter table public.cb_attendance_schedule          enable row level security;
alter table public.cb_attendance_days              enable row level security;
alter table public.cb_attendance_justifications    enable row level security;
alter table public.cb_attendance_settings          enable row level security;
alter table public.cb_attendance_daily_notice      enable row level security;

create policy cb_tracker_server_access_models       on public.cb_models                   for all to anon using (true) with check (true);
create policy cb_tracker_server_access_admins       on public.cb_admins                   for all to anon using (true) with check (true);
create policy cb_tracker_server_access_tips         on public.cb_tips                     for all to anon using (true) with check (true);
create policy cb_tracker_server_access_broadcast_events on public.cb_broadcast_events      for all to anon using (true) with check (true);
create policy cb_tracker_server_access_shifts       on public.cb_shifts                   for all to anon using (true) with check (true);
create policy cb_tracker_server_access_push_subscriptions on public.cb_push_subscriptions  for all to anon using (true) with check (true);
create policy cb_tracker_server_access_audit_log    on public.cb_audit_log                for all to anon using (true) with check (true);
create policy cb_stripchat_earnings_anon_all        on public.cb_stripchat_earnings       for all to anon using (true) with check (true);
create policy cb_news_posts_anon_all                on public.cb_news_posts               for all to anon using (true) with check (true);
create policy cb_news_comments_anon_all             on public.cb_news_comments            for all to anon using (true) with check (true);
create policy cb_news_reads_anon_all                on public.cb_news_reads               for all to anon using (true) with check (true);
create policy cb_chaturbate_extra_earnings_anon_all on public.cb_chaturbate_extra_earnings for all to anon using (true) with check (true);
create policy cb_unhandled_events_anon_all          on public.cb_unhandled_events         for all to anon using (true) with check (true);
create policy cb_balance_ticks_anon_all             on public.cb_balance_ticks            for all to anon using (true) with check (true);
create policy cb_balance_resets_anon_all            on public.cb_balance_resets           for all to anon using (true) with check (true);
create policy cb_chaturbate_period_base_anon_all    on public.cb_chaturbate_period_base   for all to anon using (true) with check (true);
create policy cb_api_errors_anon_all                on public.cb_api_errors               for all to anon using (true) with check (true);
create policy cb_attendance_schedule_anon_all       on public.cb_attendance_schedule       for all to anon using (true) with check (true);
create policy cb_attendance_days_anon_all           on public.cb_attendance_days           for all to anon using (true) with check (true);
create policy cb_attendance_just_anon_all           on public.cb_attendance_justifications for all to anon using (true) with check (true);
create policy cb_attendance_settings_anon_all       on public.cb_attendance_settings       for all to anon using (true) with check (true);
create policy cb_attendance_daily_notice_anon_all   on public.cb_attendance_daily_notice   for all to anon using (true) with check (true);


-- ============================================================================
-- Primer admin — EJEMPLO, no ejecutar tal cual. Generar el hash real con:
--   node -e "console.log(require('./chaturbate-lib').hashPassword('la-contraseña-real'))"
-- y pegar el resultado abajo antes de correr este insert.
-- ============================================================================
-- insert into public.cb_admins (username, password_hash, role, display_name)
-- values ('admin', 'PEGAR_AQUI_EL_HASH_scrypt', 'administrador', 'Admin');
