import type { Project, Role, Shop, TrainingEvent } from '@workspace/api-client-react';

export function isShopIncludedInCalculation(shop: Pick<Shop, 'includedInCalculations'>) {
  return shop.includedInCalculations !== false;
}

export function isRoleIncludedInCalculation(shop: Shop, role: Role) {
  return isShopIncludedInCalculation(shop) && role.visible !== false;
}

export function isTrainingEventIncludedForShop(shop: Shop, event: TrainingEvent) {
  return isShopIncludedInCalculation(shop)
    && event.shopIds.includes(shop.id)
    && shop.roles.some(role =>
      role.visible !== false && (!event.roleIds.length || event.roleIds.includes(role.id)),
    );
}

export function getTrainingEventsIncludedInCalculation(project: Project) {
  return project.training.filter(event => isTrainingEventIncludedInCalculation(project, event));
}

export function isTrainingEventIncludedInCalculation(project: Project, event: TrainingEvent) {
  return project.shops.some(shop => isTrainingEventIncludedForShop(shop, event));
}

export function getTrainingEventsIncludedForShop(project: Project, shopId: string) {
  const shop = project.shops.find(item => item.id === shopId);
  if (!shop) return [];
  return project.training.filter(event => isTrainingEventIncludedForShop(shop, event));
}
