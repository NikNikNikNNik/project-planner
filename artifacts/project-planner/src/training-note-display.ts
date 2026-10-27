/**
 * Source and historical date-shift annotations share the note field with planning details.
 * Filter them only for information popovers; never change the stored note.
 */
export function trainingNoteForDisplay(note: string | null | undefined): string {
  return (note ?? '')
    .replace(/источники?\s*:[^\S\r\n]*.*?(?:\.(?=\s|$)|(?=\r?$))/gimu, '')
    .replace(/Календарные\s+даты\s+сдвинуты\s+на\s+\+?10\s+лет[^\r\n]*?(?:\.(?=\s|$)|(?=\r?$))/gimu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
