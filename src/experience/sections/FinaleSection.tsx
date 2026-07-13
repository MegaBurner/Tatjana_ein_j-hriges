import { Float } from '@react-three/drei';

export const FinaleScene = () => (
  <Float speed={1.6} rotationIntensity={0.3} floatIntensity={0.5}>
    <mesh>
      <torusKnotGeometry args={[0.6, 0.2, 128, 32]} />
      <meshStandardMaterial color="#e07186" roughness={0.35} />
    </mesh>
  </Float>
);

export const FinaleHtml = () => (
  <div className="exp-content" style={{ paddingTop: '20vh' }}>
    <span className="exp-kicker">Für immer</span>
    <h2 className="exp-title">Volim te ❤️</h2>
    <p className="exp-subtitle">Auf noch viele weitere Jahre mit dir.</p>
  </div>
);
