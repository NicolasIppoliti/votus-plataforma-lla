begin;
select plan(10);
insert into public.election(id,year,round) values('40800000-0000-4000-8000-000000000001',2088,'paso');
insert into public.category(id,name) values('40800000-0000-4000-8000-000000000002','VOTE KIND TEST');
insert into public.jurisdiction(id,distrito_code,seccion_code,circuito_code,mesa_code)
 values('40800000-0000-4000-8000-000000000003','98','988','00001',1);
insert into public.result_row(election_id,category_id,jurisdiction_id,granularity,list_id,votes,source_kind,archive_entry_id,source_row_index,vote_kind)
 select '40800000-0000-4000-8000-000000000001','40800000-0000-4000-8000-000000000002',
 '40800000-0000-4000-8000-000000000003','mesa',null,n,'official','national/2088-paso',n,kind
 from (values ('EN BLANCO',0),('NULO',2),('IMPUGNADO',3),('RECURRIDO',4),('COMANDO',5)) v(kind,n);
select is((select count(*) from public.result_row where archive_entry_id='national/2088-paso'),5::bigint,'five party-less kinds coexist, including measured zero');
select throws_ok($q$insert into public.result_row(election_id,category_id,jurisdiction_id,granularity,list_id,votes,archive_entry_id,source_row_index,vote_kind)
 values('40800000-0000-4000-8000-000000000001','40800000-0000-4000-8000-000000000002','40800000-0000-4000-8000-000000000003','mesa',null,7,'national/2088-paso',9,'NULO')$q$,
 '23505',null,'NULL list natural key rejects duplicate kind');
select throws_ok($q$update public.result_row set list_id='party' where archive_entry_id='national/2088-paso'$q$,'23514',null,'non-positive evidence cannot acquire a party');
select throws_ok($q$update public.result_row set source_kind='fiscalizacion' where archive_entry_id='national/2088-paso'$q$,'23514',null,'national non-positive evidence cannot leak across source kinds');
select throws_ok($q$update public.result_row set vote_kind='UNKNOWN' where archive_entry_id='national/2088-paso'$q$,'23514',null,'unknown kinds cannot persist');
insert into public.result_row(election_id,category_id,jurisdiction_id,granularity,list_id,votes,archive_entry_id,source_row_index)
 values('40800000-0000-4000-8000-000000000001','40800000-0000-4000-8000-000000000002','40800000-0000-4000-8000-000000000003','mesa','party',20,'national/2088-paso',10);
select is((select vote_kind from public.result_row where archive_entry_id='national/2088-paso' and list_id='party'),'POSITIVO','legacy writers default to positive');
select is((select sum(votes) from public.result_row where archive_entry_id='national/2088-paso' and vote_kind='POSITIVO'),20::bigint,'positive total remains separate');
select ok((select bool_and(prosrc like '%vote_kind = ''POSITIVO''%') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where p.prokind='f' and ((n.nspname='public' and p.proname like 'results_exploration_%') or n.nspname='workspace_api') and p.prosrc ~* '(from|join)\s+(public\.)?result_row\M'),'all existing result read functions explicitly filter positives');
create temporary table receipt_before as select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h
 from public.result_row t where archive_entry_id='national/2088-paso' and vote_kind='COMANDO';
-- Mutate only the discriminator; row count, votes and all other fields remain unchanged.
update public.result_row set vote_kind='POSITIVO' where archive_entry_id='national/2088-paso' and vote_kind='COMANDO';
select isnt((select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') from public.result_row t
 where archive_entry_id='national/2088-paso' and list_id is null and vote_kind='POSITIVO'),
 (select h from receipt_before),'full-row receipt hash changes when only vote kind changes');
select ok((select prosrc like '%jsonb_object_agg(vote_kind,votes)%' from pg_proc where oid='workspace_api.official_internal_lists(uuid,uuid,text,text)'::regprocedure),'authorized Internas entrypoint reaches separated kind totals');
select * from finish();
rollback;
