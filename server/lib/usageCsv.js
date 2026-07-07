// CSV building for token-usage session export.
// BOM so Excel detects UTF-8. Deliberately NO "sep=" hint line: when a file
// starts with one, Excel ignores the BOM and decodes as ANSI, garbling
// diacritics (reproduced via COM automation on Excel 16.0).

export function csvEscape(value) {
  if (value == null) return '';
  let str = String(value);
  // Excel formula-injection guard: neutralize leading =, +, -, @, tab, CR
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const HEADER = ['#', 'time', 'query', 'model', 'input_tokens', 'cache_read_tokens', 'cache_creation_tokens', 'output_tokens', 'total_tokens', 'cost_usd'];

export function buildSessionTurnsCsv(turns) {
  const lines = turns.map((turn, i) => [
    i + 1,
    csvEscape(turn.created_at),
    csvEscape(turn.query_text),
    csvEscape(turn.model),
    turn.input_tokens,
    turn.cache_read_tokens,
    turn.cache_creation_tokens,
    turn.output_tokens,
    turn.total_tokens,
    turn.cost_usd,
  ].join(','));

  return '\uFEFF' + [HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}
