import { NextRequest } from 'next/server';
import { getSegmentPath } from '@/lib/recording/segment-recorder';
import { existsSync, readFileSync, writeFileSync } from 'fs';

export async function GET(req: NextRequest) {
  try {
    const clipId = Number(req.nextUrl.searchParams.get('clipId'));
    const stepIndex = Number(req.nextUrl.searchParams.get('stepIndex'));

    if (isNaN(clipId) || isNaN(stepIndex)) {
      return Response.json({ error: 'clipId and stepIndex are required' }, { status: 400 });
    }

    const segPath = getSegmentPath(clipId, stepIndex);
    const keyframesPath = segPath.replace(/\.mp4$/, '.keyframes.json');

    if (!existsSync(keyframesPath)) {
      return Response.json({ error: 'No keyframes file found' }, { status: 404 });
    }

    const data = JSON.parse(readFileSync(keyframesPath, 'utf-8'));
    return Response.json({ ok: true, keyframes: data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { clipId, stepIndex, keyframes } = await req.json();

    if (typeof clipId !== 'number' || typeof stepIndex !== 'number') {
      return Response.json({ error: 'clipId and stepIndex must be numbers' }, { status: 400 });
    }

    if (!keyframes || typeof keyframes !== 'object') {
      return Response.json({ error: 'keyframes object is required' }, { status: 400 });
    }

    const segPath = getSegmentPath(clipId, stepIndex);
    const keyframesPath = segPath.replace(/\.mp4$/, '.keyframes.json');

    writeFileSync(keyframesPath, JSON.stringify(keyframes, null, 2));
    return Response.json({ ok: true, keyframesPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
