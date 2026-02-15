import { useRef, useCallback, type RefObject } from 'react';

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
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchMove: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
  };
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

  const THRESHOLD_PX = 100;
  const VELOCITY_THRESHOLD = 0.5; // px/ms

  const startTime = useRef(0);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
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
  }, [enabled]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - startX.current;
    const deltaY = touch.clientY - startY.current;

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
    const isCorrectDirection = direction === 'right' ? deltaX > 0 : deltaX < 0;
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
      const sign = direction === 'right' ? 1 : -1;
      ref.current.style.transform = `translateX(${sign * translated}px)`;
    }
    if (bgRef.current) {
      bgRef.current.style.opacity = `${Math.min(absDelta / THRESHOLD_PX, 1)}`;
    }
  }, [enabled, direction]);

  const onTouchEnd = useCallback(() => {
    if (!enabled || !isSwiping.current) return;

    const absDelta = Math.abs(currentX.current);
    const elapsed = Date.now() - startTime.current;
    const velocity = absDelta / Math.max(elapsed, 1);

    const triggered = absDelta >= THRESHOLD_PX || (velocity > VELOCITY_THRESHOLD && absDelta > 40);

    if (ref.current) {
      ref.current.style.transition = 'transform 0.3s ease';
    }

    if (triggered && canArchive) {
      // Archive
      if (ref.current) {
        const sign = direction === 'right' ? 1 : -1;
        ref.current.style.transform = `translateX(${sign * 120}%)`;
      }
      setTimeout(onArchive, 200);
    } else if (triggered && !canArchive) {
      // Blocked — snap back with shake
      if (ref.current) {
        ref.current.style.transform = '';
      }
      if (bgRef.current) {
        bgRef.current.style.opacity = '0';
      }
      onSwipeBlocked?.();
    } else {
      // Below threshold — snap back
      if (ref.current) {
        ref.current.style.transform = '';
      }
      if (bgRef.current) {
        bgRef.current.style.opacity = '0';
      }
    }

    isSwiping.current = false;
    isScrollLocked.current = false;
  }, [enabled, canArchive, direction, onArchive, onSwipeBlocked]);

  return {
    ref,
    bgRef,
    handlers: { onTouchStart, onTouchMove, onTouchEnd },
  };
}
