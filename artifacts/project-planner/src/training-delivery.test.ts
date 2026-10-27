import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trainingDeliveryLabel } from './training-delivery.ts';
import { parseProjectBackup, serializeProjectBackup } from './project-backup.ts';

test('formats have explicit Russian labels; unknown values are not guessed', () => {
  assert.equal(trainingDeliveryLabel({ deliveryMode: 'online' }), 'Онлайн');
  assert.equal(trainingDeliveryLabel({ deliveryMode: 'atyrau' }), 'В г. Атырау');
  assert.equal(trainingDeliveryLabel({ deliveryMode: 'offsite' }), 'Выездное');
  assert.equal(trainingDeliveryLabel({}), 'Формат не указан');
  assert.equal(trainingDeliveryLabel({ deliveryMode: 'other' }), 'Формат не указан');
});

test('project backup preserves training delivery format', () => {
  const project = {
    title: 'Проверка форматов', startDate: '2028-01-01', endDate: '2029-01-01',
    shops: [], phases: [], milestones: { mc: {}, rfsu: {} }, settings: {},
    training: ['online', 'atyrau', 'offsite'].map(deliveryMode => ({ deliveryMode })),
  };
  const restored = parseProjectBackup(serializeProjectBackup(project as never));
  assert.deepEqual(restored.training, project.training);
});
