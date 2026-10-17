import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import PrivacyPage, { metadata } from "./page";

it("renders the public notice with the operator's contact and retention policy", () => {
  const markup = renderToStaticMarkup(<PrivacyPage />);
  expect(metadata.title).toBe("Aviso de privacidad");
  expect(markup).toContain('id="main-content"');
  for (const heading of ["Aviso de privacidad", "Qué datos tratamos", "Para qué los usamos", "Sin usos secundarios", "Proveedores", "Retención", "Derechos y contacto", "Cookies", "Cambios"]) {
    expect(markup).toContain(`>${heading}</h`);
  }
  for (const text of ["el equipo operador de Votus", "Supabase Auth", "Vercel", "organización", "auditoría", "30 días", "baja de la cuenta", "revocación del acceso", "17 de octubre de 2026", "rectificación", "eliminación"]) expect(markup).toContain(text);
  expect(markup).toContain('href="mailto:votus@fragua.dev"');
});
