-- =============================================================================
-- RKFood: convite por link e controle de aparelhos
--
--  * Convite: o dono (ou o gerente, para atendente) gera um link de uso único que
--    vale 24 h e manda pelo WhatsApp da pessoa. Aberto no celular dela, o celular
--    entra com um login anônimo do Supabase e fica ligado ao estabelecimento só
--    para aquele perfil: ali só o PIN dessa pessoa funciona.
--  * devices: todos os aparelhos que entraram (os da conta do estabelecimento,
--    identificados por uma chave guardada no próprio aparelho, e os de convite),
--    com quem usou, quando e o navegador. O dono pode bloquear um aparelho.
-- =============================================================================

create table public.devices (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  user_id          uuid not null,
  device_key       text not null,
  kind             text not null check (kind in ('estabelecimento', 'convite')),
  staff_id         uuid,
  info             text not null default '',
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_staff_id    uuid,
  blocked_at       timestamptz,
  unique (establishment_id, user_id, device_key),
  foreign key (establishment_id, staff_id) references public.staff (establishment_id, id),
  foreign key (establishment_id, last_staff_id) references public.staff (establishment_id, id)
);
create index devices_establishment_idx on public.devices (establishment_id);
create index devices_user_idx on public.devices (user_id);
alter table public.devices enable row level security;
create policy devices_select on public.devices for select to authenticated
  using (establishment_id in (select private.my_establishments()));
revoke all on public.devices from anon, authenticated;
grant select on public.devices to authenticated;

create table private.staff_invites (
  code             text primary key,
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  staff_id         uuid not null references public.staff (id) on delete cascade,
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '24 hours',
  used_at          timestamptz,
  used_by          uuid
);
alter table private.staff_invites enable row level security;

alter table private.operator_sessions add column device_key text;

-- Aparelho de convite bloqueado não enxerga mais o estabelecimento.
create or replace function private.my_establishments()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.establishment_id
  from public.members m
  join public.establishments e on e.id = m.establishment_id and e.active
  where m.user_id = (select auth.uid())
    and not exists (
      select 1 from public.devices d
      where d.establishment_id = m.establishment_id and d.user_id = m.user_id
        and d.kind = 'convite' and d.blocked_at is not null
    )
$$;

-- ---------------------------------------------------------------- convite

-- Devolve o código do link. Um convite novo cancela os anteriores ainda não usados.
create function public.create_invite(p_token uuid, p_staff uuid)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  target public.staff;
  v_code text := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/=', '-_');
begin
  select * into target from public.staff where id = p_staff and establishment_id = op.establishment_id;
  if target.id is null or target.deleted_at is not null then raise exception 'Usuário não encontrado' using errcode = 'P0001'; end if;
  if target.blocked_at is not null then raise exception 'Esse perfil está bloqueado' using errcode = 'P0001'; end if;
  if not ('dono' = any (op.roles)) and target.roles <> array['atendente'] then
    raise exception 'O gerente só envia acesso para atendente' using errcode = 'P0001';
  end if;
  delete from private.staff_invites where staff_id = target.id and used_at is null;
  insert into private.staff_invites (code, establishment_id, staff_id, created_by)
  values (v_code, op.establishment_id, target.id, op.id);
  perform private.audit(op.establishment_id, op.id, 'convite.criar',
    format('Link de acesso para %s gerado por %s (vale 24 h, uma vez)', target.name, op.name));
  return v_code;
end
$$;

-- Chamada pelo celular que abriu o link, já com o login anônimo. Devolve o estabelecimento.
create function public.redeem_invite(p_code text, p_info text, p_device_key text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  inv private.staff_invites;
  target public.staff;
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'Entre de novo pelo link' using errcode = 'P0001'; end if;
  if coalesce(trim(p_device_key), '') = '' then raise exception 'Aparelho sem identificação' using errcode = 'P0001'; end if;
  select * into inv from private.staff_invites where code = trim(p_code) for update;
  if inv.code is null then raise exception 'Link de acesso inválido. Peça um novo ao dono.' using errcode = 'P0001'; end if;
  if inv.used_at is not null then raise exception 'Esse link já foi usado. Peça um novo ao dono.' using errcode = 'P0001'; end if;
  if inv.expires_at < now() then raise exception 'Esse link venceu. Peça um novo ao dono.' using errcode = 'P0001'; end if;
  select * into target from public.staff where id = inv.staff_id;
  if target.deleted_at is not null or target.blocked_at is not null then
    raise exception 'Esse perfil não tem mais acesso. Fale com o dono.' using errcode = 'P0001';
  end if;
  update private.staff_invites set used_at = now(), used_by = uid where code = inv.code;
  insert into public.members (establishment_id, user_id) values (inv.establishment_id, uid) on conflict do nothing;
  insert into public.devices (establishment_id, user_id, device_key, kind, staff_id, info)
  values (inv.establishment_id, uid, trim(p_device_key), 'convite', target.id, left(coalesce(p_info, ''), 120))
  on conflict (establishment_id, user_id, device_key)
    do update set kind = 'convite', staff_id = excluded.staff_id, info = excluded.info, last_seen_at = now(), blocked_at = null;
  perform private.audit(inv.establishment_id, null, 'aparelho.convite',
    format('Aparelho de %s conectado pelo link (%s)', target.name, coalesce(nullif(trim(p_info), ''), 'sem detalhes')));
  return inv.establishment_id;
end
$$;

-- ---------------------------------------------------------------- login por PIN com o aparelho

drop function public.operator_login(uuid, text);

-- PIN errado: nenhuma linha. Recusa com motivo (aparelho bloqueado, celular de outra
-- pessoa): uma linha sem token, com o motivo em "name". Sem erro, para o registro ficar.
create function public.operator_login(p_establishment uuid, p_pin text, p_device_key text default null, p_info text default null)
returns table (token uuid, staff_id uuid, name text, roles text[])
language plpgsql volatile security definer set search_path = ''
as $$
declare
  s public.staff;
  t uuid;
  uid uuid := (select auth.uid());
  dev public.devices;
  v_key text := coalesce(nullif(trim(p_device_key), ''), 'sem-chave');
begin
  if p_establishment not in (select private.my_establishments()) then
    raise exception 'Este aparelho não tem acesso a este estabelecimento.' using errcode = 'P0001';
  end if;
  select * into s from public.staff
  where establishment_id = p_establishment and deleted_at is null
    and pin_hash = extensions.crypt(p_pin, pin_hash)
  limit 1;
  if s.id is null then
    perform private.audit(p_establishment, null, 'pin.errado', 'PIN errado ao entrar');
    return;
  end if;
  if s.blocked_at is not null then
    perform private.audit(p_establishment, s.id, 'pin.bloqueado', 'Tentou entrar com perfil bloqueado: ' || s.name);
    return;
  end if;

  -- celular de convite: só o PIN de quem recebeu o link
  select * into dev from public.devices
  where establishment_id = p_establishment and user_id = uid and kind = 'convite'
  order by last_seen_at desc limit 1;
  if dev.id is not null then
    if dev.staff_id is distinct from s.id then
      perform private.audit(p_establishment, s.id, 'aparelho.outro_perfil',
        format('%s tentou entrar no celular de %s', s.name, private.staff_label(dev.staff_id)));
      return query select null::uuid, null::uuid, 'Este celular é só de ' || private.staff_label(dev.staff_id) || '.', null::text[];
      return;
    end if;
  else
    -- aparelho da conta do estabelecimento: registra (ou atualiza) pela chave do aparelho
    insert into public.devices (establishment_id, user_id, device_key, kind, info, last_staff_id)
    values (p_establishment, uid, v_key, 'estabelecimento', left(coalesce(p_info, ''), 120), s.id)
    on conflict (establishment_id, user_id, device_key) do update set last_seen_at = now()
    returning * into dev;
  end if;
  if dev.blocked_at is not null then
    perform private.audit(p_establishment, s.id, 'aparelho.bloqueado', format('%s tentou entrar num aparelho bloqueado (%s)', s.name, dev.info));
    return query select null::uuid, null::uuid, 'Este aparelho foi bloqueado pelo dono.'::text, null::text[];
    return;
  end if;
  update public.devices
  set last_seen_at = now(), last_staff_id = s.id, info = coalesce(nullif(left(trim(p_info), 120), ''), info)
  where id = dev.id;

  delete from private.operator_sessions where expires_at < now();
  insert into private.operator_sessions (establishment_id, staff_id, user_id, device_key)
  values (p_establishment, s.id, uid, dev.device_key)
  returning operator_sessions.token into t;
  perform private.audit(p_establishment, s.id, 'pin.entrar', 'Entrou com o PIN: ' || s.name);
  return query select t, s.id, s.name, s.roles;
end
$$;

-- conexão e desconexão do aparelho (agora com a chave do aparelho)
drop function public.log_device_event(text, text);

create function public.log_device_event(p_event text, p_info text, p_device_key text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  eid uuid;
  who text := (select email from auth.users where id = (select auth.uid()));
begin
  if p_event not in ('conectar', 'desconectar') then
    raise exception 'Evento inválido' using errcode = 'P0001';
  end if;
  for eid in select private.my_establishments() loop
    if p_event = 'conectar' and coalesce(trim(p_device_key), '') <> '' then
      insert into public.devices (establishment_id, user_id, device_key, kind, info)
      values (eid, (select auth.uid()), trim(p_device_key), 'estabelecimento', left(coalesce(p_info, ''), 120))
      on conflict (establishment_id, user_id, device_key) do update set last_seen_at = now(), info = excluded.info;
    end if;
    perform private.audit(eid, null, 'aparelho.' || p_event,
      format('Aparelho %s (%s): %s', case when p_event = 'conectar' then 'conectado' else 'desconectado' end,
        coalesce(who, 'link de convite'), left(coalesce(nullif(trim(p_info), ''), 'sem detalhes'), 120)));
  end loop;
end
$$;

-- ---------------------------------------------------------------- bloquear aparelho (só o dono)

create function public.set_device_blocked(p_token uuid, p_device uuid, p_blocked boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'dono');
  dev public.devices;
  mine private.operator_sessions;
begin
  select * into dev from public.devices where id = p_device and establishment_id = op.establishment_id for update;
  if dev.id is null then raise exception 'Aparelho não encontrado' using errcode = 'P0001'; end if;
  select * into mine from private.operator_sessions where token = p_token;
  if p_blocked and dev.user_id = mine.user_id and dev.device_key = mine.device_key then
    raise exception 'Você não pode bloquear o aparelho que está usando' using errcode = 'P0001';
  end if;
  update public.devices set blocked_at = case when p_blocked then now() end where id = dev.id;
  if p_blocked then
    delete from private.operator_sessions
    where establishment_id = dev.establishment_id and user_id = dev.user_id
      and (dev.kind = 'convite' or device_key = dev.device_key);
  end if;
  perform private.audit(op.establishment_id, op.id, case when p_blocked then 'aparelho.bloquear' else 'aparelho.desbloquear' end,
    format('Aparelho %s (%s%s) %s por %s', dev.info,
      case when dev.kind = 'convite' then 'celular de ' else 'último uso por ' end,
      coalesce(private.staff_label(coalesce(dev.staff_id, dev.last_staff_id)), '?'),
      case when p_blocked then 'bloqueado' else 'desbloqueado' end, op.name));
end
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_establishments(), private.is_platform_admin() to authenticated;
revoke all on function
  public.create_invite(uuid, uuid), public.redeem_invite(text, text, text),
  public.operator_login(uuid, text, text, text), public.log_device_event(text, text, text),
  public.set_device_blocked(uuid, uuid, boolean)
from public, anon;
grant execute on function
  public.create_invite(uuid, uuid), public.redeem_invite(text, text, text),
  public.operator_login(uuid, text, text, text), public.log_device_event(text, text, text),
  public.set_device_blocked(uuid, uuid, boolean)
to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.devices;
  end if;
end
$$;
