import { sendDaemon, sleep } from '../daemon';
import { existsSync, mkdirSync } from 'fs';

const SEGMENTS_BASE = '/opt/automateLinux/data/demoVideo/segments';

function segmentDir(clipId: number): string {
  return `${SEGMENTS_BASE}/clip${clipId}`;
}

function segmentPath(clipId: number, stepIndex: number): string {
  return `${segmentDir(clipId)}/segment_${String(stepIndex).padStart(2, '0')}.mp4`;
}

export async function startSegment(clipId: number, stepIndex: number): Promise<string> {
  const dir = segmentDir(clipId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const filePath = segmentPath(clipId, stepIndex);
  await sendDaemon('screenRecordStart', { fileName: filePath });
  // Brief warmup to let recording stabilize
  await sleep(500);
  return filePath;
}

export async function stopSegment(): Promise<void> {
  // Brief trailing frames before stopping
  await sleep(500);
  await sendDaemon('screenRecordStop');
  // Wait for ffmpeg merge to complete (~5-10s)
  await sleep(8000);
}

export function getSegmentPath(clipId: number, stepIndex: number): string {
  return segmentPath(clipId, stepIndex);
}

export function getSegmentDir(clipId: number): string {
  return segmentDir(clipId);
}
