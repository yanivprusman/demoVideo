import { NextRequest } from 'next/server';
import { getClip } from '@/lib/clips';
import { getExecutor } from '@/lib/clips/executors';
import { startSegment, stopSegment, getSegmentPath } from '@/lib/recording/segment-recorder';
import { extractBookendFrames } from '@/lib/recording/frame-extractor';

export async function POST(req: NextRequest) {
  try {
    const { clipId, stepIndex } = await req.json();

    if (typeof clipId !== 'number' || typeof stepIndex !== 'number') {
      return Response.json({ error: 'clipId and stepIndex must be numbers' }, { status: 400 });
    }

    const clip = getClip(clipId);
    if (!clip) {
      return Response.json({ error: `Clip ${clipId} not found` }, { status: 404 });
    }

    const executor = getExecutor(clipId);
    if (!executor) {
      return Response.json({ error: `No executor registered for clip ${clipId}` }, { status: 404 });
    }

    if (stepIndex < 0 || stepIndex >= executor.steps.length) {
      return Response.json({
        error: `Step ${stepIndex} out of range (0-${executor.steps.length - 1})`,
      }, { status: 400 });
    }

    const step = executor.steps[stepIndex];

    // Start recording this segment
    const segmentFile = await startSegment(clipId, stepIndex);

    // Execute the step
    try {
      await step.execute();
    } catch (execErr: unknown) {
      // Stop recording even on failure
      try { await stopSegment(); } catch { /* ignore */ }
      const msg = execErr instanceof Error ? execErr.message : String(execErr);
      return Response.json({ error: `Step execution failed: ${msg}`, segment: segmentFile }, { status: 500 });
    }

    // Stop recording
    await stopSegment();

    // Extract bookend frames for verification
    let frames: { first: string; last: string } | null = null;
    try {
      const [first, last] = extractBookendFrames(segmentFile);
      frames = { first, last };
    } catch {
      // Frame extraction is optional — don't fail the step
    }

    return Response.json({
      ok: true,
      segment: segmentFile,
      frames,
      stepIndex,
      description: step.description,
      verify: step.verify || null,
      transition: step.transition || 'fade',
      speedUp: step.speedUp || 1,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
