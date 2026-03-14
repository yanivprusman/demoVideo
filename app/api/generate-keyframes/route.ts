import { NextRequest } from 'next/server';
import { getSegmentDir, getSegmentPath } from '@/lib/recording/segment-recorder';
import { generateKeyframes } from '@/lib/recording/zoom-generator';
import { existsSync, readdirSync, writeFileSync } from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const { clipId, stepIndex } = await req.json();

    if (typeof clipId !== 'number') {
      return Response.json({ error: 'clipId must be a number' }, { status: 400 });
    }

    const dir = getSegmentDir(clipId);
    if (!existsSync(dir)) {
      return Response.json({ error: `No segments directory for clip ${clipId}` }, { status: 404 });
    }

    // If stepIndex is specified, generate for one segment; otherwise all
    const indices: number[] = [];

    if (typeof stepIndex === 'number') {
      indices.push(stepIndex);
    } else {
      // Find all segment mouse logs
      const files = readdirSync(dir).filter(f => /^segment_\d+\.mp4\.mouselog\.jsonl$/.test(f));
      for (const f of files) {
        const match = f.match(/^segment_(\d+)\.mp4\.mouselog\.jsonl$/);
        if (match) indices.push(parseInt(match[1], 10));
      }
      indices.sort((a, b) => a - b);
    }

    if (indices.length === 0) {
      return Response.json({ error: 'No mouse log files found' }, { status: 404 });
    }

    const results: { stepIndex: number; keyframesPath: string; keyframeCount: number }[] = [];

    for (const idx of indices) {
      const segPath = getSegmentPath(clipId, idx);
      const mouseLogPath = segPath + '.mouselog.jsonl';

      if (!existsSync(mouseLogPath)) {
        continue;
      }

      const keyframes = generateKeyframes(mouseLogPath);
      const keyframesPath = segPath.replace(/\.mp4$/, '.keyframes.json');
      writeFileSync(keyframesPath, JSON.stringify(keyframes, null, 2));

      results.push({
        stepIndex: idx,
        keyframesPath,
        keyframeCount: keyframes.keyframes.length,
      });
    }

    return Response.json({ ok: true, generated: results });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
