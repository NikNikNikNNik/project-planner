export function getReadableTimelineLabelIndexes(
  pointCount: number,
  trackWidth: number,
  labelWidth: number,
  gap = 12,
): Set<number> {
  const count = Math.max(0, Math.floor(pointCount));
  if (count === 0) return new Set();
  if (count === 1) return new Set([0]);

  const width = Number.isFinite(trackWidth) && trackWidth > 0 ? trackWidth : 1;
  const labelCount = Math.min(count, Math.max(2, Math.floor(width / (labelWidth + gap))));
  return new Set(Array.from({ length: labelCount }, (_, index) =>
    Math.round(index * (count - 1) / (labelCount - 1))));
}
