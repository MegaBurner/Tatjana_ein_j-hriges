export const PhotosScene = () => (
  <mesh rotation={[0, 0.4, 0]}>
    <boxGeometry args={[2.2, 1.6, 0.2]} />
    <meshStandardMaterial color="#c4b5e4" roughness={0.5} />
  </mesh>
);

export const PhotosHtml = () => (
  <div className="exp-content" style={{ paddingTop: '10vh' }}>
    <span className="exp-kicker">Kapitel 1</span>
    <h2 className="exp-title">Unser Jahr in Bildern</h2>
    <p className="exp-subtitle">Ein Fotobuch voller Erinnerungen — blättere durch.</p>
  </div>
);
