// server/services/attachments/markdownTable.js

export function escapeCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br>');
  s = s.replace(/\|/g, '\\|');
  return s.trim();
}

/**
 * rows: array of arrays (cell values). Returns a GFM table string,
 * or '' if there is no non-empty data. First non-empty row is the header.
 */
export function renderMarkdownTable(rows) {
  const nonEmpty = rows.filter(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== '')
  );
  if (nonEmpty.length === 0) return '';

  const width = Math.max(...nonEmpty.map((r) => r.length));
  const norm = nonEmpty.map((r) => {
    const cells = [];
    for (let i = 0; i < width; i++) cells.push(escapeCell(r[i]));
    return cells;
  });

  const header = norm[0].map((c, i) => c || `Col${i + 1}`);
  const sep = header.map(() => '---');
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...norm.slice(1).map((r) => `| ${r.join(' | ')} |`),
  ];
  return lines.join('\n');
}
