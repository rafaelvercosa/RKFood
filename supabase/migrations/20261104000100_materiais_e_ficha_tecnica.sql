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
