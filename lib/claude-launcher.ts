import crypto from 'crypto';
import { execFile, execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { getSessionEnv } from './session-env';

interface LaunchResult {
  sessionId: string;
  claudeSessionId: string;
  tmuxSession: string;
  scriptLogFile: string;
}

export function launchClaude(prompt: string, clipId: number): LaunchResult {
  const claudeSessionId = crypto.randomUUID();
  const sessionId = `demovideo-clip${clipId}-${Date.now().toString(36)}`;
  const tmuxSession = `demoVideo-clip${clipId}`;
  const scriptLogFile = `/tmp/demoVideo-claude-${sessionId}.log`;
  const launchScriptFile = `/tmp/demoVideo-launch-${sessionId}.sh`;

  // Build claude command — always skip permissions, always use automateLinux cwd for MCP
  const claudeFlags = [
    `--session-id ${claudeSessionId}`,
    '--dangerously-skip-permissions',
  ];
  const claudeCmd = ['claude', ...claudeFlags].join(' ');

  // Escape prompt for bash $'...' syntax
  const bashEscapedPrompt = prompt
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');

  const bashCmd = `cd '/opt/automateLinux' && ${claudeCmd} $'${bashEscapedPrompt}'; exec bash`;

  // Get session env vars for GUI access
  const sessionEnv = getSessionEnv('yaniv');
  const envArgs = Object.entries(sessionEnv).map(([k, v]) => `${k}=${v}`);
  envArgs.push(`CLAUDE_SESSION_ID=${claudeSessionId}`);
  envArgs.push(`CLAUDE_LAUNCH_DIR=/opt/automateLinux`);

  writeFileSync(launchScriptFile, bashCmd + '\n', { mode: 0o755 });

  // Kill existing tmux session for this clip if any (must run as yaniv since tmux session is under yaniv's server)
  try {
    require('child_process').execFileSync('runuser', ['-u', 'yaniv', '--', 'tmux', 'kill-session', '-t', tmuxSession], { timeout: 3000 });
  } catch { /* no existing session */ }

  // Launch in tmux (headless — invisible during recording)
  execFile('runuser', [
    '-u', 'yaniv', '--', 'env', ...envArgs,
    'tmux', 'new-session', '-d', '-s', tmuxSession,
    `script -qf ${scriptLogFile} -c 'bash -l ${launchScriptFile}'`,
  ], { timeout: 10000 }, (err) => {
    if (err) console.error(`demoVideo claude launch failed (clip ${clipId}):`, err.message);
  });

  // Register with dashboard (fire-and-forget)
  fetch('http://localhost:3007/api/claude-sessions/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      claudeSessionId,
      appName: 'demoVideo',
      workDir: '/opt/automateLinux',
      scriptFile: scriptLogFile,
      termTitle: tmuxSession,
      useTmux: true,
      source: 'terminal',
    }),
  }).catch(() => {});

  return { sessionId, claudeSessionId, tmuxSession, scriptLogFile };
}

/** Kill the Claude tmux session for a clip */
export function killClaude(clipId: number): boolean {
  const tmuxSession = `demoVideo-clip${clipId}`;
  try {
    require('child_process').execFileSync('runuser', ['-u', 'yaniv', '--', 'tmux', 'kill-session', '-t', tmuxSession], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** Check if the Claude process is still running in the tmux session */
export function isClaudeAlive(scriptLogFile: string): boolean {
  try {
    require('child_process').execFileSync('pgrep', ['-f', `script -qf ${scriptLogFile}`], {
      encoding: 'utf8',
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}
