import { useRef, useEffect, useCallback, type RefObject } from 'react';

interface SwipeConfig {
  onArchive: () => void;
  canArchive: boolean;
  onSwipeBlocked?: () => void;
  direction?: 'right' | 'left';
  enabled?: boolean;
}

interface SwipeState {
  ref: RefObject<HTMLDivElement | null>;
  bgRef: RefObject<HTMLDivElement | null>;
}

export function useSwipeToArchive({
  onArchive,
  canArchive,
  onSwipeBlocked,
  direction = 'right',
  enabled = true,
}: SwipeConfig): SwipeState {
  const ref = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentX = useRef(0);
  const isSwiping = useRef(false);
  const isScrollLocked = useRef(false);
  const startTime = useRef(0);

  const THRESHOLD_PX = 100;
  const VELOCITY_THRESHOLD = 0.5; // px/ms

  // Store latest values in refs so native listeners always see current state
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
    const el = ref.current;
    if (!el) return;

    function handleTouchStart(e: TouchEvent) {
      if (!enabledRef.current) return;
      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      currentX.current = 0;
      isSwiping.current = false;
      isScrollLocked.current = false;
      startTime.current = Date.now();
      if (ref.current) {
        ref.current.style.transition = 'none';
      }
    }

    function handleTouchMove(e: TouchEvent) {
      if (!enabledRef.current) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - startX.current;
      const deltaY = touch.clientY - startY.current;
      const dir = directionRef.current;

      // Determine swipe vs scroll
      if (!isScrollLocked.current && !isSwiping.current) {
        if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
          isSwiping.current = true;
          isScrollLocked.current = true;
        } else if (Math.abs(deltaY) > 10) {
          // Vertical scroll — abort swipe
          return;
        }
      }

      if (!isSwiping.current) return;

      // Prevent vertical scrolling during swipe
      e.preventDefault();

      // Check direction
      const isCorrectDirection = dir === 'right' ? deltaX > 0 : deltaX < 0;
      if (!isCorrectDirection) {
        if (ref.current) ref.current.style.transform = '';
        return;
      }

      const absDelta = Math.abs(deltaX);
      // Apply resistance after threshold
      const translated = absDelta > THRESHOLD_PX
        ? THRESHOLD_PX + (absDelta - THRESHOLD_PX) * 0.4
        : absDelta;

      currentX.current = deltaX;

      if (ref.current) {
        const sign = dir === 'right' ? 1 : -1;
        ref.current.style.transform = `translateX(${sign * translated}px)`;
      }
      if (bgRef.current) {
        bgRef.current.style.opacity = `${Math.min(absDelta / THRESHOLD_PX, 1)}`;
      }
    }

    function handleTouchEnd() {
      if (!enabledRef.current || !isSwiping.current) return;
      const dir = directionRef.current;

      const absDelta = Math.abs(currentX.current);
      const elapsed = Date.now() - startTime.current;
      const velocity = absDelta / Math.max(elapsed, 1);

      const triggered = absDelta >= THRESHOLD_PX || (velocity > VELOCITY_THRESHOLD && absDelta > 40);

      if (ref.current) {
        ref.current.style.transition = 'transform 0.3s ease';
      }

      if (triggered && canArchiveRef.current) {
        if (ref.current) {
          const sign = dir === 'right' ? 1 : -1;
          ref.current.style.transform = `translateX(${sign * 120}%)`;
        }
        setTimeout(() => onArchiveRef.current(), 200);
      } else if (triggered && !canArchiveRef.current) {
        if (ref.current) {
          ref.current.style.transform = '';
        }
        if (bgRef.current) {
          bgRef.current.style.opacity = '0';
        }
        onSwipeBlockedRef.current?.();
      } else {
        if (ref.current) {
          ref.current.style.transform = '';
        }
        if (bgRef.current) {
          bgRef.current.style.opacity = '0';
        }
      }

      isSwiping.current = false;
      isScrollLocked.current = false;
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, []); // stable — reads current values from refs

  return { ref, bgRef };
}
