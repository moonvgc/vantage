import https from 'node:https';
import { readLockfile } from './lockfile.js';

const localAgent = new https.Agent({ rejectUnauthorized: false });

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) throw new Error('missing payload');
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Riot Client returned an invalid access token. Please sign in again.');
  }
}

function parseAccountName(userInfoResponse) {
  try {
    const userInfo = typeof userInfoResponse?.userInfo === 'string'
      ? JSON.parse(userInfoResponse.userInfo)
      : userInfoResponse?.userInfo;
    const gameName = userInfo?.acct?.game_name;
    const tagLine = userInfo?.acct?.tag_line;
    if (gameName && tagLine) return `${gameName}#${tagLine}`;
    return userInfo?.preferred_username ?? userInfo?.username ?? null;
  } catch {
    return null;
  }
}

// Node's built-in fetch does not accept https.Agent; this helper disables certificate verification for localhost only.
function localJson(url, headers) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers, agent: localAgent }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Riot Client token request failed (${response.statusCode}). Please sign in again.`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Riot Client returned invalid token data.')); }
      });
    }).on('error', (error) => reject(new Error(`Could not reach the Riot Client: ${error.message}`)));
  });
}

export async function getSessionTokens() {
  const lockfile = await readLockfile();
  const authorization = Buffer.from(`riot:${lockfile.password}`).toString('base64');
  const headers = { Authorization: `Basic ${authorization}` };
  const baseUrl = `https://127.0.0.1:${lockfile.port}`;
  const [payload, identity, userInfoResponse] = await Promise.all([
    localJson(`${baseUrl}/entitlements/v1/token`, headers),
    localJson(`${baseUrl}/rso-auth/v1/authorization/id-token`, headers),
    localJson(`${baseUrl}/rso-auth/v1/authorization/userinfo`, headers)
  ]);
  const accessToken = payload.accessToken ?? payload.access_token;
  const entitlementsToken = payload.token ?? payload.entitlements_token;
  const idToken = identity?.token ?? identity?.idToken ?? identity?.id_token;
  if (!accessToken || !entitlementsToken) throw new Error('Riot Client did not return both required session tokens.');
  if (!idToken) throw new Error('Riot Client did not return an identity token. Please sign in again.');
  const claims = decodeJwtPayload(accessToken);
  if (!claims.sub) throw new Error('The access token does not contain an account PUUID.');
  return { accessToken, entitlementsToken, idToken, puuid: claims.sub, accountName: parseAccountName(userInfoResponse) };
}

export async function resolveShard({ accessToken, idToken }) {
  const response = await fetch('https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ id_token: idToken })
  });
  if (!response.ok) throw new Error(`Could not determine the Valorant shard (${response.status}).`);
  const data = await response.json();
  const shard = data?.affinities?.live ?? data?.affinities?.valorant ?? data?.affinity;
  if (!shard || typeof shard !== 'string') throw new Error('Riot did not return a usable Valorant shard.');
  return shard;
}
