export interface Raster { width: number; height: number; rgba: number[] }

export function occupiedPixels(raster: Raster, fill: readonly number[], minimum: number): number[] {
  const occupied: number[] = [];
  for (let index = 0; index < raster.width * raster.height; index++) {
    const offset = index * 4;
    if (raster.rgba[offset + 3] === 255 && fill.every((channel, component) => Math.abs(raster.rgba[offset + component]! - channel) <= 3)) occupied.push(index);
  }
  return occupied.length >= minimum ? occupied : [];
}

export function alignedOccupiedGeometry(first: Raster, firstFill: readonly number[], second: Raster, secondFill: readonly number[], minimum = 100): boolean {
  if (first.width !== second.width || first.height !== second.height || first.width <= 0 || first.height <= 0) return false;
  const a = occupiedPixels(first, firstFill, minimum), b = occupiedPixels(second, secondFill, minimum);
  if (!a.length || !b.length) return false;
  const nearby = (source: number[], target: Set<number>) => source.every((index) => {
    const x = index % first.width, y = Math.floor(index / first.width);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && nx < first.width && ny >= 0 && ny < first.height && target.has(ny * first.width + nx)) return true;
    }
    return false;
  });
  return nearby(a, new Set(b)) && nearby(b, new Set(a));
}
