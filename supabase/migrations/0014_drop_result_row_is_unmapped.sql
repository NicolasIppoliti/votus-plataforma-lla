-- 0014_drop_result_row_is_unmapped.sql
-- Drop a column that was written by three loaders, read by nobody, and
-- false for every row that exists.
--
-- Measured live before this migration:
--
--   is_unmapped | rows
--   ------------|-----------
--   false       | 18.170.843
--   true        |          0
--
-- Not because every list id resolves -- most national agrupación ids have no
-- curated `party_map.yaml` entry -- but because `load_national_rows`,
-- `load_pba_rows` and `load_fiscalizacion_rows` each hardcoded
-- `is_unmapped=False`. The functions that would have computed it truthfully
-- (`ingest.national.resolve_national_party`, `ingest.pba.resolve_pba_party`)
-- were correct, tested, and had no production caller. So the column asserted
-- "every one of these 18 million list ids is mapped", which is false.
--
-- The fix is not to start writing it. Whether a list id resolves is a fact
-- about `curated/party_map.yaml`, and that file is curated AFTER a corpus is
-- loaded: the day someone adds the missing 22xx municipal entry, a boolean
-- frozen at ingestion time becomes a stale lie, while the join the web layer
-- already performs (`repository.ts`'s `unmappedByListId`, keyed on a null
-- `canonicalPartyId` from `party_mapping`) simply becomes correct. One fact,
-- one source. No web query reads this column, and no index or view depends
-- on it -- both verified against the live database before writing this.

begin;

alter table result_row drop column if exists is_unmapped;

commit;
