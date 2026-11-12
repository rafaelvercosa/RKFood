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
