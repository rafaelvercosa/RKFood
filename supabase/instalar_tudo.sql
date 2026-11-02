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
