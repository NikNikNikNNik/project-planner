import test from 'node:test';
import assert from 'node:assert/strict';
import { CreateProjectBody, type ProjectInput, type ActualRecord } from '@workspace/api-zod';
import { actualRecordErrors } from './actual-records';

function check(records: ActualRecord[]) {
  return actualRecordErrors({ settings: { actualRecords: records } } as ProjectInput);
}
const hire: ActualRecord = { id: 'hire', kind: 'hire', date: '2026-01-10', shopId: 's', roleId: 'r', people: 2 };
test('facts require valid dates, unique ids and kind-specific inputs', () => {
  assert.deepEqual(check([hire]), []);
  assert.ok(check([hire, hire]).length > 0);
  assert.ok(check([{ ...hire, date: '2026-02-30' }]).length > 0);
  assert.ok(check([{ ...hire, people: undefined }]).length > 0);
  assert.ok(check([{ ...hire, kind: 'training' }]).length > 0);
  assert.deepEqual(check([{ ...hire, kind: 'training', eventId: 'e', days: 2, deliveryMode: 'atyrau' }]), []);
  assert.ok(check([{ ...hire, kind: 'payroll' }]).length > 0);
  assert.deepEqual(check([{ ...hire, kind: 'training_cost', amountKzt: 0 }]), []);
});
test('generated contracts preserve facts and per-person travel and reject negative amounts', () => {
  const schema = CreateProjectBody.shape.settings.shape.actualRecords.unwrap();
  assert.deepEqual(schema.parse([hire]), [hire]);
  assert.equal(schema.safeParse([{ ...hire, people: -1 }]).success, false);
  const training = CreateProjectBody.shape.training.element;
  const event = { id: 'e', title: 'Курс', category: 'technology', duration: 2, unit: 'days', shopIds: ['s'], roleIds: ['r'], note: null, status: 'planned', sortOrder: 0, deliveryMode: 'offsite', travelCostPerPersonKzt: 10000 };
  assert.equal(training.parse(event).travelCostPerPersonKzt, 10000);
  assert.equal(training.safeParse({ ...event, travelCostPerPersonKzt: -1 }).success, false);
});
