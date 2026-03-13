import { type ClipDefinition } from './clips';

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
This is a demo video — viewers need to see what's happening:
- Wait 1-2 seconds between actions so transitions are visible
- For UI elements that need attention (dialogs, results), pause 3-4 seconds
- After typing text, pause 1 second before the next action
- Use sleep commands between steps: \`sleep 1\`, \`sleep 2\`, etc.

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
