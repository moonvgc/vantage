// Skin tier colour, for the renderer to use.
//
// Riot sends the colour as hex, but the border, glow and wash are all rgba() of the SAME colour —
// so one hex per tier is derived here, rather than five ready-made rgba strings from the main
// process.
export function tierRgb(color) {
  const hex = String(color ?? '').trim().replace(/^#/, '');
  // Deliberately SIX digits only: eight digits is Riot's raw form (RRGGBBAA, alpha 33), and accepting
  // it silently paints a 20% transparent colour — it reads as a faded tier, not as an error; null makes
  // it visible.
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const byte = (offset) => parseInt(hex.slice(offset, offset + 2), 16);
  return `${byte(0)}, ${byte(2)}, ${byte(4)}`;
}
