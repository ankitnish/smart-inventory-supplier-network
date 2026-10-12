from fastapi import FastAPI, HTTPException
from .schemas import *
from .services import forecasting, inventory_planning, supplier_ranking

app = FastAPI(title="Smart Inventory ML Service", version="0.1.0",
              description="Baseline statistical forecasting and decision support. Advisory only: never places orders or mutates stock.")


@app.get("/health")
def health():
    return {"status": "ok", "service": "ml-service", "method_version": forecasting.METHOD_VERSION,
            "trained_models": []}  # honest: only statistical baselines, no trained artifacts


@app.post("/ml/forecast", response_model=ForecastResponse)
def ml_forecast(req: ForecastRequest):
    return forecasting.forecast(req.product_id, [(p.date, p.quantity) for p in req.history], req.horizon_days)


@app.post("/ml/stockout", response_model=StockoutResponse)
def ml_stockout(req: StockoutRequest):
    return inventory_planning.stockout(req)


@app.post("/ml/reorder", response_model=ReorderResponse)
def ml_reorder(req: ReorderRequest):
    return inventory_planning.reorder(req)


@app.post("/ml/supplier-rank", response_model=SupplierRankResponse)
def ml_supplier_rank(req: SupplierRankRequest):
    try:
        return supplier_ranking.rank(req)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
