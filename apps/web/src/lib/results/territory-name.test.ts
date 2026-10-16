import { expect, it } from "vitest";
import { displayTerritoryName } from "./territory-name";

// #611: some official files spell territories in upper case (2025 legislativas:
// "CORONEL DE MARINA L. ROSALES"), others in mixed case (2023 generales:
// "Coronel de Marina L. Rosales"). One boundary turns the upper-case spelling
// into the mixed-case one, so both elections name the section the same way.
it.each([
  ["CORONEL DE MARINA L. ROSALES", "Coronel de Marina L. Rosales"],
  ["BUENOS AIRES", "Buenos Aires"],
  ["LA MATANZA", "La Matanza"],
  ["TRES DE FEBRERO", "Tres de Febrero"],
  ["25 DE MAYO", "25 de Mayo"],
  ["CIUDAD AUTÓNOMA DE BUENOS AIRES", "Ciudad Autónoma de Buenos Aires"],
  ["GRAL. PUEYRREDÓN", "Gral. Pueyrredón"],
  ["  SAN   ISIDRO ", "San Isidro"],
])("title-cases the upper-case spelling %j", (raw, expected) => {
  expect(displayTerritoryName(raw)).toBe(expected);
});

it.each(["Coronel de Marina L. Rosales", "Buenos Aires", "Coronel Rosales"])("keeps an existing mixed-case spelling %j", name => {
  expect(displayTerritoryName(name)).toBe(name);
});
