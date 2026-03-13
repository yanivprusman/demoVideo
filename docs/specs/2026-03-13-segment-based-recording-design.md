# Segment-Based Demo Video Recording

## Problem

The current approach records Claude's entire working session on camera — Claude thinking, making API calls, waiting for responses. This produces hours of footage that, even sped up 6x, doesn't look natural. The previous approach (hardcoded pixel-coordinate executors) was fast on camera but brittle — broke whenever the UI changed.

## Design

Split responsibilities: **Claude is the brain** (verify state, inspect results, fix problems) and a **coded executor is the hands** (perform actions on camera, fast and deterministic). Each recording step produces a short video segment. Claude inspects each segment before moving on. Verified segments get stitched into one smooth clip.

### Roles

| Role | When | On Camera | Tools |
|------|------|-----------|-------|
| **Claude** | Pre-state verification | No | screenshot, daemon commands, CDP page queries |
| **Claude** | Pre-state fixing | No | Any — navigate, click, type, start apps |
| **Executor** | Perform recording step | Yes | CDP selectors, daemon mouse/keyboard |
| **Claude** | Post-step verification | No | screenshot, inspect segment video, CDP queries |
| **Claude** | Post-step fixing | No | Any — fix state for retry |

### Why CDP Instead of Pixel Coordinates

The old executor broke because it used hardcoded `mouseClick({ x: 450, y: 250 })`. The dashboard is a web app — we can connect to Chrome via CDP (already configured on port 9222) and interact using CSS selectors:

```typescript
// Old (brittle)
await sendDaemon('mouseClick', { x: 450, y: 250 });

// New (robust)
await cdp.click('[data-testid="new-app-button"]');
```

CDP handles: dashboard clicks, form fills, navigation, reading page state.
Daemon handles: desktop-level actions (window management, Activities, terminal typing, mouse movement for visual effect).

Both are fast — no AI thinking time on camera.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Orchestrator                    │
│         (Claude via /api/record-clip)            │
│                                                  │
│  for each clip:                                  │
│    1. Verify pre-state (off camera)              │
│    2. Fix pre-state if needed (off camera)       │
│    for each step:                                │
│      3. Start segment recording                  │
│      4. Call executor function (on camera)        │
│      5. Stop segment recording                   │
│      6. Screenshot + inspect segment video        │
│      7. If bad → fix state, re-record step       │
│    8. Stitch segments → final clip               │
└──────────────┬──────────────────┬────────────────┘
               │                  │
    ┌──────────▼──────┐  ┌───────▼─────────┐
    │    Executor      │  │   Verifier       │
    │  (TypeScript)    │  │   (Claude)       │
    │                  │  │                  │
    │ - CDP selectors  │  │ - screenshot     │
    │ - sendDaemon()   │  │ - video inspect  │
    │ - sleep/timing   │  │ - page queries   │
    └─────────────────┘  └──────────────────┘
```

## Step Definition Format

Each clip step becomes a coded function alongside its text description. Steps live in `lib/clips/executors/`.

```typescript
// lib/clips/executors/clip2.ts
import { cdp } from '@/lib/cdp';
import { sendDaemon, sleep } from '@/lib/daemon';

export const clip2Steps: StepExecutor[] = [
  {
    description: 'Navigate to Issues view',
    execute: async () => {
      await cdp.click('[data-testid="nav-issues"]');
      await sleep(800);
    },
    verify: {
      screenshot: true,
      expectOnScreen: ['Issues', 'taskManager', 'weatherApp'],
    },
  },
  {
    description: 'Create taskManager issues',
    execute: async () => {
      // Click "+ New" on taskManager card
      await cdp.click('[data-testid="new-issue-taskManager"]');
      await sleep(500);
      // Fill title
      await cdp.type('[data-testid="issue-title-input"]', 'Login form validation missing');
      await sleep(300);
      // Select bug label
      await cdp.click('[data-testid="label-bug"]');
      await sleep(200);
      // Submit
      await cdp.click('[data-testid="create-issue-submit"]');
      await sleep(600);
      // ... repeat for next issues
    },
    verify: {
      screenshot: true,
      expectOnScreen: ['Login form validation', 'bug'],
    },
  },
];
```

### StepExecutor Interface

```typescript
interface StepExecutor {
  description: string;
  execute: () => Promise<void>;
  verify?: {
    /** Take screenshot after step for Claude to inspect */
    screenshot?: boolean;
    /** Strings Claude should see on screen */
    expectOnScreen?: string[];
    /** CDP selector that should exist after step */
    expectSelector?: string;
  };
}

interface ClipExecutor {
  clipId: number;
  steps: StepExecutor[];
}
```

## CDP Client

A lightweight CDP client that connects to Chrome on port 9222. Wraps common operations.

```typescript
// lib/cdp.ts
class CDPClient {
  async connect(): Promise<void>;       // Connect to Chrome CDP
  async click(selector: string): Promise<void>;  // Click element
  async type(selector: string, text: string): Promise<void>; // Type into input
  async waitFor(selector: string, timeoutMs?: number): Promise<void>; // Wait for element
  async getText(selector: string): Promise<string>; // Read element text
  async evaluate(js: string): Promise<any>; // Run JS in page
  async getUrl(): Promise<string>;       // Current page URL
  async navigate(url: string): Promise<void>; // Navigate to URL
  disconnect(): void;
}
```

Uses the `chrome-remote-interface` npm package (standard CDP client). Chrome is already launched with `--remote-debugging-port=9222`.

## Recording Pipeline

### Per-Step Flow

```
                    Off camera                          On camera
                    ──────────                          ─────────
Step N:
  ┌─────────────────────────┐
  │ Claude: verify pre-step │
  │ state via screenshot +  │
  │ CDP queries             │
  └──────────┬──────────────┘
             │ state OK
             ▼
  ┌──────────────────────┐
  │ screenRecordStart    │──────┐
  │ (segment_N.mp4)      │      │
  └──────────────────────┘      │
                                ▼
                     ┌─────────────────────┐
                     │ executor.execute()   │
                     │ (CDP clicks, daemon  │
                     │  mouse/keyboard,     │
                     │  precise timing)     │
                     └──────────┬──────────┘
                                │
  ┌──────────────────────┐      │
  │ screenRecordStop     │◄─────┘
  └──────────┬───────────┘
             │
             ▼
  ┌─────────────────────────┐
  │ Claude: inspect         │
  │ 1. Screenshot (end      │
  │    state correct?)      │
  │ 2. Watch segment video  │
  │    (smooth? no jank?)   │
  └──────────┬──────────────┘
             │
        ┌────┴────┐
        │ Pass?   │
        └────┬────┘
          yes│    no
             │    │
             │    ▼
             │  ┌──────────────────┐
             │  │ Claude: fix state│
             │  │ Re-record step N │
             │  └──────────────────┘
             ▼
        Next step (N+1)
```

### Segment Naming

```
/opt/automateLinux/data/demoVideo/segments/
  clip1/
    segment_01_create-new-apps.mp4
    segment_02_wait-for-scaffold.mp4
    ...
  clip2/
    segment_01_navigate-issues.mp4
    ...
```

### Stitching

After all steps verified:

```bash
# Generate concat file
for f in segments/clip1/segment_*.mp4; do
  echo "file '$f'" >> concat.txt
done

# Stitch with crossfade transitions (0.3s overlap)
ffmpeg -f concat -safe 0 -i concat.txt \
  -filter_complex "xfade=transition=fade:duration=0.3:offset=<calculated>" \
  -c:v libx264 -preset fast -crf 18 \
  clip1-create-new-apps.mp4
```

Crossfade duration: 0.3s between segments for smooth transitions.
If segments are very short (<2s), use hard cuts instead.

## Execution Modes

### Dashboard Actions (CDP)

For any interaction with the dashboard web app:

```typescript
await cdp.click('[data-testid="nav-apps"]');     // Navigate
await cdp.type('#app-name', 'taskManager');       // Fill form
await cdp.click('button:has-text("Create")');     // Submit
await cdp.waitFor('.create-step-complete', 30000); // Wait for result
```

Requires `data-testid` attributes on key dashboard elements. These need to be added to the dashboard codebase where missing.

### Terminal Actions (Daemon)

For typing commands in a terminal:

```typescript
// Type a daemon command in the terminal
await sendDaemon('keyboardType', { string: 'd listIssues --app taskManager' });
await sleep(300);
await sendDaemon('keyboardKey', { key: '28:1 28:0' }); // Enter
await sleep(1500); // Wait for output
```

### Desktop Actions (Daemon)

For mouse movement, window management, GNOME interactions:

```typescript
await sendDaemon('mouseMove', { x: 500, y: 300 });
await sleep(200);
await sendDaemon('mouseClick', { button: 'left', x: 500, y: 300 });
await sendDaemon('mouseDrag', { fromX: 100, fromY: 30, toX: 800, toY: 30 });
```

### Visual Pacing

Executor functions include deliberate timing for visual appeal:
- **Between UI actions**: 300-800ms (feels snappy but visible)
- **After form submission**: 500-1500ms (see result appear)
- **Before next logical group**: 1000ms (breathing room)
- **Mouse moves**: Use daemon mouseDrag with steps for smooth visible cursor motion

## Data-Testid Requirements

The dashboard needs `data-testid` attributes on interactive elements. Key ones:

```
nav-apps, nav-issues, nav-claude, nav-peers     (sidebar navigation)
new-app-button, new-issue-{appName}              (creation buttons)
app-card-{appName}, issue-row-{appName}-{num}    (list items)
issue-title-input, issue-desc-input              (form fields)
label-{name}, create-issue-submit                (form controls)
fix-with-claude-button, launch-dialog            (action buttons)
```

## Verification Model

Claude verifies after each segment with two checks:

### 1. Screenshot Check
```
Claude takes a screenshot and confirms:
- Expected UI elements are visible
- No error dialogs or unexpected states
- Layout looks correct
```

### 2. Video Inspection
```
Claude watches the recorded segment:
- Action executed smoothly (no visible lag/stutter)
- No unexpected popups or loading spinners
- Cursor movement looks natural
- Timing feels right (not too fast, not too slow)
```

To watch the video, Claude uses the existing `/api/video?path=...` endpoint to access the segment file, or examines key frames extracted with ffmpeg:

```bash
# Extract frames at 1fps for quick visual scan
ffmpeg -i segment_01.mp4 -vf "fps=1" -q:v 2 frames/frame_%03d.jpg
```

### Re-recording

If verification fails:
1. Claude identifies what went wrong
2. Claude fixes the state (off camera) — e.g., close a dialog, navigate back
3. Only the failed segment gets re-recorded
4. Previous segments are untouched

## File Structure

```
lib/
  cdp.ts                      # CDP client wrapper
  clips/
    index.ts                  # ClipDefinition (unchanged)
    executors/
      types.ts                # StepExecutor, ClipExecutor interfaces
      clip1.ts                # Clip 1 executor functions
      clip2.ts                # Clip 2 executor functions
      ...
      clip19.ts
  recording/
    segment-recorder.ts       # Start/stop per-segment recording
    stitcher.ts               # ffmpeg concat + crossfade
    frame-extractor.ts        # Extract frames for verification

app/api/
  record-clip/route.ts        # Updated: segment-based pipeline
  verify-segment/route.ts     # Endpoint for Claude to verify a segment
```

## Execution Order & Dependencies

Clips must be recorded in dependency order. Phases group clips that share pre-state:

| Phase | Clips | Pre-state from |
|-------|-------|----------------|
| 1 | Clip 1 (Create Apps) | Clean slate |
| 2 | Clip 2 (Create Issues) | Phase 1 (apps exist) |
| 3 | Clips 3, 4 (Issue Detail, Lifecycle) | Phase 2 (issues exist) |
| 4 | Clips 5, 6 (Fix with Claude dialog, Launch) | Phase 3 (issue states) |
| 5 | Clips 7, 8 (Sessions, Resume) | Phase 4 (sessions exist) |
| 6 | Clip 9 (Scheduled) | Phase 2 (weatherApp issues) |
| 7 | Clips 10-15 (Hooks, MCP, Desktop, Peers, Clock, Perms) | Minimal deps |
| 8 | Clips 16, 17, 18 (Git sync, App lifecycle, Skills) | Phase 2 |
| 9 | Clip 19 (Terminal wrapper) | No deps |
| 10 | Clip 20 (Final merge) | All clips done |

## Transition Handling

Between segments within a clip:
- **0.3s crossfade** by default — smooths over any minor position jumps
- If a step changes the screen dramatically (e.g., new page), use **hard cut** instead
- Step definitions can override: `transition: 'cut' | 'fade'`

Between clips (in final merge):
- **1s fade to black** — clear separation between topics

## What This Changes

| Aspect | Before (Claude orchestrated) | After (Segment-based) |
|--------|------------------------------|----------------------|
| On-camera actor | Claude (slow, thinking visible) | Executor (fast, deliberate) |
| Recording unit | Entire clip (5-10 min) | Per-step segment (5-30s) |
| Failure recovery | Re-record entire clip | Re-record one segment |
| Verification | None (hope it worked) | Claude inspects each segment |
| Speed-up needed | 6x post-processing | No speed-up needed |
| UI interaction | MCP tools (indirect) | CDP selectors (direct, robust) |
| Total video time | Hours raw → still long at 6x | Minutes of tight footage |
