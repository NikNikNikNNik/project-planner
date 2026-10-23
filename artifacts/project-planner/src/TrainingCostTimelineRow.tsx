import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { Download } from 'lucide-react';
import type { Project } from '@workspace/api-client-react';
import { formatKzt } from './payroll';
import {
  getTrainingCostReport,
  getTrainingCostReportingDates,
  type TrainingCostEntry,
  type TrainingCostReport,
  type TrainingCostReportKind,
} from './training-costs';
import { downloadTrainingCostWorkbook } from './training-cost-export';

const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(2, 4)}`;

function TrainingCostDetailsPanel({ report }: { report: TrainingCostReport }) {
  const [exporting, setExporting] = useState(false);
  const title = report.kind === 'monthly'
    ? 'Затраты на обучение за месяц'
    : 'Затраты на обучение накопительно';
  const handleDownload = async () => {
    setExporting(true);
    try {
      await downloadTrainingCostWorkbook(report);
    } catch (error) {
      console.error('Failed to build training cost workbook', error);
      window.alert('Не удалось выгрузить затраты на обучение в Excel. Повторите попытку.');
    } finally {
      setExporting(false);
    }
  };

  return <div className="w-[min(92vw,900px)] overflow-hidden rounded-lg border border-[#e1d5c6] bg-[#fffefa] text-[#293640] shadow-2xl">
    <div className="flex items-start justify-between gap-4 border-b border-[#e8dfd3] bg-[#faf5ed] px-4 py-3">
      <div className="min-w-0">
        <div className="text-[12px] font-extrabold">{title} · {shortDate(report.reportDate)}{report.partial ? ' · неполные данные' : ''}{report.approximate ? ' · даты ориентировочные' : ''}</div>
        <div className="mt-1 truncate text-[10px] text-[#777d74]" title={report.projectTitle}>Проект: {report.projectTitle}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right">
          <div className="text-[9px] text-[#777d74]">Итого, ₸</div>
          <div className="text-[13px] font-extrabold tabular-nums">{report.partial ? '≥ ' : ''}{report.approximate ? '≈ ' : ''}{formatKzt(report.totalKzt)}</div>
        </div>
        <button type="button" disabled={exporting} onClick={() => void handleDownload()}
          aria-label="Выгрузить затраты на обучение в Excel" title="Выгрузить этот расчёт в Excel"
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-[#e1d5c6] bg-white text-[#8a5a34] hover:bg-[#f6eadc] disabled:cursor-wait disabled:opacity-50">
          <Download size={15} />
        </button>
      </div>
    </div>
    {report.partial && <div className="border-b border-[#eee4d8] px-4 py-2 text-[10px] text-[#806b52]">
      {report.unallocatedEvents.length > 0 && <div>Без даты: {report.unallocatedEvents.length} событий · {formatKzt(report.unallocatedCostKzt)}.</div>}
      {report.unpricedEvents.length > 0 && <div>Без указанной стоимости: {report.unpricedEvents.length} событий.</div>}
      {report.unassignedAudienceEvents.length > 0 && <div>Стажировки без назначенных участников: {report.unassignedAudienceEvents.length} событий; их сумма не включена.</div>}
    </div>}
    <div className="max-h-[min(55vh,360px)] overflow-auto">
      <table className="w-full border-collapse text-left text-[10px]">
        <thead className="sticky top-0 z-10 bg-[#f2eee6] text-[9px] text-[#59645c]">
          <tr>
            <th className="px-3 py-2 font-bold">Обучение</th>
            <th className="px-3 py-2 font-bold">Категория</th>
            <th className="px-3 py-2 text-right font-bold">Событие, ₸</th>
            <th className="px-3 py-2 text-right font-bold">В периоде, ₸</th>
            <th className="px-3 py-2 font-bold">Участники / группы</th>
            <th className="px-3 py-2 font-bold">Даты</th>
          </tr>
        </thead>
        <tbody>
          {report.lines.map((line, index) => <tr key={`${line.event.id}-${index}`} className={index % 2 === 0 ? 'bg-white' : 'bg-[#faf8f3]'}>
            <td className="max-w-[300px] px-3 py-1.5 font-medium">{line.event.title}{line.approximate ? ' · ≈' : ''}</td>
            <td className="px-3 py-1.5 text-[#59645c]">{line.event.category}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{formatKzt(line.totalCostKzt)}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold tabular-nums">{formatKzt(line.amountKzt)}</td>
            <td className="min-w-[180px] px-3 py-1.5 text-[#59645c]">{line.internshipCostBasis
              ? <>{line.internshipCostBasis.participantCount} чел. → {line.internshipCostBasis.groupCount} групп по {line.internshipCostBasis.groupSize}{line.internshipCostBasis.participantCount % line.internshipCostBasis.groupSize !== 0 && line.internshipCostBasis.participantCount > 0 ? ' · неполная группа округлена вверх' : ''}<div className="mt-0.5 text-[9px] text-[#777d74]">База: {line.internshipCostBasis.pricePerGroupKzt === null ? 'не указана' : `${formatKzt(line.internshipCostBasis.pricePerGroupKzt)} за группу`}</div></>
              : '—'}</td>
            <td className="whitespace-nowrap px-3 py-1.5 tabular-nums">{shortDate(line.startDate)} — {shortDate(line.endDate)}</td>
          </tr>)}
          {report.lines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-[#777d74]">В выбранном периоде нет датированных расходов на обучение.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>;
}

function TrainingCostPoint({ report, label, children }: {
  report: TrainingCostReport;
  label: string;
  children: ReactNode;
}) {
  return <HoverCard.Root openDelay={300} closeDelay={180}>
    <HoverCard.Trigger asChild>
      <button type="button" aria-label={`${label}, ${shortDate(report.reportDate)}`}
        className="block whitespace-nowrap rounded-sm text-left outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a85b32]">
        {children}
      </button>
    </HoverCard.Trigger>
    <HoverCard.Portal>
      <HoverCard.Content side="top" align="center" sideOffset={8} collisionPadding={12}
        className="z-[100] outline-none data-[side=top]:animate-in data-[side=top]:fade-in-0 data-[side=top]:zoom-in-95">
        <TrainingCostDetailsPanel report={report} />
        <HoverCard.Arrow className="fill-[#e1d5c6]" />
      </HoverCard.Content>
    </HoverCard.Portal>
  </HoverCard.Root>;
}

export function TrainingCostTimelineRow({
  project,
  entries,
  start,
  end,
  kind,
}: {
  project: Project;
  entries: TrainingCostEntry[];
  start: string;
  end: string;
  kind: TrainingCostReportKind;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(576);
  useEffect(() => {
    if (!track.current) return;
    const observer = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width));
    observer.observe(track.current);
    return () => observer.disconnect();
  }, []);

  const dates = useMemo(() => getTrainingCostReportingDates(start, end), [start, end]);
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const span = Math.max(1, Date.parse(`${end}T00:00:00Z`) - startMs);
  const monthly = kind === 'monthly';
  const points = dates.map(date => {
    const report = getTrainingCostReport(project.title, entries, date, kind);
    const left = Math.max(0, Math.min(100, (Date.parse(`${date}T00:00:00Z`) - startMs) / span * 100));
    return { date, report, left };
  });
  const capacity = Math.max(2, Math.floor(trackWidth / 100));
  const visiblePoints = !monthly && points.length > capacity
    ? Array.from({ length: capacity }, (_, index) => points[Math.round(index * (points.length - 1) / (capacity - 1))])
    : points;
  const labelWidth = monthly ? 64 : 82;
  const laneEnds: number[] = [];
  const positionedPoints = visiblePoints.map(point => {
    const center = trackWidth * point.left / 100;
    const pointLeft = point.left < 5 ? center : point.left > 95 ? center - labelWidth : center - labelWidth / 2;
    let lane = laneEnds.findIndex(lastRight => lastRight + 3 <= pointLeft);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = pointLeft + labelWidth;
    return { ...point, lane };
  });
  const rowHeight = monthly ? Math.max(46, (laneEnds.length + 1) * 15 + 4) : 56;
  const color = monthly ? '#8b6ca8' : '#a85b32';
  const label = monthly ? 'Затраты на обучение, в помесячном выражении' : 'Затраты на обучение, нарастающим итогом';
  const dataTestId = monthly ? 'training-cost-monthly-row' : 'training-cost-cumulative-row';
  const unknownTotal = positionedPoints.length > 0
    && positionedPoints.every(({ report }) => report.partial && report.totalKzt === 0 && report.lines.length === 0);

  return <div data-testid={dataTestId} className={`border-b ${monthly ? 'border-[#e1d9e9] bg-[#f4f0f8]' : 'border-[#eadbce] bg-[#fbf1e9]'}`} role="group" aria-label={label}>
    <div className="flex">
      <div className={`sticky left-0 z-20 flex w-[184px] shrink-0 flex-col justify-center px-4 py-2 text-[10px] font-bold ${monthly ? 'bg-[#f4f0f8] text-[#725687]' : 'bg-[#fbf1e9] text-[#8a4e2d]'}`}>
        <span>{label}</span>
        <span className="mt-0.5 text-[9px] font-normal">по всему проекту · ₸</span>
      </div>
      <div ref={track} className="timeline-grid relative min-w-0 flex-1 overflow-hidden" style={{ height: `${rowHeight}px` }}>
        {positionedPoints.map(({ date, report, left, lane }) => {
          const translate = left > 95 ? 'translateX(-100%)' : left < 5 ? undefined : 'translateX(-50%)';
          const prefix = `${report.partial ? '≥ ' : ''}${report.approximate ? '≈ ' : ''}`;
          const amount = unknownTotal ? '—' : `${prefix}${compact.format(report.totalKzt)}`;
          return <div key={date} className="absolute" style={{ left: `${left}%`, top: `${monthly ? 4 + lane * 15 : 7}px`, transform: translate }}>
            <TrainingCostPoint report={report} label={unknownTotal ? 'нет данных для расчёта' : formatKzt(report.totalKzt)}>
              <div className={`rounded px-0.5 tabular-nums ${monthly ? 'text-[8px] font-bold text-[#725687]' : 'text-[9px] font-extrabold text-[#8a4e2d]'}`}>
                {amount}
              </div>
              <div className="mt-0.5 text-[9px] text-[#827b73]">{shortDate(date)}</div>
            </TrainingCostPoint>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
