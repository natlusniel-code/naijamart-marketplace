/**
 * The AI admin copilot.
 *
 * ── What it is for ───────────────────────────────────────────────────────
 * An admin running this marketplace answers the same questions all day:
 * "how much is waiting to be verified?", "which seller has the most
 * disputes?", "what did we make this week?", "who is this buyer?". The
 * copilot answers those from live data instead of making the admin click
 * through six pages.
 *
 * ── Why it is read-only ──────────────────────────────────────────────────
 * The copilot can READ anything and WRITE nothing. Every action that
 * changes money or state (verify a payment, release a payout, suspend a
 * shop) stays a button a human presses. An AI that can move money is a
 * liability, and the value here is answering questions, not automating
 * decisions.
 *
 * ── Why the tools are a fixed list ───────────────────────────────────────
 * The model does not get SQL. It gets a small set of named queries, each
 * one written and reviewed here. That is what makes it safe: the worst a
 * bad answer can do is pick the wrong query, never run an arbitrary one.
 */

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { aiJson, aiText, aiTry, clip } from "@/lib/ai";

export type CopilotTool =
  | "platform_overview"
  | "pending_payments"
  | "pending_payouts"
  | "open_disputes"
  | "seller_leaderboard"
  | "buyer_lookup"
  | "safety_queue"
  | "recent_orders";

export type CopilotAnswer = {
  answer: string;
  /** Which queries were run, so the admin can see the basis. */
  tools: { name: CopilotTool; args: Record<string, unknown> }[];
  /** The raw rows, for the "show me the data" expander. */
  data: Record<string, unknown>;
};

/**
 * The tool catalogue, described to the model.
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
      "Sellers ranked by revenue, with order count, rating and quality score. Use for 'best sellers' or 'who is struggling'.",
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
 * Run one tool.
 *
 * Every query is written here, with a hard limit, so a question can never
 * pull the whole database into a prompt.
 */
async function runTool(
  name: CopilotTool,
  args: Record<string, unknown>,
): Promise<unknown> {
  const supabase = createClient();

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
 * Answer a question.
 *
 * Two model calls at most: one to pick the tools, one to write the answer
 * from what they returned. The second call is given ONLY the tool output,
 * so the answer cannot drift into invention.
 */
export async function askCopilot(
  question: string,
  history: { role: "user" | "assistant"; body: string }[] = [],
): Promise<CopilotAnswer> {
  const q = clip(question, 1000);
  if (!q) return { answer: "Ask me something about the platform.", tools: [], data: {} };

  // ── 1. Which tools? ─────────────────────────────────────────────────
  const plan = await aiTry(() =>
    aiJson<{ tools: { name: CopilotTool; args?: Record<string, unknown> }[] }>({
      prompt: `You are the copilot for the admin of NaijaMart, a Nigerian marketplace.

Available queries:
${TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

${history.length ? `Recent conversation:\n${history.slice(-4).map((h) => `${h.role}: ${h.body}`).join("\n")}\n` : ""}
The admin asks: "${q}"

Pick the 1-3 queries that answer it. Return ONLY JSON:
{"tools":[{"name":"<one of the names above>","args":{}}]}

Rules:
- Only use names from the list. Never invent one.
- For buyer_lookup, put the name or email fragment in args as {"q":"..."}.
- If the question is general ("how are we doing"), use platform_overview.
- If nothing fits, return an empty tools array.`,
      fast: true,
      timeoutMs: 6_000,
      maxTokens: 300,
      temperature: 0.1,
    }),
  );

  const chosen = (plan?.tools ?? [])
    .filter((t) => TOOLS.some((x) => x.name === t.name))
    .slice(0, 3);

  // ── 2. Run them ─────────────────────────────────────────────────────
  const data: Record<string, unknown> = {};
  for (const t of chosen) {
    data[t.name] = await runTool(t.name, t.args ?? {});
  }

  // ── 3. Write the answer ─────────────────────────────────────────────
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

  return {
    answer:
      answer ??
      (chosen.length
        ? "I could not summarise that just now. The data is below."
        : "I could not work out which data answers that. Try asking about payments, payouts, disputes, sellers or orders."),
    tools: chosen.map((t) => ({ name: t.name, args: t.args ?? {} })),
    data,
  };
}
