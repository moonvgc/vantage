// Adapter over the single settings store (src/lib/settings.js): the showcase reads a
// {soundOn, volume} pair as one object, while the store holds two independent settings.
//
// subscribeAudioPrefs fires on ANY setting change, because it subscribes to the store rather than
// the audio pair. The listener is a setState, so an unrelated change costs one extra render.

import { getSetting, setSetting, subscribeSettings } from './settings.js';

export function getAudioPrefs() {
  return { soundOn: Boolean(getSetting('showcaseSound')), volume: getSetting('showcaseVolume') };
}

export function setAudioPrefs(patch) {
  if ('soundOn' in patch) setSetting('showcaseSound', Boolean(patch.soundOn));
  if ('volume' in patch) setSetting('showcaseVolume', Number(patch.volume));
}

export function subscribeAudioPrefs(listener) {
  return subscribeSettings(() => listener(getAudioPrefs()));
}