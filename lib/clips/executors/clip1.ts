import type { ClipExecutor } from './types';
import * as cdp from '../../cdp';
import { sleep } from '../../daemon';

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

        // Poll for scaffold completion — check for success indicator
        const start = Date.now();
        const TIMEOUT = 180000; // 3 min max
        while (Date.now() - start < TIMEOUT) {
          try {
            const done = await cdp.evaluate<boolean>(
              `!!document.querySelector('[data-id="scaffold-complete"]') || ` +
              `document.body.innerText.includes('All steps completed') || ` +
              `document.body.innerText.includes('App created successfully')`
            );
            if (done) break;
          } catch { /* page might be loading */ }
          await sleep(3000);
        }

        await sleep(2000); // Let final UI settle
      },
      verify: {
        screenshot: true,
      },
      transition: 'fade',
      speedUp: 30,
    },
    {
      description: 'Navigate back to Apps, click New App for weatherApp',
      async execute() {
        // Switch back to dashboard
        await cdp.switchTab(':3007');
        await sleep(500);

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

        const start = Date.now();
        const TIMEOUT = 180000;
        while (Date.now() - start < TIMEOUT) {
          try {
            const done = await cdp.evaluate<boolean>(
              `!!document.querySelector('[data-id="scaffold-complete"]') || ` +
              `document.body.innerText.includes('All steps completed') || ` +
              `document.body.innerText.includes('App created successfully')`
            );
            if (done) break;
          } catch { /* page loading */ }
          await sleep(3000);
        }

        await sleep(2000);
      },
      verify: {
        screenshot: true,
      },
      transition: 'fade',
      speedUp: 30,
    },
    {
      description: 'Show Apps view with both apps listed',
      async execute() {
        // Switch to dashboard
        await cdp.switchTab(':3007');
        await sleep(500);

        // Navigate to Apps view
        await cdp.clickElement('nav-apps');
        await sleep(1500);

        // Scroll to show both apps visible
        // The apps should already be visible in the list
        await sleep(3000); // Hold for viewer to see
      },
      verify: {
        screenshot: true,
        expectVisible: ['taskManager', 'weatherApp'],
      },
      transition: 'fade',
    },
  ],
};
