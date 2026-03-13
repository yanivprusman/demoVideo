import { NextRequest } from 'next/server';
import { getClip } from '@/lib/clips';
import { verifyPreState } from '@/lib/clips/verifyPreState';
import { fixFailedConditions, isFixable } from '@/lib/clips/fixPreState';

export async function POST(req: NextRequest) {
  const { clipId } = await req.json();
  const clip = getClip(clipId);

  if (!clip) {
    return Response.json({ error: `Clip ${clipId} not found` }, { status: 404 });
  }

  // Get current failures
  const checks = await verifyPreState(clip.preState);
  const failures = checks.filter(c => c.status === 'fail');

  if (failures.length === 0) {
    return Response.json({
      fixResults: [],
      recheck: checks.map(c => ({ ...c, fixable: false })),
      allPassed: true,
    });
  }

  // Run fixers
  const fixResults = await fixFailedConditions(failures);

  // Re-verify after fixes
  const recheck = await verifyPreState(clip.preState);
  const enriched = recheck.map(c => ({
    ...c,
    fixable: c.status === 'fail' ? isFixable(c.condition, c.message) : false,
  }));
  const allPassed = enriched.every(c => c.status !== 'fail');

  return Response.json({ fixResults, recheck: enriched, allPassed });
}
