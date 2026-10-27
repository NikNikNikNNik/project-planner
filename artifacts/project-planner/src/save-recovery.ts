export type SaveRecoverySnapshot<T> = {
  version: 1;
  baseUpdatedAt: string;
  project: T;
};

export function serializeProjectSnapshot<T extends { updatedAt?: unknown }>(project: T): string {
  const { updatedAt: _updatedAt, ...savedFields } = project;
  // The API parses objects in schema order, while edits append fields in UI order.
  // Compare values, not insertion order, or a successful PUT looks unsaved forever.
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]));
    }
    return value;
  };
  return JSON.stringify(normalize(savedFields));
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
