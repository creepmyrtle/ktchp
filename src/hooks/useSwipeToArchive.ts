import { useRef, useEffect, type RefObject } from 'react';

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

  const THRESHOLD_PX = 100;
  const VELOCITY_THRESHOLD = 0.5; // px/ms

  // Store latest values in refs so event handlers always see current state
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

    let startX = 0;
    let startY = 0;
    let currentDeltaX = 0;
    let startTime = 0;
    let isSwiping = false;
    let directionLocked = false;
    let pointerId: number | null = null;

    function handlePointerDown(e: PointerEvent) {
      if (!enabledRef.current || e.pointerType === 'mouse' || !el) return;
      pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      startX = e.clientX;
      startY = e.clientY;
      currentDeltaX = 0;
      startTime = e.timeStamp;
      isSwiping = false;
      directionLocked = false;
      el.style.transition = 'none';
      el.style.willChange = 'transform';
      if (bgRef.current) bgRef.current.style.willChange = 'opacity';
    }

    function handlePointerMove(e: PointerEvent) {
      if (pointerId === null || e.pointerId !== pointerId || !el) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      const dir = directionRef.current;

      if (!directionLocked) {
        if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
          isSwiping = true;
          directionLocked = true;
        } else if (Math.abs(deltaY) > 10) {
          // Vertical — release capture so browser scrolls normally
          el.releasePointerCapture(e.pointerId);
          pointerId = null;
          return;
        } else {
          return; // Not enough movement yet
        }
      }

      if (!isSwiping) return;

      const isCorrectDirection = dir === 'right' ? deltaX > 0 : deltaX < 0;
      if (!isCorrectDirection) {
        el.style.transform = '';
        currentDeltaX = 0;
        return;
      }

      currentDeltaX = deltaX;
      const absDelta = Math.abs(deltaX);
      const translated = absDelta > THRESHOLD_PX
        ? THRESHOLD_PX + (absDelta - THRESHOLD_PX) * 0.4
        : absDelta;
      const sign = dir === 'right' ? 1 : -1;

      el.style.transform = `translateX(${sign * translated}px)`;
      if (bgRef.current) {
        bgRef.current.style.opacity = `${Math.min(absDelta / THRESHOLD_PX, 1)}`;
      }
    }

    function handlePointerEnd(e: PointerEvent) {
      if (pointerId === null || e.pointerId !== pointerId || !el) return;
      pointerId = null;

      if (!isSwiping) {
        el.style.willChange = '';
        if (bgRef.current) bgRef.current.style.willChange = '';
        return;
      }

      const dir = directionRef.current;
      const absDelta = Math.abs(currentDeltaX);
      const elapsed = e.timeStamp - startTime;
      const velocity = absDelta / Math.max(elapsed, 1);
      const triggered = absDelta >= THRESHOLD_PX || (velocity > VELOCITY_THRESHOLD && absDelta > 40);

      el.style.transition = 'transform 0.3s ease';

      if (triggered && canArchiveRef.current) {
        const sign = dir === 'right' ? 1 : -1;
        el.style.transform = `translateX(${sign * 120}%)`;
        setTimeout(() => onArchiveRef.current(), 200);
      } else if (triggered && !canArchiveRef.current) {
        el.style.transform = '';
        if (bgRef.current) bgRef.current.style.opacity = '0';
        onSwipeBlockedRef.current?.();
      } else {
        el.style.transform = '';
        if (bgRef.current) bgRef.current.style.opacity = '0';
      }

      isSwiping = false;
      directionLocked = false;

      setTimeout(() => {
        el.style.willChange = '';
        if (bgRef.current) bgRef.current.style.willChange = '';
      }, 350);
    }

    function handlePointerCancel(e: PointerEvent) {
      if (pointerId === null || e.pointerId !== pointerId || !el) return;
      pointerId = null;
      el.style.transform = '';
      el.style.transition = '';
      el.style.willChange = '';
      if (bgRef.current) {
        bgRef.current.style.opacity = '0';
        bgRef.current.style.willChange = '';
      }
      isSwiping = false;
      directionLocked = false;
    }

    el.addEventListener('pointerdown', handlePointerDown);
    el.addEventListener('pointermove', handlePointerMove);
    el.addEventListener('pointerup', handlePointerEnd);
    el.addEventListener('pointercancel', handlePointerCancel);

    return () => {
      el.removeEventListener('pointerdown', handlePointerDown);
      el.removeEventListener('pointermove', handlePointerMove);
      el.removeEventListener('pointerup', handlePointerEnd);
      el.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, []);

  return { ref, bgRef };
}
