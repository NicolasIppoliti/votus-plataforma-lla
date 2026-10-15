#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";

const escape = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function image(source, production) {
  if (source?.fullPage !== true) throw new Error("Se requiere fullPage: true en ambas capturas; no usar viewports.");
  const bytes = Buffer.from(source.png, "base64");
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("Captura PNG inválida");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!(production ? width === 1440 : [1276, 1424, 1600].includes(width)) || height < 1) throw new Error("Dimensiones nativas no admitidas");
  return { width, height, uri: `data:image/png;base64,${bytes.toString("base64")}`, sha256: createHash("sha256").update(bytes).digest("hex") };
}
function pair(data) {
  if (!/^[a-z-]+$/.test(data.name)) throw new Error("Nombre inválido");
  const p = image(data.production, true), t = image(data.prototype, false);
  const h = data.segmentHeight ?? 900;
  if (!Number.isSafeInteger(h) || h < 1) throw new Error("segmentHeight debe ser un entero positivo");
  const total = Math.max(p.height, t.height), gap = 24, header = 100;
  const results = [];
  for (let y = 0; y < total; y += h) {
    const panel = (img, x, label) => `<svg x="${x}" y="${header}" width="${img.width}" height="${h}" overflow="hidden"><rect width="100%" height="100%" fill="#ddd"/><image href="${img.uri}" x="0" y="-${y}" width="${img.width}" height="${img.height}"/>${y + h > img.height ? `<text x="12" y="${Math.max(20, img.height - y + 20)}">Fin de captura ${label} (y=${img.height})</text>` : ""}</svg>`;
    results.push({ name: `${data.name}-1440-${String(results.length + 1).padStart(2, "0")}`, range: [y, Math.min(y + h, total)], production: { width: p.width, height: p.height, sha256: p.sha256 }, prototype: { width: t.width, height: t.height, sha256: t.sha256 }, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${p.width + gap + t.width}" height="${h + header}" viewBox="0 0 ${p.width + gap + t.width} ${h + header}" style="font:16px sans-serif"><rect width="100%" height="100%" fill="white"/><text x="12" y="24">${escape(data.name)} · y=${y}–${Math.min(y + h, total)} · escala 1:1, sin redimensionar</text><text x="12" y="48">Producción 1440 px / prototipo ${t.width} px: no son viewports idénticos.</text><text x="12" y="76">Producción (izquierda) / Prototipo (derecha) · gris = fuera de captura, no contenido ausente</text>${panel(p, 0, "de producción")}${panel(t, p.width + gap, "del prototipo")}</svg>` });
  }
  return results;
}

try {
  if (process.argv[2] === "--stdin") {
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    console.log(JSON.stringify(pair(JSON.parse(input))));
  } else {
    const [manifest, output] = process.argv.slice(2);
    if (!manifest || !output) throw new Error("Uso: node docs/visual-review/pair-desktop.mjs manifest.json directorio-nuevo");
    const config = JSON.parse(await readFile(manifest, "utf8"));
    const names = ["panorama", "exploracion", "comparacion", "evidencia", "simulacion"];
    if (!Array.isArray(config) || config.length !== 5 || names.some((name) => config.filter((item) => item.name === name).length !== 1)) throw new Error("El manifiesto debe incluir exactamente las cinco páginas");
    const pairs = [];
    for (const item of config) {
      if (!new RegExp(`^r4-${item.name}-1440-full\\.png$`).test(item.production.path.split("/").at(-1))) throw new Error("Producción debe usar raw/r4-*-1440-full.png, nunca el viewport");
      for (const key of ["production", "prototype"]) item[key].png = (await readFile(resolve(dirname(manifest), item[key].path))).toString("base64");
      pairs.push(...pair(item));
    }
    // A new directory prevents accidental replacement of evidence or reviewer notes.
    await mkdir(output);
    for (const item of pairs) await writeFile(resolve(output, `${item.name}.svg`), item.svg, { flag: "wx" });
    await writeFile(resolve(output, "manifest.json"), JSON.stringify(pairs.map(({ svg: _svg, ...metadata }) => metadata), null, 2), { flag: "wx" });
    await writeFile(resolve(output, "INDEX.html"), `<!doctype html><html lang="es"><meta charset="utf-8"><title>Pares de revisión pendientes</title><h1>Revisión visual pendiente</h1><p>Abrir cada SVG a tamaño real (100 %), sin ajustar al ancho.</p>${pairs.map((p) => `<p><a href="${p.name}.svg">${p.name}: y=${p.range.join("–")}</a></p>`).join("")}</html>`, { flag: "wx" });
    await writeFile(resolve(output, "NOTES.md"), `# Revisión pendiente\n\nNo constituye aprobación visual. Agregar una fila POR ELEMENTO, no sólo por segmento.\n\n| Par / rango Y | Elemento | Coincidencia / desviación | Evidencia y acción |\n|---|---|---|---|\n${pairs.map((p) => `| ${p.name} / ${p.range.join("–")} | Inventario pendiente | Pendiente | Inspeccionar ambos lados |`).join("\n")}\n\n## Verificador independiente\n\nPendiente: registrar referencia de revisión, hallazgos bloqueantes, resolución y dictamen.\n`, { flag: "wx" });
    console.log(`${pairs.length} pares generados; revisión por elemento y verificación independiente pendientes.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
