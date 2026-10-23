import type { Project, ProjectInput } from '@workspace/api-client-react';

const BACKUP_FORMAT = 'project-planner-backup';
const BACKUP_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasDateRange(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function projectInputFromProject(project: Project): ProjectInput {
  return {
    title: project.title,
    startDate: project.startDate,
    endDate: project.endDate,
    shops: project.shops,
    phases: project.phases,
    milestones: project.milestones,
    training: project.training,
    settings: project.settings,
  };
}

export function serializeProjectBackup(project: Project): string {
  return JSON.stringify({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    project: projectInputFromProject(project),
  }, null, 2);
}

export function parseProjectBackup(content: string): ProjectInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('Файл не является корректным JSON.');
  }

  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || parsed.version !== BACKUP_VERSION) {
    throw new Error('Формат файла не распознан или не поддерживается.');
  }

  const project = parsed.project;
  if (
    !isRecord(project) ||
    typeof project.title !== 'string' ||
    !project.title.trim() ||
    !hasDateRange(project.startDate) ||
    !hasDateRange(project.endDate) ||
    !Array.isArray(project.shops) ||
    !Array.isArray(project.phases) ||
    !isRecord(project.milestones) ||
    !isRecord(project.milestones.mc) ||
    !isRecord(project.milestones.rfsu) ||
    !Array.isArray(project.training) ||
    !isRecord(project.settings)
  ) {
    throw new Error('В файле отсутствуют обязательные данные проекта или они повреждены.');
  }

  return project as unknown as ProjectInput;
}
