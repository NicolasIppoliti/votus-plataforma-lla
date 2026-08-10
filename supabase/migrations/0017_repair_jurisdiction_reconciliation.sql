-- 0017_repair_jurisdiction_reconciliation.sql
-- Repair the immutable 0012 migration without rewriting applied history.
--
-- First, recover PBA provenance from result rows whose source label has the
-- registered ingestible id shape `pba/<year>-distrito-<digits>`. Migration 0012
-- translated the PBA distrito code to the national distrito but left seccion
-- NULL. Only those proven PBA rows are repointed to the full crosswalk pair;
-- unrelated rows at the same 02/NULL jurisdiction are never inferred as PBA.
-- Then normalize and merge every jurisdiction using the corrected Python zfill
-- semantics, preserving numeric codes wider than the minimum width.

begin;

lock table result_row in share row exclusive mode;
lock table jurisdiction in share row exclusive mode;
lock table jurisdiction_crosswalk in share mode;

do $$
declare
  before_count bigint;
  after_count bigint;
  pba_repointed_count bigint := 0;
  inserted_target_count bigint := 0;
  normalized_count bigint := 0;
  duplicate_group_count bigint := 0;
  removed_jurisdiction_count bigint := 0;
  general_removed_count bigint := 0;
begin
  -- 0012 creates `jurisdiction_canonical`, `jurisdiction_merge_target` and
  -- `jurisdiction_remap` WITHOUT `on commit drop`, so they are scoped to the
  -- SESSION rather than to 0012's transaction. An applier that opens a fresh
  -- connection per migration file (`etl.verify.apply_migrations`) never sees
  -- them again, but a single-session applier -- `supabase db push` keeps one
  -- connection for the whole run -- carries them past 0012's commit, and the
  -- identically named `create temporary table` statements below then fail
  -- with 42P07 on a cold 0001->0019 apply. 0012 is immutable applied history
  -- (pinned by `test_0012_matches_the_immutable_main_history`), so the repair
  -- belongs here, in the migration that already exists to repair 0012.
  --
  -- Qualified with `pg_temp` so this can only ever drop this session's own
  -- temporary leftovers, never a permanent table that shares a name.
  drop table if exists
    pg_temp.jurisdiction_canonical,
    pg_temp.jurisdiction_merge_target,
    pg_temp.jurisdiction_remap;

  select count(*) into before_count from result_row;

  create temporary table pba_provenance on commit drop as
  select
    rr.id as result_row_id,
    rr.jurisdiction_id as old_jurisdiction_id,
    rr.archive_entry_id,
    rr.election_id,
    rr.category_id,
    rr.list_id,
    rr.source_kind,
    substring(rr.archive_entry_id from '^pba/[0-9]{4}-distrito-([0-9]+)$') as pba_distrito_code,
    xw.national_distrito_code,
    xw.national_seccion_code
  from result_row rr
  left join jurisdiction_crosswalk xw
    on xw.pba_distrito_code =
       substring(rr.archive_entry_id from '^pba/[0-9]{4}-distrito-([0-9]+)$')
  where rr.archive_entry_id ~ '^pba/[0-9]{4}-distrito-[0-9]+$';

  if exists (
    select 1
    from pba_provenance
    where pba_distrito_code is null
       or national_distrito_code is null
       or national_seccion_code is null
  ) then
    raise exception
      'migration 0017: ambiguous PBA source-id/crosswalk mapping; every registered '
      'pba/<year>-distrito-<digits> result row must resolve to one exact national pair';
  end if;

  if exists (
    select 1
    from pba_provenance
    group by result_row_id
    having count(*) <> 1
  ) then
    raise exception
      'migration 0017: ambiguous PBA provenance produced more than one crosswalk '
      'mapping for a result row; refusing to pick a target';
  end if;

  -- An exact national-pair target may already exist. Because the jurisdiction
  -- unique constraint treats NULLs as distinct, explicitly reject duplicates
  -- rather than selecting one by id.
  if exists (
    select 1
    from (
      select distinct national_distrito_code, national_seccion_code
      from pba_provenance
    ) p
    join jurisdiction j
      on j.distrito_code = p.national_distrito_code
     and j.seccion_code = p.national_seccion_code
     and j.circuito_code is null
     and j.establecimiento_code is null
     and j.mesa_code is null
    group by p.national_distrito_code, p.national_seccion_code
    having count(*) > 1
  ) then
    raise exception
      'migration 0017: ambiguous exact PBA target jurisdiction; refusing to pick '
      'one of several identical national-pair rows';
  end if;

  if exists (
    select 1
    from pba_provenance p
    join jurisdiction_crosswalk xw
      on xw.pba_distrito_code = p.pba_distrito_code
    group by p.national_distrito_code, p.national_seccion_code
    having count(distinct xw.name) > 1
  ) then
    raise exception
      'migration 0017: PBA target metadata conflict; refusing to pick one '
      'descriptive name for a national jurisdiction pair';
  end if;

  insert into jurisdiction (distrito_code, seccion_code, seccion_name)
  select
    p.national_distrito_code,
    p.national_seccion_code,
    (
      select xw_name.name
      from pba_provenance named_p
      join jurisdiction_crosswalk xw_name
    on xw_name.pba_distrito_code = named_p.pba_distrito_code
      where named_p.national_distrito_code = p.national_distrito_code
    and named_p.national_seccion_code = p.national_seccion_code
    and xw_name.name is not null
      group by xw_name.name
    )
  from pba_provenance p
  where not exists (
    select 1
    from jurisdiction j
    where j.distrito_code = p.national_distrito_code
      and j.seccion_code = p.national_seccion_code
      and j.circuito_code is null
      and j.establecimiento_code is null
      and j.mesa_code is null
  )
  group by p.national_distrito_code, p.national_seccion_code;
  get diagnostics inserted_target_count = row_count;

  if exists (
    select 1
    from pba_provenance p
    join jurisdiction current_j on current_j.id = p.old_jurisdiction_id
    where not (
      current_j.distrito_code = p.national_distrito_code
      and current_j.seccion_code = p.national_seccion_code
      and current_j.circuito_code is null
      and current_j.establecimiento_code is null
      and current_j.mesa_code is null
    )
      and not (
        current_j.seccion_code is null
        and current_j.circuito_code is null
        and current_j.establecimiento_code is null
        and current_j.mesa_code is null
      )
  ) then
    raise exception
      'migration 0017: ambiguous PBA provenance points at a finer-than-distrito '
      'jurisdiction; refusing to discard observed lineage';
  end if;

  create temporary table pba_repoint on commit drop as
  select
    p.result_row_id,
    p.old_jurisdiction_id,
    target.id as target_jurisdiction_id,
    p.archive_entry_id,
    p.election_id,
    p.category_id,
    p.list_id,
    p.source_kind
  from pba_provenance p
  join jurisdiction current_j on current_j.id = p.old_jurisdiction_id
  join jurisdiction target
    on target.distrito_code = p.national_distrito_code
   and target.seccion_code = p.national_seccion_code
   and target.circuito_code is null
   and target.establecimiento_code is null
   and target.mesa_code is null
  where current_j.seccion_code is null
    and current_j.circuito_code is null
    and current_j.establecimiento_code is null
    and current_j.mesa_code is null
    and current_j.id <> target.id;

  -- Provenance collision checks use the complete result natural key. Never
  -- drop, aggregate, or pick one result row during a repoint.
  if exists (
    select 1
    from pba_repoint p
    group by p.target_jurisdiction_id, p.archive_entry_id, p.election_id,
      p.category_id, p.list_id, p.source_kind
    having count(*) > 1
  ) then
    raise exception
      'migration 0017: PBA repoint would collide source rows on '
      '(archive_entry_id, election_id, jurisdiction_id, category_id, list_id, source_kind)';
  end if;

  if exists (
    select 1
    from pba_repoint p
    join result_row existing
      on existing.jurisdiction_id = p.target_jurisdiction_id
     and existing.archive_entry_id = p.archive_entry_id
     and existing.election_id = p.election_id
     and existing.category_id = p.category_id
     and existing.list_id is not distinct from p.list_id
     and existing.source_kind = p.source_kind
     and existing.id <> p.result_row_id
  ) then
    raise exception
      'migration 0017: PBA repoint would collide with an existing result row on '
      '(archive_entry_id, election_id, jurisdiction_id, category_id, list_id, source_kind)';
  end if;

  update result_row rr
  set jurisdiction_id = p.target_jurisdiction_id
  from pba_repoint p
  where rr.id = p.result_row_id;
  get diagnostics pba_repointed_count = row_count;

  -- Delete an old wrong jurisdiction only when every result row has left it.
  delete from jurisdiction j
  where j.id in (select distinct old_jurisdiction_id from pba_repoint)
    and not exists (select 1 from result_row rr where rr.jurisdiction_id = j.id);
  get diagnostics removed_jurisdiction_count = row_count;

  -- General corrected normalization. Numeric text is stripped of leading zeroes
  -- and padded only when shorter than the minimum width, exactly like Python's
  -- `(raw.lstrip('0') or '0').zfill(width)`. Over-width codes are preserved.
  create temporary table jurisdiction_canonical on commit drop as
  select
    j.id,
    case
      when btrim(j.distrito_code, E' \t\n\r\f\v') ~ '^[0-9]+$' then
        case
          when length(canon_distrito.numeric_text) < 2
            then repeat('0', 2 - length(canon_distrito.numeric_text))
              || canon_distrito.numeric_text
          else canon_distrito.numeric_text
        end
      else j.distrito_code
    end as canonical_distrito,
    case
      when j.seccion_code is null then null
      when btrim(j.seccion_code, E' \t\n\r\f\v') ~ '^[0-9]+$' then
        case
          when length(canon_seccion.numeric_text) < 3
            then repeat('0', 3 - length(canon_seccion.numeric_text))
              || canon_seccion.numeric_text
          else canon_seccion.numeric_text
        end
      else j.seccion_code
    end as canonical_seccion,
    case
      when j.circuito_code is null then null
      when btrim(j.circuito_code, E' \t\n\r\f\v') ~ '^[0-9]+$' then
        case
          when length(canon_circuito.numeric_text) < 5
            then repeat('0', 5 - length(canon_circuito.numeric_text))
              || canon_circuito.numeric_text
          else canon_circuito.numeric_text
        end
      when btrim(j.circuito_code, E' \t\n\r\f\v') ~ '^[0-9]+[A-Za-z]$' then
        (
          case
            when length(canon_circuito_suffix.numeric_text) < 4
              then repeat('0', 4 - length(canon_circuito_suffix.numeric_text))
                || canon_circuito_suffix.numeric_text
            else canon_circuito_suffix.numeric_text
          end
        ) || upper(right(btrim(j.circuito_code, E' \t\n\r\f\v'), 1))
      else j.circuito_code
    end as canonical_circuito,
    j.establecimiento_code,
    j.mesa_code,
    j.distrito_name,
    j.seccion_name,
    j.circuito_name,
    j.establecimiento_name
  from jurisdiction j
  cross join lateral (
        select coalesce(
          nullif(ltrim(btrim(j.distrito_code, E' \t\n\r\f\v'), '0'), ''),
          '0'
        ) as numeric_text
  ) canon_distrito
  cross join lateral (
        select coalesce(
          nullif(ltrim(btrim(j.seccion_code, E' \t\n\r\f\v'), '0'), ''),
          '0'
        ) as numeric_text
  ) canon_seccion
  cross join lateral (
        select coalesce(
          nullif(ltrim(btrim(j.circuito_code, E' \t\n\r\f\v'), '0'), ''),
          '0'
        ) as numeric_text
  ) canon_circuito
  cross join lateral (
    select coalesce(
          nullif(
            ltrim(left(btrim(j.circuito_code, E' \t\n\r\f\v'), -1), '0'),
            ''
          ),
      '0'
    ) as numeric_text
  ) canon_circuito_suffix;

  alter table jurisdiction_canonical add column merge_key text;
  update jurisdiction_canonical
  set merge_key = jsonb_build_array(
    canonical_distrito,
    canonical_seccion,
    canonical_circuito,
    establecimiento_code,
    mesa_code
  )::text;
  create index on jurisdiction_canonical (merge_key);

      -- Descriptive labels are facts, not values this repair may resolve by
      -- ordering. Reject every contradictory merge group before constructing a
      -- remap; NULL plus one observed label is safe, but two observed labels are
      -- an actionable metadata conflict.
      if exists (
        select 1
        from jurisdiction_canonical
        group by merge_key
        having count(distinct distrito_name) > 1
           or count(distinct seccion_name) > 1
           or count(distinct circuito_name) > 1
           or count(distinct establecimiento_name) > 1
      ) then
        raise exception
          'migration 0017: jurisdiction metadata conflict within a normalized merge '
          'group; refusing to pick one descriptive name';
      end if;

      create temporary table jurisdiction_merge_target on commit drop as
      select
        groups.merge_key,
        groups.canonical_id,
        groups.member_count,
        (
          select names.distrito_name
          from jurisdiction_canonical names
          where names.merge_key = groups.merge_key
            and names.distrito_name is not null
          group by names.distrito_name
        ) as distrito_name,
        (
          select names.seccion_name
          from jurisdiction_canonical names
          where names.merge_key = groups.merge_key
            and names.seccion_name is not null
          group by names.seccion_name
        ) as seccion_name,
        (
          select names.circuito_name
          from jurisdiction_canonical names
          where names.merge_key = groups.merge_key
            and names.circuito_name is not null
          group by names.circuito_name
        ) as circuito_name,
        (
          select names.establecimiento_name
          from jurisdiction_canonical names
          where names.merge_key = groups.merge_key
            and names.establecimiento_name is not null
          group by names.establecimiento_name
        ) as establecimiento_name
      from (
        select
          merge_key,
          min(id::text)::uuid as canonical_id,
          count(*) as member_count
        from jurisdiction_canonical
        group by merge_key
      ) groups;

  select count(*) into duplicate_group_count
  from jurisdiction_merge_target
  where member_count > 1;

  create temporary table jurisdiction_remap on commit drop as
  select jc.id as old_id, target.canonical_id
  from jurisdiction_canonical jc
  join jurisdiction_merge_target target using (merge_key)
  where jc.id <> target.canonical_id;

  -- General collision checks also include election_id in both collision forms.
  if exists (
    select 1
    from result_row rr
    join jurisdiction_remap remap on remap.old_id = rr.jurisdiction_id
    group by remap.canonical_id, rr.archive_entry_id, rr.election_id,
      rr.category_id, rr.list_id, rr.source_kind
    having count(*) > 1
  ) then
    raise exception
      'migration 0017: normalized merge would collide source rows on '
      '(archive_entry_id, election_id, jurisdiction_id, category_id, list_id, source_kind)';
  end if;

  if exists (
    select 1
    from result_row duplicate_rr
    join jurisdiction_remap remap on remap.old_id = duplicate_rr.jurisdiction_id
    join result_row existing_rr
      on existing_rr.jurisdiction_id = remap.canonical_id
     and existing_rr.archive_entry_id = duplicate_rr.archive_entry_id
     and existing_rr.election_id = duplicate_rr.election_id
     and existing_rr.category_id = duplicate_rr.category_id
     and existing_rr.list_id is not distinct from duplicate_rr.list_id
     and existing_rr.source_kind = duplicate_rr.source_kind
  ) then
    raise exception
      'migration 0017: normalized merge would collide with an existing result row on '
      '(archive_entry_id, election_id, jurisdiction_id, category_id, list_id, source_kind)';
  end if;

  update result_row rr
  set jurisdiction_id = remap.canonical_id
  from jurisdiction_remap remap
  where rr.jurisdiction_id = remap.old_id;

  -- Remove the merged-away duplicates BEFORE canonicalizing the survivors.
  -- The survivor is `min(id::text)`, which is arbitrary and not necessarily
  -- the member that already holds the canonical tuple. When it is not, the
  -- update below rewrites the survivor into a tuple another group member
  -- still occupies, and the non-deferrable `unique (distrito_code,
  -- seccion_code, circuito_code, establecimiento_code, mesa_code)` from 0001
  -- aborts the whole migration with 23505. NULLs count as distinct there, so
  -- this only bites when `establecimiento_code` and `mesa_code` are both
  -- present -- every mesa-level jurisdiction. Every result row was repointed
  -- onto the survivor immediately above, so the guard below still refuses to
  -- delete any jurisdiction something still references.
  delete from jurisdiction j
  where j.id in (select old_id from jurisdiction_remap)
    and not exists (select 1 from result_row rr where rr.jurisdiction_id = j.id);
  get diagnostics general_removed_count = row_count;
  removed_jurisdiction_count := removed_jurisdiction_count + general_removed_count;

  update jurisdiction j
  set distrito_code = canonical.canonical_distrito,
      seccion_code = canonical.canonical_seccion,
      circuito_code = canonical.canonical_circuito,
      distrito_name = target.distrito_name,
      seccion_name = target.seccion_name,
      circuito_name = target.circuito_name,
      establecimiento_name = target.establecimiento_name
  from jurisdiction_canonical canonical
  join jurisdiction_merge_target target
    on target.canonical_id = canonical.id
  where j.id = canonical.id
    and not exists (select 1 from jurisdiction_remap remap where remap.old_id = j.id)
    and (
      j.distrito_code is distinct from canonical.canonical_distrito
      or j.seccion_code is distinct from canonical.canonical_seccion
      or j.circuito_code is distinct from canonical.canonical_circuito
      or j.distrito_name is distinct from target.distrito_name
      or j.seccion_name is distinct from target.seccion_name
      or j.circuito_name is distinct from target.circuito_name
      or j.establecimiento_name is distinct from target.establecimiento_name
    );
  get diagnostics normalized_count = row_count;

  select count(*) into after_count from result_row;
  if before_count <> after_count then
    raise exception
      'migration 0017: result_row count changed from % to %; refusing data loss '
      'or duplication', before_count, after_count;
  end if;

  raise notice
    'migration 0017: repointed % proven PBA result row(s), inserted % exact target(s), '
    'normalized % surviving jurisdiction row(s), merged % duplicate group(s), removed % '
    'empty jurisdiction row(s), result_row count unchanged at %',
    pba_repointed_count,
    inserted_target_count,
    normalized_count,
    duplicate_group_count,
    removed_jurisdiction_count,
    after_count;
end $$;

commit;
