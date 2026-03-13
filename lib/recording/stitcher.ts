import { execFileSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import path from 'path';

interface SegmentInfo {
  path: string;
  speedUp?: number;
  transition?: 'fade' | 'cut';
}

function hasAudioStream(filePath: string): boolean {
  try {
    const result = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'a',
      '-show_entries', 'stream=codec_type', '-of', 'csv=p=0',
      filePath,
    ], { timeout: 10000 });
    return result.toString().trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Speed up a single segment file in-place.
 */
function speedUpSegment(filePath: string, speed: number): string {
  if (speed <= 1) return filePath;

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const speedPath = path.join(dir, `${base}_speed${ext}`);

  const videoFilter = `setpts=PTS/${speed}`;
  const args = ['-y', '-i', filePath, '-filter:v', videoFilter, '-r', '30'];

  if (hasAudioStream(filePath)) {
    const atempoFilters: string[] = [];
    let remaining = speed;
    while (remaining > 2) {
      atempoFilters.push('atempo=2.0');
      remaining /= 2;
    }
    atempoFilters.push(`atempo=${remaining}`);
    args.push('-filter:a', atempoFilters.join(','));
  } else {
    args.push('-an');
  }

  args.push(speedPath);
  execFileSync('ffmpeg', args, { timeout: 600000 });

  return speedPath;
}

/**
 * Stitch multiple segments into a final clip.
 * Applies per-segment speedUp, then concatenates with crossfade or hard cut.
 */
export function stitchSegments(segments: SegmentInfo[], outputPath: string): string {
  if (segments.length === 0) throw new Error('No segments to stitch');
  if (segments.length === 1) {
    // Single segment — just speed up if needed and copy
    const result = speedUpSegment(segments[0].path, segments[0].speedUp || 1);
    if (result !== outputPath) {
      execFileSync('cp', [result, outputPath], { timeout: 30000 });
      if (result !== segments[0].path) unlinkSync(result);
    }
    return outputPath;
  }

  // Speed up segments that need it
  const processed: { path: string; isTemp: boolean; transition: 'fade' | 'cut' }[] = [];
  for (const seg of segments) {
    const speed = seg.speedUp || 1;
    const sped = speedUpSegment(seg.path, speed);
    processed.push({
      path: sped,
      isTemp: sped !== seg.path,
      transition: seg.transition || 'fade',
    });
  }

  // Use concat demux — reliable across all segment types
  const concatList = processed.map(p => `file '${p.path}'`).join('\n');
  const listFile = path.join(path.dirname(outputPath), '_concat_list.txt');
  writeFileSync(listFile, concatList);

  execFileSync('ffmpeg', [
    '-y', '-f', 'concat', '-safe', '0',
    '-i', listFile,
    '-c', 'copy',
    outputPath,
  ], { timeout: 600000 });

  unlinkSync(listFile);

  // Clean up temp sped-up files
  for (const p of processed) {
    if (p.isTemp && existsSync(p.path)) {
      try { unlinkSync(p.path); } catch { /* ignore */ }
    }
  }

  return outputPath;
}
