import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '@workspace/api-client-react';
import {
  getTrainingEventsIncludedForShop,
  getTrainingEventsIncludedInCalculation,
  isRoleIncludedInCalculation,
  isShopIncludedInCalculation,
} from './calculation-scope.ts';

const project: Project = {
  id: 'project',
  title: 'Тест',
  startDate: '2026-01-01',
  endDate: '2027-01-01',
  updatedAt: '2026-01-01T00:00:00.000Z',
  shops: [
    {
      id: 'active-shop',
      name: 'Активный цех',
      roles: [
        { id: 'active-role', name: 'Оператор', group: 'workers', visible: true },
        { id: 'hidden-role', name: 'Исключённая роль', group: 'workers', visible: false },
      ],
    },
    {
      id: 'excluded-shop',
      name: 'Исключённый цех',
      includedInCalculations: false,
      roles: [{ id: 'excluded-shop-role', name: 'Технолог', group: 'itr', visible: true }],
    },
  ],
  phases: [],
  milestones: {
    mc: { date: null, note: null, shopIds: [] },
    rfsu: { date: null, note: null, shopIds: [] },
  },
  training: [
    { id: 'active', title: 'Активное', category: 'mandatory', duration: 1, unit: 'days', shopIds: ['active-shop'], roleIds: ['active-role'], note: null, status: 'planned', sortOrder: 0 },
    { id: 'hidden', title: 'Скрытое', category: 'mandatory', duration: 1, unit: 'days', shopIds: ['active-shop'], roleIds: ['hidden-role'], note: null, status: 'planned', sortOrder: 1 },
    { id: 'excluded-shop', title: 'Цех исключён', category: 'mandatory', duration: 1, unit: 'days', shopIds: ['excluded-shop'], roleIds: [], note: null, status: 'planned', sortOrder: 2 },
    { id: 'all-active', title: 'Общее активное', category: 'mandatory', duration: 1, unit: 'days', shopIds: ['active-shop', 'excluded-shop'], roleIds: [], note: null, status: 'planned', sortOrder: 3 },
  ],
  settings: {
    calculationMode: 'sequential',
    readyMode: 'fixed',
    readyDate: null,
    daysBeforeMc: 0,
    dayType: 'calendar',
    contractDate: null,
  },
};

test('legacy shops default to included; explicit shop and role switches narrow calculation scope', () => {
  const activeShop = project.shops[0];
  const excludedShop = project.shops[1];
  assert.equal(isShopIncludedInCalculation(activeShop), true);
  assert.equal(isShopIncludedInCalculation(excludedShop), false);
  assert.equal(isRoleIncludedInCalculation(activeShop, activeShop.roles[0]), true);
  assert.equal(isRoleIncludedInCalculation(activeShop, activeShop.roles[1]), false);
  assert.equal(isRoleIncludedInCalculation(excludedShop, excludedShop.roles[0]), false);
});

test('training is counted only when a selected active shop has an active target role', () => {
  assert.deepEqual(
    getTrainingEventsIncludedInCalculation(project).map(event => event.id),
    ['active', 'all-active'],
  );
  assert.deepEqual(
    getTrainingEventsIncludedForShop(project, 'active-shop').map(event => event.id),
    ['active', 'all-active'],
  );
});
