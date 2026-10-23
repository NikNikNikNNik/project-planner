import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export function CollapsibleTimelineRow({
  title,
  tone,
  projectId,
  testId,
  contentId,
  children,
}: {
  title: string;
  tone: 'payroll' | 'training';
  projectId: string;
  testId: string;
  contentId: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setExpanded(false), [projectId]);

  const palette = tone === 'payroll'
    ? {
        border: 'border-[#d9dfea]',
        background: 'bg-[#edf1f7]',
        hover: 'hover:bg-[#e4eaf3]',
        text: 'text-[#455a7d]',
      }
    : {
        border: 'border-[#e1d9e9]',
        background: 'bg-[#f4f0f8]',
        hover: 'hover:bg-[#ece5f2]',
        text: 'text-[#725687]',
      };

  return <div data-testid={testId} role="group" aria-label={title} className={`border-b ${palette.border}`}>
    <button
      type="button"
      data-testid={`${testId}-toggle`}
      aria-expanded={expanded}
      aria-controls={contentId}
      onClick={() => setExpanded(value => !value)}
      className={`flex min-h-9 w-full items-stretch text-left transition-colors ${palette.background} ${palette.hover}`}
    >
      <span className={`sticky left-0 z-20 flex w-[184px] shrink-0 items-center gap-2 bg-inherit px-3 py-2 text-[9px] font-bold leading-tight ${palette.text}`}>
        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        <span>{title}</span>
      </span>
      <span className={`flex min-w-0 flex-1 items-center justify-end gap-2 px-3 py-2 text-[9px] font-semibold ${palette.text}`}>
        <span>{expanded ? 'Свернуть график' : 'Раскрыть график'}</span>
        <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </span>
    </button>
    <div id={contentId} hidden={!expanded}>
      {children}
    </div>
  </div>;
}
