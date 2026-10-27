// Do not infer delivery from a price benchmark, provider address or category.
export const deliveryModeNames = {
  online: 'Онлайн',
  atyrau: 'В г. Атырау',
  offsite: 'Выездное',
} as const;

export function trainingDeliveryLabel(event: { deliveryMode?: string }): string {
  return deliveryModeNames[event.deliveryMode as keyof typeof deliveryModeNames] ?? 'Формат не указан';
}

const explicitRemoteEnglish = /\b(?:zoom|teams|e-learning)\b/i;
const explicitTheoryEnglish = /\btheory\b/i;
const digitalEnglish = /\b(?:ms\s*(?:excel|office|word|powerpoint)|excel|office|soft\s*skills)\b/i;
const practicalOrEquipment = /(?:стажиров|практическ|(?:^|[\s:—-])практика(?:$|[\s(])|ремонт|монтаж|налад|сервис\w* курс|обслуживан|диагностик|сварк|пусконалад|пуск и|опробован|полев\w* работ|на рабочем месте|на объекте|тренаж|применение.{0,35}оборудован|пиролиз.{0,30}практическ|полимеризац.{0,30}практическ|трансформатор.{0,40}(?:испытан|диагностик|ремонт|обслуживан)|электроустановк.{0,40}(?:ремонт|обслуживан|налад)|машин.{0,20}и механизм.{0,30}(?:обслуживан|ремонт)|привод.{0,20}(?:налад|диагностик|обслуживан)|технологическ\w* трубопровод.{0,40}(?:монтаж|ремонт|эксплуатац)|хроматограф.{0,30}практическ|газохроматограф.{0,30}измерен.{0,30}практическ|лабораторн\w* информационн\w* систем|метрологическ\w*.{0,30}(?:поверк|калибровк)|релейн\w* защит.{0,40}(?:аппарат|налад|диагностик)|частотно-регулируем\w* привод|блокировк\w*|кипа.{0,40}(?:настройк|диагностик|обслуживан))/i;
const localLabOrRegulatedTraining = /(?:охрана труда|промышленн\w* безопасност|сварк|хроматограф|газохроматограф|основ\w*.{0,30}хими|химии и физики|лаборатор|метрологическ|средств измерен|актуальн\w* практическ\w* вопрос|аппаратурное оформлен|процесс\w* массообмен)/i;

export function inferTrainingDelivery(event: { title: string; category: string; deliveryMode?: string }): {
  mode: keyof typeof deliveryModeNames;
  basis: string;
  wasAlreadySet: boolean;
} {
  if (event.deliveryMode && event.deliveryMode in deliveryModeNames) {
    return { mode: event.deliveryMode as keyof typeof deliveryModeNames, basis: 'Формат ранее был указан в карточке события.', wasAlreadySet: true };
  }
  const title = event.title.normalize('NFKC').replace(/[“”„«»"]/g, '');
  const lower = title.toLocaleLowerCase('ru');
  if (lower.includes('вебинар') || lower.includes('онлайн') || lower.includes('дистанцион') || explicitRemoteEnglish.test(title)) {
    return { mode: 'online', basis: 'Предварительная рекомендация: дистанционный формат следует из названия вебинара или онлайн-курса; график проведения нужно подтвердить.', wasAlreadySet: false };
  }
  const localProviderTopic = localLabOrRegulatedTraining.test(title) || lower.includes('актуальные практические вопросы')
    || lower.includes('в подразделении') || lower.includes('центробежные насосы')
    || lower.includes('центробежные компрессоры') || lower.includes('винтовые и центробежные компрессора')
    || lower.includes('проектирование и строительство котельных');
  if (event.category === 'internship' || (practicalOrEquipment.test(title) && !localProviderTopic)) {
    return { mode: 'offsite', basis: 'Предварительная рекомендация: стажировка или практическое занятие на специализированном оборудовании; выездной формат и место проведения нужно подтвердить.', wasAlreadySet: false };
  }
  if (/siemens|simatic|s7-400|centum vp|simocode|sinamics|bently nevada|sinopec|лицензиар/i.test(title)) {
    return { mode: 'offsite', basis: 'Предварительная рекомендация: специализированный курс производителя или лицензиара; выезд к учебному стенду/площадке выбран как вариант, но место проведения нужно подтвердить.', wasAlreadySet: false };
  }
  if (
    lower.includes('теоретическ') || lower.includes('теория') || lower.includes('лекционн') || explicitTheoryEnglish.test(title)
    || digitalEnglish.test(title)
    || ['компьютерн', 'инженерная графика', 'информационная система', 'программирование', 'личная эффективность',
      'деловая коммуникац', 'управление персоналом', 'data science', 'экономика и финансы',
      'руководитель подразделения', 'руководитель функции', 'стандарт работы руководителя',
      'методы управления', 'управление безопасностью', 'система управления', 'управлениe надежностью',
      'методологи', 'инструмент оптимизации процессов', 'техническому моделированию',
      'повышения качества планирования', 'повышения качества освоения', 'анализ и прогноз',
      'законодательство', 'документооборот', 'учёт', 'учет'].some(term => lower.includes(term))
  ) {
    return { mode: 'online', basis: 'Предварительная рекомендация: теоретическая, цифровая или управленческая программа допускает дистанционный формат; провайдера и формат нужно подтвердить.', wasAlreadySet: false };
  }
  return { mode: 'atyrau', basis: 'Предварительная рекомендация: очное обучение в г. Атырау выбрано как базовый формат для аудиторной программы; место проведения не подтверждено.', wasAlreadySet: false };
}
