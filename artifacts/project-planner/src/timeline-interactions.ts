const interactiveSelector = 'button, input, select, textarea, a, [role="button"], [contenteditable="true"]';

export function isTimelineInteractiveTarget(target: EventTarget | null): boolean {
  // SVG icons also implement closest(); HTMLElement-only checks miss icon clicks.
  const element = target as (EventTarget & { closest?: (selector: string) => Element | null }) | null;
  return typeof element?.closest === 'function' && element.closest(interactiveSelector) !== null;
}
