-- Item comprado pronto (refrigerante, limoneto, água): em vez de cadastrar o material e
-- depois montar a ficha, o dono toca em "Comprado pronto" e informa o custo de um.
-- Cria (ou reaproveita) o material com o mesmo nome do item, em unidade, e a ficha
-- passa a ser "1 un" dele. Tudo numa transação só e no histórico.

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
  select * into m from public.materials
  where establishment_id = op.establishment_id and deleted_at is null and lower(trim(name)) = lower(trim(pr.name))
  for update;
  if m.id is not null and m.unit <> 'un' then
    raise exception 'Já existe o material % comprado por %. Use "Montar ficha".', m.name, m.unit using errcode = 'P0001';
  end if;
  if m.id is null then
    insert into public.materials (establishment_id, name, unit, cost_cents)
    values (op.establishment_id, trim(pr.name), 'un', coalesce(p_cost_cents, 0))
    returning * into m;
  elsif p_cost_cents is not null then
    update public.materials set cost_cents = p_cost_cents where id = m.id returning * into m;
  end if;
  delete from public.recipe_items where product_id = pr.id;
  insert into public.recipe_items (establishment_id, product_id, material_id, qty) values (op.establishment_id, pr.id, m.id, 1);
  perform private.audit(op.establishment_id, op.id, 'ficha.editar',
    format('%s marcado como comprado pronto: 1 un de %s (custo %s)', pr.name, m.name,
      case when m.cost_cents > 0 then private.brl(m.cost_cents) else 'não informado' end));
end
$$;

revoke all on function public.save_ready_made(uuid, uuid, int) from public, anon;
grant execute on function public.save_ready_made(uuid, uuid, int) to authenticated;
