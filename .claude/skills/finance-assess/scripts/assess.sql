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
-- `:'months'::integer` quotes the value before casting, so a non-numeric one
-- fails here with a named cause rather than being pasted into SQL as raw text.
create temp table _param as
  select :'email'::text email, :'months'::integer months;

do $$
begin
  if not exists (select 1 from me) then
    raise exception 'finance-assess: no user matched "%" -- check the address, or omit -v email to use the busiest user',
      (select email from _param);
  end if;
  if (select months from _param) < 1 then
    raise exception 'finance-assess: months must be at least 1, got %',
      (select months from _param);
  end if;
end $$;

-- `ld` is the user's local wall-clock time. getTimezoneOffset() convention:
-- UTC+8 is -480, so subtracting the offset adds 8 hours.
create temp view l as
  select t.*, (t.date - (select tz from me) * interval '1 minute') ld
  from transactions t
  where t.user_id = (select id from me);

-- `now()` is a timestamptz, so to_char/date_trunc would resolve it through the
-- *session* timezone -- applying an offset a second time on top of the user's
-- own. Under an Asia/Manila session that put "today" 8 hours ahead, and on the
-- last evening of a month it rolls into the next one, which admits the current
-- partial month into `good` as though it were complete. `at time zone 'UTC'`
-- yields the UTC wall clock as a plain timestamp, matching how `t.date` is
-- stored, so the offset below is the only one ever applied.
create temp view nowl as
  select ((now() at time zone 'UTC') - (select tz from me) * interval '1 minute') n;

create temp view win as
  select date_trunc('month', (select n from nowl))
         - ((select months from _param) - 1) * interval '1 month' s;

-- Per-month coverage. A month logged on 16 of 31 days is not a cheap month,
-- it is a month with the data missing, and averaging it in drags every
-- downstream figure toward a number nothing actually spent.
--
-- The calendar is generated first and transactions joined onto it, so a month
-- with *no* rows at all still appears at 0% coverage. Grouping the rows alone
-- would drop it silently, which is the most extreme case of the very thing
-- this section exists to report.
create temp view cal as
  select to_char(g, 'YYYY-MM') m,
         extract(day from g + interval '1 month - 1 day')::int dim
  from generate_series((select s from win),
                       date_trunc('month', (select n from nowl)),
                       interval '1 month') g;

create temp view mon as
  select cal.m, cal.dim,
         count(l.id) n,
         count(distinct l.ld::date) days,
         coalesce(sum(l.amount) filter (where l.type = 'INCOME'), 0)::numeric inc,
         coalesce(sum(l.amount) filter (where l.type = 'EXPENSE'), 0)::numeric exp
  from cal left join l on to_char(l.ld, 'YYYY-MM') = cal.m
  group by cal.m, cal.dim;

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
       :'months'::integer || ' months' window_months,
       (select max(created_at)::date from l) newest_row
from me;

\qecho ''
\qecho '=== 1. DATA CONFIDENCE (excluded months are dropped from rates, averages'
\qecho '    and trends -- sections 2, 4, 7, 8. Sections 5, 6 and 9 read the whole'
\qecho '    window, and section 3 the whole payment history of each bill.) ==='
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
  join l t on lower(btrim(t.description)) = lower(btrim(s.description))
           and t.bill_id is null and t.type = 'EXPENSE'
where s.user_id = (select id from me) and s.is_active
group by 1 order by 2 desc;

\qecho ''
\qecho '=== 4. CATEGORY TREND (last full month vs earlier trustworthy months) ==='
-- Every category is crossed with every trustworthy month and missing
-- combinations filled with zero. Averaging only the months a category *did*
-- appear in measures it against itself: a category seen once at 100 across
-- four months reads as a baseline of 100 rather than 25, so a rise to 200 is
-- reported as +100% instead of +700%, and a category new to the last month
-- has no prior rows at all and yields a null change rather than a debut.
with spend as (
  select to_char(l.ld, 'YYYY-MM') m, l.category_id, sum(l.amount)::numeric amt
  from l
  where l.type = 'EXPENSE' and to_char(l.ld, 'YYYY-MM') in (select m from good)
  group by 1, 2),
c as (
  select g.m, cat.name, coalesce(spend.amt, 0) amt
  from (select m from good) g
    cross join (select distinct cat.id, cat.name
                from categories cat
                where cat.id in (select category_id from spend)) cat
    left join spend on spend.m = g.m and spend.category_id = cat.id),
last_m as (select max(m) m from good)
select c.name category,
       round(max(amt) filter (where c.m = (select m from last_m))) last_month,
       round(avg(amt) filter (where c.m <> (select m from last_m))) prior_avg,
       round(100.0 * (max(amt) filter (where c.m = (select m from last_m))
             - avg(amt) filter (where c.m <> (select m from last_m)))
             / nullif(avg(amt) filter (where c.m <> (select m from last_m)), 0)) change_pct
from c group by c.name
having max(amt) filter (where c.m = (select m from last_m)) is not null
-- Ranked by peso movement, not percentage. Zero-filling makes an intermittent
-- category read -100% in any month it is skipped, and on a small base that
-- crowds out the movements that actually matter: a 167 church donation would
-- otherwise outrank a 2,040 subscriptions rise.
order by abs(coalesce(max(amt) filter (where c.m = (select m from last_m)), 0)
           - coalesce(avg(amt) filter (where c.m <> (select m from last_m)), 0)) desc
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
group by 1 having count(distinct ld::date) >= 2
              and min(ld) > (select n from nowl) - interval '120 days'
order by avg(amount) desc limit 10;

\qecho ''
\qecho '=== 6. POSSIBLE DUPLICATES (same day, description and amount) ==='
select ld::date as dayk, description, round(amount::numeric) amt, count(*) copies
from l where ld >= (select s from win)
group by ld::date, description, amount having count(*) > 1
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
