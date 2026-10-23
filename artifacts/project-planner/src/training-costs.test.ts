import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '@workspace/api-client-react';
import {
  getTrainingCostEntries,
  getTrainingCostReport,
  getTrainingCostReportingDates,
  getTrainingCostSummary,
} from './training-costs.ts';
import { createTrainingCostWorkbook } from './training-cost-export.ts';

function fixture(): Project {
  return {
    id: 'training-cost-test',
    title: 'Завод',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    updatedAt: '2026-01-01T00:00:00Z',
    shops: [],
    phases: [],
    milestones: {
      mc: { date: null, note: null, shopIds: [] },
      rfsu: { date: null, note: null, shopIds: [] },
    },
    training: [
      {
        id: 'course-cross-month',
        title: 'Курс через границу месяца',
        category: 'technology',
        duration: 4,
        unit: 'days',
        shopIds: [],
        roleIds: [],
        costUsd: 1001,
        note: null,
        status: 'planned',
        sortOrder: 0,
      },
      {
        id: 'course-one-day',
        title: 'Обучение без длительности с указанной датой',
        category: 'other',
        duration: 0,
        unit: 'days',
        startDate: '2026-01-05',
        shopIds: [],
        roleIds: [],
        costUsd: 100,
        note: null,
        status: 'planned',
        sortOrder: 1,
      },
      {
        id: 'course-undated',
        title: 'Обучение без даты',
        category: 'other',
        duration: 0,
        unit: 'days',
        shopIds: [],
        roleIds: [],
        costUsd: 50,
        note: null,
        status: 'planned',
        sortOrder: 2,
      },
    ],
    settings: {
      calculationMode: 'sequential',
      readyMode: 'relative',
      readyDate: null,
      daysBeforeMc: 45,
      dayType: 'calendar',
      staffingMode: 'shift',
      contractDate: null,
    },
  };
}

function internshipFixture(participants: number): Project {
  const project = fixture();
  project.shops = [{
    id: 'shop-internship',
    name: 'Цех стажировки',
    roles: [{
      id: 'internship-role',
      name: 'Слушатели стажировки',
      group: 'workers',
      visible: true,
      headcount: participants,
      monthlyPayrollKzt: 0,
    }],
  }];
  project.training = [{
    ...project.training[0],
    id: 'internship-event',
    title: 'Стажировка',
    category: 'internship',
    costUsd: 50_000_000,
    shopIds: ['shop-internship'],
    roleIds: [],
  }];
  return project;
}

test('training costs are distributed across active dates and split by calendar month', () => {
  const project = fixture();
  const schedule = [{
    event: project.training[0],
    startDate: '2026-01-30',
    endDate: '2026-02-03',
    durationDays: 4,
    approximate: false,
  }];
  const entries = getTrainingCostEntries(project, schedule);

  const january = getTrainingCostReport(project.title, entries, '2026-01-31', 'monthly');
  const february = getTrainingCostReport(project.title, entries, '2026-02-28', 'monthly');
  const cumulativeJanuary = getTrainingCostReport(project.title, entries, '2026-01-31', 'cumulative');
  const cumulativeFebruary = getTrainingCostReport(project.title, entries, '2026-02-28', 'cumulative');

  assert.equal(january.lines.find(line => line.event.id === 'course-cross-month')?.amountKzt, 501);
  assert.equal(february.lines.find(line => line.event.id === 'course-cross-month')?.amountKzt, 500);
  assert.equal(cumulativeJanuary.lines.find(line => line.event.id === 'course-cross-month')?.amountKzt, 501);
  assert.equal(cumulativeFebruary.lines.find(line => line.event.id === 'course-cross-month')?.amountKzt, 1001);
});

test('internship group price is charged per full group of ten participants', () => {
  for (const [participants, expectedGroups] of [[10, 1], [11, 2], [461, 47]]) {
    const project = internshipFixture(participants);
    const entry = getTrainingCostEntries(project, [])[0];
    assert.equal(entry.internshipCostBasis?.participantCount, participants);
    assert.equal(entry.internshipCostBasis?.groupCount, expectedGroups);
    assert.equal(entry.internshipCostBasis?.pricePerGroupKzt, 50_000_000);
    assert.equal(entry.totalCostKzt, expectedGroups * 50_000_000);
  }
});

test('hidden and zero-headcount roles are excluded from internship groups', () => {
  const project = internshipFixture(8);
  project.shops[0].roles.push({
    id: 'hidden-role',
    name: 'Скрытая роль',
    group: 'workers',
    visible: false,
    headcount: 100,
    monthlyPayrollKzt: 0,
  });
  const entry = getTrainingCostEntries(project, [])[0];
  assert.equal(entry.internshipCostBasis?.participantCount, 8);
  assert.equal(entry.internshipCostBasis?.groupCount, 1);
  assert.equal(entry.totalCostKzt, 50_000_000);
});

test('internship with a price but no planned audience is flagged and not counted as free', () => {
  const project = internshipFixture(10);
  project.shops[0].roles[0].visible = false;
  const entries = getTrainingCostEntries(project, []);
  const summary = getTrainingCostSummary(entries);
  assert.equal(entries[0].totalCostKzt, 0);
  assert.equal(entries[0].unassignedAudience, true);
  assert.equal(summary.unassignedAudienceEvents.length, 1);
});

test('local-personnel costs are allocated only to Kazakhstan workdays', () => {
  const project = fixture();
  project.settings.staffingMode = 'local';
  project.settings.dayType = 'working';
  const schedule = [{
    event: project.training[0],
    startDate: '2026-01-09',
    endDate: '2026-01-13',
    durationDays: 2,
    approximate: false,
  }];
  const entries = getTrainingCostEntries(project, schedule);
  const friday = getTrainingCostReport(project.title, entries, '2026-01-09', 'cumulative');
  const monday = getTrainingCostReport(project.title, entries, '2026-01-12', 'cumulative');

  assert.equal(friday.lines.find(line => line.event.id === 'course-cross-month')?.amountKzt, 501);
  assert.equal(monday.lines.find(line => line.event.id === 'course-cross-month')?.amountKzt, 1001);
});

test('zero-duration events with a start date are booked on that date', () => {
  const project = fixture();
  const entries = getTrainingCostEntries(project, []);
  const before = getTrainingCostReport(project.title, entries, '2026-01-04', 'cumulative');
  const onDate = getTrainingCostReport(project.title, entries, '2026-01-05', 'cumulative');
  const inJanuary = getTrainingCostReport(project.title, entries, '2026-01-31', 'monthly');

  assert.equal(before.lines.some(line => line.event.id === 'course-one-day'), false);
  assert.equal(onDate.lines.find(line => line.event.id === 'course-one-day')?.amountKzt, 100);
  assert.equal(inJanuary.lines.find(line => line.event.id === 'course-one-day')?.amountKzt, 100);
});

test('undated costs are not assigned to an invented month and are reported as incomplete', () => {
  const project = fixture();
  const schedule = [{
    event: project.training[0],
    startDate: '2026-01-30',
    endDate: '2026-02-03',
    durationDays: 4,
    approximate: false,
  }];
  const entries = getTrainingCostEntries(project, schedule);
  const summary = getTrainingCostSummary(entries);
  const report = getTrainingCostReport(project.title, entries, '2026-01-31', 'cumulative');

  assert.equal(summary.unallocatedCostKzt, 50);
  assert.equal(summary.unallocatedEvents.length, 1);
  assert.equal(report.partial, true);
  assert.equal(report.unallocatedCostKzt, 50);
  assert.equal(report.lines.some(line => line.event.id === 'course-undated'), false);
});

test('monthly report dates end at the visible range end', () => {
  assert.deepEqual(getTrainingCostReportingDates('2026-01-16', '2026-03-10'), [
    '2026-01-31',
    '2026-02-28',
    '2026-03-10',
  ]);
});

test('training cost export contains the period total, event breakdown, and undated costs', async () => {
  const project = fixture();
  const schedule = [{
    event: project.training[0],
    startDate: '2026-01-30',
    endDate: '2026-02-03',
    durationDays: 4,
    approximate: false,
  }];
  const entries = getTrainingCostEntries(project, schedule);
  const report = getTrainingCostReport(project.title, entries, '2026-01-31', 'monthly');
  const workbook = await createTrainingCostWorkbook(report);
  const sheet = workbook.getWorksheet('Затраты на обучение');
  const unresolved = workbook.getWorksheet('Без даты или стоимости');

  assert.ok(sheet);
  assert.equal(sheet.getCell('A1').value, 'Затраты на обучение, в помесячном выражении');
  assert.equal(sheet.getCell('B4').value, 601);
  assert.equal(sheet.getCell('A7').value, 'Обучение');
  assert.equal(sheet.getCell('A8').value, 'Курс через границу месяца');
  assert.ok(unresolved);
  assert.equal(unresolved.getCell('A2').value, 'Обучение без даты');
});

test('internship Excel export shows scaled cost and the ten-person group basis', async () => {
  const project = internshipFixture(461);
  const event = project.training[0];
  const schedule = [{
    event,
    startDate: '2026-01-05',
    endDate: '2026-01-06',
    durationDays: 1,
    approximate: false,
  }];
  const entries = getTrainingCostEntries(project, schedule);
  const report = getTrainingCostReport(project.title, entries, '2026-01-31', 'monthly');
  const workbook = await createTrainingCostWorkbook(report);
  const sheet = workbook.getWorksheet('Затраты на обучение');

  assert.ok(sheet);
  assert.equal(sheet.getCell('C7').value, 2_350_000_000);
  assert.equal(sheet.getCell('E7').value, '461 чел. / 47 групп по 10 (округлено вверх)');
  assert.equal(sheet.getCell('F7').value, 50_000_000);
});

test('training costs and scheduled dates exclude an audience whose role is unchecked', () => {
  const project = fixture();
  project.shops = [{
    id: 'shop',
    name: 'Цех',
    roles: [
      { id: 'active-role', name: 'Оператор', group: 'workers', visible: true, headcount: 1 },
      { id: 'excluded-role', name: 'Механик', group: 'workers', visible: false, headcount: 3 },
    ],
  }];
  project.training = [{
    id: 'excluded-course',
    title: 'Курс для исключённой роли',
    category: 'technology',
    duration: 5,
    unit: 'days',
    startDate: '2026-02-01',
    shopIds: ['shop'],
    roleIds: ['excluded-role'],
    costUsd: 12_000,
    note: null,
    status: 'planned',
    sortOrder: 0,
  }];

  const [entry] = getTrainingCostEntries(project, []);
  assert.equal(entry.totalCostKzt, 0);
  assert.equal(entry.startDate, null);
  assert.deepEqual(entry.activeDates, []);
});

test('an excluded shop has no internship participants or group costs', () => {
  const project = internshipFixture(11);
  project.shops.forEach(shop => { shop.includedInCalculations = false; });

  const [entry] = getTrainingCostEntries(project, []);
  assert.equal(entry.internshipCostBasis?.participantCount, 0);
  assert.equal(entry.internshipCostBasis?.groupCount, 0);
  assert.equal(entry.totalCostKzt, 0);
});
