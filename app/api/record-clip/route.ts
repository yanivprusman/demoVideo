import { NextRequest } from 'next/server';
import { getClip } from '@/lib/clips';
import { broadcast } from '@/lib/broadcast';
import { buildPrompt, buildSegmentPrompt } from '@/lib/prompt-builder';
import { launchClaude, isClaudeAlive } from '@/lib/claude-launcher';
import { getClipProgress, clearClipProgress } from '@/app/api/claude-step/route';
import { hasExecutor, getExecutor } from '@/lib/clips/executors';
import { sendDaemon, sleep } from '@/lib/daemon';
import { execFileSync } from 'child_process';

const DEMO_VIDEO_PORT = 3019;
const DEFAULT_SPEED = 6; // 6x speed-up by default

/** Speed up a video file using ffmpeg. Replaces the original file. */
function speedUpVideo(filePath: string, speed: number): void {
  if (speed <= 1) return;
  const tmpPath = filePath.replace(/(\.\w+)$/, `_raw$1`);
  // Rename original to _raw, then produce sped-up version at original path
  execFileSync('mv', [filePath, tmpPath], { timeout: 10000 });
  // setpts=PTS/N speeds up video by Nx, atempo handles audio (max 2x per filter, chain for higher)
  const videoFilter = `setpts=PTS/${speed}`;
  const atempoFilters: string[] = [];
  let remaining = speed;
  while (remaining > 2) {
    atempoFilters.push('atempo=2.0');
    remaining /= 2;
  }
  atempoFilters.push(`atempo=${remaining}`);
  const audioFilter = atempoFilters.join(',');

  execFileSync('ffmpeg', [
    '-i', tmpPath,
    '-filter:v', videoFilter,
    '-filter:a', audioFilter,
    '-y', filePath,
  ], { timeout: 600000 }); // 10 min timeout for encoding
  // Remove raw file after successful encode
  try { execFileSync('rm', [tmpPath], { timeout: 5000 }); } catch { /* keep raw if rm fails */ }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { clipId, mode: requestedMode } = body;
  const clip = getClip(clipId);

  if (!clip) {
    return Response.json({ error: `Clip ${clipId} not found` }, { status: 404 });
  }

  if (!clip.enabled) {
    return Response.json({ error: `Clip ${clipId} is not enabled yet` }, { status: 400 });
  }

  // Clip 20 is ffmpeg merge, not Claude-orchestrated
  if (clipId === 20) {
    return Response.json({ error: 'Clip 20 (Final Merge) is not Claude-orchestrated' }, { status: 400 });
  }

  const outputPath = clip.outputPath || `/opt/automateLinux/data/demoVideo/clip${clipId}.mp4`;

  // Determine recording mode: segment (new) or legacy (current)
  const useSegmentMode = requestedMode === 'segment' || (requestedMode !== 'legacy' && hasExecutor(clipId));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        broadcast({ ...data, clipId });
      };

      try {
        // Clear any previous progress for this clip
        clearClipProgress(clipId);

        if (useSegmentMode) {
          // === SEGMENT MODE ===
          // Claude orchestrates off-camera, executor records individual segments
          const prompt = buildSegmentPrompt(clip, DEMO_VIDEO_PORT);
          const executor = getExecutor(clipId);
          const segmentSteps = executor?.steps.length || clip.recordingSteps.length;
          send({ type: 'step', step: 0, description: 'Launching Claude (segment mode)...', mode: 'segment', segmentSteps });

          // No global recording — each step records its own segment
          const { scriptLogFile } = launchClaude(prompt, clipId);

          // Poll for completion (same as legacy)
          const timeoutMs = (clip as any).timeoutMs || 300000;
          const startTime = Date.now();
          let lastStep = -99;

          while (Date.now() - startTime < timeoutMs) {
            await sleep(2000);

            const progress = getClipProgress(clipId);
            if (progress && progress.step !== lastStep) {
              lastStep = progress.step;

              if (progress.step === -1) {
                send({ type: 'step', step: clip.recordingSteps.length, description: 'Claude finished — segments stitched' });
                break;
              }

              send({ type: 'step', step: progress.step, description: progress.description });
            }

            if (!isClaudeAlive(scriptLogFile)) {
              if (lastStep !== -1) {
                send({ type: 'step', step: clip.recordingSteps.length, description: 'Claude process ended' });
              }
              break;
            }
          }

          if (Date.now() - startTime >= timeoutMs && lastStep !== -1) {
            send({ type: 'step', step: clip.recordingSteps.length, description: 'Timeout reached' });
          }

          send({ type: 'done', filePath: outputPath });

        } else {
          // === LEGACY MODE ===
          // Global recording + Claude does everything on camera
          const prompt = buildPrompt(clip, DEMO_VIDEO_PORT);
          send({ type: 'step', step: 0, description: 'Starting screen recording...' });

          // Start screen recording
          await sendDaemon('screenRecordStart', { fileName: outputPath });
          await sleep(2000);

          send({ type: 'step', step: 0, description: 'Launching Claude...' });
          const { scriptLogFile } = launchClaude(prompt, clipId);

          // Poll for completion
          const timeoutMs = (clip as any).timeoutMs || 300000;
          const startTime = Date.now();
          let lastStep = -99;

          while (Date.now() - startTime < timeoutMs) {
            await sleep(2000);

            const progress = getClipProgress(clipId);
            if (progress && progress.step !== lastStep) {
              lastStep = progress.step;

              if (progress.step === -1) {
                send({ type: 'step', step: clip.recordingSteps.length, description: 'Claude finished — stopping recording' });
                break;
              }

              send({ type: 'step', step: progress.step, description: progress.description });
            }

            if (!isClaudeAlive(scriptLogFile)) {
              if (lastStep !== -1) {
                send({ type: 'step', step: clip.recordingSteps.length, description: 'Claude process ended — stopping recording' });
              }
              break;
            }
          }

          if (Date.now() - startTime >= timeoutMs && lastStep !== -1) {
            send({ type: 'step', step: clip.recordingSteps.length, description: 'Timeout reached — stopping recording' });
          }

          // Wait trailing frames and stop
          await sleep(2000);
          const result = await sendDaemon('screenRecordStop');
          const filePath = typeof result === 'object' && result?.fileName
            ? result.fileName
            : outputPath;

          // Speed up the recording
          const speed = clip.speedUp ?? DEFAULT_SPEED;
          if (speed > 1) {
            send({ type: 'step', step: clip.recordingSteps.length, description: `Speeding up ${speed}x with ffmpeg...` });
            try {
              speedUpVideo(filePath, speed);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              send({ type: 'step', step: clip.recordingSteps.length, description: `Speed-up failed (raw video kept): ${msg}` });
            }
          }

          send({ type: 'done', filePath });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        // Try to stop recording on error (only needed in legacy mode, but safe either way)
        try { await sendDaemon('screenRecordStop'); } catch { /* ignore */ }
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
