import { useRef, useEffect, useState, type RefObject, type CSSProperties } from 'react';

interface SwipeGestureConfig {
  onSwipeCommit: (direction: 'left' | 'right') => void;
  reversed?: boolean;
  enabled?: boolean;
}

interface SwipeGestureState {
  cardRef: RefObject<HTMLDivElement | null>;
  style: CSSProperties;
  isSwiping: boolean;
  swipeDirection: 'left' | 'right' | null;
  progress: number;
}

interface TouchRecord {
  x: number;
  t: number;
}

const COMMIT_THRESHOLD = 0.35; // fraction of card width
const VELOCITY_THRESHOLD = 0.5; // px/ms
const DIRECTION_LOCK_PX = 10;
const MAX_ROTATION = 5; // degrees

export function useSwipeGesture({
  onSwipeCommit,
  reversed = false,
  enabled = true,
}: SwipeGestureConfig): SwipeGestureState {
  const cardRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const [progress, setProgress] = useState(0);

  // Mutable refs to avoid re-renders during touch tracking
  const startX = useRef(0);
  const startY = useRef(0);
  const deltaX = useRef(0);
  const locked = useRef<'horizontal' | 'vertical' | null>(null);
  const history = useRef<TouchRecord[]>([]);
  const committed = useRef(false);
  const enabledRef = useRef(enabled);
  const onSwipeCommitRef = useRef(onSwipeCommit);

  useEffect(() => { enabledRef.current = enabled; }, [enabled]);
  useEffect(() => { onSwipeCommitRef.current = onSwipeCommit; }, [onSwipeCommit]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    function handleTouchStart(e: TouchEvent) {
      if (!enabledRef.current || committed.current) return;
      const touch = e.touches[0];
      startX.current = touch.clientX;
      startY.current = touch.clientY;
      deltaX.current = 0;
      locked.current = null;
      history.current = [{ x: touch.clientX, t: Date.now() }];
      setIsSwiping(false);
      setSwipeDirection(null);
      setProgress(0);
      setStyle({ willChange: 'transform' });
    }

    function handleTouchMove(e: TouchEvent) {
      if (!enabledRef.current || committed.current) return;
      const touch = e.touches[0];
      const dx = touch.clientX - startX.current;
      const dy = touch.clientY - startY.current;

      // Direction lock
      if (locked.current === null) {
        if (Math.abs(dx) > DIRECTION_LOCK_PX || Math.abs(dy) > DIRECTION_LOCK_PX) {
          locked.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
          if (locked.current === 'horizontal') {
            setIsSwiping(true);
          }
        }
      }

      if (locked.current !== 'horizontal') return;
      e.preventDefault();

      deltaX.current = dx;
      const cardWidth = el!.offsetWidth || 300;
      const rotation = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, dx * 0.03));
      const p = Math.min(1, Math.abs(dx) / (cardWidth * COMMIT_THRESHOLD));

      // Keep only last 3 positions for velocity calc
      const now = Date.now();
      history.current.push({ x: touch.clientX, t: now });
      if (history.current.length > 4) history.current.shift();

      setSwipeDirection(dx > 0 ? 'right' : dx < 0 ? 'left' : null);
      setProgress(p);
      setStyle({
        transform: `translateX(${dx}px) rotate(${rotation}deg)`,
        willChange: 'transform',
      });
    }

    function handleTouchEnd() {
      if (!enabledRef.current || committed.current || locked.current !== 'horizontal') {
        locked.current = null;
        setIsSwiping(false);
        setSwipeDirection(null);
        setProgress(0);
        setStyle({});
        return;
      }

      const dx = deltaX.current;
      const cardWidth = el!.offsetWidth || 300;

      // Calculate velocity from last ~100ms of touches
      let velocity = 0;
      const h = history.current;
      if (h.length >= 2) {
        const last = h[h.length - 1];
        // find point ~100ms ago
        let ref = h[0];
        for (let i = h.length - 2; i >= 0; i--) {
          if (last.t - h[i].t >= 50) { ref = h[i]; break; }
        }
        const dt = last.t - ref.t;
        if (dt > 0) velocity = Math.abs(last.x - ref.x) / dt;
      }

      const pastThreshold = Math.abs(dx) > cardWidth * COMMIT_THRESHOLD;
      const fastEnough = velocity > VELOCITY_THRESHOLD;

      if (pastThreshold || fastEnough) {
        // Commit: animate off-screen
        committed.current = true;
        const direction: 'left' | 'right' = dx > 0 ? 'right' : 'left';
        const exitX = direction === 'right' ? cardWidth * 1.5 : -cardWidth * 1.5;
        setStyle({
          transform: `translateX(${exitX}px) rotate(${direction === 'right' ? MAX_ROTATION : -MAX_ROTATION}deg)`,
          transition: 'transform 250ms ease-out',
          willChange: 'transform',
        });
        setTimeout(() => {
          onSwipeCommitRef.current(direction);
        }, 250);
      } else {
        // Cancel: spring back
        setStyle({
          transform: 'translateX(0) rotate(0deg)',
          transition: 'transform 200ms ease-out',
        });
        setTimeout(() => {
          setStyle({});
          setIsSwiping(false);
          setSwipeDirection(null);
          setProgress(0);
        }, 200);
      }

      locked.current = null;
      history.current = [];
    }

    // touchstart is passive (only recording)
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    // touchmove is NON-passive (needs preventDefault to block scroll during horizontal swipe)
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return { cardRef, style, isSwiping, swipeDirection, progress };
}
