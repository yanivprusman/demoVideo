import CDP from 'chrome-remote-interface';
import { sendDaemon, sleep } from './daemon';

const CDP_PORT = 9222;

interface TabInfo {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface WindowGeometry {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  /** Device-pixel offset from window top to viewport top (Chrome UI height) */
  chromeUiHeight: number;
}

let activeClient: CDP.Client | null = null;
let activeTabId: string | null = null;
let cachedGeometry: WindowGeometry | null = null;

/**
 * List all Chrome tabs via CDP.
 */
export async function listTabs(): Promise<TabInfo[]> {
  const targets = await CDP.List({ port: CDP_PORT });
  return targets
    .filter((t: any) => t.type === 'page')
    .map((t: any) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      webSocketDebuggerUrl: t.webSocketDebuggerUrl,
    }));
}

/**
 * Connect to a Chrome tab matching a URL fragment.
 */
export async function connect(urlFragment: string): Promise<CDP.Client> {
  const tabs = await listTabs();
  const tab = tabs.find(t => t.url.includes(urlFragment));
  if (!tab) {
    throw new Error(`No Chrome tab matching "${urlFragment}" found. Tabs: ${tabs.map(t => t.url).join(', ')}`);
  }

  // Reuse if same tab
  if (activeClient && activeTabId === tab.id) {
    return activeClient;
  }

  // Disconnect old
  await disconnect();

  activeClient = await CDP({ target: tab.id, port: CDP_PORT });
  activeTabId = tab.id;

  // Activate this tab in Chrome (make it the visible tab)
  try {
    const cdpHttp = await import('http');
    await new Promise<void>((resolve, reject) => {
      const req = cdpHttp.get(`http://localhost:${CDP_PORT}/json/activate/${tab.id}`, (res) => {
        res.resume();
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error('activate timeout')); });
    });
    await sleep(300); // Let tab switch settle
  } catch { /* non-critical — tab may already be active */ }

  // Calibrate window geometry on each new connection
  await calibrate();

  return activeClient;
}

/**
 * Read Chrome window geometry and compute coordinate offsets.
 * getBoundingClientRect() returns CSS pixels; daemon uses device pixels.
 * We need: screen_x = screenX + (cssX * DPR)
 *          screen_y = screenY + chromeUiHeight + (cssY * DPR)
 */
async function calibrate(): Promise<void> {
  const client = getClient();
  const result = await client.Runtime.evaluate({
    expression: `({
      screenX: window.screenX,
      screenY: window.screenY,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    })`,
    returnByValue: true,
  });
  const w = result.result.value;
  // Chrome UI height in device pixels = outerHeight - (innerHeight * DPR)
  const chromeUiHeight = Math.round(w.outerHeight - w.innerHeight * w.devicePixelRatio);
  cachedGeometry = { ...w, chromeUiHeight };
}

/**
 * Disconnect from current tab.
 */
export async function disconnect(): Promise<void> {
  if (activeClient) {
    try { await activeClient.close(); } catch { /* already closed */ }
    activeClient = null;
    activeTabId = null;
    cachedGeometry = null;
  }
}

/**
 * Switch to a different Chrome tab by URL fragment.
 */
export async function switchTab(urlFragment: string): Promise<CDP.Client> {
  await disconnect();
  return connect(urlFragment);
}

/**
 * Get the center coordinates (page-relative) of an element by data-id.
 */
export async function getElementCenter(dataId: string): Promise<{ x: number; y: number }> {
  const client = getClient();
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: `
      (function() {
        const el = document.querySelector('[data-id="${dataId}"]');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()
    `,
    returnByValue: true,
  });

  if (!result.result.value) {
    throw new Error(`Element [data-id="${dataId}"] not found`);
  }

  return result.result.value;
}

/**
 * Convert CSS page-relative coordinates to device-pixel screen coordinates.
 * Uses calibrated window geometry (DPR, window position, Chrome UI height).
 */
export function toScreenCoords(pageX: number, pageY: number): { x: number; y: number } {
  if (!cachedGeometry) {
    throw new Error('Window geometry not calibrated. Call connect() first.');
  }
  const { screenX, screenY, devicePixelRatio: dpr, chromeUiHeight } = cachedGeometry;
  return {
    x: Math.round(screenX + pageX * dpr),
    y: Math.round(screenY + chromeUiHeight + pageY * dpr),
  };
}

/**
 * Click an element by data-id using daemon mouseMove + mouseClick (visible on screen).
 * CDP finds the element coords, daemon moves the OS cursor.
 */
export async function clickElement(dataId: string): Promise<void> {
  const pageCoords = await getElementCenter(dataId);
  const screen = toScreenCoords(pageCoords.x, pageCoords.y);

  await sendDaemon('mouseMove', { x: screen.x, y: screen.y });
  await sleep(100);
  await sendDaemon('mouseClick', { button: 'left', x: screen.x, y: screen.y });
  await sleep(200);
}

/**
 * Click an element, clear it, and type into it using daemon keyboardType (visible on screen).
 */
export async function typeInto(dataId: string, text: string): Promise<void> {
  await clickElement(dataId);
  await sleep(200);
  // Select all existing text and delete it first
  const client = getClient();
  await client.Runtime.evaluate({
    expression: `
      (function() {
        const el = document.querySelector('[data-id="${dataId}"]');
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          el.select();
        }
      })()
    `,
  });
  await sleep(100);
  // Delete selected text via keyboard
  await sendDaemon('keyboardKey', { key: '119:1 119:0' }); // Delete key
  await sleep(100);
  await sendDaemon('keyboardType', { string: text });
  await sleep(200);
}

/**
 * Wait for an element with a data-id to appear in the DOM.
 */
export async function waitForElement(dataId: string, timeoutMs: number = 10000): Promise<boolean> {
  const client = getClient();
  const { Runtime } = client;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await Runtime.evaluate({
      expression: `!!document.querySelector('[data-id="${dataId}"]')`,
      returnByValue: true,
    });
    if (result.result.value === true) return true;
    await sleep(500);
  }

  return false;
}

/**
 * Wait for a CSS selector to appear.
 */
export async function waitForSelector(selector: string, timeoutMs: number = 10000): Promise<boolean> {
  const client = getClient();
  const { Runtime } = client;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await Runtime.evaluate({
      expression: `!!document.querySelector(${JSON.stringify(selector)})`,
      returnByValue: true,
    });
    if (result.result.value === true) return true;
    await sleep(500);
  }

  return false;
}

/**
 * Get text content of an element by data-id.
 */
export async function getText(dataId: string): Promise<string> {
  const client = getClient();
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: `
      (function() {
        const el = document.querySelector('[data-id="${dataId}"]');
        return el ? el.textContent : null;
      })()
    `,
    returnByValue: true,
  });

  return result.result.value || '';
}

/**
 * Get text content of an element by CSS selector.
 */
export async function getTextBySelector(selector: string): Promise<string> {
  const client = getClient();
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: `
      (function() {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el ? el.textContent : null;
      })()
    `,
    returnByValue: true,
  });

  return result.result.value || '';
}

/**
 * Evaluate arbitrary JS in the page context.
 */
export async function evaluate<T>(expression: string): Promise<T> {
  const client = getClient();
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(`CDP eval error: ${result.exceptionDetails.text}`);
  }

  return result.result.value;
}

/**
 * Scroll an element into view by data-id.
 */
export async function scrollIntoView(dataId: string): Promise<void> {
  const client = getClient();
  const { Runtime } = client;

  await Runtime.evaluate({
    expression: `document.querySelector('[data-id="${dataId}"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })`,
  });
  await sleep(500);
}

function getClient(): CDP.Client {
  if (!activeClient) {
    throw new Error('CDP not connected. Call connect() first.');
  }
  return activeClient;
}
