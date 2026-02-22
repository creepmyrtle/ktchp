import { useRef, useEffect } from 'react';

interface SwipeConfig {
  onArchive: () => void;
  canArchive: boolean;
  direction?: 'right' | 'left';
}

export function useSwipeToArchive({
  onArchive,
  canArchive,
  direction = 'right',
}: SwipeConfig) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const indicator = indicatorRef.current;
    if (!el || !indicator) return;

    const indicatorWidth = indicator.offsetWidth || 120;
    const home = direction === 'right' ? indicatorWidth : 0;

    // Use requestAnimationFrame to prevent DOM thrashing (Firefox fix)
    requestAnimationFrame(() => {
      if (el.scrollLeft === 0 && direction === 'right') {
        el.style.scrollBehavior = 'auto';
        el.scrollLeft = home;
        el.style.scrollBehavior = '';
      }
    });

    const handleScroll = () => {
      const current = el.scrollLeft;
      const distance = direction === 'right' ? home - current : current;
      const progress = Math.max(0, Math.min(1, distance / indicatorWidth));
      indicator.style.opacity = `${progress}`;
    };

    const handleTouchEnd = () => {
      if (!canArchive) return;

      const current = el.scrollLeft;
      const distance = direction === 'right' ? home - current : current;

      if (distance > indicatorWidth * 0.4) {
        onArchive();
      }
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, [onArchive, canArchive, direction]);

  return { scrollRef, indicatorRef };
}
