import type { PhotoPose, ProgressPhoto } from '@/lib/progressPhotos';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface MonthGroup {
  /** YYYY-MM */
  key: string;
  label: string;
  /** Newest first. */
  photos: ProgressPhoto[];
}

/** "October 2026" for a YYYY-MM-DD or YYYY-MM key. */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTHS[Number(m) - 1] ?? ''} ${y}`.trim();
}

/** "12 Oct 2026" for a YYYY-MM-DD date, without any time-zone shift. */
export function shortDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${(MONTHS[Number(m) - 1] ?? '').slice(0, 3)} ${y}`;
}

/** Photos grouped by month, newest month first and newest photo first within it; `pose` narrows to one pose. */
export function groupByMonth(photos: readonly ProgressPhoto[], pose: PhotoPose | null = null): MonthGroup[] {
  const groups = new Map<string, ProgressPhoto[]>();
  for (const p of photos) {
    if (pose && p.pose !== pose) continue;
    const key = p.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => ({ key, label: monthLabel(key), photos: list.sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date))) }));
}
