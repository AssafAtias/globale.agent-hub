export interface RunEvent { seq: number; kind: string; label: string; detail?: string }

const MAX_PER_RUN = 200;
const MAX_RUNS = 50;
const store = new Map<string, RunEvent[]>();

export const RunEventStore = {
  append(runId: string, evt: RunEvent): void {
    let arr = store.get(runId);
    if (!arr) {
      if (store.size >= MAX_RUNS) {
        const oldest = store.keys().next().value as string | undefined;
        if (oldest !== undefined) store.delete(oldest);
      }
      arr = [];
      store.set(runId, arr);
    }
    arr.push(evt);
    if (arr.length > MAX_PER_RUN) arr.splice(0, arr.length - MAX_PER_RUN);
  },
  list(runId: string): RunEvent[] {
    return store.get(runId) ?? [];
  },
};
