grant select, insert, update, delete
on table public.category,
public.jurisdiction,
public.election,
public.archive_entry,
public.result_row
to service_role;

grant select, insert, delete
on table public.party_canonical,
public.party_mapping
to service_role;

grant insert (id, kind, severity, subject_ref, detected_at, note)
on table public.review_item
to service_role;

grant delete
on table public.review_item
to service_role;

grant select (id)
on table public.review_item
to service_role;
