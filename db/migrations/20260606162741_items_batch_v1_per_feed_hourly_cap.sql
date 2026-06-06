-- Migration: items_batch_v1_per_feed_hourly_cap
-- Applied to Supabase project zefqudaygonaboqxprys (FeedsBar Pro) on 2026-06-06.
-- Supabase migration version: 20260606162741
--
-- Backlog: "Per-feed frequency cap in the ticker" (KatieAIOS feeds-bar 23975ff2).
-- Adds p_max_per_feed_per_hour (default 3) to rpc_items_batch_v1: for each feed,
-- at most N items from the last 60 minutes survive, so one chatty feed (Reddit
-- bursts, ESPN game day) can't dominate the ticker. Items older than an hour are
-- unaffected (already bounded by the per-feed top-N). A null/<=0 cap disables it.
--
-- Adding a 4th parameter creates an overload, which would make the edge API's
-- 2-arg call ambiguous, so we DROP the old 3-arg signature first. The new param
-- has a default, so existing callers (the edge API passes 2-3 named args) keep
-- working with no client/edge/deploy change.
--
-- This file is tracked for traceability; the schema of record is the Supabase
-- migration history. There is no automated migration runner wired in this repo
-- yet — changes are applied via the Supabase MCP/dashboard.

DROP FUNCTION IF EXISTS public.rpc_items_batch_v1(uuid[], integer, integer);

CREATE OR REPLACE FUNCTION public.rpc_items_batch_v1(
  p_feed_ids uuid[],
  p_limit_per_feed integer DEFAULT 10,
  p_since_minutes integer DEFAULT NULL::integer,
  p_max_per_feed_per_hour integer DEFAULT 3
)
RETURNS TABLE(generated_at timestamp with time zone, items jsonb)
LANGUAGE sql
STABLE
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
  with f as (
    select
      m.feed_id,
      m.feed_name,
      m.feed_url,
      m.icon_url,
      m.category_slug,
      m.category_name,
      coalesce(ff.source_type, 'rss') as source_type
    from v_manifest m
    left join feeds ff on ff.id = m.feed_id
    where m.feed_id = any(p_feed_ids)
      and coalesce(m.is_active, true) = true
  ),
  picked as (
    select p.*
    from f
    cross join lateral (
      select i.id as item_id, i.title, i.url, i.published_at, i.image_url, i.feed_id
      from items i
      where i.feed_id = f.feed_id
        and i.published_at > case
              when p_since_minutes is null then now() - interval '30 days'
              else now() - make_interval(mins => greatest(1, p_since_minutes))
            end
      order by i.published_at desc
      limit greatest(1, least(p_limit_per_feed, 30))
    ) p
  ),
  -- Rank each feed's picked items newest-first. Because ordering is
  -- published_at desc, the most-recent items occupy the lowest ranks, so
  -- "feed_rn <= cap" keeps the N newest items of any feed that is bursting
  -- inside the 60-minute window.
  capped as (
    select p.*,
      row_number() over (
        partition by p.feed_id
        order by p.published_at desc
      ) as feed_rn
    from picked p
  )
  select
    now() as generated_at,
    jsonb_agg(
      jsonb_build_object(
        'item_id', c.item_id,
        'title', c.title,
        'url', c.url,
        'published_at', c.published_at,
        'image_url', c.image_url,
        'source', jsonb_build_object(
          'feed_id', f.feed_id,
          'title', f.feed_name,
          'domain', f.feed_url,
          'icon_url', f.icon_url,
          'source_type', f.source_type,
          'category', jsonb_build_object(
            'slug', f.category_slug,
            'name', f.category_name
          )
        )
      )
      order by c.published_at desc
    ) as items
  from capped c
  join f on f.feed_id = c.feed_id
  where p_max_per_feed_per_hour is null
     or p_max_per_feed_per_hour <= 0
     or c.published_at <= now() - interval '60 minutes'
     or c.feed_rn <= p_max_per_feed_per_hour;
$function$;
