import { sendDaemon } from '../daemon';

export interface PreStateCheck {
  condition: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

type Checker = (condition: string) => Promise<PreStateCheck | null>;

// Helper: check if an app is registered and running
async function checkAppStatus(app: string): Promise<{ exists: boolean; running: boolean; text: string }> {
  try {
    const result = await sendDaemon('appStatus', { app });
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return {
      exists: !text.includes('Unknown app'),
      running: text.includes('RUNNING'),
      text,
    };
  } catch {
    return { exists: false, running: false, text: '' };
  }
}

// Helper: get window list
async function getWindows(): Promise<Array<{ id: number; title: string; wm_class: string; workspace: number }>> {
  try {
    const result = await sendDaemon('listWindows');
    if (Array.isArray(result)) return result;
    return JSON.parse(typeof result === 'string' ? result : '[]');
  } catch {
    return [];
  }
}

const checkers: Checker[] = [
  // "Dashboard open ..." or "Dashboard on left..."
  async (c) => {
    if (!/dashboard (open|on left)/i.test(c)) return null;
    const { running } = await checkAppStatus('dashboard');
    if (!running) {
      return { condition: c, status: 'fail', message: 'Dashboard app is not running' };
    }
    const wins = await getWindows();
    const has = wins.some(w => /dashboard/i.test(w.title) || /localhost:300[67]/.test(w.title));
    if (!has) {
      return { condition: c, status: 'fail', message: 'No dashboard window found in Chrome' };
    }
    return { condition: c, status: 'pass', message: 'Dashboard running and window found' };
  },

  // "Dashboard showing X view" — can't verify programmatically
  async (c) => {
    if (!/dashboard showing/i.test(c)) return null;
    return { condition: c, status: 'warn', message: 'Cannot verify dashboard view — ensure manually' };
  },

  // "No apps named X or Y exist"
  async (c) => {
    const m = c.match(/no apps? named (.+) exist/i);
    if (!m) return null;
    const names = m[1].split(/ or | and |, /).map(s => s.trim()).filter(Boolean);
    for (const name of names) {
      const { exists } = await checkAppStatus(name);
      if (exists) {
        return { condition: c, status: 'fail', message: `App "${name}" already exists — remove it first` };
      }
    }
    return { condition: c, status: 'pass', message: 'Apps do not exist' };
  },

  // "X and Y apps exist" or "X and Y running"
  async (c) => {
    const m = c.match(/(\w+) and (\w+) (?:apps? )?(?:exist|running)/i);
    if (!m) return null;
    for (const name of [m[1], m[2]]) {
      const { exists, running } = await checkAppStatus(name);
      if (!exists) {
        return { condition: c, status: 'fail', message: `App "${name}" does not exist` };
      }
      if (/running/i.test(c) && !running) {
        return { condition: c, status: 'fail', message: `App "${name}" is not running` };
      }
    }
    return { condition: c, status: 'pass', message: 'Apps exist and are in expected state' };
  },

  // "Terminal open on ..."
  async (c) => {
    if (!/terminal open/i.test(c)) return null;
    const wins = await getWindows();
    const has = wins.some(w => /terminal/i.test(w.wm_class));
    if (!has) {
      return { condition: c, status: 'fail', message: 'No terminal window found' };
    }
    return { condition: c, status: 'pass', message: 'Terminal window found' };
  },

  // "Both apps have N issues" or "X has N open issues"
  async (c) => {
    const m = c.match(/both apps have (\d+) issues/i);
    if (!m) return null;
    // Can't determine which apps without more context
    return { condition: c, status: 'warn', message: 'Cannot determine which apps to check — verify manually' };
  },

  // "X has open issues" or "X has N open issues"
  async (c) => {
    const m = c.match(/(\w+) has (?:(\d+) )?open issues/i);
    if (!m) return null;
    const [, app, countStr] = m;
    try {
      const result = await sendDaemon('listIssues', { app, status: 'open' });
      const issues = Array.isArray(result) ? result : [];
      if (countStr !== undefined) {
        const expected = parseInt(countStr);
        if (issues.length !== expected) {
          return { condition: c, status: 'fail', message: `${app} has ${issues.length} open issues, expected ${expected}` };
        }
      } else if (issues.length === 0) {
        return { condition: c, status: 'fail', message: `${app} has no open issues` };
      }
    } catch {
      return { condition: c, status: 'warn', message: `Could not check issues for ${app}` };
    }
    return { condition: c, status: 'pass', message: 'Issue count matches' };
  },

  // "Both apps have issues (from Clip N)"
  async (c) => {
    if (!/both apps have issues/i.test(c)) return null;
    return { condition: c, status: 'warn', message: 'Cannot determine which apps — verify manually' };
  },

  // "No active Claude sessions"
  async (c) => {
    if (!/no active claude sessions/i.test(c)) return null;
    return { condition: c, status: 'warn', message: 'Cannot verify Claude sessions — check manually' };
  },

  // "At least one Claude session ..."
  async (c) => {
    if (!/claude session/i.test(c)) return null;
    return { condition: c, status: 'warn', message: 'Cannot verify Claude sessions — check manually' };
  },

  // "Right monitor ... clear/unused" or "Desktop visible"
  async (c) => {
    if (!/clear\/unused|desktop visible/i.test(c)) return null;
    return { condition: c, status: 'warn', message: 'Cannot verify monitor/desktop state — ensure manually' };
  },

  // "Dashboard on left, terminal on right"
  async (c) => {
    if (!/dashboard on left.+terminal on right|terminal on right.+dashboard on left/i.test(c)) return null;
    const wins = await getWindows();
    const hasDash = wins.some(w => /dashboard/i.test(w.title) || /localhost:300[67]/.test(w.title));
    const hasTerm = wins.some(w => /terminal/i.test(w.wm_class));
    if (!hasDash) return { condition: c, status: 'fail', message: 'No dashboard window found' };
    if (!hasTerm) return { condition: c, status: 'fail', message: 'No terminal window found' };
    return { condition: c, status: 'pass', message: 'Dashboard and terminal windows found' };
  },

  // "Issues exist in X and Y" or "Issues exist, terminal..."
  async (c) => {
    if (!/issues exist/i.test(c)) return null;
    return { condition: c, status: 'warn', message: 'Cannot fully verify — ensure issues exist manually' };
  },

  // "Peers tab accessible"
  async (c) => {
    if (!/peers tab/i.test(c)) return null;
    return { condition: c, status: 'warn', message: 'Cannot verify dashboard tab state — ensure manually' };
  },

  // "Clock extension running"
  async (c) => {
    if (!/clock extension/i.test(c)) return null;
    return { condition: c, status: 'warn', message: 'Cannot verify GNOME extension state — ensure manually' };
  },

  // "All N clip videos recorded"
  async (c) => {
    if (!/all \d+ clip/i.test(c)) return null;
    return { condition: c, status: 'warn', message: 'Cannot verify all clips — check recordings manually' };
  },

  // "No special state needed"
  async (c) => {
    if (!/no special state/i.test(c)) return null;
    return { condition: c, status: 'pass', message: 'No verification needed' };
  },
];

export async function verifyPreState(preState: string[]): Promise<PreStateCheck[]> {
  const results: PreStateCheck[] = [];

  for (const condition of preState) {
    let handled = false;
    for (const checker of checkers) {
      const result = await checker(condition);
      if (result) {
        results.push(result);
        handled = true;
        break;
      }
    }
    if (!handled) {
      results.push({
        condition,
        status: 'warn',
        message: 'No automated check available — verify manually',
      });
    }
  }

  return results;
}
