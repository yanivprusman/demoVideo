export interface ClipDefinition {
  id: number;
  title: string;
  features: string[];
  preState: string[];
  recordingSteps: string[];
  postState: string[];
  enabled: boolean;
  outputPath?: string;
  timeoutMs?: number;
  /** Playback speed multiplier for post-processing (default: 6). Set to 1 to skip. */
  speedUp?: number;
}

const DATA_DIR = '/opt/automateLinux/data/demoVideo';

export const clips: ClipDefinition[] = [
  {
    id: 1,
    title: "Create New Apps",
    features: ["New App dialog", "9-step scaffolding", "Auto port allocation"],
    preState: [
      "Dashboard open and maximized on DP-1",
      "Dashboard showing Apps view (nav-apps)",
      "No apps named taskManager or weatherApp exist",
      "Right monitor (HDMI-1) is clear/unused",
    ],
    recordingSteps: [
      "Click 'New App' — fill name: taskManager, description: Task management application — click 'Create'",
      "Wait for all 9 steps to complete (scaffold, git, GitHub, ports, worktree, systemd, deps, build, start)",
      "Navigate back to Apps view, click 'New App' again",
      "Fill name: weatherApp, description: Weather dashboard application — click 'Create' — wait for completion",
      "Show Apps view with both new apps listed",
    ],
    postState: [
      "taskManager and weatherApp apps exist and are running",
      "Dashboard showing Apps view with both apps visible",
      "Two create-app tabs may still be open",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip1-create-new-apps.mp4`,
    timeoutMs: 600000, // 10 min — scaffolding is slow
  },
  {
    id: 2,
    title: "Create Issues",
    features: ["Issue creation", "Multi-app issues", "Label assignment"],
    preState: [
      "taskManager and weatherApp apps exist (from Clip 1)",
      "Dashboard open on left monitor",
      "Both apps have 0 issues",
    ],
    recordingSteps: [
      "Navigate to Issues view (nav-issues)",
      "Find taskManager card — click '+ New' — create 3 issues: 'Login form validation missing for email field' (bug), 'Add dark mode toggle to settings page' (feature), 'API rate limiting not enforced on public endpoints' (bug, not-urgent)",
      "Find weatherApp card — click '+ New' — create 3 issues: 'Temperature display shows Kelvin instead of Celsius' (bug), 'Search results pagination broken on page 2' (bug), 'Add 5-day forecast widget to homepage' (feature)",
      "Show Issues view with both apps' issues and sidebar badge counts",
    ],
    postState: [
      "taskManager has 3 open issues (#1, #2, #3)",
      "weatherApp has 3 open issues (#1, #2, #3)",
      "Dashboard showing Issues view with both apps' issues visible",
      "Sidebar shows total open count badge",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip2-create-issues.mp4`,
  },
  {
    id: 3,
    title: "Issue Detail & Context Menu",
    features: ["Detail panel", "Action buttons", "Context menu", "Note conversion"],
    preState: [
      "Both apps have issues (from Clip 2)",
      "Dashboard showing Issues view",
    ],
    recordingSteps: [
      "Click taskManager issue #1 title — detail panel opens showing number, status, description, labels, timestamps — pause 2s then close (Escape)",
      "Hover issue #2 — show action buttons — click edit, change description, save — then click copy",
      "Right-click issue #3 — context menu shows options — click 'Convert to note' (sticky-note icon appears)",
      "Right-click again — 'Convert from note' to revert — then 'Toggle urgent' to toggle not-urgent label",
    ],
    postState: [
      "Issue #2 has slightly updated description",
      "Issue #3 may have toggled labels",
      "Dashboard showing Issues view, detail panel closed",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip3-issue-detail-context-menu.mp4`,
  },
  {
    id: 4,
    title: "Issue Lifecycle & Labels",
    features: ["Status transitions", "Terminal + Dashboard", "Label management"],
    preState: [
      "Both apps have issues (from Clips 2-3)",
      "Dashboard showing Issues view on left monitor",
      "Terminal open on right monitor (HDMI-1)",
    ],
    recordingSteps: [
      "Terminal: d listIssues --app taskManager — show issue list",
      "d updateIssue --app taskManager --issueNumber 1 --status in_progress — dashboard turns purple",
      "d updateIssue --app taskManager --issueNumber 1 --status review — dashboard turns blue with eye icon",
      "d closeIssue --app taskManager --issueNumber 1 --insights 'Fixed email validation with regex' — strikethrough + faded",
      "d reopenIssue --app taskManager --issueNumber 1 — returns to open, then d closeIssue again",
      "Right-click closed issue #1 — 'Fix regression with Claude' — shows regression state (red)",
      "Show sidebar badges updating with lifecycle colors",
    ],
    postState: [
      "taskManager issue #1: closed (or regression)",
      "Issues #2, #3: still open",
      "weatherApp issues: unchanged (all open)",
      "Dashboard + terminal both visible",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip4-issue-lifecycle-labels.mp4`,
  },
  {
    id: 5,
    title: "Fix with Claude — Dialog",
    features: ["Fix with Claude dialog", "Plan/Team/Tmux modes", "Scheduling", "Command preview"],
    preState: [
      "Both apps have issues with various states (from Clip 4)",
      "Dashboard showing Issues view",
    ],
    recordingSteps: [
      "Select taskManager issue #2 — click 'Fix with Claude' — show auto-generated prompt — pause 2s — cancel",
      "Select BOTH issues #2 and #3 — click 'Fix 2 with Claude' — show multi-issue prompt",
      "Toggle Plan Mode, Team Mode, and Tmux ON — all 3 toggles lit",
      "Cycle through schedule options: 'After delay' → 'At time' → back to 'Now'",
      "Expand 'Command preview' — show full bash command — click copy — cancel dialog",
    ],
    postState: [
      "No issues launched — dialog was cancelled",
      "Dashboard showing Issues view, no state changes",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip5-fix-with-claude-dialog.mp4`,
  },
  {
    id: 6,
    title: "Launch Claude & Session Tracking",
    features: ["Claude launch", "Tmux integration", "Session tracking", "Hook events"],
    preState: [
      "taskManager issue #2 ('Add dark mode toggle') is open",
      "Dashboard on left, terminal on right",
      "No active Claude sessions (clean slate preferred)",
    ],
    recordingSteps: [
      "Select taskManager issue #2 — click 'Fix with Claude' — enable Tmux — click 'Launch'",
      "Dashboard: Issue #2 turns purple — terminal shows Claude session launching in tmux",
      "Let Claude work briefly, then navigate to Claude sessions tab (nav-claude)",
      "Show active session card with title, elapsed timer, hook events streaming in with colors",
      "Switch back to Issues view — show issue #2 still purple (or review if Claude finished)",
    ],
    postState: [
      "taskManager issue #2: in_progress or review",
      "Active or recently completed Claude session exists",
      "Session ID linked to issue #2",
      "Terminal on right shows Claude session",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip6-launch-claude-session-tracking.mp4`,
    timeoutMs: 600000,
  },
  {
    id: 7,
    title: "Claude Sessions Tab Deep Dive",
    features: ["Session cards", "Hook event colors", "Title editing", "Reorder"],
    preState: [
      "At least one Claude session exists (from Clip 6)",
      "Dashboard on left monitor",
    ],
    recordingSteps: [
      "Navigate to Claude tab (nav-claude) — show session list",
      "Click to edit session title — type new name — save",
      "Expand hook events panel — show color-coded events (yellow/green/red/blue/purple)",
      "Show associated issue badge and sidebar Claude badge with hook count",
    ],
    postState: [
      "Dashboard showing Claude sessions tab",
      "Session title may have been renamed",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip7-claude-sessions-deep-dive.mp4`,
  },
  {
    id: 8,
    title: "Session Resume & History",
    features: ["Resume sessions", "Session picker", "Session lineage"],
    preState: [
      "Issue #2 has at least one completed session (from Clip 6)",
      "Dashboard showing Issues view or Claude tab",
    ],
    recordingSteps: [
      "Navigate to Issues view — find taskManager issue #2 — show 'Resume' button",
      "Left-click Resume — terminal opens with claude -r, Claude resumes with previous context",
      "Let it run briefly — stop/exit the resumed session",
      "Right-click Resume — show session picker menu with multiple session IDs",
    ],
    postState: [
      "Issue #2 has 2+ session IDs",
      "Additional Claude session created (now closed)",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip8-session-resume-history.mp4`,
  },
  {
    id: 9,
    title: "Scheduled Launches",
    features: ["Delayed scheduling", "Countdown timer", "Auto-launch"],
    preState: [
      "weatherApp has open issues (from Clip 2)",
      "Dashboard showing Issues view",
    ],
    recordingSteps: [
      "Select weatherApp issue #1 — click 'Fix with Claude' — set 'After delay' to 1 minute — click 'Schedule'",
      "Show issue with orange background + clock icon + countdown timer ticking",
      "Wait for countdown to reach zero — session auto-launches, issue turns purple",
      "Cancel/stop the session after brief demo",
    ],
    postState: [
      "weatherApp issue #1: in_progress",
      "New Claude session active",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip9-scheduled-launches.mp4`,
    timeoutMs: 600000,
  },
  {
    id: 10,
    title: "Hooks System",
    features: ["Hook events", "Auto-approval", "Permission prompts", "Notifications"],
    preState: [
      "Active Claude session exists (from Clip 9 or new)",
      "Dashboard on left showing Claude tab or Issues view",
    ],
    recordingSteps: [
      "Show active session's hook events streaming: SessionStart (blue), PreToolUse (yellow), PostToolUse (green)",
      "Show safe-bash-commands.sh auto-approving a safe command, then a permission prompt for an unsafe one",
      "Show NotificationRequest triggering attention counter and sidebar badges updating",
    ],
    postState: [
      "Dashboard showing hook events",
      "Session still active or completed",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip10-hooks-system.mp4`,
  },
  {
    id: 11,
    title: "MCP Server & Daemon Tools",
    features: ["MCP tools", "Daemon commands", "Screenshot", "Input simulation"],
    preState: [
      "Terminal open on right monitor",
      "Dashboard on left (any view)",
    ],
    recordingSteps: [
      "Terminal: Claude uses daemon_screenshot, daemon_list_ports, daemon_app_status in quick succession",
      "Claude uses daemon_mouse_click to click something on screen",
      "Claude uses daemon_send_command — show daemon responding via UDS socket",
    ],
    postState: [
      "Terminal showing Claude with MCP tool output",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip11-mcp-daemon-tools.mp4`,
  },
  {
    id: 12,
    title: "Desktop Automation",
    features: ["Mouse control", "Keyboard control", "Drag & drop", "Multi-monitor"],
    preState: [
      "Dashboard on left, terminal on right",
      "Desktop visible (some windows may need to be minimized)",
    ],
    recordingSteps: [
      "daemon_screenshot — show dual-monitor composite with cursor overlay",
      "daemon_mouse_move + daemon_mouse_click — move cursor and click a UI element",
      "daemon_keyboard_type — type text into focused field, then daemon_keyboard_key for Enter",
      "daemon_mouse_drag — drag a window across screen",
    ],
    postState: [
      "Desktop may have rearranged windows",
      "Demonstration of each automation capability shown",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip12-desktop-automation.mp4`,
  },
  {
    id: 13,
    title: "Multi-Peer Network",
    features: ["Peer cards", "Remote execution", "Auto-forwarding"],
    preState: [
      "Dashboard on left, terminal on right",
      "Peers tab accessible",
    ],
    recordingSteps: [
      "Click 'Peers' in sidebar (nav-peers) — show peer cards with status, IPs, daemon versions",
      "Terminal: d listPeers — then d getPeerInfo --peer leader",
      "d execOnPeer --peer leader --directory /opt/automateLinux --shellCmd 'uptime' — show remote result",
      "d execOnPeer --peer leader --directory /opt/automateLinux --shellCmd 'd listPorts' — daemon command on remote peer",
    ],
    postState: [
      "Dashboard showing Peers tab",
      "Terminal showing peer command outputs",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip13-multi-peer-network.mp4`,
  },
  {
    id: 14,
    title: "GNOME Clock Extension",
    features: ["Clock widget", "Session count", "Context menu", "Drag position"],
    preState: [
      "At least one Claude session active or recent",
      "Desktop visible",
      "Clock extension running",
    ],
    recordingSteps: [
      "Show desktop clock widget at top-left with session count — move mouse to highlight",
      "Right-click clock — context menu shows active Claude sessions — click one to activate its terminal",
      "Drag clock to new position — show it persists (saved to daemon clockX/clockY)",
      "Show attention counter updating when session has Stop/Notification events",
    ],
    postState: [
      "Clock may have moved to new position",
      "Terminal window activated from session click",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip14-gnome-clock-extension.mp4`,
  },
  {
    id: 15,
    title: "Permission System & Auto-Approval",
    features: ["Safe command whitelist", "Shell operator blocking", "Permission prompts"],
    preState: [
      "Claude Code session running in terminal (right monitor)",
      "Dashboard on left (any view)",
    ],
    recordingSteps: [
      "Claude runs ls and git status — both auto-approved (whitelist + safe-bash-commands.sh)",
      "Claude runs a command with shell operators — blocked; then $() command — permission prompt shown",
      "Show testClaudePermissions function output summarizing the permission system",
      "Show git commit using git commit -F - <<'EOF' pattern (no $() wrapper needed)",
    ],
    postState: [
      "Terminal showing permission examples",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip15-permission-system.mp4`,
  },
  {
    id: 16,
    title: "Git Sync & Issue Storage",
    features: ["JSON file storage", "Auto git commits", "CRUD tracking"],
    preState: [
      "Issues exist in taskManager and weatherApp (from previous clips)",
      "Terminal on right, dashboard on left",
    ],
    recordingSteps: [
      "Terminal: ls /opt/issues/taskManager/ — then cat one JSON file to show issue data structure",
      "d createIssue --app taskManager --title 'Test git sync' — show auto-commit in git log",
      "d updateIssue --app taskManager --issueNumber 4 --status in_progress — show status change commit",
      "d deleteIssue --app taskManager --issueNumber 4 — show deletion commit in git log",
    ],
    postState: [
      "Test issue #4 deleted",
      "Git log shows create/update/delete commits",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip16-git-sync-issue-storage.mp4`,
  },
  {
    id: 17,
    title: "App Lifecycle Management",
    features: ["Start/stop/restart", "Port registry", "Version tracking"],
    preState: [
      "taskManager and weatherApp running (from Clip 1)",
      "Terminal on right, dashboard on left showing Apps view",
    ],
    recordingSteps: [
      "Terminal: d listApps — then d appStatus --app taskManager and d listPorts",
      "d stopApp --app taskManager — dashboard reflects stopped state — then d startApp to restart",
      "d getAppPeers --app taskManager — show per-peer version info and port allocation",
    ],
    postState: [
      "taskManager running",
      "Dashboard Apps view showing all app statuses",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip17-app-lifecycle.mp4`,
  },
  {
    id: 18,
    title: "Skills System Overview",
    features: ["/fix-issues-skill", "/close-issue-skill", "Commit format", "Issue lifecycle"],
    preState: [
      "Issues exist, terminal on right, dashboard on left",
    ],
    recordingSteps: [
      "Show /fix-issues-skill invoked — gathers open issues, marks in_progress, Claude implements fix",
      "Claude commits with '#N: title' format, pushes — skill marks issue as review with insights",
      "Show /close-issue-skill closing an issue — resume button appears after close",
    ],
    postState: [
      "One issue moved to review via skill workflow",
      "Commit pushed with issue reference",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip18-skills-system.mp4`,
    timeoutMs: 600000,
  },
  {
    id: 19,
    title: "Terminal Wrapper & Helpers",
    features: ["claude wrapper", "Session ID", "Resume helpers", "Settings sync"],
    preState: [
      "Terminal on right monitor",
      "No special state needed",
    ],
    recordingSteps: [
      "Terminal: type claude — show it's a wrapper function with UUID generation and session registration",
      "Run claude briefly — show session ID and terminal title set — then exit",
      "Show helper functions: claudeCatResume (resume sessions), claudePlan (browse plans), claudeLimitReset",
    ],
    postState: [
      "Terminal showing helper function outputs",
    ],
    enabled: true,
    outputPath: `${DATA_DIR}/clip19-terminal-wrapper-helpers.mp4`,
  },
  {
    id: 20,
    title: "Final Merge",
    features: ["FFmpeg merge", "All 19 clips", "Final output"],
    preState: [
      "All 19 clip videos recorded",
    ],
    recordingSteps: [
      "Concatenate all 19 clips into single video with ffmpeg",
    ],
    postState: [
      "Final merged video file",
    ],
    enabled: false, // Not Claude-orchestrated — handled separately
    outputPath: `${DATA_DIR}/demo-video-final.mp4`,
  },
];

export function getClip(id: number): ClipDefinition | undefined {
  return clips.find(c => c.id === id);
}
