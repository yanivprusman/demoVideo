import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

/**
 * Read display session env vars from a GNOME session process.
 * gnome-shell itself lacks DISPLAY/WAYLAND_DISPLAY (it creates them),
 * so we read from gsd-xsettings which inherits the full session env.
 */
export function getSessionEnv(user: string): Record<string, string> {
  const needed = ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'];
  const candidates = ['gsd-xsettings', 'gsd-color', 'gsd-power', 'gnome-shell'];

  for (const proc of candidates) {
    try {
      const pid = execFileSync('pgrep', ['-u', user, '-x', proc], {
        encoding: 'utf8',
        timeout: 3000,
      }).trim().split('\n')[0];

      const raw = readFileSync(`/proc/${pid}/environ`, 'utf8');
      const result: Record<string, string> = {};

      for (const entry of raw.split('\0')) {
        const eq = entry.indexOf('=');
        if (eq > 0) {
          const key = entry.substring(0, eq);
          if (needed.includes(key)) result[key] = entry.substring(eq + 1);
        }
      }

      if (result.DISPLAY || result.WAYLAND_DISPLAY) return result;
    } catch { /* try next candidate */ }
  }

  return { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1000' };
}
