import type { Phase, Project } from '@workspace/api-client-react';
import { getMilestoneDateForShop, isMilestoneApplicableToShop } from './readiness.ts';

export const REGIME_RAMP_UP_DAYS = 90;

export type TimelinePhase = {
  id: string;
  name: string;
  type: Phase['type'];
  startDate: string;
  endDate: string;
  editablePhase: Phase | null;
};

function shiftCalendarDays(value: string, days: number) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const isPnrPhase = (phase: Phase) =>
  phase.name === 'ПНР' || phase.name === 'ПНР и комплексное опробование';

const isMcAnchoredConstructionPhase = (phase: Phase) =>
  ['Монтаж оборудования', 'Монтаж оборудования и ППНР', 'СМР и ППНР'].includes(phase.name);

export function getShopTimelinePhases(
  phases: Phase[],
  milestones: Project['milestones'],
  shopId: string,
): TimelinePhase[] {
  const applicablePhases = phases.filter(phase => phase.shopIds.includes(shopId));
  const storedPnr = applicablePhases.find(isPnrPhase);
  const mcDate = isMilestoneApplicableToShop(milestones.mc, shopId)
    ? getMilestoneDateForShop(milestones.mc, shopId)
    : null;
  const rfsuDate = isMilestoneApplicableToShop(milestones.rfsu, shopId)
    ? getMilestoneDateForShop(milestones.rfsu, shopId)
    : null;
  const timelinePhases: TimelinePhase[] = applicablePhases
    .filter(phase => !isPnrPhase(phase))
    .map(phase => {
      const anchoredToMc = isMcAnchoredConstructionPhase(phase);
      return {
        id: phase.id,
        name: anchoredToMc ? 'СМР и ППНР' : phase.name,
        type: phase.type,
        startDate: phase.startDate,
        endDate: anchoredToMc && mcDate ? mcDate : phase.endDate,
        editablePhase: anchoredToMc && mcDate ? null : phase,
      };
    });

  if (mcDate && rfsuDate) {
    timelinePhases.push({
      id: `derived-pnr-${shopId}`,
      name: 'ПНР',
      type: 'commissioning',
      startDate: mcDate,
      endDate: rfsuDate,
      editablePhase: null,
    });
  } else if (storedPnr) {
    timelinePhases.push({
      id: storedPnr.id,
      name: 'ПНР',
      type: storedPnr.type,
      startDate: storedPnr.startDate,
      endDate: storedPnr.endDate,
      editablePhase: storedPnr,
    });
  }

  if (rfsuDate) {
    timelinePhases.push({
      id: `derived-ramp-up-${shopId}`,
      name: 'Вывод на режим',
      type: 'commissioning',
      startDate: rfsuDate,
      endDate: shiftCalendarDays(rfsuDate, REGIME_RAMP_UP_DAYS),
      editablePhase: null,
    });
  }

  return timelinePhases.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export function getProjectTimelineEnd(project: Project) {
  const dates = [
    project.endDate,
    ...project.shops.flatMap(shop => {
      const rfsuDate = isMilestoneApplicableToShop(project.milestones.rfsu, shop.id)
        ? getMilestoneDateForShop(project.milestones.rfsu, shop.id)
        : null;
      return rfsuDate ? [shiftCalendarDays(rfsuDate, REGIME_RAMP_UP_DAYS)] : [];
    }),
  ];
  return dates.reduce((latest, date) => date > latest ? date : latest, project.endDate);
}
