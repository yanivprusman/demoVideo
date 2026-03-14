import { NextRequest } from 'next/server';
import { killClaude } from '@/lib/claude-launcher';
import { broadcast } from '@/lib/broadcast';
import { sendDaemon } from '@/lib/daemon';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { clipId } = await req.json();

  if (!clipId) {
    return Response.json({ error: 'clipId required' }, { status: 400 });
  }

  const killed = killClaude(clipId);

  // Stop screen recording if one is active (legacy mode)
  try { await sendDaemon('screenRecordStop'); } catch { /* ignore */ }

  broadcast({ type: 'error', clipId, message: 'Recording stopped by user' });

  return Response.json({ ok: true, killed });
}
