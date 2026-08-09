-- 0018_merge_fiscalizacion_mesas_into_official.sql
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
    'mesa_absent_from_official_import',
    'unreadable_vote_cell'
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

      -- Start from jurisdictions that are PROVEN to carry fiscalización rows.
      -- Match destinations only when an OFFICIAL result exists for the SAME
      -- election. Circuito shape alone proves neither source ownership nor the
      -- election whose result is being reconciled.
      create temporary table fiscalizacion_mesa_match on commit drop as
      select
        f.id as fiscalizacion_id,
        fr.archive_entry_id,
        fr.election_id,
        f.distrito_code,
        f.seccion_code,
        f.mesa_code,
        fr.archive_entry_id || ' ' || e.year::text || '-' || e.round || ' '
          || f.distrito_code || '-' || coalesce(f.seccion_code, '(sin seccion)')
          || '-mesa-' || f.mesa_code as subject_ref,
        array_remove(array_agg(distinct case when orr.id is not null then o.id end), null)
          as official_ids,
        array_agg(distinct o.circuito_code order by o.circuito_code)
          filter (where orr.id is not null and o.circuito_code is not null) as circuitos
      from jurisdiction f
      join result_row fr
        on fr.jurisdiction_id = f.id
       and fr.source_kind = 'fiscalizacion'
      join election e on e.id = fr.election_id
      left join jurisdiction o
        on o.distrito_code = f.distrito_code
       and o.seccion_code is not distinct from f.seccion_code
       and o.mesa_code = f.mesa_code
       and o.circuito_code is not null
      left join result_row orr
        on orr.jurisdiction_id = o.id
       and orr.source_kind = 'official'
       and orr.election_id = fr.election_id
      where f.circuito_code is null
        and f.mesa_code is not null
      group by f.id, fr.archive_entry_id, fr.election_id,
        e.year, e.round, f.distrito_code, f.seccion_code, f.mesa_code;

      -- UNAMBIGUOUS only within one election: exactly one official jurisdiction
      -- is backed by an official result for that election. One source mesa can
      -- produce several review identities, but it is moved only once.
      create temporary table fiscalizacion_mesa_remap on commit drop as
      select distinct fiscalizacion_id, election_id, official_ids[1] as official_id, mesa_code
      from fiscalizacion_mesa_match
      where coalesce(array_length(official_ids, 1), 0) = 1;

      select count(*) into merged_count from fiscalizacion_mesa_remap;
      select count(*) into ambiguous_count
      from fiscalizacion_mesa_match
      where coalesce(array_length(official_ids, 1), 0) > 1;
      select count(*) into absent_count
      from fiscalizacion_mesa_match
      where coalesce(array_length(official_ids, 1), 0) = 0;

      -- Refuse either collision shape before moving a row. The migration must
      -- preserve every result_row, never rely on a uniqueness error halfway
      -- through the update or silently discard one side.
      if exists (
        select 1
        from result_row r
        join fiscalizacion_mesa_remap m
          on m.fiscalizacion_id = r.jurisdiction_id
         and m.election_id = r.election_id
        where r.source_kind = 'fiscalizacion'
        group by m.official_id, r.archive_entry_id, r.election_id,
          r.category_id, r.list_id, r.source_kind
        having count(*) > 1
      ) then
        raise exception
          'migration 0018: same-election fiscalización remap would collide two '
          'result_row natural keys -- aborting without changing row counts';
      end if;

      if exists (
        select 1
        from result_row r
        join fiscalizacion_mesa_remap m
          on m.fiscalizacion_id = r.jurisdiction_id
         and m.election_id = r.election_id
        join result_row existing
          on existing.jurisdiction_id = m.official_id
         and existing.archive_entry_id = r.archive_entry_id
         and existing.election_id = r.election_id
         and existing.category_id = r.category_id
         and existing.list_id is not distinct from r.list_id
         and existing.source_kind = r.source_kind
        where r.source_kind = 'fiscalizacion'
      ) then
        raise exception
          'migration 0018: same-election destination already carries the '
          'fiscalización natural key -- aborting without changing row counts';
      end if;

      -- Move only fiscalización rows for the election that established the match.
      update result_row r
      set jurisdiction_id = m.official_id
      from fiscalizacion_mesa_remap m
      where r.jurisdiction_id = m.fiscalizacion_id
        and r.election_id = m.election_id
        and r.source_kind = 'fiscalizacion';

  -- NO `review_item` remap: nothing in this codebase writes a bare
  -- jurisdiction uuid into `subject_ref`. The loader writes the mesa lineage,
  -- `ingest_source` prefixes it with source+election, and this migration's own
  -- inserts use the lineage too — so a uuid-keyed update matches zero rows by
  -- construction, and dead code guarding an orphan that cannot exist reads as
  -- protection that is not there.

      -- A source jurisdiction may carry another election that was ambiguous or
      -- absent. Delete it only after every linked row has been safely repointed.
      delete from jurisdiction j
      where j.id in (select fiscalizacion_id from fiscalizacion_mesa_remap)
        and not exists (
          select 1 from result_row remaining where remaining.jurisdiction_id = j.id
        );

  -- The ambiguous ones REMAIN, and say why. A mesa left in place with no
  -- record of why is the silent drop this project refuses.
  insert into review_item (kind, severity, subject_ref, note)
  select
    'ambiguous_mesa_circuito',
    'warning',
    -- Exact runtime shape: source archive, election, normalized mesa lineage.
    m.subject_ref,
    'mesa ' || m.mesa_code || ' exists in ' || array_length(m.official_ids, 1)
      || ' circuitos (' || array_to_string(m.circuitos, ', ') || '), so the mesa '
      || 'number does not identify it; a fiscalización tally cannot be '
      || 'attributed to one of them without guessing'
  from fiscalizacion_mesa_match m
  where coalesce(array_length(m.official_ids, 1), 0) > 1
    and not exists (
      select 1 from review_item existing
      where existing.kind = 'ambiguous_mesa_circuito'
        and existing.subject_ref = m.subject_ref
        and existing.resolved_at is null
    );

  -- The THIRD outcome, recorded rather than left silent.
  insert into review_item (kind, severity, subject_ref, note)
  select
    'mesa_absent_from_official_import',
    'warning',
    m.subject_ref,
    'mesa ' || m.mesa_code || ' carries fiscalización rows but the official '
      || 'import has no jurisdiction for it in distrito ' || m.distrito_code
      || ' seccion ' || coalesce(m.seccion_code, '(sin seccion)')
      || ', so it cannot be placed without inventing one'
  from fiscalizacion_mesa_match m
  where coalesce(array_length(m.official_ids, 1), 0) = 0
    and not exists (
      select 1 from review_item existing
      where existing.kind = 'mesa_absent_from_official_import'
        and existing.subject_ref = m.subject_ref
        and existing.resolved_at is null
    );

  select count(*) into after_rows from result_row;
  if before_rows <> after_rows then
    raise exception
      'migration 0018: result_row count changed from % to % -- aborting, this '
      'migration repoints rows and must never lose or duplicate one',
      before_rows, after_rows;
  end if;

  raise notice
    'migration 0018: merged % fiscalización mesa(s) onto their official '
    'jurisdiction, left % ambiguous and % absent-from-official mesa(s) in '
    'place with a review_item, result_row count unchanged at %',
    merged_count, ambiguous_count, absent_count, after_rows;
end $$;

commit;
