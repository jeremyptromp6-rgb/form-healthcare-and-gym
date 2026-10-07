import { InlineMessage } from '@/components/ui';
import { VIA_LABEL } from '@/lib/eat';
import type { FoodLog } from '@/lib/types';

/** Where this entry's numbers came from — measured, converted, counted — and what it replaced. */
export function Provenance({ log }: { log: FoodLog }) {
  const lines: string[] = [];
  const m = log.measurement;
  if (log.amountMethod === 'measured') {
    lines.push(`MEASURED — ${m.via ? VIA_LABEL[m.via] : 'weighed'}${m.weightSource === 'scale' ? ', read from a connected scale' : m.weightSource === 'typed' ? ', weight entered by you' : ''}.`);
  } else if (m.via === 'density' && m.grams !== null) {
    lines.push(`About ${m.grams} g, converted from a household measure with the food’s typical density.`);
  }
  if (m.via === 'mass' && log.amountUnit === 'ml' && m.grams !== null) lines.push(`Weighed ${m.grams} g, converted to ${log.amount} ml with its density.`);
  if (log.basis) lines.push(`Calculated from ${log.basis.per100.kcal} kcal per 100 ${log.basis.unit ?? 'g'} as logged.`);
  if (log.replacedEstimate) {
    const r = log.replacedEstimate;
    lines.push(`Replaced a scan estimate: ${r.name}${r.amount !== null ? `, ${Math.round(r.amount)} ${r.amountUnit ?? 'g'}` : ''}, ≈ ${Math.round(r.kcal)} kcal.`);
  }
  if (lines.length === 0) return null;
  return <InlineMessage tone={log.amountMethod === 'measured' ? 'success' : 'info'}>{lines.join(' ')}</InlineMessage>;
}
