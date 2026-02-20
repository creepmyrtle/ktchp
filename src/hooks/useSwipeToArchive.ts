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
  const rafId = useRef(0);

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

    let moveCount = 0;
    let rafCount = 0;
    let preventedCount = 0;
    let lastMoveTime = 0;

    function handleTouchStart(e: TouchEvent) {
      if (!enabledRef.current) return;
      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      currentX.current = 0;
      isSwiping.current = false;
      isScrollLocked.current = false;
      startTime.current = Date.now();
      moveCount = 0;
      rafCount = 0;
      preventedCount = 0;
      lastMoveTime = 0;
      if (ref.current) {
        ref.current.style.transition = 'none';
        ref.current.style.willChange = 'transform';
      }
      if (bgRef.current) {
        bgRef.current.style.willChange = 'opacity';
      }
      console.log('[swipe] touchstart', { x: touch.clientX, y: touch.clientY, enabled: enabledRef.current });
    }

    function handleTouchMove(e: TouchEvent) {
      if (!enabledRef.current) return;
      const now = performance.now();
      const sinceLast = lastMoveTime ? Math.round(now - lastMoveTime) : 0;
      lastMoveTime = now;
      moveCount++;

      const touch = e.touches[0];
      const deltaX = touch.clientX - startX.current;
      const deltaY = touch.clientY - startY.current;
      const dir = directionRef.current;

      // Determine swipe vs scroll
      if (!isScrollLocked.current && !isSwiping.current) {
        if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
          isSwiping.current = true;
          isScrollLocked.current = true;
          console.log('[swipe] locked horizontal', { deltaX: Math.round(deltaX), deltaY: Math.round(deltaY), moveCount });
        } else if (Math.abs(deltaY) > 10) {
          if (moveCount <= 3) console.log('[swipe] aborted — vertical scroll', { deltaX: Math.round(deltaX), deltaY: Math.round(deltaY) });
          return;
        }
      }

      if (!isSwiping.current) return;

      // Prevent vertical scrolling during swipe
      e.preventDefault();
      preventedCount++;

      // Log if preventDefault is being ignored (cancelable check)
      if (moveCount <= 5 || moveCount % 20 === 0) {
        console.log('[swipe] touchmove', {
          moveCount,
          deltaX: Math.round(deltaX),
          cancelable: e.cancelable,
          defaultPrevented: e.defaultPrevented,
          intervalMs: sinceLast,
        });
      }

      currentX.current = deltaX;

      // Batch DOM updates to next frame
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        rafCount++;
        const isCorrectDirection = dir === 'right' ? deltaX > 0 : deltaX < 0;
        if (!isCorrectDirection) {
          if (ref.current) ref.current.style.transform = '';
          return;
        }

        const absDelta = Math.abs(deltaX);
        const translated = absDelta > THRESHOLD_PX
          ? THRESHOLD_PX + (absDelta - THRESHOLD_PX) * 0.4
          : absDelta;

        if (ref.current) {
          const sign = dir === 'right' ? 1 : -1;
          ref.current.style.transform = `translateX(${sign * translated}px)`;
        }
        if (bgRef.current) {
          bgRef.current.style.opacity = `${Math.min(absDelta / THRESHOLD_PX, 1)}`;
        }
      });
    }

    function handleTouchEnd() {
      const wasSwiping = isSwiping.current;
      if (!enabledRef.current || !wasSwiping) {
        console.log('[swipe] touchend (ignored)', { enabled: enabledRef.current, wasSwiping, moveCount });
        return;
      }
      cancelAnimationFrame(rafId.current);
      const dir = directionRef.current;

      const absDelta = Math.abs(currentX.current);
      const elapsed = Date.now() - startTime.current;
      const velocity = absDelta / Math.max(elapsed, 1);

      const triggered = absDelta >= THRESHOLD_PX || (velocity > VELOCITY_THRESHOLD && absDelta > 40);

      console.log('[swipe] touchend', {
        absDelta: Math.round(absDelta),
        elapsed,
        velocity: velocity.toFixed(3),
        triggered,
        canArchive: canArchiveRef.current,
        moveCount,
        rafCount,
        preventedCount,
      });

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

      // Clear will-change after transition completes to free GPU memory
      setTimeout(() => {
        if (ref.current) ref.current.style.willChange = '';
        if (bgRef.current) bgRef.current.style.willChange = '';
      }, 350);
    }

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      cancelAnimationFrame(rafId.current);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, []); // stable — reads current values from refs

  return { ref, bgRef };
}
