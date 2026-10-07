/** Monday-first training week: which of this week's days have a workout, and where today falls. */
export function trainingWeek(workoutDates: string[], today: string): { trained: boolean[]; todayIndex: number } {
  const t = new Date(`${today}T12:00:00Z`);
  const todayIndex = (t.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(t);
  monday.setUTCDate(t.getUTCDate() - todayIndex);
  const keys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const done = new Set(workoutDates);
  return { trained: keys.map((k) => done.has(k)), todayIndex };
}
