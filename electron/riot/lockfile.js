import { promises as fs } from 'node:fs';
import path from 'node:path';

const lockfilePath = process.platform === 'win32'
  ? path.join(process.env.LOCALAPPDATA ?? '', 'Riot Games', 'Riot Client', 'Config', 'lockfile')
  : path.join(process.env.HOME ?? '', 'Library', 'Application Support', 'Riot Games', 'Riot Client', 'Config', 'lockfile');

class RiotClientNotRunningError extends Error {
  constructor(message = 'Riot Client is not running or its lockfile is unavailable.') {
    super(message);
    this.name = 'RiotClientNotRunningError';
  }
}

export async function readLockfile() {
  let raw;
  try {
    raw = await fs.readFile(lockfilePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new RiotClientNotRunningError();
    throw new Error(`Unable to read the Riot Client lockfile: ${error.message}`, { cause: error });
  }

  const [name, pid, portText, password, protocol] = raw.trim().split(':');
  const port = Number(portText);
  if (!name || !Number.isInteger(port) || !password || !['http', 'https'].includes(protocol)) {
    throw new RiotClientNotRunningError('The Riot Client lockfile has an unexpected format. Restart the Riot Client and try again.');
  }

  return { name, pid: Number(pid), port, password, protocol, path: lockfilePath };
}

export { lockfilePath };
