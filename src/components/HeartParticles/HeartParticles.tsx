import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Heart {
  id: number;
  size: number;
  rotation: number;
  emoji: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const heartEmojis = ['❤️', '💕', '💖', '💗', '💓', '💘'];

interface HeartParticlesProps {
  centerX?: number;
  centerY?: number;
}

/** Generates 60 hearts bursting outward at random angles from the given origin
 *  (origin is nudged 120px down from center). Pure, no side effects, so it can
 *  serve as a useState lazy initializer instead of being computed in an effect. */
function createHearts(centerX?: number, centerY?: number): Heart[] {
  const cx = centerX ?? window.innerWidth / 2;
  const cy = (centerY ?? window.innerHeight / 2) + 120;

  const count = 60;
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.random() * 2 * Math.PI;
    const radius = 200 + Math.random() * 400; // Radius: 200-600px

    return {
      id: i,
      size: 1.2 + Math.random() * 1.2,
      rotation: Math.random() * 360 - 180,
      emoji: heartEmojis[Math.floor(Math.random() * heartEmojis.length)],
      startX: cx - 12,
      startY: cy - 12,
      endX: cx + Math.cos(angle) * radius - 12,
      endY: cy + Math.sin(angle) * radius - 12,
    };
  });
}

const HeartParticles = ({ centerX, centerY }: HeartParticlesProps) => {
  // Lazy initializer instead of computing in an effect: HeartParticles is only ever
  // mounted fresh (parent conditionally renders it), so this is behavior-identical
  // while avoiding a synchronous setState-in-effect on mount.
  const [hearts, setHearts] = useState<Heart[]>(() => createHearts(centerX, centerY));
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger visibility on the next frame so the mount is a separate paint
    // from the initial (pre-animation) state.
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Cleanup after animation (longer duration)
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => setHearts([]), 100);
    }, 3500);

    return () => clearTimeout(timer);
  }, []);

  if (hearts.length === 0) return null;

  return (
    <div 
      className="fixed inset-0 pointer-events-none z-[9999]"
      style={{ overflow: 'visible' }}
    >
      <AnimatePresence>
        {isVisible && hearts.map((heart) => (
          <motion.span
            key={heart.id}
            style={{ 
              position: 'absolute',
              fontSize: `${heart.size}rem`,
              left: heart.startX,
              top: heart.startY,
              display: 'inline-block',
            }}
            initial={{ 
              x: 0,
              y: 0,
              scale: 0.3,
              opacity: 1,
            }}
            animate={{ 
              x: heart.endX - heart.startX,
              y: heart.endY - heart.startY,
              scale: [0.3, 1.5, 1.2, 0],
              rotate: heart.rotation,
              opacity: [1, 1, 1, 0],
            }}
            transition={{
              duration: 2.5, // Slower animation
              ease: [0.15, 0.5, 0.25, 1], // Slower ease-out
            }}
          >
            {heart.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default HeartParticles;
