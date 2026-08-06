-- 0013_merge_fiscalizacion_mesas_into_official.sql
-- The second half of 0012. That migration reconciled the FORMAT of the
-- administrative codes ("2"/"27" vs "02"/"027"); this one reconciles what was
-- still splitting the same physical mesa in two afterwards: the circuito.
--
-- `etl.ingest.fiscalizacion.load_fiscalizacion_rows` upserted
-- `(distrito, seccion, mesa)` with NO circuito, while the national import
-- writes `(distrito, seccion, circuito, mesa)`. Postgres treats NULL as never
-- equal to NULL in the unique key, so the fiscalización mesa became a SECOND
-- jurisdiction identity for a mesa that already existed, joined to the first
-- by nothing.
--
-- Measured live before this migration, in distrito 02 / seccion 027:
--
--   shape             | jurisdictions
--   ------------------|--------------
--   with circuito     | 168   (official import)
--   without circuito  |  94   (fiscalización import)
--
-- and 93 mesa numbers exist in BOTH shapes -- exactly the fiscalización
-- coverage numerator. The consequence is visible on `/drilldown`: no mesa
-- carries both an official and a fiscalización row under one id, so
-- `/fiscalizacion` can never juxtapose the two source kinds it exists to
-- contrast.
--
-- WHAT THIS MIGRATION WILL NOT DO: a mesa NUMBER does not identify a mesa.
-- Within one partido the same number appears under more than one circuito
-- (8 of the 93). Picking one would attribute a fiscal's tally to a mesa nobody
-- established -- the fabrication this pipeline refuses everywhere else -- so
-- those are left untouched and recorded in `review_item` for a human to
-- resolve against the source. The loader now refuses them at ingestion time
-- for the same reason.

begin;

-- Two new REASONS, so they must be two new kinds: the check constraint is what
-- stops a typo becoming an unqueryable bucket. `ambiguous_mesa_circuito` is
-- recorded by this migration and by the loader; `mesa_absent_from_official_import`
-- only by the loader, for a mesa the official import does not carry at all.
alter table review_item drop constraint review_item_kind_check;
alter table review_item add constraint review_item_kind_check check (
  kind = any (array[
    'content_drift',
    'fetch_failure',
    'unmapped_party',
    'unmapped_jurisdiction',
    'mesa_discontinuity',
    'source_reexported',
    'duplicate_collapsed',
    'duplicate_conflict',
    'unmergeable_row',
    'blank_vote_cell',
    'mesa_tally_divergence',
    'ambiguous_mesa_circuito',
    'mesa_absent_from_official_import'
  ])
);

do $$
declare
  before_rows bigint;
  after_rows bigint;
  merged_count bigint;
  ambiguous_count bigint;
  absent_count bigint;
begin
  select count(*) into before_rows from result_row;

  -- Every circuito-less mesa jurisdiction, with the official rows that share
  -- its (distrito, seccion, mesa). `array_agg` keeps the ambiguous ones
  -- visible instead of silently taking the first.
  -- LEFT JOIN, not an inner one: a mesa the official import does not carry at
  -- all is a third outcome, and an inner join would have left it in place with
  -- no record of why — the silent drop this migration exists to end.
  create temporary table fiscalizacion_mesa_match on commit drop as
  select
    f.id                              as fiscalizacion_id,
    f.distrito_code,
    f.seccion_code,
    f.mesa_code,
    -- THE subject_ref, computed once. Two inserts and two dedups each built
    -- this string, and the moment one was corrected the others were not: a
    -- hardcoded `02-027` stamped Coronel Rosales's lineage onto a mesa from any
    -- other distrito, and the dedup keyed on a different expression than the
    -- insert wrote — so outside 02/027 it appended a duplicate on every run.
    --
    -- `coalesce` because the seccion is NULLABLE and the join admits it:
    -- concatenating a NULL yields a NULL `subject_ref`, which `review_item`
    -- rejects as `not null` and would abort this migration mid-transaction.
    f.distrito_code || '-' || coalesce(f.seccion_code, '(sin seccion)')
      || '-mesa-' || f.mesa_code    as subject_lineage,
    array_remove(array_agg(o.id order by o.circuito_code), null)            as official_ids,
    array_remove(array_agg(o.circuito_code order by o.circuito_code), null) as circuitos
  from jurisdiction f
  left join jurisdiction o
    on o.distrito_code = f.distrito_code
   and o.seccion_code is not distinct from f.seccion_code
   and o.mesa_code = f.mesa_code
   and o.circuito_code is not null
  where f.circuito_code is null
    and f.mesa_code is not null
  group by f.id, f.distrito_code, f.seccion_code, f.mesa_code;

  -- UNAMBIGUOUS only: exactly one official circuito carries this mesa number.
  create temporary table fiscalizacion_mesa_remap on commit drop as
  select fiscalizacion_id, official_ids[1] as official_id, mesa_code
  from fiscalizacion_mesa_match
  where coalesce(array_length(official_ids, 1), 0) = 1;

  select count(*) into merged_count from fiscalizacion_mesa_remap;
  select count(*) into ambiguous_count
  from fiscalizacion_mesa_match
  where coalesce(array_length(official_ids, 1), 0) > 1;
  select count(*) into absent_count
  from fiscalizacion_mesa_match
  where coalesce(array_length(official_ids, 1), 0) = 0;

  -- Move the rows onto the official identity.
  update result_row r
  set jurisdiction_id = m.official_id
  from fiscalizacion_mesa_remap m
  where r.jurisdiction_id = m.fiscalizacion_id;

  -- NO `review_item` remap: nothing in this codebase writes a bare
  -- jurisdiction uuid into `subject_ref`. The loader writes the mesa lineage,
  -- `ingest_source` prefixes it with source+election, and this migration's own
  -- inserts use the lineage too — so a uuid-keyed update matches zero rows by
  -- construction, and dead code guarding an orphan that cannot exist reads as
  -- protection that is not there.

  delete from jurisdiction
  where id in (select fiscalizacion_id from fiscalizacion_mesa_remap);

  -- The ambiguous ones REMAIN, and say why. A mesa left in place with no
  -- record of why is the silent drop this project refuses.
  insert into review_item (kind, severity, subject_ref, note)
  select
    'ambiguous_mesa_circuito',
    'warning',
    -- The shared lineage, same shape the loader records
    -- (`etl.ingest.fiscalizacion._resolve_official_mesa`).
    m.subject_lineage,
    'mesa ' || m.mesa_code || ' exists in ' || array_length(m.official_ids, 1)
      || ' circuitos (' || array_to_string(m.circuitos, ', ') || '), so the mesa '
      || 'number does not identify it; its fiscalización rows keep a separate '
      || 'jurisdiction identity until a human resolves the circuito against the source'
  from fiscalizacion_mesa_match m
  where coalesce(array_length(m.official_ids, 1), 0) > 1
    and not exists (
      select 1 from review_item existing
      where existing.kind = 'ambiguous_mesa_circuito'
        -- ANCHORED, and not a `like`. Two separate defects lived here:
        -- `_`/`%` are LIKE wildcards and `subject_lineage` is built from plain
        -- text columns with no guard (`__main__.py` documents that footgun and
        -- switched away from LIKE for it); and a bare SUFFIX match let lineage
        -- `2-027-mesa-5` match an existing `... 12-027-mesa-5`, discarding a
        -- genuinely new observation for distrito 02 as "already present".
        --
        -- `ingest_source` prefixes the lineage with "{source} {year}-{round} ",
        -- so the only legitimate forms are the bare lineage or one preceded by
        -- a space. Both are matched exactly.
        and (
          existing.subject_ref = m.subject_lineage
          or right(existing.subject_ref, length(m.subject_lineage) + 1)
             = ' ' || m.subject_lineage
        )
    );

  -- The THIRD outcome, recorded rather than left silent.
  insert into review_item (kind, severity, subject_ref, note)
  select
    'mesa_absent_from_official_import',
    'warning',
    m.subject_lineage,
    'mesa ' || m.mesa_code || ' carries fiscalización rows but the official '
      || 'import has no jurisdiction for it, so it cannot be placed without '
      || 'inventing one'
  from fiscalizacion_mesa_match m
  where coalesce(array_length(m.official_ids, 1), 0) = 0
    and not exists (
      select 1 from review_item existing
      where existing.kind = 'mesa_absent_from_official_import'
        -- ANCHORED, and not a `like`. Two separate defects lived here:
        -- `_`/`%` are LIKE wildcards and `subject_lineage` is built from plain
        -- text columns with no guard (`__main__.py` documents that footgun and
        -- switched away from LIKE for it); and a bare SUFFIX match let lineage
        -- `2-027-mesa-5` match an existing `... 12-027-mesa-5`, discarding a
        -- genuinely new observation for distrito 02 as "already present".
        --
        -- `ingest_source` prefixes the lineage with "{source} {year}-{round} ",
        -- so the only legitimate forms are the bare lineage or one preceded by
        -- a space. Both are matched exactly.
        and (
          existing.subject_ref = m.subject_lineage
          or right(existing.subject_ref, length(m.subject_lineage) + 1)
             = ' ' || m.subject_lineage
        )
    );

  select count(*) into after_rows from result_row;
  if before_rows <> after_rows then
    raise exception
      'migration 0013: result_row count changed from % to % -- aborting, this '
      'migration repoints rows and must never lose or duplicate one',
      before_rows, after_rows;
  end if;

  raise notice
    'migration 0013: merged % fiscalización mesa(s) onto their official '
    'jurisdiction, left % ambiguous and % absent-from-official mesa(s) in '
    'place with a review_item, result_row count unchanged at %',
    merged_count, ambiguous_count, absent_count, after_rows;
end $$;

commit;
