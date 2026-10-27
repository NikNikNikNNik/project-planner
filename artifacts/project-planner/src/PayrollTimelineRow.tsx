import { useMemo, useState, type ReactNode } from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { Download } from 'lucide-react';
import type { Project } from '@workspace/api-client-react';
import { CollapsibleTimelineRow } from './CollapsibleTimelineRow';
import { getReadableTimelineLabelIndexes } from './timeline-labels';
import {
  formatKzt,
  getCumulativePayrollKzt,
  getMonthlyPayrollKzt,
  getPayrollBreakdown,
  getProjectPayroll,
  payrollReportingDates,
  type PayrollReportKind,
} from './payroll';
import { downloadPayrollBreakdownWorkbook } from './payroll-export';
import { useObservedWidth } from './use-observed-width';

const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;

function PayrollDetailsPanel({ project, reportDate, kind }: {
  project: Project;
  reportDate: string;
  kind: PayrollReportKind;
}) {
  const report = useMemo(() => getPayrollBreakdown(project, reportDate, kind), [project, reportDate, kind]);
  const [exporting, setExporting] = useState(false);
  const amountTitle = kind === 'monthly' ? 'ФОТ за этот месяц' : 'Накопленный ФОТ на эту дату';
  const periodTitle = kind === 'monthly' ? 'Дней начисления в месяце' : 'Месяцев начисления';
  const handleDownload = async () => {
    setExporting(true);
    try {
      await downloadPayrollBreakdownWorkbook(report);
    } catch (error) {
      console.error('Failed to build payroll detail workbook', error);
      window.alert('Не удалось выгрузить расчёт ФОТ в Excel. Повторите попытку.');
    } finally {
      setExporting(false);
    }
  };

  return <div className="w-[min(92vw,820px)] overflow-hidden rounded-lg border border-[#d5ddd1] bg-[#fffefa] text-[#27352f] shadow-2xl">
    <div className="flex items-start justify-between gap-4 border-b border-[#e0e5dc] bg-[#f6f7f1] px-4 py-3">
      <div className="min-w-0">
        <div className="text-[12px] font-extrabold">{amountTitle} · {shortDate(report.reportDate)}{report.partial ? ' · неполные данные' : ''}</div>
        <div className="mt-1 truncate text-[10px] text-[#777d74]" title={report.projectTitle}>Проект: {report.projectTitle}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right">
          <div className="text-[9px] text-[#777d74]">Итого, ₸</div>
          <div className="text-[13px] font-extrabold tabular-nums">{report.partial ? '≥ ' : ''}{formatKzt(report.totalKzt)}</div>
        </div>
        <button type="button" disabled={exporting} onClick={() => void handleDownload()}
          aria-label="Выгрузить расчёт ФОТ в Excel" title="Выгрузить этот расчёт в Excel"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#d4ddd1] bg-white text-[#44614f] hover:bg-[#eaf1e7] disabled:cursor-wait disabled:opacity-50">
          <Download size={15} />
        </button>
      </div>
    </div>
    <div className="max-h-[min(55vh,360px)] overflow-auto">
      <table className="w-full border-collapse text-left text-[10px]">
        <thead className="sticky top-0 z-10 bg-[#eef1e9] text-[9px] text-[#59645c]">
          <tr>
            <th className="px-3 py-2 font-bold">Цех</th>
            <th className="px-3 py-2 font-bold">Профессия / роль</th>
            <th className="px-3 py-2 text-right font-bold">Людей</th>
            <th className="px-3 py-2 text-right font-bold">Ставка на человека, ₸/мес.</th>
            <th className="px-3 py-2 font-bold">Контракт</th>
            <th className="px-3 py-2 text-right font-bold">{periodTitle}</th>
            <th className="px-3 py-2 text-right font-bold">{amountTitle}, ₸</th>
            <th className="px-3 py-2 font-bold">Примечание</th>
          </tr>
        </thead>
        <tbody>
          {report.lines.map((line, index) => <tr key={`${line.shop}-${line.role}-${index}`}
            className={index % 2 === 0 ? 'bg-white' : 'bg-[#f7f8f3]'}>
            <td className="max-w-[140px] px-3 py-1.5 text-[#59645c]">{line.shop}</td>
            <td className="max-w-[200px] px-3 py-1.5 font-medium">{line.role}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{line.people}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{line.monthlyRateKzt === null ? '—' : formatKzt(line.monthlyRateKzt)}</td>
            <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{line.contractDate ? shortDate(line.contractDate) : '—'}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{kind === 'monthly'
              ? line.accruedDays === null ? '—' : `${line.accruedDays} / ${line.daysInMonth}`
              : line.accruedMonths === null ? '—' : line.accruedMonths.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">
              {line.amountKzt === null ? '—' : formatKzt(line.amountKzt)}
            </td>
            <td className="max-w-[200px] px-3 py-1.5 text-[#866348]">{line.issue ?? ''}</td>
          </tr>)}
          {report.lines.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-[#777d74]">В плане нет ролей с положительной численностью.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

function PayrollPoint({ project, date, kind, left, children, label }: {
  project: Project;
  date: string;
  kind: PayrollReportKind;
  left: number;
  children: ReactNode;
  label: string;
}) {
  return <HoverCard.Root openDelay={300} closeDelay={180}>
    <HoverCard.Trigger asChild>
      <button type="button" aria-label={`${label}, ${shortDate(date)}`}
        className="block whitespace-nowrap rounded-sm text-left outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#7189ba]">
        {children}
      </button>
    </HoverCard.Trigger>
    <HoverCard.Portal>
      <HoverCard.Content side="top" align="center" sideOffset={8} collisionPadding={12}
        className="z-[100] outline-none data-[side=top]:animate-in data-[side=top]:fade-in-0 data-[side=top]:zoom-in-95">
        <PayrollDetailsPanel project={project} reportDate={date} kind={kind} />
        <HoverCard.Arrow className="fill-[#d5ddd1]" />
      </HoverCard.Content>
    </HoverCard.Portal>
  </HoverCard.Root>;
}

export function PayrollTimelineRow({ project, start, end }: { project: Project; start: string; end: string }) {
  const summary = useMemo(() => getProjectPayroll(project), [project]);
  const dates = useMemo(() => payrollReportingDates(start, end), [start, end]);
  const { ref: track, width: trackWidth } = useObservedWidth<HTMLDivElement>();
  const capacity = Math.max(2, Math.floor(trackWidth / 100));
  const shown = dates.length <= capacity ? dates : Array.from({ length: capacity },
    (_, i) => dates[Math.round(i * (dates.length - 1) / (capacity - 1))]);
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const span = Math.max(1, Date.parse(`${end}T00:00:00Z`) - startMs);
  const unknownTotal = summary.partial && summary.entries.length === 0;
  return <div data-testid="payroll-timeline-row" className="border-b border-[#d8e2d8] bg-[#eef3eb]" role="group" aria-label="ФОТ, нарастающим итогом">
    <div className="flex">
      <div className="sticky left-0 z-20 flex w-[184px] shrink-0 flex-col justify-center bg-[#eef3eb] px-4 py-2 text-[10px] font-bold text-[#416350]">
        <span>ФОТ, нарастающим итогом</span>
        <span className="mt-0.5 text-[9px] font-normal">по всему проекту · ₸{summary.partial ? ' · неполный' : ''}</span>
      </div>
      <div ref={track} className="timeline-grid relative h-14 min-w-0 flex-1 overflow-hidden">
        {shown.map(date => {
          const total = getCumulativePayrollKzt(summary.entries, date);
          const left = Math.max(0, Math.min(100, (Date.parse(`${date}T00:00:00Z`) - startMs) / span * 100));
          return <div key={date} className="absolute top-2"
            style={{ left: `${left}%`, transform: left > 90 ? 'translateX(-100%)' : left < 10 ? undefined : 'translateX(-50%)' }}>
            <PayrollPoint project={project} date={date} kind="cumulative" left={left}
              label={unknownTotal ? 'нет данных для расчёта' : formatKzt(total)}>
              <div className="text-[11px] font-extrabold text-[#355e49]">{unknownTotal ? '—' : `${summary.partial ? '≥ ' : ''}${compact.format(total)}`}</div>
              <div className="mt-0.5 text-[9px] text-[#778477]">{shortDate(date)}</div>
            </PayrollPoint>
          </div>;
        })}
      </div>
    </div>
  </div>;
}

export function PayrollMonthlyTimelineRow({ project, start, end }: { project: Project; start: string; end: string }) {
  const summary = useMemo(() => getProjectPayroll(project), [project]);
  const dates = useMemo(() => payrollReportingDates(start, end), [start, end]);
  const { ref: track, width: trackWidth } = useObservedWidth<HTMLDivElement>();

  const startMs = Date.parse(`${start}T00:00:00Z`);
  const span = Math.max(1, Date.parse(`${end}T00:00:00Z`) - startMs);
  const labelWidth = 76;
  const labelIndexes = getReadableTimelineLabelIndexes(dates.length, trackWidth, labelWidth);
  const laneEnds: number[] = [];
  const rawPoints = dates.map(date => {
    const amount = getMonthlyPayrollKzt(summary.entries, date);
    const left = Math.max(0, Math.min(100, (Date.parse(`${date}T00:00:00Z`) - startMs) / span * 100));
    return { date, amount, left };
  });
  const points = rawPoints.map((point, index) => {
    if (!labelIndexes.has(index)) return { ...point, lane: 0, showLabel: false };
    const { left } = point;
    const center = trackWidth * left / 100;
    const pointLeft = left < 5 ? center : left > 95 ? center - labelWidth : center - labelWidth / 2;
    let lane = laneEnds.findIndex(lastRight => lastRight + 3 <= pointLeft);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = pointLeft + labelWidth;
    return { ...point, lane, showLabel: true };
  });
  const rowHeight = Math.max(40, laneEnds.length * 17 + 22);
  const unknownTotal = summary.partial && summary.entries.length === 0;
  return <CollapsibleTimelineRow
    title="ФОТ, в помесячном выражении"
    tone="payroll"
    projectId={project.id}
    testId="payroll-monthly-collapsible"
    contentId="payroll-monthly-chart"
  >
    <div data-testid="payroll-monthly-timeline-row" className="border-b border-[#d9dfea] bg-[#edf1f7]" role="group" aria-label="ФОТ, в помесячном выражении">
      <div className="flex">
        <div className="sticky left-0 z-20 flex w-[184px] shrink-0 flex-col justify-center bg-[#edf1f7] px-4 py-2 text-[10px] font-bold text-[#455a7d]">
          <span>по всему проекту</span>
          <span className="mt-0.5 text-[9px] font-normal">₸ · точная сумма при наведении{summary.partial ? ' · неполный' : ''}</span>
        </div>
        <div ref={track} className="timeline-grid relative min-w-0 flex-1 overflow-hidden" style={{ height: `${rowHeight}px` }}>
          {points.map(({ date, amount, left, lane, showLabel }) => {
            const x = left > 95 ? 'translateX(-100%)' : left < 5 ? undefined : 'translateX(-50%)';
            return <div key={date} className="absolute" style={{ left: `${left}%`, top: `${showLabel ? 4 + lane * 17 : 23}px`, transform: x }}>
              <PayrollPoint project={project} date={date} kind="monthly" left={left}
                label={unknownTotal ? 'нет данных для расчёта' : formatKzt(amount)}>
                {showLabel
                  ? <div className="rounded border border-[#d5deeb] bg-white/95 px-1.5 py-0.5 text-[9px] font-extrabold leading-none tabular-nums text-[#344c73] shadow-sm">
                      {unknownTotal ? '—' : `${summary.partial ? '≥ ' : ''}${compact.format(amount)}`}
                    </div>
                  : <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center"><span className="block h-1.5 w-1.5 rounded-full bg-[#526b96] shadow-sm" /></span>}
              </PayrollPoint>
            </div>;
          })}
        </div>
      </div>
    </div>
  </CollapsibleTimelineRow>;
}
