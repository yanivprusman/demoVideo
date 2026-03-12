import net from 'net';

const UDS_PATH = '/run/automatelinux/automatelinux-daemon.sock';

export function sendDaemon(command: string, args: Record<string, string | number | boolean> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ command, ...args }) + '\n';
    const socket = net.createConnection(UDS_PATH);
    let data = '';

    socket.setTimeout(120000);
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('end', () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(data.trim());
      }
    });
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('Daemon connection timeout'));
    });
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
