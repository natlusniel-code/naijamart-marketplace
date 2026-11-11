-- =====================================================================
-- 0011 — chat guard, checkout distance rule, 4-day payout hold,
--        multiple admin payment accounts
-- =====================================================================
--
-- Run AFTER 0010. Idempotent: safe to run more than once.
--
-- Four independent changes, all enforced in SQL so the browser cannot
-- skip them:
--
--   1. CHAT GUARD. `send_chat_message()` is now the ONLY way a message
--      can be written. It normalises the text, matches it against
--      `chat_block_rules`, and on a hit it writes the message to
--      `blocked_messages` (admin-only) and returns a warning instead of
--      inserting. The direct INSERT policy on `messages` is dropped, so
--      a crafted client insert is refused by RLS. A BEFORE INSERT
--      trigger is the second layer: even a service-role write of blocked
--      content is rejected.
--
--   2. CHECKOUT DISTANCE. `place_order()` no longer locks a buyer to
--      their own city. An order over `platform_settings.cross_lga_min_total`
--      (₦20,000) may come from any LGA in the buyer's state; below that
--      it must be the buyer's own state AND LGA.
--
--   3. PAYOUT HOLD. The seller payout window is now
--      `platform_settings.payout_hold_days` (4 days) after delivery
--      confirmation, not 24 hours. Applies to `confirm_delivery`,
--      `admin_resolve_dispute` and the auto-confirm branch of
--      `run_order_timers`.
--
--   4. PAYMENT ACCOUNTS. `payment_accounts` replaces the single
--      bank_* trio in `platform_settings`. `my_payment_account()`
--      reserves an account for the signed-in buyer (round-robin over
--      active accounts, never the same one twice in a row), and
--      `place_order` / `accept_offer` store it on the order and the
--      payment row so verification always knows where the money went.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. settings the new rules read
-- ---------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists payout_hold_days     int not null default 4,
  add column if not exists cross_lga_min_total  numeric(12,2) not null default 20000;

-- ---------------------------------------------------------------------
-- 1. CHAT GUARD
-- ---------------------------------------------------------------------

-- 1a. normalisation ---------------------------------------------------
-- Two forms of the same text are produced:
--   * the WORD form  — leet digits become letters, so "wh4tsapp" and
--     "t3legram" collapse onto the real word;
--   * the DIGIT form — number words become digits and "o"/"l" become
--     0/1, so "zero eight zero three" and "08o3" collapse onto "0803".
-- Both drop every separator, which is what defeats "w h a t s a p p",
-- "w.h.a.t.s.a.p.p", "whats*app" and "whats"+"app".
create or replace function public.nm_normalize_words(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  t text := lower(coalesce(p_text, ''));
  w text;
  d text;
  i int;
  words text[] := array['zero','oh','one','two','three','four','five','six','seven','eight','nine'];
  digits text[] := array['0','0','1','2','3','4','5','6','7','8','9'];
begin
  -- apostrophes vanish ("what's" -> "whats"); every other separator
  -- becomes a space so word boundaries survive.
  t := replace(t, '''', '');
  t := replace(t, '’', '');
  t := regexp_replace(t, '[^a-z0-9@]+', ' ', 'g');

  -- number words -> digits, but only when they are not part of a longer
  -- word ("someone", "phone", "money" must not turn into digits).
  for i in 1 .. array_length(words, 1) loop
    w := words[i];
    d := digits[i];
    t := regexp_replace(t, '(?<![a-z])' || w || '(?![a-z])', d, 'g');
  end loop;

  -- leet digits -> letters
  t := translate(t, '013457', 'oieast');
  t := regexp_replace(t, '\s+', ' ', 'g');
  return btrim(t);
end $$;

create or replace function public.nm_normalize_digits(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  t text := lower(coalesce(p_text, ''));
  w text;
  d text;
  i int;
  words text[] := array['zero','oh','one','two','three','four','five','six','seven','eight','nine'];
  digits text[] := array['0','0','1','2','3','4','5','6','7','8','9'];
begin
  t := replace(t, '''', '');
  t := replace(t, '’', '');
  t := regexp_replace(t, '[^a-z0-9@]+', ' ', 'g');

  for i in 1 .. array_length(words, 1) loop
    w := words[i];
    d := digits[i];
    t := regexp_replace(t, '(?<![a-z])' || w || '(?![a-z])', d, 'g');
  end loop;

  -- "08o3" / "08l3" -> "0803"
  t := replace(t, 'o', '0');
  t := replace(t, 'l', '1');

  t := regexp_replace(t, '[^0-9 ]+', ' ', 'g');
  t := regexp_replace(t, '\s+', ' ', 'g');
  return btrim(t);
end $$;

-- "zero eight zero three one two three four five six seven" normalises to
-- "0 8 0 3 1 2 3 4 5 6 7" — one digit per token. This joins consecutive
-- single-digit tokens back into one number so the length/prefix checks
-- see "08031234567". Multi-digit tokens are left alone, so ordinary
-- numbers in a sentence ("2 items", "5000 naira") never merge.
create or replace function public.nm_digit_runs(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  toks text[];
  i int;
  buf text := '';
  out_runs text := '';
  tok text;
begin
  toks := string_to_array(public.nm_normalize_digits(p_text), ' ');
  if toks is null or array_length(toks, 1) is null then return ''; end if;

  for i in 1 .. array_length(toks, 1) loop
    tok := toks[i];
    if tok is null or tok = '' then
      continue;
    elsif length(tok) = 1 then
      buf := buf || tok;
    else
      if buf <> '' then
        out_runs := out_runs || ' ' || buf;
        buf := '';
      end if;
      out_runs := out_runs || ' ' || tok;
    end if;
  end loop;

  if buf <> '' then
    out_runs := out_runs || ' ' || buf;
  end if;

  return btrim(out_runs);
end $$;

-- 1b. rule table ------------------------------------------------------
create table if not exists public.chat_block_rules (
  id          bigserial primary key,
  rule_group  text not null,
  pattern     text not null,
  mode        text not null default 'word' check (mode in ('word','compact','cue')),
  priority    int  not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (rule_group, pattern, mode)
);
create index if not exists chat_block_rules_active_idx on public.chat_block_rules(active, priority);

-- an earlier draft keyed on (rule_group, pattern) only; the same pattern
-- legitimately appears in both the `word` and `compact` lists, so the key
-- has to include the mode.
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conname = 'chat_block_rules_rule_group_pattern_key'
       and conrelid = 'public.chat_block_rules'::regclass
  ) then
    alter table public.chat_block_rules
      drop constraint chat_block_rules_rule_group_pattern_key;
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'chat_block_rules_rule_group_pattern_mode_key'
       and conrelid = 'public.chat_block_rules'::regclass
  ) then
    alter table public.chat_block_rules
      add constraint chat_block_rules_rule_group_pattern_mode_key
      unique (rule_group, pattern, mode);
  end if;
end $$;

alter table public.chat_block_rules enable row level security;

drop policy if exists chat_block_rules_admin on public.chat_block_rules;
create policy chat_block_rules_admin on public.chat_block_rules for all
  using (public.is_admin()) with check (public.is_admin());

-- 1c. the block lists ------------------------------------------------
-- `word`    — matched as a whole word/phrase in the normalised text.
-- `compact` — matched with every space removed, which catches spaced
--             letters, dots, stars and split words.
-- `cue`     — a platform name that is only a problem when the sender is
--             steering the conversation there ("my instagram",
--             "follow me on instagram"). A bare mention such as
--             "I need an Instagram logo design" is allowed.
insert into public.chat_block_rules (rule_group, pattern, mode, priority)
select g.grp, btrim(p.pat), g.mode, g.prio
from (values
  -- ---- abuse, threats, sexual, hate (checked first) -----------------
  ('abuse', 10, 'word',
   'i will kill you|i will beat you|i will deal with you|i will find you|i will expose you|i will leak your|i will report you if you dont pay|blackmail|i will blackmail|pay me or else|if you dont pay|i will ruin you|fool|idiot|stupid|useless|bastard|mumu|ode|animal|shut up|you are mad|crazy|witch|send nude|send naked|send pictures of your body|sex for job|sex for favour|sleep with me|touch you|kiss you|hate speech|tribal slur|racial slur|religious insult|disabled insult|gender insult|child porn|underage|minor nude|explicit sexual service'),

  -- ---- fraud, OTP, credentials, fake engagement ---------------------
  ('fraud', 20, 'word',
   'send otp|send your otp|share otp|otp code|verification code|send verification code|send code|share code|password|login details|login password|give me your password|your password|account access|give me access|share your login|credit card|debit card|card details|card number|cvv|bank pin|atm pin|bvn|nin|national id|send your bvn|send your nin|bank details|free money|guaranteed profit|double your money|investment opportunity|make money fast|quick money|advance fee|refund scam|phishing|send money to get money|pay to unlock|pay to receive|hack|hacking|hack account|steal password|fake review|fake follower|fake engagement|fake document|fake certificate|buy follower|buy review|illegal|academic cheating|do my assignment for me to submit as mine|write my exam|impersonate'),

  -- ---- payment circumvention ---------------------------------------
  ('payment', 30, 'word',
   'pay me directly|pay me direct|send money directly|pay outside|pay outside the platform|pay outside this app|pay me privately|pay privately|send money privately|pay me outside|transfer directly|send to my account|transfer to my account|send to my bank|pay to my bank|direct transfer|bank transfer|direct deposit|pay to my account|give me your account number|send your account number|my account number|my bank|my account details|my acct number|my opay|my palmpay|my moniepoint|my kuda|my first bank|my gtb|my access|my uba|my zenith|my wema|lets avoid commission|avoid commission|no commission|dont pay commission|skip commission|bypass commission|avoid platform charges|avoid platform fee|avoid charges|no platform fee|lets not use platform payment|dont pay through platform|dont use platform to pay|settle privately|lets settle privately|settle outside|pay cash|cash payment|pay with cash|cash app|paypal|venmo|skrill|neteller|western union|moneygram|crypto|bitcoin|btc|usdt|tether|binance pay|gift card|send gift card|pay with card|pay with crypto|i dont want to pay commission|i dont want to pay fee|commission is too much|platform fee is too high|lets save fee|lets save commission|cheaper outside|cheaper if you pay direct|i will give you discount if you pay direct|pay direct and get discount|refund outside|refund me directly|send refund to my account|cancel order and pay me'),

  -- ---- phone numbers, email, contact info --------------------------
  ('contact', 40, 'word',
   'phone number|mobile number|my number|your number|call me|text me|reach me|contact me|save my number|drop your number|send me your number|whats your number|give me your number|share your number|my line|my contact|my digits|gmail|yahoo mail|outlook|hotmail|my mail|send me your email|drop your email|whats your email|give me your email|send mail to'),

  -- ---- WhatsApp, Telegram and the other apps -----------------------
  ('app', 50, 'word',
   'whatsapp|whats app|watsapp|wats ap|whataap|watsap|wa|whatsapp number|chat me on whatsapp|reach me on whatsapp|add me on whatsapp|message me on whatsapp|my whatsapp|your whatsapp|send me whatsapp|whatsapp me|telegram|tele gram|tg|telegram username|chat on telegram|add me on telegram|my telegram|your telegram|telegram me|telegram link|telegram group|telegram channel|signal|discord|skype|snapchat|dm me|dm|inbox me|inbox|direct message|private message|pm me|find me on|follow me on|add me on|connect with me on|check my|my handle|my username|my social|my page|my profile link|x handle'),

  -- ---- moving the conversation outside -----------------------------
  ('outside', 60, 'word',
   'lets chat privately|lets talk privately|chat privately|talk privately|contact me privately|message me privately|lets go private|go private|lets chat outside|talk outside|chat outside|message me outside|lets move this|move this conversation|lets continue elsewhere|continue elsewhere|lets continue outside|lets talk elsewhere|talk elsewhere|lets do this outside|do this outside|lets settle outside|lets leave this platform|leave this platform|lets use another platform|use another platform|another platform|other platform|outside this app|outside the platform|off platform|off this platform|lets talk on call|lets do voice call|lets video call|call me on|lets meet|meet me|meet up|lets meet physically|come to my office|come to my place|my address|my location|send location|share location|add me|add me up|save me|lets connect|connect with me|lets link up|link up|lets hook up'),

  -- ---- external links ----------------------------------------------
  ('link', 70, 'word',
   'bit ly|tinyurl|short link|shortened link|click this link|check this link|open this link|whatsapp link|telegram link|forms gle|linktr ee|my link|my website|my portfolio link|visit my site|check my site|external checkout|payment link|pay here link|checkout link'),

  -- ---- spaced / dotted / starred / split spellings -----------------
  ('app', 50, 'compact',
   'whatsapp|watsapp|whataap|watsap|whatsappnumber|telegram|telegramusername|paypal|bitcoin|usdt|tether|binancepay|skype|discord|snapchat|neteller|skrill|moneygram|westernunion|cashapp|venmo|bitly|tinyurl|linktree|formsgle|tme|wame'),
  ('contact', 40, 'compact',
   'mynumber|yournumber|phonenumber|mobilenumber|myline|mycontact|mydigits|mywhatsapp|yourwhatsapp|mytelegram|yourtelegram|myemail|youremail|myaccountnumber|mybank|myopay|mypalmpay|mymoniepoint|mykuda|mygtb|myaccess|myuba|myzenith|mywema|myfirstbank|mybvn|mynin|myhandle|myusername|mysocial|mypage|myprofilelink|mylink|mywebsite|myportfolio|callme|textme|reachme|contactme|sendmeyournumber|dropyournumber|whatsyournumber|giveyournumber|shareyournumber'),
  ('outside', 60, 'compact',
   'letschatprivately|letstalkprivately|chatprivately|talkprivately|letsgoprivate|goprivate|letschatoutside|talkoutside|chatoutside|letsmovethis|movethisconversation|letscontinueelsewhere|continueelsewhere|letsleaveplatform|leaveplatform|letsmeet|meetme|meetup|addme|addmeup|letsconnect|connectwithme|letslinkup|linkup|letshookup'),
  ('payment', 30, 'compact',
   'paymedirectly|paymedirect|sendmoneydirectly|payoutside|payprivately|transferdirectly|banktransfer|directdeposit|myaccountnumber|mybank|myopay|mypalmpay|mymoniepoint|mykuda|mygtb|myaccess|myuba|myzenith|mywema|avoidcommission|nocommission|bypasscommission|avoidplatformfee|noplatformfee|settleprivately|settleoutside|paycash|cashpayment|cashapp|paypal|venmo|skrill|neteller|westernunion|moneygram|crypto|bitcoin|btc|usdt|tether|binancepay|giftcard|paywithcrypto'),

  -- ---- platform names that only matter with a "contact me" cue -----
  ('app', 50, 'cue',
   'instagram|ig|insta|facebook|fb|messenger|twitter|tiktok|snap|linkedin|threads|youtube channel')
) as g(grp, prio, mode, list)
cross join lateral unnest(string_to_array(g.list, '|')) as p(pat)
where btrim(p.pat) <> ''
  and not exists (
    select 1 from public.chat_block_rules r
     where r.rule_group = g.grp and r.pattern = btrim(p.pat) and r.mode = g.mode
  );

-- 1d. cue detector ----------------------------------------------------
create or replace function public.nm_has_cue(p_words text)
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
      from unnest(string_to_array(coalesce(p_words, ''), ' ')) as w
     where w in ('my','your','follow','add','dm','message','chat','contact','reach','find',
                 'check','handle','username','page','profile','link','send','share','give',
                 'drop','call','text','inbox','pm','connect','social','id','whatsapp',
                 'telegram','number','join','sub','subscribe','view','see')
  );
$$;

-- 1e. the checker -----------------------------------------------------
-- Returns the first rule that fires, or no row when the message is clean.
create or replace function public.nm_check_message(p_body text)
returns table (rule_group text, pattern text, matched text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw     text := lower(coalesce(p_body, ''));
  v_words   text := public.nm_normalize_words(p_body);
  v_compact text := replace(public.nm_normalize_words(p_body), ' ', '');
  v_digits  text := public.nm_digit_runs(p_body);
  v_dcomp   text := replace(public.nm_digit_runs(p_body), ' ', '');
  v_hit     text;
  r         record;
begin
  -- an actual email address, or an @domain fragment
  v_hit := substring(v_raw from '[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}');
  if v_hit is not null then
    return query select 'contact'::text, 'email address'::text, v_hit;
    return;
  end if;
  v_hit := substring(v_raw from '@(gmail|yahoo|outlook|hotmail|icloud|proton)[a-z.]*');
  if v_hit is not null then
    return query select 'contact'::text, 'email handle'::text, v_hit;
    return;
  end if;

  -- a 10 or 11 digit run written as one token
  v_hit := substring(v_digits from '(^| )([0-9]{10,11})( |$)');
  if v_hit is not null then
    return query select 'contact'::text, '10-11 digit number'::text, btrim(v_hit);
    return;
  end if;
  -- Nigerian mobile prefixes, including spaced / dotted / dashed forms
  v_hit := substring(v_dcomp from '(^|[^0-9])(0[789][01][0-9]{8})([^0-9]|$)');
  if v_hit is not null then
    return query select 'contact'::text, 'Nigerian mobile number'::text, regexp_replace(v_hit, '[^0-9]', '', 'g');
    return;
  end if;
  v_hit := substring(v_dcomp from '(^|[^0-9])(234[0-9]{9,10})([^0-9]|$)');
  if v_hit is not null then
    return query select 'contact'::text, 'international number'::text, regexp_replace(v_hit, '[^0-9]', '', 'g');
    return;
  end if;

  for r in
    select * from public.chat_block_rules
     where active
     order by priority, id
  loop
    if r.mode = 'word' then
      if (' ' || v_words || ' ') like ('% ' || r.pattern || ' %') then
        return query select r.rule_group, r.pattern, r.pattern;
        return;
      end if;

    elsif r.mode = 'compact' then
      if v_compact like '%' || replace(r.pattern, ' ', '') || '%' then
        return query select r.rule_group, r.pattern, r.pattern;
        return;
      end if;

    elsif r.mode = 'cue' then
      if (' ' || v_words || ' ') like ('% ' || r.pattern || ' %')
         and public.nm_has_cue(v_words) then
        return query select r.rule_group, r.pattern, r.pattern;
        return;
      end if;
    end if;
  end loop;

  return;
end $$;

grant execute on function public.nm_check_message(text) to authenticated, anon;

-- 1f. the admin log ---------------------------------------------------
create table if not exists public.blocked_messages (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid references public.chats(id) on delete set null,
  sender_id    uuid references auth.users(id) on delete set null,
  receiver_id  uuid references auth.users(id) on delete set null,
  body         text not null,
  rule_group   text not null,
  rule_pattern text not null,
  matched_text text,
  created_at   timestamptz not null default now()
);
create index if not exists blocked_messages_created_idx on public.blocked_messages(created_at desc);
create index if not exists blocked_messages_sender_idx on public.blocked_messages(sender_id);

alter table public.blocked_messages enable row level security;

-- admins read the log; nobody writes it directly (only the RPC does,
-- and it is SECURITY DEFINER).
drop policy if exists blocked_messages_admin_read on public.blocked_messages;
create policy blocked_messages_admin_read on public.blocked_messages for select
  using (public.is_admin());

-- 1g. the only way to send a message ---------------------------------
create or replace function public.send_chat_message(
  p_chat_id   uuid,
  p_body      text default null,
  p_image_url text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_chat     public.chats;
  v_receiver uuid;
  v_rule     record;
  v_msg      public.messages;
  v_body     text := nullif(btrim(coalesce(p_body, '')), '');
  v_image    text := nullif(btrim(coalesce(p_image_url, '')), '');
  v_warning  text := 'This message was not sent because it contains restricted contact, payment, or external platform information. Please keep all communication and payment inside the platform.';
begin
  if v_uid is null then
    raise exception 'Sign in to send a message.';
  end if;

  select * into v_chat from public.chats where id = p_chat_id;
  if not found then
    raise exception 'Chat not found.';
  end if;
  if v_chat.buyer_id <> v_uid and v_chat.seller_id <> v_uid then
    raise exception 'This chat is not yours.';
  end if;

  v_receiver := case when v_chat.buyer_id = v_uid then v_chat.seller_id else v_chat.buyer_id end;

  if v_body is null and v_image is null then
    raise exception 'Type a message first.';
  end if;

  if v_body is not null then
    select * into v_rule from public.nm_check_message(v_body) limit 1;
    if found then
      insert into public.blocked_messages
        (chat_id, sender_id, receiver_id, body, rule_group, rule_pattern, matched_text)
      values
        (p_chat_id, v_uid, v_receiver, v_body, v_rule.rule_group, v_rule.pattern, v_rule.matched);

      -- Nothing is inserted into `messages`: the receiver never sees it,
      -- and no partial or masked copy is sent.
      return jsonb_build_object('blocked', true, 'warning', v_warning);
    end if;
  end if;

  insert into public.messages (chat_id, sender_id, body, image_url)
  values (p_chat_id, v_uid, v_body, v_image)
  returning * into v_msg;

  return jsonb_build_object('blocked', false, 'message', to_jsonb(v_msg));
end $$;

grant execute on function public.send_chat_message(uuid, text, text) to authenticated;

-- 1h. close the direct-insert door -----------------------------------
-- Before this, a client could POST straight to /rest/v1/messages and
-- skip the checker entirely. The RPC is SECURITY DEFINER, so it does not
-- need this policy.
drop policy if exists messages_insert on public.messages;

-- 1i. second layer: a trigger, so even a service-role insert of blocked
-- content is refused. Only applies to real user requests (auth.uid() is
-- not null), which leaves seeds and system writes alone.
create or replace function public.tg_messages_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule record;
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.body is null or btrim(new.body) = '' then
    return new;
  end if;

  select * into v_rule from public.nm_check_message(new.body) limit 1;
  if found then
    raise exception 'This message was not sent because it contains restricted contact, payment, or external platform information. Please keep all communication and payment inside the platform.';
  end if;
  return new;
end $$;

drop trigger if exists t_messages_guard on public.messages;
create trigger t_messages_guard before insert on public.messages
  for each row execute function public.tg_messages_guard();

-- ---------------------------------------------------------------------
-- 2. PAYMENT ACCOUNTS
-- ---------------------------------------------------------------------
create table if not exists public.payment_accounts (
  id               uuid primary key default gen_random_uuid(),
  bank_name        text not null,
  account_number   text not null,
  account_name     text not null,
  label            text,
  note             text,
  active           boolean not null default true,
  sort_order       int not null default 0,
  assigned_count   int not null default 0,
  last_assigned_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists payment_accounts_active_idx on public.payment_accounts(active, sort_order);

drop trigger if exists t_payment_accounts on public.payment_accounts;
create trigger t_payment_accounts before update on public.payment_accounts
  for each row execute function public.tg_touch_updated_at();

alter table public.payment_accounts enable row level security;

-- Only admins may read or write the list. A buyer gets their assigned
-- account through `my_payment_account()` (SECURITY DEFINER) and through
-- the order row, never by listing the table.
drop policy if exists payment_accounts_admin on public.payment_accounts;
create policy payment_accounts_admin on public.payment_accounts for all
  using (public.is_admin()) with check (public.is_admin());

-- which buyer was shown which account, and until when
create table if not exists public.payment_account_assignments (
  id          uuid primary key default gen_random_uuid(),
  buyer_id    uuid not null references auth.users(id) on delete cascade,
  account_id  uuid not null references public.payment_accounts(id) on delete cascade,
  order_id    uuid references public.orders(id) on delete set null,
  assigned_at timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '6 hours'
);
create index if not exists payment_account_assignments_buyer_idx
  on public.payment_account_assignments(buyer_id, assigned_at desc);

alter table public.payment_account_assignments enable row level security;

drop policy if exists payment_account_assignments_admin on public.payment_account_assignments;
create policy payment_account_assignments_admin on public.payment_account_assignments for select
  using (public.is_admin());

-- the order and the payment row remember where the money was sent
alter table public.orders   add column if not exists payment_account_id uuid references public.payment_accounts(id) on delete set null;
alter table public.payments add column if not exists payment_account_id uuid references public.payment_accounts(id) on delete set null;

-- carry the existing single account over, once
insert into public.payment_accounts (bank_name, account_number, account_name, label, sort_order)
select s.bank_name, s.bank_account_number, s.bank_account_name, 'Primary', 0
  from public.platform_settings s
 where s.id = 1
   and coalesce(btrim(s.bank_account_number), '') <> ''
   and not exists (select 1 from public.payment_accounts);

-- 2a. pick / reserve an account for the signed-in buyer ---------------
-- Round-robin over the active accounts (least recently assigned first),
-- never the same account the buyer was given last time while more than
-- one is active. The reservation is reused for 6 hours so the account
-- shown at checkout is the account stored on the order.
create or replace function public.my_payment_account()
returns public.payment_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_acct public.payment_accounts;
  v_last uuid;
  v_n    int;
begin
  if v_uid is null then
    raise exception 'Sign in first.';
  end if;

  -- a live reservation wins, so checkout and order creation agree
  select a.* into v_acct
    from public.payment_account_assignments s
    join public.payment_accounts a on a.id = s.account_id
   where s.buyer_id = v_uid
     and s.expires_at > now()
     and a.active
   order by s.assigned_at desc
   limit 1;
  if found then
    return v_acct;
  end if;

  select count(*) into v_n from public.payment_accounts where active;
  if v_n = 0 then
    raise exception 'No payment account is set up yet. Please contact support.';
  end if;

  select account_id into v_last
    from public.payment_account_assignments
   where buyer_id = v_uid
   order by assigned_at desc
   limit 1;

  select * into v_acct
    from public.payment_accounts a
   where a.active
     and (v_n = 1 or a.id is distinct from v_last)
   order by a.assigned_count asc, a.last_assigned_at asc nulls first, a.sort_order asc, a.id
   limit 1;

  if not found then
    select * into v_acct from public.payment_accounts where active order by sort_order, id limit 1;
  end if;

  update public.payment_accounts
     set assigned_count = assigned_count + 1,
         last_assigned_at = now()
   where id = v_acct.id;

  insert into public.payment_account_assignments (buyer_id, account_id, expires_at)
  values (v_uid, v_acct.id, now() + interval '6 hours');

  return v_acct;
end $$;

grant execute on function public.my_payment_account() to authenticated;

-- 2b. admin CRUD ------------------------------------------------------
create or replace function public.admin_save_payment_account(
  p_id             uuid,
  p_bank_name      text,
  p_account_number text,
  p_account_name   text,
  p_label          text default null,
  p_note           text default null,
  p_active         boolean default true,
  p_sort_order     int default 0
) returns public.payment_accounts
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.payment_accounts;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if coalesce(btrim(p_bank_name), '') = ''
     or coalesce(btrim(p_account_number), '') = ''
     or coalesce(btrim(p_account_name), '') = '' then
    raise exception 'Bank name, account number and account name are all required.';
  end if;

  if p_id is null then
    insert into public.payment_accounts
      (bank_name, account_number, account_name, label, note, active, sort_order)
    values
      (btrim(p_bank_name), btrim(p_account_number), btrim(p_account_name),
       nullif(btrim(coalesce(p_label, '')), ''), nullif(btrim(coalesce(p_note, '')), ''),
       coalesce(p_active, true), coalesce(p_sort_order, 0))
    returning * into v_row;
  else
    update public.payment_accounts
       set bank_name      = btrim(p_bank_name),
           account_number = btrim(p_account_number),
           account_name   = btrim(p_account_name),
           label          = nullif(btrim(coalesce(p_label, '')), ''),
           note           = nullif(btrim(coalesce(p_note, '')), ''),
           active         = coalesce(p_active, active),
           sort_order     = coalesce(p_sort_order, sort_order)
     where id = p_id
     returning * into v_row;
    if not found then raise exception 'Account not found.'; end if;
  end if;

  return v_row;
end $$;

create or replace function public.admin_delete_payment_account(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  -- keep history: deactivate instead of deleting when an order used it
  if exists (select 1 from public.orders where payment_account_id = p_id) then
    update public.payment_accounts set active = false where id = p_id;
  else
    delete from public.payment_accounts where id = p_id;
  end if;
end $$;

grant execute on function public.admin_save_payment_account(uuid, text, text, text, text, text, boolean, int) to authenticated;
grant execute on function public.admin_delete_payment_account(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. place_order — distance rule + assigned account
-- ---------------------------------------------------------------------
create or replace function public.place_order(
  p_shop_id    uuid,
  p_items      jsonb,
  p_fulfilment text default 'delivery',
  p_address    text default null,
  p_note       text default null
) returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_shop     public.shops;
  v_buyer    public.profiles;
  v_item     jsonb;
  v_listing  public.listings;
  v_qty      int;
  v_subtotal numeric(12,2) := 0;
  v_fee      numeric(12,2) := 0;
  v_total    numeric(12,2) := 0;
  v_order    public.orders;
  v_cfg      public.platform_settings;
  v_lines    jsonb := '[]'::jsonb;
  v_acct     public.payment_accounts;
  v_min      numeric(12,2);
  v_same_state boolean;
  v_same_lga   boolean;
begin
  if v_uid is null then raise exception 'Please sign in to place an order.'; end if;

  select * into v_buyer from public.profiles where id = v_uid;
  if v_buyer.is_banned then raise exception 'This account is suspended. Contact support.'; end if;

  select * into v_shop from public.shops where id = p_shop_id;
  if not found then raise exception 'That shop no longer exists.'; end if;
  if v_shop.status <> 'approved' then raise exception 'This shop is not taking orders right now.'; end if;

  if p_fulfilment not in ('delivery','pickup') then
    raise exception 'Choose delivery or pickup.';
  end if;
  if p_fulfilment = 'delivery' and coalesce(trim(p_address), '') = '' then
    raise exception 'Add a delivery address first.';
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'Your cart is empty.';
  end if;

  select * into v_cfg from public.platform_settings where id = 1;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(coalesce((v_item->>'quantity')::int, 1), 1);

    select * into v_listing from public.listings
      where id = (v_item->>'listing_id')::uuid and shop_id = p_shop_id;
    if not found then
      raise exception 'An item in your cart is no longer available.';
    end if;
    if v_listing.status <> 'live' then
      raise exception '% is not available right now.', v_listing.title;
    end if;
    if v_listing.type = 'product' and v_listing.stock < v_qty then
      raise exception 'Only % left of %.', v_listing.stock, v_listing.title;
    end if;

    v_subtotal := v_subtotal + (v_listing.price * v_qty);
    v_lines := v_lines || jsonb_build_object(
      'listing_id', v_listing.id,
      'title', v_listing.title,
      'unit_price', v_listing.price,
      'quantity', v_qty,
      'line_total', (v_listing.price * v_qty)
    );
  end loop;

  -- delivery fee: the most specific listing override wins, else the shop default
  if p_fulfilment = 'delivery' then
    v_fee := v_shop.delivery_fee;
    select coalesce(max((d->>'delivery_fee_override')::numeric), v_shop.delivery_fee)
      into v_fee
      from jsonb_array_elements(v_lines) d
      join public.listings l on l.id = (d->>'listing_id')::uuid
      where l.delivery_fee_override is not null;

    if v_shop.free_delivery_threshold is not null
       and v_subtotal >= v_shop.free_delivery_threshold then
      v_fee := 0;
    end if;
  else
    v_fee := 0;
  end if;

  if v_fee is null then v_fee := coalesce(v_cfg.default_delivery_fee, 0); end if;
  v_total := v_subtotal + v_fee;

  -- ------------------------------------------------------------------
  -- DISTANCE RULE (server-side, cannot be skipped from the browser)
  --   total >  cross_lga_min_total  -> any LGA, but inside the buyer's state
  --   total <= cross_lga_min_total  -> the buyer's own state AND LGA
  -- A missing state/LGA on either side is treated as "no restriction",
  -- which is the old behaviour for profiles that never set a location.
  -- ------------------------------------------------------------------
  v_min := coalesce(v_cfg.cross_lga_min_total, 20000);
  v_same_state := (v_buyer.state is null or v_shop.state is null
                   or lower(btrim(v_buyer.state)) = lower(btrim(v_shop.state)));
  v_same_lga   := (v_buyer.city is null or v_shop.city is null
                   or lower(btrim(v_buyer.city)) = lower(btrim(v_shop.city)));

  if v_total > v_min then
    if not v_same_state then
      raise exception 'This seller is in % state. Orders over % can be delivered to any LGA in your own state (%), but not outside it.',
        coalesce(v_shop.state, 'another'), to_char(v_min, 'FM999,999,999'), coalesce(v_buyer.state, 'your state');
    end if;
  else
    if not v_same_state or not v_same_lga then
      raise exception 'This seller is in %, outside your LGA (%). Orders under % can only be placed with sellers in your own LGA — add more items to reach % and you can order from any LGA in % state.',
        coalesce(v_shop.city, v_shop.state, 'another area'),
        coalesce(v_buyer.city, 'not set'),
        to_char(v_min, 'FM999,999,999'),
        to_char(v_min, 'FM999,999,999'),
        coalesce(v_buyer.state, 'your');
    end if;
  end if;

  -- the account the buyer was shown at checkout
  v_acct := public.my_payment_account();

  insert into public.orders (
    buyer_id, shop_id, status, fulfilment, subtotal, delivery_fee, total,
    commission_rate, commission_amount, payout_amount, payout_status,
    buyer_note, address, payment_account_id
  ) values (
    v_uid, p_shop_id, 'pending_payment', p_fulfilment, v_subtotal, v_fee, v_total,
    v_cfg.commission_rate, round(v_total * v_cfg.commission_rate, 2),
    round(v_total * (1 - v_cfg.commission_rate), 2), 'held',
    p_note, p_address, v_acct.id
  ) returning * into v_order;

  insert into public.order_items (order_id, listing_id, title, unit_price, quantity, line_total)
  select v_order.id, (d->>'listing_id')::uuid, d->>'title',
         (d->>'unit_price')::numeric, (d->>'quantity')::int, (d->>'line_total')::numeric
  from jsonb_array_elements(v_lines) d;

  -- reserve stock immediately so two buyers can't take the last unit
  update public.listings l
    set stock = l.stock - (d->>'quantity')::int,
        status = case when l.stock - (d->>'quantity')::int <= 0 and l.type = 'product'
                      then 'out_of_stock' else l.status end
    from jsonb_array_elements(v_lines) d
    where l.id = (d->>'listing_id')::uuid and l.type = 'product';

  -- buyer "receipts" list needs the payment row to exist
  insert into public.payments (order_id, type, amount, reference, payment_account_id)
  values (v_order.id, 'order', v_total, v_order.reference, v_acct.id);

  -- the reservation is spent: the next order rotates to another account
  update public.payment_account_assignments
     set order_id = v_order.id, expires_at = now()
   where buyer_id = v_uid and account_id = v_acct.id and order_id is null;

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- 4. accept_offer — same account assignment for service orders
-- ---------------------------------------------------------------------
create or replace function public.accept_offer(p_offer_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_offer public.offers; v_chat public.chats; v_shop uuid;
  v_order public.orders; v_cfg public.platform_settings;
  v_acct public.payment_accounts;
begin
  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then raise exception 'Offer not found.'; end if;
  if v_offer.buyer_id <> auth.uid() then raise exception 'This offer is not yours.'; end if;
  if v_offer.status <> 'pending' then raise exception 'This offer was already answered.'; end if;

  select * into v_chat from public.chats where id = v_offer.chat_id;
  v_shop := v_chat.shop_id;
  if v_shop is null then raise exception 'This chat is not linked to a shop.'; end if;

  select * into v_cfg from public.platform_settings where id = 1;
  v_acct := public.my_payment_account();

  insert into public.orders (
    buyer_id, shop_id, status, fulfilment, subtotal, delivery_fee, total,
    commission_rate, commission_amount, payout_amount, payout_status, buyer_note,
    payment_account_id
  ) values (
    auth.uid(), v_shop, 'pending_payment', 'pickup', v_offer.price, 0, v_offer.price,
    v_cfg.commission_rate, round(v_offer.price * v_cfg.commission_rate, 2),
    round(v_offer.price * (1 - v_cfg.commission_rate), 2), 'held',
    'Service: ' || coalesce(v_offer.scope, 'Quoted job'), v_acct.id
  ) returning * into v_order;

  insert into public.order_items (order_id, title, unit_price, quantity, line_total)
  values (v_order.id, 'Service — ' || coalesce(v_offer.scope, 'Quoted job'),
          v_offer.price, 1, v_offer.price);

  update public.offers set status = 'accepted', order_id = v_order.id where id = p_offer_id;
  update public.offers set status = 'declined'
   where chat_id = v_offer.chat_id and id <> p_offer_id and status = 'pending';
  update public.enquiries set status = 'accepted'
   where id = (select enquiry_id from public.chats where id = v_offer.chat_id);

  insert into public.payments (order_id, type, amount, reference, payment_account_id)
  values (v_order.id, 'order', v_order.total, v_order.reference, v_acct.id);

  update public.payment_account_assignments
     set order_id = v_order.id, expires_at = now()
   where buyer_id = auth.uid() and account_id = v_acct.id and order_id is null;

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- 5. PAYOUT HOLD — 4 days after delivery confirmation
-- ---------------------------------------------------------------------
create or replace function public.confirm_delivery(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders;
  v_days  int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if v_order.buyer_id <> auth.uid() then raise exception 'Not your order.'; end if;
  if v_order.status not in ('shipped','ready_for_pickup','delivered') then
    raise exception 'You can confirm only after the seller has shipped or prepared the item.';
  end if;
  if v_order.status = 'delivered' then return; end if;

  select coalesce(payout_hold_days, 4) into v_days from public.platform_settings where id = 1;
  v_days := coalesce(v_days, 4);

  update public.orders
     set status = 'delivered', delivered_at = now(),
         payout_status = 'released',
         auto_confirm_at = coalesce(auto_confirm_at, now() + interval '7 days')
   where id = p_order_id;

  -- the seller's money unlocks `payout_hold_days` after this moment
  insert into public.payouts (shop_id, order_id, amount, gross_amount, commission_amount, kind, status, available_at)
  values (v_order.shop_id, v_order.id, v_order.payout_amount, v_order.total,
          v_order.commission_amount, 'order', 'queued', now() + make_interval(days => v_days))
  on conflict do nothing;
end $$;

create or replace function public.admin_resolve_dispute(
  p_dispute_id uuid, p_outcome text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_d public.disputes; v_order public.orders; v_days int;
begin
  if not public.is_admin() then raise exception 'Admins only.'; end if;
  if p_outcome not in ('resolved_buyer','resolved_seller') then
    raise exception 'Choose who the dispute resolves in favour of.';
  end if;

  select * into v_d from public.disputes where id = p_dispute_id for update;
  if not found then raise exception 'Dispute not found.'; end if;
  select * into v_order from public.orders where id = v_d.order_id for update;

  update public.disputes
     set status = p_outcome, resolution_note = p_note,
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_dispute_id;

  if p_outcome = 'resolved_buyer' then
    update public.orders set status = 'cancelled', payout_status = 'held' where id = v_order.id;
    delete from public.payouts where order_id = v_order.id and status = 'queued';
  else
    select coalesce(payout_hold_days, 4) into v_days from public.platform_settings where id = 1;
    v_days := coalesce(v_days, 4);

    update public.orders
       set status = 'delivered', delivered_at = coalesce(delivered_at, now()), payout_status = 'released'
     where id = v_order.id;
    insert into public.payouts (shop_id, order_id, amount, gross_amount, commission_amount, kind, status, available_at)
    values (v_order.shop_id, v_order.id, v_order.payout_amount, v_order.total,
            v_order.commission_amount, 'order', 'queued', now() + make_interval(days => v_days));
  end if;
end $$;

create or replace function public.request_payout(p_shop_id uuid)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_amount numeric(12,2); v_days int;
begin
  if not public.owns_shop(p_shop_id) then raise exception 'Not your shop.'; end if;

  select coalesce(payout_hold_days, 4) into v_days from public.platform_settings where id = 1;
  v_days := coalesce(v_days, 4);

  select coalesce(sum(amount), 0) into v_amount
    from public.payouts
   where shop_id = p_shop_id and status = 'queued'
     and requested_at is null and available_at <= now();

  if v_amount <= 0 then
    raise exception 'Nothing available to withdraw yet. Payouts unlock % days after delivery confirmation.', v_days;
  end if;

  update public.payouts
     set requested_at = now(), reference = 'PO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6))
   where shop_id = p_shop_id and status = 'queued'
     and requested_at is null and available_at <= now();

  return v_amount;
end $$;

-- run_order_timers: the auto-confirm branch must honour the same hold
create or replace function public.run_order_timers()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cancel int := 0; v_confirm int := 0; v_expire int := 0; v_hide int := 0;
  v_days int;
begin
  select coalesce(payout_hold_days, 4) into v_days from public.platform_settings where id = 1;
  v_days := coalesce(v_days, 4);

  -- seller did not accept within 24h
  with stale as (
    update public.orders
       set status = 'cancelled', decline_reason = 'Seller did not accept within 24 hours. Refund due.'
     where status = 'paid' and auto_cancel_at is not null and auto_cancel_at < now()
     returning id, shop_id
  )
  select count(*) into v_cancel from stale;

  with back as (
    select oi.listing_id, oi.quantity
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
     where o.status = 'cancelled' and o.decline_reason = 'Seller did not accept within 24 hours. Refund due.'
       and o.updated_at > now() - interval '1 minute'
  )
  update public.listings l set stock = l.stock + back.quantity,
         status = case when l.status = 'out_of_stock' then 'live' else l.status end
    from back where l.id = back.listing_id and l.type = 'product';

  -- buyer never confirmed — trust the delivery after 7 days
  with auto as (
    update public.orders
       set status = 'delivered', delivered_at = coalesce(delivered_at, now()), payout_status = 'released'
     where status in ('shipped','ready_for_pickup')
       and shipped_at is not null and shipped_at < now() - interval '7 days'
     returning id, shop_id, payout_amount, total, commission_amount
  )
  select count(*) into v_confirm from auto;

  insert into public.payouts (shop_id, order_id, amount, gross_amount, commission_amount, kind, status, available_at)
  select o.shop_id, o.id, o.payout_amount, o.total, o.commission_amount, 'order', 'queued',
         now() + make_interval(days => v_days)
    from public.orders o
   where o.status = 'delivered' and o.payout_status = 'released'
     and not exists (select 1 from public.payouts p where p.order_id = o.id);

  -- subscription lapse → shops stop taking orders, listings hide
  with lapsed as (
    update public.shops
       set subscription_status = 'expired'
     where subscription_status = 'active'
       and subscription_expires_at is not null and subscription_expires_at < now()
     returning id
  )
  select count(*) into v_expire from lapsed;

  with hidden as (
    update public.listings l set status = 'hidden'
      from public.shops s
     where s.id = l.shop_id and s.subscription_status = 'expired' and l.status = 'live'
     returning l.id
  )
  select count(*) into v_hide from hidden;

  return jsonb_build_object('cancelled', v_cancel, 'auto_confirmed', v_confirm,
                            'subscriptions_expired', v_expire, 'listings_hidden', v_hide,
                            'payout_hold_days', v_days);
end $$;

grant execute on function public.run_order_timers() to authenticated, anon;

-- ---------------------------------------------------------------------
-- 6. checkout range helper — lets the UI show the same message the RPC
--    would raise, without duplicating the rule in TypeScript.
-- ---------------------------------------------------------------------
create or replace function public.checkout_range(p_shop_id uuid, p_total numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_buyer public.profiles;
  v_shop  public.shops;
  v_min   numeric(12,2);
  v_same_state boolean;
  v_same_lga   boolean;
begin
  select coalesce(cross_lga_min_total, 20000) into v_min from public.platform_settings where id = 1;
  v_min := coalesce(v_min, 20000);

  select * into v_shop from public.shops where id = p_shop_id;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'That shop no longer exists.');
  end if;

  if v_uid is null then
    return jsonb_build_object('allowed', true, 'threshold', v_min);
  end if;

  select * into v_buyer from public.profiles where id = v_uid;

  v_same_state := (v_buyer.state is null or v_shop.state is null
                   or lower(btrim(v_buyer.state)) = lower(btrim(v_shop.state)));
  v_same_lga   := (v_buyer.city is null or v_shop.city is null
                   or lower(btrim(v_buyer.city)) = lower(btrim(v_shop.city)));

  if coalesce(p_total, 0) > v_min then
    if v_same_state then
      return jsonb_build_object('allowed', true, 'threshold', v_min, 'mode', 'state');
    end if;
    return jsonb_build_object(
      'allowed', false, 'threshold', v_min, 'mode', 'state',
      'reason', format('This seller is in %s state. Orders over %s can be delivered to any LGA in your own state (%s), but not outside it.',
                       coalesce(v_shop.state, 'another'), to_char(v_min, 'FM999,999,999'), coalesce(v_buyer.state, 'your state')));
  end if;

  if v_same_state and v_same_lga then
    return jsonb_build_object('allowed', true, 'threshold', v_min, 'mode', 'lga');
  end if;

  return jsonb_build_object(
    'allowed', false, 'threshold', v_min, 'mode', 'lga',
    'reason', format('This seller is in %s, outside your LGA (%s). Orders under %s can only be placed with sellers in your own LGA — add more items to reach %s and you can order from any LGA in %s state.',
                     coalesce(v_shop.city, v_shop.state, 'another area'),
                     coalesce(v_buyer.city, 'not set'),
                     to_char(v_min, 'FM999,999,999'),
                     to_char(v_min, 'FM999,999,999'),
                     coalesce(v_buyer.state, 'your')));
end $$;

grant execute on function public.checkout_range(uuid, numeric) to authenticated, anon;

-- ---------------------------------------------------------------------
-- 7. admin view of the blocked-message log
-- ---------------------------------------------------------------------
-- `security_invoker = true` matters: without it the view runs as its
-- owner and would hand every blocked message to any signed-in user,
-- bypassing the admin-only RLS policy on the table underneath.
create or replace view public.blocked_messages_admin
with (security_invoker = true) as
  select b.id, b.chat_id, b.sender_id, b.receiver_id, b.body,
         b.rule_group, b.rule_pattern, b.matched_text, b.created_at,
         sp.full_name as sender_name, rp.full_name as receiver_name
    from public.blocked_messages b
    left join public.profiles sp on sp.id = b.sender_id
    left join public.profiles rp on rp.id = b.receiver_id;

grant select on public.blocked_messages_admin to authenticated;

-- ---------------------------------------------------------------------
-- 8. Tell PostgREST to reload its schema cache
--
-- Without this the API keeps serving the schema it read at boot: every new
-- function returns "Could not find the function public.<name>(...) in the
-- schema cache" and the new tables are invisible, even though the objects
-- exist in Postgres. The app then fails at runtime with an error that reads
-- like missing code rather than a stale cache.
--
-- NOTIFY is delivered after this transaction commits, so the reload cannot
-- race the DDL.
-- ---------------------------------------------------------------------
notify pgrst, 'reload schema';
