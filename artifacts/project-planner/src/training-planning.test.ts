import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project, Role, Shop, TrainingEvent } from '@workspace/api-client-react';
import { assignTrainingLanes, durationInDays, getOnboardingStartDate, getRoleTrainingPlan, getShopContractDate, getShopRoleSummary, reconcileTrainingRoles, scheduleTrainingTimeline } from './training-planning.ts';
import { createRecruitmentWorkbook } from './recruitment-export.ts';

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
  startDate?: string,
): TrainingEvent {
  return {
    id,
    title,
    category: 'mandatory',
    duration,
    unit,
    ...(startDate ? { startDate } : {}),
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

test('shop contract dates use each shop readiness and only that shop training with onboarding', () => {
  const plan = project('sequential');
  plan.shops.push({ id: 'shop-b', name: 'Цех B', roles: [] });
  plan.training = [
    training('course-a', 'Курс A', 5, [shopId], [], 0),
    training('course-b', 'Курс B', 2, ['shop-b'], [], 1),
  ];
  plan.settings.readyMilestone = 'mc';
  plan.settings.readyMonthsBefore = 0;
  plan.settings.readyShopIds = [shopId, 'shop-b'];
  plan.settings.onboardingDuration = 3;
  plan.settings.onboardingUnit = 'days';
  plan.milestones.mc = {
    date: null,
    note: null,
    shopIds: [shopId, 'shop-b'],
    shopDates: { [shopId]: '2027-01-20', 'shop-b': '2027-06-30' },
  };

  assert.equal(getShopContractDate(plan, shopId), '2027-01-12');
  assert.equal(getShopContractDate(plan, 'shop-b'), '2027-06-25');
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

test('deleted role training stays removed after saving and reopening the plan', async () => {
  const edited = project('sequential');
  edited.settings.readyDate = '2026-06-20';
  edited.shops = [{ ...shop, roles: [roleB] }];
  edited.training = reconcileTrainingRoles(
    [
      training('general', 'Общее обучение', 2, [shopId], [], 0),
      training('both-roles', 'Обучение двух ролей', 3, [shopId], [roleA.id, roleB.id], 1),
      training('remaining-role', 'Обучение оператора', 4, [shopId], [roleB.id], 2),
      training('removed-role', 'Обучение технолога', 40, [shopId], [roleA.id], 3),
    ],
    edited.shops,
  );

  // Mirror the API update payload, its JSONB storage round-trip, and the GET response.
  const updatePayload = {
    title: edited.title,
    startDate: edited.startDate,
    endDate: edited.endDate,
    shops: edited.shops,
    phases: edited.phases,
    milestones: edited.milestones,
    training: edited.training,
    settings: edited.settings,
  };
  const reopened = JSON.parse(JSON.stringify({
    id: edited.id,
    ...updatePayload,
    updatedAt: edited.updatedAt,
  })) as Project;

  assert.deepEqual(reopened.shops[0].roles.map(role => role.id), [roleB.id]);
  assert.deepEqual(
    reopened.training.map(event => ({ id: event.id, roleIds: event.roleIds })),
    [
      { id: 'general', roleIds: [] },
      { id: 'both-roles', roleIds: [roleB.id] },
      { id: 'remaining-role', roleIds: [roleB.id] },
    ],
  );

  const rolePlan = getRoleTrainingPlan(reopened, shopId, roleB.id, '2026-06-20');
  assert.deepEqual(rolePlan.events.map(event => event.id), ['general', 'both-roles', 'remaining-role']);
  assert.equal(rolePlan.totalDays, 9);
  assert.equal(rolePlan.contractDate, '2026-06-11');

  const workbook = await createRecruitmentWorkbook(reopened);
  assert.ok(workbook);
  const byShop = workbook.getWorksheet('По площадкам');
  assert.ok(byShop);
  assert.equal(byShop.getRow(5).getCell(4).value, roleB.name);
  assert.equal(byShop.getRow(5).getCell(2).value, Date.UTC(2026, 5, 11) / 86400000 + 25569);
  assert.equal(byShop.getRow(5).getCell(7).value, 9);
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

for (const calculationMode of ['sequential', 'parallel'] as const) {
  test(`recruitment export matches the ${calculationMode} working-day role plan`, async () => {
    const trainingProject = project(calculationMode);
    trainingProject.settings.dayType = 'working';
    trainingProject.settings.readyDate = '2026-06-15';
    trainingProject.training = [
      training('short', 'Короткое обучение', 2, [shopId], [roleA.id], 0),
      training('week', 'Обучение на неделю', 1, [shopId], [roleA.id], 1, 'weeks'),
    ];

    const plan = getRoleTrainingPlan(trainingProject, shopId, roleA.id, '2026-06-15');
    const workbook = await createRecruitmentWorkbook(trainingProject);
    assert.ok(workbook);
    const byShop = workbook.getWorksheet('По площадкам');
    assert.ok(byShop);
    const exportedRole = byShop.getRows(5, byShop.rowCount - 4)
      ?.find(row => row.getCell(4).value === roleA.name);
    assert.ok(exportedRole);

    const expectedTotalDays = calculationMode === 'sequential' ? 7 : 5;
    const expectedDeadline = calculationMode === 'sequential' ? '2026-06-04' : '2026-06-08';
    const expectedDeadlineSerial = Date.UTC(2026, 5, calculationMode === 'sequential' ? 4 : 8) / 86400000 + 25569;

    assert.deepEqual(plan.schedule.map(item => item.durationDays), [2, 5]);
    assert.equal(plan.totalDays, expectedTotalDays);
    assert.equal(plan.contractDate, expectedDeadline);
    assert.equal(exportedRole.getCell(7).value, plan.totalDays);
    assert.equal(exportedRole.getCell(2).value, expectedDeadlineSerial);
  });
}

test('manual training start date anchors a sequential event and its duration', () => {
  const trainingProject = project('sequential');
  trainingProject.training = [
    training('pinned', 'Обучение с датой', 2, [shopId], [roleA.id], 0, 'days', '2026-06-10'),
    training('automatic', 'Обучение по расчёту', 3, [shopId], [roleA.id], 1),
  ];

  const plan = getRoleTrainingPlan(trainingProject, shopId, roleA.id, '2026-06-20');

  assert.deepEqual(
    plan.schedule.map(({ event, startDate, endDate, approximate }) => ({
      id: event.id,
      startDate,
      endDate,
      approximate,
    })),
    [
      { id: 'pinned', startDate: '2026-06-10', endDate: '2026-06-12', approximate: false },
      { id: 'automatic', startDate: '2026-06-17', endDate: '2026-06-20', approximate: false },
    ],
  );
  assert.equal(plan.contractDate, '2026-06-10');
});

test('staffing mode determines whether role training pauses for Kazakhstan weekends and holidays', () => {
  const local = project('sequential');
  local.training = [training('course', 'Обучение', 1, [shopId], [], 0, 'days', '2026-03-20')];
  local.settings = { ...local.settings, staffingMode: 'local', dayType: 'calendar' };
  const localSchedule = scheduleTrainingTimeline(local, null);
  assert.deepEqual(
    [localSchedule[0].startDate, localSchedule[0].endDate],
    ['2026-03-20', '2026-03-26'],
  );

  const shift = {
    ...local,
    settings: { ...local.settings, staffingMode: 'shift' as const },
  };
  const shiftSchedule = scheduleTrainingTimeline(shift, null);
  assert.deepEqual(
    [shiftSchedule[0].startDate, shiftSchedule[0].endDate],
    ['2026-03-20', '2026-03-21'],
  );
});

test('manual training start date overrides the parallel estimate and respects working days', () => {
  const trainingProject = project('parallel');
  trainingProject.settings.dayType = 'working';
  trainingProject.training = [
    training('pinned', 'Обучение с датой', 2, [shopId], [roleA.id], 0, 'days', '2026-06-05'),
    training('automatic', 'Обучение по расчёту', 3, [shopId], [roleA.id], 1),
  ];

  const plan = getRoleTrainingPlan(trainingProject, shopId, roleA.id, '2026-06-15');

  assert.deepEqual(
    plan.schedule.map(({ event, startDate, endDate }) => ({
      id: event.id,
      startDate,
      endDate,
    })),
    [
      { id: 'pinned', startDate: '2026-06-05', endDate: '2026-06-09' },
      { id: 'automatic', startDate: '2026-06-10', endDate: '2026-06-15' },
    ],
  );
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

test('onboarding durations convert days and weeks using the project day type', () => {
  assert.equal(durationInDays(4, 'days', 'calendar'), 4);
  assert.equal(durationInDays(2, 'weeks', 'calendar'), 14);
  assert.equal(durationInDays(2, 'weeks', 'working'), 10);
});

test('onboarding starts once before the first training date', () => {
  assert.equal(getOnboardingStartDate('2026-06-15', 2, 'weeks', 'calendar'), '2026-06-01');
  assert.equal(getOnboardingStartDate('2026-06-15', 1, 'weeks', 'working'), '2026-06-08');
  assert.equal(getOnboardingStartDate('2026-06-15', 0, 'days', 'calendar'), null);
  assert.equal(getOnboardingStartDate(null, 2, 'weeks', 'calendar'), null);
});

test('onboarding extends the role preparation window once and moves its hiring cutoff earlier', () => {
  const trainingProject = project('sequential');
  trainingProject.settings.onboardingDuration = 5;
  trainingProject.settings.onboardingUnit = 'days';

  const plan = getRoleTrainingPlan(trainingProject, shopId, roleA.id, '2026-06-20');

  assert.equal(plan.totalDays, 5);
  assert.equal(plan.onboardingDurationDays, 5);
  assert.equal(plan.totalPreparationDays, 10);
  assert.equal(plan.startDate, '2026-06-15');
  assert.equal(plan.onboardingStartDate, '2026-06-10');
  assert.equal(plan.contractDate, '2026-06-10');
});

test('a manual contract date anchors onboarding before the actual role training', () => {
  const trainingProject = project('sequential');
  trainingProject.settings.contractDate = '2026-06-10';
  trainingProject.settings.onboardingDuration = 5;

  const plan = getRoleTrainingPlan(trainingProject, shopId, roleA.id, null);

  assert.equal(plan.contractDate, '2026-06-10');
  assert.equal(plan.onboardingStartDate, '2026-06-10');
  assert.equal(plan.startDate, '2026-06-15');
});

test('parallel training events that overlap use separate timeline lanes', () => {
  const parallelPlan = getRoleTrainingPlan(project('parallel'), shopId, roleA.id, '2026-06-20');
  const lanes = assignTrainingLanes(parallelPlan.schedule);
  const laneByEventId = new Map(lanes.map(item => [item.event.id, item.lane]));

  assert.equal(laneByEventId.get('role-a'), 0);
  assert.equal(laneByEventId.get('general'), 1);

  const sequentialPlan = getRoleTrainingPlan(project('sequential'), shopId, roleA.id, '2026-06-20');
  assert.deepEqual(assignTrainingLanes(sequentialPlan.schedule).map(item => item.lane), [0, 0]);
});
