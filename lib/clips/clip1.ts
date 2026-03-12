import { sendDaemon, sleep } from '../daemon';

type StepCallback = (step: number, description: string) => void;

// Key codes for ydotool: Tab=15, Enter=28, Escape=1
const KEY_TAB = '15:1 15:0';
const KEY_ENTER = '28:1 28:0';

// Dashboard UI coordinates (DP-1 monitor, 2560x1440)
// These need calibration via daemon screenshot — run a screenshot first and adjust
const UI = {
  sidebar: {
    apps: { x: 120, y: 200 },        // "Apps" nav item
    issues: { x: 120, y: 260 },      // "Issues" nav item
  },
  apps: {
    newAppBtn: { x: 350, y: 130 },   // "New App" button in header
  },
  newAppDialog: {
    nameInput: { x: 680, y: 400 },   // App name text input
    descInput: { x: 680, y: 470 },   // Description text input
    createBtn: { x: 680, y: 560 },   // "Create" button
  },
};

async function click(x: number, y: number, pauseAfter = 800) {
  await sendDaemon('mouseClick', { button: 'left', x, y });
  await sleep(pauseAfter);
}

async function type(text: string, pauseAfter = 500) {
  await sendDaemon('keyboardType', { string: text });
  await sleep(pauseAfter);
}

async function key(keyCode: string, pauseAfter = 300) {
  await sendDaemon('keyboardKey', { key: keyCode });
  await sleep(pauseAfter);
}

async function createApp(name: string, description: string, onStep: StepCallback, stepBase: number) {
  // Click "New App"
  onStep(stepBase, `Clicking "New App" button`);
  await click(UI.apps.newAppBtn.x, UI.apps.newAppBtn.y, 1500);

  // Fill name
  onStep(stepBase + 1, `Filling app name: ${name}`);
  await click(UI.newAppDialog.nameInput.x, UI.newAppDialog.nameInput.y);
  await type(name);

  // Tab to description and fill
  await key(KEY_TAB);
  await type(description);
  await sleep(1000);

  // Click Create
  onStep(stepBase + 2, `Clicking "Create" — starting scaffolding`);
  await click(UI.newAppDialog.createBtn.x, UI.newAppDialog.createBtn.y, 2000);
}

async function waitForScaffolding(onStep: StepCallback, step: number, appName: string) {
  onStep(step, `Waiting for ${appName} scaffolding to complete...`);
  // Poll app status until running, or timeout after 120s
  const start = Date.now();
  const timeout = 120000;
  while (Date.now() - start < timeout) {
    try {
      const result = await sendDaemon('appStatus', { app: appName });
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      if (text.includes('active (running)')) {
        await sleep(2000); // Extra frames showing success
        return;
      }
    } catch {
      // App may not exist yet during scaffolding
    }
    await sleep(3000);
  }
  // Timeout — continue anyway
  await sleep(2000);
}

export async function executeClip1(onStep: StepCallback): Promise<string> {
  // Start screen recording
  onStep(0, 'Starting screen recording...');
  await sendDaemon('screenRecordStart');
  await sleep(2000); // Extra frames before first action

  // Steps 1-3: Create taskManager
  await createApp('taskManager', 'Task management application', onStep, 1);

  // Step 4: Wait for scaffolding
  await waitForScaffolding(onStep, 4, 'taskManager');

  // Step 5: Navigate back to Apps view
  onStep(5, 'Navigating back to Apps view');
  await click(UI.sidebar.apps.x, UI.sidebar.apps.y, 2000);

  // Steps 6-8: Create weatherApp
  await createApp('weatherApp', 'Weather dashboard application', onStep, 6);

  // Wait for weatherApp scaffolding
  await waitForScaffolding(onStep, 8, 'weatherApp');

  // Step 9: Show Apps view with both apps
  onStep(9, 'Showing Apps view with both new apps');
  await click(UI.sidebar.apps.x, UI.sidebar.apps.y, 2000);
  await sleep(3000); // Hold on final frame

  // Stop recording
  onStep(10, 'Stopping recording...');
  const result = await sendDaemon('screenRecordStop');

  const filePath = typeof result === 'object' && result?.filePath
    ? result.filePath
    : '/tmp/demoVideo-clip1.webm';

  return filePath;
}
