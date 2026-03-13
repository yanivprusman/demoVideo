import { NextRequest } from 'next/server';
import { broadcast } from '@/lib/broadcast';

export const dynamic = 'force-dynamic';

interface ClipProgress {
  step: number;
  description: string;
  timestamp: number;
}

function getProgressMap(): Map<number, ClipProgress> {
  const g = globalThis as unknown as { __demoVideoClipProgress?: Map<number, ClipProgress> };
  if (!g.__demoVideoClipProgress) g.__demoVideoClipProgress = new Map();
  return g.__demoVideoClipProgress;
}

export function getClipProgress(clipId: number): ClipProgress | undefined {
  return getProgressMap().get(clipId);
}

export function clearClipProgress(clipId: number) {
  getProgressMap().delete(clipId);
}

export async function POST(req: NextRequest) {
  try {
    const { clipId, step, description } = await req.json();

    if (typeof clipId !== 'number' || typeof step !== 'number') {
      return Response.json({ error: 'clipId and step must be numbers' }, { status: 400 });
    }

    const progress: ClipProgress = {
      step,
      description: description || `Step ${step}`,
      timestamp: Date.now(),
    };
    getProgressMap().set(clipId, progress);

    // Broadcast to SSE subscribers
    if (step === -1) {
      broadcast({ type: 'done', clipId });
    } else {
      broadcast({ type: 'step', clipId, step, description: progress.description });
    }

    return Response.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
