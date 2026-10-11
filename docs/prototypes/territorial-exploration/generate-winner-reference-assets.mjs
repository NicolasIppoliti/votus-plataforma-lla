// Offline, reference-only child layers for this isolated design prototype.
// Source IDs and display labels are NOT a canonical electoral crosswalk.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { geoMercator, geoPath } from '/Users/nicolasmateoippoliti/dev/votus-plataforma-lla/apps/web/node_modules/d3-geo/src/index.js';

const repository = '/Users/nicolasmateoippoliti/dev/votus-plataforma-lla';
const sourceHash = '964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673';
const sourcePath = `${repository}/archive/geography/cne-pba-sections.${sourceHash}.geojson`;
const sourceBytes = await readFile(sourcePath);
assert.equal(sourceBytes.length, 30269143);
assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), sourceHash);

// Explicit source-name -> presentation-name mapping. Encoding defects remain
// available verbatim in sourceName; no electoral codes are inferred from names.
const provinceLabels = new Map([
  ['Buenos Aires', 'Buenos Aires'],
  ['Catamarca', 'Catamarca'], ['Chaco', 'Chaco'], ['Chubut', 'Chubut'],
  ['Ciudad Aut๓noma de Buenos Aires', 'Ciudad Autónoma de Buenos Aires'],
  ['Cordoba', 'Córdoba'], ['Corrientes', 'Corrientes'], ['Entre Rํos', 'Entre Ríos'],
  ['Formosa', 'Formosa'], ['Jujuy', 'Jujuy'], ['La Pampa', 'La Pampa'], ['La Rioja', 'La Rioja'],
  ['Mendoza', 'Mendoza'], ['Misiones', 'Misiones'], ['Neuquen', 'Neuquén'],
  ['Rio Negro', 'Río Negro'], ['Salta', 'Salta'], ['San Juan', 'San Juan'], ['San Luis', 'San Luis'],
  ['Santa Cruz', 'Santa Cruz'], ['Santa Fe', 'Santa Fe'], ['Santiago del Estero', 'Santiago del Estero'],
  ['Tierra del Fuego,Ant,Is del Atlantico Sur', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur'],
  ['Tucumแn', 'Tucumán'],
]);

// Simplify ONLY the 516 valid source geometries. Invalid inputs retain their
// original coordinate arrays; no buffer(0), make_valid, union or repair occurs.
const python = spawnSync(`${repository}/etl/.venv/bin/python`, ['-c', `
import hashlib,json,math
from shapely.geometry import shape,mapping,Polygon
from shapely.validation import explain_validity
source=json.load(open('${sourcePath}'))
assert source['type']=='FeatureCollection' and len(source['features'])==538
def counts(g):
    assert g['type']=='MultiPolygon'
    return (len(g['coordinates']),sum(len(p) for p in g['coordinates']),sum(len(r) for p in g['coordinates'] for r in p))
def digest(g):
    return hashlib.sha256(json.dumps(g,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()
def ring_orientation(r):
    ring=Polygon(r)
    return 0 if ring.area==0 else (1 if ring.exterior.is_ccw else -1)
out=[]
for f in source['features']:
    original=f['geometry'];geometry=shape(original);valid=geometry.is_valid
    derivative=original
    if valid:
        simplified=geometry.simplify(.002,preserve_topology=True)
        assert simplified.is_valid
        derivative=dict(mapping(simplified))
        if derivative['type']=='Polygon':
            derivative={'type':'MultiPolygon','coordinates':[derivative['coordinates']]}
    before=counts(original);after=counts(derivative)
    assert before[:2]==after[:2],(f['properties']['gid'],before,after)
    if not valid: assert digest(original)==digest(derivative)
    diagnostics=[]
    warnings=dict(degenerateExteriorRingCount=0,degenerateInteriorRingCount=0,reversedExteriorRingCount=0,
        reversedInteriorRingCount=0,unshiftedCancellationRingCount=0,translatedCancellationResidueRingCount=0)
    for pi,p in enumerate(original['coordinates']):
        for ri,r in enumerate(p):
            naive=sum(r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1] for i in range(1,len(r)))
            x0,y0=r[0]
            translated=math.fsum((r[i-1][0]-x0)*(r[i][1]-y0)-(r[i][0]-x0)*(r[i-1][1]-y0) for i in range(1,len(r)))
            ring=Polygon(r);orientation=ring_orientation(r)
            if orientation==0: warnings['degenerateExteriorRingCount' if ri==0 else 'degenerateInteriorRingCount']+=1
            elif ri==0 and orientation>0: warnings['reversedExteriorRingCount']+=1
            elif ri>0 and orientation<0: warnings['reversedInteriorRingCount']+=1
            if naive==0 and ring.area>0: warnings['unshiftedCancellationRingCount']+=1
            residue=orientation==0 and translated!=0
            if residue: warnings['translatedCancellationResidueRingCount']+=1
            if naive==0 and (ring.area>0 or translated!=0):
                diagnostics.append({'polygonIndex':pi,'ringIndex':ri,'unshiftedSignedArea':naive,
                    'translatedSignedArea':translated,'geosRingArea':ring.area,'geosSignedArea':2*ring.area*orientation,
                    'geosIsCounterclockwise':bool(ring.exterior.is_ccw),'translatedCancellationResidue':residue})
    out.append({'properties':f['properties'],'geometry':derivative,'geometryValid':valid,
        'validityReason':None if valid else explain_validity(geometry),'simplified':valid,
        'polygonCount':after[0],'ringCount':after[1],'originalVertexCount':before[2],'vertexCount':after[2],
        'sourceGeometryHash':digest(original),'derivativeGeometryHash':digest(derivative),'ringDiagnostics':diagnostics,
        'warnings':warnings,'derivativeRingOrientations':[[ring_orientation(r) for r in p] for p in derivative['coordinates']]})
assert len(set(f['properties']['gid'] for f in out))==538
assert sum(not f['geometryValid'] for f in out)==22
assert sum(f['polygonCount'] for f in out)==1976
assert sum(f['ringCount'] for f in out)==2213
assert sum(f['vertexCount'] for f in out)==140773
assert sum(f['originalVertexCount'] for f in out)==1093795
print(json.dumps(out,separators=(',',':'),allow_nan=False))
`], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024 });
if (python.status !== 0) throw new Error(python.stderr || 'Reference simplification failed');
const features = JSON.parse(python.stdout);

function signedArea(ring) {
  // Translate first to avoid catastrophic cancellation of tiny valid rings at
  // large longitude/latitude values, then use compensated addition.
  const [x0, y0] = ring[0];
  let value = 0, compensation = 0;
  for (let index = 1; index < ring.length; index++) {
    const term = (ring[index - 1][0] - x0) * (ring[index][1] - y0) - (ring[index][0] - x0) * (ring[index - 1][1] - y0);
    const adjusted = term - compensation;
    const next = value + adjusted;
    compensation = (next - value) - adjusted;
    value = next;
  }
  return value;
}
function orientForD3(geometry, ringOrientations) {
  // D3 expects clockwise exteriors and counterclockwise holes. Check every ring;
  // preserve degenerate rings rather than silently excluding their components.
  return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((polygon, polygonIndex) => polygon.map((ring, index) => {
    const area = ringOrientations ? ringOrientations[polygonIndex][index] : signedArea(ring);
    const reverse = index === 0 ? area > 0 : area < 0;
    return reverse ? [...ring].reverse() : ring;
  })) };
}
const groups = new Map();
const displayFeatures = features.map(feature => {
  const rawProvince = feature.properties.provincia;
  assert.ok(provinceLabels.has(rawProvince), `Unmapped source province: ${rawProvince}`);
  const record = {
    sourceGid: feature.properties.gid, sourceName: feature.properties.departamen,
    sourceProvince: rawProvince, geometryValid: feature.geometryValid,
    validityReason: feature.validityReason, simplified: feature.simplified,
    polygonCount: feature.polygonCount, ringCount: feature.ringCount,
    originalVertexCount: feature.originalVertexCount, vertexCount: feature.vertexCount,
    sourceGeometryHash: feature.sourceGeometryHash, derivativeGeometryHash: feature.derivativeGeometryHash,
    ringDiagnostics: feature.ringDiagnostics,
    warnings: feature.warnings, derivativeRingOrientations: feature.derivativeRingOrientations,
    geometry: orientForD3(feature.geometry, feature.derivativeRingOrientations),
  };
  if (!groups.has(rawProvince)) groups.set(rawProvince, []);
  groups.get(rawProvince).push(record);
  return record;
});
assert.equal(groups.size, 24);

const provinceReference = JSON.parse(await readFile(new URL('./assets/buenos-aires-reference.json', import.meta.url)));
assert.equal(provinceReference.properties.input_sha256, '314600f9b681841b9f35c27fac030c835de6a95cbf4a0c4256a39df6c069f723');
assert.equal(provinceReference.geometry.coordinates.length, 95);
const continentalProjection = geoMercator().center([-63.5, -39]).translate([430, 300]).scale(560).clipExtent([[0, 0], [860, 600]]);
const provinceProjection = geoMercator().fitExtent([[195, 65], [680, 535]], orientForD3(provinceReference.geometry));
function geometryCollection(records) {
  // FeatureCollection retains every section separately. It does not dissolve
  // shared edges, deduplicate department names or manufacture province boundaries.
  return { type: 'FeatureCollection', features: records.map(record => ({ type: 'Feature', properties: {}, geometry: record.geometry })) };
}
function path(projection, geometry) {
  const result = geoPath(projection).digits(2)(geometry);
  assert.ok(result && !/NaN|Infinity|undefined/.test(result), 'Reference path must be finite and nonempty');
  return result;
}
function ownPath(geometry) {
  return path(geoMercator().fitExtent([[155, 85], [705, 515]], geometry), geometry);
}
const slug = label => label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function aggregateWarnings(records) {
  return Object.fromEntries(['degenerateExteriorRingCount', 'degenerateInteriorRingCount', 'reversedExteriorRingCount', 'reversedInteriorRingCount', 'unshiftedCancellationRingCount', 'translatedCancellationResidueRingCount'].map(key => [key, records.reduce((total, record) => total + record.warnings[key], 0)]));
}
const provinces = [...groups.entries()].map(([sourceName, records]) => {
  const label = provinceLabels.get(sourceName);
  const id = sourceName === 'Buenos Aires' ? 'buenos-aires' : `province-${slug(label)}`;
  const geometry = geometryCollection(records);
  return {
    id, label, sourceName, sourceGids: records.map(record => record.sourceGid),
    path: path(continentalProjection, geometry), scopePath: ownPath(geometry),
    geometryValid: records.every(record => record.geometryValid), observedCount: records.filter(record => !record.geometryValid).length,
    featureCount: records.length, polygonCount: records.reduce((n, record) => n + record.polygonCount, 0),
    ringCount: records.reduce((n, record) => n + record.ringCount, 0), vertexCount: records.reduce((n, record) => n + record.vertexCount, 0),
    warnings: aggregateWarnings(records),
  };
}).sort((left, right) => left.id.localeCompare(right.id, 'en'));
const partidos = groups.get('Buenos Aires').map(record => {
  const id = record.sourceGid === 30556 ? 'rosales' : `section-gid-${record.sourceGid}`;
  const label = record.sourceGid === 30556 ? 'Coronel Rosales' : record.sourceName === 'Ca๑uelas' ? 'Cañuelas' : record.sourceName;
  return {
    id, label, sourceName: record.sourceName, sourceGid: record.sourceGid,
    path: path(provinceProjection, record.geometry), scopePath: ownPath(record.geometry),
    geometryValid: record.geometryValid, observedCount: record.geometryValid ? 0 : 1,
    polygonCount: record.polygonCount, ringCount: record.ringCount, vertexCount: record.vertexCount,
    validityReason: record.validityReason, warnings: record.warnings,
  };
}).sort((left, right) => left.sourceGid - right.sourceGid);
assert.equal(partidos.length, 135);
assert.equal(partidos.filter(record => !record.geometryValid).length, 2);

const duplicateNames = new Map();
for (const record of displayFeatures) {
  const key = JSON.stringify([record.sourceProvince, record.sourceName]);
  if (!duplicateNames.has(key)) duplicateNames.set(key, []);
  duplicateNames.get(key).push(record.sourceGid);
}
const duplicateProvinceDepartmentGroups = [...duplicateNames.entries()].filter(([, gids]) => gids.length > 1).map(([key, sourceGids]) => {
  const [sourceProvince, sourceName] = JSON.parse(key);
  return { sourceProvince, sourceName, sourceGids };
});
assert.equal(duplicateProvinceDepartmentGroups.length, 7);
const warnings = aggregateWarnings(displayFeatures);
assert.equal(warnings.degenerateExteriorRingCount, 0);
assert.equal(warnings.degenerateInteriorRingCount, 28);
assert.equal(warnings.unshiftedCancellationRingCount, 11);
assert.equal(warnings.translatedCancellationResidueRingCount, 1);
const ringOrientationDiagnostics = displayFeatures.flatMap(record => record.ringDiagnostics.map(diagnostic => {
  const orientation = record.derivativeRingOrientations[diagnostic.polygonIndex][diagnostic.ringIndex];
  const reverse = diagnostic.ringIndex === 0 ? orientation > 0 : orientation < 0;
  if (orientation !== 0) assert.equal(orientation > 0, diagnostic.geosIsCounterclockwise);
  return { sourceGid: record.sourceGid, ...diagnostic,
    displayReversed: reverse,
    projectedFeatureBounds: geoPath(continentalProjection).bounds(record.geometry) };
}));
const bundle = {
  source: {
    sourceCatalog: 'https://mapa2.electoral.gov.ar/', archiveRecord: 'geography/cne-pba-sections',
    sha256: sourceHash, sizeBytes: sourceBytes.length, referenceOnly: true,
    featureCount: 538, invalidFeatureCount: 22, polygonCount: 1976, ringCount: 2213,
    originalVertexCount: 1093795, vertexCount: 140773, simplifiedFeatureCount: 516,
    simplificationDegrees: .002, preserveTopology: true, invalidCoordinatesPreserved: true,
    canonicalElectoralCrosswalk: false, historicalApplicability: 'unknown', publicationReuseTerms: 'not independently verified',
    sourceNameDisplayMapping: 'explicit presentation labels only; original names retained',
    windingMethod: 'Per-ring Shapely/GEOS area and orientation; naive and translated diagnostics retained; display-only reversal',
    ringOrientationDiagnostics,
    repairs: 0, dissolves: 0, deletedFeatures: 0,
    frame: '860x600 continental Mercator viewport; clipping changes display, never source inventory',
    warnings: { ...warnings, duplicateProvinceDepartmentGroupCount: 7, duplicateProvinceDepartmentGroups,
      invalidSourceGids: displayFeatures.filter(record => !record.geometryValid).map(record => record.sourceGid) },
  },
  provinces, partidos,
  scopePaths: Object.fromEntries([...provinces, ...partidos].map(node => [node.id, node.scopePath])),
  features: displayFeatures.map(({ geometry, ringDiagnostics, derivativeRingOrientations, ...metadata }) => metadata),
};
await writeFile(new URL('./assets/winner-reference-paths.json', import.meta.url), JSON.stringify(bundle));
console.log(JSON.stringify({ featureCount: bundle.source.featureCount, provinceCount: provinces.length, partidoCount: partidos.length,
  invalidRetained: 22, warnings, paths: provinces.length + partidos.length, polygons: 1976, rings: 2213, vertices: 140773 }, null, 2));
