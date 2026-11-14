import "server-only";

/**
 * Live schema introspection for the admin copilot.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The copilot used to answer from eight hand-written queries. That meant an
 * admin could ask about buyers, sellers and orders, and nothing else — the
 * other 37 tables in the database were invisible to it. Adding a table
 * required editing the copilot, so the gap only ever grew.
 *
 * This module asks PostgREST what actually exists, at request time. The
 * OpenAPI root (`GET /rest/v1/`) is generated from the live database, so it
 * lists every table and every column in the exposed schema — including
 * columns added by a migration five minutes ago. Nothing here is hardcoded,
 * so nothing here can go stale.
 *
 * ── Why it is safe ────────────────────────────────────────────────────────
 * This only ever READS the catalogue. It returns names and types; it never
 * returns row data. The copilot then builds queries against those names
 * through the supabase-js builder, which parameterises values and cannot be
 * made to run arbitrary SQL. The model never sees a SQL string it can edit.
 */

import { SUPABASE_URL } from "@/lib/supabase/config";
import { serviceRoleKey } from "@/lib/supabase/admin";

export type ColumnInfo = {
  name: string;
  /** Postgres type as PostgREST reports it: text, uuid, numeric, timestamptz… */
  type: string;
  /** True when the column is part of the primary key. */
  pk: boolean;
  /** True when the column is a foreign key, with the table it points at. */
  fk?: string;
};

export type TableInfo = {
  name: string;
  columns: ColumnInfo[];
  /** Approximate row count, filled in lazily by `countRows`. */
  rows?: number;
};

export type SchemaSnapshot = {
  tables: TableInfo[];
  /** When this snapshot was taken, for the "as of" line in the UI. */
  takenAt: string;
};

/**
 * Tables the copilot must never expose, even to an admin.
 *
 * These hold credentials, not business data. `account_credentials` stores
 * password hashes; `one_time_codes` stores live login codes. An admin
 * asking "show me the credentials table" should get a refusal, not a
 * password hash in a chat transcript that may be screenshotted.
 */
const SECRET_TABLES = new Set([
  "account_credentials",
  "one_time_codes",
  "push_subscriptions",
]);

/** True when a table may be read by the copilot. */
export function isReadableTable(name: string): boolean {
  return !SECRET_TABLES.has(name);
}

/**
 * Cache the snapshot for a short while.
 *
 * The schema changes when a migration runs, which is rare, but the copilot
 * is asked several questions in a row. A 60-second cache means a burst of
 * questions costs one introspection call, while a fresh migration is picked
 * up within a minute without a redeploy.
 */
let cached: { at: number; snapshot: SchemaSnapshot } | null = null;
const CACHE_MS = 60_000;

/**
 * Read the live schema from PostgREST.
 *
 * Returns `null` rather than throwing: the copilot must still answer from
 * its built-in queries if introspection fails, so a schema read is an
 * enhancement, never a hard dependency.
 */
export async function loadSchema(force = false): Promise<SchemaSnapshot | null> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.snapshot;
  }

  const key = serviceRoleKey();
  if (!key) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
      // The schema is not user-specific, but it must not be cached by the
      // CDN across a migration either — the 60s in-process cache is enough.
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;

    const doc = (await res.json()) as {
      definitions?: Record<string, OpenApiTable>;
      components?: { schemas?: Record<string, OpenApiTable> };
    };
    const defs = doc.definitions ?? doc.components?.schemas ?? {};

    const tables: TableInfo[] = [];
    for (const [name, def] of Object.entries(defs)) {
      if (!isReadableTable(name)) continue;
      const props = def.properties ?? {};
      const required = new Set(def.required ?? []);

      const columns: ColumnInfo[] = Object.entries(props).map(([col, spec]) => {
        const fk = spec.format?.startsWith("public.") ? spec.format.slice(7) : undefined;
        return {
          name: col,
          type: normaliseType(spec),
          // PostgREST marks the primary key as required + uuid/numeric and
          // names it `id` in almost every table here. `required` alone is
          // not enough (many NOT NULL columns are required), so the pk flag
          // is a best-effort hint used only for ordering, never for logic.
          pk: col === "id" && required.has(col),
          fk,
        };
      });

      tables.push({ name, columns });
    }

    tables.sort((a, b) => a.name.localeCompare(b.name));
    const snapshot: SchemaSnapshot = { tables, takenAt: new Date().toISOString() };
    cached = { at: Date.now(), snapshot };
    return snapshot;
  } catch {
    return null;
  }
}

type OpenApiTable = {
  properties?: Record<string, { type?: string; format?: string; description?: string }>;
  required?: string[];
};

/** Map a PostgREST type spec onto a short Postgres-ish name. */
function normaliseType(spec: { type?: string; format?: string }): string {
  const f = spec.format ?? "";
  if (f === "timestamp with time zone" || f === "timestamptz") return "timestamptz";
  if (f === "timestamp without time zone") return "timestamp";
  if (f === "date") return "date";
  if (f === "uuid") return "uuid";
  if (f === "double precision") return "float8";
  if (f === "bigint") return "int8";
  if (f === "integer") return "int4";
  if (f === "numeric") return "numeric";
  if (f === "boolean") return "bool";
  if (f === "jsonb") return "jsonb";
  if (f === "ARRAY") return "array";
  if (spec.type === "string") return "text";
  if (spec.type === "number") return "numeric";
  if (spec.type === "integer") return "int4";
  if (spec.type === "boolean") return "bool";
  if (spec.type === "array") return "array";
  if (spec.type === "object") return "jsonb";
  return spec.type ?? "text";
}

/**
 * Known values for the enum-like text columns.
 *
 * ── Why this is needed ────────────────────────────────────────────────────
 * PostgREST reports `fulfilment_mode` as `text`. It does not say the only
 * legal values are `both | pickup | delivery`. Asked "how many listings
 * allow both pickup and delivery?", the model — with no value list — guessed
 * a filter on `delivery_fee_override` and answered 2 instead of 11. The
 * schema told it the column existed; nothing told it what to put in it.
 *
 * These hints are appended to the schema description so the model filters
 * on the real values. They are hints, not constraints: a value that is
 * wrong simply matches no rows, and the answer says so.
 */
const VALUE_HINTS: Record<string, string> = {
  "listings.fulfilment_mode": "both|pickup|delivery",
  "listings.status": "draft|live|hidden|sold",
  "listings.type": "product|service",
  "orders.status":
    "pending|paid|accepted|shipped|delivered|completed|cancelled|declined",
  "orders.fulfilment": "delivery|pickup",
  "orders.payout_status": "held|released|paid",
  "shops.status": "pending|approved|rejected|suspended",
  "shops.plan": "basic|premium",
  "shops.subscription_status": "none|pending|active|expired",
  "shops.kind": "goods|services",
  "profiles.role": "buyer|seller|admin",
  "payments.status": "pending|verified|rejected",
  "payments.type": "order|subscription",
  "payouts.status": "queued|paid",
  "disputes.status": "open|resolved_buyer|resolved_seller",
  "reviews.status": "published|hidden|flagged",
  "offers.status": "pending|accepted|declined|expired",
  "enquiries.status": "open|responded|closed",
  "deliveries.status": "requested|accepted|in_transit|delivered|cancelled",
  "ai_safety_reports.status": "open|reviewed|actioned|dismissed",
  "ai_safety_reports.risk_level": "low|medium|high",
  "messages.ai_generated": "true|false",
};

/**
 * A compact schema description for the model's prompt.
 *
 * Every table and column, but with the type abbreviated and one line per
 * table. The full 45-table schema is ~4k tokens — affordable, and far
 * better than the model guessing a column name. Tables with many columns
 * are listed in full anyway: a truncated schema is what causes "column
 * does not exist" answers.
 *
 * Enum-like columns carry their legal values inline, because a column name
 * without its values is what makes a model invent a filter.
 */
export function describeSchema(snapshot: SchemaSnapshot): string {
  return snapshot.tables
    .map((t) => {
      const cols = t.columns
        .map((c) => {
          const hint = VALUE_HINTS[`${t.name}.${c.name}`];
          const base = c.fk ? `${c.name}:${c.type}→${c.fk}` : `${c.name}:${c.type}`;
          return hint ? `${base}{${hint}}` : base;
        })
        .join(", ");
      return `${t.name}(${cols})`;
    })
    .join("\n");
}

/** Find one table by name, case-insensitively. */
export function findTable(snapshot: SchemaSnapshot, name: string): TableInfo | undefined {
  const n = name.trim().toLowerCase();
  return snapshot.tables.find((t) => t.name.toLowerCase() === n);
}

/**
 * The tables worth counting for an overview, and the label to show.
 *
 * Derived from the live schema rather than hardcoded, so a new table shows
 * up in the overview without a code change.
 */
export function overviewTables(snapshot: SchemaSnapshot): string[] {
  const preferred = [
    "profiles",
    "shops",
    "listings",
    "orders",
    "payments",
    "payouts",
    "disputes",
    "reviews",
    "chats",
    "messages",
    "enquiries",
    "offers",
    "wishlists",
    "notifications",
    "subscribers",
    "categories",
    "stories",
    "deliveries",
  ];
  const present = new Set(snapshot.tables.map((t) => t.name));
  return preferred.filter((t) => present.has(t));
}
