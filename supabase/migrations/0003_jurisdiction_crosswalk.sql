-- 0003_jurisdiction_crosswalk.sql
-- jurisdiction-model spec: the curated national<->PBA jurisdiction
-- crosswalk, cross-year mesa stability tracking, and the fiscalización mesa
-- identity join decision (design D9.5, task 4.4/4.5, Engram #1410).
--
-- Both tables mirror `curated/crosswalk.yaml` -- the YAML file is the
-- human-reviewed source of truth (PR-reviewed per design.md's File
-- Changes table); a future loader task populates these tables from it.
-- Populating/loading these tables is not assigned to Phase 4; the ETL's
-- `etl.crosswalk` module already operates directly against the YAML file
-- and does not require these tables to run.

create table if not exists jurisdiction_crosswalk (
  id uuid primary key default gen_random_uuid(),
  pba_distrito_code text not null,
  national_distrito_code text not null,
  national_seccion_code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (pba_distrito_code)
);

alter table jurisdiction_crosswalk enable row level security;

-- Per-mesa cross-year presence. `stable_across_years` MUST NOT default to
-- true -- jurisdiction-model: "MUST NOT assume stability by default".
create table if not exists mesa_crosswalk (
  id uuid primary key default gen_random_uuid(),
  distrito_code text not null,
  seccion_code text not null,
  mesa_code integer not null,
  present_2023 boolean not null default false,
  present_2025 boolean not null default false,
  stable_across_years boolean not null,
  created_at timestamptz not null default now(),
  unique (distrito_code, seccion_code, mesa_code)
);

alter table mesa_crosswalk enable row level security;

-- Fiscalización mesa identity decision (Engram #1410): one row per curated
-- distrito/seccion scope where the identity hypothesis has been ACCEPTED.
-- `confidence` is deliberately free text, not a boolean -- it must always
-- read as `accepted-by-maintainer`, never `verified` (no per-mesa tally
-- verification underlies it) and never `same-id-only` (that value described
-- the pre-decision, unresolved state, since superseded).
create table if not exists fiscalizacion_mesa_identity (
  id uuid primary key default gen_random_uuid(),
  distrito_code text not null,
  seccion_code text not null,
  confidence text not null check (confidence = 'accepted-by-maintainer'),
  decided_by text not null,
  decision_ref text not null,
  evidence_note text not null,
  created_at timestamptz not null default now(),
  unique (distrito_code, seccion_code)
);

alter table fiscalizacion_mesa_identity enable row level security;
