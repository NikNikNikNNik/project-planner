import assert from 'node:assert/strict';
import test from 'node:test';
import type { Phase, Project } from '@workspace/api-client-react';
import { REGIME_RAMP_UP_DAYS, getProjectTimelineEnd, getShopTimelinePhases } from './timeline-phases.ts';

const shopId = 'shop-a';
const phases: Phase[] = [
  { id: 'montage', name: 'Монтаж оборудования', type: 'construction', startDate: '2027-01-01', endDate: '2027-04-01', shopIds: [shopId], note: null },
  { id: 'pnr', name: 'ПНР и комплексное опробование', type: 'commissioning', startDate: '2027-05-01', endDate: '2027-08-01', shopIds: [shopId], note: null },
];
const milestones: Project['milestones'] = {
  mc: { date: null, note: null, shopIds: [shopId], shopDates: { [shopId]: '2027-04-15' } },
  rfsu: { date: null, note: null, shopIds: [shopId], shopDates: { [shopId]: '2027-09-15' } },
};

test('updates timeline labels and derives the PNR and ramp-up windows from shop milestones', () => {
  const timeline = getShopTimelinePhases(phases, milestones, shopId);

  assert.deepEqual(timeline.map(phase => phase.name), [
    'СМР и ППНР',
    'ПНР',
    'Вывод на режим',
  ]);
  assert.equal(timeline[0].endDate, '2027-04-15');
  assert.equal(timeline[0].editablePhase, null);
  assert.equal(timeline[1].startDate, '2027-04-15');
  assert.equal(timeline[1].endDate, '2027-09-15');
  assert.equal(timeline[1].type, 'commissioning');
  assert.equal(timeline[2].startDate, '2027-09-15');
  assert.equal(timeline[2].endDate, '2027-12-14');
  assert.equal(timeline[2].type, 'commissioning');
  assert.equal(REGIME_RAMP_UP_DAYS, 90);
});

test('uses shop-specific control dates and omits derived blocks for another shop', () => {
  const otherShop = getShopTimelinePhases(phases, milestones, 'shop-b');

  assert.deepEqual(otherShop, []);
});

test('shows the stored PNR schedule when its control dates are not set yet', () => {
  const withoutDates: Project['milestones'] = {
    mc: { date: null, note: null, shopIds: [shopId] },
    rfsu: { date: null, note: null, shopIds: [shopId] },
  };
  const timeline = getShopTimelinePhases(phases, withoutDates, shopId);

  assert.equal(timeline.find(phase => phase.name === 'СМР и ППНР')?.endDate, '2027-04-01');
  assert.equal(timeline.find(phase => phase.name === 'ПНР')?.startDate, '2027-05-01');
  assert.equal(timeline.some(phase => phase.name === 'Вывод на режим'), false);
});

test('project timeline range includes the 90 days after the latest RFSU', () => {
  const plan: Project = {
    id: 'project-a',
    title: 'План',
    startDate: '2027-01-01',
    endDate: '2027-10-01',
    updatedAt: '2026-12-01T00:00:00.000Z',
    shops: [{ id: shopId, name: 'Цех', roles: [] }],
    phases,
    milestones,
    training: [],
    settings: {
      calculationMode: 'sequential',
      readyMode: 'relative',
      readyDate: null,
      daysBeforeMc: 45,
      dayType: 'calendar',
      contractDate: null,
    },
  };

  assert.equal(getProjectTimelineEnd(plan), '2027-12-14');
});
