import { useEffect, useRef, useState } from 'react';
import type { GetReadyStep } from './status';

/** Each number of the countdown stays this long. */
export const COUNT_STEP_MS = 1000;
/** "Ready" stays this long before the screen goes back to normal. */
export const READY_HOLD_MS = 900;

const COUNTDOWN: readonly GetReadyStep[] = [3, 2, 1, 'ready'];
/** With "reduce motion" on there is nothing counting down: just a brief "ready". */
const READY_ONLY: readonly GetReadyStep[] = ['ready'];

/**
 * The short "get into position" countdown before counting starts: 3, 2, 1, then a brief "ready", run
 * once per camera visit, the first time the camera coach is `ready`. (A later restart after the app was
 * in the background does not repeat it.) Losing `ready` mid-way cancels it and it starts over; with
 * reduce motion on there are no numbers, only the brief ready state. `onDone` runs when it finishes.
 */
export function useGetReady(ready: boolean, reduceMotion: boolean, onDone: () => void): GetReadyStep | null {
  const [tick, setTick] = useState(0);
  const [finished, setFinished] = useState(false);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  const active = ready && !finished;
  const steps = reduceMotion ? READY_ONLY : COUNTDOWN;

  useEffect(() => {
    if (!active) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      timer = setTimeout(
        () => {
          i++;
          if (i < steps.length) {
            setTick(i);
            next();
          } else {
            setFinished(true);
            doneRef.current();
          }
        },
        steps[i] === 'ready' ? READY_HOLD_MS : COUNT_STEP_MS,
      );
    };
    next();
    return () => {
      if (timer) clearTimeout(timer);
      setTick(0);
    };
  }, [active, steps]);

  return active ? (steps[Math.min(tick, steps.length - 1)] ?? null) : null;
}
