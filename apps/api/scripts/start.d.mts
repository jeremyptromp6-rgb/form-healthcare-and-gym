export interface StartCommand {
  cmd: string;
  args: string[];
}
export type StartPlan =
  | { action: "refuse"; message: string }
  | { action: "run"; backup: "litestream" | "off"; log: string; restore?: StartCommand; command: StartCommand };
export function startPlan(env: Record<string, string | undefined>, hasBinary: boolean): StartPlan;
