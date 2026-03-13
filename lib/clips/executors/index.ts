import type { ClipExecutor } from './types';
import { clip1Executor } from './clip1';

const executors = new Map<number, ClipExecutor>();

function register(executor: ClipExecutor) {
  executors.set(executor.clipId, executor);
}

// Register all clip executors
register(clip1Executor);

export function getExecutor(clipId: number): ClipExecutor | undefined {
  return executors.get(clipId);
}

export function hasExecutor(clipId: number): boolean {
  return executors.has(clipId);
}
