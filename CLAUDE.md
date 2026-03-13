# CLAUDE.md — demoVideo

## Project Overview

demoVideo is a Next.js app that records screen demo videos of the automateLinux dashboard. It defines **20 clips** in `lib/clips/index.ts`, each with pre-state conditions, recording steps, and post-state expectations. A Claude session orchestrates the recording — either on-camera (legacy mode) or off-camera as an executor orchestrator (segment mode).

**Stack**: Next.js 16, React 19, TypeScript, Tailwind CSS 4, `chrome-remote-interface` for CDP

**Port**: 3019 (dev and prod)

**Data directory**: `/opt/automateLinux/data/demoVideo/`

## Segment Recording Architecture

The segment-based system records each step independently, then stitches them together. Claude is **off-camera** — it orchestrates by calling API endpoints.

```
Claude (off-camera)
  │
  ├─ Verify pre-state (screenshots, daemon queries)
  │
  ├─ For each step:
  │   POST /api/execute-step { clipId, stepIndex }
  │     └─ startSegment() → step.execute() → stopSegment() → extractBookendFrames()
  │     └─ Returns { segment path, verification frames }
  │   Claude inspects frames, reports progress
  │
  └─ POST /api/stitch-clip { clipId }
       └─ Speed up segments → concat demux → final clip
```

Key insight: **Executor steps use CDP to find element coordinates, then daemon commands for the actual mouse/keyboard actions.** CDP mouse events (`Input.dispatchMouseEvent`) are invisible in screen recordings — only daemon `mouseMove`/`mouseClick`/`keyboardType` produce visible cursor movement and keystrokes.

## How to Create a New Executor

### Step 1: Create the executor file

Create `lib/clips/executors/clip{N}.ts`:

```typescript
import type { ClipExecutor } from './types';
import * as cdp from '../../cdp';
import { sendDaemon, sleep } from '../../daemon';

export const clip{N}Executor: ClipExecutor = {
  clipId: N,
  steps: [
    {
      description: 'Human-readable step name',
      async execute() {
        await cdp.connect(':3007');
        // ... perform on-screen actions
      },
      verify: {
        screenshot: true,
        expectSelector: '[data-id="some-element"]',
        // or: expectVisible: ['text on screen'],
      },
      transition: 'fade', // or 'cut'
      speedUp: 1,         // optional: 30 for long waits
    },
    // ... more steps
  ],
};
```

### Step 2: Register the executor

In `lib/clips/executors/index.ts`:

```typescript
import { clip{N}Executor } from './clip{N}';
// ...
register(clip{N}Executor);
```

### Step 3: Match steps to recordingSteps

Each step in the executor's `steps` array corresponds to one `recordingSteps` entry from `lib/clips/index.ts`. The step count must match.

### StepExecutor Interface

```typescript
interface StepExecutor {
  description: string;        // Human-readable name
  execute: () => Promise<void>; // Async action function
  verify?: {
    screenshot?: boolean;       // Take screenshot after step
    expectVisible?: string[];   // Text expected on screen
    expectSelector?: string;    // CSS selector that should exist
  };
  transition?: 'fade' | 'cut'; // Transition to next segment (default: 'fade')
  speedUp?: number;             // Speed multiplier for this segment (default: 1)
}
```

Use `speedUp: 30` for long waits (scaffolding, builds). Use `transition: 'cut'` for continuous action, `'fade'` for scene changes.

## CDP API Reference (`lib/cdp.ts`)

All functions use Chrome DevTools Protocol on port 9222. Chrome must be running with `--remote-debugging-port=9222`.

### Connection

| Function | Description |
|----------|-------------|
| `connect(urlFragment)` | Connect to Chrome tab matching URL fragment. Auto-calibrates geometry. Activates tab. |
| `disconnect()` | Close CDP connection |
| `switchTab(urlFragment)` | Disconnect and reconnect to a different tab |
| `listTabs()` | List all Chrome tabs with id, title, url |

**URL matching**: Use port fragments like `:3007` (not `localhost:3007`). Chrome tabs show `10.0.0.2:3007` (the machine's WireGuard IP), not `localhost`.

### Element Interaction

| Function | Description |
|----------|-------------|
| `clickElement(dataId)` | Find element by `data-id`, move OS cursor, click. Visible on screen. |
| `typeInto(dataId, text)` | Click element, select all, delete existing text, type new text via daemon. |
| `scrollIntoView(dataId)` | Smooth-scroll element to center of viewport |
| `getElementCenter(dataId)` | Get center coordinates (CSS pixels) of element |

### Waiting

| Function | Description |
|----------|-------------|
| `waitForElement(dataId, timeoutMs?)` | Poll for `data-id` element to appear. Default 10s timeout. Returns boolean. |
| `waitForSelector(selector, timeoutMs?)` | Poll for CSS selector to appear. Default 10s timeout. Returns boolean. |

### Reading

| Function | Description |
|----------|-------------|
| `getText(dataId)` | Get `textContent` of element by `data-id` |
| `getTextBySelector(selector)` | Get `textContent` by CSS selector |
| `evaluate<T>(expression)` | Run arbitrary JS in page context, return result |

### Coordinates

| Function | Description |
|----------|-------------|
| `toScreenCoords(pageX, pageY)` | Convert CSS page coords to device-pixel screen coords. Auto-calibrated. |

Calibration accounts for: window position (`screenX`, `screenY`), device pixel ratio (DPR = 1.25), Chrome UI height (tabs + address bar). Called automatically on `connect()`.

## Daemon Helpers (`lib/daemon.ts`)

```typescript
sendDaemon(command: string, args?: Record<string, string | number | boolean>): Promise<any>
sleep(ms: number): Promise<void>
```

Communicates via Unix domain socket at `/run/automatelinux/automatelinux-daemon.sock`. 120s timeout.

## Common Executor Patterns

### Connect to dashboard
```typescript
await cdp.connect(':3007');
```

### Navigate sidebar
```typescript
await cdp.clickElement('nav-apps');
await cdp.waitForElement('target-element', 5000);
```

### Fill form fields
```typescript
await cdp.typeInto('app-name', 'myApp');
await sleep(300);
await cdp.typeInto('app-description', 'Description text');
```

### Submit and wait
```typescript
await cdp.clickElement('create-app');
await cdp.waitForElement('create-app-progress', 5000);
```

### Poll for async completion
```typescript
const start = Date.now();
const TIMEOUT = 180000;
while (Date.now() - start < TIMEOUT) {
  try {
    const done = await cdp.evaluate<boolean>(
      `!!document.querySelector('[data-id="scaffold-complete"]') || ` +
      `document.body.innerText.includes('All steps completed')`
    );
    if (done) break;
  } catch { /* page might be loading */ }
  await sleep(3000);
}
```

### Switch between tabs
```typescript
await cdp.switchTab(':3007');      // Dashboard
await cdp.switchTab('create-app'); // Create app tab
```

### Terminal commands (typed visibly on screen)
```typescript
await sendDaemon('keyboardType', { string: 'd listApps' });
await sendDaemon('keyboardKey', { key: '28:1 28:0' }); // Enter
await sleep(2000); // Wait for output
```

### Read element text for verification
```typescript
const count = await cdp.getText('issue-count');
const exists = await cdp.evaluate<boolean>(
  `document.body.innerText.includes('taskManager')`
);
```

## Dashboard `data-id` Reference

### Sidebar Navigation
`nav-apps`, `nav-issues`, `nav-peers`, `nav-claude`, `nav-logs`, `nav-macros`, `nav-settings`

### Apps View
`new-app`, `app-name`, `app-description`, `create-app`, `create-app-progress`, `scaffold-complete`

### Issues View
Check the dashboard source (`/opt/dev/dashboard/`) for current `data-id` attributes. The dashboard has 249+ `data-id` attributes across components.

## Recording & Stitching

### Segment Recording (`lib/recording/segment-recorder.ts`)
- `startSegment(clipId, stepIndex)` — starts daemon screen recording, returns segment path
- `stopSegment()` — stops recording, waits 8s for ffmpeg merge
- Segments saved to: `/opt/automateLinux/data/demoVideo/segments/clip{N}/segment_{NN}.mp4`

### Stitching (`lib/recording/stitcher.ts`)
- `stitchSegments(segments[], outputPath)` — speed up + concat demux
- Speed-up: `setpts=PTS/{speed}` for video, chained `atempo` for audio (max 2.0x per filter)
- Always uses `-r 30` to prevent high-fps output files
- Concat uses ffmpeg concat demux (not xfade — timebase issues)
- Temp `_speed` files cleaned up after stitching

### Frame Extraction (`lib/recording/frame-extractor.ts`)
- `extractBookendFrames(segmentPath)` — first + last frame as JPEG for verification

## Pitfalls & Lessons Learned

1. **Chrome tabs use `10.0.0.2:XXXX` not `localhost:XXXX`** — match by port fragment (`:3007`) not full URL
2. **CDP mouse events are invisible** — always use daemon `mouseMove`/`mouseClick` for on-screen cursor movement
3. **DPR is 1.25** — calibration is automatic via `connect()`, don't hardcode pixel offsets
4. **`typeInto` auto-clears** — it select-all + deletes before typing, no need to clear manually
5. **Speed-up segments need `-r 30`** — without it, ffmpeg creates 900fps files from `setpts` filter
6. **Stitcher uses concat demux** — xfade had timebase issues with variable-length segments
7. **Segment filenames must match `/^segment_\d+\.mp4$/`** — temp `_speed` files are excluded from stitching
8. **`screenRecordStop` needs ~8s** — ffmpeg merges PipeWire stream chunks, wait before using the file
9. **`connect()` activates the tab** — no need to manually activate before interacting
10. **`switchTab()` disconnects first** — always disconnects current tab before connecting to new one
11. **`evaluate()` throws on JS errors** — wrap in try/catch when checking for elements that may not exist

## Clip Definitions

All 20 clips are defined in `lib/clips/index.ts`. Current executor status:

| Clip | Title | Executor |
|------|-------|----------|
| 1 | Create New Apps | `clip1.ts` |
| 2 | Create Issues | needed |
| 3 | Issue Detail & Context Menu | needed |
| 4 | Issue Lifecycle & Labels | needed |
| 5 | Fix with Claude — Dialog | needed |
| 6 | Launch Claude & Session Tracking | needed |
| 7 | Claude Sessions Tab Deep Dive | needed |
| 8 | Session Resume & History | needed |
| 9 | Scheduled Launches | needed |
| 10 | Hooks System | needed |
| 11 | MCP Server & Daemon Tools | needed |
| 12 | Desktop Automation | needed |
| 13 | Multi-Peer Network | needed |
| 14 | GNOME Clock Extension | needed |
| 15 | Permission System & Auto-Approval | needed |
| 16 | Git Sync & Issue Storage | needed |
| 17 | App Lifecycle Management | needed |
| 18 | Skills System Overview | needed |
| 19 | Terminal Wrapper & Helpers | needed |
| 20 | Final Merge (disabled) | N/A |

## Running a Clip Recording

```bash
# Start demoVideo dev server
d startApp --app demoVideo
# Or: cd /opt/dev/demoVideo && npm run dev

# Record via UI: open http://10.0.0.2:3019, click Record on a clip card
# Record via API: POST /api/record-clip { clipId: N }
# Clips with registered executors auto-use segment mode
```

## Key Files

| File | Purpose |
|------|---------|
| `lib/clips/index.ts` | 20 clip definitions (pre-state, steps, post-state) |
| `lib/clips/executors/types.ts` | `StepExecutor` and `ClipExecutor` interfaces |
| `lib/clips/executors/index.ts` | Executor registry (register + lookup) |
| `lib/clips/executors/clip1.ts` | Reference executor implementation |
| `lib/cdp.ts` | CDP client — connect, click, type, wait, evaluate |
| `lib/daemon.ts` | `sendDaemon()` and `sleep()` |
| `lib/recording/segment-recorder.ts` | Start/stop per-segment recording |
| `lib/recording/stitcher.ts` | FFmpeg speed-up + concat |
| `lib/recording/frame-extractor.ts` | Extract frames for verification |
| `app/api/execute-step/route.ts` | Execute single step (record + run + extract) |
| `app/api/record-clip/route.ts` | Full clip recording orchestration |
| `app/api/stitch-clip/route.ts` | Stitch segments into final clip |
| `lib/prompt-builder.ts` | Claude prompt generation (legacy + segment modes) |
| `lib/claude-launcher.ts` | Launch Claude in tmux for recording |

## Build & Dev

```bash
npm run dev          # Start dev server on port 3019
npm run build        # Production build
d startApp --app demoVideo   # Start via daemon (both dev and prod)
d stopApp --app demoVideo    # Stop via daemon
```
