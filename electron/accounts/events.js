import { EventEmitter } from 'node:events';

// Account changes that happen in the background, after the IPC call that started them has returned —
// e.g. the user signs in by hand after Riot rejected a saved login. The main process relays them to the
// window ('accounts:changed') and as a notification.
export const accountEvents = new EventEmitter();
