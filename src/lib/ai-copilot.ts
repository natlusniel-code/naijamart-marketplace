/**
 * The AI admin copilot.
 *
 * ── What it is for ────────────────────────────────────────────────────────
 * An admin running this marketplace answers the same questions all day:
 * "how much is waiting to be verified?", "which seller has the most
 * disputes?", "what did we make this week?", "who is this buyer?". The
 * copilot answers those from live data instead of making the admin click
 * through six pages.
 *
 * ── Why it is read-only ───────────────────────────────────────────────────
 * The copilot can READ anything and WRITE nothing. Every action that
 * changes money or state (verify a payment, release a payout, suspend a
 * shop) stays a button a human presses. An AI that can move money is a
 * liability, and the value here is answering questions, not automating
 * decisions.
 *
 * ── Two ways to answer ────────────────────────────────────────────────────
 * 1. NAMED QUERIES. Eight hand-written queries for the questions asked
 *    most. They are fast, they are reviewed, and they encode business
 *    knowledge the schema alone does not carry (a payout is "due" when
 *    `available_at` has passed, not when `status = 'queued'`).
 *
 * 2. SCHEMA QUERIES. Anything else. The model is given the LIVE schema —
 *    every table and column, read from PostgREST at request time — and
 *    writes a small JSON spec (table, columns, filters, order, limit) that
 *    `ai-query.ts` validates against that schema and runs. This is what
 *    lets an admin ask about `enquiries`, `offers`, `wishlists`,
 *    `seller_scores` or a table added by a migration this morning, without
 *    anyone editing this file.
 *
 * ── Why the model still does not get SQL ──────────────────────────────────
 * A spec is not SQL. Every identifier in it is checked against the live
 * schema before use, values are parameterised by supabase-js, and the row
 * cap is enforced here. The worst a bad spec can do is name a column that
 * does not exist — which comes back as a readable sentence, not an error.
 */

import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiJson, aiText, aiTry, clip } from "@/lib/ai";
import {
  describeSchema,
  loadSchema,
  overviewTables,
  type SchemaSnapshot,
} from "@/lib/ai-schema";
import { runQueries, type QuerySpec, type QueryResult } from "@/lib/ai-query";

export type CopilotTool =
  | "platform_overview"
  | "pending_payments"
  | "pending_payouts"
  | "open_disputes"
  | "seller_leaderboard"
  | "buyer_lookup"
  | "safety_queue"
  | "recent_orders"
  | "schema_query";

export type CopilotAnswer = {
  answer: string;
  /** Which queries were run, so the admin can see the basis. */
  tools: { name: CopilotTool; args: Record<string, unknown> }[];
  /** The raw rows, for the "show me the data" expander. */
  data: Record<string, unknown>;
  /** How many tables the copilot could see when it answered. */
  schemaTables?: number;
  /** When the schema snapshot was taken. */
  schemaAsOf?: string;
};

/**
 * The named-query catalogue, described to the model.
 *
 * Each entry is a name, what it returns, and when to use it. The model
 * picks from this list; it cannot invent a tool.
 */
const TOOLS: { name: CopilotTool; description: string }[] = [
  {
    name: "platform_overview",
    description:
      "Totals for the whole platform: orders, revenue, commission, active sellers, active buyers, pending items. Use for any 'how are we doing' question.",
  },
  {
    name: "pending_payments",
    description:
      "Buyer transfer receipts waiting for verification, with order reference, amount and age. Use for 'what needs verifying'.",
  },
  {
    name: "pending_payouts",
    description:
      "Seller payouts that are due or held, with shop name and amount. Use for 'who do we owe'.",
  },
  {
    name: "open_disputes",
    description:
      "Disputes that are not resolved, with the order, the buyer's reason and how long it has been open.",
  },
  {
    name: "seller_leaderboard",
    description:
      "Sellers ranked by rating, with order count and location. Use for 'best sellers' or 'who is struggling'.",
  },
  {
    name: "buyer_lookup",
    description:
      "One buyer's profile, order count and total spend. Requires a name or email fragment in `q`.",
  },
  {
    name: "safety_queue",
    description:
      "AI trust & safety reports that are still open, highest risk first.",
  },
  {
    name: "recent_orders",
    description:
      "The most recent orders with status, total and shop. Use for 'what just came in'.",
  },
];

/**
 * Run one named query.
 *
 * Every query is written here, with a hard limit, so a question can never
 * pull the whole database into a prompt.
 */
async function runTool(
  name: CopilotTool,
  args: Record<string, unknown>,
): Promise<unknown> {
  // ── Why the service role, not the session client ──────────────────────
  // This used to be `createClient()` from `@/lib/supabase/server`, which is
  // the ANON key with RLS in effect. A server action has no `auth.uid()`,
  // so `profiles_select` — `(id = auth.uid()) OR is_admin()` — matched
  // nothing and every count came back 0. The copilot then told the admin
  // "we have 0 buyers" while the dashboard, which uses this same admin
  // client, correctly showed 8. The copilot is admin-only (its caller
  // `askAdminCopilot` is gated on `hasAdminKey`), so reading with the
  // service role is the correct scope — and it is what makes the answer
  // agree with the page the admin is looking at.
  const supabase = createAdminClient();

  switch (name) {
    case "platform_overview": {
      const [{ count: orders }, { count: sellers }, { count: buyers }] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }),
        supabase.from("shops").select("id", { count: "exact", head: true }).eq("status", "approved"),
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "buyer"),
      ]);

      const { data: revenue } = await supabase
        .from("orders")
        .select("total,commission_amount,status,created_at")
        .in("status", ["delivered", "completed"])
        .gte("created_at", new Date(Date.now() - 30 * 86_400_000).toISOString());

      const rows = revenue ?? [];
      return {
        total_orders: orders ?? 0,
        approved_sellers: sellers ?? 0,
        buyers: buyers ?? 0,
        revenue_30d: rows.reduce((a, r: any) => a + Number(r.total ?? 0), 0),
        commission_30d: rows.reduce((a, r: any) => a + Number(r.commission_amount ?? 0), 0),
        completed_orders_30d: rows.length,
      };
    }

    case "pending_payments": {
      const { data } = await supabase
        .from("payments")
        .select("id,amount,status,reference,created_at,orders(reference,total),shops(name)")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(25);
      return (data ?? []).map((p: any) => ({
        reference: p.reference,
        amount: p.amount,
        order: p.orders?.reference ?? null,
        shop: p.shops?.name ?? null,
        waiting_since: p.created_at,
      }));
    }

    case "pending_payouts": {
      // `payouts.status` is only 'queued' | 'paid' (sql/0001). A queued
      // payout whose `available_at` has passed is the one that is actually
      // due, so that is what the admin needs to see first.
      const { data } = await supabase
        .from("payouts")
        .select("id,amount,status,available_at,created_at,shops(name)")
        .eq("status", "queued")
        .order("available_at", { ascending: true })
        .limit(25);
      return (data ?? []).map((p: any) => ({
        shop: p.shops?.name ?? null,
        amount: p.amount,
        due: p.available_at,
        overdue: p.available_at ? new Date(p.available_at) < new Date() : false,
      }));
    }

    case "open_disputes": {
      // `disputes.status` is 'open' | 'resolved_buyer' | 'resolved_seller'.
      const { data } = await supabase
        .from("disputes")
        .select("id,reason,status,created_at,orders(reference,total,shops(name))")
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .limit(25);
      return (data ?? []).map((d: any) => ({
        order: d.orders?.reference ?? null,
        shop: d.orders?.shops?.name ?? null,
        reason: clip(String(d.reason ?? ""), 200),
        open_since: d.created_at,
      }));
    }

    case "seller_leaderboard": {
      const { data } = await supabase
        .from("shops")
        .select("id,name,city,state,rating_avg,rating_count,status")
        .eq("status", "approved")
        .order("rating_avg", { ascending: false })
        .limit(15);
      return (data ?? []).map((s: any) => ({
        shop: s.name,
        location: [s.city, s.state].filter(Boolean).join(", "),
        rating: s.rating_avg,
        reviews: s.rating_count,
      }));
    }

    case "buyer_lookup": {
      const q = String(args.q ?? "").trim();
      if (!q) return { error: "No name or email given." };
      const { data } = await supabase
        .from("profiles")
        .select("id,full_name,email,city,state,role,created_at,is_banned")
        .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
        .limit(10);
      return (data ?? []).map((p: any) => ({
        name: p.full_name,
        email: p.email,
        location: [p.city, p.state].filter(Boolean).join(", "),
        role: p.role,
        banned: p.is_banned,
        joined: p.created_at,
      }));
    }

    case "safety_queue": {
      const { data } = await supabase
        .from("ai_safety_reports")
        .select("id,subject_type,subject_id,risk_level,score,summary,created_at")
        .eq("status", "open")
        .order("score", { ascending: false })
        .limit(20);
      return (data ?? []).map((r: any) => ({
        subject: r.subject_type,
        risk: r.risk_level,
        score: r.score,
        summary: r.summary,
        raised: r.created_at,
      }));
    }

    case "recent_orders": {
      const { data } = await supabase
        .from("orders")
        .select("reference,status,total,created_at,shops(name)")
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []).map((o: any) => ({
        reference: o.reference,
        shop: o.shops?.name ?? null,
        status: o.status,
        total: o.total,
        placed: o.created_at,
      }));
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

/**
 * The instruction for the planning call.
 *
 * The model gets the named queries AND the live schema. It is told to
 * prefer a named query when one fits, because those carry business rules
 * the schema cannot express, and to fall back to a schema query otherwise.
 */
function planPrompt(question: string, schema: SchemaSnapshot | null, history: string): string {
  const named = TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n");

  const schemaBlock = schema
    ? `\nThe live database (every table and column, read from the database just now):\n${describeSchema(schema)}\n`
    : "";

  return `You are the copilot for the admin of NaijaMart, a Nigerian marketplace. You answer from the live database.

NAMED QUERIES (prefer these when one fits — they encode business rules):
${named}

${schemaBlock}
${history ? `Recent conversation:\n${history}\n` : ""}
The admin asks: "${question}"

Return ONLY JSON, one of these two shapes:

1. A named query:
{"tools":[{"name":"<one of the names above>","args":{}}]}

2. A schema query, for anything the named queries do not cover:
{"queries":[{"table":"<table name>","select":["col","other_table(col)"],"filters":[{"column":"col","op":"eq","value":"x"}],"order":{"column":"created_at","ascending":false},"limit":20}]}

Rules:
- Only use table and column names that appear in the schema above. Never invent one.
- A column shown as name:text{a|b|c} has exactly those legal values. Filter on one of them, spelled exactly. Never guess a different column to express the same idea.
- For buyer_lookup, put the name or email fragment in args as {"q":"..."}.
- If the question is general ("how are we doing"), use platform_overview.
- Use a schema query for questions about tables the named queries do not mention — enquiries, offers, wishlists, reviews, categories, stories, seller_scores, deliveries, notifications, subscribers, and so on.
- Allowed filter ops: eq, neq, gt, gte, lt, lte, like, ilike, in, is_null, not_null.
- For a count, use {"table":"x","countOnly":true}.
- For a total or average, use {"table":"x","aggregate":{"fn":"sum","column":"total"},"filters":[...]}.
- For "how many of each", use {"table":"x","groupBy":"status"}.
- At most 4 queries. Keep limits small (10-25).
- If nothing fits, return {"tools":[]}.`;
}

/**
 * A plain-language summary built from the query results, with no model.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The answer-writing call is the one that can time out, and when it did the
 * admin got "I could not summarise that just now" — even though the query
 * had already returned the right number. That is the worst possible
 * outcome: the work succeeded and the answer was thrown away.
 *
 * This reads the same results and states them directly. It is less fluent
 * than the model, but it is always right, and it is only used when the
 * model fails.
 */
function summariseResults(results: QueryResult[]): string {
  if (results.length === 0) return "I could not read anything for that question.";

  const lines = results.map((r) => {
    if (r.error) return `I could not read ${r.table}: ${r.error}`;

    if (r.count != null) {
      return r.count === 0
        ? `There are no matching rows in ${r.table}.`
        : `There are ${r.count.toLocaleString()} matching rows in ${r.table}.`;
    }

    if (r.aggregate) {
      const v = r.aggregate.value;
      if (v == null) return `${r.table} has no ${r.aggregate.column} values to ${r.aggregate.fn}.`;
      const shown = Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
      return `The ${r.aggregate.fn} of ${r.aggregate.column} in ${r.table} is ${shown}${
        r.aggregate.truncated ? ` (over the first ${r.aggregate.rows_scanned} rows)` : ""
      }.`;
    }

    if (r.groups) {
      if (r.groups.length === 0) return `${r.table} has no rows to break down.`;
      const parts = r.groups.map((g) => `${g.value ?? "none"}: ${g.count}`).join(", ");
      return `In ${r.table} — ${parts}.`;
    }

    if (r.rows) {
      if (r.rows.length === 0) return `${r.table} has no matching rows.`;
      return `${r.table} returned ${r.rows.length} row${r.rows.length === 1 ? "" : "s"}${
        r.truncated ? " (more exist)" : ""
      }.`;
    }

    return `Read ${r.table}.`;
  });

  return lines.join(" ");
}

/**
 * Answer a question.
 *
 * Three model calls at most: one to plan, one to repair a rejected spec,
 * one to write the answer. The final call is given ONLY the query output,
 * so the answer cannot drift into invention.
 */
export async function askCopilot(
  question: string,
  history: { role: "user" | "assistant"; body: string }[] = [],
): Promise<CopilotAnswer> {
  const q = clip(question, 1000);
  if (!q) return { answer: "Ask me something about the platform.", tools: [], data: {} };

  // ── 0. What is actually in the database right now? ──────────────────────
  const schema = await loadSchema();

  const historyText = history.length
    ? history
        .slice(-4)
        .map((h) => `${h.role}: ${h.body}`)
        .join("\n")
    : "";

  // ── 1. Plan ─────────────────────────────────────────────────────────────
  const plan = await aiTry(() =>
    aiJson<{
      tools?: { name: CopilotTool; args?: Record<string, unknown> }[];
      queries?: QuerySpec[];
    }>({
      prompt: planPrompt(q, schema, historyText),
      fast: true,
      timeoutMs: 8_000,
      maxTokens: 700,
      temperature: 0.1,
    }),
  );

  const chosen = (plan?.tools ?? [])
    .filter((t) => TOOLS.some((x) => x.name === t.name))
    .slice(0, 3);

  const specs = (plan?.queries ?? []).filter((s) => s && typeof s.table === "string").slice(0, 4);

  // ── 1b. Fallback when the model picks nothing ───────────────────────────
  // "What categories exist?" is a perfectly clear question, but the model
  // sometimes returns an empty plan because no named query fits and it is
  // unsure a schema query is allowed. Rather than answer "I could not work
  // out which data answers that", look for a table whose name appears in
  // the question and query it. This is a cheap, deterministic rescue.
  if (chosen.length === 0 && specs.length === 0 && schema) {
    const words: string[] = q.toLowerCase().match(/[a-z_]{3,}/g) ?? [];
    const hit = schema.tables.find((t) => {
      const name = t.name.toLowerCase();
      const singular = name.endsWith("s") ? name.slice(0, -1) : name;
      return words.includes(name) || words.includes(singular);
    });
    if (hit) {
      specs.push({ table: hit.name, limit: 25 });
    }
  }

  // ── 2. Run ──────────────────────────────────────────────────────────────
  const data: Record<string, unknown> = {};
  const used: { name: CopilotTool; args: Record<string, unknown> }[] = [];

  for (const t of chosen) {
    data[t.name] = await runTool(t.name, t.args ?? {});
    used.push({ name: t.name, args: t.args ?? {} });
  }

  let results: QueryResult[] = [];
  if (specs.length && schema) {
    results = await runQueries(specs, schema);

    // ── 2b. Deterministic repair ────────────────────────────────────────
    // A rejected spec is almost always a column that does not exist on that
    // table — the model asked `listings.pickup_available` when the column
    // is `listings.fulfilment_mode` and `pickup_available` lives on
    // `shops`. The first fix is mechanical and needs no model: drop the
    // offending filter and re-run, so the admin still gets the rows and can
    // see the real values. This is tried BEFORE asking the model again,
    // because a second model call is slow and, measured, often repeats the
    // same mistake.
    const repaired = await Promise.all(
      results.map(async (r, i) => {
        if (!r.error || !r.badColumn) return r;
        const spec = specs[i];
        if (!spec) return r;
        const cleaned: QuerySpec = {
          ...spec,
          filters: (spec.filters ?? []).filter((f) => f.column !== r.badColumn),
        };
        const [retry] = await runQueries([cleaned], schema);
        if (retry && !retry.error) {
          specs[i] = cleaned;
          return retry;
        }
        return r;
      }),
    );
    results = repaired;

    // ── 2c. One model repair pass ───────────────────────────────────────
    // Only for what the mechanical fix could not save — a bad table name, a
    // bad aggregate, a column that is genuinely ambiguous. Hand the model
    // its own error and the real column list once.
    const failed = results.filter((r) => r.error);
    if (failed.length && failed.length === results.length) {
      const repair = await aiTry(() =>
        aiJson<{ queries?: QuerySpec[] }>({
          prompt: `You are the copilot for the admin of NaijaMart. Your previous query was rejected.

The admin asked: "${q}"

Your query:
${JSON.stringify(specs, null, 2)}

The database said:
${failed.map((f) => `- ${f.table}: ${f.error}`).join("\n")}

The live schema is:
${describeSchema(schema)}

Return ONLY JSON with a corrected query:
{"queries":[{"table":"...","select":["..."],"filters":[...],"limit":20}]}

How to correct it:
- The column you asked for does not exist on that table. Read the column list in the error and pick the REAL column that means the same thing. For example, pickup/delivery on a listing is the column "fulfilment_mode" (values: both, pickup, delivery), not "pickup_available" — that one is on "shops".
- If no real column means the same thing, DROP that filter and instead SELECT the closest real column, so the admin can see the actual values and judge for themselves.
- Never repeat the same rejected column. Never invent a column.
- Use only table and column names that appear in the schema above.`,
          fast: true,
          timeoutMs: 8_000,
          maxTokens: 500,
          temperature: 0.1,
        }),
      );

      const retrySpecs = (repair?.queries ?? [])
        .filter((s) => s && typeof s.table === "string")
        .slice(0, 4);
      if (retrySpecs.length) {
        results = await runQueries(retrySpecs, schema);
        specs.length = 0;
        specs.push(...retrySpecs);
      }
    }

    results.forEach((r, i) => {
      data[`query_${i + 1}_${r.table}`] = r;
    });
    used.push({
      name: "schema_query",
      args: { queries: specs as unknown as Record<string, unknown>[] },
    });
  }

  // ── 3. Write the answer ─────────────────────────────────────────────────
  const answer = await aiTry(() =>
    aiText({
      prompt: `You are the copilot for the admin of NaijaMart, a Nigerian marketplace.

The admin asked: "${q}"

Here is the live data that answers it:
${JSON.stringify(data, null, 2)}

Write the answer.

Rules:
- Answer the question directly in the first sentence.
- Use the real numbers from the data. Format naira as ₦12,500.
- A result with a "count" field IS the answer to a "how many" question — report that number. A count of 0 is a real answer ("there are none"), not missing data.
- A result with "groups" is a breakdown — report each group and its count.
- A result with "aggregate" has the total/average in "value".
- A result with "rows": [] genuinely has no matching rows; say so plainly.
- If a result has an "error" field, say plainly that you could not read that table and what the error was. Do not pretend it worked.
- If a result has "truncated": true, say the figure covers the first rows scanned rather than presenting it as a complete total.
- If the data does not answer the question, say what you can see and what is missing. Do not guess.
- 1-4 sentences unless the admin asked for a list.
- Never mention that you are an AI, and never mention "the data" or "the query" — just answer.
- You cannot change anything. If the admin asks you to do something, say which page does it.`,
      fast: false,
      timeoutMs: 20_000,
      maxTokens: 600,
      temperature: 0.3,
    }),
  );

  const nothingRan = used.length === 0;

  return {
    answer:
      answer ??
      (nothingRan
        ? "I could not work out which data answers that. Try naming a table or asking about orders, payments, sellers, buyers, enquiries or reviews."
        : summariseResults(results)),
    tools: used,
    data,
    schemaTables: schema?.tables.length,
    schemaAsOf: schema?.takenAt,
  };
}

/**
 * What the copilot can see, for the UI's "what can I ask" panel.
 *
 * Returns the live table list with row counts, so the admin can browse the
 * database from the copilot page instead of guessing what exists.
 */
export async function copilotCapabilities(): Promise<{
  tables: { name: string; columns: number; rows: number | null }[];
  asOf: string | null;
}> {
  const schema = await loadSchema();
  if (!schema) return { tables: [], asOf: null };

  const supabase = createAdminClient();
  const names = overviewTables(schema);

  const counts = await Promise.all(
    names.map(async (name) => {
      const { count } = await supabase.from(name).select("*", { count: "exact", head: true });
      return [name, count ?? null] as const;
    }),
  );
  const countMap = new Map(counts);

  return {
    tables: schema.tables.map((t) => ({
      name: t.name,
      columns: t.columns.length,
      rows: countMap.get(t.name) ?? null,
    })),
    asOf: schema.takenAt,
  };
}
