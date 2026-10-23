import assert from 'node:assert/strict';
import test from 'node:test';
import { getReadableTimelineLabelIndexes } from './timeline-labels.ts';

test('monthly labels are sampled across a dense timeline and include both ends', () => {
  const indexes = [...getReadableTimelineLabelIndexes(81, 1215, 76)];
  assert.equal(indexes.length, 13);
  assert.equal(indexes[0], 0);
  assert.equal(indexes.at(-1), 80);
  assert.ok(indexes.every((value, index) => index === 0 || value > indexes[index - 1]));
  assert.ok(indexes.slice(1).every((value, index) => value - indexes[index] >= 6));
});

test('all monthly labels appear when the timeline has enough width', () => {
  assert.deepEqual([...getReadableTimelineLabelIndexes(5, 900, 76)], [0, 1, 2, 3, 4]);
});

test('empty and single-point timelines are handled', () => {
  assert.deepEqual([...getReadableTimelineLabelIndexes(0, 900, 76)], []);
  assert.deepEqual([...getReadableTimelineLabelIndexes(1, 900, 76)], [0]);
});
