import math


def _risk(days_remaining, lead_time_days, stockout_before):
    if days_remaining is None:
        return "low"
    if days_remaining <= 0:
        return "critical"
    if stockout_before and days_remaining < lead_time_days * 0.5:
        return "critical"
    if stockout_before:
        return "high"
    if days_remaining < lead_time_days * 1.5:
        return "medium"
    return "low"


def stockout(req) -> dict:
    d = req.daily_demand
    days = None if d == 0 else req.available_stock / d
    counted = 0.0
    # Incoming stock only counts if it arrives before projected depletion.
    if req.incoming_quantity and req.incoming_eta_days is not None and d > 0 and req.incoming_eta_days <= days:
        counted = req.incoming_quantity
        days = (req.available_stock + counted) / d
    before = days is not None and days < req.lead_time_days
    assumptions = dict(daily_demand=d, available_stock=req.available_stock, lead_time_days=req.lead_time_days,
                       incoming_counted=counted, constant_demand_assumed=True)
    if days is None:
        expl = "No demand expected, so stock is not projected to deplete."
    else:
        expl = (f"At {d:g} units/day, {req.available_stock:g} units (+{counted:g} incoming) last ~{days:.1f} days "
                f"vs. a {req.lead_time_days:g}-day lead time. "
                + ("Stock is projected to run out before a new order could arrive." if before
                   else "Stock is projected to last beyond the lead time."))
    return dict(product_id=req.product_id, days_remaining=None if days is None else round(days, 2),
                stockout_before_replenishment=before, risk_level=_risk(days, req.lead_time_days, before),
                assumptions=assumptions, explanation=expl)


def reorder(req) -> dict:
    horizon = req.lead_time_days + req.review_period_days
    demand = req.daily_demand * horizon
    safety = req.service_level_z * req.daily_demand_std * math.sqrt(horizon)  # variability cover
    need = demand + safety - req.available_stock - req.incoming_quantity
    qty = max(0, math.ceil(need - 1e-9))
    if qty > 0:
        qty = max(qty, math.ceil(req.min_order_quantity))
        if req.max_order_quantity is not None:
            qty = min(qty, math.floor(req.max_order_quantity))
    cover = None if req.daily_demand == 0 else (req.available_stock + req.incoming_quantity) / req.daily_demand
    order_in = 0.0 if cover is None else max(0.0, cover - req.lead_time_days)
    before = cover is not None and cover < req.lead_time_days
    assumptions = dict(horizon_days=horizon, daily_demand=req.daily_demand, daily_demand_std=req.daily_demand_std,
                       service_level_z=req.service_level_z, available_stock=req.available_stock,
                       incoming_quantity=req.incoming_quantity, min_order_quantity=req.min_order_quantity,
                       max_order_quantity=req.max_order_quantity)
    expl = (f"Demand over lead time + review period ({horizon:g} days) is ~{demand:.1f} units; safety stock "
            f"{safety:.1f}; on hand {req.available_stock:g} + incoming {req.incoming_quantity:g}. "
            + (f"Recommended order: {qty} units." if qty else "Current stock covers the horizon; no order needed."))
    return dict(product_id=req.product_id, recommended_quantity=qty, suggested_order_in_days=round(order_in, 2),
                risk_level=_risk(cover, req.lead_time_days, before), safety_stock=round(safety, 2),
                demand_over_horizon=round(demand, 2), assumptions=assumptions, explanation=expl, advisory_only=True)
