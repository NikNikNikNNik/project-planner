import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

const tabs = [
  { key: 'training', label: 'Подготовка персонала' },
  { key: 'dates', label: 'Контрольные даты' },
] as const;
type Tab = typeof tabs[number]['key'];

/** Keep both sections mounted so switching tabs does not discard in-progress input. */
export function PreparationPanel({ training, dates }: { training: ReactNode; dates: ReactNode }) {
  const [activeTab, setActiveTab] = useState<Tab>('training');
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(tabs[next].key);
    buttons.current[next]?.focus();
  };

  return (
    <section className="panel mt-4 overflow-hidden rounded-xl" aria-label="Подготовка персонала и контрольные даты">
      <div role="tablist" aria-label="Настройки подготовки персонала" className="flex border-b border-[#e5e1d7] bg-[#f7f5ee] px-2 sm:px-4">
        {tabs.map((tab, index) => (
          <button
            key={tab.key}
            ref={element => { buttons.current[index] = element; }}
            id={`${id}-${tab.key}-tab`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`${id}-${tab.key}-panel`}
            tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => setActiveTab(tab.key)}
            onKeyDown={event => handleKeyDown(event, index)}
            className={`min-w-0 border-b-2 px-3 py-3 text-xs font-extrabold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#bd4c2b] sm:px-4 ${activeTab === tab.key ? 'border-[#bd4c2b] text-[#bd4c2b]' : 'border-transparent text-[#737c76] hover:text-[#293640]'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map(tab => (
        <div
          key={tab.key}
          role="tabpanel"
          id={`${id}-${tab.key}-panel`}
          aria-labelledby={`${id}-${tab.key}-tab`}
          hidden={activeTab !== tab.key}
          tabIndex={0}
          className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#bd4c2b]"
        >
          {tab.key === 'training' ? training : dates}
        </div>
      ))}
    </section>
  );
}
