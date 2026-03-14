import { execFileSync, execFile } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';
import { getSessionEnv } from '../session-env';
import { getSegmentDir } from '../recording/segment-recorder';

const POST_PROD_BASE = '/opt/automateLinux/data/demoVideo/post-prod';
// Use absolute path since __dirname is unreliable in Next.js bundled server code
const TEMPLATE_PATH = '/opt/dev/demoVideo/lib/post-production/CLAUDE.md';

interface PostProdResult {
  tmuxSession: string;
  workDir: string;
}

/**
 * Build segment info table for the CLAUDE.md template.
 */
function buildSegmentTable(segDir: string): string {
  if (!existsSync(segDir)) return 'No segments found.';

  const files = readdirSync(segDir);
  const segments = files.filter(f => /^segment_\d+\.mp4$/.test(f)).sort();

  if (segments.length === 0) return 'No segments found.';

  const rows: string[] = ['| Segment | Duration | Has Keyframes | Keyframe Count |', '|---------|----------|---------------|----------------|'];

  for (const seg of segments) {
    const idx = seg.match(/^segment_(\d+)\.mp4$/)![1];
    const segPath = path.join(segDir, seg);
    const kfPath = path.join(segDir, `segment_${idx}.keyframes.json`);

    // Get duration via ffprobe
    let duration = '?';
    try {
      duration = execFileSync('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', segPath,
      ], { timeout: 10000, encoding: 'utf-8' }).trim();
      const secs = parseFloat(duration);
      if (!isNaN(secs)) duration = `${secs.toFixed(1)}s`;
    } catch { /* keep '?' */ }

    let hasKf = 'No';
    let kfCount = 0;
    if (existsSync(kfPath)) {
      hasKf = 'Yes';
      try {
        const data = JSON.parse(readFileSync(kfPath, 'utf-8'));
        kfCount = data.keyframes?.length || 0;
      } catch { /* ignore */ }
    }

    rows.push(`| segment_${idx}.mp4 | ${duration} | ${hasKf} | ${kfCount} |`);
  }

  return rows.join('\n');
}

/**
 * Generate the working directory with a populated CLAUDE.md for a clip.
 */
function generateWorkDir(clipId: number, port: number): string {
  const workDir = path.join(POST_PROD_BASE, `clip${clipId}`);
  if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });

  const segDir = getSegmentDir(clipId);
  const segmentTable = buildSegmentTable(segDir);

  // Read and populate template
  let template = readFileSync(TEMPLATE_PATH, 'utf-8');
  template = template.replace(/\{\{CLIP_ID\}\}/g, String(clipId));
  template = template.replace(/\{\{SEGMENT_DIR\}\}/g, segDir);
  template = template.replace(/\{\{SEGMENT_TABLE\}\}/g, segmentTable);
  template = template.replace(/\{\{PORT\}\}/g, String(port));
  // Clean up any remaining template vars for examples
  template = template.replace(/\{\{TIME\}\}/g, '{TIME}');
  template = template.replace(/\{\{SEGMENT_PATH\}\}/g, '{SEGMENT_PATH}');
  template = template.replace(/\{\{LABEL\}\}/g, '{LABEL}');

  writeFileSync(path.join(workDir, 'CLAUDE.md'), template);

  return workDir;
}

/**
 * Check if a post-prod tmux session is running for a clip.
 */
export function isPostProdAlive(clipId: number): boolean {
  const tmuxSession = `demoVideo-postprod-clip${clipId}`;
  try {
    execFileSync('runuser', ['-u', 'yaniv', '--', 'tmux', 'has-session', '-t', tmuxSession], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch a post-production Claude session for a clip.
 */
export function launchPostProd(clipId: number, port: number): PostProdResult {
  const workDir = generateWorkDir(clipId, port);
  const tmuxSession = `demoVideo-postprod-clip${clipId}`;

  const prompt = `You are editing post-production for clip ${clipId}. Read CLAUDE.md for full instructions on keyframe format, ffmpeg commands, and workflow.`;

  // Escape prompt for bash $'...' syntax
  const bashEscapedPrompt = prompt
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');

  const claudeCmd = `claude --dangerously-skip-permissions $'${bashEscapedPrompt}'`;
  const bashCmd = `cd '${workDir}' && ${claudeCmd}; exec bash`;
  const launchScriptFile = `/tmp/demoVideo-postprod-clip${clipId}.sh`;
  writeFileSync(launchScriptFile, bashCmd + '\n', { mode: 0o755 });

  // Get session env vars for GUI access
  const sessionEnv = getSessionEnv('yaniv');
  const envArgs = Object.entries(sessionEnv).map(([k, v]) => `${k}=${v}`);

  // Kill existing tmux session if any
  try {
    execFileSync('runuser', ['-u', 'yaniv', '--', 'tmux', 'kill-session', '-t', tmuxSession], { timeout: 3000 });
  } catch { /* no existing session */ }

  // Launch in tmux
  execFile('runuser', [
    '-u', 'yaniv', '--', 'env', ...envArgs,
    'tmux', 'new-session', '-d', '-s', tmuxSession,
    `bash -l ${launchScriptFile}`,
  ], { timeout: 10000 }, (err) => {
    if (err) console.error(`demoVideo post-prod launch failed (clip ${clipId}):`, err.message);
  });

  return { tmuxSession, workDir };
}

/**
 * Kill a post-production Claude session.
 */
export function killPostProd(clipId: number): boolean {
  const tmuxSession = `demoVideo-postprod-clip${clipId}`;
  try {
    execFileSync('runuser', ['-u', 'yaniv', '--', 'tmux', 'kill-session', '-t', tmuxSession], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}
