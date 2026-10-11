// Asset checks complement the root-owned actual HTTP-entry RED/GREEN contract.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const bytes = await readFile(new URL('./assets/winner-reference-paths.json', import.meta.url));
const bundle = JSON.parse(bytes);
assert.equal(bundle.source.sha256, '964af68999504c107c71eaccd8470055f990071eccba09f227e81b6dc31df673');
assert.equal(bundle.source.sizeBytes, 30269143);
assert.equal(bundle.source.referenceOnly, true);
assert.equal(bundle.source.featureCount, 538);
assert.equal(bundle.source.invalidFeatureCount, 22);
assert.equal(bundle.source.polygonCount, 1976);
assert.equal(bundle.source.ringCount, 2213);
assert.equal(bundle.source.originalVertexCount, 1093795);
assert.equal(bundle.source.vertexCount, 140773);
assert.equal(bundle.features.length, 538);
assert.equal(new Set(bundle.features.map(feature => feature.sourceGid)).size, 538);
assert.equal(bundle.features.filter(feature => !feature.geometryValid).length, 22);
assert.equal(bundle.features.reduce((count, feature) => count + feature.polygonCount, 0), 1976);
assert.equal(bundle.features.reduce((count, feature) => count + feature.ringCount, 0), 2213);
assert.equal(bundle.features.reduce((count, feature) => count + feature.vertexCount, 0), 140773);
for (const feature of bundle.features.filter(feature => !feature.geometryValid)) {
  assert.equal(feature.simplified, false, 'Invalid source geometry must not be repaired or simplified');
  assert.equal(feature.sourceGeometryHash, feature.derivativeGeometryHash, 'Invalid coordinates stay unchanged before display-only winding adaptation');
  assert.ok(feature.validityReason);
}
assert.equal(bundle.source.warnings.degenerateExteriorRingCount, 0, 'Tiny valid exteriors must not become false degenerate rings through cancellation');
assert.equal(bundle.source.warnings.degenerateInteriorRingCount, 28);
assert.equal(bundle.source.warnings.unshiftedCancellationRingCount, 11);
assert.equal(bundle.source.warnings.translatedCancellationResidueRingCount, 1);
assert.equal(bundle.source.warnings.reversedExteriorRingCount, 1);
assert.equal(bundle.source.warnings.reversedInteriorRingCount, 1);
assert.equal(bundle.source.ringOrientationDiagnostics.length, 12);
assert.ok(bundle.source.ringOrientationDiagnostics.some(ring => ring.sourceGid === 30871 && ring.ringIndex === 0));
assert.ok(bundle.source.ringOrientationDiagnostics.some(ring => ring.ringIndex > 0));
for (const ring of bundle.source.ringOrientationDiagnostics) {
  assert.equal(ring.unshiftedSignedArea, 0);
  assert.notEqual(ring.translatedSignedArea, 0);
  if (ring.geosRingArea > 0) {
    assert.equal(ring.translatedSignedArea > 0, ring.geosIsCounterclockwise, 'Stable planar ring sign agrees with GEOS on tiny valid rings');
    assert.equal(ring.displayReversed, ring.ringIndex === 0 ? ring.geosSignedArea > 0 : ring.geosSignedArea < 0);
  } else {
    assert.equal(ring.geosSignedArea, 0);
    assert.equal(ring.translatedCancellationResidue, true);
    assert.equal(ring.displayReversed, false, 'Do not reverse a truly degenerate ring because translated arithmetic has a tiny residual');
  }
  const [[x0, y0], [x1, y1]] = ring.projectedFeatureBounds;
  assert.ok([x0, y0, x1, y1].every(Number.isFinite));
  assert.ok(x1 - x0 < 200 && y1 - y0 < 200, 'Tiny rings must not turn their source section into a world-sized complement');
}
assert.equal(bundle.source.warnings.duplicateProvinceDepartmentGroupCount, 7);
assert.equal(bundle.provinces.length, 24);
assert.equal(bundle.partidos.length, 135);
assert.equal(bundle.partidos.filter(item => !item.geometryValid).length, 2);
assert.equal(bundle.partidos.reduce((count, item) => count + item.vertexCount, 0), 10619);
const allNodes = [...bundle.provinces, ...bundle.partidos];
assert.equal(new Set(allNodes.map(node => node.id)).size, 159);
assert.equal(Object.keys(bundle.scopePaths).length, 159);
const sourceGids = bundle.provinces.flatMap(province => province.sourceGids);
assert.equal(sourceGids.length, 538);
assert.equal(new Set(sourceGids).size, 538, 'Every input feature remains assigned exactly once; duplicate names are not deduplicated');
assert.equal(bundle.provinces.reduce((count, item) => count + item.observedCount, 0), 22);
for (const node of allNodes) {
  assert.equal(node.geometryValid, node.observedCount === 0);
  assert.ok(node.path.length > 20 && node.scopePath.length > 20);
  assert.ok(!/NaN|Infinity|undefined/.test(node.path + node.scopePath));
  assert.equal(node.scopePath, bundle.scopePaths[node.id]);
  assert.ok(node.label && node.sourceName);
}
assert.equal(bundle.provinces.find(node => node.id === 'buenos-aires').sourceName, 'Buenos Aires');
assert.equal(bundle.partidos.find(node => node.id === 'rosales').sourceGid, 30556);
assert.equal(bundle.partidos.find(node => node.id === 'rosales').label, 'Coronel Rosales');
assert.equal(bundle.partidos.find(node => node.id === 'rosales').sourceName, 'Cnel. de Marina L.Rosales');
assert.equal(bundle.source.sourceCatalog, 'https://mapa2.electoral.gov.ar/');
assert.equal(bundle.source.historicalApplicability, 'unknown');
assert.equal(bundle.source.canonicalElectoralCrosswalk, false);
assert.equal(bundle.source.repairs, 0);
assert.equal(bundle.source.dissolves, 0);
assert.equal(bundle.source.deletedFeatures, 0);
console.log(JSON.stringify({ status: 'PASS', featureCount: 538, provinceCount: 24, partidoCount: 135, invalidRetained: 22, polygons: 1976, rings: 2213, vertices: 140773, assetBytes: bytes.length, assetSha256: createHash('sha256').update(bytes).digest('hex') }, null, 2));
