from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)


def hist(n, f=lambda i: 6):
    s = date(2026, 1, 1)
    return [{"date": str(s + timedelta(days=i)), "quantity": f(i)} for i in range(n)]


def test_health_claims_no_trained_models():
    assert c.get("/health").json()["trained_models"] == []


def test_forecast_constant_demand():
    r = c.post("/ml/forecast", json={"product_id": "p", "history": hist(40), "horizon_days": 7}).json()
    assert abs(r["total_forecast"] - 42) < 1e-6 and r["validation"] and r["fallback_reason"] is None


def test_forecast_picks_seasonal_with_weekly_pattern():
    r = c.post("/ml/forecast", json={"product_id": "p", "history": hist(84, lambda i: 20 if i % 7 in (5, 6) else 2),
                                     "horizon_days": 7}).json()
    assert r["method"] == "dow_seasonal" and len({round(x, 1) for x in r["daily_forecast"]}) > 1


def test_forecast_short_history_fallback_and_empty():
    r = c.post("/ml/forecast", json={"product_id": "p", "history": hist(3), "horizon_days": 5}).json()
    assert r["method"] == "mean_fallback" and r["fallback_reason"]
    r = c.post("/ml/forecast", json={"product_id": "p", "history": [], "horizon_days": 5}).json()
    assert r["method"] == "no_data" and r["total_forecast"] == 0


def test_forecast_rejects_negative_quantity():
    assert c.post("/ml/forecast", json={"product_id": "p", "history": [{"date": "2026-01-01", "quantity": -1}]}).status_code == 422


def test_stockout_risk():
    r = c.post("/ml/stockout", json={"product_id": "p", "available_stock": 20, "daily_demand": 6.43, "lead_time_days": 2}).json()
    assert abs(r["days_remaining"] - 3.11) < 0.01 and not r["stockout_before_replenishment"]
    r = c.post("/ml/stockout", json={"product_id": "p", "available_stock": 5, "daily_demand": 5, "lead_time_days": 3}).json()
    assert r["stockout_before_replenishment"] and r["risk_level"] in ("high", "critical")
    r = c.post("/ml/stockout", json={"product_id": "p", "available_stock": 5, "daily_demand": 0, "lead_time_days": 3}).json()
    assert r["days_remaining"] is None and r["risk_level"] == "low"


def test_reorder_is_computed_and_advisory():
    base = {"product_id": "p", "available_stock": 20, "daily_demand": 45 / 7, "lead_time_days": 2, "review_period_days": 5}
    a = c.post("/ml/reorder", json=base).json()
    b = c.post("/ml/reorder", json={**base, "available_stock": 60}).json()
    assert a["recommended_quantity"] == 25 and b["recommended_quantity"] == 0 and a["advisory_only"]
    s = c.post("/ml/reorder", json={**base, "daily_demand_std": 3}).json()
    assert s["safety_stock"] > 0 and s["recommended_quantity"] > 25
    assert c.post("/ml/reorder", json={**base, "min_order_quantity": 50}).json()["recommended_quantity"] == 50


def test_incoming_stock_reduces_order():
    base = {"product_id": "p", "available_stock": 20, "daily_demand": 5, "lead_time_days": 2, "review_period_days": 5}
    assert c.post("/ml/reorder", json={**base, "incoming_quantity": 10}).json()["recommended_quantity"] == \
        c.post("/ml/reorder", json=base).json()["recommended_quantity"] - 10


def offers():
    return [
        {"offer_id": "a", "supplier_id": "s1", "unit_price": 10, "available_quantity": 100, "lead_time_days": 5, "reliability": .9},
        {"offer_id": "b", "supplier_id": "s2", "unit_price": 12, "available_quantity": 100, "lead_time_days": 1, "reliability": .95},
        {"offer_id": "c", "supplier_id": "s3", "unit_price": 8, "available_quantity": 0, "lead_time_days": 1, "reliability": .99},
        {"offer_id": "d", "supplier_id": "s4", "unit_price": 9, "available_quantity": 100, "lead_time_days": 2, "reliability": .8, "is_verified": False},
    ]


def test_supplier_rank_excludes_and_explains():
    r = c.post("/ml/supplier-rank", json={"required_quantity": 50, "offers": offers()}).json()
    assert {e["offer_id"] for e in r["excluded"]} == {"c", "d"}
    assert abs(sum(r["effective_weights"].values()) - 1) < 1e-3 and "Distance ignored" in " ".join(r["notes"])


def test_supplier_rank_weights_change_outcome():
    z = {"price": 0, "availability": 0, "delivery": 0, "reliability": 0, "distance": 0}
    cheap = c.post("/ml/supplier-rank", json={"required_quantity": 50, "offers": offers(), "weights": {**z, "price": 1}}).json()
    fast = c.post("/ml/supplier-rank", json={"required_quantity": 50, "offers": offers(), "weights": {**z, "delivery": 1}}).json()
    assert cheap["ranked"][0]["offer_id"] == "a" and fast["ranked"][0]["offer_id"] == "b"


def test_supplier_rank_all_zero_weights_rejected():
    z = {"price": 0, "availability": 0, "delivery": 0, "reliability": 0, "distance": 0}
    assert c.post("/ml/supplier-rank", json={"required_quantity": 5, "offers": offers(), "weights": z}).status_code == 422
