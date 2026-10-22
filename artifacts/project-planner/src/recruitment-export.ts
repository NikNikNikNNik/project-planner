import type ExcelJS from 'exceljs';
import type { Project, Role, TrainingEvent } from '@workspace/api-client-react';
import { getProjectReadyDate, getShopReadyDate } from './readiness';

type RecruitmentRow = {
  deadline: string | null;
  readyDate: string | null;
  shop: string;
  role: string;
  group: string;
  headcount: number;
  trainingDays: number;
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

function shiftWorkingDays(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  let remaining = Math.abs(days);
  const direction = days < 0 ? -1 : 1;
  while (remaining > 0) {
    date.setDate(date.getDate() + direction);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining--;
  }
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

function getRoleTrainingDays(project: Project, role: Role, shopId: string) {
  const events = project.training.filter(event =>
    event.shopIds.includes(shopId) && (!event.roleIds.length || event.roleIds.includes(role.id)),
  );
  return totalTrainingDays(events, project.settings.calculationMode, project.settings.dayType);
}

function buildRows(project: Project): RecruitmentRow[] {
  return project.shops.flatMap(shop => {
    const readyDate = getShopReadyDate(project, shop.id);
    return shop.roles
      .filter(role => role.visible && (role.headcount ?? 1) > 0)
      .map(role => {
      const days = getRoleTrainingDays(project, role, shop.id);
      const deadline = project.settings.contractDate ?? (readyDate
        ? project.settings.dayType === 'working'
          ? shiftWorkingDays(readyDate, -days)
          : shiftCalendarDays(readyDate, -days)
        : null);
      return {
        deadline,
        readyDate,
        shop: shop.name,
        role: role.name.trim(),
        group: role.group === 'itr' ? 'ИТР' : 'Рабочие',
        headcount: role.headcount ?? 1,
        trainingDays: days,
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
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Планировщик проектов';
  workbook.created = new Date();
  const tableHeader = {
    font: { bold: true, color: { argb: 'FFFFFFFF' } },
    fill: { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF293640' } },
    alignment: { vertical: 'middle' as const, wrapText: true },
  };
  const addIntro = (sheet: ExcelJS.Worksheet, width: number, note: string) => {
    sheet.addRow([`План набора персонала · ${project.title}`]);
    sheet.mergeCells(1, 1, 1, width);
    sheet.getRow(1).height = 28;
    sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF293640' } };
    sheet.addRow([`Сформировано: ${new Date().toLocaleDateString('ru-RU')} · Готовность персонала: ${formatDate(readyDate)}`]);
    sheet.mergeCells(2, 1, 2, width);
    sheet.getCell('A2').font = { size: 10, color: { argb: 'FF777B78' } };
    sheet.addRow([note]);
    sheet.mergeCells(3, 1, 3, width);
    sheet.getCell('A3').font = { italic: true, size: 9, color: { argb: 'FF777B78' } };
    sheet.getCell('A3').alignment = { wrapText: true };
    sheet.getRow(3).height = 36;
  };

  const byPlant = workbook.addWorksheet('По площадкам');
  byPlant.columns = [
    { width: 18 }, { width: 20 }, { width: 44 }, { width: 16 },
    { width: 20 }, { width: 23 }, { width: 20 },
  ];
  addIntro(
    byPlant,
    7,
    'Срок найма рассчитывается отдельно по каждой профессии: дата готовности минус назначенные ей обучения. Если обучение не связано с конкретными ролями, оно учитывается для всех ролей выбранных площадок. Ручная дата контракта применяется ко всем строкам.',
  );
  byPlant.addRow(['Дата найма на контракт', 'Площадка', 'Профессия', 'Группа', 'Количество человек', 'Обучение на роль, дней', 'Дата готовности']);
  const firstDataRow = 5;
  for (const row of recruitmentRows) {
    byPlant.addRow([
      excelDateSerial(row.deadline), row.shop, row.role, row.group, row.headcount,
      row.trainingDays, excelDateSerial(row.readyDate),
    ]);
  }
  byPlant.getRow(4).eachCell(cell => { cell.font = tableHeader.font; cell.fill = tableHeader.fill; cell.alignment = tableHeader.alignment; });
  byPlant.getRow(4).height = 34;
  byPlant.autoFilter = { from: { row: 4, column: 1 }, to: { row: firstDataRow + recruitmentRows.length - 1, column: 7 } };
  byPlant.views = [{ state: 'frozen', ySplit: 4 }];
  for (let row = firstDataRow; row < firstDataRow + recruitmentRows.length; row++) {
    byPlant.getCell(row, 1).numFmt = 'dd.mm.yyyy';
    byPlant.getCell(row, 7).numFmt = 'dd.mm.yyyy';
    if (row % 2 === 0) {
      byPlant.getRow(row).eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F0E9' } };
      });
    }
  }

  const summary = workbook.addWorksheet('Сводка по профессиям');
  summary.columns = [{ width: 20 }, { width: 44 }, { width: 16 }, { width: 22 }, { width: 42 }];
  addIntro(summary, 5, 'Численность суммирована по одинаковым профессиям и срокам найма на всех площадках проекта.');
  summary.addRow(['Дата найма на контракт', 'Профессия', 'Группа', 'Всего человек', 'Площадки']);
  const grouped = new Map<string, { deadline: string | null; role: string; group: string; headcount: number; shops: Set<string> }>();
  for (const row of recruitmentRows) {
    const key = `${row.deadline ?? ''}|${row.role.toLocaleLowerCase('ru-RU')}|${row.group}`;
    const current = grouped.get(key) ?? { deadline: row.deadline, role: row.role, group: row.group, headcount: 0, shops: new Set<string>() };
    current.headcount += row.headcount;
    current.shops.add(row.shop);
    grouped.set(key, current);
  }
  const summaryRows = [...grouped.values()].sort((a, b) =>
    (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31') || a.role.localeCompare(b.role, 'ru'),
  );
  for (const row of summaryRows) {
    summary.addRow([excelDateSerial(row.deadline), row.role, row.group, row.headcount, [...row.shops].sort((a, b) => a.localeCompare(b, 'ru')).join(', ')]);
  }
  const summaryTotalRow = 5 + summaryRows.length;
  summary.addRow(['ИТОГО', '', '', summaryRows.reduce((sum, row) => sum + row.headcount, 0), '']);
  summary.getRow(4).eachCell(cell => { cell.font = tableHeader.font; cell.fill = tableHeader.fill; cell.alignment = tableHeader.alignment; });
  summary.getRow(4).height = 34;
  summary.getRow(summaryTotalRow).font = { bold: true };
  summary.getRow(summaryTotalRow).getCell(1).font = { bold: true, color: { argb: 'FF293640' } };
  summary.autoFilter = { from: { row: 4, column: 1 }, to: { row: summaryTotalRow - 1, column: 5 } };
  summary.views = [{ state: 'frozen', ySplit: 4 }];
  for (let row = 5; row < summaryTotalRow; row++) summary.getCell(row, 1).numFmt = 'dd.mm.yyyy';

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
