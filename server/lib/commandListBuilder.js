// server/lib/commandListBuilder.js
export function buildSkillEntries(supported = []) {
  return supported.map((s) => ({
    name: `/${s.name}`,
    description: s.description || '',
    argumentHint: s.argumentHint || '',
    namespace: 'skill',
    metadata: { type: 'skill' },
  }));
}

export function dedupeByName(entries = []) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    out.push(e);
  }
  return out;
}
