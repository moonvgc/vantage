// How an account's saved Riot login is shown. The states come from the main process (getDashboard):
// what the app has SEEN, because Riot encrypts the token and testing it would use it up.
const STATES = {
  active: { label: 'Signed in', short: 'LIVE', tone: 'good', hint: 'Signed in in the Riot Client right now. Its login is saved again every time it changes.' },
  ok: { label: 'Login saved', short: 'OK', tone: 'good', hint: 'A saved Riot login nothing has rejected — switching should sign in by itself.' },
  unknown: { label: 'Not verified yet', short: 'CHECK', tone: 'warn', hint: 'Saved before Vantage tracked Riot logins, so it may already be used up. The next switch shows whether it still works — if not, sign in once and it is fixed for good.' },
  expired: { label: 'Login expired', short: 'EXPIRED', tone: 'bad', hint: 'Riot rejected the saved login. Switch to this account and sign in once in the Riot Client (tick “Stay signed in”) — the app saves it automatically.' },
  missing: { label: 'No saved login', short: 'NO LOGIN', tone: 'bad', hint: 'The saved files hold no Riot login. Switch to it and sign in once with “Stay signed in” ticked.' }
};

export function loginStateInfo(state) {
  return STATES[state] ?? null;
}

export function needsSignIn(state) {
  return state === 'expired' || state === 'missing';
}
