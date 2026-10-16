// Offline artifact derivation. Source archives remain read-only.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const { geoMercator, geoAzimuthalEqualArea, geoPath, geoContains } = await import(new URL('../../../apps/web/node_modules/d3-geo/src/index.js', import.meta.url));

const repository = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const output = fileURLToPath(new URL('./assets/', import.meta.url));
const nationalHash = '70b0b5bba80ce1e924159fcceb72560a0b67435fff3d8d11e5b6e70590999af5';
const provinceHash = '314600f9b681841b9f35c27fac030c835de6a95cbf4a0c4256a39df6c069f723';
async function verifiedJson(path, hash, size) {
  const bytes = await readFile(path);
  if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Input reference integrity mismatch');
  return JSON.parse(bytes.toString('utf8'));
}
const nationalSource = await verifiedJson(`${repository}/apps/web/public/geography/argentina-reference.${nationalHash}.geojson`, nationalHash, 736599);
await verifiedJson(`${repository}/archive/geography/ign-buenos-aires-province.${provinceHash}.geojson`, provinceHash, 10282974);
const python = spawnSync(process.env.PYTHON ?? 'python3', ['-c', `
import json
from shapely.geometry import shape, mapping
source=json.load(open('${repository}/archive/geography/ign-buenos-aires-province.${provinceHash}.geojson'))
features=[f for f in source['features'] if f['id']=='provincia.68' and f['properties']['in1']=='06' and f['properties']['fna']=='Provincia de Buenos Aires']
assert len(features)==1
feature=features[0]
geometry=shape(feature['geometry'])
assert geometry.is_valid and len(geometry.geoms)==95
simplified=geometry.simplify(.002,preserve_topology=True)
assert simplified.is_valid and len(simplified.geoms)==95
print(json.dumps({'type':'Feature','properties':{'source':'IGN','source_feature_id':'provincia.68','in1':'06','fna':'Provincia de Buenos Aires','reference_only':True,'input_sha256':'${provinceHash}','simplification_degrees':.002,'preserve_topology':True,'historical_applicability':'unknown'},'geometry':mapping(simplified)}))
`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
if (python.status !== 0) throw new Error(python.stderr || 'Province simplification failed');
const provinceSource = JSON.parse(python.stdout);
await writeFile(output + 'buenos-aires-reference.json', JSON.stringify(provinceSource));
const rosalesSource = JSON.parse(await readFile(output + 'rosales-reference.json', 'utf8')).feature;
function signedArea(ring) {
  let area = 0;
  for (let index = 1; index < ring.length; index++) area += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
  return area;
}
function orientForD3(feature, expectedNational = false) {
  let adapted = 0;
  const coordinates = feature.geometry.coordinates.map(polygon => polygon.map((ring, index) => {
    const reverse = index === 0 ? signedArea(ring) > 0 : signedArea(ring) < 0;
    if (reverse) adapted++;
    return reverse ? [...ring].reverse() : [...ring];
  }));
  if (expectedNational && (coordinates.length !== 1980 || coordinates.reduce((sum, polygon) => sum + polygon.length, 0) !== 1991 || adapted !== 1)) throw new Error('National component/winding distribution changed');
  return { type: 'MultiPolygon', coordinates };
}
const national = orientForD3(nationalSource.features[0], true);
const province = orientForD3(provinceSource);
const rosales = orientForD3(rosalesSource);
if (!geoContains(national, [-58, -35]) || !geoContains(national, [-50, -89.9]) || geoContains(national, [0, 0])) throw new Error('National interior/exterior mismatch');
const continentalProjection = geoMercator().center([-63.5, -39]).translate([430, 300]).scale(560).clipExtent([[0, 0], [860, 600]]);
const polarProjection = geoAzimuthalEqualArea().rotate([0, 90]).clipAngle(179.999).fitExtent([[8, 8], [392, 392]], national);
const provinceProjection = geoMercator().fitExtent([[195, 65], [680, 535]], province);
const rosalesProjection = geoMercator().fitExtent([[155, 85], [705, 515]], rosales);
function path(projection, geometry) {
  const result = geoPath(projection).digits(2)(geometry);
  if (!result || /NaN|Infinity/.test(result)) throw new Error('Invalid reference path');
  return result;
}
const bundle = {
  argentina: { path: path(continentalProjection, national), childPath: path(continentalProjection, province), polarPath: path(polarProjection, national), components: 1980, source: 'IGN', frame: 'continental', sourceHash: 'ae076881944abd36b79b0a68d14912ca475af95a2c2a9211910ffab81f6ca1e6', derivativeHash: nationalHash },
  'buenos-aires': { path: path(provinceProjection, province), childPath: path(provinceProjection, rosales), components: 95, source: 'IGN', sourceHash: provinceHash, simplifiedReference: true },
  rosales: { path: path(rosalesProjection, rosales), childPath: '', components: 1, source: 'CNE', sourceHash: '964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673' },
};
await writeFile(output + 'reference-paths.json', JSON.stringify(bundle));
console.log(JSON.stringify(Object.fromEntries(Object.entries(bundle).map(([scope, item]) => [scope, { components: item.components, pathCharacters: item.path.length, childPathCharacters: item.childPath.length, polarPathCharacters: item.polarPath?.length ?? 0 }])), null, 2));
