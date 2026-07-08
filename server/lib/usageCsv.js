// CSV building for token-usage sessions summary export.
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

const HEADER = ['#', 'session', 'user', 'context_tokens', 'output_tokens', 'total_tokens', 'cost_usd', 'turns'];

export function buildSessionsSummaryCsv(sessions) {
  const lines = sessions.map((s, i) => [
    i + 1,
    csvEscape(s.session_name || s.first_query_text || s.session_id),
    csvEscape(s.username),
    s.total_context,
    s.total_output,
    s.total_tokens,
    s.total_cost,
    s.turn_count,
  ].join(','));

  return '\uFEFF' + [HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}
