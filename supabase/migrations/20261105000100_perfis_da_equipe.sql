-- =============================================================================
-- RKFood: perfis da equipe
--
--  * staff.phone: telefone com WhatsApp (para mandar o link de acesso).
--  * staff.created_by: quem criou o perfil (também fica no histórico).
--  * staff.blocked_at: perfil bloqueado pelo dono não entra com o PIN, perde a
--    sessão aberta e não autoriza cancelamento nem cortesia.
--  * O gerente só cria perfil de atendente. Editar, mudar permissões, trocar PIN,
--    bloquear, excluir e restaurar perfis: só o dono.
-- =============================================================================

alter table public.staff
  add column phone text not null default '',
  add column created_by uuid,
  add column blocked_at timestamptz;
alter table public.staff add foreign key (establishment_id, created_by) references public.staff (establishment_id, id);
grant select (phone, created_by, blocked_at) on public.staff to authenticated;

-- Perfil bloqueado não opera (a sessão aberta para de valer na hora).
create or replace function private.operator(p_token uuid, p_role text default null)
returns public.staff
language plpgsql stable security definer set search_path = ''
as $$
declare
  s public.staff;
begin
  select st.* into s
  from private.operator_sessions os
  join public.staff st on st.id = os.staff_id
  where os.token = p_token
    and os.expires_at > now()
    and os.user_id = (select auth.uid())
    and st.deleted_at is null
    and st.blocked_at is null
    and os.establishment_id in (select private.my_establishments());
  if s.id is null then
    raise exception 'Sessão do operador expirada. Digite o PIN novamente.' using errcode = 'P0001', hint = 'sessao_expirada';
  end if;
  if p_role is not null and not (
    p_role = any (s.roles) or 'dono' = any (s.roles) or (p_role <> 'dono' and 'gerente' = any (s.roles))
  ) then
    raise exception 'Seu perfil não permite esta ação.' using errcode = 'P0001';
  end if;
  return s;
end
$$;

create or replace function public.operator_login(p_establishment uuid, p_pin text)
returns table (token uuid, staff_id uuid, name text, roles text[])
language plpgsql volatile security definer set search_path = ''
as $$
declare
  s public.staff;
  t uuid;
begin
  if p_establishment not in (select private.my_establishments()) then
    raise exception 'Este aparelho não tem acesso a este estabelecimento.' using errcode = 'P0001';
  end if;
  select * into s from public.staff
  where establishment_id = p_establishment and deleted_at is null
    and pin_hash = extensions.crypt(p_pin, pin_hash)
  limit 1;
  if s.id is null then
    -- sem erro, para o registro ficar: o app entende "nenhuma linha" como PIN não encontrado
    perform private.audit(p_establishment, null, 'pin.errado', 'PIN errado ao entrar');
    return;
  end if;
  if s.blocked_at is not null then
    perform private.audit(p_establishment, s.id, 'pin.bloqueado', 'Tentou entrar com perfil bloqueado: ' || s.name);
    return;
  end if;
  delete from private.operator_sessions where expires_at < now();
  insert into private.operator_sessions (establishment_id, staff_id, user_id)
  values (p_establishment, s.id, (select auth.uid()))
  returning operator_sessions.token into t;
  perform private.audit(p_establishment, s.id, 'pin.entrar', 'Entrou com o PIN: ' || s.name);
  return query select t, s.id, s.name, s.roles;
end
$$;

create or replace function private.authorize(p_establishment uuid, p_requester uuid, p_pin text, p_role text, p_what text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  s public.staff;
begin
  select * into s from public.staff
  where establishment_id = p_establishment and deleted_at is null
    and coalesce(p_pin, '') <> '' and pin_hash = extensions.crypt(p_pin, pin_hash)
  limit 1;
  if s.id is not null and s.blocked_at is null
     and ('dono' = any (s.roles) or (p_role = 'gerente' and 'gerente' = any (s.roles))) then
    return s.id;
  end if;
  perform private.audit(p_establishment, p_requester, 'autorizacao.negada',
    format('Autorização negada (%s): %s', p_what,
      case when s.id is null then 'PIN errado'
           when s.blocked_at is not null then 'PIN de ' || s.name || ', que está bloqueado'
           else 'PIN de ' || s.name || ', que não é ' || p_role end));
  return null;
end
$$;

-- ---------------------------------------------------------------- criar e editar perfis

drop function public.save_staff(uuid, uuid, text, text, text[]);

-- p_pin = null mantém o PIN atual (só ao editar). Telefone: só números.
create function public.save_staff(p_token uuid, p_id uuid, p_name text, p_phone text, p_pin text, p_roles text[])
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
  if p_id is null and p_pin is null then raise exception 'Informe o PIN' using errcode = 'P0001'; end if;
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
    values (eid, trim(p_name), v_phone, extensions.crypt(p_pin, extensions.gen_salt('bf')), p_roles, op.id);
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
      case when p_id is not null and p_pin is not null then ', PIN trocado' else '' end));
end
$$;

-- ---------------------------------------------------------------- bloquear perfil (só o dono)

create function public.set_staff_blocked(p_token uuid, p_id uuid, p_blocked boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'dono');
  target public.staff;
begin
  select * into target from public.staff where id = p_id and establishment_id = op.establishment_id for update;
  if target.id is null then raise exception 'Usuário não encontrado' using errcode = 'P0001'; end if;
  if p_blocked and target.id = op.id then raise exception 'Você não pode bloquear o próprio perfil' using errcode = 'P0001'; end if;
  update public.staff set blocked_at = case when p_blocked then now() end where id = target.id;
  if p_blocked then delete from private.operator_sessions where staff_id = target.id; end if;
  perform private.audit(op.establishment_id, op.id, case when p_blocked then 'usuario.bloquear' else 'usuario.desbloquear' end,
    format('Usuário %s %s por %s', target.name, case when p_blocked then 'bloqueado' else 'desbloqueado' end, op.name));
end
$$;

-- ---------------------------------------------------------------- lixeira: perfis só pelo dono

create or replace function public.set_trashed(p_token uuid, p_kind text, p_id uuid, p_trashed boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, case when p_kind = 'customers' then 'caixa' when p_kind = 'users' then 'dono' else 'gerente' end);
  eid uuid := op.establishment_id;
  nm text;
  label text;
  target public.staff;
begin
  if p_kind = 'categories' then
    if p_trashed and exists (select 1 from public.products where category_id = p_id and deleted_at is null) then
      raise exception 'Mova ou exclua os itens desta categoria antes' using errcode = 'P0001';
    end if;
    update public.categories set deleted_at = case when p_trashed then now() end where id = p_id and establishment_id = eid returning name into nm;
    label := 'Categoria';
  elsif p_kind = 'products' then
    update public.products set deleted_at = case when p_trashed then now() end where id = p_id and establishment_id = eid returning name into nm;
    label := 'Item';
  elsif p_kind = 'customers' then
    if p_trashed and private.customer_balance(p_id) > 0 then
      raise exception 'Cliente ainda tem fiado em aberto' using errcode = 'P0001';
    end if;
    update public.customers set deleted_at = case when p_trashed then now() end where id = p_id and establishment_id = eid returning name into nm;
    label := 'Cliente';
  elsif p_kind = 'users' then
    select * into target from public.staff where id = p_id and establishment_id = eid;
    if p_trashed and p_id = op.id then raise exception 'Você não pode excluir o próprio usuário' using errcode = 'P0001'; end if;
    if p_trashed and 'dono' = any (target.roles)
       and (select count(*) from public.staff where establishment_id = eid and deleted_at is null and 'dono' = any (roles)) = 1 then
      raise exception 'É preciso ter pelo menos um dono' using errcode = 'P0001';
    end if;
    update public.staff set deleted_at = case when p_trashed then now() end where id = p_id and establishment_id = eid returning name into nm;
    if p_trashed then delete from private.operator_sessions where staff_id = p_id; end if;
    label := 'Usuário';
  else
    raise exception 'Tipo inválido' using errcode = 'P0001';
  end if;
  if nm is null then raise exception 'Registro não encontrado' using errcode = 'P0001'; end if;
  perform private.audit(eid, op.id, p_kind || case when p_trashed then '.excluir' else '.restaurar' end,
    format('%s "%s" %s', label, nm, case when p_trashed then 'movido para a lixeira' else 'restaurado' end));
end
$$;

revoke all on function private.operator(uuid, text), private.authorize(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.save_staff(uuid, uuid, text, text, text, text[]), public.set_staff_blocked(uuid, uuid, boolean) from public, anon;
grant execute on function public.save_staff(uuid, uuid, text, text, text, text[]), public.set_staff_blocked(uuid, uuid, boolean) to authenticated;
