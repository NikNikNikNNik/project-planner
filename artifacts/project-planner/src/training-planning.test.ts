import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project, Role, Shop, TrainingEvent } from '@workspace/api-client-react';
import { getRoleTrainingPlan, getShopRoleSummary, reconcileTrainingRoles } from './training-planning.ts';

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
  unit: TrainingEvent['unit'] = 'days',
): TrainingEvent {
  return {
    id,
    title,
    category: 'mandatory',
    duration,
    unit,
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

test('role reconciliation preserves general training and removes only deleted role assignments', () => {
  const events = [
    training('general', 'Общее обучение', 2, [shopId], [], 0),
    training('both-roles', 'Обучение двух ролей', 3, [shopId], [roleA.id, roleB.id], 1),
    training('only-role-a', 'Обучение только технолога', 4, [shopId], [roleA.id], 2),
    training('stale-role', 'Обучение устаревшей роли', 5, [shopId], ['deleted-role'], 3),
  ];

  assert.deepEqual(
    reconcileTrainingRoles(events, [{ ...shop, roles: [roleB, hiddenRole] }]),
    [
      events[0],
      { ...events[1], roleIds: [roleB.id] },
    ],
  );
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
  assert.equal(plan.contractDate, '2026-06-15');
  assert.equal(plan.readyDate, '2026-06-20');
  assert.equal(plan.hasTrainingBar, true);
});

test('each role gets a contract cutoff based on its own training duration', () => {
  const trainingProject = project('sequential');
  const shorterPlan = getRoleTrainingPlan(trainingProject, shopId, roleA.id, '2026-06-20');
  const longerPlan = getRoleTrainingPlan(trainingProject, shopId, roleB.id, '2026-06-20');

  assert.equal(shorterPlan.contractDate, '2026-06-15');
  assert.equal(longerPlan.contractDate, '2026-06-09');
  assert.notEqual(shorterPlan.contractDate, longerPlan.contractDate);
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
  assert.equal(plan.contractDate, '2026-06-17');
  assert.equal(plan.hasTrainingBar, true);
});

test('sequential role schedule without a ready date uses the contract date or project start', () => {
  const withContractDate = project('sequential');
  withContractDate.settings.contractDate = '2026-06-10';
  const contractPlan = getRoleTrainingPlan(withContractDate, shopId, roleA.id, null);

  assert.deepEqual(contractPlan.events.map(event => event.id), ['general', 'role-a', 'zero']);
  assert.equal(contractPlan.totalDays, 5);
  assert.deepEqual(
    contractPlan.schedule.map(({ event, startDate, endDate, approximate }) => ({
      id: event.id,
      startDate,
      endDate,
      approximate,
    })),
    [
      { id: 'general', startDate: '2026-06-10', endDate: '2026-06-12', approximate: false },
      { id: 'role-a', startDate: '2026-06-12', endDate: '2026-06-15', approximate: false },
    ],
  );
  assert.equal(contractPlan.startDate, '2026-06-10');
  assert.equal(contractPlan.endDate, '2026-06-15');
  assert.equal(contractPlan.contractDate, '2026-06-10');

  const withoutContractDate = getRoleTrainingPlan(project('sequential'), shopId, roleA.id, null);

  assert.deepEqual(withoutContractDate.events.map(event => event.id), ['general', 'role-a', 'zero']);
  assert.equal(withoutContractDate.totalDays, 5);
  assert.deepEqual(
    withoutContractDate.schedule.map(({ event, startDate, endDate, approximate }) => ({
      id: event.id,
      startDate,
      endDate,
      approximate,
    })),
    [
      { id: 'general', startDate: '2026-06-01', endDate: '2026-06-03', approximate: true },
      { id: 'role-a', startDate: '2026-06-03', endDate: '2026-06-06', approximate: true },
    ],
  );
  assert.equal(withoutContractDate.startDate, '2026-06-01');
  assert.equal(withoutContractDate.endDate, '2026-06-06');
  assert.equal(withoutContractDate.contractDate, null);
});

test('parallel role schedule without a ready date uses the contract date or project start', () => {
  const withContractDate = project('parallel');
  withContractDate.settings.contractDate = '2026-06-10';
  const contractPlan = getRoleTrainingPlan(withContractDate, shopId, roleA.id, null);

  assert.deepEqual(contractPlan.events.map(event => event.id), ['general', 'role-a', 'zero']);
  assert.equal(contractPlan.totalDays, 3);
  assert.deepEqual(
    contractPlan.schedule.map(({ event, startDate, endDate, approximate }) => ({
      id: event.id,
      startDate,
      endDate,
      approximate,
    })),
    [
      { id: 'general', startDate: '2026-06-10', endDate: '2026-06-12', approximate: false },
      { id: 'role-a', startDate: '2026-06-10', endDate: '2026-06-13', approximate: false },
    ],
  );
  assert.equal(contractPlan.startDate, '2026-06-10');
  assert.equal(contractPlan.endDate, '2026-06-13');
  assert.equal(contractPlan.contractDate, '2026-06-10');

  const withoutContractDate = getRoleTrainingPlan(project('parallel'), shopId, roleA.id, null);

  assert.deepEqual(withoutContractDate.events.map(event => event.id), ['general', 'role-a', 'zero']);
  assert.equal(withoutContractDate.totalDays, 3);
  assert.deepEqual(
    withoutContractDate.schedule.map(({ event, startDate, endDate, approximate }) => ({
      id: event.id,
      startDate,
      endDate,
      approximate,
    })),
    [
      { id: 'general', startDate: '2026-06-01', endDate: '2026-06-03', approximate: true },
      { id: 'role-a', startDate: '2026-06-01', endDate: '2026-06-04', approximate: true },
    ],
  );
  assert.equal(withoutContractDate.startDate, '2026-06-01');
  assert.equal(withoutContractDate.endDate, '2026-06-04');
});

test('sequential working-day training skips weekends for day and week durations', () => {
  const trainingProject = project('sequential');
  trainingProject.startDate = '2026-06-05';
  trainingProject.settings.dayType = 'working';
  trainingProject.training = [
    training('short', 'Короткое обучение', 2, [shopId], [roleA.id], 0),
    training('week', 'Обучение на неделю', 1, [shopId], [roleA.id], 1, 'weeks'),
  ];

  const plan = getRoleTrainingPlan(trainingProject, shopId, roleA.id, null);

  assert.equal(plan.totalDays, 7);
  assert.deepEqual(
    plan.schedule.map(({ event, startDate, endDate, durationDays }) => ({
      id: event.id,
      startDate,
      endDate,
      durationDays,
    })),
    [
      { id: 'short', startDate: '2026-06-05', endDate: '2026-06-09', durationDays: 2 },
      { id: 'week', startDate: '2026-06-09', endDate: '2026-06-16', durationDays: 5 },
    ],
  );
  assert.equal(plan.endDate, '2026-06-16');
});

test('parallel working-day training calculates day and week ranges across weekends', () => {
  const trainingProject = project('parallel');
  trainingProject.settings.dayType = 'working';
  trainingProject.training = [
    training('short', 'Короткое обучение', 2, [shopId], [roleA.id], 0),
    training('week', 'Обучение на неделю', 1, [shopId], [roleA.id], 1, 'weeks'),
  ];

  const plan = getRoleTrainingPlan(trainingProject, shopId, roleA.id, '2026-06-15');

  assert.equal(plan.totalDays, 5);
  assert.deepEqual(
    plan.schedule.map(({ event, startDate, endDate, durationDays }) => ({
      id: event.id,
      startDate,
      endDate,
      durationDays,
    })),
    [
      { id: 'short', startDate: '2026-06-11', endDate: '2026-06-15', durationDays: 2 },
      { id: 'week', startDate: '2026-06-08', endDate: '2026-06-15', durationDays: 5 },
    ],
  );
  assert.equal(plan.startDate, '2026-06-08');
  assert.equal(plan.endDate, '2026-06-15');
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
  assert.equal(plan.contractDate, '2026-06-20');
  assert.equal(plan.readyDate, '2026-06-20');
  assert.equal(plan.hasTrainingBar, false);

  const withoutReadyDate = getRoleTrainingPlan(trainingProject, shopId, roleA.id, null);
  assert.equal(withoutReadyDate.contractDate, null);
});
