import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferTrainingDelivery, trainingDeliveryLabel } from './training-delivery.ts';
import { parseProjectBackup, serializeProjectBackup } from './project-backup.ts';

test('formats have explicit Russian labels; unknown values are not guessed', () => {
  assert.equal(trainingDeliveryLabel({ deliveryMode: 'online' }), 'Онлайн');
  assert.equal(trainingDeliveryLabel({ deliveryMode: 'atyrau' }), 'В г. Атырау');
  assert.equal(trainingDeliveryLabel({ deliveryMode: 'offsite' }), 'Выездное');
  assert.equal(trainingDeliveryLabel({}), 'Формат не указан');
  assert.equal(trainingDeliveryLabel({ deliveryMode: 'other' }), 'Формат не указан');
});

test('inferred modes use course evidence without treating generic management practices as site work', () => {
  assert.equal(inferTrainingDelivery({ title: 'Обучение (вебинар)', category: 'mandatory' }).mode, 'online');
  assert.equal(inferTrainingDelivery({ title: 'Охрана труда (теоретический курс)', category: 'mandatory' }).mode, 'online');
  assert.equal(inferTrainingDelivery({ title: 'Охрана труда и промышленная безопасность', category: 'mandatory' }).mode, 'atyrau');
  assert.equal(inferTrainingDelivery({ title: 'Котлы и теплообменники практика', category: 'technology' }).mode, 'offsite');
  assert.equal(inferTrainingDelivery({ title: 'Модули по практикам СРР для руководителей', category: 'other' }).mode, 'atyrau');
  assert.equal(inferTrainingDelivery({ title: 'Общие принципы эксплуатации насосов', category: 'technology' }).mode, 'atyrau');
  assert.equal(inferTrainingDelivery({ title: 'Хроматографические методы анализа (практический курс)', category: 'technology' }).mode, 'atyrau');
  assert.equal(inferTrainingDelivery({ title: 'Актуальные практические вопросы по ценообразованию', category: 'other' }).mode, 'atyrau');
  assert.equal(inferTrainingDelivery({ title: 'Курс повторный', category: 'other', deliveryMode: 'offsite' }).wasAlreadySet, true);
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
