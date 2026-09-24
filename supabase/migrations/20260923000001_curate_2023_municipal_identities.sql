begin;

-- The four keys are the checksum-verified DINE generales INTENDENTE lists at 02/027.
-- Reject even matching pre-existing scoped rows: rollback must never claim ownership
-- of identities inserted by another writer.
do $$
begin
  if exists (select 1 from public.party_mapping where year=2023 and jurisdiction='coronel_rosales_municipal' and category='INTENDENTE')
     or exists (select 1 from public.list_identity where year=2023 and jurisdiction='coronel_rosales_municipal' and category='INTENDENTE') then
    raise exception '2023 municipal INTENDENTE identities already exist; refusing to overwrite or adopt';
  end if;
  if exists (
    select 1 from (values
      ('JXC','JUNTOS POR EL CAMBIO'),
      ('UP','UNION POR LA PATRIA'),
      ('LLA','LA LIBERTAD AVANZA'),
      ('PRIMERO_ROSALES','AGRUPACION MUNICIPAL PRIMERO ROSALES')
    ) expected(id, display_name)
    join public.party_canonical existing on existing.id=expected.id
    where existing.display_name is distinct from expected.display_name
  ) then
    raise exception '2023 municipal canonical display-name conflict';
  end if;
end $$;

insert into public.party_canonical(id,display_name)
select expected.id,expected.display_name from (values
  ('JXC','JUNTOS POR EL CAMBIO'),
  ('UP','UNION POR LA PATRIA'),
  ('LLA','LA LIBERTAD AVANZA'),
  ('PRIMERO_ROSALES','AGRUPACION MUNICIPAL PRIMERO ROSALES')
) expected(id,display_name)
where not exists (select 1 from public.party_canonical c where c.id=expected.id);

insert into public.list_identity(year,jurisdiction,category,list_id,source_name)
values
  (2023,'coronel_rosales_municipal','INTENDENTE','20132','JUNTOS POR EL CAMBIO'),
  (2023,'coronel_rosales_municipal','INTENDENTE','20134','UNION POR LA PATRIA'),
  (2023,'coronel_rosales_municipal','INTENDENTE','20135','LA LIBERTAD AVANZA'),
  (2023,'coronel_rosales_municipal','INTENDENTE','20962','PRIMERO ROSALES');

insert into public.party_mapping(year,jurisdiction,category,list_id,canonical_party_id,verified,source)
values
  (2023,'coronel_rosales_municipal','INTENDENTE','20132','JXC',true,'archive/national/2023-generales.zip -> 2023_Generales/ResultadoElectorales_2023_Generales.csv (02/027)'),
  (2023,'coronel_rosales_municipal','INTENDENTE','20134','UP',true,'archive/national/2023-generales.zip -> 2023_Generales/ResultadoElectorales_2023_Generales.csv (02/027)'),
  (2023,'coronel_rosales_municipal','INTENDENTE','20135','LLA',true,'archive/national/2023-generales.zip -> 2023_Generales/ResultadoElectorales_2023_Generales.csv (02/027)'),
  (2023,'coronel_rosales_municipal','INTENDENTE','20962','PRIMERO_ROSALES',true,'archive/national/2023-generales.zip -> 2023_Generales/ResultadoElectorales_2023_Generales.csv (02/027)');

commit;
