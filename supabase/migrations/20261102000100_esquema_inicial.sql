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
