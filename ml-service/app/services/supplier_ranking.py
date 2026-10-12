"""Configurable multi-factor supplier ranking with min-max normalization."""
FACTORS = ("price", "availability", "delivery", "reliability", "distance")


def _norm(values, higher_is_better):
    lo, hi = min(values), max(values)
    if hi == lo:
        return [1.0] * len(values)  # factor does not differentiate between offers
    s = [(v - lo) / (hi - lo) for v in values]
    return s if higher_is_better else [1 - x for x in s]


def rank(req) -> dict:
    notes, excluded, eligible = [], [], []
    for o in req.offers:
        if not o.is_active:
            excluded.append(dict(offer_id=o.offer_id, reason="Listing inactive"))
        elif req.require_verified and not o.is_verified:
            excluded.append(dict(offer_id=o.offer_id, reason="Supplier not verified"))
        elif o.available_quantity <= 0:
            excluded.append(dict(offer_id=o.offer_id, reason="Out of stock"))
        else:
            eligible.append(o)
    if not eligible:
        return dict(ranked=[], excluded=excluded, effective_weights={}, notes=["No eligible offers."])

    w = req.weights.model_dump()
    if any(o.reliability is None for o in eligible):
        w["reliability"] = 0.0
        notes.append("Reliability ignored: insufficient history for at least one offer.")
    if any(o.distance_km is None for o in eligible):
        w["distance"] = 0.0
        notes.append("Distance ignored: location data unavailable for at least one offer.")
    total = sum(w.values())
    if total <= 0:
        raise ValueError("All weighted factors are unavailable; adjust weights.")
    w = {k: v / total for k, v in w.items()}

    cols = {
        "price": _norm([o.unit_price for o in eligible], False),
        "availability": _norm([min(o.available_quantity / req.required_quantity, 1.0) for o in eligible], True),
        "delivery": _norm([o.lead_time_days for o in eligible], False),
        "reliability": _norm([o.reliability or 0 for o in eligible], True),
        "distance": _norm([o.distance_km or 0 for o in eligible], False),
    }
    out = []
    for i, o in enumerate(eligible):
        fs = {f: round(cols[f][i], 4) for f in FACTORS}
        contrib = {f: round(fs[f] * w[f], 4) for f in FACTORS}
        score = round(sum(contrib.values()), 4)
        if o.available_quantity < req.required_quantity:
            notes.append(f"Offer {o.offer_id} covers only {o.available_quantity:g} of {req.required_quantity:g} units.")
        top = max((f for f in FACTORS if w[f] > 0), key=lambda f: contrib[f])
        out.append(dict(offer_id=o.offer_id, supplier_id=o.supplier_id, score=score, factor_scores=fs,
                        contributions=contrib, explanation=f"Score {score:.2f}; strongest weighted factor: {top}."))
    out.sort(key=lambda r: -r["score"])
    for n, r in enumerate(out, 1):
        r["rank"] = n
    return dict(ranked=out, excluded=excluded, effective_weights={k: round(v, 4) for k, v in w.items()}, notes=notes)
