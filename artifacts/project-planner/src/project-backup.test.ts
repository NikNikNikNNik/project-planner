import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '@workspace/api-client-react';
import { parseProjectBackup, serializeProjectBackup } from './project-backup.ts';

const sample: Project = {
  id: 'old-id',
  title: 'Проект для восстановления',
  startDate: '2027-01-01',
  endDate: '2029-12-31',
  updatedAt: '2026-10-23T00:00:00.000Z',
  shops: [{ id: 'shop-1', name: 'Пиролиз', roles: [{ id: 'role-1', name: 'Технолог', group: 'itr', visible: true, headcount: 2 }] }],
  phases: [{ id: 'phase-1', name: 'СМР', type: 'construction', startDate: '2027-01-01', endDate: '2027-12-01', shopIds: ['shop-1'], note: null }],
  milestones: {
    mc: { date: '2028-01-01', note: 'MC', shopIds: ['shop-1'], shopDates: { 'shop-1': '2028-01-01' } },
    rfsu: { date: '2028-06-01', note: null, shopIds: ['shop-1'], shopDates: { 'shop-1': '2028-06-01' } },
  },
  training: [{
    id: 'training-1', title: 'Охрана труда', category: 'mandatory', duration: 5, unit: 'days',
    startDate: '2027-02-01', costUsd: 120, shopIds: ['shop-1'], roleIds: ['role-1'],
    note: 'Примечание', status: 'planned', sortOrder: 0,
  }],
  settings: {
    calculationMode: 'sequential',
    readyMode: 'relative',
    readyDate: null,
    daysBeforeMc: 45,
    dayType: 'working',
    contractDate: null,
    staffingMode: 'local',
    onboardingDuration: 3,
    onboardingUnit: 'days',
    templateDataStatus: 'unconfirmed',
  },
};

test('project backup preserves all editable fields but not the old server id', () => {
  const backup = JSON.parse(serializeProjectBackup(sample)) as { project: Record<string, unknown> };
  assert.equal(backup.project.title, sample.title);
  assert.equal('id' in backup.project, false);
  assert.equal('updatedAt' in backup.project, false);
  assert.deepEqual(parseProjectBackup(JSON.stringify(backup)), {
    title: sample.title,
    startDate: sample.startDate,
    endDate: sample.endDate,
    shops: sample.shops,
    phases: sample.phases,
    milestones: sample.milestones,
    training: sample.training,
    settings: sample.settings,
  });
});

test('project backup rejects unsupported versions and malformed project data', () => {
  assert.throws(() => parseProjectBackup('{broken'), /корректным JSON/);
  assert.throws(() => parseProjectBackup(JSON.stringify({ format: 'project-planner-backup', version: 99 })), /не распознан|не поддерживается/);
  assert.throws(() => parseProjectBackup(JSON.stringify({
    format: 'project-planner-backup',
    version: 1,
    project: { title: '', startDate: '2027-02-30' },
  })), /повреждены/);
});
