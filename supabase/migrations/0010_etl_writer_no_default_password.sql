-- 0010_etl_writer_no_default_password.sql
-- access-control / 14a: 0009_etl_write_grants.sql created `etl_writer`
-- with a literal, publicly-known password (`etl_writer_local_dev_only`)
-- baked into the migration itself. `if not exists` only protects an
-- environment that had ALREADY provisioned the role before 0009 ran -- a
-- FRESH deploy applying migrations 0001-0010 in order still creates a
-- login-capable, `bypassrls` role with a usable, public credential, and
-- rotating it away was only ever a documented "MUST" comment, never
-- enforced by anything.
--
-- This migration clears whatever password `etl_writer` currently has, so
-- a fresh end-to-end migration run never leaves a usable secret behind.
-- `alter role ... password null` puts the role back to Postgres's normal
-- "no password set" state (`pg_authid.rolpassword is null`) -- password
-- authentication methods (`md5`/`scram-sha-256`) always reject every
-- password against a `null` hash, so the role stays LOGIN-capable (other
-- authentication methods, e.g. peer/cert, are unaffected) but cannot
-- authenticate with any password until a deployment explicitly sets one
-- out of band (`alter role etl_writer with password '...'`).
--
-- Guarded the same way 0009 guards role creation: only acts if
-- `etl_writer` already exists. An environment that has not run 0009 yet,
-- or that never provisions the role through this migration chain at all,
-- is untouched.
do $$
begin
  if exists (select from pg_roles where rolname = 'etl_writer') then
    alter role etl_writer password null;
  end if;
end $$;
