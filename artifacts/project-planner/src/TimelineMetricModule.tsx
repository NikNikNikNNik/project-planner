import type { ReactNode } from 'react';

export function TimelineMetricModule({
  title,
  tone,
  status,
  children,
}: {
  title: string;
  tone: 'payroll' | 'training';
  status?: string;
  children: ReactNode;
}) {
  const palette = tone === 'payroll'
    ? {
        border: 'border-[#d8e2d8]',
        header: 'bg-[#f3f6ef]',
        title: 'text-[#416350]',
        cumulative: '#416350',
        monthly: '#526b96',
      }
    : {
        border: 'border-[#e9d9c8]',
        header: 'bg-[#fbf5ed]',
        title: 'text-[#8a5a34]',
        cumulative: '#a85b32',
        monthly: '#8b6ca8',
      };

  return <section data-testid={`${tone}-timeline-module`} aria-label={title} className={`border-b ${palette.border}`}>
    <div className={`flex min-h-8 border-b ${palette.border} ${palette.header}`}>
      <div className={`sticky left-0 z-20 flex w-[184px] shrink-0 items-center bg-inherit px-4 text-[10px] font-extrabold ${palette.title}`}>
        {title}
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1.5 text-[9px] font-semibold text-[#70766f]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: palette.cumulative }} />
          Нарастающим итогом
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: palette.monthly }} />
          В помесячном выражении
        </span>
        {status && <span className="ml-auto rounded bg-white/75 px-2 py-0.5 font-medium text-[#7a684f]" title={status}>{status}</span>}
      </div>
    </div>
    {children}
  </section>;
}
