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

  return `You are an orchestrator for segment-based video recording. You do NOT perform the recording steps yourself. Instead, you call an API that executes pre-programmed actions and records them.

## CRITICAL: How This Works
A programmatic executor handles ALL on-screen actions (clicking, typing, navigating). The screen is ONLY recorded during executor calls. Your role is:
1. Verify pre-conditions are met (using MCP tools)
2. Call the execute-step API via curl for each step (this is what gets recorded)
3. Verify results after each step
4. Call the stitch API to combine segments
5. Signal completion

**DO NOT use Chrome MCP tools (computer, click, navigate) to perform the recording steps.** Only use MCP tools for pre-state verification and post-step verification. The executor handles all on-screen interactions.

## Step 1: Pre-state Verification
Verify ALL of these conditions are met:
${preStateBlock}

Use MCP tools to check:
- Chrome MCP: tabs_context_mcp, read_page, get_page_text, find
- Daemon MCP: daemon_app_status, daemon_list_windows, daemon_list_apps

If any condition is NOT met, fix it using MCP tools. Then report:
\`\`\`bash
curl -s -X POST ${progressUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"step":0,"description":"Pre-state verified"}'
\`\`\`

## Step 2: Execute Each Recording Step
The executor has ${executor.steps.length} steps:
${stepsBlock}

For each step N (0, 1, 2, ... ${executor.steps.length - 1}), run this curl command. Replace N with the actual step number:
\`\`\`bash
curl -s -X POST ${executeUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"stepIndex":N}'
\`\`\`

The API will: start recording → execute the programmatic action → stop recording → extract frames → return JSON result.

After each step, verify the result:
- Check the returned JSON for errors
- If \`frames.last\` is returned, read that image file to verify visually
- Take a daemon_screenshot if needed

Then report progress:
\`\`\`bash
curl -s -X POST ${progressUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"step":N+1,"description":"Step N complete"}'
\`\`\`

If a step fails, fix the state using MCP tools, then re-run the same execute-step curl command.

## Step 3: Stitch Segments
After ALL ${executor.steps.length} steps pass:
\`\`\`bash
curl -s -X POST ${stitchUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id}}'
\`\`\`

## Step 4: Signal Completion
\`\`\`bash
curl -s -X POST ${progressUrl} -H 'Content-Type: application/json' -d '{"clipId":${clip.id},"step":-1,"description":"All steps complete, video stitched"}'
\`\`\`

Begin now. Start with pre-state verification.`;
}
