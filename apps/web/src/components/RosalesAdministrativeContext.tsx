import { formatFacetOptionLabel, type FacetOption } from "@/lib/results/exploration";

// These routes have a fixed national-scheme scope, not a PBA distrito identity.
const distrito: FacetOption = { code: "02", name: "Buenos Aires", nameStatus: "present", nameVariantCount: 1 };
const seccion: FacetOption = { code: "027", name: "Coronel Rosales", nameStatus: "present", nameVariantCount: 1 };

export function RosalesTerritoryName() {
  return <>{formatFacetOptionLabel(seccion, false)} · {formatFacetOptionLabel(distrito, false)}</>;
}

export function RosalesAdministrativeDetails() {
  return <details><summary>Códigos administrativos</summary><p>Esquema nacional: <code>Distrito {distrito.code} · Sección {seccion.code}</code>. Distrito es la provincia; sección es el partido. En el esquema provincial de Buenos Aires, distrito 027 identifica el partido, no la provincia.</p></details>;
}
