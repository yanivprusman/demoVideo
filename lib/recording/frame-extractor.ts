import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * Extract the first and last frames of a video segment as JPEGs.
 * Returns paths to [firstFrame, lastFrame].
 */
export function extractBookendFrames(segmentPath: string): [string, string] {
  const dir = path.dirname(segmentPath);
  const base = path.basename(segmentPath, path.extname(segmentPath));
  const framesDir = path.join(dir, 'frames');
  if (!existsSync(framesDir)) {
    mkdirSync(framesDir, { recursive: true });
  }

  const firstFrame = path.join(framesDir, `${base}_first.jpg`);
  const lastFrame = path.join(framesDir, `${base}_last.jpg`);

  // Extract first frame
  execFileSync('ffmpeg', [
    '-y', '-i', segmentPath,
    '-vframes', '1',
    '-q:v', '2',
    firstFrame,
  ], { timeout: 30000 });

  // Extract last frame - seek to near end
  // First get duration
  const durationOut = execFileSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    segmentPath,
  ], { encoding: 'utf8', timeout: 10000 }).trim();

  const duration = parseFloat(durationOut);
  if (duration > 0.5) {
    execFileSync('ffmpeg', [
      '-y', '-sseof', '-0.5',
      '-i', segmentPath,
      '-vframes', '1',
      '-q:v', '2',
      lastFrame,
    ], { timeout: 30000 });
  } else {
    // Very short video — use first frame as last too
    execFileSync('cp', [firstFrame, lastFrame], { timeout: 5000 });
  }

  return [firstFrame, lastFrame];
}

/**
 * Extract frames at N fps from a segment.
 * Returns array of frame paths.
 */
export function extractFrames(segmentPath: string, fps: number = 1): string[] {
  const dir = path.dirname(segmentPath);
  const base = path.basename(segmentPath, path.extname(segmentPath));
  const framesDir = path.join(dir, 'frames');
  if (!existsSync(framesDir)) {
    mkdirSync(framesDir, { recursive: true });
  }

  const pattern = path.join(framesDir, `${base}_frame_%04d.jpg`);
  execFileSync('ffmpeg', [
    '-y', '-i', segmentPath,
    '-vf', `fps=${fps}`,
    '-q:v', '2',
    pattern,
  ], { timeout: 120000 });

  // Collect generated frames
  const { readdirSync } = require('fs') as typeof import('fs');
  const prefix = `${base}_frame_`;
  return readdirSync(framesDir)
    .filter((f: string) => f.startsWith(prefix) && f.endsWith('.jpg'))
    .sort()
    .map((f: string) => path.join(framesDir, f));
}
