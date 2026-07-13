import { Float } from '@react-three/drei';

export const HeroScene = () => (
  <Float speed={2} rotationIntensity={0.4} floatIntensity={0.6}>
    <mesh>
      <icosahedronGeometry args={[0.9, 1]} />
      <meshStandardMaterial color="#f4a5ae" roughness={0.4} />
    </mesh>
  </Float>
);

export const HeroHtml = () => (
  <div className="exp-content" style={{ paddingTop: '18vh' }}>
    <span className="exp-kicker">Für Tatjana</span>
    <h1 className="exp-title">moja ljubavi</h1>
    <p className="exp-subtitle">Für die schönste Seele der Welt — für meinen Schatz.</p>
    <div className="exp-scroll-hint">
      <span>Scroll</span>
      <span>↓</span>
    </div>
  </div>
);
