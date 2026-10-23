export type SaveRecoverySnapshot<T> = {
  version: 1;
  baseUpdatedAt: string;
  project: T;
};

export function serializeProjectSnapshot<T extends { updatedAt?: unknown }>(project: T): string {
  const { updatedAt: _updatedAt, ...savedFields } = project;
  return JSON.stringify(savedFields);
}

export function parseSaveRecoverySnapshot<T>(value: string): SaveRecoverySnapshot<T> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const snapshot = parsed as Partial<SaveRecoverySnapshot<T>>;
    if (
      snapshot.version !== 1 ||
      typeof snapshot.baseUpdatedAt !== "string" ||
      !snapshot.project ||
      typeof snapshot.project !== "object"
    ) {
      return null;
    }
    return snapshot as SaveRecoverySnapshot<T>;
  } catch {
    return null;
  }
}

export function shouldRestoreSaveRecovery<T extends { updatedAt?: unknown }>(
  snapshot: SaveRecoverySnapshot<T>,
  serverProject: T,
): boolean {
  return snapshot.baseUpdatedAt === serverProject.updatedAt &&
    serializeProjectSnapshot(snapshot.project) !== serializeProjectSnapshot(serverProject);
}

export function getSaveErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Неизвестная ошибка сохранения.";
  const message = error.message
    .replace(/^HTTP \d+(?: [^:]+)?:\s*/, "")
    .trim();
  return message.slice(0, 500) || "Сервер отклонил сохранение.";
}
