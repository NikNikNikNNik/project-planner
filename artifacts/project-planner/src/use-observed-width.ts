import { useEffect, useRef, useState } from 'react';

/**
 * Measures a responsive track without committing React layout updates inside
 * the ResizeObserver delivery cycle.
 */
export function useObservedWidth<T extends HTMLElement>(initialWidth = 576) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initialWidth);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;

    let frame = 0;
    const observer = new ResizeObserver(entries => {
      const measuredWidth = Math.round(entries[0]?.contentRect.width ?? 0);
      if (measuredWidth <= 0) return;

      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        setWidth(current => current === measuredWidth ? current : measuredWidth);
      });
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return { ref, width };
}
