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
