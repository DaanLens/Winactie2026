-- LENS AI winactie: database.
-- De browser gebruikt alleen de publishable key en mag uitsluitend de functies
-- onderaan dit bestand aanroepen. Tabellen zijn niet rechtstreeks bereikbaar.

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  first_name text not null,
  phone text not null unique,
  email text not null unique,
  consent_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score integer not null default 0,
  code_fails integer not null default 0,
  hidden boolean not null default false
);

create table public.settings (
  id integer primary key default 1 check (id = 1),
  starts_at timestamptz,
  ends_at timestamptz,
  stand_code text not null,
  admin_hash text not null
);

create index participants_ranking on public.participants (score desc, finished_at asc)
  where finished_at is not null and not hidden;

alter table public.participants enable row level security;
alter table public.settings enable row level security;

revoke all on public.participants, public.settings from anon, authenticated;

-- Interne hulpfuncties ------------------------------------------------------

create function public._ping_scoreboard() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send('{}'::jsonb, 'update', 'scorebord', false);
exception when others then
  -- Het scorebord ververst ook zelf; een gemiste melding mag een deelnemer niet raken.
  null;
end $$;

create function public._rank(p_id uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer + 1
  from public.participants o, public.participants me
  where me.id = p_id
    and o.finished_at is not null and not o.hidden and o.id <> me.id
    and (o.score > me.score or (o.score = me.score and o.finished_at < me.finished_at));
$$;

create function public._state(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'done', p.finished_at is not null,
    'first_name', p.first_name,
    'score', p.score,
    'rank', case when p.finished_at is not null then public._rank(p.id) end,
    'discount', p.score > 50
  )
  from public.participants p where p.id = p_id;
$$;

create function public._check_admin(p_code text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.settings
    where admin_hash = extensions.crypt(p_code, admin_hash)
  ) then
    raise exception 'geen_toegang';
  end if;
end $$;

-- Publiek: deelnemen --------------------------------------------------------

create function public.register(
  p_first_name text, p_phone text, p_email text, p_terms boolean, p_contact boolean
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_first_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[\s().-]', '', 'g');
  v_domain text;
  v_cfg public.settings;
  v_existing public.participants;
  v_token uuid;
begin
  select * into v_cfg from public.settings where id = 1;
  if (v_cfg.starts_at is not null and now() < v_cfg.starts_at)
     or (v_cfg.ends_at is not null and now() > v_cfg.ends_at) then
    raise exception 'gesloten';
  end if;

  if not coalesce(p_terms, false) or not coalesce(p_contact, false) then
    raise exception 'geen_toestemming';
  end if;
  if v_name !~ '^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ ''-]{0,29}$' then
    raise exception 'ongeldige_naam';
  end if;

  v_phone := regexp_replace(v_phone, '^(\+31|0031)', '0');
  if v_phone !~ '^(0[1-9][0-9]{8}|(\+|00)[1-9][0-9]{7,14})$' then
    raise exception 'ongeldig_telefoonnummer';
  end if;

  if v_email !~ '^[a-z0-9][a-z0-9._%+-]*@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
     or length(v_email) > 120 then
    raise exception 'ongeldig_email';
  end if;
  v_domain := split_part(v_email, '@', 2);
  if v_domain = any (array[
    'gmail.com','googlemail.com','outlook.com','outlook.nl','hotmail.com','hotmail.nl',
    'live.com','live.nl','msn.com','icloud.com','me.com','mac.com','yahoo.com','yahoo.nl',
    'ymail.com','aol.com','proton.me','protonmail.com','pm.me','gmx.com','gmx.net','gmx.de',
    'mail.com','ziggo.nl','kpnmail.nl','kpnplanet.nl','planet.nl','home.nl','xs4all.nl',
    'hetnet.nl','casema.nl','chello.nl','upcmail.nl','quicknet.nl','tele2.nl','online.nl',
    'zonnet.nl','telfort.nl','t-mobilethuis.nl','caiway.nl','solcon.nl','delta.nl',
    'zeelandnet.nl','onsbrabantnet.nl','mailinator.com','yopmail.com','tempmail.com'
  ]) then
    raise exception 'prive_email';
  end if;

  -- Wie de pagina kwijtraakt, gaat verder met dezelfde gegevens.
  select * into v_existing from public.participants
  where email = v_email or phone = v_phone
  order by (email = v_email and phone = v_phone) desc limit 1;
  if found then
    if v_existing.finished_at is null and v_existing.email = v_email and v_existing.phone = v_phone then
      return jsonb_build_object('token', v_existing.token);
    end if;
    raise exception 'al_meegedaan';
  end if;

  if (select count(*) from public.participants where started_at > now() - interval '1 minute') >= 120 then
    raise exception 'te_druk';
  end if;

  insert into public.participants (first_name, phone, email)
  values (v_name, v_phone, v_email)
  returning token into v_token;

  return jsonb_build_object('token', v_token);
exception when unique_violation then
  raise exception 'al_meegedaan';
end $$;

create function public.get_state(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.participants where token = p_token;
  if not found then
    raise exception 'onbekend';
  end if;
  return public._state(v_id);
end $$;

create function public.submit_score(p_token uuid, p_stand_code text, p_score integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_p public.participants;
  v_cfg public.settings;
begin
  select * into v_p from public.participants where token = p_token for update;
  if not found then
    raise exception 'onbekend';
  end if;
  if v_p.finished_at is not null then
    raise exception 'al_ingevuld';
  end if;
  -- Na vijf foute codes kan alleen de beheerder de score nog invullen.
  if v_p.code_fails >= 5 then
    raise exception 'te_vaak_fout';
  end if;

  select * into v_cfg from public.settings where id = 1;
  if upper(btrim(coalesce(p_stand_code, ''))) <> upper(v_cfg.stand_code) then
    -- Geen exception: die zou de telling terugdraaien.
    update public.participants set code_fails = code_fails + 1 where id = v_p.id;
    return jsonb_build_object('error', 'foute_code');
  end if;
  -- Alle totalen die mogelijk zijn met 3 ballen en emmers van 10, 30 en 50 punten.
  if p_score is null or not p_score = any (array[0,10,20,30,40,50,60,70,80,90,100,110,130,150]) then
    raise exception 'ongeldige_score';
  end if;

  update public.participants set score = p_score, finished_at = now() where id = v_p.id;
  perform public._ping_scoreboard();
  return public._state(v_p.id);
end $$;

-- Publiek: scorebord --------------------------------------------------------

create function public.get_top5() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'players', (select count(*) from public.participants where finished_at is not null and not hidden),
    'top', coalesce((
      select jsonb_agg(jsonb_build_object('first_name', first_name, 'score', score))
      from (
        select first_name, score from public.participants
        where finished_at is not null and not hidden
        order by score desc, finished_at asc limit 5
      ) t
    ), '[]'::jsonb)
  );
$$;

-- Beheer, afgeschermd met de beheercode -------------------------------------

create function public.admin_overview(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public._check_admin(p_code);
  return jsonb_build_object(
    'settings', (select jsonb_build_object(
      'starts_at', starts_at, 'ends_at', ends_at, 'stand_code', stand_code
    ) from public.settings where id = 1),
    'participants', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.finished_at is null, r.hidden, r.score desc, r.finished_at)
      from (
        select id, first_name, phone, email, score, started_at, finished_at, hidden,
               case when finished_at is not null and not hidden then public._rank(id) end as rank
        from public.participants
      ) r
    ), '[]'::jsonb)
  );
end $$;

create function public.admin_set_score(p_code text, p_id uuid, p_score integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._check_admin(p_code);
  update public.participants
  set score = p_score, finished_at = coalesce(finished_at, now())
  where id = p_id;
  perform public._ping_scoreboard();
end $$;

create function public.admin_set_hidden(p_code text, p_id uuid, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._check_admin(p_code);
  update public.participants set hidden = p_hidden where id = p_id;
  perform public._ping_scoreboard();
end $$;

create function public.admin_delete(p_code text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._check_admin(p_code);
  delete from public.participants where id = p_id;
  perform public._ping_scoreboard();
end $$;

create function public.admin_set_settings(
  p_code text, p_starts timestamptz, p_ends timestamptz, p_stand_code text
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public._check_admin(p_code);
  update public.settings
  set starts_at = p_starts, ends_at = p_ends, stand_code = btrim(p_stand_code)
  where id = 1;
end $$;

-- Rechten: alleen deze functies zijn van buitenaf aan te roepen.
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.register(text, text, text, boolean, boolean),
  public.get_state(uuid),
  public.submit_score(uuid, text, integer),
  public.get_top5(),
  public.admin_overview(text),
  public.admin_set_score(text, uuid, integer),
  public.admin_set_hidden(text, uuid, boolean),
  public.admin_delete(text, uuid),
  public.admin_set_settings(text, timestamptz, timestamptz, text)
to anon;
