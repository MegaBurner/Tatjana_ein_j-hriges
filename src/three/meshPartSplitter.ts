import * as THREE from "three";

/** Ein räumlich getrenntes Teilstück eines zerlegten Meshes. Das Pivot des
 *  neuen Meshes liegt im Zentrum des Teils (Position hält die Originallage),
 *  dadurch sind Teile direkt sinnvoll rotier-/verschiebbar. */
export interface MeshPart {
  mesh: THREE.Mesh;
  /** Zentrum des Teils im lokalen Space des Quell-Meshes. */
  center: THREE.Vector3;
  size: THREE.Vector3;
}

/** Vertices gelten als identisch, wenn ihre Positionen auf diese Auflösung
 *  gerundet übereinstimmen — UV-/Normal-Seams duplizieren Vertices und
 *  dürfen ein zusammenhängendes Teil nicht künstlich zertrennen. */
const POSITION_HASH_DECIMALS = 5;

/**
 * Zerlegt ein Mesh in seine räumlich getrennten Teile (verbundene
 * Komponenten der Dreieckstopologie). Gedacht für Figuren mit frei
 * schwebenden Gliedmaßen (körperlose Hände/Füße), die als EIN Mesh
 * exportiert wurden: Nach dem Split lassen sich die Teile wie bei einem
 * Rig einzeln posieren und animieren.
 *
 * Liefert ein leeres Array, wenn das Mesh nur aus einem Teil besteht oder
 * nicht zerlegbar ist (Aufrufer behandelt das als No-op und lässt das
 * Original unangetastet).
 */
export function splitDisconnectedParts(source: THREE.Mesh): MeshPart[] {
  const geometry = source.geometry;
  const position = geometry.getAttribute("position");
  if (!position || position.count === 0) return [];
  const index = geometry.getIndex();
  const vertexAt = (tri: number, corner: number): number =>
    index ? index.getX(tri * 3 + corner) : tri * 3 + corner;
  const triCount = Math.floor((index ? index.count : position.count) / 3);
  if (triCount < 2) return [];

  // 1) Kanonische Vertex-Ids über Positions-Hash (Seam-Duplikate vereinen).
  const canonical = new Map<string, number>();
  const vertexCanon = new Int32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(POSITION_HASH_DECIMALS)}|${position
      .getY(i)
      .toFixed(POSITION_HASH_DECIMALS)}|${position
      .getZ(i)
      .toFixed(POSITION_HASH_DECIMALS)}`;
    const existing = canonical.get(key);
    if (existing === undefined) {
      canonical.set(key, i);
      vertexCanon[i] = i;
    } else {
      vertexCanon[i] = existing;
    }
  }

  // 2) Union-Find über die Dreiecke.
  const parent = new Int32Array(position.count);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (a: number): number => {
    let root = a;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]];
      root = parent[root];
    }
    return root;
  };
  for (let t = 0; t < triCount; t++) {
    const a = find(vertexCanon[vertexAt(t, 0)]);
    const b = find(vertexCanon[vertexAt(t, 1)]);
    const c = find(vertexCanon[vertexAt(t, 2)]);
    if (b !== a) parent[b] = a;
    if (c !== a) parent[c] = a;
  }

  // 3) Dreiecke nach Komponente gruppieren.
  const triGroups = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const root = find(vertexCanon[vertexAt(t, 0)]);
    let list = triGroups.get(root);
    if (!list) {
      list = [];
      triGroups.set(root, list);
    }
    list.push(t);
  }
  if (triGroups.size < 2) return [];

  // 4) Pro Komponente eine non-indexed Teilgeometrie mit allen Attributen.
  const attributeNames = Object.keys(geometry.attributes);
  const parts: MeshPart[] = [];
  for (const tris of triGroups.values()) {
    const partGeometry = new THREE.BufferGeometry();
    for (const name of attributeNames) {
      const src = geometry.getAttribute(name);
      const itemSize = src.itemSize;
      const data = new Float32Array(tris.length * 3 * itemSize);
      let write = 0;
      for (const t of tris) {
        for (let corner = 0; corner < 3; corner++) {
          const vi = vertexAt(t, corner);
          for (let component = 0; component < itemSize; component++) {
            data[write++] = src.getComponent(vi, component);
          }
        }
      }
      partGeometry.setAttribute(
        name,
        new THREE.BufferAttribute(data, itemSize),
      );
    }
    partGeometry.computeBoundingBox();
    const box = partGeometry.boundingBox as THREE.Box3;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Pivot ins Teil-Zentrum: Geometrie zentrieren, Mesh-Position kompensiert.
    partGeometry.translate(-center.x, -center.y, -center.z);
    const mesh = new THREE.Mesh(partGeometry, source.material);
    mesh.position.copy(center);
    parts.push({ mesh, center, size });
  }
  return parts;
}
