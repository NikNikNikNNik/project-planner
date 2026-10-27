// Do not infer delivery from a price benchmark, provider address or category.
export const deliveryModeNames = {
  online: 'Онлайн',
  atyrau: 'В г. Атырау',
  offsite: 'Выездное',
} as const;

export function trainingDeliveryLabel(event: { deliveryMode?: string }): string {
  return deliveryModeNames[event.deliveryMode as keyof typeof deliveryModeNames] ?? 'Формат не указан';
}
