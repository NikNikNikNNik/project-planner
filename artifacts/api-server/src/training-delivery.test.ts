import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CreateProjectBody, UpdateProjectBody } from '@workspace/api-zod';

const event = {
  id: 'format-check', title: 'Проверка', category: 'technology', duration: 5,
  unit: 'days', shopIds: [], roleIds: [], note: null, status: 'planned', sortOrder: 0,
};

test('create and update contracts preserve all delivery modes and accept legacy events', () => {
  for (const schema of [CreateProjectBody.shape.training.element, UpdateProjectBody.shape.training.element]) {
    for (const deliveryMode of ['online', 'atyrau', 'offsite']) {
      const result = schema.parse({ ...event, deliveryMode });
      assert.equal(result.deliveryMode, deliveryMode);
    }
    assert.equal(schema.parse(event).deliveryMode, undefined);
    assert.equal(schema.safeParse({ ...event, deliveryMode: 'invented' }).success, false);
  }
});
