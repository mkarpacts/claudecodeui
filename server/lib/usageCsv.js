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

const HEADER = ['#', 'session', 'user', 'date', 'model', 'context_tokens', 'output_tokens', 'total_tokens', 'cost_usd', 'turns'];

// Mirrors getModelShortName in src/components/settings/view/tabs/token-usage/utils.ts
// so the CSV shows the same names as the UI badges.
function modelShortName(model) {
  return model.split('-').find((p) => ['opus', 'sonnet', 'haiku'].includes(p)) || model;
}

// GROUP_CONCAT of distinct full model ids -> deduped short names, ";"-joined
// so multi-model values stay a single unquoted CSV field.
function formatModels(models) {
  if (!models) return '';
  return [...new Set(String(models).split(',').map(modelShortName))].join('; ');
}

export function buildSessionsSummaryCsv(sessions) {
  const lines = sessions.map((s, i) => [
    i + 1,
    csvEscape(s.session_name || s.first_query_text || s.session_id),
    csvEscape(s.username),
    s.first_turn ? String(s.first_turn).slice(0, 10) : '',
    csvEscape(formatModels(s.models)),
    s.total_context,
    s.total_output,
    s.total_tokens,
    s.total_cost,
    s.turn_count,
  ].join(','));

  return '\uFEFF' + [HEADER.join(','), ...lines].join('\r\n') + '\r\n';
}
