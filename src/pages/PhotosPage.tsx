import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import PolaroidPhoto from "../components/PolaroidPhoto/PolaroidPhoto";
import FilmStrip from "../components/FilmStrip/FilmStrip";
import PageNavigation from "../components/Navigation/PageNavigation";
import "./PhotosPage.css";

interface PhotosPageProps {
  images: string[];
  currentPage: number;
  totalPages: number;
  onNext: () => void;
  onPrev: () => void;
}

const resolvePath = (path: string) => {
  return import.meta.env.BASE_URL + path.replace(/^\//, "");
};

// SVG for Vintage Camera Decoration - SCALED UP
// Declared at module scope so it isn't re-created (and doesn't reset state) on every render.
const VintageCamera = () => (
  <svg
    width="280"
    height="280"
    viewBox="0 0 200 200"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="camera-svg"
  >
    <rect
      x="20"
      y="60"
      width="160"
      height="100"
      rx="10"
      fill="#222"
      stroke="#111"
      strokeWidth="2"
    />
    <rect x="20" y="60" width="160" height="40" rx="10" fill="#333" />
    <circle
      cx="100"
      cy="110"
      r="35"
      fill="#111"
      stroke="#444"
      strokeWidth="3"
    />
    <circle
      cx="100"
      cy="110"
      r="25"
      fill="#000"
      stroke="#222"
      strokeWidth="2"
    />
    <circle cx="110" cy="100" r="5" fill="rgba(255,255,255,0.6)" />
    <rect x="140" y="70" width="30" height="20" rx="2" fill="#111" />
    <rect x="30" y="40" width="40" height="20" rx="2" fill="#222" />
    <circle cx="160" cy="50" r="8" fill="#444" />
  </svg>
);

const PhotosPage = ({
  images,
  currentPage,
  totalPages,
  onNext,
  onPrev,
}: PhotosPageProps) => {
  // New images from public/memories
  // New images from public/memories
  // Filtered out .DNG files as they are not supported by browsers
  // Constant per render — memoized so it doesn't churn the preload effect's deps.
  // Web-optimierte Kopien (max. 1600px) statt Original-Fotos aus public/memories/ —
  // die Originale liegen außerhalb von public/ in assets_raw/ (siehe Performance-Plan Ziel 3).
  const memoryImages = useMemo(
    () => [
      resolvePath("/memories/web/05438073-d4bf-42fd-a591-5b79ae40c776.jpg"),
      resolvePath("/memories/web/0dc9a2fa-036a-4d56-b7a4-b7bab7a5ec25.jpg"),
      // HEIC files removed due to browser incompatibility
      resolvePath("/memories/web/IMG_4891.jpg"),
      resolvePath("/memories/web/IMG_4909.jpg"),
      resolvePath("/memories/web/IMG_4913.jpg"),
      resolvePath("/memories/web/IMG_5006.jpg"),
      resolvePath("/memories/web/IMG_6280.jpg"),
      resolvePath("/memories/web/IMG_7321.jpg"),
      resolvePath("/memories/web/IMG_7411.jpg"),
      // DNG Files removed
      resolvePath("/memories/web/IMG_7975.jpg"),
      resolvePath("/memories/web/IMG_7976.jpg"),
      resolvePath("/memories/web/IMG_7977.jpg"),
      resolvePath("/memories/web/IMG_8099.jpg"),
      resolvePath("/memories/web/IMG_8100.jpg"),
      resolvePath("/memories/web/IMG_8101.jpg"),
      resolvePath("/memories/web/IMG_8102.jpg"),
      resolvePath("/memories/web/IMG_8105.jpg"),
      resolvePath("/memories/web/IMG_8106.jpg"),
      resolvePath("/memories/web/a861063c-5a40-4df8-acaf-398ef7aa81a7.jpg"),
      resolvePath("/memories/web/b8b07275-1668-431c-92da-d582c940a0c7.jpg"),
      resolvePath("/memories/web/e0618077-191d-4805-b0b2-eeb0b1ca263e.jpg"),
      resolvePath("/memories/web/e5a59266-912f-4ecf-8ac0-1b8abdcf200c.jpg"),
      resolvePath("/memories/web/fc90b5e2-bc5b-4ae2-98f4-c14950b61788.jpg"),
    ],
    [],
  );

  // The specific 6 images ("die alten") for the film strips
  // Constant per render — memoized so it doesn't churn the preload effect's deps.
  const filmImages = useMemo(
    () => [
      resolvePath("/memories/web/IMG_8099.jpg"),
      resolvePath("/memories/web/IMG_8100.jpg"),
      resolvePath("/memories/web/IMG_8101.jpg"),
      resolvePath("/memories/web/IMG_8102.jpg"),
      resolvePath("/memories/web/IMG_8105.jpg"),
      resolvePath("/memories/web/IMG_8106.jpg"),
    ],
    [],
  );

  // Use distinct sets of images for the two strips
  const strip1Images = filmImages.slice(0, 3);
  const strip2Images = filmImages.slice(3, 6);

  // Polaroid should show "restliche bilder außer die im film"
  // Filter out images that are in the film strip and DNGs
  const polaroidImages = useMemo(() => {
    // Combine props images with new memories for variety
    // And FILTER to remove DNGs (if any crept in)
    const allImages = [...images, ...memoryImages];
    return Array.from(new Set(allImages)).filter(
      (src) => !filmImages.includes(src) && !src.toLowerCase().endsWith(".dng"),
    );
  }, [images, memoryImages, filmImages]);

  // Preload images to prevent lag
  useEffect(() => {
    [...polaroidImages, ...filmImages].forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, [polaroidImages, filmImages]);

  return (
    <div className="content-page photos-page-container">
      <motion.h2
        className="page-title photo-title"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        style={{ fontStyle: "italic" }}
      >
        Ein schönes jahr mit der schönsten person ❤️
      </motion.h2>

      {/* Slideshow Indicator - static subtitle, clear of nav & polaroid */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2, duration: 1 }}
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "6px",
          margin: "-1rem 0",
          color: "#4a4a4a",
          fontSize: "0.8rem",
          opacity: 0.7,
        }}
      >
        <span style={{ fontSize: "1.2rem" }}>👆</span>
        <span style={{ fontStyle: "italic", fontFamily: "var(--font-serif)" }}>
          Diashow &mdash; Warten für mehr
        </span>
      </motion.div>

      <div className="gallery-layout">
        {/* Left: Camera Decoration - Larger and Behind */}
        <motion.div
          className="decoration-left"
          initial={{ x: -50, opacity: 0, rotate: -10 }}
          animate={{ x: 0, opacity: 1, rotate: -5 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          style={{ transform: "scale(1.5)", transformOrigin: "right center" }}
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
        </motion.div>

        {/* Right: Two Film Strips - Layered */}
        {/* Right: Two Film Strips - Layered */}
        <motion.div
          className="decoration-right"
          style={{ position: "relative", width: "320px" }}
        >
          {/* First Strip - Less tilted, starts higher */}
          <div
            style={{
              position: "absolute",
              top: "-130px" /* Aligning better with top of polaroid */,
              left: "30px",
              transform: "rotate(4deg)",
              zIndex: 2,
            }}
          >
            <FilmStrip images={strip1Images} rotation={0} />
          </div>

          {/* Second Strip - More tilted, further away from first */}
          <div
            style={{
              position: "absolute",
              top: "-70px",
              left: "170px",
              transform: "rotate(15deg)",
              zIndex: 1,
            }}
          >
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
