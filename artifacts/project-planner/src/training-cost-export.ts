import type ExcelJS from 'exceljs';
import type { TrainingCostReport } from './training-costs';
import { formatKzt } from './payroll.ts';
import { trainingDeliveryLabel } from './training-delivery.ts';

export async function createTrainingCostWorkbook(report: TrainingCostReport) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Планировщик проектов';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Затраты на обучение');
  sheet.columns = [
    { width: 54 }, { width: 20 }, { width: 22 }, { width: 22 },
    { width: 36 }, { width: 22 }, { width: 18 }, { width: 18 },
    { width: 18 }, { width: 70 }, { width: 24 }, { width: 24 }, { width: 18 }, { width: 24 },
  ];
  const title = report.kind === 'monthly'
    ? 'Затраты на обучение, в помесячном выражении'
    : 'Затраты на обучение, нарастающим итогом';
  const date = `${report.reportDate.slice(8, 10)}.${report.reportDate.slice(5, 7)}.${report.reportDate.slice(0, 4)}`;

  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF293640' } };
  sheet.mergeCells('A2:J2');
  sheet.getCell('A2').value = `Проект: ${report.projectTitle} · Дата: ${date}`;
  sheet.getCell('A2').font = { color: { argb: 'FF59645C' } };
  sheet.getCell('A4').value = report.kind === 'monthly' ? 'Расходы за месяц, ₸' : 'Расходы накопительно, ₸';
  sheet.getCell('B4').value = report.totalKzt;
  sheet.getCell('A4').font = { bold: true };
  sheet.getCell('B4').font = { bold: true, size: 14 };
  sheet.getCell('B4').numFmt = '#,##0 [$₸-kk-KZ]';
  if (report.partial) {
    sheet.mergeCells('A5:J5');
    sheet.getCell('A5').value = `Данные неполные. Не разнесено по датам: ${report.unallocatedEvents.length} событий, ${formatKzt(report.unallocatedCostKzt)}. Обучений без полной стоимости, включая выезд: ${report.unpricedEvents.length}. Стажировок без участников: ${report.unassignedAudienceEvents.length}.`;
    sheet.getCell('A5').font = { italic: true, color: { argb: 'FF9A6830' } };
  }

  const headingRow = report.partial ? 7 : 6;
  const headers = ['Обучение', 'Категория', 'Расчётная стоимость события с выездом, ₸', 'Сумма в выбранном периоде, ₸', 'Участники / группы', 'Цена группы из 10, ₸', 'Дней в периоде', 'Всего дней', 'Период', 'Источник и расчётное основание', 'Формат обучения', 'Выезд на 1 человека, ₸', 'Участников выезда', 'Выезд всего, ₸'];
  sheet.addRow([]);
  sheet.addRow(headers);
  const header = sheet.getRow(headingRow);
  header.values = headers;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF536F62' } };

  for (const line of report.lines) {
    const basis = line.internshipCostBasis;
    const audience = basis
      ? `${basis.participantCount} чел. / ${basis.groupCount} групп по ${basis.groupSize}${basis.participantCount % basis.groupSize !== 0 && basis.participantCount > 0 ? ' (округлено вверх)' : ''}`
      : '';
    const row = sheet.addRow([
      line.event.title,
      line.event.category,
      line.totalCostKzt,
      line.amountKzt,
      audience,
      basis?.pricePerGroupKzt ?? null,
      line.activeDaysInPeriod,
      line.activeDaysTotal,
      `${line.startDate} — ${line.endDate}`,
      line.event.note ?? '',
      trainingDeliveryLabel(line.event),
      line.event.deliveryMode === 'offsite' ? line.event.travelCostPerPersonKzt ?? null : null,
      line.event.deliveryMode === 'offsite' ? line.participantCount : null,
      line.travelCostKzt,
    ]);
    row.getCell(3).numFmt = '#,##0 [$₸-kk-KZ]';
    row.getCell(4).numFmt = '#,##0 [$₸-kk-KZ]';
    row.getCell(6).numFmt = '#,##0 [$₸-kk-KZ]';
    row.getCell(12).numFmt = '#,##0 [$₸-kk-KZ]';
    row.getCell(14).numFmt = '#,##0 [$₸-kk-KZ]';
    row.alignment = { vertical: 'top', wrapText: true };
  }
  sheet.views = [{ state: 'frozen', ySplit: headingRow }];
  sheet.autoFilter = { from: { row: headingRow, column: 1 }, to: { row: headingRow, column: headers.length } };

  if (report.unallocatedEvents.length || report.unpricedEvents.length || report.unassignedAudienceEvents.length) {
    const unresolved = workbook.addWorksheet('Без даты или стоимости');
    unresolved.columns = [{ width: 54 }, { width: 20 }, { width: 22 }, { width: 26 }, { width: 22 }, { width: 80 }, { width: 24 }];
    unresolved.addRow(['Обучение', 'Категория', 'Расчётная стоимость, ₸', 'Проблема', 'Цена группы из 10, ₸', 'Источник и расчётное основание', 'Формат обучения']);
    unresolved.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    unresolved.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B6C42' } };
    for (const entry of report.unallocatedEvents) {
      unresolved.addRow([entry.event.title, entry.event.category, entry.totalCostKzt, 'Не определена дата обучения', entry.internshipCostBasis?.pricePerGroupKzt ?? null, entry.event.note ?? '', trainingDeliveryLabel(entry.event)]);
    }
    for (const entry of report.unpricedEvents) {
      unresolved.addRow([entry.event.title, entry.event.category, entry.totalCostKzt, entry.event.costUsd === undefined ? 'Цена самого обучения не указана' : 'Стоимость выезда на человека не указана', entry.internshipCostBasis?.pricePerGroupKzt ?? null, entry.event.note ?? '', trainingDeliveryLabel(entry.event)]);
    }
    for (const entry of report.unassignedAudienceEvents) {
      unresolved.addRow([entry.event.title, entry.event.category, entry.totalCostKzt, 'Не назначены участники стажировки', entry.internshipCostBasis?.pricePerGroupKzt ?? null, entry.event.note ?? '', trainingDeliveryLabel(entry.event)]);
    }
    for (const row of unresolved.getRows(2, unresolved.rowCount - 1) ?? []) {
      row.getCell(3).numFmt = '#,##0 [$₸-kk-KZ]';
      row.getCell(5).numFmt = '#,##0 [$₸-kk-KZ]';
      row.alignment = { vertical: 'top', wrapText: true };
    }
    unresolved.views = [{ state: 'frozen', ySplit: 1 }];
    unresolved.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 7 } };
  }

  return workbook;
}

export async function downloadTrainingCostWorkbook(report: TrainingCostReport) {
  const workbook = await createTrainingCostWorkbook(report);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `затраты-на-обучение-${report.kind}-${report.reportDate}.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
