begin;
create table public.projection_receipt (
 archive_entry_id text not null references public.archive_entry(id) on delete cascade,
 election_id uuid not null references public.election(id),
 source_kind text not null check (source_kind = 'official'),
 fingerprint text not null,
 projection jsonb not null,
 primary key (archive_entry_id, election_id, source_kind)
);
alter table public.projection_receipt enable row level security;
revoke all on public.projection_receipt from public;
-- Supabase installs default grants; plain PostgreSQL CI has no Supabase roles.
do $$ begin
 if to_regrole('anon') is not null then
  revoke all on public.projection_receipt from anon;
 end if;
 if to_regrole('authenticated') is not null then
  revoke all on public.projection_receipt from authenticated;
 end if;
 if to_regrole('service_role') is not null then
  revoke all on public.projection_receipt from service_role;
 end if;
end $$;
grant select, insert, update, delete on public.projection_receipt to etl_writer;
create policy etl_writer_projection_receipt on public.projection_receipt
 for all to etl_writer using (true) with check (true);
commit;
