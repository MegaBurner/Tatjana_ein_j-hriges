import { useEffect } from 'react';
import { motion } from 'framer-motion';
import PolaroidPhoto from '../components/PolaroidPhoto/PolaroidPhoto';
import FilmStrip from '../components/FilmStrip/FilmStrip';
import PageNavigation from '../components/Navigation/PageNavigation';
import './PhotosPage.css';

interface PhotosPageProps {
  images: string[];
  currentPage: number;
  totalPages: number;
  onNext: () => void;
  onPrev: () => void;
}

const PhotosPage = ({ images, currentPage, totalPages, onNext, onPrev }: PhotosPageProps) => {
  // New images from public/memories
  // New images from public/memories
  // Filtered out .DNG files as they are not supported by browsers
  const memoryImages = [
    '/memories/05438073-d4bf-42fd-a591-5b79ae40c776.JPG',
    '/memories/0dc9a2fa-036a-4d56-b7a4-b7bab7a5ec25.JPG',
    // HEIC files removed due to browser incompatibility
    '/memories/IMG_4891.JPG',
    '/memories/IMG_4909.JPG',
    '/memories/IMG_4913.JPG',
    '/memories/IMG_5006.JPG',
    '/memories/IMG_6280.JPG',
    '/memories/IMG_7321.JPG',
    '/memories/IMG_7411.jpg',
    // DNG Files removed
    '/memories/IMG_7975.JPG',
    '/memories/IMG_7976.JPG',
    '/memories/IMG_7977.JPG',
    '/memories/IMG_8099.jpg',
    '/memories/IMG_8100.jpg',
    '/memories/IMG_8101.jpg',
    '/memories/IMG_8102.jpg',
    '/memories/IMG_8105.jpg',
    '/memories/IMG_8106.jpg',
    '/memories/a861063c-5a40-4df8-acaf-398ef7aa81a7.JPG',
    '/memories/b8b07275-1668-431c-92da-d582c940a0c7.JPG',
    '/memories/e0618077-191d-4805-b0b2-eeb0b1ca263e.JPG',
    '/memories/e5a59266-912f-4ecf-8ac0-1b8abdcf200c.JPG',
    '/memories/fc90b5e2-bc5b-4ae2-98f4-c14950b61788.JPG'
  ];

  // The specific 6 images ("die alten") for the film strips
  const filmImages = [
    '/memories/IMG_8099.jpg',
    '/memories/IMG_8100.jpg',
    '/memories/IMG_8101.jpg',
    '/memories/IMG_8102.jpg',
    '/memories/IMG_8105.jpg',
    '/memories/IMG_8106.jpg'
  ];

  // Use distinct sets of images for the two strips
  const strip1Images = filmImages.slice(0, 3);
  const strip2Images = filmImages.slice(3, 6);

  // Combine props images with new memories for variety
  // And FILTER to remove DNGs (if any crept in)
  const allImages = [...images, ...memoryImages];
  
  // Polaroid should show "restliche bilder außer die im film"
  // Filter out images that are in the film strip and DNGs
  const polaroidImages = Array.from(new Set(allImages)).filter(src => 
    !filmImages.includes(src) && !src.toLowerCase().endsWith('.dng')
  );

  // Preload images to prevent lag
  useEffect(() => {
    [...polaroidImages, ...filmImages].forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, [polaroidImages, filmImages]);

  // SVG for Vintage Camera Decoration - SCALED UP
  const VintageCamera = () => (
    <svg width="280" height="280" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg" className="camera-svg">
      <rect x="20" y="60" width="160" height="100" rx="10" fill="#222" stroke="#111" strokeWidth="2"/>
      <rect x="20" y="60" width="160" height="40" rx="10" fill="#333"/>
      <circle cx="100" cy="110" r="35" fill="#111" stroke="#444" strokeWidth="3"/>
      <circle cx="100" cy="110" r="25" fill="#000" stroke="#222" strokeWidth="2"/>
      <circle cx="110" cy="100" r="5" fill="rgba(255,255,255,0.6)"/>
      <rect x="140" y="70" width="30" height="20" rx="2" fill="#111"/>
      <rect x="30" y="40" width="40" height="20" rx="2" fill="#222"/>
      <circle cx="160" cy="50" r="8" fill="#444"/>
    </svg>
  );

  return (
    <div className="content-page photos-page-container">
      <motion.h2 
        className="page-title photo-title"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        style={{ fontFamily: "'Playfair Display', serif", fontStyle: "italic" }}
      >
        Ein schönes jahr mit der schönsten person ❤️
      </motion.h2>

      <div className="gallery-layout">
        {/* Left: Camera Decoration - Larger and Behind */}
        <motion.div 
          className="decoration-left"
          initial={{ x: -50, opacity: 0, rotate: -10 }}
          animate={{ x: 0, opacity: 1, rotate: -5 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          style={{ transform: 'scale(1.5)', transformOrigin: 'right center' }} 
        >
          <VintageCamera />
        </motion.div>

        {/* Center: Main Polaroid */}
        <motion.div
          className="main-polaroid-wrapper"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <PolaroidPhoto 
            images={polaroidImages} 
            caption="PRADA"
            rotation={-2}
          />
          
          {/* Slideshow Indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2, duration: 1 }}
            style={{
              position: 'absolute',
              bottom: '-40px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#4a4a4a',
              fontSize: '0.8rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: 0.7
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>👆</span> 
            <span style={{ fontStyle: 'italic', fontFamily: "'Playfair Display', serif" }}>
              Diashow &mdash; Warten für mehr
            </span>
          </motion.div>
        </motion.div>

        {/* Right: Two Film Strips - Layered */}
        {/* Right: Two Film Strips - Layered */}
        <motion.div 
          className="decoration-right"
          style={{ position: 'relative', width: '320px' }} 
        >
          {/* First Strip - Less tilted, starts higher */}
          <div style={{ 
            position: 'absolute', 
            top: '-130px', /* Aligning better with top of polaroid */
            left: '30px', 
            transform: 'rotate(4deg)',
            zIndex: 2
          }}>
            <FilmStrip images={strip1Images} rotation={0} />
          </div>
          
          {/* Second Strip - More tilted, further away from first */}
          <div style={{ 
            position: 'absolute', 
            top: '-70px', 
            left: '170px', 
            transform: 'rotate(15deg)',
            zIndex: 1 
          }}>
            <FilmStrip images={strip2Images} rotation={0} />
          </div>
        </motion.div>
      </div>

      <PageNavigation
        currentPage={currentPage}
        totalPages={totalPages}
        onNext={onNext}
        onPrev={onPrev}
      />
    </div>
  );
};

export default PhotosPage;
