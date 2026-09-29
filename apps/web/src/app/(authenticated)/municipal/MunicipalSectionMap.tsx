"use client";

import { SectionReferenceMap } from "@/components/maps/SectionReferenceMap";

interface Props {
  coordinates: number[][][][];
  name: string;
}

export function MunicipalSectionMap({ coordinates, name }: Props) {
  return <SectionReferenceMap coordinates={coordinates} name={name} label="la sección" resultId="municipal-results-heading" municipal />;
}
