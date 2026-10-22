import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '@workspace/api-client-react';
import {
  commonMilestoneDate,
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

test('readiness and project summary use separate milestone dates for each selected shop', () => {
  const plan = project();
  assert.equal(getShopReadyDate(plan, 'shop-a'), '2026-10-31');
  assert.equal(getShopReadyDate(plan, 'shop-b'), '2026-12-31');
  assert.equal(getProjectReadyDate(plan), '2026-12-31');
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
