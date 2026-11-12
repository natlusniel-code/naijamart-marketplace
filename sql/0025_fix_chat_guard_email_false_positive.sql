-- ---------------------------------------------------------------------
-- 0025 — chat guard: the compact list was blocking a sentence it must allow
-- ---------------------------------------------------------------------
-- THE BUG
--   `0011` put `myemail` and `youremail` in the `compact` rule list. Compact
--   rules are matched against the message with EVERY space removed, so
--
--       "My email for the project file is needed"
--
--   normalises to `myemailfortheprojectfileisneeded`, which contains
--   `myemail`, and was BLOCKED.
--
--   That exact sentence is on the spec's ALLOWED list: mentioning the word
--   email is fine; only sharing the address is not. So the guard was
--   refusing ordinary project talk — the worst kind of false positive,
--   because the buyer cannot tell why and the seller never hears from them.
--
-- THE FIX
--   `myemail` as a floating fragment is too broad to be safe. The intents it
--   was meant to catch — "send me your email", "drop your email", "what's
--   your email", "my email is …" — are already covered by explicit `word`
--   phrases, and a real address is caught by the email-address check before
--   any list is consulted. So the two fragments are removed.
--
--   "Give me your email" is additionally added as explicit phrases, since
--   removing the fragment would otherwise lose it.
--
-- Everything else in 0011 stands. This file only deletes the two rows and
-- adds the replacements, so re-running it is safe.
-- ---------------------------------------------------------------------

delete from public.chat_block_rules
 where mode = 'compact'
   and pattern in ('myemail', 'youremail');

-- Keep the intents the removed fragments were standing in for.
insert into public.chat_block_rules (rule_group, pattern, mode, priority)
select 'contact', btrim(p.pat), 'word', 40
from unnest(string_to_array(
  'give me your email|send your email|your email address|my email address|whats your email address|share your email|drop your email address',
  '|')) as p(pat)
where btrim(p.pat) <> ''
  and not exists (
    select 1 from public.chat_block_rules r
     where r.rule_group = 'contact' and r.pattern = btrim(p.pat) and r.mode = 'word'
  );

notify pgrst, 'reload schema';
