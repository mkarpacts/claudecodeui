export type SessionSummary = {
  session_id: string;
  session_name: string | null;
  username: string | null;
  models: string | null;
  total_input: number;
  total_cache_read: number;
  total_cache_create: number;
  total_context: number;
  total_output: number;
  total_tokens: number;
  total_cost: number;
  turn_count: number;
  first_turn: string;
  last_turn: string;
  first_query_preview: string | null;
};

export type SessionTurn = {
  id: number;
  query_preview: string | null;
  model: string | null;
  input_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  created_at: string;
};

export type UsageTotals = {
  total_tokens: number;
  total_cost: number;
  session_count: number;
};

export type SortColumn = 'total_context' | 'total_output' | 'total_tokens' | 'total_cost' | 'turn_count' | 'first_turn';
export type SortDir = 'asc' | 'desc';

export type PeriodPreset = 'today' | 'last7days' | 'last30days' | 'last90days' | 'allTime' | 'custom';
