import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import * as Tooltip from '@radix-ui/react-tooltip';
import {
  authenticateProject,
  logoutProjectAccess,
  useCopyProject,
  useCreateProject,
  useDeleteProject,
  useGetPlanningSummary,
  useGetProject,
  useListProjects,
  useUpdateProject,
  getListProjectsQueryKey,
  getGetPlanningSummaryQueryKey,
  getGetProjectQueryKey,
  type Project,
  type ProjectInput,
  type Phase,
  type TrainingEvent,
  type Role,
} from '@workspace/api-client-react';
import { downloadRecruitmentWorkbook } from './recruitment-export';
import {
  durationInDays,
  getOnboardingStartDate,
  getRoleTrainingPlan,
  getShopRoleSummary,
  reconcileTrainingRoles,
  scheduleTrainingTimeline,
  totalTrainingDays,
  trainingDays,
} from './training-planning';
import {
  commonMilestoneDate,
  getHiringResearchMilestones,
  getMilestoneDateForShop,
  getProjectReadyDate,
  getRecruitmentStartDate,
  getShopReadyDate,
  hiringResearchConfig,
  isMilestoneApplicableToShop,
  recruitmentLeadDefaults,
  shiftCalendarMonths,
  withMilestoneShopDate,
} from './readiness';
import { getProjectTimelineEnd, getShopTimelinePhases, REGIME_RAMP_UP_DAYS } from './timeline-phases';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowRight, CalendarDays, Check, FileSpreadsheet,
  ChevronDown, ChevronRight, CircleHelp, Copy, Factory, Flag,
  Pencil, Plus, Save, Settings2, SlidersHorizontal,
  Trash2, Users, ZoomIn, ZoomOut,
} from 'lucide-react';

const queryClient = new QueryClient();
const fmt = (date?: string | null) => date ? new Date(`${date.slice(0, 10)}T00:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Не задано';
const formatUsd = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const shiftDate = (value: string, days: number) => { const d = new Date(`${value}T12:00:00`); d.setDate(d.getDate() + days); return iso(d); };
const shiftWorkingDays = (value: string, days: number) => {
  const d = new Date(`${value}T12:00:00`);
  let left = Math.abs(days);
  const direction = days < 0 ? -1 : 1;
  while (left > 0) {
    d.setDate(d.getDate() + direction);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return iso(d);
};
const uid = () => `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const addMonths = shiftCalendarMonths;
const rawDateDiff = (a: string, b: string) => (new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86400000;
const dateDiff = (a: string, b: string) => Math.max(1, rawDateDiff(a, b));

const phaseNames: Record<string, string> = {
  construction: 'Стройка', precommissioning: 'ПредПНР',
  commissioning: 'ПНР', operation: 'Эксплуатация',
};
const phaseColors: Record<string, string> = {
  construction: '#3978a8', precommissioning: '#d39432',
  commissioning: '#8060a8', operation: '#54805e',
};
const trainingColors: Record<TrainingEvent['category'], string> = {
  mandatory: '#4f6d8a',
  technology: '#397d64',
  internship: '#a56e2c',
  lvcc: '#77548f',
  other: '#747b7d',
};
const categoryNames: Record<string, string> = {
  mandatory: 'Обязательное обучение', technology: 'Технологическое обучение',
  internship: 'Стажировки', lvcc: 'LVCC', other: 'Другие обучения',
};
const statusNames: Record<string, string> = { planned: 'Запланировано', in_progress: 'В процессе', completed: 'Завершено' };
const plantShort: Record<string, string> = { 'Пиролиз': 'ПИР', 'Бутен1': 'БУТ', 'Полимеризация': 'ПОЛ', 'ОЗХ': 'ОЗХ' };
const trainingCategories: TrainingEvent['category'][] = ['mandatory', 'technology', 'internship', 'lvcc', 'other'];
const defaultShopOptions = [
  { id: 'shop-1', name: 'Пиролиз' },
  { id: 'shop-2', name: 'Бутен1' },
  { id: 'shop-3', name: 'Полимеризация' },
  { id: 'shop-4', name: 'ОЗХ' },
] as const;

type WorkforceMode = 'shift' | 'local';
type OnboardingUnit = 'days' | 'weeks';
type StartupAnswers = {
  staffingMode: WorkforceMode;
  salaryMedianResearchDone: boolean;
  laborMarketResearchDone: boolean;
  hiringStrategyDone: boolean;
  onboardingDuration: number;
  onboardingUnit: OnboardingUnit;
};

function defaultMilestoneDates() {
  const start = addMonths(iso(new Date()), 1);
  return { mc: addMonths(start, 14), rfsu: addMonths(start, 20) };
}

function makeProjectInput(
  title: string,
  readyMonthsBefore: number,
  readyMilestone: 'mc' | 'rfsu',
  readyShopIds: string[],
  mcDates: Record<string, string | null>,
  rfsuDates: Record<string, string | null>,
  startupAnswers: StartupAnswers,
): ProjectInput {
  const today = iso(new Date());
  const start = addMonths(today, 1);
  const defaultEnd = addMonths(today, 24);
  const milestonesDates = [...Object.values(mcDates), ...Object.values(rfsuDates)].filter((date): date is string => !!date);
  const timelineDates = [
    ...milestonesDates,
    ...Object.values(rfsuDates).filter((date): date is string => !!date).map(date => shiftDate(date, REGIME_RAMP_UP_DAYS)),
  ];
  const projectStart = milestonesDates.reduce((earliest, date) => date < earliest ? date : earliest, start);
  const end = timelineDates.reduce((latest, date) => date > latest ? date : latest, defaultEnd);
  const templates: { name: string; itr: string[]; workers: string[] }[] = [
    {
      name: 'Пиролиз',
      itr: ['начальник цеха', 'технолог', 'механик', 'энергетик/электрик', 'КИПиА', 'специалист по ОТ и ПБ'],
      workers: ['оператор установки', 'машинист насосных установок', 'слесарь-ремонтник', 'электромонтёр', 'слесарь КИПиА', 'сварщик'],
    },
    {
      name: 'Бутен1',
      itr: ['начальник цеха', 'технолог', 'механик', 'энергетик/электрик', 'КИПиА', 'специалист по ОТ и ПБ'],
      workers: ['оператор установки', 'машинист компрессорной', 'слесарь-ремонтник', 'электромонтёр', 'слесарь КИПиА', 'сварщик'],
    },
    {
      name: 'Полимеризация',
      itr: ['начальник цеха', 'технолог полимеризации', 'механик', 'энергетик/электрик', 'КИПиА', 'специалист по ОТ и ПБ'],
      workers: ['оператор полимеризации', 'аппаратчик', 'машинист экструдера/гранулятора (если применимо)', 'слесарь-ремонтник', 'электромонтёр', 'слесарь КИПиА'],
    },
    {
      name: 'ОЗХ',
      itr: ['начальник цеха', 'технолог/инженер по эксплуатации', 'механик', 'энергетик/электрик', 'КИПиА', 'специалист по ОТ и ПБ'],
      workers: ['оператор водоподготовки/очистных сооружений', 'машинист компрессорных установок', 'оператор котельной (если применимо)', 'слесарь-ремонтник', 'электромонтёр', 'слесарь КИПиА'],
    },
  ];
  const shops = templates.map((template, i) => {
    const id = defaultShopOptions[i].id;
    return {
      id,
      name: template.name,
      roles: [
        ...template.itr.map((name, roleIndex) => ({ id: `${id}-itr-${roleIndex}`, name, group: 'itr' as const, visible: true, headcount: 1 })),
        ...template.workers.map((name, roleIndex) => ({ id: `${id}-worker-${roleIndex}`, name, group: 'workers' as const, visible: true, headcount: 1 })),
      ],
    };
  });
  const shopIds = shops.map(shop => shop.id);
  const sharedDate = (dates: Record<string, string | null>) => {
    const values = shopIds.map(id => dates[id] ?? null);
    return values.every(date => date === values[0]) ? values[0] ?? null : null;
  };
  return {
    title, startDate: projectStart, endDate: end, shops,
    phases: [
      { id: uid(), name: 'Подготовка площадки', type: 'construction', startDate: start, endDate: addMonths(start, 7), shopIds: shops.map(s => s.id), note: null },
      { id: uid(), name: 'СМР и ППНР', type: 'construction', startDate: addMonths(start, 5), endDate: addMonths(start, 14), shopIds: shops.slice(0, 3).map(s => s.id), note: null },
      { id: uid(), name: 'ПНР', type: 'commissioning', startDate: addMonths(start, 15), endDate: addMonths(start, 20), shopIds: shops.map(s => s.id), note: null },
    ],
    milestones: {
      mc: { date: sharedDate(mcDates), note: null, shopIds, shopDates: mcDates },
      rfsu: { date: sharedDate(rfsuDates), note: null, shopIds, shopDates: rfsuDates },
    },
    training: [],
    settings: {
      calculationMode: 'sequential', readyMode: 'relative', readyDate: null, daysBeforeMc: 45,
      readyOffsetUnit: 'days', readyMonthsBefore, readyMilestone, readyShopIds, dayType: 'calendar',
      contractDate: null, ...startupAnswers,
      salaryMedianResearchMonthsBeforeTraining: 18,
      laborMarketResearchMonthsBeforeTraining: 16,
      hiringStrategyMonthsBeforeTraining: 12,
      recruitmentLeadValue: recruitmentLeadDefaults.value,
      recruitmentLeadUnit: recruitmentLeadDefaults.unit,
    },
  };
}

function IconButton({ label, onClick, children, danger = false, testId }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean; testId?: string }) {
  return <button type="button" aria-label={label} title={label} data-testid={testId} onClick={e => { e.stopPropagation(); onClick(); }} className={`btn-quiet inline-flex h-8 w-8 items-center justify-center rounded-md ${danger ? 'text-[#a84732] hover:bg-[#f4e6e0]' : 'text-[#6d7475]'}`}>{children}</button>;
}

function Modal({ title, subtitle, onClose, children, wide = false, extraWide = false }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; wide?: boolean; extraWide?: boolean }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#17232c]/45 p-4 backdrop-blur-[2px]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={`fade-in max-h-[calc(100dvh-2rem)] w-full overflow-y-auto ${extraWide ? 'max-w-5xl' : wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl border border-[#ded9ce] bg-[#fbfaf5] shadow-[0_24px_80px_rgba(23,35,44,.24)]`}>
      <header className="flex items-start justify-between border-b border-[#e5e1d7] px-6 py-5">
        <div><h2 className="display-font text-xl font-semibold text-[#293640]">{title}</h2>{subtitle && <p className="mt-1 text-sm text-[#777b78]">{subtitle}</p>}</div>
        <IconButton label="Закрыть" onClick={onClose}><span className="text-xl leading-none">×</span></IconButton>
      </header>
      {children}
    </section>
  </div>;
}

function Planner() {
  const qc = useQueryClient();
  const projectsQuery = useListProjects();
  const summaryQuery = useGetPlanningSummary();
  const projects = projectsQuery.data ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const [accessGrantedId, setAccessGrantedId] = useState<string | null>(null);
  const activeSummary = projects.find(p => p.id === activeId) ?? projects[0];
  const activeProjectIndex = Math.max(0, projects.findIndex(p => p.id === activeSummary?.id));
  const projectId = activeId ?? activeSummary?.id ?? '';
  const projectQuery = useGetProject(projectId, { query: { enabled: !!projectId && accessGrantedId === projectId, queryKey: getGetProjectQueryKey(projectId) } });
  const createMutation = useCreateProject();
  const deleteMutation = useDeleteProject();
  const copyMutation = useCopyProject();
  const updateMutation = useUpdateProject();
  const [draft, setDraft] = useState<Project | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [modal, setModal] = useState<'startup' | 'new' | 'access' | 'copy' | 'phase' | 'training' | 'roles' | 'settings' | null>(null);
  const [editingPhase, setEditingPhase] = useState<Phase | null>(null);
  const [editingTraining, setEditingTraining] = useState<TrainingEvent | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accessUsername, setAccessUsername] = useState('');
  const [accessPassword, setAccessPassword] = useState('');
  const [accessReady, setAccessReady] = useState(false);
  const [accessError, setAccessError] = useState('');
  const [accessSubmitting, setAccessSubmitting] = useState(false);
  const [copyUsername, setCopyUsername] = useState('');
  const [copyPassword, setCopyPassword] = useState('');
  const [newStaffingMode, setNewStaffingMode] = useState<WorkforceMode | ''>('');
  const [newSalaryMedianResearchDone, setNewSalaryMedianResearchDone] = useState<boolean | null>(null);
  const [newLaborMarketResearchDone, setNewLaborMarketResearchDone] = useState<boolean | null>(null);
  const [newHiringStrategyDone, setNewHiringStrategyDone] = useState<boolean | null>(null);
  const [newOnboardingDuration, setNewOnboardingDuration] = useState('');
  const [newOnboardingUnit, setNewOnboardingUnit] = useState<OnboardingUnit | ''>('');
  const startupAnswersComplete = newStaffingMode !== '' &&
    newSalaryMedianResearchDone !== null &&
    newLaborMarketResearchDone !== null &&
    newHiringStrategyDone !== null &&
    newOnboardingDuration !== '' &&
    Number.isInteger(Number(newOnboardingDuration)) &&
    Number(newOnboardingDuration) >= 0 &&
    newOnboardingUnit !== '';
  const [newReadyMonths, setNewReadyMonths] = useState('');
  const [newReadyMilestone, setNewReadyMilestone] = useState<'' | 'mc' | 'rfsu'>('');
  const [newReadyShopIds, setNewReadyShopIds] = useState<string[]>([]);
  const [newMcDates, setNewMcDates] = useState<Record<string, string | null>>({});
  const [newRfsuDates, setNewRfsuDates] = useState<Record<string, string | null>>({});
  const [newMcAllDate, setNewMcAllDate] = useState('');
  const [newRfsuAllDate, setNewRfsuAllDate] = useState('');
  const [timelineStart, setTimelineStart] = useState('');
  const [timelineEnd, setTimelineEnd] = useState('');
  const [expandedShopIds, setExpandedShopIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [toast, setToast] = useState('');
  const initializedId = useRef('');
  const savedJson = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ x: number; start: string; end: string; span: number } | null>(null);
  const phaseDragRef = useRef<{ id: string; x: number; start: string; end: string; span: number; mode: 'move' | 'start' | 'end' } | null>(null);
  const phaseMovedRef = useRef(false);

  useEffect(() => {
    const data = projectQuery.data;
    if (data && data.id !== initializedId.current) {
      initializedId.current = data.id;
      setDraft(data);
      savedJson.current = JSON.stringify(data);
      setTimelineStart(data.startDate);
      setTimelineEnd(getProjectTimelineEnd(data));
      setExpandedShopIds([]);
      setZoom(1);
    }
  }, [projectQuery.data]);
  useEffect(() => {
    if (!draft || draft.id !== projectId || initializedId.current !== projectId) return;
    const serialized = JSON.stringify({ ...draft, updatedAt: undefined });
    const saved = JSON.stringify({ ...JSON.parse(savedJson.current || '{}'), updatedAt: undefined });
    if (!savedJson.current || serialized === saved) return;
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const input: ProjectInput = {
        title: draft.title, startDate: draft.startDate, endDate: draft.endDate,
        shops: draft.shops, phases: draft.phases, milestones: draft.milestones,
        training: draft.training, settings: draft.settings,
      };
      updateMutation.mutate({ projectId: draft.id, data: input }, {
        onSuccess: updated => {
          savedJson.current = JSON.stringify(updated);
          setSaveState('saved');
          qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetPlanningSummaryQueryKey() });
        },
        onError: () => setSaveState('error'),
      });
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [draft, projectId]);

  const patch = (changes: Partial<Project>) => setDraft(current => current ? { ...current, ...changes } : current);
  const notify = (text: string) => { setToast(text); setTimeout(() => setToast(''), 2600); };
  const openNewProject = () => {
    const dates = defaultMilestoneDates();
    const shopIds = defaultShopOptions.map(shop => shop.id);
    setNewTitle('');
    setNewUsername('');
    setNewPassword('');
    setNewStaffingMode('');
    setNewSalaryMedianResearchDone(null);
    setNewLaborMarketResearchDone(null);
    setNewHiringStrategyDone(null);
    setNewOnboardingDuration('');
    setNewOnboardingUnit('');
    setNewReadyMonths('');
    setNewReadyMilestone('');
    setNewReadyShopIds(shopIds);
    setNewMcDates(Object.fromEntries(shopIds.map(id => [id, dates.mc])));
    setNewRfsuDates(Object.fromEntries(shopIds.map(id => [id, dates.rfsu])));
    setNewMcAllDate(dates.mc);
    setNewRfsuAllDate(dates.rfsu);
    setModal('startup');
  };
  const setAllNewMilestoneDates = (code: 'mc' | 'rfsu', date: string) => {
    const dates = Object.fromEntries(defaultShopOptions.map(shop => [shop.id, date]));
    if (code === 'mc') {
      setNewMcAllDate(date);
      setNewMcDates(dates);
    } else {
      setNewRfsuAllDate(date);
      setNewRfsuDates(dates);
    }
  };
  const setNewShopMilestoneDate = (code: 'mc' | 'rfsu', shopId: string, date: string) => {
    const currentDates = code === 'mc' ? newMcDates : newRfsuDates;
    const nextDates = { ...currentDates, [shopId]: date };
    const firstDate = nextDates[defaultShopOptions[0].id] ?? '';
    const allSame = defaultShopOptions.every(shop => nextDates[shop.id] === firstDate);
    if (code === 'mc') {
      setNewMcDates(nextDates);
      setNewMcAllDate(allSame ? firstDate : '');
    } else {
      setNewRfsuDates(nextDates);
      setNewRfsuAllDate(allSame ? firstDate : '');
    }
  };
  const createProject = (e: FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    const readyMonths = Number(newReadyMonths);
    const onboardingDuration = Number(newOnboardingDuration);
    const allShopIds = defaultShopOptions.map(shop => shop.id);
    const datesComplete = allShopIds.every(shopId => !!newMcDates[shopId] && !!newRfsuDates[shopId]);
    if (
      !title || newReadyMonths === '' || !Number.isInteger(readyMonths) || readyMonths < 0 ||
      !newReadyMilestone || newReadyShopIds.length === 0 || !datesComplete ||
      !newStaffingMode || newSalaryMedianResearchDone === null ||
      newLaborMarketResearchDone === null || newHiringStrategyDone === null ||
      newOnboardingDuration === '' || !Number.isInteger(onboardingDuration) || onboardingDuration < 0 ||
      newOnboardingUnit === ''
    ) return;
    const startupAnswers: StartupAnswers = {
      staffingMode: newStaffingMode,
      salaryMedianResearchDone: newSalaryMedianResearchDone,
      laborMarketResearchDone: newLaborMarketResearchDone,
      hiringStrategyDone: newHiringStrategyDone,
      onboardingDuration,
      onboardingUnit: newOnboardingUnit,
    };
    if (newUsername.trim().length < 3 || newPassword.length < 8) return;
    createMutation.mutate({ data: {
      ...makeProjectInput(title, readyMonths, newReadyMilestone, newReadyShopIds, newMcDates, newRfsuDates, startupAnswers),
      access: { username: newUsername.trim(), password: newPassword },
    } }, {
      onSuccess: created => {
        qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPlanningSummaryQueryKey() });
        setAccessGrantedId(created.id);
        setActiveId(created.id); setDraft(created); initializedId.current = created.id;
        savedJson.current = JSON.stringify(created); setModal(null); setNewTitle(''); setNewUsername(''); setNewPassword('');
      },
      onError: () => notify('Не удалось создать проект. Повторите попытку.'),
    });
  };
  const openProject = (id: string) => {
    if (timer.current) clearTimeout(timer.current);
    initializedId.current = '';
    setDraft(null);
    setAccessGrantedId(null);
    setAccessUsername('');
    setAccessPassword('');
    setAccessError('');
    setAccessReady(false);
    setActiveId(id);
    qc.removeQueries({ queryKey: getGetProjectQueryKey(id) });
    setModal('access');
    void logoutProjectAccess().then(() => setAccessReady(true)).catch(() => {
      setAccessError('Не удалось завершить предыдущий сеанс. Обновите страницу и попробуйте снова.');
    });
  };
  const submitProjectAccess = async (event: FormEvent) => {
    event.preventDefault();
    if (!projectId || !accessReady || accessSubmitting) return;
    setAccessSubmitting(true);
    setAccessError('');
    try {
      await authenticateProject(projectId, { username: accessUsername.trim(), password: accessPassword });
      setAccessGrantedId(projectId);
      setAccessPassword('');
      setModal(null);
      await qc.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      setAccessError(status === 429
        ? 'Слишком много попыток. Попробуйте позже.'
        : status === 401
          ? 'Неверный логин или пароль.'
          : 'Не удалось проверить доступ. Попробуйте ещё раз.');
    } finally {
      setAccessSubmitting(false);
    }
  };
  useEffect(() => {
    if (!activeId && projects.length) openProject(projects[0].id);
  }, [activeId, projects]);
  const moveProject = (direction: -1 | 1) => {
    if (!projects.length) return;
    const currentIndex = projects.findIndex(item => item.id === activeSummary?.id);
    const startIndex = currentIndex < 0 ? 0 : currentIndex;
    openProject(projects[(startIndex + direction + projects.length) % projects.length].id);
  };
  const copyCurrent = (event: FormEvent) => {
    event.preventDefault();
    if (!projectId) return;
    if (copyUsername.trim().length < 3 || copyPassword.length < 8) return;
    copyMutation.mutate({ projectId, data: { username: copyUsername.trim(), password: copyPassword } }, {
      onSuccess: copied => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); qc.invalidateQueries({ queryKey: getGetPlanningSummaryQueryKey() }); setAccessGrantedId(copied.id); setActiveId(copied.id); setDraft(copied); initializedId.current = copied.id; savedJson.current = JSON.stringify(copied); setCopyUsername(''); setCopyPassword(''); setModal(null); notify('Создана копия проекта'); },
      onError: () => notify('Не удалось скопировать проект'),
    });
  };
  const removeProject = () => {
    if (!projectId || !window.confirm(`Удалить проект «${draft?.title ?? activeSummary?.title}»? Это действие нельзя отменить.`)) return;
    deleteMutation.mutate({ projectId }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); qc.invalidateQueries({ queryKey: getGetPlanningSummaryQueryKey() }); initializedId.current = ''; setDraft(null); setAccessGrantedId(null); setActiveId(null); notify('Проект удалён'); },
      onError: () => notify('Не удалось удалить проект'),
    });
  };
  const duplicateTraining = (event: TrainingEvent) => {
    if (!project) return;
    patch({ training: [...project.training, { ...event, id: uid(), title: `${event.title} — копия`, sortOrder: project.training.length }] });
    notify('Мероприятие скопировано');
  };
  const moveTraining = (eventId: string, direction: -1 | 1) => {
    if (!project) return;
    const sorted = [...project.training].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = sorted.findIndex(item => item.id === eventId);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= sorted.length) return;
    [sorted[index], sorted[next]] = [sorted[next], sorted[index]];
    patch({ training: sorted.map((event, sortOrder) => ({ ...event, sortOrder })) });
  };

  const project = draft && draft.id === projectId ? draft : null;
  const totalDays = project ? dateDiff(timelineStart || project.startDate, timelineEnd || project.endDate) : 1;
  const position = (date: string) => Math.max(0, Math.min(100, (rawDateDiff(timelineStart || project!.startDate, date) / totalDays) * 100));
  const width = (a: string, b: string) => Math.max(1.6, position(b) - position(a));
  const months = useMemo(() => {
    if (!project) return [];
    const start = new Date(`${timelineStart || project.startDate}T12:00:00`);
    const end = new Date(`${timelineEnd || project.endDate}T12:00:00`);
    const items: { label: string; left: number }[] = [];
    const current = new Date(start.getFullYear(), start.getMonth(), 1);
    const spanMonths = Math.max(1, rawDateDiff(iso(start), iso(end)) / 30);
    const tickStep = spanMonths > 18 ? 3 : spanMonths > 12 ? 2 : 1;
    let monthIndex = 0;
    while (current <= end && items.length < 60) {
      if (monthIndex % tickStep === 0) {
        const day = iso(current);
        items.push({ label: current.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' }), left: position(day) });
      }
      current.setMonth(current.getMonth() + 1);
      monthIndex++;
    }
    return items;
  }, [project, timelineStart, timelineEnd]);
  const staffReadyDate = project ? getProjectReadyDate(project) : null;
  const trainingTimeline = useMemo(
    () => project ? scheduleTrainingTimeline(project, staffReadyDate) : [],
    [project, staffReadyDate],
  );
  const onboardingDurationDays = project
    ? durationInDays(
      project.settings.onboardingDuration ?? 0,
      project.settings.onboardingUnit ?? 'days',
      project.settings.dayType,
    )
    : 0;
  const firstTrainingStart = trainingTimeline.reduce<string | null>(
    (first, item) => !first || item.startDate < first ? item.startDate : first,
    null,
  );
  const hiringResearchMilestones = useMemo(
    () => project ? getHiringResearchMilestones(project, firstTrainingStart) : [],
    [project, firstTrainingStart],
  );
  const expandedRoleTimelineDates = useMemo(() => {
    if (!project) return [];
    return project.shops
      .filter(shop => expandedShopIds.includes(shop.id))
      .flatMap(shop => shop.roles
        .filter(role => role.visible)
        .flatMap(role => {
          const rolePlan = getRoleTrainingPlan(project, shop.id, role.id, getShopReadyDate(project, shop.id));
          const contractDate = rolePlan.contractDate;
          const onboardingStartDate = getOnboardingStartDate(
            rolePlan.startDate,
            project.settings.onboardingDuration ?? 0,
            project.settings.onboardingUnit ?? 'days',
            project.settings.dayType,
          );
          return [contractDate, onboardingStartDate, getRecruitmentStartDate(
            contractDate,
            project.settings.recruitmentLeadValue,
            project.settings.recruitmentLeadUnit,
          )].filter((date): date is string => date !== null);
        }));
  }, [project, expandedShopIds, onboardingDurationDays]);
  useEffect(() => {
    if (!project || (!trainingTimeline.length && !expandedRoleTimelineDates.length && !hiringResearchMilestones.length)) return;
    const dates = [
      ...trainingTimeline.flatMap(item => [item.startDate, item.endDate]),
      ...expandedRoleTimelineDates,
      ...hiringResearchMilestones.map(item => item.date),
    ].sort();
    setTimelineStart(current => !current || dates[0] < current ? dates[0] : current);
    setTimelineEnd(current => !current || dates[dates.length - 1] > current ? dates[dates.length - 1] : current);
  }, [project?.id, trainingTimeline, expandedRoleTimelineDates, hiringResearchMilestones]);
  const plannedTrainingDays = project
    ? totalTrainingDays(project.training, project.settings.calculationMode, project.settings.dayType)
    : 0;
  const calculatedContractDate = project && staffReadyDate
    ? (project.settings.dayType === 'working'
      ? shiftWorkingDays(staffReadyDate, -plannedTrainingDays)
      : shiftDate(staffReadyDate, -plannedTrainingDays))
    : null;
  const contractDate = project?.settings.contractDate ?? calculatedContractDate;
  const contractShortfall = project?.settings.contractDate && calculatedContractDate
    ? Math.max(0, rawDateDiff(calculatedContractDate, project.settings.contractDate))
    : 0;
  const missingReadyShopNames = project?.settings.readyMilestone && project.settings.readyMonthsBefore !== undefined
    ? (project.settings.readyShopIds ?? project.shops.map(shop => shop.id))
      .filter(shopId => !getShopReadyDate(project, shopId))
      .map(shopId => project.shops.find(shop => shop.id === shopId)?.name ?? shopId)
    : [];
  const warningMessages = project ? [
    ...project.phases.filter(p => p.endDate < p.startDate).map(() => 'У этапа дата окончания раньше даты начала.'),
    ...(project.shops.some(shop => {
      const mcDate = getMilestoneDateForShop(project.milestones.mc, shop.id);
      const rfsuDate = getMilestoneDateForShop(project.milestones.rfsu, shop.id);
      return mcDate && rfsuDate && mcDate > rfsuDate;
    }) ? ['MC задана позже RFSU хотя бы для одного цеха. Проверьте контрольные даты.'] : []),
    ...(project.settings.readyMilestone && project.settings.readyMonthsBefore !== undefined && !(project.settings.readyShopIds ?? project.shops.map(shop => shop.id)).length ? ['Выберите хотя бы один цех для правила готовности 100%.'] : []),
    ...(missingReadyShopNames.length ? [`Для расчёта готовности задайте дату ${project.settings.readyMilestone?.toUpperCase()} для цехов: ${missingReadyShopNames.join(', ')}.`] : []),
    ...(!project.settings.readyMilestone && project.settings.readyMode === 'relative' && !project.milestones.mc.date ? ['Для расчёта даты готовности персонала сначала задайте MC.'] : []),
    ...(!project.settings.readyMilestone && project.settings.readyMode === 'fixed' && project.settings.readyDate && project.milestones.mc.date && project.settings.readyDate > project.milestones.mc.date ? ['Персонал готов позже даты MC.'] : []),
    ...(contractDate && staffReadyDate && contractDate > staffReadyDate ? ['Дата контракта позже даты готовности персонала.'] : []),
    ...(contractShortfall > 0 ? [`До готовности персонала не хватает ${Math.ceil(contractShortfall)} дн. при выбранной дате контракта.`] : []),
  ] : [];
  const warnings = warningMessages.length;
  const zoomTimeline = (next: number) => {
    zoomTimelineAt(next, 0.5);
  };
  const zoomTimelineAt = (next: number, anchorRatio: number) => {
    const bounded = Math.max(.55, Math.min(2.4, next));
    const start = timelineStart || project!.startDate;
    const end = timelineEnd || project!.endDate;
    const span = dateDiff(start, end);
    const nextSpan = Math.max(45, Math.round(span * zoom / bounded));
    const anchor = shiftDate(start, Math.round(span * anchorRatio));
    setTimelineStart(shiftDate(anchor, -Math.round(nextSpan * anchorRatio)));
    setTimelineEnd(shiftDate(anchor, Math.round(nextSpan * (1 - anchorRatio))));
    setZoom(bounded);
  };
  const expandTimeline = (dates: (string | null | undefined)[]) => {
    const values = dates.filter((date): date is string => !!date).sort();
    if (!values.length) return;
    setTimelineStart(current => !current || values[0] < current ? values[0] : current);
    setTimelineEnd(current => !current || values[values.length - 1] > current ? values[values.length - 1] : current);
  };
  const startPhaseDrag = (event: ReactPointerEvent<HTMLButtonElement>, phase: Phase) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = Math.min(10, rect.width / 3);
    const localX = event.clientX - rect.left;
    const mode = localX <= edge ? 'start' : localX >= rect.width - edge ? 'end' : 'move';
    phaseMovedRef.current = false;
    phaseDragRef.current = {
      id: phase.id, x: event.clientX, start: phase.startDate, end: phase.endDate,
      span: dateDiff(timelineStart || project!.startDate, timelineEnd || project!.endDate), mode,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePhaseDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = phaseDragRef.current;
    const timeline = event.currentTarget.parentElement;
    if (!drag || !timeline) return;
    const delta = Math.round(((event.clientX - drag.x) / timeline.getBoundingClientRect().width) * drag.span);
    if (!delta) return;
    phaseMovedRef.current = true;
    let startDate = drag.start;
    let endDate = drag.end;
    if (drag.mode === 'move') {
      startDate = shiftDate(drag.start, delta);
      endDate = shiftDate(drag.end, delta);
    } else if (drag.mode === 'start') {
      startDate = shiftDate(drag.start, delta);
      if (startDate > drag.end) startDate = drag.end;
    } else {
      endDate = shiftDate(drag.end, delta);
      if (endDate < drag.start) endDate = drag.start;
    }
    expandTimeline([startDate, endDate]);
    setDraft(current => current ? {
      ...current,
      phases: current.phases.map(item => item.id === drag.id ? { ...item, startDate, endDate } : item),
    } : current);
  };
  const handleTimelineWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!project) return;
    event.preventDefault();
    const start = timelineStart || project.startDate;
    const end = timelineEnd || project.endDate;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      const shift = Math.round(dateDiff(start, end) * Math.sign(event.deltaX) * 0.035);
      setTimelineStart(shiftDate(start, shift));
      setTimelineEnd(shiftDate(end, shift));
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    zoomTimelineAt(zoom * (event.deltaY > 0 ? 0.92 : 1.08), ratio);
  };
  const handleTimelinePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!project || event.pointerType !== 'mouse' || event.button !== 0) return;
    if (event.target instanceof HTMLElement && event.target.closest('button, input, select')) return;
    dragRef.current = {
      x: event.clientX,
      start: timelineStart || project.startDate,
      end: timelineEnd || project.endDate,
      span: dateDiff(timelineStart || project.startDate, timelineEnd || project.endDate),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handleTimelinePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const days = Math.round(((dragRef.current.x - event.clientX) / rect.width) * dragRef.current.span);
    setTimelineStart(shiftDate(dragRef.current.start, days));
    setTimelineEnd(shiftDate(dragRef.current.end, days));
  };
  const retrySave = () => {
    if (!project) return;
    setSaveState('saving');
    updateMutation.mutate({
      projectId: project.id,
      data: {
        title: project.title, startDate: project.startDate, endDate: project.endDate,
        shops: project.shops, phases: project.phases, milestones: project.milestones,
        training: project.training, settings: project.settings,
      },
    }, {
      onSuccess: updated => {
        savedJson.current = JSON.stringify(updated);
        setSaveState('saved');
        qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetPlanningSummaryQueryKey() });
      },
      onError: () => setSaveState('error'),
    });
  };

  if (projectsQuery.isLoading) return <main className="min-h-[100dvh] bg-[#f5f2e9] p-8"><div className="h-10 w-72 animate-pulse rounded bg-[#e7e2d7]" /><div className="mt-8 h-64 animate-pulse rounded-xl bg-[#ebe7dd]" /></main>;
  if (projectsQuery.isError) return <main className="flex min-h-[100dvh] items-center justify-center bg-[#f5f2e9]"><div className="panel max-w-md rounded-xl p-8 text-center"><AlertTriangle className="mx-auto mb-3 text-[#bd4c2b]" /><h1 className="display-font text-xl">Не удалось загрузить портфель</h1><p className="mt-2 text-sm text-[#6d7475]">Проверьте соединение с сервером и попробуйте ещё раз.</p><button className="btn-primary mt-5 rounded-md px-4 py-2 text-sm font-bold" onClick={() => projectsQuery.refetch()}>Повторить</button></div></main>;

  return <div className="app-shell grain text-[#293640]">
    <main className="min-w-0">
      <header className="flex h-[66px] items-center justify-between border-b border-[#e0dcd1] bg-[#f8f6ef] px-5 md:px-8">
        <div className="flex min-w-0 items-center gap-2 text-xs text-[#777b78]"><span>Портфель</span><ChevronRight size={13} /><span className="truncate font-bold text-[#293640]">{project?.title ?? 'Выберите проект'}</span></div>
        <div className="flex items-center gap-2">
          <div className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:flex ${saveState === 'error' ? 'border-[#e5b9ad] bg-[#f8eae5] text-[#a5432d]' : 'border-[#d8ddd4] bg-[#edf2e9] text-[#55725c]'}`}>
            {saveState === 'saving' ? <Save size={12} /> : saveState === 'error' ? <AlertTriangle size={12} /> : <Check size={12} />}
            {saveState === 'saving' ? 'Сохранение…' : saveState === 'error' ? 'Не удалось сохранить' : 'Сохранено'}
          </div>
          {project && <button onClick={retrySave} disabled={updateMutation.isPending} className="control inline-flex h-9 items-center gap-1.5 px-2.5 text-xs font-bold text-[#56645e] disabled:opacity-50"><Save size={13} />{saveState === 'error' ? 'Повторить' : 'Сохранить'}</button>}
          <button data-testid="button-new-project" onClick={openNewProject} className="btn-primary inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-bold"><Plus size={15} />Новый проект</button>
        </div>
      </header>

      <div className="mx-auto w-full px-3 py-4 sm:px-4 md:px-6 md:py-6 2xl:px-8">
        <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[repeat(5,minmax(0,1fr))_minmax(190px,1.25fr)]">
          <SummaryTile label="Проекты в работе" value={summaryQuery.data?.projectCount ?? projects.length} unit="проектов" tone="orange" />
          <SummaryTile label="Контрольные этапы" value={summaryQuery.data?.phaseCount ?? 0} unit="этапов" tone="teal" />
          <SummaryTile label="Программы обучения" value={summaryQuery.data?.trainingCount ?? 0} unit="событий" tone="sand" />
          <SummaryTile label="Идёт сейчас" value={summaryQuery.data?.activeTrainingCount ?? 0} unit="обучений" tone="blue" />
          <div className="panel flex min-h-[68px] min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 py-2">
            <div className="min-w-0"><div className="truncate text-[8px] font-bold uppercase tracking-[.1em] text-[#85877e]">Текущий проект</div><div title={project?.title ?? 'Нет выбранного проекта'} className="mt-1 truncate text-xs font-bold">{project?.title ?? 'Нет выбранного проекта'}</div></div>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#eee9dd] text-[#65716d]"><Factory size={15} /></div>
          </div>
          <section className="panel flex min-h-[68px] min-w-0 items-center gap-2 rounded-lg px-2.5 py-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center justify-between gap-1">
                <span className="truncate text-[8px] font-bold uppercase tracking-[.1em] text-[#85877e]">Портфель проектов</span>
                <span className="mono shrink-0 text-[9px] text-[#898a82]">{projects.length}</span>
              </div>
              {projects.length ? <div className="grid grid-cols-[24px_minmax(0,1fr)_24px] items-center gap-1">
                <button type="button" data-testid="button-portfolio-previous" aria-label="Предыдущий проект" title="Предыдущий проект" disabled={projects.length < 2} onClick={() => moveProject(-1)} className="control flex h-7 w-6 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"><ArrowLeft size={12} /></button>
                <button type="button" data-testid="button-portfolio-current" aria-label={`Открыть проект ${activeSummary?.title ?? ''}`} onClick={() => activeSummary && openProject(activeSummary.id)} className="control flex h-7 min-w-0 items-center justify-between gap-1 px-2 text-[10px]">
                  <span className="truncate">{activeSummary?.title ?? 'Выберите проект'}</span>
                  <span className="mono shrink-0 text-[8px] text-[#85877e]">{activeProjectIndex + 1}/{projects.length}</span>
                </button>
                <button type="button" data-testid="button-portfolio-next" aria-label="Следующий проект" title="Следующий проект" disabled={projects.length < 2} onClick={() => moveProject(1)} className="control flex h-7 w-6 items-center justify-center disabled:cursor-not-allowed disabled:opacity-40"><ArrowRight size={12} /></button>
              </div> : <button type="button" onClick={openNewProject} className="truncate text-left text-[10px] font-semibold text-[#bd4c2b] hover:underline">Добавить первый проект</button>}
            </div>
            <button type="button" aria-label="Добавить проект" title="Добавить проект" onClick={openNewProject} className="btn-quiet flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#bd4c2b]"><Plus size={15} /></button>
          </section>
        </section>

        <div className="min-w-0">

          <section className="min-w-0">
            {!projects.length ? <div className="panel flex min-h-[450px] flex-col items-center justify-center rounded-xl px-6 text-center"><div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-[#f0e7db] text-[#bd4c2b]"><Factory size={25} /></div><h2 className="display-font text-2xl">Начните с проекта</h2><p className="mt-2 max-w-sm text-sm leading-relaxed text-[#777b78]">Создайте план строительства — затем синхронизируйте этапы четырёх цехов, контрольные даты и подготовку команд.</p><button className="btn-primary mt-5 rounded-md px-4 py-2.5 text-sm font-bold" onClick={openNewProject}>Создать проект</button></div> :
            projectQuery.isLoading || !project ? <div className="panel min-h-[390px] animate-pulse rounded-xl p-6"><div className="h-7 w-64 rounded bg-[#e9e5db]" /><div className="mt-7 h-40 rounded-lg bg-[#f0ede5]" /><div className="mt-5 h-24 rounded-lg bg-[#f0ede5]" /></div> :
            <>
              {warningMessages.length > 0 && <div role="alert" className="mb-4 rounded-lg border border-[#e7c9ac] bg-[#fbf2e6] px-4 py-3 text-[11px] text-[#805c32]">
                <div className="mb-1 flex items-center gap-1.5 font-extrabold"><AlertTriangle size={13} />Проверьте план</div>
                {warningMessages.map((message, index) => <p key={`${message}-${index}`} className="ml-5 mt-0.5 leading-relaxed">{message}</p>)}
              </div>}
              <div className="panel mb-4 rounded-xl">
                <div className="flex flex-col justify-between gap-4 border-b border-[#e5e1d7] px-5 py-4 md:flex-row md:items-center">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[#868980]"><span className="h-1.5 w-1.5 rounded-full bg-[#638578]" />План реализации <span className="text-[#c5bfb1]">/</span> {project.shops.length} производственных площадки</div>
                    <div className="mt-2 flex items-center gap-2">
                      <input data-testid="input-project-title" className="display-font min-w-0 max-w-full border-0 border-b border-transparent bg-transparent p-0 text-xl font-semibold text-[#293640] outline-none hover:border-[#d3cec1] focus:border-[#bd4c2b] md:text-2xl" value={project.title} onChange={e => patch({ title: e.target.value })} />
                      <Pencil size={14} className="shrink-0 text-[#9c9a8e]" />
                    </div>
                    <div className="mt-1 text-xs text-[#777b78]">{fmt(project.startDate)} — {fmt(project.endDate)} <span className="mx-1 text-[#c5bfb1]">·</span> {project.phases.length} этапа <span className="mx-1 text-[#c5bfb1]">·</span> {project.training.length} обучающих событий</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button data-testid="button-add-phase" onClick={() => { setEditingPhase(null); setModal('phase'); }} className="control inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold text-[#4b5959]"><Plus size={13} />Этап</button>
                    <button data-testid="button-add-training" onClick={() => { setEditingTraining(null); setModal('training'); }} className="control inline-flex h-8 items-center gap-1.5 px-2.5 text-[11px] font-bold text-[#4b5959]"><Users size={13} />Обучение</button>
                    <button onClick={() => { void downloadRecruitmentWorkbook(project).catch(error => { console.error('Failed to build recruitment workbook', error); window.alert('Не удалось сформировать Excel-файл. Повторите попытку.'); }); }} className="btn-primary inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[10px] font-bold sm:text-[11px]"><FileSpreadsheet size={14} />Сформировать план набора персонала</button>
                    <button aria-label="Настройки расчёта" onClick={() => setModal('settings')} className="control flex h-8 w-8 items-center justify-center text-[#65716d]"><Settings2 size={14} /></button>
                    <IconButton label="Копировать проект" onClick={() => { setCopyUsername(''); setCopyPassword(''); setModal('copy'); }}><Copy size={14} /></IconButton>
                    <IconButton label="Удалить проект" onClick={removeProject} danger><Trash2 size={14} /></IconButton>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="flex items-center gap-2 text-[11px]"><span className="font-bold uppercase tracking-[.12em] text-[#88897f]">Режим расчёта</span><button onClick={() => patch({ settings: { ...project.settings, calculationMode: project.settings.calculationMode === 'parallel' ? 'sequential' : 'parallel' } })} className="control inline-flex h-7 items-center gap-2 px-2.5 text-[11px] font-bold"><span className={`h-1.5 w-1.5 rounded-full ${project.settings.calculationMode === 'parallel' ? 'bg-[#5d8777]' : 'bg-[#bd4c2b]'}`} />{project.settings.calculationMode === 'parallel' ? 'Параллельно' : 'Последовательно'}<ChevronDown size={12} /></button></div>
                  <div className="flex items-center gap-3 text-[11px] text-[#6f7774]">
                    <span>Готовность персонала</span>
                    <span className="font-semibold text-[#293640]">{fmt(staffReadyDate)}</span>
                    <span>Контракт</span>
                    <span className="font-semibold text-[#293640]">{fmt(contractDate)}</span>
                    {warnings > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-[#f8e9df] px-2 py-1 font-bold text-[#a7472e]"><AlertTriangle size={12} />{warnings} предупреждение</span>}
                  </div>
                </div>
              </div>

              <div className="panel overflow-hidden rounded-xl">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e1d7] px-4 py-3.5 md:px-5">
                  <div className="flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#e9e5d9] text-[#586764]"><CalendarDays size={15} /></div><div><h2 className="text-sm font-extrabold">Сводный календарный план</h2><p className="text-[10px] text-[#8a8b82]">Этапы по площадкам и готовность кадров</p></div></div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className="hidden items-center gap-1 text-[10px] text-[#85877e] sm:flex">с <input aria-label="Начало диапазона" type="date" value={timelineStart || project.startDate} onChange={e => setTimelineStart(e.target.value)} className="control h-7 w-[118px] px-1.5 text-[10px]" /></label>
                    <label className="hidden items-center gap-1 text-[10px] text-[#85877e] sm:flex">по <input aria-label="Конец диапазона" type="date" value={timelineEnd || project.endDate} onChange={e => setTimelineEnd(e.target.value)} className="control h-7 w-[118px] px-1.5 text-[10px]" /></label>
                    <div className="mx-1 hidden h-5 border-l border-[#dfdbcf] sm:block" />
                    <IconButton label="Отдалить" onClick={() => zoomTimeline(zoom - .15)}><ZoomOut size={14} /></IconButton>
                    <span className="mono min-w-[32px] text-center text-[10px] text-[#767a75]">{Math.round(zoom * 100)}%</span>
                    <IconButton label="Приблизить" onClick={() => zoomTimeline(zoom + .15)}><ZoomIn size={14} /></IconButton>
                    <IconButton label="Сдвинуть раньше" onClick={() => { const delta = Math.round(totalDays * .15 / zoom); setTimelineStart(s => shiftDate(s || project.startDate, -delta)); setTimelineEnd(s => shiftDate(s || project.endDate, -delta)); }}><ArrowLeft size={14} /></IconButton>
                    <IconButton label="Сдвинуть позже" onClick={() => { const delta = Math.round(totalDays * .15 / zoom); setTimelineStart(s => shiftDate(s || project.startDate, delta)); setTimelineEnd(s => shiftDate(s || project.endDate, delta)); }}><ArrowRight size={14} /></IconButton>
                    <button onClick={() => { setTimelineStart(project.startDate); setTimelineEnd(getProjectTimelineEnd(project)); setZoom(1); }} className="btn-quiet rounded px-2 py-1 text-[10px] font-bold text-[#586764]">Весь проект</button>
                    <button onClick={() => { const now = iso(new Date()); const span = Math.max(90, Math.round(totalDays / zoom)); setTimelineStart(shiftDate(now, -span * .35)); setTimelineEnd(shiftDate(now, span * .65)); }} className="btn-quiet rounded px-2 py-1 text-[10px] font-bold text-[#bd4c2b]">Сегодня</button>
                  </div>
                </div>
                {project.phases.length === 0 ? <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center"><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#f1e9de] text-[#bd4c2b]"><Flag size={17} /></div><div className="text-sm font-bold">В плане пока нет этапов</div><p className="mt-1 text-xs text-[#85877e]">Добавьте этап строительства или пусконаладки.</p><button onClick={() => { setEditingPhase(null); setModal('phase'); }} className="mt-3 text-xs font-bold text-[#b84628]">Добавить этап</button></div> :
                <div
                  className="overflow-x-auto cursor-grab active:cursor-grabbing"
                  onWheel={handleTimelineWheel}
                  onPointerDown={handleTimelinePointerDown}
                  onPointerMove={handleTimelinePointerMove}
                  onPointerUp={() => { dragRef.current = null; }}
                  onPointerCancel={() => { dragRef.current = null; }}
                >
                  <div className="relative min-w-[760px]">
                    <div className="flex border-b border-[#e7e2d8] bg-[#f7f5ee]">
                      <div className="sticky left-0 z-20 w-[184px] shrink-0 bg-[#f7f5ee] px-4 py-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#83867f]">Площадка / этап / обучение</div>
                      <div className="timeline-grid relative h-8 flex-1 overflow-hidden">{months.map((m, i) => <span key={`${m.label}-${i}`} className="absolute top-2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold uppercase text-[#888a80]" style={{ left: `${m.left}%` }}>{m.label}</span>)}</div>
                    </div>
                    {hiringResearchMilestones.length > 0 && <div className="flex min-h-[42px] border-b border-[#ece8df]">
                      <div className="sticky left-0 z-[5] flex w-[184px] shrink-0 items-center bg-[#fbfaf5] px-4 text-[9px] font-bold text-[#596461]">Подготовка к найму</div>
                      <div className="timeline-grid relative h-[42px] min-w-0 flex-1">
                        <TodayLine start={timelineStart || project.startDate} totalDays={totalDays} />
                      </div>
                    </div>}
                    {project.shops.map((shop, shopIndex) => {
                      const phases = getShopTimelinePhases(project.phases, project.milestones, shop.id);
                      const rowMinHeight = Math.max(75, 10 + Math.max(0, phases.length - 1) * 22 + 30);
                      const roleSummary = getShopRoleSummary(shop);
                      const plannedRoles = roleSummary.roles;
                      const visibleRoles = roleSummary.count;
                      const rolesExpanded = expandedShopIds.includes(shop.id);
                      const shopReadyDate = getShopReadyDate(project, shop.id);
                      const mcDate = getMilestoneDateForShop(project.milestones.mc, shop.id);
                      const rfsuDate = getMilestoneDateForShop(project.milestones.rfsu, shop.id);
                      const mcReady = isMilestoneApplicableToShop(project.milestones.mc, shop.id);
                      const rfsuReady = isMilestoneApplicableToShop(project.milestones.rfsu, shop.id);
                      return <div key={shop.id} className="border-b border-[#ece8df] last:border-0">
                        <div className="flex min-h-[75px]" style={{ minHeight: `${rowMinHeight}px` }}>
                          <div className="sticky left-0 z-[5] flex w-[184px] shrink-0 flex-col justify-center bg-[#fbfaf5] px-4">
                            <div className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-extrabold ${['bg-[#e8eee5] text-[#507565]', 'bg-[#f3ead9] text-[#92713c]', 'bg-[#f4e4dc] text-[#a64d32]', 'bg-[#e5ebef] text-[#5e7380]'][shopIndex % 4]}`}>{plantShort[shop.name] ?? `Ц${shopIndex + 1}`}</span><span className="text-xs font-bold">{shop.name}</span></div>
                            <div className="ml-8 mt-1 max-w-[168px] text-[8px] leading-[1.25] text-[#85877e]">
                              <p className="truncate" title={`ИТР: ${roleSummary.itr.map(r => r.name).join(', ')}`}>ИТР · {roleSummary.itr.map(r => r.name).join(', ') || '—'}</p>
                              <p className="truncate" title={`Рабочие: ${roleSummary.workers.map(r => r.name).join(', ')}`}>Рабочие · {roleSummary.workers.map(r => r.name).join(', ') || '—'}</p>
                              <div className="mt-0.5 flex items-center gap-1 font-semibold">
                                <span className="text-[#85877e]">{visibleRoles} в плане</span>
                                <button type="button" aria-label={`Изменить роли цеха ${shop.name}`} title="Изменить роли" onClick={() => setModal('roles')} className="flex h-5 w-5 items-center justify-center rounded text-[#8b8d83] hover:bg-[#efece3] hover:text-[#bd4c2b]"><Pencil size={10} /></button>
                                <button type="button" aria-label={`${rolesExpanded ? 'Свернуть' : 'Раскрыть'} процессы цеха ${shop.name}`} aria-expanded={rolesExpanded} title={rolesExpanded ? 'Свернуть процессы' : 'Раскрыть процессы'} onClick={() => setExpandedShopIds(current => current.includes(shop.id) ? current.filter(id => id !== shop.id) : [...current, shop.id])} className="flex h-5 w-5 items-center justify-center rounded text-[#68746f] hover:bg-[#e8eee8]">
                                  <ChevronDown size={13} className={`transition-transform ${rolesExpanded ? 'rotate-180' : ''}`} />
                                </button>
                              </div>
                            </div>
                          </div>
                          <div className="timeline-grid relative min-w-0 flex-1 py-2.5">
                            <TodayLine start={timelineStart || project.startDate} totalDays={totalDays} />
                            {phases.map((timelinePhase, i) => {
                              const left = position(timelinePhase.startDate);
                              const barWidth = width(timelinePhase.startDate, timelinePhase.endDate);
                              const title = `${timelinePhase.name}: ${fmt(timelinePhase.startDate)} — ${fmt(timelinePhase.endDate)}${timelinePhase.editablePhase ? '. Перетащите полосу, чтобы сдвинуть; края — чтобы изменить даты.' : '. Даты определяются контрольными точками.'}`;
                              const style = { top: `${10 + i * 22}px`, left: `${left}%`, width: `${barWidth}%`, backgroundColor: phaseColors[timelinePhase.type] ?? '#587c79' };
                              if (!timelinePhase.editablePhase) return <div key={timelinePhase.id} title={title} onPointerDown={event => event.stopPropagation()} className="phase-bar absolute flex h-[18px] items-center overflow-hidden rounded-[4px] px-2 text-[9px] font-bold text-white shadow-sm" style={style}><span className="truncate">{timelinePhase.name}</span></div>;
                              const phase = timelinePhase.editablePhase;
                              return <button key={timelinePhase.id} onPointerDown={event => startPhaseDrag(event, phase)} onPointerMove={movePhaseDrag} onPointerUp={() => { phaseDragRef.current = null; }} onPointerCancel={() => { phaseDragRef.current = null; }} onClick={() => { if (phaseMovedRef.current) { phaseMovedRef.current = false; return; } setEditingPhase(phase); setModal('phase'); }} title={title} className="phase-bar absolute flex h-[18px] touch-none items-center overflow-hidden rounded-[4px] px-2 text-left text-[9px] font-bold text-white shadow-sm cursor-grab active:cursor-grabbing" style={style}><span aria-hidden="true" className="absolute left-0 top-0 h-full w-[5px] cursor-ew-resize bg-black/10" /><span className="truncate">{timelinePhase.name}</span><span aria-hidden="true" className="absolute right-0 top-0 h-full w-[5px] cursor-ew-resize bg-black/10" /></button>;
                            })}
                            {(!rolesExpanded || !plannedRoles.length) && contractDate && <MilestoneLine date={contractDate} start={timelineStart || project.startDate} totalDays={totalDays} label="На контракт" color="#8060a8" />}
                            {shopReadyDate && <MilestoneLine date={shopReadyDate} start={timelineStart || project.startDate} totalDays={totalDays} label="Готов 100%" color="#315f59" />}
                            {mcReady && mcDate && <MilestoneLine date={mcDate} start={timelineStart || project.startDate} totalDays={totalDays} label="MC" color="#bd4c2b" onMove={date => { expandTimeline([date]); patch({ milestones: { ...project.milestones, mc: withMilestoneShopDate(project.milestones.mc, project.shops.map(item => item.id), shop.id, date) } }); }} />}
                            {rfsuReady && rfsuDate && <MilestoneLine date={rfsuDate} start={timelineStart || project.startDate} totalDays={totalDays} label="RFSU" color="#52756d" onMove={date => { expandTimeline([date, shiftDate(date, REGIME_RAMP_UP_DAYS)]); patch({ milestones: { ...project.milestones, rfsu: withMilestoneShopDate(project.milestones.rfsu, project.shops.map(item => item.id), shop.id, date) } }); }} />}
                          </div>
                        </div>
                        {phases.length === 0 && <div className="border-t border-dashed border-[#ece8df] py-1 pl-[200px] text-[9px] text-[#a3a195]">Для площадки нет назначенных этапов</div>}
                        {rolesExpanded && (plannedRoles.length ? plannedRoles.map(role => {
                          const rolePlan = getRoleTrainingPlan(project, shop.id, role.id, shopReadyDate);
                          const recruitmentStartDate = getRecruitmentStartDate(
                            rolePlan.contractDate,
                            project.settings.recruitmentLeadValue,
                            project.settings.recruitmentLeadUnit,
                          );
                          const onboardingStartDate = getOnboardingStartDate(
                            rolePlan.startDate,
                            project.settings.onboardingDuration ?? 0,
                            project.settings.onboardingUnit ?? 'days',
                            project.settings.dayType,
                          );
                          const left = rolePlan.startDate ? position(rolePlan.startDate) : 0;
                          const barWidth = rolePlan.startDate && rolePlan.endDate ? width(rolePlan.startDate, rolePlan.endDate) : 0;
                          const onboardingLeft = onboardingStartDate ? position(onboardingStartDate) : 0;
                          const onboardingWidth = onboardingStartDate && rolePlan.startDate ? width(onboardingStartDate, rolePlan.startDate) : 0;
                          return <div key={role.id} className="flex min-h-[52px] border-t border-[#ece8df] bg-[#fdfcf8]">
                            <div className="sticky left-0 z-[5] flex w-[184px] shrink-0 flex-col justify-center bg-[#fdfcf8] pl-10 pr-3">
                              <span className="truncate text-[9px] font-semibold text-[#4f5b58]" title={`${role.name} · ${shop.name}`}>{role.name}</span>
                              <span className="text-[8px] text-[#85877e]">{rolePlan.totalDays} дн. обучения</span>
                            </div>
                            <div className="timeline-grid relative h-[52px] min-w-0 flex-1">
                              <TodayLine start={timelineStart || project.startDate} totalDays={totalDays} />
                              {rolePlan.hasTrainingBar && onboardingStartDate && rolePlan.startDate && <Tooltip.Root delayDuration={220}>
                                <Tooltip.Trigger asChild>
                                  <button
                                    type="button"
                                    aria-label={`Онбординг роли ${role.name}: ${onboardingDurationDays} дней`}
                                    title={`Онбординг: ${fmt(onboardingStartDate)} — ${fmt(rolePlan.startDate)}`}
                                    className="absolute top-[19px] z-[3] flex h-[16px] min-w-0 items-center overflow-hidden rounded-l-[4px] bg-[#bd9560] px-1 text-left text-[8px] font-bold text-white shadow-sm outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#293640]"
                                    style={{ left: `${onboardingLeft}%`, width: `${onboardingWidth}%` }}
                                  >
                                    <span className="truncate">Онбординг · {onboardingDurationDays} дн.</span>
                                  </button>
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                  <Tooltip.Content side="top" align="start" sideOffset={6} collisionPadding={12} className="z-[100] max-w-[88vw] rounded-lg border border-[#d9d4ca] bg-[#fbfaf5] p-3 text-[#293640] shadow-xl">
                                    <h4 className="text-[11px] font-extrabold">Онбординг: {role.name}</h4>
                                    <p className="mt-1 text-[9px] text-[#777b76]">Получение СИЗов, ознакомление с рабочим местом и коллективом.</p>
                                    <p className="mt-1 text-[9px] font-semibold">{project.settings.onboardingDuration ?? 0} {project.settings.onboardingUnit === 'weeks' ? 'нед.' : 'дн.'} · {onboardingDurationDays} дн. · {fmt(onboardingStartDate)} — {fmt(rolePlan.startDate)}</p>
                                    <Tooltip.Arrow className="fill-[#fbfaf5]" />
                                  </Tooltip.Content>
                                </Tooltip.Portal>
                              </Tooltip.Root>}
                              {recruitmentStartDate && <MilestoneLine date={recruitmentStartDate} start={timelineStart || project.startDate} totalDays={totalDays} label="Начало рекрутинга" color="#b77a3e" roleSpecific labelPlacement="top-[16px]" />}
                              {rolePlan.contractDate && <MilestoneLine date={rolePlan.contractDate} start={timelineStart || project.startDate} totalDays={totalDays} label="На контракт" color="#8060a8" roleSpecific />}
                              {rolePlan.readyDate && <MilestoneLine date={rolePlan.readyDate} start={timelineStart || project.startDate} totalDays={totalDays} label="Готов" color="#315f59" roleSpecific />}
                              {rolePlan.hasTrainingBar && rolePlan.startDate && rolePlan.endDate && <Tooltip.Root delayDuration={220}>
                                <Tooltip.Trigger asChild>
                                  <button type="button" aria-label={`Обучение роли ${role.name}: ${rolePlan.totalDays} дней`} className={`absolute top-[19px] z-[3] flex h-[16px] min-w-0 items-center overflow-hidden ${onboardingStartDate ? 'rounded-r-[4px]' : 'rounded-[4px]'} bg-[#557d6e] px-2 text-left text-[9px] font-bold text-white shadow-sm outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#293640]`} style={{ left: `${left}%`, width: `${barWidth}%` }}>
                                    <span className="truncate">{rolePlan.totalDays} дн. обучения</span>
                                  </button>
                                </Tooltip.Trigger>
                                <Tooltip.Portal>
                                  <Tooltip.Content side="top" align="start" sideOffset={6} collisionPadding={12} className="z-[100] w-[320px] max-w-[88vw] rounded-lg border border-[#d9d4ca] bg-[#fbfaf5] p-3 text-[#293640] shadow-xl">
                                    <h4 className="mb-2 text-[11px] font-extrabold">Обучения: {role.name}</h4>
                                    <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
                                      {rolePlan.schedule.map(item => <li key={item.event.id} className="border-t border-[#e9e5dc] pt-2 first:border-0 first:pt-0">
                                        <div className="flex items-start justify-between gap-2"><span className="text-[10px] font-bold">{item.event.title}</span><span className="shrink-0 text-[9px] text-[#777b76]">{statusNames[item.event.status]}</span></div>
                                        <p className="mt-0.5 text-[9px] text-[#777b76]">{categoryNames[item.event.category]} · {item.event.duration} {item.event.unit === 'days' ? 'дн.' : item.event.unit === 'weeks' ? 'нед.' : 'мес.'} · {item.durationDays} дн. · {fmt(item.startDate)} — {fmt(item.endDate)}{item.event.costUsd !== undefined ? ` · ${formatUsd(item.event.costUsd)}` : ''}</p>
                                      </li>)}
                                    </ul>
                                    <Tooltip.Arrow className="fill-[#fbfaf5]" />
                                  </Tooltip.Content>
                                </Tooltip.Portal>
                              </Tooltip.Root>}
                            </div>
                          </div>;
                        }) : <div className="flex min-h-[38px] items-center border-t border-[#ece8df] pl-[200px] text-[9px] text-[#99978c]">В плане нет активных ролей для этого цеха.</div>)}
                      </div>;
                    })}
                    <div className="border-t border-[#e7e2d8] bg-[#faf8f2]">
                      <div className="flex min-h-10 border-b border-[#ece8df]">
                        <div className="sticky left-0 z-[5] flex w-[184px] shrink-0 items-center gap-2 bg-[#faf8f2] px-4"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#e8e6f0] text-[#696182]"><Users size={13} /></span><span className="text-[10px] font-bold">Подготовка кадров</span></div>
                        <div className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-[9px] text-[#726b82]">
                          <span>{project.training.length} мероприятий</span><span>·</span><span>{plannedTrainingDays} {project.settings.dayType === 'working' ? 'рабочих' : 'календарных'} дней</span>
                          <span className="hidden sm:inline">· Длительности учитываются {project.settings.calculationMode === 'sequential' ? 'последовательно' : 'параллельно'}</span>
                        </div>
                      </div>
                      {trainingTimeline.map(item => {
                        const event = item.event;
                        const eventShops = project.shops.filter(shop => event.shopIds.includes(shop.id));
                        const roleLabels = project.shops.flatMap(shop => shop.roles
                          .filter(role => event.roleIds.includes(role.id))
                          .map(role => `${shop.name}: ${role.name}`));
                        const left = position(item.startDate);
                        const barWidth = Math.max(.8, position(item.endDate) - left);
                        const unitName = event.unit === 'days' ? 'дн.' : event.unit === 'weeks' ? 'нед.' : 'мес.';
                        return <div key={event.id} className="flex min-h-[38px] border-b border-[#ece8df] last:border-0">
                          <div className="sticky left-0 z-[5] flex w-[184px] shrink-0 flex-col justify-center bg-[#faf8f2] px-4" title={`${event.title} · ${categoryNames[event.category]}`}>
                            <div className="flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: trainingColors[event.category] }} /><span className="truncate text-[9px] font-semibold text-[#4f5656]">{event.title}</span></div>
                            <span className="ml-3.5 truncate text-[8px] text-[#8b897f]">{categoryNames[event.category]}</span>
                          </div>
                          <div className="timeline-grid relative h-[38px] min-w-0 flex-1">
                            <TodayLine start={timelineStart || project.startDate} totalDays={totalDays} />
                            <Tooltip.Root delayDuration={220}>
                              <Tooltip.Trigger asChild>
                                <button type="button" aria-label={`Обучение ${event.title}, ${event.duration} ${unitName}`} className="training-bar absolute top-[10px] z-[3] flex h-[18px] min-w-0 items-center overflow-hidden rounded-[4px] px-1.5 text-left text-[9px] font-bold text-white shadow-sm outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[#293640]" style={{ left: `${left}%`, width: `${barWidth}%`, backgroundColor: trainingColors[event.category] }}>
                                  <span className="truncate">{event.title}</span>
                                </button>
                              </Tooltip.Trigger>
                              <Tooltip.Portal>
                                <Tooltip.Content side="top" align="start" sideOffset={6} collisionPadding={12} className="z-[100] w-[320px] max-w-[88vw] rounded-lg border border-[#d9d4ca] bg-[#fbfaf5] p-3 text-[#293640] shadow-xl">
                                  <h3 className="mb-2 text-xs font-extrabold">{event.title}</h3>
                                  <dl className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[10px] leading-relaxed">
                                    <dt className="text-[#81847c]">Категория</dt><dd className="font-semibold">{categoryNames[event.category]}</dd>
                                    <dt className="text-[#81847c]">Длительность</dt><dd>{event.duration} {unitName} · {item.durationDays} {project.settings.dayType === 'working' ? 'рабочих' : 'календарных'} дней</dd>
                                    {event.costUsd !== undefined && <><dt className="text-[#81847c]">Стоимость</dt><dd>{formatUsd(event.costUsd)}</dd></>}
                                    <dt className="text-[#81847c]">Период</dt><dd>{fmt(item.startDate)} — {fmt(item.endDate)}</dd>
                                    <dt className="text-[#81847c]">Статус</dt><dd>{statusNames[event.status]}</dd>
                                    <dt className="text-[#81847c]">Площадки</dt><dd>{eventShops.map(shop => shop.name).join(', ') || 'Не указаны'}</dd>
                                    <dt className="text-[#81847c]">Роли</dt><dd>{event.roleIds.length ? roleLabels.join('; ') || 'Указанные роли не найдены' : 'Все роли выбранных площадок'}</dd>
                                  </dl>
                                  {event.note && <p className="mt-2 whitespace-pre-wrap border-t border-[#e9e5dc] pt-2 text-[10px] leading-relaxed"><span className="font-bold">Примечание: </span>{event.note}</p>}
                                  {item.approximate && <p className="mt-2 border-t border-[#e9e5dc] pt-2 text-[9px] text-[#9a6830]">Положение предварительное: дата готовности и дата контракта не заданы, поэтому план отсчитан от начала проекта.</p>}
                                  <Tooltip.Arrow className="fill-[#fbfaf5]" />
                                </Tooltip.Content>
                              </Tooltip.Portal>
                            </Tooltip.Root>
                          </div>
                        </div>;
                      })}
                      {trainingTimeline.length === 0 && <div className="flex min-h-[38px] items-center pl-[200px] text-[9px] text-[#99978c]">Добавьте обучение с длительностью больше нуля, чтобы увидеть его на шкале.</div>}
                    </div>
                    {hiringResearchMilestones.length > 0 && <div className="pointer-events-none absolute bottom-0 left-[184px] right-0 top-8 z-[6]">
                      {hiringResearchMilestones.map((item, index) => <MilestoneLine
                        key={item.id}
                        date={item.date}
                        start={timelineStart || project.startDate}
                        totalDays={totalDays}
                        label={item.label}
                        color={item.color}
                        labelPlacement={index === 0 ? 'top-0.5' : index === 1 ? 'top-[16px]' : 'top-[28px]'}
                      />)}
                    </div>}
                  </div>
                </div>}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e5e1d7] px-4 py-3 md:px-5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[9px] text-[#737a77]">
                    <Legend swatch={phaseColors.construction} label="Стройка" /><Legend swatch={phaseColors.precommissioning} label="ПредПНР" /><Legend swatch={phaseColors.commissioning} label="ПНР" /><Legend swatch={phaseColors.operation} label="Эксплуатация" /><Legend swatch="#bd9560" label="Онбординг" /><Legend diamond="#bd4c2b" label="MC / RFSU" /><Legend dot="#315f59" label="Готовность персонала" />
                    {trainingCategories.map(category => <Legend key={category} swatch={trainingColors[category]} label={categoryNames[category]} />)}
                  </div>
                  <button onClick={() => setModal('settings')} className="inline-flex items-center gap-1 text-[10px] font-bold text-[#6c7570] hover:text-[#bd4c2b]"><SlidersHorizontal size={12} />Настроить расчёт</button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
                <section className="panel rounded-xl">
                  <div className="flex items-center justify-between border-b border-[#e5e1d7] px-4 py-3"><div><h3 className="text-xs font-extrabold">Подготовка персонала</h3><p className="mt-0.5 text-[10px] text-[#85877e]">Суммарно: {plannedTrainingDays} {project.settings.dayType === 'working' ? 'рабочих' : 'календарных'} дней · {project.settings.calculationMode === 'sequential' ? 'последовательный режим' : 'параллельный режим'}</p></div><button onClick={() => { setEditingTraining(null); setModal('training'); }} className="btn-quiet flex h-7 items-center gap-1 rounded px-2 text-[10px] font-bold text-[#bd4c2b]"><Plus size={12} />Добавить обучение</button></div>
                  {project.training.length === 0 && <div className="px-4 py-5 text-[11px] text-[#878980]">Добавьте мероприятия: их длительность будет учтена при расчёте даты контракта.</div>}
                   <div aria-label="Список обучений" tabIndex={0} className="max-h-[55vh] overflow-y-auto overscroll-contain divide-y divide-[#eee9df] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#bd4c2b]">
                    {trainingCategories.map(category => {
                      const events = project.training.filter(event => event.category === category).sort((a, b) => a.sortOrder - b.sortOrder);
                      const categoryDays = events.reduce((sum, event) => sum + trainingDays(event, project.settings.dayType), 0);
                      return <details key={category} open className="group/training">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-[#faf8f2] px-4 py-2.5 text-[10px] font-bold text-[#596461]">
                          <span className="flex items-center gap-2"><ChevronDown size={12} className="transition-transform group-open/training:rotate-180" />{categoryNames[category]} <span className="font-normal text-[#8a8b82]">{events.length}</span></span>
                          <span className="mono text-[9px] text-[#777b76]">{categoryDays} дн.</span>
                        </summary>
                        {events.length > 0 ? events.map((event, eventIndex) => <div key={event.id} className="flex items-center gap-2 border-t border-[#eee9df] px-4 py-2.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${event.status === 'completed' ? 'bg-[#587c70]' : event.status === 'in_progress' ? 'bg-[#c58b3a]' : 'bg-[#8b7ba3]'}`} />
                          <button onClick={() => { setEditingTraining(event); setModal('training'); }} className="min-w-0 flex-1 text-left"><div className="truncate text-[11px] font-bold">{event.title}</div><div className="mt-0.5 text-[9px] text-[#82847b]">{event.duration} {event.unit === 'days' ? 'дн.' : event.unit === 'weeks' ? 'нед.' : 'мес.'} · {trainingDays(event, project.settings.dayType)} дн. · {event.shopIds.length === project.shops.length ? 'все площадки' : `${event.shopIds.length} площадки`}{event.startDate && <> · начало {fmt(event.startDate)}</>}{event.costUsd !== undefined && <> · {formatUsd(event.costUsd)}</>}</div></button>
                          <span className="hidden rounded-full bg-[#efede5] px-2 py-1 text-[9px] font-semibold text-[#707772] sm:inline-flex">{statusNames[event.status]}</span>
                          <IconButton label="Переместить выше" onClick={() => moveTraining(event.id, -1)}><ArrowLeft size={12} className="-rotate-90" /></IconButton>
                          <IconButton label="Переместить ниже" onClick={() => moveTraining(event.id, 1)}><ArrowRight size={12} className="rotate-90" /></IconButton>
                          <IconButton label="Копировать обучение" onClick={() => duplicateTraining(event)}><Copy size={12} /></IconButton>
                          <IconButton label="Изменить обучение" onClick={() => { setEditingTraining(event); setModal('training'); }}><Pencil size={12} /></IconButton>
                        </div>) : <p className="px-8 py-3 text-[10px] text-[#99998f]">В разделе пока нет мероприятий.</p>}
                      </details>;
                    })}
                  </div>
                  {project.training.length > 0 && <div className="flex items-center justify-between border-t border-[#e5e1d7] bg-[#f7f5ee] px-4 py-2.5 text-[10px] font-extrabold"><span>Общая длительность</span><span className="mono">{plannedTrainingDays} дн.</span></div>}
                </section>
                <section className="panel rounded-xl">
                  <div className="border-b border-[#e5e1d7] px-4 py-3"><h3 className="text-xs font-extrabold">Контрольные даты</h3><p className="mt-0.5 text-[10px] text-[#85877e]">Основные точки готовности</p></div>
                  <div className="grid grid-cols-2 divide-x divide-[#eee9df]">
                    <MilestoneCard code="MC" title="Механическая готовность" date={commonMilestoneDate(project.milestones.mc, project.shops.map(shop => shop.id))} shopDates={project.milestones.mc.shopDates ?? {}} note={project.milestones.mc.note} shops={project.shops} shopIds={project.milestones.mc.shopIds} onChange={date => { const shopDates = Object.fromEntries(project.shops.map(shop => [shop.id, date])); expandTimeline([date]); patch({ milestones: { ...project.milestones, mc: { ...project.milestones.mc, date, shopDates } } }); }} onShopDateChange={(shopId, date) => { const mc = withMilestoneShopDate(project.milestones.mc, project.shops.map(shop => shop.id), shopId, date); expandTimeline([date]); patch({ milestones: { ...project.milestones, mc } }); }} onNoteChange={note => patch({ milestones: { ...project.milestones, mc: { ...project.milestones.mc, note } } })} onShopToggle={id => patch({ milestones: { ...project.milestones, mc: { ...project.milestones.mc, shopIds: project.milestones.mc.shopIds.includes(id) ? project.milestones.mc.shopIds.filter(value => value !== id) : [...project.milestones.mc.shopIds, id] } } })} />
                    <MilestoneCard code="RFSU" title="Готовность к пуску" date={commonMilestoneDate(project.milestones.rfsu, project.shops.map(shop => shop.id))} shopDates={project.milestones.rfsu.shopDates ?? {}} note={project.milestones.rfsu.note} shops={project.shops} shopIds={project.milestones.rfsu.shopIds} onChange={date => { const shopDates = Object.fromEntries(project.shops.map(shop => [shop.id, date])); expandTimeline([date, date ? shiftDate(date, REGIME_RAMP_UP_DAYS) : null]); patch({ milestones: { ...project.milestones, rfsu: { ...project.milestones.rfsu, date, shopDates } } }); }} onShopDateChange={(shopId, date) => { const rfsu = withMilestoneShopDate(project.milestones.rfsu, project.shops.map(shop => shop.id), shopId, date); expandTimeline([date, date ? shiftDate(date, REGIME_RAMP_UP_DAYS) : null]); patch({ milestones: { ...project.milestones, rfsu } }); }} onNoteChange={note => patch({ milestones: { ...project.milestones, rfsu: { ...project.milestones.rfsu, note } } })} onShopToggle={id => patch({ milestones: { ...project.milestones, rfsu: { ...project.milestones.rfsu, shopIds: project.milestones.rfsu.shopIds.includes(id) ? project.milestones.rfsu.shopIds.filter(value => value !== id) : [...project.milestones.rfsu.shopIds, id] } } })} />
                  </div>
                  <ReadyMilestoneCard
                    project={project}
                    onChange={settings => patch({ settings: { ...project.settings, ...settings } })}
                  />
                    <HiringResearchSettings
                      project={project}
                      hasScheduledTraining={trainingTimeline.length > 0}
                      onChange={settings => patch({ settings: { ...project.settings, ...settings } })}
                    />
                    <RecruitmentLeadSettings
                      project={project}
                      onChange={settings => patch({ settings: { ...project.settings, ...settings } })}
                    />
                    <OnboardingSettings
                      project={project}
                      onChange={settings => patch({ settings: { ...project.settings, ...settings } })}
                    />
                </section>
              </div>
            </>}
          </section>
        </div>
      </div>
    </main>

    {modal === 'startup' && <Modal title="Исходные условия проекта" subtitle="Ответьте на вопросы перед настройкой плана." onClose={() => setModal(null)}>
      <form onSubmit={event => { event.preventDefault(); if (startupAnswersComplete) setModal('new'); }} className="space-y-4 p-6">
        <Field label="Принято ли решение о форме работы персонала?">
          <select data-testid="select-startup-staffing-mode" value={newStaffingMode} onChange={event => setNewStaffingMode(event.target.value as WorkforceMode | '')} className="control h-10 w-full px-2 text-xs" required>
            <option value="">Выберите вариант</option>
            <option value="shift">Вахта</option>
            <option value="local">Местный персонал</option>
          </select>
        </Field>
        <YesNoField dataTestId="select-startup-salary-research" label="Проведено ли исследование медианной зарплаты в регионе?" value={newSalaryMedianResearchDone} onChange={setNewSalaryMedianResearchDone} />
        <YesNoField dataTestId="select-startup-labor-market-research" label="Проведено ли исследование рынка трудовых резервов?" value={newLaborMarketResearchDone} onChange={setNewLaborMarketResearchDone} />
        <YesNoField dataTestId="select-startup-hiring-strategy" label="Разработана ли стратегия найма?" value={newHiringStrategyDone} onChange={setNewHiringStrategyDone} />
        <Field label="Время на онбординг — получение СИЗов, ознакомление с рабочим местом, коллективом и т. д.">
          <div className="grid grid-cols-[minmax(0,1fr)_140px] gap-2">
            <input
              data-testid="input-startup-onboarding-duration"
              aria-label="Длительность онбординга"
              type="number"
              min="0"
              step="1"
              value={newOnboardingDuration}
              onChange={event => setNewOnboardingDuration(event.target.value)}
              placeholder="Укажите число"
              className="control h-10 w-full px-2 text-xs"
              required
            />
            <select
              data-testid="select-startup-onboarding-unit"
              aria-label="Единица длительности онбординга"
              value={newOnboardingUnit}
              onChange={event => setNewOnboardingUnit(event.target.value as OnboardingUnit | '')}
              className="control h-10 w-full px-2 text-xs"
              required
            >
              <option value="">Дни или недели</option>
              <option value="days">Дней</option>
              <option value="weeks">Недель</option>
            </select>
          </div>
        </Field>
        <p className="rounded-md bg-[#f2efe7] p-3 text-[10px] leading-relaxed text-[#6f777e]">Если исследование или стратегия ещё не готовы, соответствующая отсечка появится перед первым обучением.</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setModal(null)} className="control h-9 px-4 text-xs font-bold text-[#68716e]">Отмена</button>
          <button disabled={!startupAnswersComplete} className="btn-primary h-9 rounded-md px-4 text-xs font-bold disabled:opacity-60">Далее</button>
        </div>
      </form>
    </Modal>}
    {modal === 'new' && <Modal title="Новый проект" subtitle="Создайте основу плана для производственного объекта." onClose={() => setModal(null)} extraWide><form onSubmit={createProject} className="space-y-4 p-6">
      <Field label="Название проекта"><input autoFocus data-testid="input-new-project-title" value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Например, Модернизация установки № 2" className="control h-11 w-full px-3 text-sm" required /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Логин для входа в проект">
          <input data-testid="input-new-project-username" autoComplete="username" value={newUsername} onChange={event => setNewUsername(event.target.value)} minLength={3} maxLength={64} placeholder="Не менее 3 символов" className="control h-10 w-full px-3 text-xs" required />
        </Field>
        <Field label="Пароль для входа в проект">
          <input data-testid="input-new-project-password" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} maxLength={128} placeholder="Не менее 8 символов" className="control h-10 w-full px-3 text-xs" required />
        </Field>
      </div>
      <p className="-mt-2 text-[10px] text-[#85877e]">Пароль хранится в виде защищённого хеша. Запишите пару логин/пароль — восстановить пароль через приложение нельзя.</p>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        <section className="min-w-0 rounded-md border border-[#e2ddd2] p-3">
          <div className="flex items-center gap-2"><span className="mono rounded bg-[#e7eee8] px-1.5 py-0.5 text-[9px] font-bold text-[#4e7066]">100%</span><h3 className="text-[10px] font-extrabold">Готовность персонала</h3></div>
          <p className="mt-2 text-[9px] text-[#85877e]">Срок и охват правила готовности.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="За (месяцев)"><input data-testid="input-new-ready-months" aria-label="Месяцев до готовности 100%" type="number" min="0" step="1" value={newReadyMonths} onChange={e => setNewReadyMonths(e.target.value)} placeholder="Например, 3" className="control h-9 w-full px-2 text-xs" required /></Field>
            <Field label="До даты"><select data-testid="select-new-ready-milestone" aria-label="Контрольная дата готовности 100%" value={newReadyMilestone} onChange={e => setNewReadyMilestone(e.target.value as '' | 'mc' | 'rfsu')} className="control h-9 w-full px-2 text-xs" required><option value="">Выберите дату</option><option value="mc">MC</option><option value="rfsu">RFSU</option></select></Field>
          </div>
          <div className="mt-3">
            <p className="mb-1.5 text-[9px] font-bold text-[#777b78]">Правило применяется к:</p>
            <div className="grid grid-cols-2 gap-1.5">
              {defaultShopOptions.map(shop => <label key={shop.id} className={`flex min-w-0 cursor-pointer items-center gap-1.5 rounded border px-1.5 py-1.5 text-[9px] font-semibold ${newReadyShopIds.includes(shop.id) ? 'border-[#91aaa0] bg-[#e9eee8] text-[#416a5d]' : 'border-[#ded9ce] text-[#777b78]'}`}>
                <input data-testid={`checkbox-new-ready-shop-${shop.id}`} type="checkbox" checked={newReadyShopIds.includes(shop.id)} onChange={() => setNewReadyShopIds(current => current.includes(shop.id) ? current.filter(id => id !== shop.id) : [...current, shop.id])} className="accent-[#557d6e]" />
                {shop.name}
              </label>)}
            </div>
          </div>
        </section>
        <ShopMilestoneDateFields code="MC" title="Механическая готовность" allDate={newMcAllDate} dates={newMcDates} onAllDateChange={date => setAllNewMilestoneDates('mc', date)} onShopDateChange={(shopId, date) => setNewShopMilestoneDate('mc', shopId, date)} />
        <ShopMilestoneDateFields code="RFSU" title="Готовность к пуску" allDate={newRfsuAllDate} dates={newRfsuDates} onAllDateChange={date => setAllNewMilestoneDates('rfsu', date)} onShopDateChange={(shopId, date) => setNewShopMilestoneDate('rfsu', shopId, date)} />
      </div>
      <div className="rounded-md bg-[#f2efe7] p-3 text-[11px] leading-relaxed text-[#6f777e]">Для MC и RFSU задайте общую дату или отдельные даты по цехам. Будут созданы четыре площадки, базовые роли и стартовые этапы.</div>
      <div className="flex justify-end gap-2"><button type="button" onClick={() => setModal('startup')} className="control h-9 px-4 text-xs font-bold text-[#68716e]">Назад</button><button type="button" onClick={() => setModal(null)} className="control h-9 px-4 text-xs font-bold text-[#68716e]">Отмена</button><button disabled={createMutation.isPending || !startupAnswersComplete || !newReadyMonths || !newReadyMilestone || !newReadyShopIds.length || newUsername.trim().length < 3 || newPassword.length < 8} className="btn-primary h-9 rounded-md px-4 text-xs font-bold disabled:opacity-60">{createMutation.isPending ? 'Создание…' : 'Создать проект'}</button></div>
    </form></Modal>}
    {modal === 'access' && activeSummary && <Modal title={`Вход в проект «${activeSummary.title}»`} subtitle="Введите данные доступа, чтобы открыть план." onClose={() => setModal(null)}>
      <form onSubmit={event => void submitProjectAccess(event)} className="space-y-4 p-6">
        <Field label="Логин">
          <input data-testid="input-project-access-username" autoComplete="username" value={accessUsername} onChange={event => setAccessUsername(event.target.value)} minLength={3} maxLength={64} className="control h-10 w-full px-3 text-xs" required />
        </Field>
        <Field label="Пароль">
          <input data-testid="input-project-access-password" type="password" autoComplete="current-password" value={accessPassword} onChange={event => setAccessPassword(event.target.value)} minLength={8} maxLength={128} className="control h-10 w-full px-3 text-xs" required />
        </Field>
        <p className="rounded-md bg-[#f2efe7] p-3 text-[10px] leading-relaxed text-[#6f777e]">Если для этого проекта ещё не настроен доступ, первая введённая пара станет логином и паролем. Для защищённого проекта введите существующую пару.</p>
        {accessError && <p role="alert" className="text-xs font-semibold text-[#a84732]">{accessError}</p>}
        {!accessReady && !accessError && <p className="text-xs text-[#777b78]">Завершение предыдущего сеанса…</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setModal(null)} className="control h-9 px-4 text-xs font-bold text-[#68716e]">Отмена</button>
          <button disabled={!accessReady || accessSubmitting || accessUsername.trim().length < 3 || accessPassword.length < 8} className="btn-primary h-9 rounded-md px-4 text-xs font-bold disabled:opacity-60">{accessSubmitting ? 'Проверка…' : 'Войти'}</button>
        </div>
      </form>
    </Modal>}
    {modal === 'copy' && project && <Modal title="Копировать проект" subtitle="Для копии задайте отдельную пару логин/пароль." onClose={() => setModal(null)}>
      <form onSubmit={copyCurrent} className="space-y-4 p-6">
        <Field label="Логин для копии">
          <input data-testid="input-copy-project-username" autoComplete="username" value={copyUsername} onChange={event => setCopyUsername(event.target.value)} minLength={3} maxLength={64} className="control h-10 w-full px-3 text-xs" required />
        </Field>
        <Field label="Пароль для копии">
          <input data-testid="input-copy-project-password" type="password" autoComplete="new-password" value={copyPassword} onChange={event => setCopyPassword(event.target.value)} minLength={8} maxLength={128} className="control h-10 w-full px-3 text-xs" required />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setModal(null)} className="control h-9 px-4 text-xs font-bold text-[#68716e]">Отмена</button>
          <button disabled={copyMutation.isPending || copyUsername.trim().length < 3 || copyPassword.length < 8} className="btn-primary h-9 rounded-md px-4 text-xs font-bold disabled:opacity-60">{copyMutation.isPending ? 'Копирование…' : 'Создать копию'}</button>
        </div>
      </form>
    </Modal>}
    {modal === 'phase' && project && <PhaseModal phase={editingPhase} project={project} onClose={() => setModal(null)} onSave={phase => { const phases = editingPhase ? project.phases.map(p => p.id === phase.id ? phase : p) : [...project.phases, phase]; expandTimeline([phase.startDate, phase.endDate]); patch({ phases }); setModal(null); }} onDelete={() => { if (editingPhase && window.confirm('Удалить этот этап из плана?')) { patch({ phases: project.phases.filter(p => p.id !== editingPhase.id) }); setModal(null); } }} />}
    {modal === 'training' && project && <TrainingModal event={editingTraining} project={project} onClose={() => setModal(null)} onSave={event => { const training = editingTraining ? project.training.map(t => t.id === event.id ? event : t) : [...project.training, { ...event, sortOrder: project.training.length }]; patch({ training }); setModal(null); }} onDelete={() => { if (editingTraining && window.confirm('Удалить событие обучения?')) { patch({ training: project.training.filter(t => t.id !== editingTraining.id) }); setModal(null); } }} />}
    {modal === 'roles' && project && <RolesModal
      project={project}
      onClose={() => setModal(null)}
      onSave={shops => { patch({ shops, training: reconcileTrainingRoles(project.training, shops) }); setModal(null); }}
      onAddTraining={(event, shopId, role) => {
        const shops = project.shops.map(shop => shop.id !== shopId ? shop : {
          ...shop,
          roles: shop.roles.some(item => item.id === role.id)
            ? shop.roles.map(item => item.id === role.id ? role : item)
            : [...shop.roles, role],
        });
        patch({ shops, training: [...project.training, { ...event, sortOrder: project.training.length }] });
      }}
    />}
    {modal === 'settings' && project && <SettingsModal project={project} onClose={() => setModal(null)} onSave={changes => { const updated = { ...project, ...changes }; patch(changes); if (changes.startDate) setTimelineStart(changes.startDate); if (changes.endDate) setTimelineEnd(getProjectTimelineEnd(updated)); setModal(null); }} />}
    {toast && <div className="fixed bottom-5 right-5 z-[90] flex items-center gap-2 rounded-lg bg-[#293640] px-4 py-3 text-xs font-semibold text-white shadow-xl"><Check size={14} className="text-[#9bb7a7]" />{toast}</div>}
  </div>;
}

function SummaryTile({ label, value, unit, tone }: { label: string; value: number; unit: string; tone: string }) {
  const colors: Record<string, string> = { orange: 'bg-[#f2e4dc] text-[#a84b30]', teal: 'bg-[#e1eae4] text-[#4d7669]', sand: 'bg-[#f1ead9] text-[#927543]', blue: 'bg-[#e4e9ed] text-[#617584]' };
  return <div className="panel flex min-h-[68px] min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 py-2">
    <div className="min-w-0">
      <div title={label} className="truncate text-[8px] font-bold uppercase tracking-[.08em] text-[#85877e]">{label}</div>
      <div className="mt-1 flex min-w-0 items-baseline gap-1">
        <span className="mono text-[19px] font-medium leading-none">{value}</span>
        <span className="truncate text-[9px] text-[#898a82]">{unit}</span>
      </div>
    </div>
    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colors[tone]}`}><Activity size={14} /></div>
  </div>;
}
function TodayLine({ start, totalDays }: { start: string; totalDays: number }) {
  const now = iso(new Date());
  const x = (rawDateDiff(start, now) / totalDays) * 100;
  return x >= 0 && x <= 100 ? <div className="absolute bottom-0 top-0 z-[1] w-px bg-[#bd4c2b]/55" style={{ left: `${x}%` }}><span className="absolute -top-1 -left-[3px] h-1.5 w-1.5 rounded-full bg-[#bd4c2b]" /></div> : null;
}
function MilestoneLine({ date, start, totalDays, label, color, onMove, roleSpecific = false, labelPlacement }: { date: string; start: string; totalDays: number; label: string; color: string; onMove?: (date: string) => void; roleSpecific?: boolean; labelPlacement?: 'top-0.5' | 'bottom-0.5' | 'top-[16px]' | 'top-[28px]' }) {
  const pointerDown = useRef(false);
  const x = (rawDateDiff(start, date) / totalDays) * 100;
  if (x < 0 || x > 100) return null;
  const fullLabel = label === 'На контракт'
    ? roleSpecific ? 'Роль должна быть на контракте' : 'Персонал взят на контракт'
    : label === 'Готов 100%'
      ? 'Весь персонал обучен и готов'
      : label === 'Готов'
        ? 'Профессия обучена и готова'
        : label;
  const labelPosition = labelPlacement ?? (roleSpecific
    ? label === 'Готов' ? 'bottom-0.5' : 'top-0.5'
    : label === 'Готов 100%' ? 'top-[20px]' : 'top-0.5');
  const markerPosition = roleSpecific && label === 'Готов' ? 'bottom-[7px]' : 'top-[7px]';
  return <div className={`pointer-events-none absolute bottom-0 top-0 ${roleSpecific ? 'z-[4]' : 'z-[2]'}`} style={{ left: `${x}%` }} title={`${fullLabel} · ${fmt(date)}`}>
    <span className="absolute bottom-0 top-0 border-l border-dashed" style={{ borderColor: color }} />
    <button
      type="button"
      aria-label={`Переместить отсечку ${label}`}
      className={`pointer-events-auto absolute -left-[5px] ${markerPosition} h-[10px] w-[10px] touch-none rotate-45 border-2 bg-[#fbfaf5] cursor-ew-resize`}
      style={{ borderColor: color }}
      onPointerDown={event => {
        if (!onMove) return;
        event.preventDefault();
        event.stopPropagation();
        pointerDown.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!pointerDown.current || !onMove) return;
        event.stopPropagation();
        const grid = event.currentTarget.parentElement?.parentElement;
        if (!grid) return;
        const rect = grid.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        onMove(shiftDate(start, Math.round(totalDays * ratio)));
      }}
      onPointerUp={() => { pointerDown.current = false; }}
      onPointerCancel={() => { pointerDown.current = false; }}
    />
    <span className={`absolute left-1 whitespace-nowrap rounded px-1 py-0.5 text-[8px] font-extrabold text-white shadow-sm ${labelPosition}`} style={{ background: color }}>{label}</span>
    <span className="sr-only">{fullLabel}: {fmt(date)}</span>
  </div>;
}
function Legend({ swatch, diamond, dot, label }: { swatch?: string; diamond?: string; dot?: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5">{swatch && <i className="h-2 w-2 rounded-[2px]" style={{ background: swatch }} />}{diamond && <i className="h-2 w-2 rotate-45 border-[1.5px]" style={{ borderColor: diamond }} />}{dot && <i className="h-2 w-2 rounded-full" style={{ background: dot }} />}{label}</span>;
}
function MilestoneCard({ code, title, date, shopDates, note, shops, shopIds, onChange, onShopDateChange, onNoteChange, onShopToggle }: { code: string; title: string; date: string | null; shopDates: Record<string, string | null>; note: string | null; shops: Project['shops']; shopIds: string[]; onChange: (date: string | null) => void; onShopDateChange: (shopId: string, date: string | null) => void; onNoteChange: (note: string | null) => void; onShopToggle: (id: string) => void }) {
  return <div className="px-4 py-3">
    <div className="flex items-center gap-2"><span className={`mono rounded px-1.5 py-0.5 text-[9px] font-bold ${code === 'MC' ? 'bg-[#f5e6df] text-[#a8492e]' : 'bg-[#e7eee8] text-[#4e7066]'}`}>{code}</span><span className="text-[10px] font-bold">{title}</span></div>
    <div className="mt-2"><input data-testid={`input-milestone-${code.toLowerCase()}-all-date`} aria-label={`Общая дата ${code} для всех цехов`} type="date" value={date ?? ''} onChange={e => onChange(e.target.value || null)} className="control h-8 w-full px-2 text-[10px]" /></div>
    <details className="mt-2">
      <summary className="cursor-pointer text-[9px] font-semibold text-[#65716d]">Даты по каждому цеху</summary>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {shops.map(shop => {
          const shopDate = Object.prototype.hasOwnProperty.call(shopDates, shop.id) ? shopDates[shop.id] : date;
          return <Field key={shop.id} label={shop.name}><input data-testid={`input-milestone-${code.toLowerCase()}-${shop.id}`} aria-label={`${code} · ${shop.name}`} type="date" value={shopDate ?? ''} onChange={event => onShopDateChange(shop.id, event.target.value || null)} className="control h-8 w-full px-2 text-[10px]" /></Field>;
        })}
      </div>
    </details>
    <input aria-label={`Примечание ${code}`} value={note ?? ''} onChange={e => onNoteChange(e.target.value || null)} placeholder="Примечание" className="control mt-2 h-8 w-full px-2 text-[10px]" />
    <div className="mt-2 flex flex-wrap gap-1">{shops.map(shop => <button type="button" key={shop.id} onClick={() => onShopToggle(shop.id)} className={`rounded px-1.5 py-1 text-[8px] font-bold ${shopIds.includes(shop.id) ? 'bg-[#e9eee8] text-[#527166]' : 'bg-[#f0eee8] text-[#99998e]'}`}>{plantShort[shop.name] ?? shop.name}</button>)}</div>
  </div>;
}
function ReadyMilestoneCard({ project, onChange }: { project: Project; onChange: (settings: Partial<Project['settings']>) => void }) {
  const { settings, milestones, shops } = project;
  const [months, setMonths] = useState(settings.readyMonthsBefore === undefined ? '' : String(settings.readyMonthsBefore));
  useEffect(() => {
    setMonths(settings.readyMonthsBefore === undefined ? '' : String(settings.readyMonthsBefore));
  }, [settings.readyMonthsBefore]);
  const readyDate = getProjectReadyDate({ ...project, settings });
  const selectedShopIds = settings.readyShopIds ?? shops.map(shop => shop.id);
  const hasNewRule = settings.readyMonthsBefore !== undefined && !!settings.readyMilestone && selectedShopIds.length > 0;
  return <div className="border-t border-[#eee9df] px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h4 className="text-[10px] font-extrabold text-[#293640]">Готов 100%</h4>
        <p className="mt-0.5 text-[9px] text-[#85877e]">Дата общей готовности выбранных цехов</p>
      </div>
      <span data-testid="text-ready-100-date" className="text-[10px] font-bold text-[#315f59]">{fmt(readyDate)}</span>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[#777b78]">
      <span>Готов 100% за</span>
      <input
        data-testid="input-ready-100-months"
        aria-label="Месяцев до готовности 100%"
        type="number"
        min="0"
        step="1"
        required
        value={months}
        onChange={event => {
          const value = event.target.value;
          setMonths(value);
          if (!/^\d+$/.test(value)) return;
          onChange({ readyMonthsBefore: Number(value) });
        }}
        className="control h-8 w-20 px-2 text-center text-xs"
      />
      <span>месяцев до</span>
      <select
        data-testid="select-ready-100-milestone"
        aria-label="Контрольная дата готовности 100%"
        required
        value={settings.readyMilestone ?? ''}
        onChange={event => {
          const value = event.target.value;
          if (value === 'mc' || value === 'rfsu') onChange({ readyMilestone: value });
        }}
        className="control h-8 min-w-24 px-2 text-xs"
      >
        <option value="">Выберите дату</option>
        <option value="mc">MC</option>
        <option value="rfsu">RFSU</option>
      </select>
    </div>
    <div className="mt-3">
      <p className="mb-1.5 text-[9px] font-bold text-[#777b78]">Правило применяется к:</p>
      <div className="flex flex-wrap gap-1.5">
        {shops.map(shop => {
          const checked = selectedShopIds.includes(shop.id);
          return <label key={shop.id} className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1.5 text-[9px] font-semibold ${checked ? 'border-[#91aaa0] bg-[#e9eee8] text-[#416a5d]' : 'border-[#ded9ce] text-[#777b78]'}`}>
            <input
              data-testid={`checkbox-ready-shop-${shop.id}`}
              type="checkbox"
              checked={checked}
              disabled={checked && selectedShopIds.length === 1}
              onChange={() => onChange({ readyShopIds: checked ? selectedShopIds.filter(id => id !== shop.id) : [...selectedShopIds, shop.id] })}
              className="accent-[#557d6e]"
            />
            {shop.name}
          </label>;
        })}
      </div>
    </div>
    {!hasNewRule && <p className="mt-2 text-[9px] text-[#a7472e]">Заполните срок и выберите MC или RFSU, чтобы настроить новую формулу.</p>}
    {hasNewRule && !readyDate && <p className="mt-2 text-[9px] text-[#a7472e]">Для всех выбранных цехов должны быть заданы даты выбранной отсечки.</p>}
  </div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-[11px] font-bold text-[#56615f]">{label}</span>{children}</label>;
}
function YesNoField({ label, value, onChange, dataTestId }: { label: string; value: boolean | null; onChange: (value: boolean | null) => void; dataTestId: string }) {
  return <Field label={label}>
    <select
      data-testid={dataTestId}
      value={value === null ? '' : value ? 'yes' : 'no'}
      onChange={event => onChange(event.target.value === '' ? null : event.target.value === 'yes')}
      className="control h-10 w-full px-2 text-xs"
      required
    >
      <option value="">Выберите ответ</option>
      <option value="yes">Да</option>
      <option value="no">Нет</option>
    </select>
  </Field>;
}
function HiringResearchSettings({ project, hasScheduledTraining, onChange }: { project: Project; hasScheduledTraining: boolean; onChange: (settings: Partial<Project['settings']>) => void }) {
  return <div className="border-t border-[#eee9df] px-4 py-3">
    <div className="mb-2">
      <h4 className="text-[10px] font-extrabold text-[#293640]">Кадровые условия и подготовка к найму</h4>
      <p className="mt-0.5 text-[9px] text-[#85877e]">Для ответа «Нет» отсечка появится до первого обучения.</p>
    </div>
    <Field label="Форма работы персонала">
      <select
        data-testid="select-staffing-mode"
        value={project.settings.staffingMode ?? ''}
        onChange={event => {
          const value = event.target.value;
          onChange({ staffingMode: value === 'shift' || value === 'local' ? value : undefined });
        }}
        className="control h-8 w-full px-2 text-[10px]"
      >
        <option value="">Не указано</option>
        <option value="shift">Вахта</option>
        <option value="local">Местный персонал</option>
      </select>
    </Field>
    <div className="mt-3 grid grid-cols-[minmax(0,1fr)_74px_94px] gap-x-2 gap-y-1.5">
      <span className="text-[8px] font-bold text-[#85877e]">Подготовительный пункт</span>
      <span className="text-[8px] font-bold text-[#85877e]">Готово?</span>
      <span className="text-[8px] font-bold text-[#85877e]">Мес. до обучения</span>
      {hiringResearchConfig.map(item => {
        const answer = project.settings[item.statusKey];
        const months = project.settings[item.monthsKey] ?? item.defaultMonths;
        return <Fragment key={item.id}>
          <span title={item.label} className="self-center truncate text-[9px] font-semibold text-[#4f5b58]">{item.label}</span>
          <select
            data-testid={`select-${item.id}-done`}
            aria-label={`${item.label}: выполнено`}
            value={answer === undefined ? '' : answer ? 'yes' : 'no'}
            onChange={event => {
              const value = event.target.value;
              onChange({ [item.statusKey]: value === '' ? undefined : value === 'yes' } as Partial<Project['settings']>);
            }}
            className="control h-7 min-w-0 px-1 text-[9px]"
          >
            <option value="">—</option>
            <option value="yes">Да</option>
            <option value="no">Нет</option>
          </select>
          <LeadMonthsInput
            label={`Месяцев до обучения: ${item.label}`}
            value={months}
            onCommit={value => onChange({ [item.monthsKey]: value } as Partial<Project['settings']>)}
          />
        </Fragment>;
      })}
    </div>
    {!hasScheduledTraining && <p className="mt-2 text-[9px] text-[#85877e]">Отсечки появятся после добавления обучения с длительностью больше нуля.</p>}
  </div>;
}
function RecruitmentLeadSettings({ project, onChange }: { project: Project; onChange: (settings: Partial<Project['settings']>) => void }) {
  const value = project.settings.recruitmentLeadValue ?? recruitmentLeadDefaults.value;
  const unit = project.settings.recruitmentLeadUnit ?? recruitmentLeadDefaults.unit;
  return <div className="border-t border-[#eee9df] px-4 py-3">
    <div>
      <h4 className="text-[10px] font-extrabold text-[#293640]">Начало рекрутинга</h4>
      <p className="mt-0.5 text-[9px] text-[#85877e]">Отдельная отсечка для каждой профессии — до её даты «На контракт».</p>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#626e6a]">
      <span>Начинать за</span>
      <div className="w-20 shrink-0">
        <LeadMonthsInput
          label="Срок до начала рекрутинга"
          value={value}
          onCommit={nextValue => onChange({ recruitmentLeadValue: nextValue })}
        />
      </div>
      <select
        data-testid="select-recruitment-lead-unit"
        aria-label="Единица срока до начала рекрутинга"
        value={unit}
        onChange={event => {
          const nextUnit = event.target.value;
          if (nextUnit === 'days' || nextUnit === 'months') onChange({ recruitmentLeadUnit: nextUnit });
        }}
        className="control h-8 px-2 text-[10px]"
      >
        <option value="days">дней</option>
        <option value="months">месяцев</option>
      </select>
      <span>до отсечки «На контракт»</span>
    </div>
    <p className="mt-1 text-[8px] text-[#92938a]">Дни и месяцы календарные.</p>
  </div>;
}
function OnboardingSettings({ project, onChange }: { project: Project; onChange: (settings: Partial<Project['settings']>) => void }) {
  const duration = project.settings.onboardingDuration ?? 0;
  const unit = project.settings.onboardingUnit ?? 'days';
  return <div className="border-t border-[#eee9df] px-4 py-3">
    <div>
      <h4 className="text-[10px] font-extrabold text-[#293640]">Онбординг перед первым обучением</h4>
      <p className="mt-0.5 text-[9px] text-[#85877e]">Период добавляется один раз перед обучением каждой профессии.</p>
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#626e6a]">
      <span>Длительность</span>
      <div className="w-20 shrink-0">
        <LeadMonthsInput
          label="Длительность онбординга"
          value={duration}
          onCommit={nextDuration => onChange({ onboardingDuration: nextDuration })}
        />
      </div>
      <select
        data-testid="select-onboarding-unit"
        aria-label="Единица длительности онбординга"
        value={unit}
        onChange={event => {
          const nextUnit = event.target.value;
          if (nextUnit === 'days' || nextUnit === 'weeks') onChange({ onboardingUnit: nextUnit });
        }}
        className="control h-8 px-2 text-[10px]"
      >
        <option value="days">дней</option>
        <option value="weeks">недель</option>
      </select>
    </div>
  </div>;
}
function LeadMonthsInput({ label, value, onCommit }: { label: string; value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const months = Number(draft);
    if (!draft.trim() || !Number.isInteger(months) || months < 0) {
      setDraft(String(value));
      return;
    }
    if (months !== value) onCommit(months);
  };
  return <input
    type="number"
    min="0"
    step="1"
    aria-label={label}
    value={draft}
    onChange={event => setDraft(event.target.value)}
    onBlur={commit}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    className="control h-7 w-full min-w-0 px-1 text-center text-[9px]"
  />;
}
function ShopMilestoneDateFields({ code, title, allDate, dates, onAllDateChange, onShopDateChange }: { code: 'MC' | 'RFSU'; title: string; allDate: string; dates: Record<string, string | null>; onAllDateChange: (date: string) => void; onShopDateChange: (shopId: string, date: string) => void }) {
  return <section className="rounded-md border border-[#e2ddd2] p-3">
    <div className="flex items-center gap-2"><span className={`mono rounded px-1.5 py-0.5 text-[9px] font-bold ${code === 'MC' ? 'bg-[#f5e6df] text-[#a8492e]' : 'bg-[#e7eee8] text-[#4e7066]'}`}>{code}</span><h3 className="text-[10px] font-extrabold">{title}</h3></div>
    <Field label={`Дата ${code} сразу для всех цехов`}><input data-testid={`input-new-${code.toLowerCase()}-all-date`} type="date" value={allDate} onChange={event => onAllDateChange(event.target.value)} className="control mt-2 h-9 w-full px-2 text-xs" /></Field>
    <p className="mt-1 text-[9px] text-[#85877e]">Общую дату можно заменить индивидуально:</p>
    <div className="mt-2 space-y-2">
      {defaultShopOptions.map(shop => <Field key={shop.id} label={shop.name}><input data-testid={`input-new-${code.toLowerCase()}-date-${shop.id}`} aria-label={`${code} · ${shop.name}`} type="date" value={dates[shop.id] ?? ''} onChange={event => onShopDateChange(shop.id, event.target.value)} className="control h-8 w-full px-2 text-[10px]" required /></Field>)}
    </div>
  </section>;
}
function PhaseModal({ phase, project, onClose, onSave, onDelete }: { phase: Phase | null; project: Project; onClose: () => void; onSave: (phase: Phase) => void; onDelete: () => void }) {
  const [name, setName] = useState(phase?.name ?? '');
  const [type, setType] = useState<Phase['type']>(phase?.type ?? 'construction');
  const [startDate, setStartDate] = useState(phase?.startDate ?? project.startDate);
  const [endDate, setEndDate] = useState(phase?.endDate ?? project.endDate);
  const [shopIds, setShopIds] = useState<string[]>(phase?.shopIds ?? project.shops.map(s => s.id));
  const [note, setNote] = useState(phase?.note ?? '');
  const submit = (e: FormEvent) => { e.preventDefault(); if (endDate < startDate) return; onSave({ id: phase?.id ?? uid(), name: name.trim(), type, startDate, endDate, shopIds: shopIds.length ? shopIds : project.shops.map(shop => shop.id), note: note || null }); };
  return <Modal title={phase ? 'Изменить этап' : 'Новый этап'} subtitle="Период, тип работ и площадки, на которые распространяется этап." onClose={onClose}>
    <form onSubmit={submit} className="space-y-4 p-6">
      <Field label="Название этапа"><input className="control h-10 w-full px-3 text-sm" value={name} onChange={e => setName(e.target.value)} placeholder="Например, монтаж основного оборудования" required /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="Тип этапа"><select className="control h-10 w-full px-2 text-xs" value={type} onChange={e => setType(e.target.value as Phase['type'])}>{Object.entries(phaseNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Площадка"><div className="flex h-10 items-center gap-1.5 overflow-x-auto">{project.shops.map(s => <button type="button" key={s.id} onClick={() => setShopIds(ids => ids.includes(s.id) ? ids.filter(id => id !== s.id) : [...ids, s.id])} className={`rounded-md border px-2 py-1.5 text-[10px] font-bold ${shopIds.includes(s.id) ? 'border-[#91aaa0] bg-[#e8eee8] text-[#416a5d]' : 'border-[#ded9ce] text-[#84877f]'}`}>{plantShort[s.name] ?? s.name}</button>)}</div></Field></div>
      <div className="grid grid-cols-2 gap-3"><Field label="Начало"><input className="control h-10 w-full px-2 text-xs" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required /></Field><Field label="Завершение"><input className="control h-10 w-full px-2 text-xs" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required /></Field></div>
      {endDate < startDate && <p className="flex items-center gap-1 text-[10px] font-semibold text-[#a7472e]"><AlertTriangle size={12} />Дата окончания раньше даты начала.</p>}
      <Field label="Примечание"><textarea className="control min-h-16 w-full resize-y px-3 py-2 text-xs" value={note} onChange={e => setNote(e.target.value)} placeholder="Условия, зависимости, ответственный…" /></Field>
      <div className="flex justify-between pt-1">{phase ? <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 text-xs font-bold text-[#a7472e]"><Trash2 size={13} />Удалить</button> : <span /> }<div className="flex gap-2"><button type="button" onClick={onClose} className="control h-9 px-3 text-xs font-bold">Отмена</button><button disabled={endDate < startDate} className="btn-primary h-9 rounded-md px-4 text-xs font-bold disabled:opacity-50">{phase ? 'Сохранить' : 'Добавить этап'}</button></div></div>
    </form>
  </Modal>;
}
function TrainingModal({ event, project, onClose, onSave, onDelete, presetScope }: { event: TrainingEvent | null; project: Project; onClose: () => void; onSave: (event: TrainingEvent) => void; onDelete: () => void; presetScope?: { shopIds: string[]; roleIds: string[] } }) {
  const [title, setTitle] = useState(event?.title ?? '');
  const [category, setCategory] = useState<TrainingEvent['category']>(event?.category ?? 'mandatory');
  const [duration, setDuration] = useState(event?.duration ?? 5);
  const [unit, setUnit] = useState<TrainingEvent['unit']>(event?.unit ?? 'days');
  const [startDate, setStartDate] = useState(event?.startDate ?? '');
  const [costUsd, setCostUsd] = useState(event?.costUsd === undefined ? '' : String(event.costUsd));
  const [status, setStatus] = useState<TrainingEvent['status']>(event?.status ?? 'planned');
  const [shopIds, setShopIds] = useState<string[]>(event?.shopIds ?? presetScope?.shopIds ?? project.shops.map(s => s.id));
  const [roleIds, setRoleIds] = useState<string[]>(event?.roleIds ?? presetScope?.roleIds ?? []);
  const [note, setNote] = useState(event?.note ?? '');
  const roles = project.shops.filter(s => shopIds.includes(s.id)).flatMap(s => s.roles.map(r => ({ ...r, shop: s.name })));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsedCost = costUsd.trim() === '' ? undefined : Number(costUsd);
    if (Number(duration) < 0 || !shopIds.length || (parsedCost !== undefined && (!Number.isFinite(parsedCost) || parsedCost < 0))) return;
     onSave({ id: event?.id ?? uid(), title: title.trim(), category, duration: Number(duration), unit, ...(startDate ? { startDate } : {}), ...(parsedCost === undefined ? {} : { costUsd: parsedCost }), shopIds, roleIds: roleIds.filter(id => roles.some(role => role.id === id)), note: note || null, status, sortOrder: event?.sortOrder ?? project.training.length });
  };
  return <Modal title={event ? 'Изменить обучение' : 'Обучающее событие'} subtitle="Состав программы, продолжительность и целевая аудитория." onClose={onClose} wide>
    <form onSubmit={submit} className="space-y-4 p-6">
      <div className="grid gap-3 md:grid-cols-[1fr_180px]"><Field label="Название"><input className="control h-10 w-full px-3 text-sm" value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, безопасная работа с оборудованием" required /></Field><Field label="Категория"><select className="control h-10 w-full px-2 text-xs" value={category} onChange={e => setCategory(e.target.value as TrainingEvent['category'])}>{Object.entries(categoryNames).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field></div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Field label="Длительность"><input className="control h-10 w-full px-3 text-sm" type="number" min="0" step="any" required value={duration} onChange={e => setDuration(Number(e.target.value))} /></Field><Field label="Единица"><select className="control h-10 w-full px-2 text-xs" value={unit} onChange={e => setUnit(e.target.value as TrainingEvent['unit'])}><option value="days">Дни</option><option value="weeks">Недели</option><option value="months">Месяцы</option></select></Field><Field label="Статус"><select className="control h-10 w-full px-2 text-xs" value={status} onChange={e => setStatus(e.target.value as TrainingEvent['status'])}>{Object.entries(statusNames).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field><Field label="Стоимость, USD (необязательно)"><input className="control h-10 w-full px-3 text-sm" type="number" min="0" step="0.01" value={costUsd} onChange={e => setCostUsd(e.target.value)} placeholder="Не указана" /></Field></div>
      <Field label="Начало обучения (необязательно)"><input data-testid="input-training-start-date" className="control h-10 w-full px-3 text-sm sm:max-w-[240px]" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /><p className="mt-1 text-[9px] text-[#85877e]">Если дата не задана, начало рассчитывается автоматически. Указанная дата задаёт начало этого события на таймлайне.</p></Field>
      <Field label="Площадки"><div className="flex flex-wrap gap-2">{project.shops.map(s => <button type="button" key={s.id} onClick={() => setShopIds(ids => ids.includes(s.id) ? ids.filter(id => id !== s.id) : [...ids, s.id])} className={`rounded-md border px-3 py-2 text-[10px] font-bold ${shopIds.includes(s.id) ? 'border-[#91aaa0] bg-[#e8eee8] text-[#416a5d]' : 'border-[#ded9ce] text-[#84877f]'}`}>{s.name}</button>)}</div></Field>
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span id="training-role-heading" className="text-[11px] font-bold text-[#56615f]">Роли участников</span>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" data-testid="button-select-all-training-roles" onClick={() => setRoleIds(roles.map(role => role.id))} disabled={!roles.length} className="text-[10px] font-bold text-[#ad482b] hover:underline disabled:cursor-not-allowed disabled:opacity-50">Выбрать все</button>
            <button type="button" data-testid="button-clear-training-roles" onClick={() => setRoleIds([])} disabled={!roles.length} className="text-[10px] font-semibold text-[#777b78] hover:underline disabled:cursor-not-allowed disabled:opacity-50">Снять выделение</button>
          </div>
        </div>
        <div role="group" aria-labelledby="training-role-heading" className="max-h-28 overflow-y-auto rounded-md border border-[#e4e0d6] p-2">
          {roles.length ? <div className="grid gap-1 sm:grid-cols-2">{roles.map(r => <label key={r.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-[10px] hover:bg-[#f2efe8]"><input type="checkbox" checked={roleIds.includes(r.id)} onChange={e => setRoleIds(ids => e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))} className="accent-[#bd4c2b]" />{r.name}<span className="ml-auto text-[#99998f]">{r.shop}</span></label>)}</div> : <span className="text-[10px] text-[#85877e]">Выберите площадку, чтобы выбрать роли.</span>}
        </div>
        <p className="mt-1 text-[9px] text-[#85877e]">Если роли не выбраны, обучение применяется ко всем ролям выбранных площадок.</p>
      </div>
      <Field label="Примечание"><textarea className="control min-h-14 w-full px-3 py-2 text-xs" value={note} onChange={e => setNote(e.target.value)} placeholder="Организация, подрядчик, условия…" /></Field>
      <div className="flex justify-between pt-1">{event ? <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 text-xs font-bold text-[#a7472e]"><Trash2 size={13} />Удалить</button> : <span /> }<div className="flex gap-2"><button type="button" onClick={onClose} className="control h-9 px-3 text-xs font-bold">Отмена</button><button className="btn-primary h-9 rounded-md px-4 text-xs font-bold">{event ? 'Сохранить событие' : 'Добавить событие'}</button></div></div>
    </form>
  </Modal>;
}
function RolesModal({ project, onClose, onSave, onAddTraining }: { project: Project; onClose: () => void; onSave: (shops: Project['shops']) => void; onAddTraining: (event: TrainingEvent, shopId: string, role: Role) => void }) {
  const [shops, setShops] = useState(() => project.shops.map(shop => ({
    ...shop,
    roles: shop.roles.map(role => ({ ...role, headcount: role.headcount ?? 1 })),
  })));
  const [trainingScope, setTrainingScope] = useState<{ shopId: string; roleId: string } | null>(null);
  const updateRole = (shopId: string, roleId: string, changes: Partial<Role>) => setShops(all => all.map(s => s.id === shopId ? { ...s, roles: s.roles.map(r => r.id === roleId ? { ...r, ...changes } : r) } : s));
  const addRole = (shopId: string) => setShops(all => all.map(s => s.id === shopId ? { ...s, roles: [...s.roles, { id: uid(), name: 'Новая роль', group: 'itr', visible: true, headcount: 1 }] } : s));
  const removeRole = (shopId: string, roleId: string) => {
    const nextShops = shops.map(shop => shop.id === shopId
      ? { ...shop, roles: shop.roles.filter(role => role.id !== roleId) }
      : shop);
    const nextTraining = reconcileTrainingRoles(project.training, nextShops);
    const removedTrainingCount = project.training.length - nextTraining.length;

    if (removedTrainingCount > 0 && !window.confirm(
      `Назначенных только удаляемой роли обучений: ${removedTrainingCount}. Удалить роль и эти обучения? Общие обучения и назначения другим ролям сохранятся.`,
    )) return;

    setShops(nextShops);
    setTrainingScope(current => current?.roleId === roleId ? null : current);
  };
  const saveTrainingForRole = (event: TrainingEvent) => {
    if (!trainingScope) return;
    const role = shops.find(shop => shop.id === trainingScope.shopId)?.roles.find(item => item.id === trainingScope.roleId);
    if (!role) return;
    onAddTraining(event, trainingScope.shopId, role);
    setTrainingScope(null);
  };

  return <>
    <Modal title="Роли площадок" subtitle="Наведите на строку роли, чтобы увидеть назначенные обучения." onClose={onClose} wide>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto p-5">
        {shops.map(shop => <section key={shop.id} className="rounded-lg border border-[#e5e1d7] bg-[#f8f6ef] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-extrabold">{shop.name}</h3>
            <button type="button" onClick={() => addRole(shop.id)} className="text-[10px] font-bold text-[#bd4c2b]"><Plus className="mr-1 inline" size={12} />Добавить роль</button>
          </div>
          {shop.roles.map(role => {
            const assignedTrainings = project.training
              .filter(event => event.shopIds.includes(shop.id) && (!event.roleIds.length || event.roleIds.includes(role.id)))
              .sort((a, b) => a.sortOrder - b.sortOrder);
            return <Tooltip.Root key={role.id} delayDuration={250}>
              <Tooltip.Trigger asChild>
                <div tabIndex={0} role="group" aria-label={`Роль ${role.name}`} className="mb-1 flex flex-wrap items-center gap-2 rounded-md px-1 py-1 outline-none hover:bg-[#f1eee6] focus-visible:ring-2 focus-visible:ring-[#bd4c2b]">
                  <input aria-label={`Название роли, ${role.name}`} value={role.name} onChange={e => updateRole(shop.id, role.id, { name: e.target.value })} className="control h-8 min-w-[150px] flex-1 px-2 text-[11px]" />
                  <select aria-label={`Группа роли, ${role.name}`} value={role.group} onChange={e => updateRole(shop.id, role.id, { group: e.target.value as Role['group'] })} className="control h-8 w-24 px-2 text-[10px]"><option value="itr">ИТР</option><option value="workers">Рабочие</option></select>
                  <label className="flex items-center gap-1 text-[9px] text-[#6e7672]">чел.<input aria-label={`Численность: ${role.name}`} type="number" min="0" step="1" value={role.headcount ?? 1} onChange={e => updateRole(shop.id, role.id, { headcount: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="control h-8 w-14 px-1.5 text-center text-[10px]" /></label>
                  <label className="flex items-center gap-1 text-[9px] text-[#6e7672]"><input type="checkbox" checked={role.visible} onChange={e => updateRole(shop.id, role.id, { visible: e.target.checked })} className="accent-[#bd4c2b]" />В плане</label>
                  <button type="button" onClick={() => setTrainingScope({ shopId: shop.id, roleId: role.id })} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#e2cfc5] px-2 text-[9px] font-bold text-[#a7472e] hover:bg-[#f7e9e2]">
                    <Plus size={12} />Добавить обучение
                  </button>
                  <IconButton label={`Удалить роль ${role.name}`} onClick={() => removeRole(shop.id, role.id)} danger><Trash2 size={12} /></IconButton>
                </div>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" align="start" sideOffset={8} collisionPadding={12} className="z-[100] w-[300px] max-w-[88vw] rounded-lg border border-[#d9d4ca] bg-[#fbfaf5] p-3 text-[#293640] shadow-xl">
                  <h4 className="mb-2 text-[11px] font-extrabold">Обучения для роли «{role.name}»</h4>
                  {assignedTrainings.length ? <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
                    {assignedTrainings.map(event => <li key={event.id} className="border-t border-[#e9e5dc] pt-2 first:border-0 first:pt-0">
                      <div className="flex items-start justify-between gap-2"><span className="text-[10px] font-bold">{event.title}</span><span className="shrink-0 text-[9px] text-[#777b76]">{statusNames[event.status]}</span></div>
                      <p className="mt-0.5 text-[9px] text-[#777b76]">{categoryNames[event.category]} · {event.duration} {event.unit === 'days' ? 'дн.' : event.unit === 'weeks' ? 'нед.' : 'мес.'} · {trainingDays(event, project.settings.dayType)} дн.{event.costUsd !== undefined ? ` · ${formatUsd(event.costUsd)}` : ''}</p>
                      {event.note && <p className="mt-1 whitespace-pre-wrap text-[9px] leading-relaxed text-[#6d7470]">{event.note}</p>}
                    </li>)}
                  </ul> : <p className="text-[10px] text-[#777b76]">Для этой роли пока не назначено обучение.</p>}
                  <Tooltip.Arrow className="fill-[#fbfaf5]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>;
          })}
        </section>)}
      </div>
      <div className="flex justify-end gap-2 border-t border-[#e5e1d7] px-5 py-4"><button type="button" onClick={onClose} className="control h-9 px-3 text-xs font-bold">Отмена</button><button type="button" onClick={() => onSave(shops)} className="btn-primary h-9 rounded-md px-4 text-xs font-bold">Сохранить роли</button></div>
    </Modal>
    {trainingScope && <TrainingModal
      event={null}
      project={{ ...project, shops }}
      presetScope={{ shopIds: [trainingScope.shopId], roleIds: [trainingScope.roleId] }}
      onClose={() => setTrainingScope(null)}
      onSave={saveTrainingForRole}
      onDelete={() => setTrainingScope(null)}
    />}
  </>;
}
function SettingsModal({ project, onClose, onSave }: { project: Project; onClose: () => void; onSave: (changes: Partial<Project>) => void }) {
  const [settings, setSettings] = useState(project.settings);
  const [startDate, setStartDate] = useState(project.startDate);
  const [endDate, setEndDate] = useState(project.endDate);
  const readyDate = getProjectReadyDate({ ...project, settings });
  const plannedDays = totalTrainingDays(project.training, settings.calculationMode, settings.dayType);
  const autoContractDate = readyDate
    ? (settings.dayType === 'working' ? shiftWorkingDays(readyDate, -plannedDays) : shiftDate(readyDate, -plannedDays))
    : null;
  const contractGap = settings.contractDate && autoContractDate
    ? rawDateDiff(autoContractDate, settings.contractDate)
    : 0;
  const invalidRange = endDate < startDate;
  return <Modal title="Настройки расчёта" subtitle="Правила календарного плана и критерии готовности персонала." onClose={onClose}>
    <div className="space-y-4 p-6">
      <div className="grid grid-cols-2 gap-3"><Field label="Начало проекта"><input type="date" className="control h-10 w-full px-2 text-xs" value={startDate} onChange={e => setStartDate(e.target.value)} /></Field><Field label="Окончание проекта"><input type="date" className="control h-10 w-full px-2 text-xs" value={endDate} onChange={e => setEndDate(e.target.value)} /></Field></div>
      {invalidRange && <p role="alert" className="text-[10px] font-semibold text-[#a7472e]">Дата окончания не может быть раньше даты начала.</p>}
      <Field label="Расчёт этапов"><select className="control h-10 w-full px-2 text-xs" value={settings.calculationMode} onChange={e => setSettings(s => ({ ...s, calculationMode: e.target.value as typeof s.calculationMode }))}><option value="parallel">Параллельно — независимые этапы могут идти одновременно</option><option value="sequential">Последовательно — этапы следуют друг за другом</option></select></Field>
      <div className="border-t border-[#e8e3d9] pt-4">
        <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[.12em] text-[#88897f]">Готовность персонала</div>
        <div className="rounded-md bg-[#f2efe7] p-3 text-[10px] leading-relaxed text-[#6f7773]">
          {settings.readyMonthsBefore !== undefined && settings.readyMilestone
            ? `Готов 100% за ${settings.readyMonthsBefore} мес. до ${settings.readyMilestone.toUpperCase()} для ${(settings.readyShopIds ?? project.shops.map(shop => shop.id)).length} цехов.`
            : 'Правило готовности настраивается в блоке «Контрольные даты».'}
          <p className="mt-1">Расчётная дата: <strong>{fmt(readyDate)}</strong>.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3"><Field label="Тип дней"><select className="control h-10 w-full px-2 text-xs" value={settings.dayType} onChange={e => setSettings(s => ({ ...s, dayType: e.target.value as typeof s.dayType }))}><option value="working">Рабочие дни</option><option value="calendar">Календарные дни</option></select></Field><Field label="Ручная дата контракта"><input type="date" className="control h-10 w-full px-2 text-xs" value={settings.contractDate ?? ''} onChange={e => setSettings(s => ({ ...s, contractDate: e.target.value || null }))} /></Field></div>
      <div className="rounded-md bg-[#f2efe7] p-3 text-[10px] leading-relaxed text-[#6f7773]">
        Автоматическая дата контракта: <strong>{fmt(autoContractDate)}</strong>. Учтено {plannedDays} дн. обучения; режим — {settings.calculationMode === 'sequential' ? 'последовательно' : 'параллельно'}.
        {settings.contractDate && contractGap > 0 && <p className="mt-1 font-bold text-[#a7472e]">Ручная дата позже расчётной на {Math.ceil(contractGap)} дн.</p>}
        {!settings.contractDate && <p className="mt-1">Оставьте ручную дату пустой, чтобы использовать автоматический расчёт.</p>}
        {settings.readyMilestone && settings.readyMonthsBefore !== undefined && !readyDate && <p className="mt-1 font-semibold text-[#a7472e]">Для всех выбранных цехов задайте индивидуальные даты отсечки {settings.readyMilestone.toUpperCase()}.</p>}
      </div>
      <div className="flex items-start gap-2 rounded-md bg-[#f5efe4] p-3 text-[10px] leading-relaxed text-[#77766c]"><CircleHelp size={14} className="mt-0.5 shrink-0 text-[#a77e44]" />Изменения в правилах расчёта применяются к отображению плана и сохраняются вместе с проектом.</div>
      <div className="flex justify-end gap-2 pt-1"><button onClick={onClose} className="control h-9 px-3 text-xs font-bold">Отмена</button><button disabled={invalidRange} onClick={() => onSave({ startDate, endDate, settings })} className="btn-primary h-9 rounded-md px-4 text-xs font-bold disabled:opacity-50">Применить</button></div>
    </div>
  </Modal>;
}

function App() {
  return <QueryClientProvider client={queryClient}><Tooltip.Provider delayDuration={250}><Planner /></Tooltip.Provider></QueryClientProvider>;
}

export default App;
