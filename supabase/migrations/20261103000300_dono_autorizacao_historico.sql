-- =============================================================================
-- RKFood: perfil "dono", autorização por PIN e histórico completo
--
--  * Perfil "dono": pode tudo que o gerente pode e é o único que autoriza
--    cortesia e mexe em outro dono. O primeiro gerente de cada estabelecimento
--    (o criado no cadastro inicial) vira dono.
--  * Cancelar pedido exige o PIN de um gerente (ou dono), digitado na hora.
--  * Cortesia é uma forma de pagamento nova e exige o PIN do dono.
--  * Histórico: entrada e saída por PIN, PIN errado, autorização negada,
--    conexão e desconexão de aparelho, e quem autorizou cada coisa.
--
-- Funções que precisam registrar uma tentativa recusada NÃO lançam erro nesse
-- caso (o erro desfaria o registro): devolvem a mensagem como texto e o app
-- mostra. Os demais erros continuam como exceção.
-- =============================================================================

-- ---------------------------------------------------------------- perfil dono

alter table public.staff drop constraint staff_roles_check;
alter table public.staff add constraint staff_roles_check check (
  cardinality(roles) > 0 and roles <@ array['atendente', 'cozinha', 'caixa', 'gerente', 'dono']
);

-- quem já existe: o primeiro gerente de cada estabelecimento vira dono
update public.staff s
set roles = array_append(s.roles, 'dono')
where s.id in (
  select distinct on (establishment_id) id from public.staff
  where deleted_at is null and 'gerente' = any (roles)
  order by establishment_id, created_at
) and not 'dono' = any (s.roles);

-- Gerente e dono podem tudo; só o dono passa quando o perfil exigido é "dono".
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

create function private.staff_label(p_staff uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select name from public.staff where id = p_staff), 'desconhecido')
$$;

create function private.ident_label(o public.orders)
returns text
language sql immutable set search_path = ''
as $$
  select case when o.ident_type = 'mesa' then 'Mesa ' || o.ident_value else o.ident_value end
$$;

-- ---------------------------------------------------------------- autorização por PIN

-- Procura quem tem esse PIN no estabelecimento e o perfil exigido ('gerente' aceita
-- gerente ou dono; 'dono' só dono). Devolve o id de quem autorizou, ou null.
-- A recusa fica no histórico; quem chama devolve a mensagem sem lançar erro.
create function private.authorize(p_establishment uuid, p_requester uuid, p_pin text, p_role text, p_what text)
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
  if s.id is not null and ('dono' = any (s.roles) or (p_role = 'gerente' and 'gerente' = any (s.roles))) then
    return s.id;
  end if;
  perform private.audit(p_establishment, p_requester, 'autorizacao.negada',
    format('Autorização negada (%s): %s', p_what,
      case when s.id is null then 'PIN errado' else 'PIN de ' || s.name || ', que não é ' || p_role end));
  return null;
end
$$;

-- ---------------------------------------------------------------- entrada e saída por PIN

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
  delete from private.operator_sessions where expires_at < now();
  insert into private.operator_sessions (establishment_id, staff_id, user_id)
  values (p_establishment, s.id, (select auth.uid()))
  returning operator_sessions.token into t;
  perform private.audit(p_establishment, s.id, 'pin.entrar', 'Entrou com o PIN: ' || s.name);
  return query select t, s.id, s.name, s.roles;
end
$$;

create or replace function public.operator_logout(p_token uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  os private.operator_sessions;
begin
  delete from private.operator_sessions where token = p_token and user_id = (select auth.uid()) returning * into os;
  if os.token is not null then
    perform private.audit(os.establishment_id, os.staff_id, 'pin.sair', 'Saiu: ' || private.staff_label(os.staff_id));
  end if;
end
$$;

-- ---------------------------------------------------------------- aparelho

-- O app chama depois de entrar com e-mail e senha, e antes de sair.
create function public.log_device_event(p_event text, p_info text)
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
    perform private.audit(eid, null, 'aparelho.' || p_event,
      format('Aparelho %s (%s): %s', case when p_event = 'conectar' then 'conectado' else 'desconectado' end,
        coalesce(who, '?'), left(coalesce(nullif(trim(p_info), ''), 'sem detalhes'), 120)));
  end loop;
end
$$;

-- ---------------------------------------------------------------- cancelamento com PIN de gerente

alter table public.orders add column cancel_authorized_by uuid;
alter table public.orders add foreign key (establishment_id, cancel_authorized_by) references public.staff (establishment_id, id);

drop function public.cancel_order(uuid, uuid, text);

-- Devolve null quando deu certo, ou a mensagem quando o PIN não autorizou.
create function public.cancel_order(p_token uuid, p_order uuid, p_reason text, p_auth_pin text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'caixa');
  o public.orders;
  approver uuid;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo do cancelamento' using errcode = 'P0001'; end if;
  select * into o from public.orders where id = p_order and establishment_id = op.establishment_id for update;
  if o.id is null then raise exception 'Pedido não encontrado' using errcode = 'P0001'; end if;
  if o.status = 'cancelado' then raise exception 'Pedido já está cancelado' using errcode = 'P0001'; end if;
  if private.order_paid(o.id) > 0 then
    raise exception 'Pedido já tem pagamento registrado e não pode ser cancelado' using errcode = 'P0001';
  end if;
  approver := private.authorize(o.establishment_id, op.id, p_auth_pin, 'gerente',
    format('cancelar pedido nº %s, %s', o.number, private.ident_label(o)));
  if approver is null then return 'PIN de gerente incorreto. O cancelamento precisa do PIN de um gerente.'; end if;
  update public.orders set cancel_reason = trim(p_reason), cancel_authorized_by = approver where id = o.id;
  perform private.push_status(o.id, 'cancelado', op.id);
  perform private.audit(o.establishment_id, op.id, 'pedido.cancelar',
    format('Pedido nº %s (%s) cancelado por %s, autorizado por %s: %s',
      o.number, private.ident_label(o), op.name, private.staff_label(approver), trim(p_reason)));
  return null;
end
$$;

-- ---------------------------------------------------------------- cortesia com PIN do dono

alter table public.payments drop constraint payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('pix', 'credito', 'debito', 'dinheiro', 'fiado', 'cortesia'));
alter table public.payments add column authorized_by uuid;
alter table public.payments add foreign key (establishment_id, authorized_by) references public.staff (establishment_id, id);

drop function public.pay_order(uuid, uuid, jsonb);

-- p_payments: [{"method": "dinheiro", "amount_cents": 3500, "cash_received_cents": 5000, "customer_id": null}]
-- Com "cortesia" em alguma parte, p_auth_pin precisa ser o PIN do dono.
-- Devolve null quando deu certo, ou a mensagem quando o PIN não autorizou.
create function public.pay_order(p_token uuid, p_order uuid, p_payments jsonb, p_auth_pin text default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'caixa');
  o public.orders;
  p jsonb;
  amount int;
  total int := 0;
  remaining int;
  c public.customers;
  kitchen boolean;
  parts text[] := '{}';
  approver uuid;
begin
  select * into o from public.orders where id = p_order and establishment_id = op.establishment_id for update;
  if o.id is null then raise exception 'Pedido não encontrado' using errcode = 'P0001'; end if;
  if o.status = 'cancelado' then raise exception 'Pedido cancelado' using errcode = 'P0001'; end if;
  remaining := private.order_total(o.id) - private.order_paid(o.id);

  if exists (select 1 from jsonb_array_elements(p_payments) x where x ->> 'method' = 'cortesia' and (x ->> 'amount_cents')::int > 0) then
    approver := private.authorize(o.establishment_id, op.id, p_auth_pin, 'dono',
      format('cortesia no pedido nº %s, %s', o.number, private.ident_label(o)));
    if approver is null then return 'PIN do dono incorreto. Cortesia só com o PIN do dono.'; end if;
  end if;

  for p in select * from jsonb_array_elements(p_payments) where (value ->> 'amount_cents')::int > 0 loop
    amount := (p ->> 'amount_cents')::int;
    total := total + amount;
    if (p ->> 'method') = 'fiado' then
      select * into c from public.customers
      where id = (p ->> 'customer_id')::uuid and establishment_id = o.establishment_id and deleted_at is null
      for update;
      if c.id is null then raise exception 'Escolha o cliente do fiado' using errcode = 'P0001'; end if;
      if c.credit_limit_cents > 0 and private.customer_balance(c.id) + amount > c.credit_limit_cents then
        raise exception '% passaria do limite de fiado (%)', c.name, private.brl(c.credit_limit_cents) using errcode = 'P0001';
      end if;
    end if;
    insert into public.payments (establishment_id, order_id, method, amount_cents, cash_received_cents, customer_id, created_by, authorized_by)
    values (
      o.establishment_id, o.id, p ->> 'method', amount,
      case when p ->> 'method' = 'dinheiro' then (p ->> 'cash_received_cents')::int end,
      case when p ->> 'method' = 'fiado' then c.id end,
      op.id,
      case when p ->> 'method' = 'cortesia' then approver end
    );
    parts := parts || format('%s %s',
      case p ->> 'method' when 'pix' then 'Pix' when 'credito' then 'Crédito' when 'debito' then 'Débito'
                          when 'dinheiro' then 'Dinheiro' when 'cortesia' then 'Cortesia' else 'Fiado' end,
      private.brl(amount));
  end loop;

  if total = 0 then raise exception 'Informe o valor recebido' using errcode = 'P0001'; end if;
  if total > remaining then
    raise exception 'Valor maior que o restante (%)', private.brl(remaining) using errcode = 'P0001';
  end if;

  update public.orders set paid_cents = paid_cents + total where id = o.id;

  -- cobrança antes: só vai para a cozinha quando estiver pago
  if o.status = 'aguardando_pagamento' and total = remaining then
    select bool_or(send_to_kitchen) into kitchen from public.order_items where order_id = o.id;
    perform private.push_status(o.id, case when kitchen then 'novo' else 'pronto' end, op.id);
  end if;

  perform private.audit(o.establishment_id, op.id, 'pedido.pagar',
    format('Pedido nº %s (%s): %s%s', o.number, private.ident_label(o), array_to_string(parts, ' + '),
      case when approver is not null then ' (cortesia autorizada por ' || private.staff_label(approver) || ')' else '' end));
  return null;
end
$$;

-- ---------------------------------------------------------------- equipe: regras do dono

create or replace function public.save_staff(p_token uuid, p_id uuid, p_name text, p_pin text, p_roles text[])
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  eid uuid := op.establishment_id;
  cur public.staff;
  op_is_owner boolean := 'dono' = any (op.roles);
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome' using errcode = 'P0001'; end if;
  if cardinality(p_roles) = 0 then raise exception 'Escolha pelo menos um perfil' using errcode = 'P0001'; end if;
  if p_id is null and p_pin is null then raise exception 'Informe o PIN' using errcode = 'P0001'; end if;
  if 'dono' = any (p_roles) and not op_is_owner then
    raise exception 'Só o dono pode dar o perfil de dono' using errcode = 'P0001';
  end if;
  if p_pin is not null then
    if p_pin !~ '^\d{4,6}$' then raise exception 'O PIN deve ter de 4 a 6 números' using errcode = 'P0001'; end if;
    if exists (select 1 from public.staff where establishment_id = eid and deleted_at is null
               and id is distinct from p_id and pin_hash = extensions.crypt(p_pin, pin_hash)) then
      raise exception 'Esse PIN já está em uso' using errcode = 'P0001';
    end if;
  end if;
  if p_id is null then
    insert into public.staff (establishment_id, name, pin_hash, roles)
    values (eid, trim(p_name), extensions.crypt(p_pin, extensions.gen_salt('bf')), p_roles);
  else
    select * into cur from public.staff where id = p_id and establishment_id = eid for update;
    if cur.id is null then raise exception 'Usuário não encontrado' using errcode = 'P0001'; end if;
    if 'dono' = any (cur.roles) and not op_is_owner then
      raise exception 'Só o dono pode alterar outro dono' using errcode = 'P0001';
    end if;
    if 'dono' = any (cur.roles) and not ('dono' = any (p_roles))
       and (select count(*) from public.staff where establishment_id = eid and deleted_at is null and 'dono' = any (roles)) = 1 then
      raise exception 'É preciso ter pelo menos um dono' using errcode = 'P0001';
    end if;
    if cur.roles && array['gerente', 'dono'] and not (p_roles && array['gerente', 'dono'])
       and (select count(*) from public.staff where establishment_id = eid and deleted_at is null and roles && array['gerente', 'dono']) = 1 then
      raise exception 'É preciso ter pelo menos um gerente' using errcode = 'P0001';
    end if;
    update public.staff
    set name = trim(p_name), roles = p_roles,
        pin_hash = case when p_pin is null then pin_hash else extensions.crypt(p_pin, extensions.gen_salt('bf')) end
    where id = p_id;
  end if;
  perform private.audit(eid, op.id, case when p_id is null then 'usuario.criar' else 'usuario.editar' end,
    format('Usuário %s (%s)%s', trim(p_name), array_to_string(p_roles, ', '),
      case when p_id is not null and p_pin is not null then ', PIN trocado' else '' end));
end
$$;

create or replace function public.set_trashed(p_token uuid, p_kind text, p_id uuid, p_trashed boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, case when p_kind = 'customers' then 'caixa' else 'gerente' end);
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
    if 'dono' = any (target.roles) and not ('dono' = any (op.roles)) then
      raise exception 'Só o dono pode excluir ou restaurar outro dono' using errcode = 'P0001';
    end if;
    if p_trashed and 'dono' = any (target.roles)
       and (select count(*) from public.staff where establishment_id = eid and deleted_at is null and 'dono' = any (roles)) = 1 then
      raise exception 'É preciso ter pelo menos um dono' using errcode = 'P0001';
    end if;
    if p_trashed and target.roles && array['gerente', 'dono']
       and (select count(*) from public.staff where establishment_id = eid and deleted_at is null and roles && array['gerente', 'dono']) = 1 then
      raise exception 'É preciso ter pelo menos um gerente' using errcode = 'P0001';
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

-- entrega: dono também
create or replace function public.set_order_status(p_token uuid, p_order uuid, p_status text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token);
  o public.orders;
begin
  if p_status not in ('preparo', 'pronto', 'entregue') then
    raise exception 'Status inválido' using errcode = 'P0001';
  end if;
  -- cozinha: preparo/pronto; atendente e caixa: entregue
  if p_status in ('preparo', 'pronto') then perform private.operator(p_token, 'cozinha');
  elsif not (op.roles && array['atendente', 'caixa', 'gerente', 'dono']) then
    raise exception 'Seu perfil não permite esta ação.' using errcode = 'P0001';
  end if;
  select * into o from public.orders where id = p_order and establishment_id = op.establishment_id for update;
  if o.id is null then raise exception 'Pedido não encontrado' using errcode = 'P0001'; end if;
  if o.status in ('cancelado', 'aguardando_pagamento') then
    raise exception 'Pedido % não pode mudar de situação agora', o.number using errcode = 'P0001';
  end if;
  perform private.push_status(o.id, p_status, op.id);
  perform private.audit(o.establishment_id, op.id, 'pedido.status',
    format('Pedido nº %s → %s', o.number,
      case p_status when 'preparo' then 'Em preparo' when 'pronto' then 'Pronto' else 'Entregue' end));
end
$$;

-- cadastro inicial: o dono recebe o perfil "dono"
create or replace function private.bootstrap_establishment(p_name text, p_owner_email text, p_owner_name text, p_owner_pin text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  uid uuid;
  eid uuid;
  cat uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_owner_email));
  if uid is null then
    raise exception 'Conta % não existe. Crie em Authentication → Users primeiro.', p_owner_email;
  end if;
  if p_owner_pin !~ '^\d{4,6}$' then raise exception 'O PIN deve ter de 4 a 6 números'; end if;
  insert into public.establishments (name) values (trim(p_name)) returning id into eid;
  insert into public.members (establishment_id, user_id) values (eid, uid);
  insert into public.staff (establishment_id, name, pin_hash, roles)
  values (eid, p_owner_name, extensions.crypt(p_owner_pin, extensions.gen_salt('bf')), array['dono', 'gerente', 'caixa', 'atendente', 'cozinha']);
  insert into public.categories (establishment_id, name, sort) values (eid, 'Espetinhos', 1) returning id into cat;
  insert into public.categories (establishment_id, name, sort) values (eid, 'Acompanhamentos', 2), (eid, 'Bebidas', 3);
  insert into public.audit_log (establishment_id, action, summary) values (eid, 'estabelecimento.criar', 'Estabelecimento criado');
  return eid;
end
$$;

-- ---------------------------------------------------------------- permissões

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_establishments(), private.is_platform_admin() to authenticated;
revoke all on all functions in schema public from public, anon;
grant execute on function
  public.operator_login(uuid, text), public.operator_logout(uuid), public.log_device_event(text, text),
  public.cancel_order(uuid, uuid, text, text), public.pay_order(uuid, uuid, jsonb, text),
  public.save_staff(uuid, uuid, text, text, text[]), public.set_trashed(uuid, text, uuid, boolean),
  public.set_order_status(uuid, uuid, text)
to authenticated;
-- os novos campos podem ser lidos (o app mostra quem autorizou)
grant select on public.orders, public.payments to authenticated;
