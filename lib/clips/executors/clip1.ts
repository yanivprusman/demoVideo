import type { ClipExecutor } from './types';
import * as cdp from '../../cdp';
import { sendDaemon, sleep } from '../../daemon';

const SCAFFOLD_KEYS = [
  'scaffolded', 'gitInitialized', 'repoCreated', 'portsAllocated',
  'worktreeCreated', 'servicesInstalled', 'depsInstalled', 'built', 'servicesRunning',
] as const;

async function waitForScaffoldComplete(appName: string, timeoutMs = 180000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = await sendDaemon('createAppProgress', { app: appName });
      const progress = typeof result === 'string' ? JSON.parse(result) : result;
      if (SCAFFOLD_KEYS.every(key => progress[key] === true)) return;
    } catch { /* not ready yet */ }
    await sleep(3000);
  }
  throw new Error(`Scaffold timeout for ${appName} after ${timeoutMs}ms`);
}

export const clip1Executor: ClipExecutor = {
  clipId: 1,
  steps: [
    {
      description: 'Click New App, create taskManager',
      async execute() {
        // Connect to dashboard tab
        await cdp.connect(':3007');

        // Navigate to Apps view if not there
        await cdp.clickElement('nav-apps');
        await cdp.waitForElement('new-app', 5000);

        // Click "New App" button
        await cdp.clickElement('new-app');
        await cdp.waitForElement('app-name', 5000);

        // Fill in app name
        await cdp.typeInto('app-name', 'taskManager');
        await sleep(300);

        // Fill in description
        await cdp.typeInto('app-description', 'Task management application');
        await sleep(300);

        // Click Create button
        await cdp.clickElement('create-app');
        await sleep(1000);
      },
      verify: {
        screenshot: true,
        expectSelector: '[data-id="create-app-progress"]',
      },
      transition: 'cut',
    },
    {
      description: 'Wait for taskManager scaffold to complete',
      async execute() {
        // Switch to the create-app tab that opened
        try {
          await cdp.switchTab('create-app');
        } catch {
          // May still be on same tab — scaffold might show inline
        }

        // Poll daemon directly for reliable completion detection
        await waitForScaffoldComplete('taskManager');
        await sleep(2000); // Let final UI settle

        // Close the create-app tab to keep tab bar clean
        await cdp.evaluate(`window.close()`);
        await sleep(500);
      },
      verify: {
        screenshot: true,
      },
      transition: 'fade',
      speedUp: 6,
    },
    {
      description: 'Navigate back to Apps, click New App for weatherApp',
      async execute() {
        // Navigate in the dashboard tab (avoid tab-switch glitch)
        await cdp.connect(':3007');
        await cdp.evaluate(`window.location.href = 'http://localhost:3007/'`);
        await sleep(1500);
        await cdp.waitForElement('nav-apps', 5000);

        // Navigate to Apps view
        await cdp.clickElement('nav-apps');
        await sleep(500);

        // Click "New App" button
        await cdp.clickElement('new-app');
        await cdp.waitForElement('app-name', 5000);

        // Fill in app name
        await cdp.typeInto('app-name', 'weatherApp');
        await sleep(300);

        // Fill in description
        await cdp.typeInto('app-description', 'Weather dashboard application');
        await sleep(300);

        // Click Create
        await cdp.clickElement('create-app');
        await sleep(1000);
      },
      verify: {
        screenshot: true,
        expectSelector: '[data-id="create-app-progress"]',
      },
      transition: 'cut',
    },
    {
      description: 'Wait for weatherApp scaffold to complete',
      async execute() {
        try {
          await cdp.switchTab('create-app');
        } catch { /* may be inline */ }

        // Poll daemon directly for reliable completion detection
        await waitForScaffoldComplete('weatherApp');
        await sleep(2000); // Let final UI settle

        // Close the create-app tab to keep tab bar clean
        await cdp.evaluate(`window.close()`);
        await sleep(500);
      },
      verify: {
        screenshot: true,
      },
      transition: 'fade',
      speedUp: 6,
    },
    {
      description: 'Show Apps view with both apps listed',
      async execute() {
        // Navigate to dashboard root in current tab
        await cdp.connect(':3007');
        await cdp.evaluate(`window.location.href = 'http://localhost:3007/'`);
        await sleep(1500);
        await cdp.waitForElement('nav-apps', 5000);

        // Navigate to Apps view
        await cdp.clickElement('nav-apps');
        await sleep(1500);

        // Scroll to bottom to reveal new apps below the fold
        await cdp.evaluate(`window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })`);
        await sleep(2000);

        await sleep(2000); // Hold for viewer to see
      },
      verify: {
        screenshot: true,
        expectVisible: ['taskManager', 'weatherApp'],
      },
      transition: 'fade',
    },
  ],
};
