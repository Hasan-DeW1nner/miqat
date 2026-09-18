import { useEffect, useRef, type RefObject, type PointerEvent } from 'react';

/** Screen coordinates make scrubbing independent of RTL scrollLeft conventions. */
export function useBarGesture(ref: RefObject<HTMLDivElement | null>, select: (element: HTMLElement) => void, disabled = false) {
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
    scrubbing: boolean;
    target: HTMLElement | null;
  } | null>(null);
  const frame = useRef(0);
  const suppress = useRef(false);
  const suppressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    cancelAnimationFrame(frame.current);
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
  }, []);
  const nearest = (x: number): HTMLElement | null => {
    let best: HTMLElement | null = null;
    let distance = Infinity;
    ref.current?.querySelectorAll<HTMLElement>('.tabbar-item').forEach((node) => {
      const box = node.getBoundingClientRect();
      const d = Math.abs(x - box.left - box.width / 2);
      if (d < distance) { distance = d; best = node; }
    });
    return best;
  };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    suppress.current = false;
    const origin = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.tabbar-item')
      : null;
    gesture.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      scrubbing: origin?.getAttribute('aria-selected') === 'true',
      target: origin ?? nearest(event.clientX),
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const bar = ref.current;
    if (!g || !bar || event.pointerId !== g.id) return;
    if (!g.moved && Math.abs(event.clientY - g.y) > Math.abs(event.clientX - g.x)) return;
    if (!g.moved && Math.abs(event.clientX - g.x) < 6) return;
    g.moved = true;
    if (!g.scrubbing) return;
    bar.setPointerCapture(g.id);
    event.preventDefault();
    cancelAnimationFrame(frame.current);
    const x = event.clientX;
    const step = () => {
      const box = bar.getBoundingClientRect();
      if (bar.scrollWidth > bar.clientWidth) bar.scrollLeft += x < box.left + 32 ? -5 : x > box.right - 32 ? 5 : 0;
      g.target = nearest(x);
      const lens = bar.querySelector<HTMLElement>('.segmented-lens');
      if (lens && g.target) {
        lens.style.transform = `translateX(${g.target.offsetLeft}px)`;
        lens.style.width = `${g.target.offsetWidth}px`;
      }
      frame.current = requestAnimationFrame(step);
    };
    step();
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    cancelAnimationFrame(frame.current);
    gesture.current = null;
    if (ref.current?.hasPointerCapture(g.id)) ref.current.releasePointerCapture(g.id);
    if (!g.moved) return;
    suppress.current = true;
    if (suppressTimer.current) clearTimeout(suppressTimer.current);
    suppressTimer.current = setTimeout(() => { suppress.current = false; }, 50);
    if (g.scrubbing) {
      if (event.type !== 'pointercancel' && g.target) select(g.target);
    }
  };
  return { onPointerDown: down, onPointerMove: move, onPointerUp: end, onPointerCancel: end,
    onClickCapture: (event: React.MouseEvent) => {
      if (!suppress.current) return;
      event.preventDefault();
      event.stopPropagation();
      suppress.current = false;
      if (suppressTimer.current) clearTimeout(suppressTimer.current);
      suppressTimer.current = null;
    } };
}
