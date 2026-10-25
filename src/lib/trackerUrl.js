// tracker.gg profile links, built from an editable template where {name} and {tag} stand for the two
// halves of a Riot ID.

export function trackerUrl(template, riotId) {
  const [name, tag] = String(riotId ?? '').split('#');
  if (!name || !tag || !template) return null;
  return template.replaceAll('{name}', encodeURIComponent(name)).replaceAll('{tag}', encodeURIComponent(tag));
}
