import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '@workspace/api-client-react';
import {
  commonMilestoneDate,
  getRecruitmentStartDate,
  getHiringResearchMilestones,
  getProjectReadyDate,
  getShopReadyDate,
  shiftCalendarMonths,
  withMilestoneShopDate,
} from './readiness.ts';

const shopIds = ['shop-a', 'shop-b'];

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-a',
    title: 'Проект',
    startDate: '2026-01-01',
    endDate: '2028-12-31',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shops: shopIds.map(id => ({ id, name: id, roles: [] })),
    phases: [],
    milestones: {
      mc: {
        date: null,
        note: null,
        shopIds,
        shopDates: { 'shop-a': '2027-01-31', 'shop-b': '2027-03-31' },
      },
      rfsu: { date: null, note: null, shopIds },
    },
    training: [],
    settings: {
      calculationMode: 'sequential',
      readyMode: 'relative',
      readyDate: null,
      daysBeforeMc: 45,
      readyOffsetUnit: 'days',
      readyMonthsBefore: 3,
      readyMilestone: 'mc',
      readyShopIds: shopIds,
      dayType: 'calendar',
      contractDate: null,
    },
    ...overrides,
  };
}

test('calendar-month readiness clamps to the final day of a shorter month', () => {
  assert.equal(shiftCalendarMonths('2027-03-31', -1), '2027-02-28');
});

test('recruitment start defaults to 60 calendar days before each role contract date', () => {
  assert.equal(getRecruitmentStartDate('2027-03-31'), '2027-01-30');
  assert.equal(getRecruitmentStartDate('2027-04-10'), '2027-02-09');
  assert.equal(getRecruitmentStartDate(null), null);
});

test('recruitment start supports a configurable calendar-month offset', () => {
  assert.equal(getRecruitmentStartDate('2027-03-31', 2, 'months'), '2027-01-31');
});

test('unfinished hiring research is dated before the first training using configurable month offsets', () => {
  const plan = project({
    settings: {
      ...project().settings,
      salaryMedianResearchDone: false,
      salaryMedianResearchMonthsBeforeTraining: 6,
      laborMarketResearchDone: true,
      hiringStrategyDone: false,
    },
  });

  const milestones = getHiringResearchMilestones(plan, '2027-01-31');

  assert.deepEqual(
    milestones.map(({ label, date, months }) => ({ label, date, months })),
    [
      { label: 'Исследование медианы ЗП', date: '2026-07-31', months: 6 },
      { label: 'Стратегия найма', date: '2026-01-31', months: 12 },
    ],
  );
});

test('hiring research uses 18, 16, and 12 months by default when unfinished', () => {
  const plan = project({
    settings: {
      ...project().settings,
      salaryMedianResearchDone: false,
      laborMarketResearchDone: false,
      hiringStrategyDone: false,
    },
  });

  assert.deepEqual(
    getHiringResearchMilestones(plan, '2027-01-31').map(({ label, date, months }) => ({ label, date, months })),
    [
      { label: 'Исследование медианы ЗП', date: '2025-07-31', months: 18 },
      { label: 'Исследование рынка трудовых резервов', date: '2025-09-30', months: 16 },
      { label: 'Стратегия найма', date: '2026-01-31', months: 12 },
    ],
  );
});

test('hiring research milestones are omitted until a first training date is available', () => {
  const plan = project({ settings: { ...project().settings, salaryMedianResearchDone: false } });
  assert.deepEqual(getHiringResearchMilestones(plan, null), []);
});

test('readiness and project summary use separate milestone dates for each selected shop', () => {
  const plan = project();
  assert.equal(getShopReadyDate(plan, 'shop-a'), '2026-10-31');
  assert.equal(getShopReadyDate(plan, 'shop-b'), '2026-12-31');
  assert.equal(getProjectReadyDate(plan), '2026-12-31');
});

test('readiness supports per-shop offsets and milestones with a shared fallback', () => {
  const base = project();
  const plan = project({
    settings: {
      ...base.settings,
      readyShopRules: {
        'shop-a': { monthsBefore: 1, milestone: 'rfsu' },
      },
    },
    milestones: {
      ...base.milestones,
      rfsu: {
        ...base.milestones.rfsu,
        shopDates: { 'shop-a': '2027-08-31', 'shop-b': '2027-10-31' },
      },
    },
  });

  assert.equal(getShopReadyDate(plan, 'shop-a'), '2027-07-31');
  assert.equal(getShopReadyDate(plan, 'shop-b'), '2026-12-31');
  assert.equal(getProjectReadyDate(plan), '2027-07-31');
});

test('readiness is not assigned to shops outside the configured rule scope', () => {
  const plan = project({ settings: { ...project().settings, readyShopIds: ['shop-a'] } });
  assert.equal(getShopReadyDate(plan, 'shop-b'), null);
  assert.equal(getProjectReadyDate(plan), '2026-10-31');
});

test('project readiness stays unset if any selected shop has no required milestone date', () => {
  const plan = project({
    milestones: {
      ...project().milestones,
      mc: { ...project().milestones.mc, shopDates: { 'shop-a': '2027-01-31', 'shop-b': null } },
    },
  });
  assert.equal(getProjectReadyDate(plan), null);
});

test('common milestone date is shown only when all shop dates match', () => {
  const milestone = project().milestones.mc;
  assert.equal(commonMilestoneDate(milestone, shopIds), null);
  assert.equal(commonMilestoneDate({ ...milestone, shopDates: { 'shop-a': '2027-01-31', 'shop-b': '2027-01-31' } }, shopIds), '2027-01-31');
});

test('editing one shop milestone preserves the other shop date', () => {
  const milestone = project().milestones.mc;
  const updated = withMilestoneShopDate(milestone, shopIds, 'shop-a', '2027-02-28');
  assert.equal(updated.shopDates?.['shop-a'], '2027-02-28');
  assert.equal(updated.shopDates?.['shop-b'], '2027-03-31');
  assert.equal(updated.date, null);
});
