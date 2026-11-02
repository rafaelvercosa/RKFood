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
