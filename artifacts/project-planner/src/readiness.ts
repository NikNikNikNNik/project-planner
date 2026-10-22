import type { Project } from '@workspace/api-client-react';

type ProjectMilestone = Project['milestones']['mc'];

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function shiftCalendarMonths(value: string, months: number) {
  const source = new Date(`${value.slice(0, 10)}T12:00:00`);
  const sourceDay = source.getDate();
  const target = new Date(source.getFullYear(), source.getMonth() + months, 1, 12);
  const lastTargetDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(sourceDay, lastTargetDay));
  return iso(target);
}

export function getMilestoneDateForShop(milestone: ProjectMilestone, shopId: string) {
  const dates = milestone.shopDates;
  if (dates && Object.prototype.hasOwnProperty.call(dates, shopId)) return dates[shopId] ?? null;
  return milestone.date;
}

export function isMilestoneApplicableToShop(milestone: ProjectMilestone, shopId: string) {
  return milestone.shopIds.length === 0 || milestone.shopIds.includes(shopId);
}

function shiftCalendarDays(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + days);
  return iso(date);
}

function shiftWorkingDays(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  let remaining = Math.abs(days);
  const direction = days < 0 ? -1 : 1;
  while (remaining > 0) {
    date.setDate(date.getDate() + direction);
    if (date.getDay() !== 0 && date.getDay() !== 6) remaining--;
  }
  return iso(date);
}

function legacyReadyDate(project: Project) {
  const { settings, milestones } = project;
  if (settings.readyMode === 'fixed') return settings.readyDate;
  if (!milestones.mc.date) return null;
  const unit = settings.readyOffsetUnit ?? 'days';
  const factor = unit === 'days' ? 1 : unit === 'weeks' ? (settings.dayType === 'working' ? 5 : 7) : (settings.dayType === 'working' ? 22 : 30);
  const days = Math.ceil(settings.daysBeforeMc * factor);
  return settings.dayType === 'working'
    ? shiftWorkingDays(milestones.mc.date, -days)
    : shiftCalendarDays(milestones.mc.date, -days);
}

export function getShopReadyDate(project: Project, shopId: string) {
  const { settings, milestones } = project;
  if (settings.readyShopIds && !settings.readyShopIds.includes(shopId)) return null;

  if (settings.readyMilestone && settings.readyMonthsBefore !== undefined) {
    const milestone = settings.readyMilestone === 'mc' ? milestones.mc : milestones.rfsu;
    if (!isMilestoneApplicableToShop(milestone, shopId)) return null;
    const anchorDate = getMilestoneDateForShop(milestone, shopId);
    return anchorDate ? shiftCalendarMonths(anchorDate, -settings.readyMonthsBefore) : null;
  }

  return legacyReadyDate(project);
}

export function getProjectReadyDate(project: Project) {
  const { settings } = project;
  const shopIds = settings.readyShopIds ?? project.shops.map(shop => shop.id);
  if (shopIds.length === 0) return null;
  const dates = shopIds.map(shopId => getShopReadyDate(project, shopId));
  if (dates.some(date => !date)) return null;
  return dates.reduce<string | null>((latest, date) => !latest || date! > latest ? date : latest, null);
}

export function commonMilestoneDate(milestone: ProjectMilestone, shopIds: string[]) {
  const dates = shopIds.map(shopId => getMilestoneDateForShop(milestone, shopId));
  if (dates.length === 0) return milestone.date;
  return dates.every(date => date === dates[0]) ? dates[0] : null;
}

export function withMilestoneShopDate(milestone: ProjectMilestone, shopIds: string[], shopId: string, date: string | null) {
  const shopDates = { ...milestone.shopDates, [shopId]: date };
  const dates = shopIds.map(id => Object.prototype.hasOwnProperty.call(shopDates, id) ? shopDates[id] ?? null : milestone.date);
  const commonDate = dates.length > 0 && dates.every(value => value === dates[0]) ? dates[0] : null;
  return { ...milestone, date: commonDate, shopDates };
}
