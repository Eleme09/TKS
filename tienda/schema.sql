-- TIENDA- : registro de consumo/fiado por quincena + inventario.
-- Correr completo en el SQL Editor de un proyecto Supabase nuevo.

create table if not exists tf_admins (
  id bigint generated always as identity primary key,
  username text not null unique,
  password_hash text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists tf_negocio_config (
  id bigint primary key default 1,
  name text not null default 'Mi tienda',
  currency text not null default 'COP',
  updated_at timestamptz not null default now(),
  constraint tf_negocio_config_singleton check (id = 1)
);
insert into tf_negocio_config (id, name) values (1, 'Mi tienda')
  on conflict (id) do nothing;

-- Personas que fían (clientes/empleados). El PIN es lo único que las
-- identifica al autoservicio — no hay usuario/contraseña por persona.
create table if not exists tf_personas (
  id bigint generated always as identity primary key,
  nombre text not null,
  pin_hash text not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists tf_productos (
  id bigint generated always as identity primary key,
  nombre text not null,
  precio numeric(12, 2) not null default 0,
  stock numeric(12, 2) not null default 0,
  unidad text not null default 'unidad',
  foto_url text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un consumo nunca se borra: se anula (soft-delete) con motivo obligatorio,
-- para que el reporte de quincena siempre pueda mostrar tanto lo vigente
-- como lo anulado y por qué.
create table if not exists tf_consumos (
  id bigint generated always as identity primary key,
  persona_id bigint not null references tf_personas(id),
  producto_id bigint not null references tf_productos(id),
  cantidad numeric(12, 2) not null,
  precio_unitario numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  anulado boolean not null default false,
  motivo_anulacion text,
  anulado_at timestamptz
);

create index if not exists tf_consumos_persona_idx on tf_consumos(persona_id);
create index if not exists tf_consumos_created_idx on tf_consumos(created_at);

-- Historial de facturas cargadas por foto (auditoría de qué stock se
-- agregó y de dónde salió, con el texto crudo del OCR para revisar después).
create table if not exists tf_facturas (
  id bigint generated always as identity primary key,
  texto_ocr text,
  items_aplicados jsonb,
  created_at timestamptz not null default now()
);

alter table tf_admins enable row level security;
alter table tf_negocio_config enable row level security;
alter table tf_personas enable row level security;
alter table tf_productos enable row level security;
alter table tf_consumos enable row level security;
alter table tf_facturas enable row level security;
-- Sin policies: el backend siempre usa la service_role key (bypassea RLS).
-- Mismo patrón que VENTA-WEB.

-- Cierre de quincena: foto congelada de lo que debe cada persona al terminar
-- la quincena (1-15 o 16-fin de mes). `detalle` = [{persona_id, persona_nombre,
-- total, items, anulados, pagado, pagado_at}]. Una quincena solo se cierra una vez.
create table if not exists tf_cierres (
  id bigint generated always as identity primary key,
  periodo_inicio date not null,
  periodo_fin date not null,
  total numeric(14, 2) not null default 0,
  detalle jsonb not null default '[]'::jsonb,
  cerrado_at timestamptz not null default now(),
  unique (periodo_inicio, periodo_fin)
);
alter table tf_cierres enable row level security;
