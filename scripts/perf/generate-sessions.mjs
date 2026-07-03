// scripts/perf/generate-sessions.mjs
// Usage: node scripts/perf/generate-sessions.mjs <projectsRoot> <fileCount>
// Generates <fileCount> synthetic session files across 3 project dirs.
// Prints generated session ids (one per line) for ownership seeding.
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const [root = './tmp-perf/projects', count = '1500'] = process.argv.slice(2);
for (let i = 0; i < Number(count); i++) {
  const proj = path.join(root, `-perf-project-${i % 3}`);
  fs.mkdirSync(proj, { recursive: true });
  const sid = crypto.randomUUID();
  const ts = new Date(Date.now() - i * 60_000).toISOString();
  const lines = Array.from({ length: 40 }, (_, j) => JSON.stringify({
    sessionId: sid, timestamp: ts, type: j % 2 ? 'assistant' : 'user',
    cwd: `/perf/project-${i % 3}`,
    message: { role: j % 2 ? 'assistant' : 'user', content: `synthetic message ${j} `.repeat(20) },
  }));
  fs.writeFileSync(path.join(proj, `${sid}.jsonl`), lines.join('\n') + '\n');
  console.log(sid);
}
