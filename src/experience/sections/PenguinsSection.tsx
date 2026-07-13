export const PenguinsScene = () => (
  <group>
    <mesh position={[-0.8, 0, 0]}>
      <capsuleGeometry args={[0.4, 0.6, 8, 16]} />
      <meshStandardMaterial color="#222831" roughness={0.5} />
    </mesh>
    <mesh position={[0.8, 0, 0]}>
      <capsuleGeometry args={[0.4, 0.6, 8, 16]} />
      <meshStandardMaterial color="#f4a5ae" roughness={0.5} />
    </mesh>
  </group>
);

export const PenguinsHtml = () => (
  <div className="exp-content" style={{ paddingTop: '10vh' }}>
    <span className="exp-kicker">Kapitel 4</span>
    <h2 className="exp-title">Du &amp; ich</h2>
    <p className="exp-subtitle">Zwei Pinguine, ein Kuss.</p>
  </div>
);
