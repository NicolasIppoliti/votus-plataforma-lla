begin;

-- Never remove a changed row or a row outside the four versioned tuples.
do $$
begin
  if (select count(*) from public.party_mapping where year=2023 and jurisdiction='coronel_rosales_municipal' and category='INTENDENTE') <> 4
     or (select count(*) from public.list_identity where year=2023 and jurisdiction='coronel_rosales_municipal' and category='INTENDENTE') <> 4
     or (select count(*) from public.party_mapping pm join (values
       ('20132','JXC'),('20134','UP'),('20135','LLA'),('20962','PRIMERO_ROSALES')
     ) expected(list_id,canonical_party_id) on pm.list_id=expected.list_id and pm.canonical_party_id=expected.canonical_party_id
       where pm.year=2023 and pm.jurisdiction='coronel_rosales_municipal' and pm.category='INTENDENTE'
         and pm.verified and pm.source='archive/national/2023-generales.zip -> 2023_Generales/ResultadoElectorales_2023_Generales.csv (02/027)') <> 4
     or (select count(*) from public.list_identity li join (values
       ('20132','JUNTOS POR EL CAMBIO'),('20134','UNION POR LA PATRIA'),
       ('20135','LA LIBERTAD AVANZA'),('20962','PRIMERO ROSALES')
     ) expected(list_id,source_name) on li.list_id=expected.list_id and li.source_name=expected.source_name
       where li.year=2023 and li.jurisdiction='coronel_rosales_municipal' and li.category='INTENDENTE') <> 4 then
    raise exception '2023 municipal identities changed; refusing scoped rollback';
  end if;
end $$;

delete from public.party_mapping
where year=2023 and jurisdiction='coronel_rosales_municipal' and category='INTENDENTE'
  and list_id in ('20132','20134','20135','20962');
delete from public.list_identity
where year=2023 and jurisdiction='coronel_rosales_municipal' and category='INTENDENTE'
  and list_id in ('20132','20134','20135','20962');
-- Canonical rows may predate this migration or be shared; retain all of them.
commit;
