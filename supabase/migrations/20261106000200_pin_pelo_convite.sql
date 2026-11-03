-- PIN criado pela própria pessoa, no link de convite do WhatsApp.
--  * Quem cria o perfil pode deixar o PIN em branco (precisa do WhatsApp): a pessoa
--    abre o link e escolhe o PIN dela, que nem o gerente nem o dono ficam sabendo.
--  * Um perfil sem PIN não entra em lugar nenhum até usar o link.
--  * Mandar um link novo também serve para a pessoa trocar um PIN esquecido.
--  * staff.has_pin mostra ao app quem ainda não criou o PIN, sem expor o hash.

alter table public.staff alter column pin_hash drop not null;
alter table public.staff add column has_pin boolean generated always as (pin_hash is not null) stored;
grant select (has_pin) on public.staff to authenticated;

-- ---------------------------------------------------------------- criar perfil sem PIN

-- p_pin = null: ao editar, mantém o PIN atual; ao criar, a pessoa cria o PIN pelo link
-- (por isso precisa do WhatsApp). Telefone: só números.
create or replace function public.save_staff(p_token uuid, p_id uuid, p_name text, p_phone text, p_pin text, p_roles text[])
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  eid uuid := op.establishment_id;
  cur public.staff;
  op_is_owner boolean := 'dono' = any (op.roles);
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome' using errcode = 'P0001'; end if;
  if cardinality(p_roles) = 0 then raise exception 'Escolha pelo menos um perfil' using errcode = 'P0001'; end if;
  if v_phone <> '' and length(v_phone) not between 10 and 13 then
    raise exception 'Telefone inválido. Use DDD + número, ex.: 81 99999-0000' using errcode = 'P0001';
  end if;
  if p_id is null and p_pin is null and v_phone = '' then
    raise exception 'Informe o PIN ou o WhatsApp (para a pessoa criar o PIN pelo link)' using errcode = 'P0001';
  end if;
  if not op_is_owner then
    if p_id is not null then raise exception 'Só o dono pode alterar um perfil' using errcode = 'P0001'; end if;
    if p_roles <> array['atendente'] then raise exception 'O gerente só cria perfil de atendente' using errcode = 'P0001'; end if;
  end if;
  if p_pin is not null then
    if p_pin !~ '^\d{4,6}$' then raise exception 'O PIN deve ter de 4 a 6 números' using errcode = 'P0001'; end if;
    if exists (select 1 from public.staff where establishment_id = eid and deleted_at is null
               and id is distinct from p_id and pin_hash = extensions.crypt(p_pin, pin_hash)) then
      raise exception 'Esse PIN já está em uso' using errcode = 'P0001';
    end if;
  end if;
  if p_id is null then
    insert into public.staff (establishment_id, name, phone, pin_hash, roles, created_by)
    values (eid, trim(p_name), v_phone,
            case when p_pin is null then null else extensions.crypt(p_pin, extensions.gen_salt('bf')) end, p_roles, op.id);
  else
    select * into cur from public.staff where id = p_id and establishment_id = eid for update;
    if cur.id is null then raise exception 'Usuário não encontrado' using errcode = 'P0001'; end if;
    if 'dono' = any (cur.roles) and not ('dono' = any (p_roles))
       and (select count(*) from public.staff where establishment_id = eid and deleted_at is null and 'dono' = any (roles)) = 1 then
      raise exception 'É preciso ter pelo menos um dono' using errcode = 'P0001';
    end if;
    update public.staff
    set name = trim(p_name), phone = v_phone, roles = p_roles,
        pin_hash = case when p_pin is null then pin_hash else extensions.crypt(p_pin, extensions.gen_salt('bf')) end
    where id = p_id;
  end if;
  perform private.audit(eid, op.id, case when p_id is null then 'usuario.criar' else 'usuario.editar' end,
    format('Usuário %s (%s) %s por %s%s', trim(p_name), array_to_string(p_roles, ', '),
      case when p_id is null then 'criado' else 'alterado' end, op.name,
      case when p_id is not null and p_pin is not null then ', PIN trocado'
           when p_id is null and p_pin is null then ', sem PIN (a pessoa cria pelo link)' else '' end));
end
$$;

-- ---------------------------------------------------------------- o link pede o PIN

drop function public.redeem_invite(text, text, text);

-- Chamada pelo celular que abriu o link, já com o login anônimo. Grava o PIN que a
-- pessoa escolheu (troca o anterior, se havia) e devolve o estabelecimento.
create function public.redeem_invite(p_code text, p_pin text, p_info text, p_device_key text)
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
  if coalesce(p_pin, '') !~ '^\d{4,6}$' then raise exception 'O PIN deve ter de 4 a 6 números' using errcode = 'P0001'; end if;
  if exists (select 1 from public.staff where establishment_id = inv.establishment_id and deleted_at is null
             and id <> target.id and pin_hash = extensions.crypt(p_pin, pin_hash)) then
    raise exception 'Esse PIN já está em uso. Escolha outro.' using errcode = 'P0001';
  end if;
  update private.staff_invites set used_at = now(), used_by = uid where code = inv.code;
  update public.staff set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')) where id = target.id;
  insert into public.members (establishment_id, user_id) values (inv.establishment_id, uid) on conflict do nothing;
  insert into public.devices (establishment_id, user_id, device_key, kind, staff_id, info)
  values (inv.establishment_id, uid, trim(p_device_key), 'convite', target.id, left(coalesce(p_info, ''), 120))
  on conflict (establishment_id, user_id, device_key)
    do update set kind = 'convite', staff_id = excluded.staff_id, info = excluded.info, last_seen_at = now(), blocked_at = null;
  perform private.audit(inv.establishment_id, null, 'aparelho.convite',
    format('Aparelho de %s conectado pelo link (%s)', target.name, coalesce(nullif(trim(p_info), ''), 'sem detalhes')));
  perform private.audit(inv.establishment_id, target.id, 'usuario.pin', format('%s criou o próprio PIN pelo link', target.name));
  return inv.establishment_id;
end
$$;

revoke execute on function public.redeem_invite(text, text, text, text) from public, anon;
grant execute on function public.redeem_invite(text, text, text, text) to authenticated;
