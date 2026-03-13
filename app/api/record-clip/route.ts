import { NextRequest } from 'next/server';
import { executeClip1 } from '@/lib/clips/clip1';
import { getClip } from '@/lib/clips';
import { verifyPreState } from '@/lib/clips/verifyPreState';
import { isFixable } from '@/lib/clips/fixPreState';

type ClipExecutor = (onStep: (step: number, desc: string) => void) => Promise<string>;

function getClipExecutor(clipId: number): ClipExecutor | null {
  switch (clipId) {
    case 1: return executeClip1;
    default: return null;
  }
}

export async function POST(req: NextRequest) {
  const { clipId } = await req.json();
  const clip = getClip(clipId);

  if (!clip) {
    return Response.json({ error: `Clip ${clipId} not found` }, { status: 404 });
  }

  if (!clip.enabled) {
    return Response.json({ error: `Clip ${clipId} is not enabled yet` }, { status: 400 });
  }

  const executor = getClipExecutor(clipId);
  if (!executor) {
    return Response.json({ error: `Clip ${clipId} has no executor implemented` }, { status: 501 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Verify pre-state conditions before recording
        const checks = await verifyPreState(clip.preState);
        const enrichedChecks = checks.map(c => ({
          ...c,
          fixable: c.status === 'fail' ? isFixable(c.condition, c.message) : false,
        }));
        send({ type: 'prestate', checks: enrichedChecks });

        const failures = checks.filter(c => c.status === 'fail');
        if (failures.length > 0) {
          const msg = failures.map(f => `${f.condition}: ${f.message}`).join('\n');
          send({ type: 'error', message: `Pre-state check failed:\n${msg}` });
          controller.close();
          return;
        }

        // All checks passed (or warnings only) — proceed with recording
        const filePath = await executor((step: number, description: string) => {
          send({ type: 'step', step, description });
        });
        send({ type: 'done', filePath });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: 'error', message });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
