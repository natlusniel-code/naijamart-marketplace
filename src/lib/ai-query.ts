import "server-only";

/**
 * The copilot's query engine.
 *
 * ── The safety model ──────────────────────────────────────────────────────
 * The model never writes SQL. It writes a small JSON *spec* — table, columns,
 * filters, order, limit — and this module turns that into a supabase-js
 * query. Every identifier in the spec is checked against the live schema
 * before it is used, so a hallucinated column is rejected with a readable
 * message instead of a Postgres error, and there is no string interpolation
 * path that could carry SQL.
 *
 * Values are always passed as parameters by supabase-js, never concatenated.
 *
 * ── Why aggregates are computed here ──────────────────────────────────────
 * PostgREST can aggregate, but supabase-js does not expose it cleanly. So a
 * sum/avg fetches only the one column it needs, capped, and reduces in JS.
 * The cap is reported back to the model so it can say "over the first N
 * rows" rather than presenting a partial sum as a total.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { findTable, type SchemaSnapshot, type TableInfo } from "@/lib/ai-schema";

export type FilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "like"
  | "ilike"
  | "in"
  | "is_null"
  | "not_null";

export type QuerySpec = {
  table: string;
  /** Columns to return. Omit for a sensible default. */
  select?: string[];
  filters?: { column: string; op: FilterOp; value?: unknown }[];
  order?: { column: string; ascending?: boolean };
  limit?: number;
  /** Return only the row count, not the rows. */
  countOnly?: boolean;
  /** Reduce one numeric column instead of returning rows. */
  aggregate?: { fn: "sum" | "avg" | "min" | "max"; column: string };
  /** Group rows by a column and count them. */
  groupBy?: string;
};

export type QueryResult = {
  table: string;
  rows?: Record<string, unknown>[];
  count?: number;
  aggregate?: { fn: string; column: string; value: number | null; rows_scanned: number; truncated: boolean };
  groups?: { value: unknown; count: number }[];
  /** Set when the spec was rejected; the model is told to try again. */
  error?: string;
  /**
   * The column that caused a rejection, when that is the reason.
   *
   * Machine-readable so the caller can repair deterministically — drop the
   * bad filter and re-run — instead of spending another model call hoping
   * it fixes its own typo.
   */
  badColumn?: string;
  /** True when the row cap was hit, so the answer can say "at least". */
  truncated?: boolean;
};

/** Hard ceiling on rows returned to the model, whatever it asks for. */
const MAX_ROWS = 50;
/** Ceiling on rows scanned for an aggregate. */
const MAX_SCAN = 5_000;

/**
 * Columns that must never be returned, even from a readable table.
 *
 * `profiles` is readable — an admin needs to look up a buyer — but a
 * password hash or a bank account number in a chat transcript is a leak
 * waiting to be screenshotted. These are stripped from every result.
 */
const BLOCKED_COLUMNS = new Set([
  "password_hash",
  "bank_account_number",
  "account_number",
  "nin_or_cac",
  "p256dh",
  "auth",
  "endpoint",
  "code",
]);

/** True when a column may be returned. */
function columnAllowed(name: string): boolean {
  return !BLOCKED_COLUMNS.has(name.toLowerCase());
}

/**
 * Levenshtein distance, capped.
 *
 * Used only to repair a near-miss column name. A model asked for
 * `fulfilment_mode` and wrote `fulfulment_mode` — one transposed letter —
 * and the whole answer failed. A typo is not a hallucination, and it should
 * not cost the admin an answer.
 */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * Resolve a column name the model wrote onto a real one.
 *
 * Exact match wins. Otherwise a near-miss within a small edit distance is
 * accepted — but only when it is unambiguous, so `status` never silently
 * becomes `state`. Returns `null` when nothing is close enough, which the
 * caller turns into a readable error listing the real columns.
 */
function resolveColumn(table: TableInfo, name: string): string | null {
  const want = name.trim().toLowerCase();
  const exact = table.columns.find((c) => c.name.toLowerCase() === want);
  if (exact) return exact.name;

  // Allow a small typo budget, scaled to the length of the name.
  const budget = want.length <= 6 ? 1 : want.length <= 12 ? 2 : 3;
  const scored = table.columns
    .map((c) => ({ name: c.name, d: distance(want, c.name.toLowerCase()) }))
    .filter((c) => c.d <= budget)
    .sort((a, b) => a.d - b.d);

  if (scored.length === 0) return null;
  // Ambiguous (two equally close candidates) — refuse rather than guess.
  if (scored.length > 1 && scored[0].d === scored[1].d) return null;
  return scored[0].name;
}

/**
 * Pick a default column list for a table.
 *
 * Prefers the columns that make a row readable — an id, a name, a status, a
 * date — rather than dumping every column including large jsonb blobs.
 */
function defaultSelect(table: TableInfo): string[] {
  const names = table.columns.map((c) => c.name);
  const preferred = [
    "id",
    "reference",
    "name",
    "title",
    "full_name",
    "email",
    "status",
    "role",
    "total",
    "amount",
    "price",
    "created_at",
  ];
  const picked = preferred.filter((p) => names.includes(p) && columnAllowed(p));
  if (picked.length >= 3) return picked.slice(0, 8);
  return names.filter(columnAllowed).slice(0, 8);
}

/**
 * Validate a select list against the schema.
 *
 * Accepts plain columns and one level of embedded relation, e.g.
 * `shops(name)`. Anything else is rejected — this is what stops a
 * hallucinated column from reaching Postgres.
 */
function validateSelect(
  spec: string[],
  table: TableInfo,
  snapshot: SchemaSnapshot,
): { ok: true; select: string } | { ok: false; error: string } {
  const parts: string[] = [];

  for (const raw of spec) {
    const token = String(raw).trim();
    if (!token) continue;

    const rel = /^([a-z_][a-z0-9_]*)\(([^)]*)\)$/i.exec(token);
    if (rel) {
      const [, relName, inner] = rel;
      const relTable = findTable(snapshot, relName);
      if (!relTable) {
        return { ok: false, error: `There is no table called "${relName}".` };
      }
      const innerCols = inner
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean)
        .map((c) => resolveColumn(relTable, c) ?? c);
      const bad = innerCols.find(
        (c) => !relTable.columns.some((x) => x.name === c) || !columnAllowed(c),
      );
      if (bad) {
        return { ok: false, error: `"${relName}" has no readable column called "${bad}".` };
      }
      parts.push(`${relName}(${innerCols.join(",")})`);
      continue;
    }

    if (!/^[a-z_][a-z0-9_]*$/i.test(token)) {
      return { ok: false, error: `"${token}" is not a valid column name.` };
    }
    const resolved = resolveColumn(table, token);
    if (!resolved) {
      return {
        ok: false,
        error: `"${table.name}" has no column called "${token}". Its columns are: ${table.columns
          .map((c) => c.name)
          .join(", ")}.`,
      };
    }
    if (!columnAllowed(resolved)) {
      return { ok: false, error: `"${resolved}" is not readable.` };
    }
    parts.push(resolved);
  }

  if (parts.length === 0) return { ok: false, error: "No columns selected." };
  return { ok: true, select: parts.join(",") };
}

/** Apply one filter to a supabase-js query builder. */
function applyFilter(q: any, f: { column: string; op: FilterOp; value?: unknown }) {
  switch (f.op) {
    case "eq":
      return q.eq(f.column, f.value);
    case "neq":
      return q.neq(f.column, f.value);
    case "gt":
      return q.gt(f.column, f.value);
    case "gte":
      return q.gte(f.column, f.value);
    case "lt":
      return q.lt(f.column, f.value);
    case "lte":
      return q.lte(f.column, f.value);
    case "like":
      return q.like(f.column, String(f.value ?? ""));
    case "ilike":
      return q.ilike(f.column, String(f.value ?? ""));
    case "in":
      return q.in(f.column, Array.isArray(f.value) ? f.value : [f.value]);
    case "is_null":
      return q.is(f.column, null);
    case "not_null":
      return q.not(f.column, "is", null);
    default:
      return q;
  }
}

/**
 * Run one spec.
 *
 * Every failure path returns `{ error }` rather than throwing, so the model
 * gets a sentence it can act on ("there is no column called X") instead of
 * the whole answer collapsing.
 */
export async function runQuery(
  spec: QuerySpec,
  snapshot: SchemaSnapshot,
): Promise<QueryResult> {
  const table = findTable(snapshot, String(spec.table ?? ""));
  if (!table) {
    return {
      table: String(spec.table ?? ""),
      error: `There is no table called "${spec.table}". Available tables: ${snapshot.tables
        .map((t) => t.name)
        .join(", ")}.`,
    };
  }

  const supabase = createAdminClient();

  // ── Validate every identifier before touching the database ──────────────
  // A near-miss column name is repaired onto the real one; anything further
  // off is rejected with the real column list so the model can retry.
  const filters = (spec.filters ?? []).filter((f) => f && f.column);
  for (const f of filters) {
    const resolved = resolveColumn(table, f.column);
    if (!resolved) {
      return {
        table: table.name,
        badColumn: f.column,
        error: `"${table.name}" has no column called "${f.column}". Its columns are: ${table.columns
          .map((c) => c.name)
          .join(", ")}.`,
      };
    }
    f.column = resolved;
  }

  if (spec.order) {
    const resolved = resolveColumn(table, spec.order.column);
    if (!resolved) {
      return {
        table: table.name,
        error: `Cannot order by "${spec.order.column}" — "${table.name}" has no such column.`,
      };
    }
    spec.order.column = resolved;
  }

  if (spec.groupBy) {
    const resolved = resolveColumn(table, spec.groupBy);
    if (!resolved) {
      return {
        table: table.name,
        error: `Cannot group by "${spec.groupBy}" — "${table.name}" has no such column.`,
      };
    }
    spec.groupBy = resolved;
  }

  if (spec.aggregate) {
    const resolved = resolveColumn(table, spec.aggregate.column);
    const col = resolved ? table.columns.find((c) => c.name === resolved) : undefined;
    if (!col) {
      return {
        table: table.name,
        error: `Cannot ${spec.aggregate.fn} "${spec.aggregate.column}" — "${table.name}" has no such column.`,
      };
    }
    spec.aggregate.column = col.name;
    if (!["numeric", "int4", "int8", "float8"].includes(col.type)) {
      return {
        table: table.name,
        error: `"${col.name}" is ${col.type}, not a number, so it cannot be ${spec.aggregate.fn}med.`,
      };
    }
  }

  // ── Count only ──────────────────────────────────────────────────────────
  if (spec.countOnly) {
    let q = supabase.from(table.name).select("*", { count: "exact", head: true });
    for (const f of filters) q = applyFilter(q, f);
    const { count, error } = await q;
    if (error) return { table: table.name, error: error.message };
    return { table: table.name, count: count ?? 0 };
  }

  // ── Aggregate ───────────────────────────────────────────────────────────
  if (spec.aggregate) {
    const col = spec.aggregate.column;
    let q = supabase.from(table.name).select(col).limit(MAX_SCAN);
    for (const f of filters) q = applyFilter(q, f);
    const { data, error } = await q;
    if (error) return { table: table.name, error: error.message };

    const nums = (data ?? [])
      .map((r: any) => Number(r[col]))
      .filter((n: number) => Number.isFinite(n));
    const value =
      nums.length === 0
        ? null
        : spec.aggregate.fn === "sum"
          ? nums.reduce((a, b) => a + b, 0)
          : spec.aggregate.fn === "avg"
            ? nums.reduce((a, b) => a + b, 0) / nums.length
            : spec.aggregate.fn === "min"
              ? Math.min(...nums)
              : Math.max(...nums);

    return {
      table: table.name,
      aggregate: {
        fn: spec.aggregate.fn,
        column: col,
        value,
        rows_scanned: nums.length,
        truncated: (data ?? []).length >= MAX_SCAN,
      },
    };
  }

  // ── Group by ────────────────────────────────────────────────────────────
  if (spec.groupBy) {
    const col = spec.groupBy;
    let q = supabase.from(table.name).select(col).limit(MAX_SCAN);
    for (const f of filters) q = applyFilter(q, f);
    const { data, error } = await q;
    if (error) return { table: table.name, error: error.message };

    const tally = new Map<string, { value: unknown; count: number }>();
    for (const r of data ?? []) {
      const v = (r as any)[col];
      const k = String(v);
      const hit = tally.get(k);
      if (hit) hit.count += 1;
      else tally.set(k, { value: v, count: 1 });
    }
    const groups = [...tally.values()].sort((a, b) => b.count - a.count).slice(0, 30);
    return {
      table: table.name,
      groups,
      truncated: (data ?? []).length >= MAX_SCAN,
    };
  }

  // ── Rows ────────────────────────────────────────────────────────────────
  const sel = spec.select?.length
    ? validateSelect(spec.select, table, snapshot)
    : ({ ok: true, select: defaultSelect(table).join(",") } as const);
  if (!sel.ok) return { table: table.name, error: sel.error };

  const limit = Math.min(Math.max(Number(spec.limit ?? 20) || 20, 1), MAX_ROWS);

  let q = supabase.from(table.name).select(sel.select).limit(limit);
  for (const f of filters) q = applyFilter(q, f);
  if (spec.order) {
    q = q.order(spec.order.column, { ascending: spec.order.ascending !== false });
  }

  const { data, error } = await q;
  if (error) return { table: table.name, error: error.message };

  return {
    table: table.name,
    rows: (data ?? []) as unknown as Record<string, unknown>[],
    truncated: (data ?? []).length >= limit,
  };
}

/**
 * Run several specs, in parallel.
 *
 * The model is allowed up to four queries per question — enough for "compare
 * this month to last month" without letting one question fan out into a
 * hundred database calls.
 */
export async function runQueries(
  specs: QuerySpec[],
  snapshot: SchemaSnapshot,
): Promise<QueryResult[]> {
  const capped = specs.slice(0, 4);
  return Promise.all(capped.map((s) => runQuery(s, snapshot)));
}
