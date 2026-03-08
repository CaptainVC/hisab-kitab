import os from 'node:os';

export function getTailscaleIPv4(): string | null {
  const ifaces = os.networkInterfaces();
  const ts = ifaces['tailscale0'];
  if (!ts) return null;
  for (const addr of ts) {
    if (addr.family === 'IPv4' && !addr.internal) return addr.address;
  }
  return null;
}
