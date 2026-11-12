/**
 * The job-runner shared secret, with a committed fallback.
 *
 * Same reasoning as `src/lib/supabase/admin.ts` and `push-private.ts`: this
 * deployment has no environment variables configured, and a cron job that
 * 500s because a variable is missing is indistinguishable from a broken
 * feature. `JOBS_SECRET` in the host overrides it.
 *
 * This only guards `/api/jobs/run`, which does two things: advance order
 * timers and flush the notification outbox. Both are idempotent, so the worst
 * an attacker gains by knowing it is the ability to trigger them early.
 */
export const JOBS_SECRET =
  process.env.JOBS_SECRET?.trim() || "nm-jobs-6f2a91c4d7e8";
