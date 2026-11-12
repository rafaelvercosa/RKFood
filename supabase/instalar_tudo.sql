-- ARQUIVO GERADO por "npm run db:bundle". Não edite aqui: edite supabase/migrations/.
-- Cole tudo no Supabase → SQL Editor → New query → Run. Rodar UMA vez num projeto novo.

-- >>>>>>>>>> 20261102000100_esquema_inicial.sql
-- =============================================================================
-- RKFood: esquema inicial (multi-empresa)
--
-- Modelo de segurança
--  * Cada estabelecimento é um "tenant". Toda tabela tem establishment_id.
--  * Uma conta do Supabase Auth (e-mail e senha) é ligada a um ou mais
--    estabelecimentos pela tabela `members`. Essa é a conta do APARELHO: o
--    gerente entra uma vez no celular/tablet/TV.
--  * Quem está operando o aparelho se identifica com um PIN (tabela `staff`).
--    O PIN gera uma sessão de operador (token) que vale por 16 h. TODA escrita
--    passa por funções (RPC) que recebem esse token, conferem o perfil
--    (atendente, cozinha, caixa, gerente) e registram no histórico.
--  * As tabelas só aceitam SELECT direto, e só do próprio estabelecimento (RLS).
--    Inserir, alterar e "excluir" é feito apenas pelas funções abaixo.
--  * Nada é apagado: exclusão = deleted_at preenchido; pedido = cancelado.
--  * Dinheiro sempre em centavos (integer).
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;

-- ----------------------------------------------------------------------------
-- Tabelas
-- ----------------------------------------------------------------------------

create table public.establishments (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  slogan         text not null default '',
  logo_url       text,
  cover_url      text,
  brand_color    text not null default '#c2410c' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  payment_timing text not null default 'depois' check (payment_timing in ('antes', 'depois')),
  phone          text not null default '',
  address        text not null default '',
  pix_key        text not null default '',
  timezone       text not null default 'America/Sao_Paulo',
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.members (
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (establishment_id, user_id)
);
create index members_user_id_idx on public.members (user_id);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.staff (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  pin_hash         text not null,
  roles            text[] not null check (
                     cardinality(roles) > 0
                     and roles <@ array['atendente', 'cozinha', 'caixa', 'gerente']
                   ),
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (establishment_id, id)
);
create index staff_establishment_idx on public.staff (establishment_id);

create table private.operator_sessions (
  token            uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  staff_id         uuid not null references public.staff (id) on delete cascade,
  user_id          uuid not null,
  expires_at       timestamptz not null default now() + interval '16 hours'
);
create index operator_sessions_staff_idx on private.operator_sessions (staff_id);

create table public.categories (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  sort             integer not null default 0,
  deleted_at       timestamptz,
  unique (establishment_id, id)
);
create index categories_establishment_idx on public.categories (establishment_id);

create table public.products (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null,
  category_id      uuid not null,
  name             text not null check (length(trim(name)) > 0),
  description      text not null default '',
  price_cents      integer not null check (price_cents > 0),
  photo_url        text,
  active           boolean not null default true,
  send_to_kitchen  boolean not null default true,
  deleted_at       timestamptz,
  unique (establishment_id, id),
  foreign key (establishment_id) references public.establishments (id) on delete cascade,
  foreign key (establishment_id, category_id) references public.categories (establishment_id, id)
);
create index products_establishment_idx on public.products (establishment_id);
create index products_category_idx on public.products (establishment_id, category_id);

create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  establishment_id   uuid not null references public.establishments (id) on delete cascade,
  name               text not null check (length(trim(name)) > 0),
  phone              text not null default '',
  notes              text not null default '',
  credit_limit_cents integer not null default 0 check (credit_limit_cents >= 0),
  deleted_at         timestamptz,
  unique (establishment_id, id)
);
create index customers_establishment_idx on public.customers (establishment_id);

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  number           integer not null,
  business_date    date not null,
  created_at       timestamptz not null default now(),
  created_by       uuid not null,
  ident_type       text not null check (ident_type in ('mesa', 'nome')),
  ident_value      text not null check (length(trim(ident_value)) > 0),
  mode             text not null check (mode in ('local', 'viagem')),
  notes            text not null default '',
  status           text not null check (status in ('aguardando_pagamento', 'novo', 'preparo', 'pronto', 'entregue', 'cancelado')),
  status_history   jsonb not null default '[]',
  cancel_reason    text,
  -- mantidos pelas funções create_order/pay_order; permitem filtrar "a receber" rápido
  total_cents      integer not null default 0,
  paid_cents       integer not null default 0,
  settled          boolean generated always as (paid_cents >= total_cents) stored,
  unique (establishment_id, id),
  unique (establishment_id, business_date, number),
  foreign key (establishment_id, created_by) references public.staff (establishment_id, id)
);
create index orders_open_idx on public.orders (establishment_id, status) where status not in ('entregue', 'cancelado');
create index orders_unsettled_idx on public.orders (establishment_id) where not settled and status <> 'cancelado';
create index orders_business_date_idx on public.orders (establishment_id, business_date);
create index orders_created_by_idx on public.orders (establishment_id, created_by);

create table public.order_items (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null,
  order_id         uuid not null,
  product_id       uuid not null,
  name             text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  qty              integer not null check (qty > 0),
  notes            text not null default '',
  send_to_kitchen  boolean not null,
  foreign key (establishment_id, order_id) references public.orders (establishment_id, id) on delete cascade,
  foreign key (establishment_id, product_id) references public.products (establishment_id, id)
);
create index order_items_order_idx on public.order_items (establishment_id, order_id);
create index order_items_product_idx on public.order_items (establishment_id, product_id);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  establishment_id    uuid not null,
  order_id            uuid not null,
  method              text not null check (method in ('pix', 'credito', 'debito', 'dinheiro', 'fiado')),
  amount_cents        integer not null check (amount_cents > 0),
  cash_received_cents integer check (cash_received_cents is null or cash_received_cents >= amount_cents),
  customer_id         uuid,
  created_at          timestamptz not null default now(),
  created_by          uuid not null,
  check ((method = 'fiado') = (customer_id is not null)),
  foreign key (establishment_id, order_id) references public.orders (establishment_id, id),
  foreign key (establishment_id, customer_id) references public.customers (establishment_id, id),
  foreign key (establishment_id, created_by) references public.staff (establishment_id, id)
);
create index payments_order_idx on public.payments (establishment_id, order_id);
create index payments_customer_idx on public.payments (establishment_id, customer_id) where customer_id is not null;
create index payments_created_by_idx on public.payments (establishment_id, created_by);

create table public.fiado_settlements (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null,
  customer_id      uuid not null,
  amount_cents     integer not null check (amount_cents > 0),
  method           text not null check (method in ('pix', 'credito', 'debito', 'dinheiro')),
  notes            text not null default '',
  created_at       timestamptz not null default now(),
  created_by       uuid not null,
  foreign key (establishment_id, customer_id) references public.customers (establishment_id, id),
  foreign key (establishment_id, created_by) references public.staff (establishment_id, id)
);
create index fiado_settlements_customer_idx on public.fiado_settlements (establishment_id, customer_id);
create index fiado_settlements_created_by_idx on public.fiado_settlements (establishment_id, created_by);

create table public.audit_log (
  id               bigint generated always as identity primary key,
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  at               timestamptz not null default now(),
  staff_id         uuid,
  action           text not null,
  summary          text not null
);
create index audit_log_establishment_at_idx on public.audit_log (establishment_id, at desc);

-- ----------------------------------------------------------------------------
-- Funções auxiliares (schema private, não expostas na API)
-- ----------------------------------------------------------------------------

-- Estabelecimentos da conta logada. Usada nas políticas de RLS.
create function private.my_establishments()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.establishment_id
  from public.members m
  join public.establishments e on e.id = m.establishment_id and e.active
  where m.user_id = (select auth.uid())
$$;

create function private.is_platform_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()))
$$;

create function private.brl(cents integer)
returns text
language sql immutable set search_path = ''
as $$
  select 'R$ ' || replace(replace(replace(to_char(cents / 100.0, 'FM999G999G990D00'), '.', '#'), ',', '.'), '#', ',')
$$;

create function private.business_date(p_establishment uuid)
returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone e.timezone)::date from public.establishments e where e.id = p_establishment
$$;

-- Confere o token do operador e o perfil exigido. Devolve o operador.
-- Gerente pode tudo. Lança erro amigável se não puder.
create function private.operator(p_token uuid, p_role text default null)
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
  if p_role is not null and not (p_role = any (s.roles) or 'gerente' = any (s.roles)) then
    raise exception 'Seu perfil não permite esta ação.' using errcode = 'P0001';
  end if;
  return s;
end
$$;

create function private.audit(p_establishment uuid, p_staff uuid, p_action text, p_summary text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.audit_log (establishment_id, staff_id, action, summary)
  values (p_establishment, p_staff, p_action, p_summary)
$$;

create function private.order_total(p_order uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(unit_price_cents * qty), 0)::integer from public.order_items where order_id = p_order
$$;

create function private.order_paid(p_order uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(amount_cents), 0)::integer from public.payments where order_id = p_order
$$;

create function private.customer_balance(p_customer uuid)
returns integer
language sql stable security definer set search_path = ''
as $$
  select (
    coalesce((select sum(p.amount_cents) from public.payments p
              join public.orders o on o.id = p.order_id
              where p.customer_id = p_customer and p.method = 'fiado' and o.status <> 'cancelado'), 0)
    - coalesce((select sum(amount_cents) from public.fiado_settlements where customer_id = p_customer), 0)
  )::integer
$$;

create function private.push_status(p_order uuid, p_status text, p_staff uuid)
returns void
language sql security definer set search_path = ''
as $$
  update public.orders
  set status = p_status,
      status_history = status_history || jsonb_build_array(jsonb_build_object('status', p_status, 'at', now(), 'by', p_staff))
  where id = p_order
$$;

revoke all on all functions in schema private from public, anon, authenticated;
-- As políticas de RLS chamam estas duas como o próprio usuário logado.
grant usage on schema private to authenticated;
grant execute on function private.my_establishments(), private.is_platform_admin() to authenticated;

-- ----------------------------------------------------------------------------
-- RLS: cada conta só enxerga o próprio estabelecimento
-- ----------------------------------------------------------------------------

alter table public.establishments    enable row level security;
alter table public.members           enable row level security;
alter table public.platform_admins   enable row level security;
alter table public.staff             enable row level security;
alter table public.categories        enable row level security;
alter table public.products          enable row level security;
alter table public.customers         enable row level security;
alter table public.orders            enable row level security;
alter table public.order_items       enable row level security;
alter table public.payments          enable row level security;
alter table public.fiado_settlements enable row level security;
alter table public.audit_log         enable row level security;
alter table private.operator_sessions enable row level security;

create policy establishments_select on public.establishments for select to authenticated
  using (id in (select private.my_establishments()) or (select private.is_platform_admin()));

create policy members_select on public.members for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_platform_admin()));

do $$
declare t text;
begin
  foreach t in array array['staff', 'categories', 'products', 'customers', 'orders', 'order_items',
                           'payments', 'fiado_settlements', 'audit_log']
  loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated
         using (establishment_id in (select private.my_establishments()))', t);
  end loop;
end
$$;

-- Só leitura direta. Escrita apenas pelas funções.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.establishments, public.members, public.categories, public.products,
  public.customers, public.orders, public.order_items, public.payments, public.fiado_settlements,
  public.audit_log to authenticated;
-- O hash do PIN nunca sai do banco.
grant select (id, establishment_id, name, roles, deleted_at, created_at) on public.staff to authenticated;


-- >>>>>>>>>> 20261102000200_funcoes.sql
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


-- >>>>>>>>>> 20261102000300_fotos_e_tempo_real.sql
-- =============================================================================
-- RKFood: fotos (Storage) e atualização em tempo real (Realtime)
-- =============================================================================

-- Fotos do cardápio, logomarca e foto do estabelecimento.
-- Caminho do arquivo: <establishment_id>/<nome-do-arquivo>.jpg
-- Leitura pública (aparece no cardápio); escrita só pela conta do próprio estabelecimento.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('midia', 'midia', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$
      create policy midia_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'midia' and (storage.foldername(name))[1] in (select id::text from private.my_establishments() id))
    $p$;
    execute $p$
      create policy midia_update on storage.objects for update to authenticated
      using (bucket_id = 'midia' and (storage.foldername(name))[1] in (select id::text from private.my_establishments() id))
    $p$;
    execute $p$
      create policy midia_delete on storage.objects for delete to authenticated
      using (bucket_id = 'midia' and (storage.foldername(name))[1] in (select id::text from private.my_establishments() id))
    $p$;
  end if;
end
$$;

-- Tempo real: aparelhos recebem pedidos e mudanças na hora.
-- O Realtime respeita o RLS: cada aparelho só recebe o que é do seu estabelecimento.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.orders, public.order_items, public.payments, public.fiado_settlements,
      public.products, public.categories, public.customers, public.establishments;
  end if;
end
$$;


-- >>>>>>>>>> 20261103000100_tempo_de_preparo.sql
-- =============================================================================
-- RKFood: tempo estimado de preparo
-- O gerente define em quantos minutos um pedido deve ficar pronto. A cozinha usa
-- esse tempo para o cronômetro de cada comanda e para o alerta de atrasados.
-- =============================================================================

alter table public.establishments
  add column kitchen_target_min integer not null default 15
    check (kitchen_target_min between 1 and 180);

-- save_establishment ganha o tempo estimado (troca de assinatura: apaga a antiga).
drop function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text);

create function public.save_establishment(
  p_token uuid, p_name text, p_slogan text, p_logo_url text, p_cover_url text, p_brand_color text,
  p_payment_timing text, p_phone text, p_address text, p_pix_key text, p_kitchen_target_min int
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  old_target int;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do estabelecimento' using errcode = 'P0001'; end if;
  if p_kitchen_target_min is null or p_kitchen_target_min not between 1 and 180 then
    raise exception 'O tempo estimado deve ser de 1 a 180 minutos' using errcode = 'P0001';
  end if;
  select kitchen_target_min into old_target from public.establishments where id = op.establishment_id;
  update public.establishments
  set name = trim(p_name), slogan = coalesce(p_slogan, ''), logo_url = p_logo_url, cover_url = p_cover_url,
      brand_color = p_brand_color, payment_timing = p_payment_timing, phone = coalesce(p_phone, ''),
      address = coalesce(p_address, ''), pix_key = coalesce(p_pix_key, ''), kitchen_target_min = p_kitchen_target_min
  where id = op.establishment_id;
  perform private.audit(op.establishment_id, op.id, 'estabelecimento.editar',
    case when old_target is distinct from p_kitchen_target_min
      then format('Dados do estabelecimento atualizados (tempo estimado: %s → %s min)', old_target, p_kitchen_target_min)
      else 'Dados do estabelecimento atualizados' end);
end
$$;

revoke all on function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int) from public, anon;
grant execute on function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int) to authenticated;


-- >>>>>>>>>> 20261103000200_adiantar_pedido.sql
-- =============================================================================
-- RKFood: adiantar pedido na fila da cozinha
-- O gerente pode puxar um pedido para o topo da fila (cliente que teve algum
-- problema). Sempre com motivo, e fica no histórico. Pedidos adiantados ficam
-- antes dos outros, na ordem em que foram adiantados.
-- =============================================================================

alter table public.orders
  add column priority_at timestamptz,
  add column priority_reason text;

create function public.set_order_priority(p_token uuid, p_order uuid, p_priority boolean, p_reason text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  o public.orders;
begin
  select * into o from public.orders where id = p_order and establishment_id = op.establishment_id for update;
  if o.id is null then raise exception 'Pedido não encontrado' using errcode = 'P0001'; end if;
  if p_priority then
    if o.status not in ('novo', 'preparo') then
      raise exception 'Só dá para adiantar pedido que está na fila da cozinha' using errcode = 'P0001';
    end if;
    if coalesce(trim(p_reason), '') = '' then raise exception 'Informe o motivo' using errcode = 'P0001'; end if;
    update public.orders set priority_at = now(), priority_reason = trim(p_reason) where id = o.id;
    perform private.audit(o.establishment_id, op.id, 'pedido.adiantar',
      format('Pedido nº %s (%s) adiantado na fila: %s',
        o.number, case when o.ident_type = 'mesa' then 'Mesa ' || o.ident_value else o.ident_value end, trim(p_reason)));
  else
    if o.priority_at is null then return; end if;
    update public.orders set priority_at = null, priority_reason = null where id = o.id;
    perform private.audit(o.establishment_id, op.id, 'pedido.adiantar',
      format('Pedido nº %s (%s) voltou à ordem normal da fila',
        o.number, case when o.ident_type = 'mesa' then 'Mesa ' || o.ident_value else o.ident_value end));
  end if;
end
$$;

revoke all on function public.set_order_priority(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_order_priority(uuid, uuid, boolean, text) to authenticated;


-- >>>>>>>>>> 20261103000300_dono_autorizacao_historico.sql
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


-- >>>>>>>>>> 20261103000400_mesas_e_aparencia.sql
-- =============================================================================
-- RKFood: quantidade de mesas e aparência só pelo dono
--
--  * table_count: quantos botões de mesa o atendente vê (0 = nenhum, só o campo
--    de texto). Gerente ou dono escolhe.
--  * Aparência do estabelecimento (nome, frase, cor, logomarca e foto): só o dono
--    muda. O gerente continua mudando o funcionamento (cobrança, tempo de preparo,
--    mesas) e o contato (telefone, endereço, Pix).
-- =============================================================================

alter table public.establishments
  add column table_count integer not null default 10
    check (table_count between 0 and 200);

drop function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int);

create function public.save_establishment(
  p_token uuid, p_name text, p_slogan text, p_logo_url text, p_cover_url text, p_brand_color text,
  p_payment_timing text, p_phone text, p_address text, p_pix_key text, p_kitchen_target_min int, p_table_count int
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  cur public.establishments;
  changes text[] := '{}';
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do estabelecimento' using errcode = 'P0001'; end if;
  if p_kitchen_target_min is null or p_kitchen_target_min not between 1 and 180 then
    raise exception 'O tempo estimado deve ser de 1 a 180 minutos' using errcode = 'P0001';
  end if;
  if p_table_count is null or p_table_count not between 0 and 200 then
    raise exception 'A quantidade de mesas deve ser de 0 a 200' using errcode = 'P0001';
  end if;
  select * into cur from public.establishments where id = op.establishment_id for update;
  if (trim(p_name), coalesce(p_slogan, ''), p_logo_url, p_cover_url, p_brand_color)
     is distinct from (cur.name, cur.slogan, cur.logo_url, cur.cover_url, cur.brand_color)
     and not ('dono' = any (op.roles)) then
    raise exception 'Só o dono pode mudar o nome, a frase, a cor, a logomarca e a foto' using errcode = 'P0001';
  end if;
  update public.establishments
  set name = trim(p_name), slogan = coalesce(p_slogan, ''), logo_url = p_logo_url, cover_url = p_cover_url,
      brand_color = p_brand_color, payment_timing = p_payment_timing, phone = coalesce(p_phone, ''),
      address = coalesce(p_address, ''), pix_key = coalesce(p_pix_key, ''),
      kitchen_target_min = p_kitchen_target_min, table_count = p_table_count
  where id = op.establishment_id;
  if cur.kitchen_target_min is distinct from p_kitchen_target_min then
    changes := changes || format('tempo estimado: %s → %s min', cur.kitchen_target_min, p_kitchen_target_min);
  end if;
  if cur.table_count is distinct from p_table_count then
    changes := changes || format('mesas: %s → %s', cur.table_count, p_table_count);
  end if;
  if cur.brand_color is distinct from p_brand_color then
    changes := changes || format('cor: %s → %s', cur.brand_color, p_brand_color);
  end if;
  perform private.audit(op.establishment_id, op.id, 'estabelecimento.editar',
    'Dados do estabelecimento atualizados' ||
      case when cardinality(changes) > 0 then ' (' || array_to_string(changes, '; ') || ')' else '' end);
end
$$;

revoke all on function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int, int) from public, anon;
grant execute on function public.save_establishment(uuid, text, text, text, text, text, text, text, text, text, int, int) to authenticated;


-- >>>>>>>>>> 20261104000100_materiais_e_ficha_tecnica.sql
-- =============================================================================
-- RKFood: materiais e ficha técnica (área do dono)
--
--  * materials: o que a barraca compra (carne, frango, palito, carvão, refrigerante).
--    Unidade de compra: kg, l (litro) ou un (unidade). Custo opcional, em centavos
--    por kg, por litro ou por unidade.
--  * recipe_items: a ficha técnica de cada item do cardápio. Quanto de cada material
--    um item gasta, na unidade do material (ex.: 0,12 kg de frango, 1 un de palito).
--  * Com as vendas de um período e as fichas, o app calcula o consumo, o custo
--    estimado e a lista de compras (repor o que foi consumido). Só o dono edita.
-- =============================================================================

create table public.materials (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  unit             text not null check (unit in ('kg', 'l', 'un')),
  cost_cents       integer not null default 0 check (cost_cents >= 0),
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (establishment_id, id)
);
create index materials_establishment_idx on public.materials (establishment_id);

create table public.recipe_items (
  establishment_id uuid not null,
  product_id       uuid not null,
  material_id      uuid not null,
  qty              numeric(12, 4) not null check (qty > 0),
  primary key (product_id, material_id),
  foreign key (establishment_id, product_id) references public.products (establishment_id, id) on delete cascade,
  foreign key (establishment_id, material_id) references public.materials (establishment_id, id)
);
create index recipe_items_establishment_idx on public.recipe_items (establishment_id);
create index recipe_items_material_idx on public.recipe_items (establishment_id, material_id);

alter table public.materials enable row level security;
alter table public.recipe_items enable row level security;
create policy materials_select on public.materials for select to authenticated
  using (establishment_id in (select private.my_establishments()));
create policy recipe_items_select on public.recipe_items for select to authenticated
  using (establishment_id in (select private.my_establishments()));
revoke all on public.materials, public.recipe_items from anon, authenticated;
grant select on public.materials, public.recipe_items to authenticated;

-- 1,234 kg / 0,5 l / 3 un (para o histórico)
create function private.qty_label(p_qty numeric, p_unit text)
returns text
language sql immutable set search_path = ''
as $$
  select replace(trim(trailing '.' from trim(trailing '0' from p_qty::text)), '.', ',') || ' ' || p_unit
$$;

create function public.save_material(p_token uuid, p_id uuid, p_name text, p_unit text, p_cost_cents int)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'dono');
  m public.materials;
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Informe o nome do material' using errcode = 'P0001'; end if;
  if p_unit not in ('kg', 'l', 'un') then raise exception 'Unidade inválida' using errcode = 'P0001'; end if;
  if coalesce(p_cost_cents, 0) < 0 then raise exception 'Custo inválido' using errcode = 'P0001'; end if;
  if exists (select 1 from public.materials where establishment_id = op.establishment_id and deleted_at is null
             and id is distinct from p_id and lower(trim(name)) = lower(trim(p_name))) then
    raise exception 'Já existe um material com esse nome' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.materials (establishment_id, name, unit, cost_cents)
    values (op.establishment_id, trim(p_name), p_unit, coalesce(p_cost_cents, 0))
    returning * into m;
  else
    update public.materials set name = trim(p_name), unit = p_unit, cost_cents = coalesce(p_cost_cents, 0)
    where id = p_id and establishment_id = op.establishment_id
    returning * into m;
    if m.id is null then raise exception 'Material não encontrado' using errcode = 'P0001'; end if;
  end if;
  perform private.audit(op.establishment_id, op.id, case when p_id is null then 'material.criar' else 'material.editar' end,
    format('Material %s (%s, custo %s por %s)', m.name, m.unit, private.brl(m.cost_cents), m.unit));
  return m.id;
end
$$;

create function public.set_material_trashed(p_token uuid, p_id uuid, p_trashed boolean)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'dono');
  m public.materials;
  used text;
begin
  select * into m from public.materials where id = p_id and establishment_id = op.establishment_id for update;
  if m.id is null then raise exception 'Material não encontrado' using errcode = 'P0001'; end if;
  if p_trashed then
    select string_agg(p.name, ', ' order by p.name) into used
    from public.recipe_items r join public.products p on p.id = r.product_id
    where r.material_id = m.id and p.deleted_at is null;
    if used is not null then
      raise exception 'Esse material está na ficha técnica de: %. Tire de lá antes.', used using errcode = 'P0001';
    end if;
  end if;
  update public.materials set deleted_at = case when p_trashed then now() end where id = m.id;
  perform private.audit(op.establishment_id, op.id, case when p_trashed then 'material.excluir' else 'material.restaurar' end,
    format('Material "%s" %s', m.name, case when p_trashed then 'movido para a lixeira' else 'restaurado' end));
end
$$;

-- p_items: [{"material_id": "...", "qty": 0.12}] — substitui a ficha técnica inteira do item.
create function public.save_recipe(p_token uuid, p_product uuid, p_items jsonb)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'dono');
  pr public.products;
  it jsonb;
  m public.materials;
  q numeric;
  parts text[] := '{}';
begin
  select * into pr from public.products where id = p_product and establishment_id = op.establishment_id;
  if pr.id is null then raise exception 'Item do cardápio não encontrado' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' then raise exception 'Ficha técnica inválida' using errcode = 'P0001'; end if;
  delete from public.recipe_items where product_id = pr.id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    select * into m from public.materials
    where id = (it ->> 'material_id')::uuid and establishment_id = op.establishment_id and deleted_at is null;
    if m.id is null then raise exception 'Material não encontrado' using errcode = 'P0001'; end if;
    q := (it ->> 'qty')::numeric;
    if q is null or q <= 0 then raise exception 'Quantidade inválida para %', m.name using errcode = 'P0001'; end if;
    if exists (select 1 from public.recipe_items where product_id = pr.id and material_id = m.id) then
      raise exception '% aparece duas vezes na ficha', m.name using errcode = 'P0001';
    end if;
    insert into public.recipe_items (establishment_id, product_id, material_id, qty)
    values (op.establishment_id, pr.id, m.id, round(q, 4));
    parts := parts || (private.qty_label(round(q, 4), m.unit) || ' de ' || m.name);
  end loop;
  perform private.audit(op.establishment_id, op.id, 'ficha.editar',
    format('Ficha técnica de %s: %s', pr.name,
      case when cardinality(parts) = 0 then 'sem materiais' else array_to_string(parts, ' + ') end));
end
$$;

revoke all on function private.qty_label(numeric, text) from public, anon, authenticated;
revoke all on function
  public.save_material(uuid, uuid, text, text, int), public.set_material_trashed(uuid, uuid, boolean),
  public.save_recipe(uuid, uuid, jsonb)
from public, anon;
grant execute on function
  public.save_material(uuid, uuid, text, text, int), public.set_material_trashed(uuid, uuid, boolean),
  public.save_recipe(uuid, uuid, jsonb)
to authenticated;

-- tempo real: a ficha técnica aparece na hora nos outros aparelhos do dono
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.materials, public.recipe_items;
  end if;
end
$$;


-- >>>>>>>>>> 20261105000100_perfis_da_equipe.sql
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


-- >>>>>>>>>> 20261105000200_convite_e_aparelhos.sql
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


-- >>>>>>>>>> 20261106000100_cancelar_pela_cozinha.sql
-- =============================================================================
-- RKFood: cancelar pedido também pela cozinha (ou por qualquer perfil)
--
-- Antes só o perfil caixa podia pedir o cancelamento. Como quem autoriza de
-- verdade é o PIN de um gerente (ou dono), digitado na hora, qualquer operador
-- pode pedir: a cozinha cancela o pedido feito errado sem chamar o caixa.
-- Continua valendo: motivo obrigatório, pedido com pagamento não é cancelado,
-- e o histórico guarda quem pediu e quem autorizou.
-- =============================================================================

create or replace function public.cancel_order(p_token uuid, p_order uuid, p_reason text, p_auth_pin text)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token);
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


-- >>>>>>>>>> 20261106000200_pin_pelo_convite.sql
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


-- >>>>>>>>>> 20261107000100_comprado_pronto.sql
-- Item comprado pronto (refrigerante, limoneto, espeto que já vem montado): em vez de
-- cadastrar o material e depois montar a ficha, o dono toca em "Comprado pronto".
-- Cria (ou reaproveita) o material com o mesmo nome do item, em unidade, e a ficha
-- passa a ser "1 un" dele (troca a ficha detalhada, se havia). Dá para fazer item por
-- item (com o custo de um) ou a categoria inteira de uma vez. Tudo no histórico.

-- Faz a troca de um item e devolve o material usado. Material com o mesmo nome em kg ou
-- litro não é misturado: erro, para o dono montar a ficha.
create function private.apply_ready_made(p_establishment uuid, p_product public.products, p_cost_cents int)
returns public.materials
language plpgsql volatile security definer set search_path = ''
as $$
declare
  m public.materials;
begin
  select * into m from public.materials
  where establishment_id = p_establishment and deleted_at is null and lower(trim(name)) = lower(trim(p_product.name))
  for update;
  if m.id is not null and m.unit <> 'un' then
    raise exception 'Já existe o material % comprado por %. Use "Montar ficha".', m.name, m.unit using errcode = 'P0001';
  end if;
  if m.id is null then
    insert into public.materials (establishment_id, name, unit, cost_cents)
    values (p_establishment, trim(p_product.name), 'un', coalesce(p_cost_cents, 0))
    returning * into m;
  elsif p_cost_cents is not null then
    update public.materials set cost_cents = p_cost_cents where id = m.id returning * into m;
  end if;
  delete from public.recipe_items where product_id = p_product.id;
  insert into public.recipe_items (establishment_id, product_id, material_id, qty) values (p_establishment, p_product.id, m.id, 1);
  return m;
end
$$;

-- Um item. p_cost_cents null mantém o custo de um material que já existe.
create function public.save_ready_made(p_token uuid, p_product uuid, p_cost_cents int)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'dono');
  pr public.products;
  m public.materials;
begin
  select * into pr from public.products where id = p_product and establishment_id = op.establishment_id and deleted_at is null;
  if pr.id is null then raise exception 'Item do cardápio não encontrado' using errcode = 'P0001'; end if;
  if coalesce(p_cost_cents, 0) < 0 then raise exception 'Custo inválido' using errcode = 'P0001'; end if;
  m := private.apply_ready_made(op.establishment_id, pr, p_cost_cents);
  perform private.audit(op.establishment_id, op.id, 'ficha.editar',
    format('%s marcado como comprado pronto: 1 un de %s (custo %s)', pr.name, m.name,
      case when m.cost_cents > 0 then private.brl(m.cost_cents) else 'não informado' end));
end
$$;

-- A categoria inteira (os custos ficam como estão). Devolve os itens que ficaram de fora
-- (material com o mesmo nome em kg ou litro), para a tela avisar.
create function public.save_ready_made_category(p_token uuid, p_category uuid)
returns text[]
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'dono');
  cat public.categories;
  pr public.products;
  done text[] := '{}';
  skipped text[] := '{}';
begin
  select * into cat from public.categories where id = p_category and establishment_id = op.establishment_id and deleted_at is null;
  if cat.id is null then raise exception 'Categoria não encontrada' using errcode = 'P0001'; end if;
  for pr in select * from public.products where category_id = cat.id and deleted_at is null order by name loop
    begin
      perform private.apply_ready_made(op.establishment_id, pr, null);
      done := done || pr.name;
    exception when sqlstate 'P0001' then
      skipped := skipped || pr.name;
    end;
  end loop;
  if cardinality(done) = 0 and cardinality(skipped) = 0 then
    raise exception 'Essa categoria não tem itens' using errcode = 'P0001';
  end if;
  perform private.audit(op.establishment_id, op.id, 'ficha.editar',
    format('Categoria %s marcada como comprada pronta: %s%s', cat.name,
      case when cardinality(done) = 0 then 'nenhum item' else array_to_string(done, ', ') end,
      case when cardinality(skipped) = 0 then '' else ' (ficaram de fora: ' || array_to_string(skipped, ', ') || ')' end));
  return skipped;
end
$$;

revoke all on function private.apply_ready_made(uuid, public.products, int) from public, anon, authenticated;
revoke all on function public.save_ready_made(uuid, uuid, int), public.save_ready_made_category(uuid, uuid) from public, anon;
grant execute on function public.save_ready_made(uuid, uuid, int), public.save_ready_made_category(uuid, uuid) to authenticated;


-- >>>>>>>>>> 20261108000100_caixa_e_observacoes_rapidas.sql
-- Caixa com abertura e fechamento (troco inicial, contagem da gaveta e diferença) e
-- observações rápidas do pedido (os botões "Sem pimenta", "Bem passado"...).
--
--  * cash_sessions: uma linha por turno de caixa. Só pode haver UM caixa aberto por
--    estabelecimento. Quem abre e quem fecha ficam registrados, e tudo vai para o histórico.
--  * Esperado na gaveta = troco inicial + dinheiro recebido desde a abertura
--    (pagamentos em dinheiro de pedidos + recebimentos de fiado em dinheiro).
--  * establishments.quick_notes: lista de textos curtos que o gerente escolhe.

create table public.cash_sessions (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  business_date    date not null,
  opened_at        timestamptz not null default now(),
  opened_by        uuid not null,
  opening_cents    integer not null check (opening_cents >= 0),
  closed_at        timestamptz,
  closed_by        uuid,
  expected_cents   integer check (expected_cents is null or expected_cents >= 0),
  counted_cents    integer check (counted_cents is null or counted_cents >= 0),
  difference_cents integer,
  note             text not null default '',
  unique (establishment_id, id),
  foreign key (establishment_id, opened_by) references public.staff (establishment_id, id),
  foreign key (establishment_id, closed_by) references public.staff (establishment_id, id),
  check ((closed_at is null) = (counted_cents is null))
);
create unique index cash_sessions_one_open_idx on public.cash_sessions (establishment_id) where closed_at is null;
create index cash_sessions_date_idx on public.cash_sessions (establishment_id, business_date);
create index cash_sessions_opened_by_idx on public.cash_sessions (establishment_id, opened_by);
create index cash_sessions_closed_by_idx on public.cash_sessions (establishment_id, closed_by) where closed_by is not null;

alter table public.cash_sessions enable row level security;
create policy cash_sessions_select on public.cash_sessions for select to authenticated
  using (establishment_id in (select private.my_establishments()));
revoke all on public.cash_sessions from anon, authenticated;
grant select on public.cash_sessions to authenticated;

alter table public.establishments
  add column quick_notes text[] not null default '{}'
  check (cardinality(quick_notes) <= 20);

-- Abre o caixa com o troco que está na gaveta (pode ser zero).
create function public.open_cash(p_token uuid, p_opening_cents int)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'caixa');
  sid uuid;
begin
  if p_opening_cents is null or p_opening_cents < 0 then
    raise exception 'Informe o troco da gaveta' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.cash_sessions where establishment_id = op.establishment_id and closed_at is null) then
    raise exception 'O caixa já está aberto' using errcode = 'P0001';
  end if;
  insert into public.cash_sessions (establishment_id, business_date, opened_by, opening_cents)
  values (op.establishment_id, private.business_date(op.establishment_id), op.id, p_opening_cents)
  returning id into sid;
  perform private.audit(op.establishment_id, op.id, 'caixa.abrir', format('Caixa aberto com troco de %s', private.brl(p_opening_cents)));
  return sid;
end
$$;

-- Fecha o caixa: confere o dinheiro contado com o esperado e guarda a diferença
-- (negativa = faltou dinheiro). Devolve a diferença em centavos.
create function public.close_cash(p_token uuid, p_counted_cents int, p_note text default '')
returns int
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'caixa');
  cs public.cash_sessions;
  cash_in int;
  expected int;
  diff int;
begin
  if p_counted_cents is null or p_counted_cents < 0 then
    raise exception 'Informe o dinheiro contado na gaveta' using errcode = 'P0001';
  end if;
  select * into cs from public.cash_sessions
  where establishment_id = op.establishment_id and closed_at is null for update;
  if cs.id is null then raise exception 'O caixa não está aberto' using errcode = 'P0001'; end if;

  select coalesce(sum(amount_cents), 0) into cash_in from public.payments
  where establishment_id = op.establishment_id and method = 'dinheiro' and created_at >= cs.opened_at;
  select cash_in + coalesce(sum(amount_cents), 0) into cash_in from public.fiado_settlements
  where establishment_id = op.establishment_id and method = 'dinheiro' and created_at >= cs.opened_at;

  expected := cs.opening_cents + cash_in;
  diff := p_counted_cents - expected;
  update public.cash_sessions
  set closed_at = now(), closed_by = op.id, expected_cents = expected, counted_cents = p_counted_cents,
      difference_cents = diff, note = coalesce(trim(p_note), '')
  where id = cs.id;
  perform private.audit(op.establishment_id, op.id, 'caixa.fechar',
    format('Caixa fechado: esperado %s, contado %s, diferença %s%s', private.brl(expected), private.brl(p_counted_cents),
      case when diff < 0 then '− ' else '' end || private.brl(abs(diff)),
      case when coalesce(trim(p_note), '') = '' then '' else ' (' || trim(p_note) || ')' end));
  return diff;
end
$$;

-- Observações rápidas do pedido (gerente). Máximo de 20, cada uma com até 30 letras.
create function public.save_quick_notes(p_token uuid, p_notes text[])
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  op public.staff := private.operator(p_token, 'gerente');
  clean text[];
begin
  select coalesce(array_agg(n order by ord), '{}') into clean from (
    select distinct on (lower(trim(x))) trim(x) as n, ord
    from unnest(coalesce(p_notes, '{}')) with ordinality as t(x, ord)
    where trim(x) <> ''
    order by lower(trim(x)), ord
  ) q;
  if cardinality(clean) > 20 then raise exception 'No máximo 20 observações rápidas' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(clean) c where length(c) > 30 or position(',' in c) > 0) then
    raise exception 'Cada observação deve ter até 30 letras e não pode ter vírgula' using errcode = 'P0001';
  end if;
  update public.establishments set quick_notes = clean where id = op.establishment_id;
  perform private.audit(op.establishment_id, op.id, 'estabelecimento.editar',
    format('Observações rápidas: %s', case when cardinality(clean) = 0 then 'padrão' else array_to_string(clean, ', ') end));
end
$$;

revoke all on function public.open_cash(uuid, int), public.close_cash(uuid, int, text), public.save_quick_notes(uuid, text[]) from public, anon;
grant execute on function public.open_cash(uuid, int), public.close_cash(uuid, int, text), public.save_quick_notes(uuid, text[]) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.cash_sessions;
  end if;
end
$$;
