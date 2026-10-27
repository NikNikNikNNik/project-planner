import type { ProjectInput } from '@workspace/api-zod';

export function actualRecordErrors(input: ProjectInput): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const r of input.settings.actualRecords ?? []) {
    const date = new Date(`${r.date}T00:00:00Z`);
    if (!r.id || ids.has(r.id)) errors.push('Идентификаторы записей факта должны быть уникальны.');
    ids.add(r.id);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== r.date) errors.push('Некорректная дата фактической записи.');
    if (!r.shopId) errors.push('Для факта необходим цех.');
    if (r.kind === 'hire' || r.kind === 'training') {
      if (!r.roleId || !Number.isInteger(r.people) || (r.people ?? 0) < 1) errors.push('Для найма и обучения необходимы профессия и положительное целое число участников.');
    }
    if (r.kind === 'training' && (!r.eventId || !r.deliveryMode || !Number.isFinite(r.days) || (r.days ?? 0) <= 0)) errors.push('Для факта обучения необходимы событие, формат и пройденные дни.');
    if ((r.kind === 'payroll' || r.kind === 'training_cost') && (!Number.isFinite(r.amountKzt) || (r.amountKzt ?? -1) < 0)) errors.push('Для расхода необходима сумма в тенге.');
  }
  return errors;
}
