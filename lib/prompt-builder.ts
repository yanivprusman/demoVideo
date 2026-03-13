import { type ClipDefinition } from './clips';
import { getExecutor } from './clips/executors';

export function buildPrompt(clip: ClipDefinition, port: number): string {
  const progressUrl = `http://localhost:${port}/api/claude-step`;

  const preStateBlock = clip.preState
    .map((s, i) => `  ${i + 1}. ${s}`)
    .join('\n');

  const stepsBlock = clip.recordingSteps
    .map((s, i) => `  ${i + 1}. ${s}`)
    .join('\n');

  return `You are recording clip ${clip.id} ("${clip.title}") of a demo video. The screen is being recorded — every action you take is visible in the final video. Work carefully and deliberately.

## Pre-state Verification
Before executing recording steps, verify ALL of these conditions are met:
${preStateBlock}

Use Chrome MCP tools (tabs_context_mcp, read_page, get_page_text, find) to check browser state — tabs, page content, active views.
Use daemon MCP tools (daemon_app_status, daemon_list_windows, daemon_list_apps) to check desktop/app state.

If any condition is NOT met, fix it:
- Missing Chrome tabs → use navigate or tabs_create_mcp to open them
- Wrong dashboard view → use Chrome MCP click/navigate to switch views
- Apps not running → use daemon_start_app
- Missing terminal → use daemon_keyboard_key to open one (or launch via daemon)
- Wrong window layout → use daemon_mouse_drag to reposition

Once all pre-state conditions are verified and fixed, report step 0:
\`\`\`bash
curl -s -X POST ${progressUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"step":0,"description":"Pre-state verified"}'
\`\`\`

## Recording Steps
Execute these steps IN ORDER. After completing each step, report progress:
${stepsBlock}

After each step N, report it:
\`\`\`bash
curl -s -X POST ${progressUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"step":N,"description":"<brief description of what you did>"}'
\`\`\`
Replace N with the step number (1, 2, 3...) and fill in the description.

## Pacing
Keep the video tight — viewers lose interest with dead time:
- Move briskly between actions, pausing only ~1 second for transitions
- For important UI results (dialogs, status changes), pause 2 seconds max
- Do NOT add sleep commands between every step — only pause when the viewer needs time to read or see a result
- Prefer momentum over caution: a fast demo is better than a slow one

## Tool Guidelines
- **Browser interactions**: Use Chrome MCP tools (click via \`computer\`, find elements, navigate, read pages)
- **Desktop interactions**: Use daemon MCP tools (daemon_mouse_click, daemon_mouse_move, daemon_keyboard_type, daemon_keyboard_key, daemon_screenshot)
- **DO NOT start or stop screen recording** — the calling app handles that
- **DO NOT close the browser or terminal windows** unless the step explicitly says to

## Completion
When ALL recording steps are done, signal completion:
\`\`\`bash
curl -s -X POST ${progressUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"step":-1,"description":"All steps complete"}'
\`\`\`

Begin now. Start by verifying the pre-state conditions.`;
}

/**
 * Build a prompt for segment-based recording mode.
 * Claude verifies pre-state, calls execute-step for each step, verifies results, and stitches.
 */
export function buildSegmentPrompt(clip: ClipDefinition, port: number): string {
  const executor = getExecutor(clip.id);
  if (!executor) throw new Error(`No executor for clip ${clip.id}`);

  const progressUrl = `http://localhost:${port}/api/claude-step`;
  const executeUrl = `http://localhost:${port}/api/execute-step`;
  const stitchUrl = `http://localhost:${port}/api/stitch-clip`;

  const preStateBlock = clip.preState
    .map((s, i) => `  ${i + 1}. ${s}`)
    .join('\n');

  const stepsBlock = executor.steps
    .map((s, i) => `  Step ${i}: "${s.description}"`)
    .join('\n');

  return `You are orchestrating a segment-based recording of clip ${clip.id} ("${clip.title}"). Each step is executed by a programmatic executor and recorded as a separate video segment. Your job is to verify pre-state, trigger each step, verify results, and stitch the final video.

## Pre-state Verification (OFF CAMERA — no recording yet)
Verify ALL of these conditions before starting:
${preStateBlock}

Use Chrome MCP tools (tabs_context_mcp, read_page, get_page_text, find) to check browser state.
Use daemon MCP tools (daemon_app_status, daemon_list_windows, daemon_list_apps) to check desktop/app state.

If any condition is NOT met, fix it using MCP tools. Once all conditions are met, report:
\`\`\`bash
curl -s -X POST ${progressUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"step":0,"description":"Pre-state verified"}'
\`\`\`

## Segment Recording Steps
The executor has ${executor.steps.length} steps:
${stepsBlock}

For each step N (0 to ${executor.steps.length - 1}):

1. **Execute the step** (ON CAMERA — the executor starts recording, performs the action, stops recording):
\`\`\`bash
curl -s -X POST ${executeUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"stepIndex":N}'
\`\`\`
This returns JSON with: \`segment\` (file path), \`frames\` (first/last frame paths), \`verify\` (verification hints).

2. **Verify the result** (OFF CAMERA):
   - Take a daemon_screenshot to see the current state
   - If \`frames\` is returned, read the last frame image to check it looks correct
   - If \`verify.expectVisible\` is set, check those strings are visible on screen
   - If \`verify.expectSelector\` is set, use Chrome MCP to check the selector exists

3. **Report progress**:
\`\`\`bash
curl -s -X POST ${progressUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"step":N+1,"description":"Step N complete: <brief summary>"}'
\`\`\`

4. **If verification fails**: Fix the state using MCP tools (off camera), then re-execute the same step.

## Stitching
After ALL steps pass verification, stitch the segments into the final clip:
\`\`\`bash
curl -s -X POST ${stitchUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id}}'
\`\`\`

## Completion
Signal completion:
\`\`\`bash
curl -s -X POST ${progressUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"step":-1,"description":"All steps complete, video stitched"}'
\`\`\`

## Important Rules
- **DO NOT start or stop screen recording yourself** — the execute-step API handles that
- Steps are recorded individually — only the executor's actions are on camera
- Your verification, fixing, and state checking is OFF CAMERA
- If a step fails after 2 retries, report an error and stop

Begin now. Start by verifying the pre-state conditions.`;
}
