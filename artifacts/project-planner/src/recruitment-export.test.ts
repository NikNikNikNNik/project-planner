import assert from 'node:assert/strict';
import test from 'node:test';
import type { Project } from '@workspace/api-client-react';
import { createRecruitmentWorkbook } from './recruitment-export.ts';

const shopId = 'shop-a';

function project(recruitmentLeadValue = 60, recruitmentLeadUnit: 'days' | 'months' = 'days'): Project {
  return {
    id: 'project-a',
    title: 'Проект',
    startDate: '2027-01-01',
    endDate: '2028-12-31',
    updatedAt: '2027-01-01T00:00:00.000Z',
    shops: [{
      id: shopId,
      name: 'Пиролиз',
      roles: [{ id: 'role-a', name: 'Начальник цеха', group: 'itr', visible: true, headcount: 4 }],
    }],
    phases: [],
    milestones: {
      mc: { date: null, note: null, shopIds: [shopId] },
      rfsu: { date: null, note: null, shopIds: [shopId] },
    },
    training: [],
    settings: {
      calculationMode: 'sequential',
      readyMode: 'fixed',
      readyDate: '2027-06-10',
      daysBeforeMc: 45,
      readyOffsetUnit: 'days',
      dayType: 'calendar',
      contractDate: '2027-06-10',
      recruitmentLeadValue,
      recruitmentLeadUnit,
    },
  };
}

const excelDateSerial = (year: number, month: number, day: number) =>
  Date.UTC(year, month - 1, day) / 86400000 + 25569;

test('workbook starts both sheets with the role-specific recruitment start date', async () => {
  const workbook = await createRecruitmentWorkbook(project());
  assert.ok(workbook);

  const byPlant = workbook.getWorksheet('По площадкам');
  assert.ok(byPlant);
  assert.equal(byPlant.getRow(4).getCell(1).value, 'Дата начала рекрутинга');
  assert.equal(byPlant.getRow(4).getCell(2).value, 'Дата найма на контракт');
  assert.equal(byPlant.getRow(5).getCell(1).value, excelDateSerial(2027, 4, 11));
  assert.equal(byPlant.getRow(5).getCell(2).value, excelDateSerial(2027, 6, 10));
  assert.equal(byPlant.getRow(5).getCell(3).value, 'Пиролиз');

  const summary = workbook.getWorksheet('Сводка по профессиям');
  assert.ok(summary);
  assert.equal(summary.getRow(4).getCell(1).value, 'Дата начала рекрутинга');
  assert.equal(summary.getRow(5).getCell(1).value, excelDateSerial(2027, 4, 11));
  assert.equal(summary.getRow(5).getCell(2).value, excelDateSerial(2027, 6, 10));
  assert.equal(summary.getRow(5).getCell(5).value, 4);
});

test('workbook recruitment date follows a month-based project setting', async () => {
  const workbook = await createRecruitmentWorkbook(project(2, 'months'));
  assert.ok(workbook);
  assert.equal(
    workbook.getWorksheet('По площадкам')?.getRow(5).getCell(1).value,
    excelDateSerial(2027, 4, 10),
  );
});
