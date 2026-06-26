// server/services/attachments/converters/xlsx.js
import * as XLSX from 'xlsx';
import { renderMarkdownTable } from '../markdownTable.js';
import { capMarkdown } from '../truncate.js';
import { XLSX_MAX_ROWS, MAX_MD_CHARS, EMPTY_NOTICE } from '../constants.js';

/**
 * Convert an .xlsx buffer to Markdown: one `##` section per sheet, each a GFM table.
 * `sheetRows` bounds parse memory (decompression-bomb guard); `cellDates` renders
 * dates human-readably instead of as serial numbers.
 */
export function convertXlsxToMarkdown(buffer) {
  const wb = XLSX.read(buffer, {
    sheetRows: XLSX_MAX_ROWS,
    dense: true,
    cellDates: true,
  });

  let out = '';
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    const table = renderMarkdownTable(rows) || '_(empty sheet)_';
    out += `## ${sheetName}\n\n${table}\n\n`;
    if (out.length >= MAX_MD_CHARS) break;
  }

  out = out.trim();
  if (!out) return EMPTY_NOTICE;
  return capMarkdown(out);
}
