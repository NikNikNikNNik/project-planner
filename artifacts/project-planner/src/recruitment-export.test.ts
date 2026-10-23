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

test('recruitment workbook omits excluded roles and shops', async () => {
  const plan = project();
  plan.shops[0].roles[0].visible = false;
  plan.shops[0].roles.push({
    id: 'active-role',
    name: 'Учитываемый оператор',
    group: 'workers',
    visible: true,
    headcount: 1,
  });
  plan.shops.push({
    id: 'excluded-shop',
    name: 'Исключённый цех',
    includedInCalculations: false,
    roles: [{
      id: 'excluded-role',
      name: 'Не учитывать электрика',
      group: 'workers',
      visible: true,
      headcount: 1,
    }],
  });

  const workbook = await createRecruitmentWorkbook(plan);
  const sheet = workbook.getWorksheet('По площадкам');
  assert.ok(sheet);
  const values: unknown[] = [];
  sheet.eachRow(row => row.eachCell(cell => values.push(cell.value)));
  assert.ok(values.includes('Учитываемый оператор'));
  assert.equal(values.includes('Начальник цеха'), false);
  assert.equal(values.includes('Не учитывать электрика'), false);
  assert.equal(values.includes('Исключённый цех'), false);
});

test('workbook recruitment date follows a month-based project setting', async () => {
  const workbook = await createRecruitmentWorkbook(project(2, 'months'));
  assert.ok(workbook);
  assert.equal(
    workbook.getWorksheet('По площадкам')?.getRow(5).getCell(1).value,
    excelDateSerial(2027, 4, 10),
  );
});

test('workbook hiring deadline and preparation duration include onboarding once per role', async () => {
  const plan = project();
  plan.settings.contractDate = null;
  plan.settings.onboardingDuration = 4;
  plan.settings.onboardingUnit = 'days';
  plan.training = [{
    id: 'training-a',
    title: 'Обучение',
    category: 'mandatory',
    duration: 2,
    unit: 'days',
    status: 'planned',
    sortOrder: 0,
    shopIds: [shopId],
    roleIds: ['role-a'],
    note: null,
  }];

  const workbook = await createRecruitmentWorkbook(plan);
  assert.ok(workbook);
  const sheet = workbook.getWorksheet('По площадкам');
  assert.ok(sheet);
  assert.equal(sheet.getRow(5).getCell(2).value, excelDateSerial(2027, 6, 4));
  assert.equal(sheet.getRow(5).getCell(7).value, 2);
  assert.equal(sheet.getRow(5).getCell(8).value, 4);
  assert.equal(sheet.getRow(5).getCell(9).value, excelDateSerial(2027, 6, 10));
});

test('workbook warns that template dates and role counts are unconfirmed', async () => {
  const workbook = await createRecruitmentWorkbook({
    ...project(),
    settings: { ...project().settings, templateDataStatus: 'unconfirmed' },
  });
  assert.ok(workbook);
  assert.match(String(workbook.getWorksheet('По площадкам')?.getCell('A3').value), /ПРЕДВАРИТЕЛЬНЫЕ ДАННЫЕ/);
  assert.match(String(workbook.getWorksheet('Сводка по профессиям')?.getCell('A3').value), /не подтверждены пользователем/);
  assert.match(String(workbook.getWorksheet('По площадкам')?.getCell('A3').value), /месяц = 30 календарных дней/);
});

test('workbook distinguishes missing provenance from user confirmation', async () => {
  const plan = project();
  const legacyWorkbook = await createRecruitmentWorkbook(plan);
  assert.ok(legacyWorkbook);
  assert.match(String(legacyWorkbook.getWorksheet('По площадкам')?.getCell('A3').value), /ИСТОЧНИК НЕ ОТСЛЕЖИВАЛСЯ/);

  const confirmedWorkbook = await createRecruitmentWorkbook({
    ...plan,
    settings: { ...plan.settings, templateDataStatus: 'confirmed' },
  });
  assert.ok(confirmedWorkbook);
  assert.match(String(confirmedWorkbook.getWorksheet('По площадкам')?.getCell('A3').value), /отмечены проверенными пользователем/);
});
