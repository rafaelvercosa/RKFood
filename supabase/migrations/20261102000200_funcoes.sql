-- =============================================================================
-- RKFood: funções chamadas pelo app (RPC)
-- Todas são SECURITY DEFINER: conferem a sessão do operador, o perfil e o
-- estabelecimento antes de gravar, e sempre registram no histórico.
-- =============================================================================

-- ---------------------------------------------------------------- contexto e login

-- Estabelecimentos da conta logada (para o app saber onde entrar).
create function public.my_context()
returns table (establishment_id uuid, name text, is_platform_admin boolean)
language sql stable security definer set search_path = ''
as $$
  select e.id, e.name, (select private.is_platform_admin())
  from public.establishments e
  where e.id in (select private.my_establishments())
  order by e.name
$$;

-- Operador digita o PIN; devolve um token de sessão.
create function public.operator_login(p_establishment uuid, p_pin text)
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
    raise exception 'PIN não encontrado' using errcode = 'P0001';
  end if;
  delete from private.operator_sessions where expires_at < now();
  insert into private.operator_sessions (establishment_id, staff_id, user_id)
  values (p_establishment, s.id, (select auth.uid()))
  returning operator_sessions.token into t;
  return query select t, s.id, s.name, s.roles;
end
$$;

create function public.operator_logout(p_token uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  delete from private.operator_sessions where token = p_token and user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------- pedidos

-- p_items: [{"product_id": "...", "qty": 2, "notes": "bem passado"}]
-- Nome, preço e "vai para a cozinha" são lidos do cardápio no servidor.
create function public.create_order(
  p_token uuid, p_ident_type text, p_ident_value text, p_mode text, p_notes text, p_items jsonb
)
returns public.orders
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'atendente');
  eid uuid := op.establishment_id;
  est public.establishments;
  bdate date := private.business_date(op.establishment_id);
  o public.orders;
  it jsonb;
  pr public.products;
  initial text;
  kitchen boolean := false;
begin
  if coalesce(trim(p_ident_value), '') = '' then
    raise exception '%', case when p_ident_type = 'mesa' then 'Informe a mesa' else 'Informe o nome do cliente' end using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione pelo menos um item' using errcode = 'P0001';
  end if;
  select * into est from public.establishments where id = eid;
  initial := case when est.payment_timing = 'antes' then 'aguardando_pagamento' else 'novo' end;

  -- numeração sequencial do dia sem corrida entre aparelhos
  perform pg_advisory_xact_lock(hashtextextended(eid::text || bdate::text, 0));

  insert into public.orders (establishment_id, number, business_date, created_by, ident_type, ident_value, mode, notes, status, status_history)
  values (
    eid,
    coalesce((select max(number) from public.orders where establishment_id = eid and business_date = bdate), 0) + 1,
    bdate, op.id, p_ident_type, trim(p_ident_value), p_mode, trim(coalesce(p_notes, '')), initial,
    jsonb_build_array(jsonb_build_object('status', initial, 'at', now(), 'by', op.id))
  )
  returning * into o;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from public.products
    where id = (it ->> 'product_id')::uuid and establishment_id = eid and deleted_at is null;
    if pr.id is null then raise exception 'Item do cardápio não encontrado' using errcode = 'P0001'; end if;
    if not pr.active then raise exception '"%" está indisponível', pr.name using errcode = 'P0001'; end if;
    if coalesce((it ->> 'qty')::int, 0) <= 0 then raise exception 'Quantidade inválida' using errcode = 'P0001'; end if;
    insert into public.order_items (establishment_id, order_id, product_id, name, unit_price_cents, qty, notes, send_to_kitchen)
    values (eid, o.id, pr.id, pr.name, pr.price_cents, (it ->> 'qty')::int, trim(coalesce(it ->> 'notes', '')), pr.send_to_kitchen);
    kitchen := kitchen or pr.send_to_kitchen;
  end loop;

  update public.orders set total_cents = private.order_total(o.id) where id = o.id;

  -- pedido só com itens que não passam pela cozinha já nasce pronto
  if initial = 'novo' and not kitchen then
    perform private.push_status(o.id, 'pronto', op.id);
  end if;

  perform private.audit(eid, op.id, 'pedido.criar',
    format('Pedido nº %s — %s — %s', o.number,
      case when o.ident_type = 'mesa' then 'Mesa ' || o.ident_value else o.ident_value end,
      private.brl(private.order_total(o.id))));
  select * into o from public.orders where id = o.id;
  return o;
end
$$;

create function public.set_order_status(p_token uuid, p_order uuid, p_status text)
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
  elsif not (op.roles && array['atendente', 'caixa', 'gerente']) then
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

create function public.cancel_order(p_token uuid, p_order uuid, p_reason text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'caixa');
  o public.orders;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo do cancelamento' using errcode = 'P0001'; end if;
  select * into o from public.orders where id = p_order and establishment_id = op.establishment_id for update;
  if o.id is null then raise exception 'Pedido não encontrado' using errcode = 'P0001'; end if;
  if private.order_paid(o.id) > 0 then
    raise exception 'Pedido já tem pagamento registrado e não pode ser cancelado' using errcode = 'P0001';
  end if;
  update public.orders set cancel_reason = trim(p_reason) where id = o.id;
  perform private.push_status(o.id, 'cancelado', op.id);
  perform private.audit(o.establishment_id, op.id, 'pedido.cancelar', format('Pedido nº %s cancelado: %s', o.number, trim(p_reason)));
end
$$;

-- p_payments: [{"method": "dinheiro", "amount_cents": 3500, "cash_received_cents": 5000, "customer_id": null}]
create function public.pay_order(p_token uuid, p_order uuid, p_payments jsonb)
returns void
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
begin
  select * into o from public.orders where id = p_order and establishment_id = op.establishment_id for update;
  if o.id is null then raise exception 'Pedido não encontrado' using errcode = 'P0001'; end if;
  if o.status = 'cancelado' then raise exception 'Pedido cancelado' using errcode = 'P0001'; end if;
  remaining := private.order_total(o.id) - private.order_paid(o.id);

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
    insert into public.payments (establishment_id, order_id, method, amount_cents, cash_received_cents, customer_id, created_by)
    values (
      o.establishment_id, o.id, p ->> 'method', amount,
      case when p ->> 'method' = 'dinheiro' then (p ->> 'cash_received_cents')::int end,
      case when p ->> 'method' = 'fiado' then c.id end,
      op.id
    );
    parts := parts || format('%s %s',
      case p ->> 'method' when 'pix' then 'Pix' when 'credito' then 'Crédito' when 'debito' then 'Débito'
                          when 'dinheiro' then 'Dinheiro' else 'Fiado' end,
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

  perform private.audit(o.establishment_id, op.id, 'pedido.pagar', format('Pedido nº %s: %s', o.number, array_to_string(parts, ' + ')));
end
$$;

-- ---------------------------------------------------------------- fiado

create function public.save_customer(
  p_token uuid, p_id uuid, p_name text, p_phone text, p_notes text, p_credit_limit_cents int
)
returns public.customers
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'caixa');
  c public.customers;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do cliente' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.customers (establishment_id, name, phone, notes, credit_limit_cents)
    values (op.establishment_id, trim(p_name), regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), coalesce(p_notes, ''), greatest(coalesce(p_credit_limit_cents, 0), 0))
    returning * into c;
  else
    update public.customers
    set name = trim(p_name), phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), notes = coalesce(p_notes, ''),
        credit_limit_cents = greatest(coalesce(p_credit_limit_cents, 0), 0)
    where id = p_id and establishment_id = op.establishment_id
    returning * into c;
    if c.id is null then raise exception 'Cliente não encontrado' using errcode = 'P0001'; end if;
  end if;
  perform private.audit(op.establishment_id, op.id, case when p_id is null then 'cliente.criar' else 'cliente.editar' end, 'Cliente ' || c.name);
  return c;
end
$$;

create function public.receive_fiado(p_token uuid, p_customer uuid, p_amount_cents int, p_method text, p_notes text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'caixa');
  c public.customers;
  bal int;
begin
  if coalesce(p_amount_cents, 0) <= 0 then raise exception 'Informe o valor' using errcode = 'P0001'; end if;
  select * into c from public.customers where id = p_customer and establishment_id = op.establishment_id for update;
  if c.id is null then raise exception 'Cliente não encontrado' using errcode = 'P0001'; end if;
  bal := private.customer_balance(c.id);
  if p_amount_cents > bal then raise exception 'Valor maior que a dívida (%)', private.brl(bal) using errcode = 'P0001'; end if;
  insert into public.fiado_settlements (establishment_id, customer_id, amount_cents, method, notes, created_by)
  values (op.establishment_id, c.id, p_amount_cents, p_method, trim(coalesce(p_notes, '')), op.id);
  perform private.audit(op.establishment_id, op.id, 'fiado.receber',
    format('Fiado recebido de %s: %s (%s)', c.name, private.brl(p_amount_cents),
      case p_method when 'pix' then 'Pix' when 'credito' then 'Crédito' when 'debito' then 'Débito' else 'Dinheiro' end));
end
$$;

-- ---------------------------------------------------------------- cardápio

create function public.save_category(p_token uuid, p_id uuid, p_name text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome da categoria' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.categories (establishment_id, name, sort)
    values (op.establishment_id, trim(p_name),
      coalesce((select max(sort) from public.categories where establishment_id = op.establishment_id), 0) + 1);
  else
    update public.categories set name = trim(p_name) where id = p_id and establishment_id = op.establishment_id;
  end if;
  perform private.audit(op.establishment_id, op.id, case when p_id is null then 'categoria.criar' else 'categoria.editar' end, 'Categoria ' || trim(p_name));
end
$$;

create function public.move_category(p_token uuid, p_id uuid, p_dir int)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  cur public.categories;
  other public.categories;
begin
  select * into cur from public.categories where id = p_id and establishment_id = op.establishment_id and deleted_at is null;
  if cur.id is null then return; end if;
  select * into other from public.categories
  where establishment_id = op.establishment_id and deleted_at is null
    and case when p_dir < 0 then sort < cur.sort else sort > cur.sort end
  order by case when p_dir < 0 then -sort else sort end
  limit 1;
  if other.id is null then return; end if;
  update public.categories set sort = other.sort where id = cur.id;
  update public.categories set sort = cur.sort where id = other.id;
  perform private.audit(op.establishment_id, op.id, 'categoria.ordenar', 'Ordem das categorias alterada');
end
$$;

create function public.save_product(
  p_token uuid, p_id uuid, p_category uuid, p_name text, p_description text, p_price_cents int,
  p_photo_url text, p_active boolean, p_send_to_kitchen boolean
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do item' using errcode = 'P0001'; end if;
  if coalesce(p_price_cents, 0) <= 0 then raise exception 'Informe o preço' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.categories where id = p_category and establishment_id = op.establishment_id and deleted_at is null) then
    raise exception 'Escolha a categoria' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.products (establishment_id, category_id, name, description, price_cents, photo_url, active, send_to_kitchen)
    values (op.establishment_id, p_category, trim(p_name), coalesce(p_description, ''), p_price_cents, p_photo_url, p_active, p_send_to_kitchen);
  else
    update public.products
    set category_id = p_category, name = trim(p_name), description = coalesce(p_description, ''), price_cents = p_price_cents,
        photo_url = p_photo_url, active = p_active, send_to_kitchen = p_send_to_kitchen
    where id = p_id and establishment_id = op.establishment_id;
    if not found then raise exception 'Item não encontrado' using errcode = 'P0001'; end if;
  end if;
  perform private.audit(op.establishment_id, op.id, case when p_id is null then 'item.criar' else 'item.editar' end,
    format('Item %s — %s', trim(p_name), private.brl(p_price_cents)));
end
$$;

-- ---------------------------------------------------------------- lixeira

-- p_kind: categories | products | customers | users
create function public.set_trashed(p_token uuid, p_kind text, p_id uuid, p_trashed boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, case when p_kind = 'customers' then 'caixa' else 'gerente' end);
  eid uuid := op.establishment_id;
  nm text;
  label text;
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
    if p_trashed and p_id = op.id then raise exception 'Você não pode excluir o próprio usuário' using errcode = 'P0001'; end if;
    if p_trashed and (select 'gerente' = any (roles) from public.staff where id = p_id)
       and (select count(*) from public.staff where establishment_id = eid and deleted_at is null and 'gerente' = any (roles)) = 1 then
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

-- ---------------------------------------------------------------- estabelecimento e equipe

create function public.save_establishment(
  p_token uuid, p_name text, p_slogan text, p_logo_url text, p_cover_url text, p_brand_color text,
  p_payment_timing text, p_phone text, p_address text, p_pix_key text
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do estabelecimento' using errcode = 'P0001'; end if;
  update public.establishments
  set name = trim(p_name), slogan = coalesce(p_slogan, ''), logo_url = p_logo_url, cover_url = p_cover_url,
      brand_color = p_brand_color, payment_timing = p_payment_timing, phone = coalesce(p_phone, ''),
      address = coalesce(p_address, ''), pix_key = coalesce(p_pix_key, '')
  where id = op.establishment_id;
  perform private.audit(op.establishment_id, op.id, 'estabelecimento.editar', 'Dados do estabelecimento atualizados');
end
$$;

-- p_pin = null mantém o PIN atual (só ao editar).
create function public.save_staff(p_token uuid, p_id uuid, p_name text, p_pin text, p_roles text[])
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  eid uuid := op.establishment_id;
  cur public.staff;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome' using errcode = 'P0001'; end if;
  if cardinality(p_roles) = 0 then raise exception 'Escolha pelo menos um perfil' using errcode = 'P0001'; end if;
  if p_id is null and p_pin is null then raise exception 'Informe o PIN' using errcode = 'P0001'; end if;
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
    if 'gerente' = any (cur.roles) and not ('gerente' = any (p_roles))
       and (select count(*) from public.staff where establishment_id = eid and deleted_at is null and 'gerente' = any (roles)) = 1 then
      raise exception 'É preciso ter pelo menos um gerente' using errcode = 'P0001';
    end if;
    update public.staff
    set name = trim(p_name), roles = p_roles,
        pin_hash = case when p_pin is null then pin_hash else extensions.crypt(p_pin, extensions.gen_salt('bf')) end
    where id = p_id;
  end if;
  perform private.audit(eid, op.id, case when p_id is null then 'usuario.criar' else 'usuario.editar' end,
    format('Usuário %s (%s)', trim(p_name), array_to_string(p_roles, ', ')));
end
$$;

-- ---------------------------------------------------------------- implantação de cliente novo

-- Rodar no SQL Editor (como administrador), depois de criar a conta de e-mail
-- do estabelecimento em Authentication → Users:
--   select private.bootstrap_establishment('Espetinho do Zé', 'ze@email.com', 'Zé', '1234');
create function private.bootstrap_establishment(p_name text, p_owner_email text, p_owner_name text, p_owner_pin text)
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
  values (eid, p_owner_name, extensions.crypt(p_owner_pin, extensions.gen_salt('bf')), array['gerente', 'caixa', 'atendente', 'cozinha']);
  insert into public.categories (establishment_id, name, sort) values (eid, 'Espetinhos', 1) returning id into cat;
  insert into public.categories (establishment_id, name, sort) values (eid, 'Acompanhamentos', 2), (eid, 'Bebidas', 3);
  insert into public.audit_log (establishment_id, action, summary) values (eid, 'estabelecimento.criar', 'Estabelecimento criado');
  return eid;
end
$$;

-- Liga mais uma conta (ex.: outro aparelho com e-mail próprio) ao estabelecimento.
create function private.add_member(p_establishment uuid, p_email text)
returns void
language sql volatile security definer set search_path = ''
as $$
  insert into public.members (establishment_id, user_id)
  select p_establishment, id from auth.users where lower(email) = lower(trim(p_email))
  on conflict do nothing
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_establishments(), private.is_platform_admin() to authenticated;
revoke all on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
