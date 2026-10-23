import type ExcelJS from 'exceljs';
import type { PayrollBreakdown } from './payroll';

export async function createPayrollBreakdownWorkbook(report: PayrollBreakdown) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Планировщик проектов';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Расчёт ФОТ');
  sheet.columns = [
    { width: 34 }, { width: 42 }, { width: 14 }, { width: 25 },
    { width: 18 }, { width: 26 }, { width: 17 }, { width: 24 },
    { width: 40 },
  ];
  const title = report.kind === 'monthly'
    ? 'ФОТ, в помесячном выражении'
    : 'ФОТ, нарастающим итогом';
  const date = `${report.reportDate.slice(8, 10)}.${report.reportDate.slice(5, 7)}.${report.reportDate.slice(0, 4)}`;

  sheet.mergeCells('A1:I1');
  sheet.getCell('A1').value = title;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF293640' } };
  sheet.mergeCells('A2:I2');
  sheet.getCell('A2').value = `Проект: ${report.projectTitle}`;
  sheet.getCell('A3').value = 'Дата расчёта';
  sheet.getCell('B3').value = date;
  sheet.getCell('A4').value = 'Рассчитанный ФОТ, ₸';
  sheet.getCell('B4').value = report.totalKzt;
  sheet.getCell('B4').numFmt = '#,##0';
  sheet.getCell('A5').value = 'Численность в плане';
  sheet.getCell('B5').value = report.plannedPeople;
  sheet.getCell('A6').value = 'Учтено людей с известными ставкой и датой контракта';
  sheet.getCell('B6').value = report.includedPeople;
  sheet.mergeCells('A7:I7');
  sheet.getCell('A7').value = report.kind === 'monthly'
    ? 'Расчёт: месячная ставка на человека × численность × доля календарных дней с даты контракта в расчётном месяце. Учитываются только данные, сохранённые в проекте.'
    : 'Расчёт: месячная ставка на человека × численность × календарная доля месяцев с даты контракта по дату расчёта. Учитываются только данные, сохранённые в проекте.';
  sheet.getCell('A7').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(7).height = 42;
  if (report.partial) {
    sheet.mergeCells('A8:I8');
    sheet.getCell('A8').value = `В итог включена только известная часть. Без ставки: ${report.missingSalaryPeople} чел.; без даты «контракт»: ${report.missingContractPeople} чел.`;
    sheet.getCell('A8').font = { bold: true, color: { argb: 'FF9C4A16' } };
    sheet.getCell('A8').alignment = { wrapText: true };
    sheet.getRow(8).height = 30;
  }

  const headerRow = report.partial ? 10 : 9;
  const header = [
    'Цех', 'Профессия / роль', 'Людей', 'Месячная ставка на человека, ₸',
    'Дата «контракт»', report.kind === 'monthly' ? 'Дней начисления в месяце' : 'Месяцев начисления',
    report.kind === 'monthly' ? 'Дней в месяце' : 'Помесячный эквивалент ставки, ₸',
    report.kind === 'monthly' ? 'ФОТ за месяц, ₸' : 'ФОТ накопительно, ₸',
    'Причина отсутствия / примечание',
  ];
  sheet.addRow([]);
  const headers = sheet.getRow(headerRow);
  headers.values = header;
  headers.height = 36;
  headers.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF455A7D' } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });

  const totalColumn = report.kind === 'monthly' ? 8 : 8;
  for (const line of report.lines) {
    const accruedMonths = line.accruedMonths === null ? null : Math.round(line.accruedMonths * 10000) / 10000;
    const monthlyEquivalent = line.monthlyRateKzt === null ? null : line.monthlyRateKzt * line.people;
    const period = report.kind === 'monthly'
      ? line.accruedDays
      : accruedMonths;
    const duration = report.kind === 'monthly' ? line.daysInMonth : monthlyEquivalent;
    const row = sheet.addRow([
      line.shop,
      line.role,
      line.people,
      line.monthlyRateKzt,
      line.contractDate,
      period,
      duration,
      line.amountKzt,
      line.issue,
    ]);
    row.getCell(4).numFmt = '#,##0';
    row.getCell(5).numFmt = '@';
    row.getCell(6).numFmt = report.kind === 'monthly' ? '0' : '0.0000';
    row.getCell(7).numFmt = '#,##0';
    row.getCell(totalColumn).numFmt = '#,##0';
    row.eachCell({ includeEmpty: true }, cell => {
      cell.alignment = { vertical: 'top', wrapText: true };
    });
  }

  sheet.autoFilter = {
    from: { row: headerRow, column: 1 },
    to: { row: headerRow + report.lines.length, column: 9 },
  };
  sheet.views = [{ state: 'frozen', ySplit: headerRow }];
  return workbook;
}

export async function downloadPayrollBreakdownWorkbook(report: PayrollBreakdown) {
  const workbook = await createPayrollBreakdownWorkbook(report);
  const buffer = await workbook.xlsx.writeBuffer();
  const bytes = Uint8Array.from(buffer as unknown as ArrayLike<number>);
  const data = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(data).set(bytes);
  const blob = new Blob([data], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeTitle = report.projectTitle.replace(/[\\/:*?"<>|]/g, '-').trim() || 'Проект';
  const label = report.kind === 'monthly' ? 'ФОТ за месяц' : 'ФОТ накопительно';
  anchor.href = url;
  anchor.download = `${label} — ${safeTitle} — ${report.reportDate}.xlsx`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
