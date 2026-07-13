import { ChevronLeft, ChevronRight } from 'lucide-react';
import './PageNavigation.css';

interface PageNavigationProps {
  currentPage: number;
  totalPages: number;
  onNext?: () => void;
  onPrev?: () => void;
  showNext?: boolean;
  showPrev?: boolean;
  nextLabel?: string;
  prevLabel?: string;
}

const PageNavigation = ({
  currentPage,
  totalPages,
  onNext,
  onPrev,
  showNext = true,
  showPrev = true,
  nextLabel = "Weiter",
  prevLabel = "Zurück"
}: PageNavigationProps) => {
  return (
    <div className="page-navigation">
      {showPrev && currentPage > 0 && (
        <button className="nav-btn glass" onClick={onPrev}>
          <ChevronLeft size={18} />
          {prevLabel}
        </button>
      )}

      <div className="page-indicators">
        {Array.from({ length: totalPages }).map((_, idx) => (
          <div
            key={idx}
            className={`indicator-dot ${idx === currentPage ? 'active' : ''}`}
          />
        ))}
      </div>

      {showNext && currentPage < totalPages - 1 && (
        <button className="nav-btn primary glass" onClick={onNext}>
          {nextLabel}
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
};

export default PageNavigation;
