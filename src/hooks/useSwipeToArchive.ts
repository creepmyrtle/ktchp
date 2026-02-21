import { useRef, useEffect, useState } from 'react';

interface SwipeConfig {
  onArchive: () => void;
  canArchive: boolean;
  direction?: 'right' | 'left'; //TODO get these with getPreferencesByUserId() 
}

export function useSwipeToArchive({ 
  onArchive, 
  canArchive, 
  direction = 'right' 
}: SwipeConfig) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    const indicator = indicatorRef.current;
    if (!el || !indicator) return;

    // STRUCTURE  "Home" vs "Action" zones change depending if we are r-t-l or l-t-r.
    const indicatorWidth = indicator.offsetWidth || 120; 
    const home = direction === 'right' ? indicatorWidth : 0;

    // STRUCTURE Set initial scroll position and use requestAnimationFrame to prevent DOM thrashing
    requestAnimationFrame(() => {
      if (el.scrollLeft === 0 && direction === 'right') {
         el.style.scrollBehavior = 'auto'; //NOTE snapping toggle
         el.scrollLeft = home;
         el.style.scrollBehavior = ''; 
      }
    });

    // STRUCTURE update opacity based on scroll
    const handleScroll = () => {
      const current = el.scrollLeft;
      const distance = direction === 'right' ? home - current : current;
      // Opacity is 0-1
      const progress = Math.max(0, Math.min(1, distance / indicatorWidth));
      
      indicator.style.opacity = `${progress}`;

    };

    // STRUCTURE commit this chang!
    const handleTouchEnd = () => {
      setIsDragging(false);
      
      if (!canArchive) return;

      const current = el.scrollLeft;
      const distance = direction === 'right' ? home - current : current;
      
      // NOTE Snapping threshold, 0-1
      if (distance > indicatorWidth * 0.4) {
        onArchive();
      }
    };

    const handleTouchStart = () => setIsDragging(true);

    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onArchive, canArchive, direction]);

  return { scrollRef, indicatorRef, isDragging };
}
