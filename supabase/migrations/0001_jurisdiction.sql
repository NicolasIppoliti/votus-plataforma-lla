-- 0001_jurisdiction.sql
-- jurisdiction-model spec: the explicit jurisdiction hierarchy plus the
-- election/category reference tables that `result_row` (0002) attaches to.
--
-- RLS is enabled on every table at creation time, with no policy yet — an
-- authenticated-role policy is added in Phase 8 (D7). Until then these
-- tables are unreadable via the API (default-deny), never accidentally
-- exposed while policies are pending.

create table if not exists jurisdiction (
  id uuid primary key default gen_random_uuid(),
  -- distrito is always present; lower levels are null until a row exists
  -- at that granularity (jurisdiction-model: "MUST NOT populate ... with
  -- fabricated or inferred values").
  distrito_code text not null,
  distrito_name text,
  seccion_code text,
  seccion_name text,
  circuito_code text,
  circuito_name text,
  establecimiento_code text,
  establecimiento_name text,
  mesa_code integer,
  created_at timestamptz not null default now(),
  -- One row per distinct lineage tuple actually observed in a source.
  unique (
    distrito_code, seccion_code, circuito_code, establecimiento_code, mesa_code
  )
);

alter table jurisdiction enable row level security;

create table if not exists election (
  id uuid primary key default gen_random_uuid(),
  year integer not null,
  round text not null, -- 'paso' | 'generales' | 'balotaje' | 'legislativas'
  created_at timestamptz not null default now(),
  unique (year, round)
);

alter table election enable row level security;

create table if not exists category (
  id uuid primary key default gen_random_uuid(),
  -- Raw source category name (e.g. "PRESIDENTE/A", "DIPUTADO NACIONAL"),
  -- kept verbatim rather than mapped to an internal enum — the source
  -- vocabulary already differs across years (SPIKE (b)) and jurisdictions.
  name text not null unique,
  created_at timestamptz not null default now()
);

alter table category enable row level security;
