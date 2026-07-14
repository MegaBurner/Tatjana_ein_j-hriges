import * as THREE from "three";

/**
 * Klassische Herz-Silhouette: zwei Bögen oben (bezierCurveTo), Spitze unten.
 * Gebaut in der XY-Ebene mit der Spitze bei negativem Y und den Lappen bei
 * positivem Y — nach dem ExtrudeGeometry-Bau um Z rotiert, damit die
 * Extrusionsachse (Z) zur Kamera zeigt und die Silhouette frontal lesbar
 * bleibt (siehe rotateX unten für die tatsächliche Objekt-Ausrichtung).
 */
function makeHeartShape(): THREE.Shape {
  const shape = new THREE.Shape();

  // Start an der Spitze unten.
  shape.moveTo(0, -3);
  // Rechte Flanke von der Spitze hoch zum rechten Lappen.
  shape.bezierCurveTo(0, -1.5, 2.2, -0.5, 2.2, 1.3);
  // Rechter Bogen: von der rechten Flanke über den rechten Lappen zur
  // Mittelkerbe oben.
  shape.bezierCurveTo(2.2, 2.9, 0.9, 3.6, 0, 2.1);
  // Linker Bogen: von der Mittelkerbe über den linken Lappen zur linken Flanke.
  shape.bezierCurveTo(-0.9, 3.6, -2.2, 2.9, -2.2, 1.3);
  // Linke Flanke zurück zur Spitze.
  shape.bezierCurveTo(-2.2, -0.5, 0, -1.5, 0, -3);

  return shape;
}

const EXTRUDE_SETTINGS: THREE.ExtrudeGeometryOptions = {
  depth: 0.25,
  bevelEnabled: true,
  bevelThickness: 0.06,
  bevelSize: 0.06,
  bevelSegments: 2,
  curveSegments: 12,
};

/** Baut die normierte Herz-Geometrie einmalig: extrudiert, zentriert, auf
 *  Einheitsgröße (~1) skaliert und so rotiert, dass die Spitze nach unten
 *  zeigt und die Silhouette der Kamera (Blick entlang -Z) frontal zugewandt
 *  ist. */
function buildHeartGeometry(): THREE.ExtrudeGeometry {
  const shape = makeHeartShape();
  const geometry = new THREE.ExtrudeGeometry(shape, EXTRUDE_SETTINGS);

  geometry.center();

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = new THREE.Vector3();
  box?.getSize(size);
  const maxDimension = Math.max(size.x, size.y, size.z, 1e-6);
  const normalizeScale = 1 / maxDimension;
  geometry.scale(normalizeScale, normalizeScale, normalizeScale);

  // Die Shape liegt in der XY-Ebene (Blick entlang +Z bei Standardkamera
  // wäre frontal) — keine zusätzliche Rotation nötig, die Spitze zeigt
  // bereits nach unten (-Y) und die flache Vorderseite zur Kamera (+Z/-Z).

  geometry.computeVertexNormals();
  return geometry;
}

let heartGeometry: THREE.ExtrudeGeometry | null = null;

/** Modul-Singleton: die Herz-Geometrie wird nur einmal gebaut und danach für
 *  alle Instanzen (KissHearts, ContactHeart, FloatingHearts) wiederverwendet. */
export function getHeartGeometry(): THREE.ExtrudeGeometry {
  heartGeometry ??= buildHeartGeometry();
  return heartGeometry;
}
