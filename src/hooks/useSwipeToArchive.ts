import { useRef, useEffect, type RefObject } from 'react';

interface SwipeConfig {
  onArchive: () => void;
  canArchive: boolean;
  onSwipeBlocked?: () => void;
  direction?: 'right' | 'left';
  enabled?: boolean;
}

interface SwipeState {
  scrollRef: RefObject<HTMLDivElement | null>;
  indicatorRef: RefObject<HTMLDivElement | null>;
}

// Width of the archive zone — snap triggers at roughly half this distance
export const SWIPE_ZONE_PX = 150;

export function useSwipeToArchive({
  onArchive,
  canArchive,
  onSwipeBlocked,
  direction = 'right',
  enabled = true,
}: SwipeConfig): SwipeState {
  const scrollRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);

  const enabledRef = useRef(enabled);
  const canArchiveRef = useRef(canArchive);
  const directionRef = useRef(direction);
  const onArchiveRef = useRef(onArchive);
  const onSwipeBlockedRef = useRef(onSwipeBlocked);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { canArchiveRef.current = canArchive; }, [canArchive]);
  useEffect(() => { directionRef.current = direction; }, [direction]);
  useEffect(() => { onArchiveRef.current = onArchive; }, [onArchive]);
  useEffect(() => { onSwipeBlockedRef.current = onSwipeBlocked; }, [onSwipeBlocked]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const dir = directionRef.current;
    // Home scroll position: show card, hide archive zone
    const home = dir === 'right' ? SWIPE_ZONE_PX : 0;

    // Set initial position without animation
    el.style.scrollBehavior = 'auto';
    el.scrollLeft = home;
    el.style.scrollBehavior = '';

    let triggered = false;
    let scrollEndTimer: ReturnType<typeof setTimeout>;

    function handleScroll() {
      if (!el || triggered) return;

      // Compute how far the user has scrolled away from home
      const scrolled = dir === 'right'
        ? home - el.scrollLeft
        : el.scrollLeft;
      const progress = Math.max(0, Math.min(1, scrolled / SWIPE_ZONE_PX));

      if (indicatorRef.current) {
        indicatorRef.current.style.opacity = `${progress}`;
      }

      // Debounced scroll-end fallback
      clearTimeout(scrollEndTimer);
      scrollEndTimer = setTimeout(checkScrollEnd, 150);
    }

    function checkScrollEnd() {
      if (!el || triggered || !enabledRef.current) return;

      const archivePos = dir === 'right' ? 0 : SWIPE_ZONE_PX;
      const atArchive = Math.abs(el.scrollLeft - archivePos) < SWIPE_ZONE_PX * 0.3;

      if (atArchive) {
        if (canArchiveRef.current) {
          triggered = true;
          onArchiveRef.current();
        } else {
          el.scrollTo({ left: home, behavior: 'smooth' });
          onSwipeBlockedRef.current?.();
        }
      }
    }

    el.addEventListener('scroll', handleScroll, { passive: true });
    el.addEventListener('scrollend', checkScrollEnd);

    return () => {
      clearTimeout(scrollEndTimer);
      el.removeEventListener('scroll', handleScroll);
      el.removeEventListener('scrollend', checkScrollEnd);
    };
  }, []);

  return { scrollRef, indicatorRef };
}
