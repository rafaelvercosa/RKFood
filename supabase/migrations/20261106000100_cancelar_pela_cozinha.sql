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
