import assert from 'node:assert/strict';
import test from 'node:test';
import { isTimelineInteractiveTarget } from './timeline-interactions.ts';

test('timeline dragging ignores nested controls, including SVG icon targets', () => {
  let selector = '';
  const svgTarget = {
    closest(value: string) {
      selector = value;
      return {};
    },
  } as unknown as EventTarget;
  assert.equal(isTimelineInteractiveTarget(svgTarget), true);
  assert.match(selector, /button/);
});

test('timeline background and non-element targets remain safe', () => {
  assert.equal(isTimelineInteractiveTarget({ closest: () => null } as unknown as EventTarget), false);
  assert.equal(isTimelineInteractiveTarget(new EventTarget()), false);
  assert.equal(isTimelineInteractiveTarget(null), false);
});
