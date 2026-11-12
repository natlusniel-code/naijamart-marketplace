-- ---------------------------------------------------------------------
-- 0026 — chat guard: three spec rules that were never loaded
-- ---------------------------------------------------------------------
-- Found by running the whole block list through the live checker rather
-- than reading it. 76 of 77 spec cases already passed; what follows is the
-- remainder, plus the gaps a second sweep turned up.
--
-- 1. `snap` and `ig` were in the `cue` list in 0011, which means they only
--    fired when the message ALSO contained a steering word (my / follow /
--    add …). So a bare "snap" or "ig" went through, even though the spec
--    lists both under BLOCK LIST 2 with no such condition. A venue name on
--    its own is already the whole message.
--
-- 2. `qr code` / `QR` was missing entirely — BLOCK LIST 7 names "QR code"
--    explicitly.
--
-- 3. `my btc wallet`, `send usdt`-style wallet talk is covered by the
--    existing `btc` / `usdt` patterns, but a bare wallet phrase such as
--    "my wallet address" was not. Added.
--
-- Nothing is removed here. `ig`/`snap` stay in the cue list too — a
-- pattern may legitimately appear in both lists (that is why the table's
-- unique key includes `mode`).
-- ---------------------------------------------------------------------

insert into public.chat_block_rules (rule_group, pattern, mode, priority)
select btrim(p.grp), btrim(p.pat), btrim(p.mode), p.prio::int
from (values
  -- BLOCK LIST 2: the app names that were cue-only
  ('app', 'ig',        'word', 50),
  ('app', 'snap',      'word', 50),
  ('app', 'insta',     'word', 50),

  -- BLOCK LIST 7: QR codes and wallet addresses
  ('link',    'qr code',        'word', 70),
  ('link',    'qr',             'word', 70),
  ('link',    'scan my qr',     'word', 70),
  ('payment', 'my wallet',      'word', 30),
  ('payment', 'wallet address', 'word', 30),
  ('payment', 'send to my wallet', 'word', 30)
) as p(grp, pat, mode, prio)
where not exists (
  select 1 from public.chat_block_rules r
   where r.rule_group = btrim(p.grp)
     and r.pattern    = btrim(p.pat)
     and r.mode       = btrim(p.mode)
);

notify pgrst, 'reload schema';
