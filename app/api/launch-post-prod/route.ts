import { NextRequest } from 'next/server';
import { launchPostProd, isPostProdAlive, killPostProd } from '@/lib/post-production/launcher';
import { getSegmentDir } from '@/lib/recording/segment-recorder';
import { existsSync, readdirSync } from 'fs';

const PORT = 3019;

export async function POST(req: NextRequest) {
  try {
    const { clipId, action } = await req.json();

    if (typeof clipId !== 'number') {
      return Response.json({ error: 'clipId must be a number' }, { status: 400 });
    }

    // Handle stop action
    if (action === 'stop') {
      const killed = killPostProd(clipId);
      return Response.json({ ok: true, killed });
    }

    // Check for segments
    const segDir = getSegmentDir(clipId);
    if (!existsSync(segDir)) {
      return Response.json({ error: `No segments directory for clip ${clipId}` }, { status: 404 });
    }
    const segments = readdirSync(segDir).filter(f => /^segment_\d+\.mp4$/.test(f));
    if (segments.length === 0) {
      return Response.json({ error: `No segment files found for clip ${clipId}` }, { status: 404 });
    }

    // Check if already running
    if (isPostProdAlive(clipId)) {
      return Response.json({
        ok: true,
        alreadyRunning: true,
        tmuxSession: `demoVideo-postprod-clip${clipId}`,
      });
    }

    // Launch
    const result = launchPostProd(clipId, PORT);

    return Response.json({
      ok: true,
      tmuxSession: result.tmuxSession,
      workDir: result.workDir,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const clipId = Number(req.nextUrl.searchParams.get('clipId'));
    if (!clipId || isNaN(clipId)) {
      return Response.json({ error: 'clipId query param required' }, { status: 400 });
    }

    return Response.json({
      alive: isPostProdAlive(clipId),
      tmuxSession: `demoVideo-postprod-clip${clipId}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
