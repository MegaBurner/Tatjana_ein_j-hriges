export const SarmaScene = () => (
  <group>
    <mesh rotation={[Math.PI / 2.2, 0, 0]}>
      <cylinderGeometry args={[1.2, 1.2, 0.08, 48]} />
      <meshStandardMaterial color="#ffffff" roughness={0.3} />
    </mesh>
    <mesh position={[0, 0.15, 0]} rotation={[0, 0, Math.PI / 2]}>
      <capsuleGeometry args={[0.18, 0.5, 8, 16]} />
      <meshStandardMaterial color="#9caf6d" roughness={0.7} />
    </mesh>
  </group>
);

export const SarmaHtml = () => (
  <div className="exp-content" style={{ paddingTop: '10vh' }}>
    <span className="exp-kicker">Kapitel 5</span>
    <h2 className="exp-title">Sarma</h2>
    <p className="exp-subtitle">Liebe geht durch den Magen — najbolja sarma, für uns zwei.</p>
  </div>
);
