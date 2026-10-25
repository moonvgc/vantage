// Where is RiotClientServices.exe? Pure path plumbing for answering that.
//
// A Riot Client install need not live on the system drive, and assuming C:\Riot Games\Riot Client
// makes such a machine undriveable while the ENOENT it produces reads like a file lock. Two records
// name the real location, both read here: RiotClientInstalls.json (rewritten on every install and
// update; also the source of the patchline) and the `riotclient://` protocol handler in the
// registry, which points at the executable wherever the user put it. The conventional location is a
// last resort; everything here is text work, unit-tested, and the caller probes in order.
import path from 'node:path';

const CLIENT_FILENAME = 'RiotClientServices.exe';

function isClientExecutable(value) {
  return typeof value === 'string' && value.trim().toLowerCase().endsWith(CLIENT_FILENAME.toLowerCase());
}

function unique(list) {
  const seen = new Set();
  const out = [];
  for (const value of list) {
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

// Filtered to the executable we spawn, deduplicated keeping the first spelling. Exported because
// the caller merges candidates from two records that routinely name the same file.
export function uniqueClients(values) {
  return unique((Array.isArray(values) ? values : []).filter(isClientExecutable));
}

// Candidates from RiotClientInstalls.json, most authoritative first: the two entries naming the
// client itself, then the client each installed product is mapped to. Non-RiotClientServices.exe
// values are dropped — `associated_client` can point at some other executable.
export function clientCandidates(installs) {
  if (!installs || typeof installs !== 'object') return [];
  return uniqueClients([
    installs.rc_default,
    installs.rc_live,
    ...Object.values(installs.associated_client ?? {}),
    ...Object.values(installs.patchlines ?? {})
  ]);
}

// The value out of `reg query <key> /ve`, whose output is one line per value:
//     (Default)    REG_SZ    "C:\Riot Games\Riot Client\RiotClientServices.exe" --app-command="%1"
// REG_EXPAND_SZ is accepted too: it would hold the same shape with %VARS% in it.
export function registryCommand(output) {
  const match = /REG_(?:EXPAND_)?SZ\s+(\S.*?)\s*$/m.exec(String(output ?? ''));
  return match ? match[1] : null;
}

// The executable out of that command line. Quoting is convention, not a guarantee, so an unquoted
// one falls back to everything up to the executable's own name. Anything that is not the client is
// refused — a handler pointing elsewhere must not become what this app runs.
export function protocolExecutable(command) {
  const text = String(command ?? '').trim();
  if (!text) return null;
  const quoted = /^"([^"]+)"/.exec(text);
  if (quoted) return isClientExecutable(quoted[1]) ? quoted[1].trim() : null;
  const bare = /^(.+?RiotClientServices\.exe)/i.exec(text);
  return bare ? bare[1].trim() : null;
}

// Last resort: the conventional location on the system drive, reached only when neither record above
// resolved to a file that exists.
export function conventionalClientPath(systemDrive) {
  const drive = String(systemDrive ?? '').trim() || 'C:';
  return path.join(drive, 'Riot Games', 'Riot Client', CLIENT_FILENAME);
}
