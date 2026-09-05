-- Financial assessment report.
--
--   psql "$DATABASE_URL" -f assess.sql                       -- busiest user, 6 months
--   psql "$DATABASE_URL" -v email=you@example.com -v months=12 -f assess.sql
--
-- Read-only. Every date is resolved through the user's own `timezone_offset`
-- rather than the server clock, so months match what the app shows.

\set ON_ERROR_STOP on
\pset pager off
\timing off

\if :{?email}
\else
  \set email ''
\endif
\if :{?months}
\else
  \set months 6
\endif

-- Target user: the named one, else whoever has the most transactions.
create temp view me as
  select u.id, u.timezone_offset tz, u.currency, u.email
  from users u
  where (:'email' = '' or u.email = :'email')
  order by (select count(*) from transactions t where t.user_id = u.id) desc
  limit 1;

-- Fail loudly on an email that matches nobody. Without this every section below
-- returns zero rows, and an empty report reads exactly like a clean one.
-- The address goes through a table because psql does not interpolate variables
-- inside a dollar-quoted block.
create temp table _param as select :'email'::text email;
do $$
begin
  if not exists (select 1 from me) then
    raise exception 'finance-assess: no user matched "%" -- check the address, or omit -v email to use the busiest user',
      (select email from _param);
  end if;
end $$;

-- `ld` is the user's local wall-clock time. getTimezoneOffset() convention:
-- UTC+8 is -480, so subtracting the offset adds 8 hours.
create temp view l as
  select t.*, (t.date - (select tz from me) * interval '1 minute') ld
  from transactions t
  where t.user_id = (select id from me);

create temp view nowl as
  select (now() - (select tz from me) * interval '1 minute') n;

create temp view win as
  select date_trunc('month', (select n from nowl)) - (:months - 1) * interval '1 month' s;

-- Per-month coverage. A month logged on 16 of 31 days is not a cheap month,
-- it is a month with the data missing, and averaging it in drags every
-- downstream figure toward a number nothing actually spent.
create temp view mon as
  select to_char(ld, 'YYYY-MM') m,
         count(*) n,
         count(distinct ld::date) days,
         extract(day from date_trunc('month', ld) + interval '1 month - 1 day')::int dim,
         sum(amount) filter (where type = 'INCOME')::numeric inc,
         sum(amount) filter (where type = 'EXPENSE')::numeric exp
  from l where ld >= (select s from win)
  group by 1, 4;

create temp view good as
  select m from mon
  where 100.0 * days / dim >= 60
    and m < to_char((select n from nowl), 'YYYY-MM');

\qecho ''
\qecho '=== WHO / WINDOW ==='
-- `newest_row` exposes staleness: a local mirror of production drifts the
-- moment the app is used again, and a stale snapshot answers "this month"
-- with a confident number that is simply out of date.
select email, currency, tz offset_min,
       to_char((select n from nowl), 'YYYY-MM-DD') today,
       :months || ' months' window_months,
       (select max(created_at)::date from l) newest_row
from me;

\qecho ''
\qecho '=== 1. DATA CONFIDENCE (months excluded from all math below) ==='
select m as mth, n as txns, days days_logged, dim,
       round(100.0 * days / dim) coverage_pct,
       case when m >= to_char((select n from nowl), 'YYYY-MM') then 'PARTIAL - current month'
            when 100.0 * days / dim < 60 then 'EXCLUDED - low coverage'
            else 'ok' end status
from mon order by m;

\qecho ''
\qecho '--- gaps of 4+ days with nothing logged ---'
select d last_logged, nd next_logged, (nd - d) gap_days
from (select ld::date d, lead(ld::date) over (order by ld::date) nd
      from (select distinct ld::date ld from l where ld >= (select s from win)) x) y
where nd - d > 3 order by gap_days desc limit 8;

\qecho ''
\qecho '=== 2. HEADLINE (trustworthy months only) ==='
select count(*) months,
       round(sum(inc)) income, round(sum(exp)) expenses,
       round(sum(inc) - sum(exp)) net,
       round(100.0 * (sum(inc) - sum(exp)) / nullif(sum(inc), 0)) savings_pct,
       round(avg(exp)) avg_monthly_burn
from mon where m in (select m from good);

\qecho ''
\qecho '--- balance and runway ---'
select round(sum(case when type = 'INCOME' then amount else -amount end)::numeric) running_balance,
       round((sum(case when type = 'INCOME' then amount else -amount end)::numeric)
             / nullif((select avg(exp) from mon where m in (select m from good)), 0), 1) months_of_runway
from l;

\qecho ''
\qecho '=== 3. BILL ACCURACY (budgeted vs actually paid) ==='
select s.description bill, round(s.amount::numeric) budgeted,
       count(t.id) payments, round(avg(t.amount)::numeric) avg_paid,
       round(max(t.amount)::numeric) worst,
       case when count(t.id) = 0 then null
            else round(100.0 * (avg(t.amount)::numeric - s.amount::numeric) / nullif(s.amount::numeric, 0)) end variance_pct
from scheduled_transactions s
  left join transactions t on t.bill_id = s.id
where s.user_id = (select id from me) and s.is_active
group by s.id, s.description, s.amount
order by abs(coalesce(avg(t.amount), s.amount) - s.amount) desc;

\qecho ''
\qecho '--- payments matching a bill name but NOT linked to it (paid outside the bill) ---'
select s.description bill, count(*) unlinked, round(sum(t.amount)::numeric) total
from scheduled_transactions s
  join l t on lower(btrim(t.description)) = lower(btrim(s.description)) and t.bill_id is null
where s.user_id = (select id from me) and s.is_active
group by 1 order by 2 desc;

\qecho ''
\qecho '=== 4. CATEGORY TREND (last full month vs earlier trustworthy months) ==='
with c as (
  select to_char(l.ld, 'YYYY-MM') m, cat.name, sum(l.amount)::numeric amt
  from l join categories cat on cat.id = l.category_id
  where l.type = 'EXPENSE' and to_char(l.ld, 'YYYY-MM') in (select m from good)
  group by 1, 2),
last_m as (select max(m) m from good)
select c.name category,
       round(max(amt) filter (where c.m = (select m from last_m))) last_month,
       round(avg(amt) filter (where c.m <> (select m from last_m))) prior_avg,
       round(100.0 * (max(amt) filter (where c.m = (select m from last_m))
             - avg(amt) filter (where c.m <> (select m from last_m)))
             / nullif(avg(amt) filter (where c.m <> (select m from last_m)), 0)) change_pct
from c group by c.name
having max(amt) filter (where c.m = (select m from last_m)) is not null
order by abs(coalesce(100.0 * (max(amt) filter (where c.m = (select m from last_m))
            - avg(amt) filter (where c.m <> (select m from last_m)))
            / nullif(avg(amt) filter (where c.m <> (select m from last_m)), 0), 0)) desc
limit 12;

\qecho ''
\qecho '=== 5. RECURRING SPEND (4+ distinct months) ==='
select lower(btrim(description)) item,
       count(distinct to_char(ld, 'YYYY-MM')) months,
       count(*) times,
       round(avg(amount)::numeric) avg_amt,
       round(sum(amount)::numeric) total
from l where type = 'EXPENSE' and ld >= (select s from win)
group by 1 having count(distinct to_char(ld, 'YYYY-MM')) >= 4
order by total desc limit 15;

\qecho ''
\qecho '--- new recurring charges: first seen in the last 120 days ---'
select lower(btrim(description)) item, count(*) times,
       min(ld)::date first_seen, round(avg(amount)::numeric) avg_amt
from l where type = 'EXPENSE'
group by 1 having count(*) >= 2 and min(ld) > (select n from nowl) - interval '120 days'
order by avg(amount) desc limit 10;

\qecho ''
\qecho '=== 6. POSSIBLE DUPLICATES (same day, description and amount) ==='
select ld::date as dayk, description, round(amount::numeric) amt, count(*) copies
from l where ld >= (select s from win)
group by 1, 2, 3 having count(*) > 1
order by amt desc limit 10;

\qecho ''
\qecho '=== 7. INCOME CONCENTRATION ==='
select lower(btrim(description)) source,
       count(*) n, round(sum(amount)::numeric) total,
       round(100.0 * sum(amount)::numeric
             / nullif((select sum(amount)::numeric from l
                       where type = 'INCOME' and to_char(ld, 'YYYY-MM') in (select m from good)), 0)) pct
from l where type = 'INCOME' and to_char(ld, 'YYYY-MM') in (select m from good)
group by 1 order by total desc limit 8;

\qecho ''
\qecho '=== 8. UNLABELED SPEND (split by whether a bill created it) ==='
select case when t.bill_id is not null then 'bill payment (auto-created)'
            else 'manually entered' end kind,
       count(*) txns, round(sum(t.amount)::numeric) total
from l t left join transaction_labels tl on tl.transaction_id = t.id
where t.type = 'EXPENSE' and tl.transaction_id is null
  and to_char(t.ld, 'YYYY-MM') in (select m from good)
group by 1 order by total desc;

\qecho ''
\qecho '--- largest unlabeled ---'
select t.ld::date as dayk, t.description, round(t.amount::numeric) amt,
       (t.bill_id is not null) from_bill
from l t left join transaction_labels tl on tl.transaction_id = t.id
where t.type = 'EXPENSE' and tl.transaction_id is null
  and to_char(t.ld, 'YYYY-MM') in (select m from good)
order by t.amount desc limit 8;

\qecho ''
\qecho '=== 9. DESCRIPTION FRAGMENTATION (same thing stored several ways) ==='
select regexp_replace(lower(btrim(description)), '[^a-z0-9]', '', 'g') normalized,
       count(distinct description) variants,
       string_agg(distinct '[' || description || ']', ' ') spellings,
       count(*) txns
from l where ld >= (select s from win)
  and regexp_replace(lower(btrim(description)), '[^a-z0-9]', '', 'g') <> ''
group by 1 having count(distinct description) > 1
order by txns desc limit 10;
