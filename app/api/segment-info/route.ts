import { NextRequest } from 'next/server';
import { getSegmentDir } from '@/lib/recording/segment-recorder';
import { existsSync, readdirSync, readFileSync } from 'fs';

export async function GET(req: NextRequest) {
  try {
    const clipId = Number(req.nextUrl.searchParams.get('clipId'));
    if (!clipId || isNaN(clipId)) {
      return Response.json({ error: 'clipId query param required' }, { status: 400 });
    }

    const dir = getSegmentDir(clipId);
    if (!existsSync(dir)) {
      return Response.json({ segments: 0, mouseLogs: 0, keyframes: 0, segmentDetails: [] });
    }

    const files = readdirSync(dir);

    const segmentFiles = files.filter(f => /^segment_\d+\.mp4$/.test(f)).sort();
    const mouseLogFiles = new Set(
      files.filter(f => /^segment_\d+\.mp4\.mouselog\.jsonl$/.test(f))
        .map(f => f.match(/^segment_(\d+)/)![1])
    );
    const keyframeFiles = new Map<string, boolean>();
    for (const f of files) {
      const m = f.match(/^segment_(\d+)\.keyframes\.json$/);
      if (m) keyframeFiles.set(m[1], true);
    }

    // Count total keyframes by reading keyframe files
    let totalKeyframes = 0;
    const segmentDetails: { index: number; hasMouseLog: boolean; hasKeyframes: boolean; keyframeCount: number }[] = [];

    for (const seg of segmentFiles) {
      const m = seg.match(/^segment_(\d+)\.mp4$/);
      if (!m) continue;
      const idx = m[1];
      const indexNum = parseInt(idx, 10);
      const hasMouseLog = mouseLogFiles.has(idx);
      const hasKeyframes = keyframeFiles.has(idx);

      let keyframeCount = 0;
      if (hasKeyframes) {
        try {
          const kfPath = `${dir}/segment_${idx}.keyframes.json`;
          const data = JSON.parse(readFileSync(kfPath, 'utf-8'));
          keyframeCount = data.keyframes?.length || 0;
        } catch { /* ignore */ }
      }
      totalKeyframes += keyframeCount;

      segmentDetails.push({ index: indexNum, hasMouseLog, hasKeyframes, keyframeCount });
    }

    return Response.json({
      segments: segmentFiles.length,
      mouseLogs: mouseLogFiles.size,
      keyframes: totalKeyframes,
      segmentDetails,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
