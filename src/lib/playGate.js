// Whether the PLAY control may be used for one account row, and what it should say.
//
// Rewritten after a real test: the first version refused the press unless the account was ALREADY
// signed in, because a client that is not signed in accepts a launch request and then drops it — true,
// but the wrong conclusion, and it muted the button on every row a manager actually holds. The client
// will not launch while somebody else is signed in, but it will be switched first, which this app
// already does, so PLAY switches and then launches. The gate asks one question, not two: can this
// ENTRY be used at all? An entry pointing at another entry's account, or one whose files could not be
// read, cannot be switched and so cannot be launched either. Everything else can, signed in or not.
import { canLaunch } from './errorPresentation.js';

export function canPlay(account) {
  if (!account) return false;
  return canLaunch(account.errorKind);
}

const GAME_LABELS = { valorant: 'Valorant', lol: 'League of Legends' };

export function playTitle(account, game = 'valorant') {
  const label = account?.label ?? 'this account';
  const name = GAME_LABELS[game] ?? GAME_LABELS.valorant;
  if (!canLaunch(account?.errorKind)) {
    return `PLAY is off for ${label} — its saved login cannot be used to switch`;
  }
  if (account?.active) return `Launch ${name} — ${label} is signed in`;
  return `Launch ${name} with ${label} — switches the Riot Client first`;
}
