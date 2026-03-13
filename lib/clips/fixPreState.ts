import { exec } from 'child_process';
import { sendDaemon, sleep } from '../daemon';
import { type PreStateCheck } from './verifyPreState';

export interface FixResult {
  condition: string;
  fixed: boolean;
  message: string;
}

type Fixer = (condition: string, failMessage: string) => Promise<FixResult | null>;

// Launch a GUI app with DISPLAY set
function launchGui(command: string): Promise<void> {
  return new Promise((resolve) => {
    exec(command, {
      env: { ...process.env, DISPLAY: ':0' },
      timeout: 5000,
    }, () => resolve());
  });
}

async function getDashboardUrl(): Promise<string> {
  try {
    const result = await sendDaemon('getPort', { key: 'dashboard-dev' });
    const port = typeof result === 'string' ? result.trim() : String(result);
    if (/^\d+$/.test(port)) return `http://localhost:${port}`;
  } catch { /* fall through */ }
  return 'http://localhost:3007';
}

const fixers: Fixer[] = [
  // Dashboard not running or no window
  async (c, msg) => {
    if (!/dashboard (open|on left)/i.test(c)) return null;

    if (/not running/i.test(msg)) {
      await sendDaemon('startApp', { app: 'dashboard' });
      await sleep(4000);
      const url = await getDashboardUrl();
      await launchGui(`google-chrome-stable '${url}/apps' &`);
      await sleep(3000);
      return { condition: c, fixed: true, message: 'Started dashboard and opened in Chrome' };
    }

    if (/no dashboard window/i.test(msg)) {
      const url = await getDashboardUrl();
      await launchGui(`google-chrome-stable '${url}/apps' &`);
      await sleep(3000);
      return { condition: c, fixed: true, message: 'Opened dashboard in Chrome' };
    }

    return { condition: c, fixed: false, message: 'Unknown dashboard failure' };
  },

  // "X and Y apps exist/running" — start apps that aren't running
  async (c, msg) => {
    const m = c.match(/(\w+) and (\w+) (?:apps? )?(?:exist|running)/i);
    if (!m) return null;

    if (/does not exist/i.test(msg)) {
      return { condition: c, fixed: false, message: 'Cannot auto-create apps — record earlier clips first' };
    }

    if (/not running/i.test(msg)) {
      const appMatch = msg.match(/App "(\w+)" is not running/i);
      if (appMatch) {
        await sendDaemon('startApp', { app: appMatch[1] });
        await sleep(3000);
        return { condition: c, fixed: true, message: `Started app ${appMatch[1]}` };
      }
    }

    return { condition: c, fixed: false, message: 'Unknown app failure' };
  },

  // "No apps named X exist" — app exists but shouldn't (destructive, won't auto-fix)
  async (c, msg) => {
    if (!/no apps? named .+ exist/i.test(c)) return null;
    if (/already exists/i.test(msg)) {
      return { condition: c, fixed: false, message: 'Cannot auto-remove apps — remove manually' };
    }
    return null;
  },

  // Terminal not open
  async (c, msg) => {
    if (!/terminal open/i.test(c)) return null;
    if (!/no terminal/i.test(msg)) return null;

    // Try kgx (GNOME Console) first, fall back to gnome-terminal
    await launchGui('kgx &');
    await sleep(2000);
    return { condition: c, fixed: true, message: 'Opened terminal window' };
  },

  // "Dashboard on left, terminal on right" — compound
  async (c, msg) => {
    if (!/dashboard on left.+terminal on right|terminal on right.+dashboard on left/i.test(c)) return null;

    if (/no dashboard window/i.test(msg)) {
      const url = await getDashboardUrl();
      await launchGui(`google-chrome-stable '${url}/apps' &`);
      await sleep(3000);
      return { condition: c, fixed: true, message: 'Opened dashboard in Chrome' };
    }

    if (/no terminal/i.test(msg)) {
      await launchGui('kgx &');
      await sleep(2000);
      return { condition: c, fixed: true, message: 'Opened terminal window' };
    }

    return { condition: c, fixed: false, message: 'Unknown layout failure' };
  },
];

/** Check if a failed condition has an auto-fixer available */
export function isFixable(condition: string, failMessage: string): boolean {
  // Dashboard open/on left — fixable for "not running" and "no window" failures
  if (/dashboard (open|on left)/i.test(condition) && (/not running|no dashboard window/i.test(failMessage))) return true;

  // Apps running — fixable for "not running", NOT for "does not exist"
  if (/\w+ and \w+ (?:apps? )?(?:exist|running)/i.test(condition) && /not running/i.test(failMessage)) return true;

  // Terminal open — fixable
  if (/terminal open/i.test(condition) && /no terminal/i.test(failMessage)) return true;

  // Compound dashboard+terminal
  if (/dashboard on left.+terminal on right/i.test(condition) && (/no dashboard window|no terminal/i.test(failMessage))) return true;

  return false;
}

/** Run fixers for all failed conditions and return results */
export async function fixFailedConditions(failures: PreStateCheck[]): Promise<FixResult[]> {
  const results: FixResult[] = [];

  for (const failure of failures) {
    let handled = false;
    for (const fixer of fixers) {
      const result = await fixer(failure.condition, failure.message);
      if (result) {
        results.push(result);
        handled = true;
        break;
      }
    }
    if (!handled) {
      results.push({
        condition: failure.condition,
        fixed: false,
        message: 'No auto-fix available',
      });
    }
  }

  return results;
}
