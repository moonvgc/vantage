# Vantage

A desktop account manager for Riot Games accounts (Valorant and League of Legends). Keep several accounts in one place, switch between them in one click, and see each account's store, locker and stats without logging in to the game.

## Features

- **Quick switching** - save the Riot Client session of each account and switch to it, then launch Valorant or League with the PLAY button.
- **Daily store** - the four daily offers, Night Market and featured bundles for every saved account, with skin video previews.
- **Locker** - equipped loadout, owned skins and unlocked agents.
- **Stats** - rank, peak rank, win rate, K/D, headshot rate, ACS, ADR, agent and map breakdowns and match history, computed from Riot's match history. A tracker.gg profile view is built in as a second source.
- **Account overview** - level, rank, RR, wallet (VP, Radianite, Kingdom Credits) and login state at a glance.
- **TCNO import** - import accounts already saved in TCNO Account Switcher.
- **Tray and notifications** - runs in the background and can notify you when the daily store rotates.
- **Update check** - tells you when a newer release is available and installs it.

## Download and install

1. Open the [Releases](../../releases) page and download `Vantage Setup <version>.exe`.
2. Run it and follow the setup. It creates a desktop shortcut and a Start menu entry, and can be removed like any other app under Settings > Apps.
3. Prefer no installation? Download `Vantage <version>.exe` instead; it is portable and runs directly.

The app is not code-signed, so Windows SmartScreen may show "Windows protected your PC" on first launch. Click **More info**, then **Run anyway**.

Requirements: Windows 10 or 11 (64-bit) and the Riot Client installed.

## Adding an account

1. Log in to the Riot Client with the account (tick "Stay signed in").
2. In Vantage, use **Add account** to capture the current session.
3. Repeat for every account. Switching later restores the saved session, so you do not have to type the password again.

Saved sessions stay on your PC. Vantage does not store or send your passwords.

## Building from source

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm run dev
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the app with hot reload |
| `npm test` | Runs the test suite |
| `npm run lint` | Lints the code |
| `npm run verify` | Runs every check, the tests and a build |
| `npm run package:win` | Builds the installer and portable exe into `release/` |

### Project layout

- `electron/` - main process: account storage, Riot Client switching, Riot API calls, updates
- `src/` - the React interface
- `scripts/` - development checks and the icon generator
- `build/` - app icon

## Disclaimer

Vantage is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.
