import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project, Role, Shop, TrainingEvent } from '@workspace/api-client-react';
import { getRoleTrainingPlan, getShopRoleSummary } from './training-planning.ts';

const shopId = 'shop-a';
const roleA: Role = { id: 'role-a', name: 'Технолог', group: 'itr', visible: true };
const roleB: Role = { id: 'role-b', name: 'Оператор', group: 'workers', visible: true };
const hiddenRole: Role = { id: 'role-hidden', name: 'Скрытая роль', group: 'itr', visible: false };
const shop: Shop = { id: shopId, name: 'Цех A', roles: [roleA, roleB, hiddenRole] };

function training(
  id: string,
  title: string,
  duration: number,
  shopIds: string[],
  roleIds: string[],
  sortOrder: number,
): TrainingEvent {
  return {
    id,
    title,
    category: 'mandatory',
    duration,
    unit: 'days',
    shopIds,
    roleIds,
    note: null,
    status: 'planned',
    sortOrder,
  };
}

function project(calculationMode: 'sequential' | 'parallel'): Project {
  return {
    id: 'project-a',
    title: 'План',
    startDate: '2026-06-01',
    endDate: '2027-06-01',
    updatedAt: '2026-05-01T00:00:00.000Z',
    shops: [shop],
    phases: [],
    milestones: {
      mc: { date: null, note: null, shopIds: [] },
      rfsu: { date: null, note: null, shopIds: [] },
    },
    training: [
      training('general', 'Общее обучение', 2, [shopId], [], 0),
      training('role-a', 'Обучение технолога', 3, [shopId], [roleA.id], 1),
      training('role-b', 'Обучение оператора', 9, [shopId], [roleB.id], 2),
      training('other-shop', 'Обучение другой площадки', 20, ['shop-b'], [], 3),
      training('zero', 'Обучение нулевой длительности', 0, [shopId], [roleA.id], 4),
    ],
    settings: {
      calculationMode,
      readyMode: 'fixed',
      readyDate: null,
      daysBeforeMc: 0,
      dayType: 'calendar',
      contractDate: null,
    },
  };
}

test('collapsed shop summary includes only active roles in the correct groups', () => {
  const summary = getShopRoleSummary(shop);
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.roles.map(role => role.name), ['Технолог', 'Оператор']);
  assert.deepEqual(summary.itr.map(role => role.name), ['Технолог']);
  assert.deepEqual(summary.workers.map(role => role.name), ['Оператор']);
});

test('expanded role schedule includes assigned and shop-wide training only, sequentially', () => {
  const plan = getRoleTrainingPlan(project('sequential'), shopId, roleA.id, '2026-06-20');

  assert.deepEqual(plan.events.map(event => event.id), ['general', 'role-a', 'zero']);
  assert.equal(plan.totalDays, 5);
  assert.deepEqual(
    plan.schedule.map(({ event, startDate, endDate, durationDays }) => ({
      id: event.id,
      startDate,
      endDate,
      durationDays,
    })),
    [
      { id: 'general', startDate: '2026-06-15', endDate: '2026-06-17', durationDays: 2 },
      { id: 'role-a', startDate: '2026-06-17', endDate: '2026-06-20', durationDays: 3 },
    ],
  );
  assert.equal(plan.startDate, '2026-06-15');
  assert.equal(plan.endDate, '2026-06-20');
  assert.equal(plan.readyDate, '2026-06-20');
  assert.equal(plan.hasTrainingBar, true);
});

test('expanded role schedule shows the longest assigned training in parallel mode', () => {
  const plan = getRoleTrainingPlan(project('parallel'), shopId, roleA.id, '2026-06-20');

  assert.equal(plan.totalDays, 3);
  assert.deepEqual(
    plan.schedule.map(({ event, startDate, endDate, durationDays }) => ({
      id: event.id,
      startDate,
      endDate,
      durationDays,
    })),
    [
      { id: 'general', startDate: '2026-06-18', endDate: '2026-06-20', durationDays: 2 },
      { id: 'role-a', startDate: '2026-06-17', endDate: '2026-06-20', durationDays: 3 },
    ],
  );
  assert.equal(plan.startDate, '2026-06-17');
  assert.equal(plan.endDate, '2026-06-20');
  assert.equal(plan.hasTrainingBar, true);
});

test('a role without training has no dates or colored training bar', () => {
  const emptyShop: Shop = { ...shop, roles: [roleA] };
  const trainingProject = project('sequential');
  trainingProject.shops = [emptyShop];
  trainingProject.training = trainingProject.training.filter(event => event.id === 'role-b' || event.id === 'other-shop');
  const plan = getRoleTrainingPlan(trainingProject, shopId, roleA.id, '2026-06-20');

  assert.deepEqual(plan.events, []);
  assert.deepEqual(plan.schedule, []);
  assert.equal(plan.totalDays, 0);
  assert.equal(plan.startDate, null);
  assert.equal(plan.endDate, null);
  assert.equal(plan.readyDate, '2026-06-20');
  assert.equal(plan.hasTrainingBar, false);
});
