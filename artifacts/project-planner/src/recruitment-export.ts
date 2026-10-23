import type ExcelJS from 'exceljs';
import type { Project, Role, TrainingEvent } from '@workspace/api-client-react';
import { isShopIncludedInCalculation } from './calculation-scope.ts';
import { getProjectDayType, shiftKazakhstanWorkdays } from './kazakhstan-calendar.ts';
import { getProjectReadyDate, getRecruitmentStartDate, getShopReadyDate } from './readiness.ts';
import { durationInDays } from './training-planning.ts';

type RecruitmentRow = {
  recruitmentStartDate: string | null;
  deadline: string | null;
  readyDate: string | null;
  shop: string;
  role: string;
  group: string;
  headcount: number;
  trainingDays: number;
  onboardingDays: number;
};

const formatDate = (value?: string | null) => value
  ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
  : 'Не задано';

const toIsoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function shiftCalendarDays(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function trainingDays(event: TrainingEvent, dayType: 'calendar' | 'working') {
  const factor = event.unit === 'days'
    ? 1
    : event.unit === 'weeks'
      ? (dayType === 'working' ? 5 : 7)
      : (dayType === 'working' ? 22 : 30);
  return Math.max(0, Math.ceil(event.duration * factor));
}

function totalTrainingDays(events: TrainingEvent[], mode: 'sequential' | 'parallel', dayType: 'calendar' | 'working') {
  const durations = events.map(event => trainingDays(event, dayType));
  return mode === 'parallel' ? Math.max(0, ...durations) : durations.reduce((sum, duration) => sum + duration, 0);
}

function getRoleTrainingDays(project: Project, role: Role, shopId: string, dayType: 'calendar' | 'working') {
  const events = project.training.filter(event =>
    event.shopIds.includes(shopId) && (!event.roleIds.length || event.roleIds.includes(role.id)),
  );
  return totalTrainingDays(events, project.settings.calculationMode, dayType);
}

function buildRows(project: Project): RecruitmentRow[] {
  const dayType = getProjectDayType(project.settings);
  return project.shops.flatMap(shop => {
    if (!isShopIncludedInCalculation(shop)) return [];
    const readyDate = getShopReadyDate(project, shop.id);
    return shop.roles
      .filter(role => role.visible !== false && (role.headcount ?? 1) > 0)
      .map(role => {
        const days = getRoleTrainingDays(project, role, shop.id, dayType);
      const onboardingDays = days > 0
        ? durationInDays(
          project.settings.onboardingDuration ?? 0,
          project.settings.onboardingUnit ?? 'days',
          dayType,
        )
        : 0;
      const deadline = project.settings.contractDate ?? (readyDate
        ? dayType === 'working'
          ? shiftKazakhstanWorkdays(readyDate, -(days + onboardingDays), project.settings.additionalNonWorkingDates)
          : shiftCalendarDays(readyDate, -(days + onboardingDays))
        : null);
      return {
        recruitmentStartDate: getRecruitmentStartDate(
          deadline,
          project.settings.recruitmentLeadValue,
          project.settings.recruitmentLeadUnit,
        ),
        deadline,
        readyDate,
        shop: shop.name,
        role: role.name.trim(),
        group: role.group === 'itr' ? 'ИТР' : 'Рабочие',
        headcount: role.headcount ?? 1,
        trainingDays: days,
        onboardingDays,
      };
      });
  });
}

function excelDateSerial(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000 + 25569;
}

export async function createRecruitmentWorkbook(project: Project) {
  const readyDate = getProjectReadyDate(project);
  const recruitmentRows = buildRows(project);
  if (!recruitmentRows.length) return null;
  const dayType = getProjectDayType(project.settings);
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Планировщик проектов';
  workbook.created = new Date();
  const tableHeader = {
    font: { bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF293640' } },
    alignment: { vertical: 'middle' as const, wrapText: true },
  };
  const provenanceNotice = project.settings.templateDataStatus === 'confirmed'
    ? 'Исходные данные отмечены проверенными пользователем; это не означает независимую экспертизу.'
    : project.settings.templateDataStatus === 'unconfirmed'
      ? 'ПРЕДВАРИТЕЛЬНЫЕ ДАННЫЕ: даты, этапы и численность ролей из шаблона не подтверждены пользователем.'
      : 'ИСТОЧНИК НЕ ОТСЛЕЖИВАЛСЯ: проверьте даты, этапы и численность ролей до использования этой выгрузки.';
  const durationConversion = dayType === 'working'
    ? 'Условный пересчёт обучения: неделя = 5 рабочих дней, месяц = 22 рабочих дня. Рабочие дни исключают субботы, воскресенья и праздники Казахстана; подтверждённые дополнительные даты задаются в проекте.'
    : 'Условный пересчёт обучения: неделя = 7 календарных дней, месяц = 30 календарных дней.';
  const addIntro = (sheet: ExcelJS.Worksheet, width: number, note: string) => {
    sheet.addRow([`План набора персонала · ${project.title}`]);
    sheet.mergeCells(1, 1, 1, width);
    sheet.getRow(1).height = 28;
    sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF293640' } };
    sheet.addRow([`Сформировано: ${new Date().toLocaleDateString('ru-RU')} · Готовность персонала: ${formatDate(readyDate)}`]);
    sheet.mergeCells(2, 1, 2, width);
    sheet.getCell('A2').font = { size: 10, color: { argb: 'FF777B78' } };
    sheet.addRow([`${provenanceNotice} ${note} ${durationConversion}`]);
    sheet.mergeCells(3, 1, 3, width);
    sheet.getCell('A3').font = {
      italic: true,
      bold: project.settings.templateDataStatus !== 'confirmed',
      size: 9,
      color: { argb: project.settings.templateDataStatus === 'confirmed' ? 'FF49685B' : 'FF805C32' },
    };
    sheet.getCell('A3').alignment = { wrapText: true };
    sheet.getCell('A3').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: project.settings.templateDataStatus === 'confirmed' ? 'FFEEF4ED' : 'FFFFF4E4' },
    };
    sheet.getRow(3).height = 60;
  };

  const byPlant = workbook.addWorksheet('По площадкам');
  byPlant.columns = [
    { width: 20 }, { width: 18 }, { width: 20 }, { width: 44 },
    { width: 16 }, { width: 20 }, { width: 23 }, { width: 20 }, { width: 20 },
  ];
  addIntro(
    byPlant,
    9,
    'Дата начала рекрутинга рассчитывается с учётом настроек проекта. Срок найма рассчитывается отдельно по каждой профессии: дата готовности минус назначенные ей обучения и однократный онбординг. Если обучение не связано с конкретными ролями, оно учитывается для всех ролей выбранных площадок. Ручная дата контракта применяется ко всем строкам.',
  );
  byPlant.addRow(['Дата начала рекрутинга', 'Дата найма на контракт', 'Площадка', 'Профессия', 'Группа', 'Количество человек', 'Обучение на роль, дней', 'Онбординг на роль, дней', 'Дата готовности']);
  const firstDataRow = 5;
  for (const row of recruitmentRows) {
    byPlant.addRow([
      excelDateSerial(row.recruitmentStartDate), excelDateSerial(row.deadline), row.shop,
      row.role, row.group, row.headcount, row.trainingDays, row.onboardingDays, excelDateSerial(row.readyDate),
    ]);
  }
  byPlant.getRow(4).eachCell(cell => { cell.font = tableHeader.font; cell.fill = tableHeader.fill; cell.alignment = tableHeader.alignment; });
  byPlant.getRow(4).height = 34;
  byPlant.autoFilter = { from: { row: 4, column: 1 }, to: { row: firstDataRow + recruitmentRows.length - 1, column: 9 } };
  byPlant.views = [{ state: 'frozen', ySplit: 4 }];
  for (let row = firstDataRow; row < firstDataRow + recruitmentRows.length; row++) {
    byPlant.getCell(row, 1).numFmt = 'dd.mm.yyyy';
    byPlant.getCell(row, 2).numFmt = 'dd.mm.yyyy';
    byPlant.getCell(row, 9).numFmt = 'dd.mm.yyyy';
    if (row % 2 === 0) {
      byPlant.getRow(row).eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F0E9' } };
      });
    }
  }

  const summary = workbook.addWorksheet('Сводка по профессиям');
  summary.columns = [{ width: 20 }, { width: 20 }, { width: 44 }, { width: 16 }, { width: 22 }, { width: 42 }];
  addIntro(summary, 6, 'Численность суммирована по одинаковым профессиям и срокам найма на всех площадках проекта.');
  summary.addRow(['Дата начала рекрутинга', 'Дата найма на контракт', 'Профессия', 'Группа', 'Всего человек', 'Площадки']);
  const grouped = new Map<string, { recruitmentStartDate: string | null; deadline: string | null; role: string; group: string; headcount: number; shops: Set<string> }>();
  for (const row of recruitmentRows) {
    const key = `${row.recruitmentStartDate ?? ''}|${row.deadline ?? ''}|${row.role.toLocaleLowerCase('ru-RU')}|${row.group}`;
    const current = grouped.get(key) ?? {
      recruitmentStartDate: row.recruitmentStartDate,
      deadline: row.deadline,
      role: row.role,
      group: row.group,
      headcount: 0,
      shops: new Set<string>(),
    };
    current.headcount += row.headcount;
    current.shops.add(row.shop);
    grouped.set(key, current);
  }
  const summaryRows = [...grouped.values()].sort((a, b) =>
    (a.recruitmentStartDate ?? '9999-12-31').localeCompare(b.recruitmentStartDate ?? '9999-12-31') ||
    (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31') ||
    a.role.localeCompare(b.role, 'ru'),
  );
  for (const row of summaryRows) {
    summary.addRow([
      excelDateSerial(row.recruitmentStartDate), excelDateSerial(row.deadline), row.role,
      row.group, row.headcount, [...row.shops].sort((a, b) => a.localeCompare(b, 'ru')).join(', '),
    ]);
  }
  const summaryTotalRow = 5 + summaryRows.length;
  summary.addRow(['ИТОГО', '', '', '', summaryRows.reduce((sum, row) => sum + row.headcount, 0), '']);
  summary.getRow(4).eachCell(cell => { cell.font = tableHeader.font; cell.fill = tableHeader.fill; cell.alignment = tableHeader.alignment; });
  summary.getRow(4).height = 34;
  summary.getRow(summaryTotalRow).font = { bold: true };
  summary.getRow(summaryTotalRow).getCell(1).font = { bold: true, color: { argb: 'FF293640' } };
  summary.autoFilter = { from: { row: 4, column: 1 }, to: { row: summaryTotalRow - 1, column: 6 } };
  summary.views = [{ state: 'frozen', ySplit: 4 }];
  for (let row = 5; row < summaryTotalRow; row++) {
    summary.getCell(row, 1).numFmt = 'dd.mm.yyyy';
    summary.getCell(row, 2).numFmt = 'dd.mm.yyyy';
  }

  return workbook;
}

export async function downloadRecruitmentWorkbook(project: Project) {
  const workbook = await createRecruitmentWorkbook(project);
  if (!workbook) {
    window.alert('Нет ролей с численностью больше нуля, включённых в план.');
    return;
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = Uint8Array.from(buffer as unknown as ArrayLike<number>);
  const workbookData = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(workbookData).set(bytes);
  const blob = new Blob([workbookData], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeTitle = project.title.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Проект';
  anchor.href = url;
  anchor.download = `План набора персонала — ${safeTitle}.xlsx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
