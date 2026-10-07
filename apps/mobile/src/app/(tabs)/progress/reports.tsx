import { useState } from 'react';
import { ProUpsellFor } from '@/components/pro/ProUpsellFor';
import { WeeklyReportView } from '@/components/pro/ProFeatureViews';
import { ErrorState, Screen, Segmented, StateView } from '@/components/ui';
import { useWeeklyReports } from '@/lib/pro';
import { useRefetchOnFocus } from '@/lib/queries';

/** Weekly progress reports: generated for FORM Pro each finished week; reports already made stay yours on any plan. */
export default function WeeklyReportsScreen() {
  const q = useWeeklyReports();
  useRefetchOnFocus(q.refetch);
  const [selected, setSelected] = useState<string | null>(null);
  const reports = q.data?.reports ?? [];
  const shown = reports.find((r) => r.weekStart === selected) ?? reports[0] ?? null;
  const fmt = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return (
    <Screen title="Weekly report" subtitle="Your week, from your own records" refreshing={q.isRefetching} onRefresh={q.refetch}>
      {q.isPending ? <StateView kind="loading" /> : null}
      {q.isError && !q.data ? <ErrorState error={q.error} onRetry={q.refetch} /> : null}
      {q.data && !q.data.canGenerate ? <ProUpsellFor feature="WEEKLY_AI_REPORT" /> : null}
      {reports.length > 1 ? (
        <Segmented options={reports.slice(0, 4).map((r) => ({ value: r.weekStart, label: fmt(r.weekStart) }))} value={shown?.weekStart ?? reports[0]!.weekStart} onChange={setSelected} label="Week" />
      ) : null}
      {shown ? <WeeklyReportView entry={shown} /> : null}
      {q.data && q.data.canGenerate && reports.length === 0 ? <StateView kind="empty" title="Your first report is on its way" message="Reports cover a finished week, Monday to Sunday. Check back after your first full week." /> : null}
    </Screen>
  );
}
