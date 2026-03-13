import { NextRequest } from 'next/server';
import { getClip } from '@/lib/clips';
import { getExecutor } from '@/lib/clips/executors';
import { getSegmentPath, getSegmentDir } from '@/lib/recording/segment-recorder';
import { stitchSegments } from '@/lib/recording/stitcher';
import { existsSync, readdirSync } from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const { clipId } = await req.json();

    if (typeof clipId !== 'number') {
      return Response.json({ error: 'clipId must be a number' }, { status: 400 });
    }

    const clip = getClip(clipId);
    if (!clip) {
      return Response.json({ error: `Clip ${clipId} not found` }, { status: 404 });
    }

    const executor = getExecutor(clipId);
    if (!executor) {
      return Response.json({ error: `No executor registered for clip ${clipId}` }, { status: 404 });
    }

    // Find all recorded segments for this clip
    const dir = getSegmentDir(clipId);
    if (!existsSync(dir)) {
      return Response.json({ error: `No segments directory found for clip ${clipId}` }, { status: 404 });
    }

    const segmentFiles = readdirSync(dir)
      .filter(f => f.startsWith('segment_') && f.endsWith('.mp4'))
      .sort()
      .map(f => path.join(dir, f));

    if (segmentFiles.length === 0) {
      return Response.json({ error: `No segment files found for clip ${clipId}` }, { status: 404 });
    }

    // Build segment info with per-step metadata
    const segments = segmentFiles.map((filePath, i) => {
      const step = executor.steps[i];
      return {
        path: filePath,
        speedUp: step?.speedUp || 1,
        transition: (step?.transition || 'fade') as 'fade' | 'cut',
      };
    });

    const outputPath = clip.outputPath || `/opt/automateLinux/data/demoVideo/clip${clipId}.mp4`;

    // Stitch segments
    const result = stitchSegments(segments, outputPath);

    return Response.json({
      ok: true,
      filePath: result,
      segmentCount: segmentFiles.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
