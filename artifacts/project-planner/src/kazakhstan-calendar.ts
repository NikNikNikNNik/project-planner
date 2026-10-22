export type DayType = 'calendar' | 'working';

export type AdditionalNonWorkingDate = {
  date: string;
  name: string;
};

export type WorkCalendarSettings = {
  dayType: DayType;
  staffingMode?: 'shift' | 'local';
  additionalNonWorkingDates?: AdditionalNonWorkingDate[];
};

const NON_TRANSFERABLE_HOLIDAYS: Record<number, string[]> = {
  // Official calendars: Kazakhstan Government 2026 calendar and the Muslim
  // Board of Kazakhstan's approved 2027 religious calendar.
  // https://www.gov.kz/article/33969
  // https://www.muftyat.kz/kk/holiday/dini-kunder-kestesi/2026-10-16/48888-2027-zhyildyi-dni-knder-kestes-bektld/
  2026: ['2026-01-07', '2026-05-27'],
  2027: ['2027-01-07', '2027-05-16'],
};

const holidayCache = new Map<number, Set<string>>();

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + days);
  return iso(date);
}

function weekday(date: string) {
  return new Date(`${date}T12:00:00`).getDay();
}

function fixedKazakhstanHolidays(year: number) {
  const dates = [
    `${year}-01-01`, `${year}-01-02`,
    `${year}-03-08`,
    `${year}-03-21`, `${year}-03-22`, `${year}-03-23`,
    `${year}-05-01`, `${year}-05-07`, `${year}-05-09`,
    `${year}-07-06`,
    `${year}-10-25`,
    `${year}-12-16`,
  ];

  // The Constitution Day moved from August 30 to March 15 effective July 1, 2026.
  // https://adilet.zan.kz/rus/docs/Z2600000306
  if (year >= 2027) dates.push(`${year}-03-15`);

  return [...dates, ...(NON_TRANSFERABLE_HOLIDAYS[year] ?? [])].sort();
}

function statutoryNonWorkingDates(year: number) {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const fixedDates = fixedKazakhstanHolidays(year);
  const nonWorking = new Set(fixedDates);
  const transferable = fixedDates.filter(date => !(NON_TRANSFERABLE_HOLIDAYS[year] ?? []).includes(date));

  // Article 5 of Kazakhstan's Holidays Law moves a holiday that falls on
  // Saturday/Sunday to the following working day. Process in date order so
  // consecutive holidays receive consecutive substitute days.
  for (const holiday of transferable) {
    const day = weekday(holiday);
    if (day !== 0 && day !== 6) continue;

    let observed = shiftDate(holiday, 1);
    while (weekday(observed) === 0 || weekday(observed) === 6 || nonWorking.has(observed)) {
      observed = shiftDate(observed, 1);
    }
    nonWorking.add(observed);
  }

  holidayCache.set(year, nonWorking);
  return nonWorking;
}

export function getProjectDayType(settings: WorkCalendarSettings): DayType {
  if (settings.staffingMode === 'shift') return 'calendar';
  if (settings.staffingMode === 'local') return 'working';
  return settings.dayType;
}

export function isKazakhstanWorkday(
  value: string,
  additionalDates: AdditionalNonWorkingDate[] = [],
) {
  const date = value.slice(0, 10);
  const day = weekday(date);
  if (day === 0 || day === 6 || statutoryNonWorkingDates(Number(date.slice(0, 4))).has(date)) return false;
  return !additionalDates.some(item => item.date === date);
}

export function shiftKazakhstanWorkdays(
  value: string,
  days: number,
  additionalDates: AdditionalNonWorkingDate[] = [],
) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  let remaining = Math.abs(days);
  const direction = days < 0 ? -1 : 1;

  while (remaining > 0) {
    date.setDate(date.getDate() + direction);
    if (isKazakhstanWorkday(iso(date), additionalDates)) remaining--;
  }

  return iso(date);
}
