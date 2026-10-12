from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, Field, model_validator


class SalesPoint(BaseModel):
    date: date
    quantity: float = Field(ge=0)


class ForecastRequest(BaseModel):
    product_id: str
    history: list[SalesPoint]
    horizon_days: int = Field(default=7, ge=1, le=90)


class ModelScore(BaseModel):
    method: str
    mae: Optional[float] = None
    rmse: Optional[float] = None


class ForecastResponse(BaseModel):
    product_id: str
    method: str
    method_version: str
    horizon_days: int
    daily_forecast: list[float]
    total_forecast: float
    daily_std: float
    history_days: int
    validation: list[ModelScore]
    fallback_reason: Optional[str] = None
    generated_at: datetime


class StockoutRequest(BaseModel):
    product_id: str
    available_stock: float = Field(ge=0)
    daily_demand: float = Field(ge=0, description="Forecast or estimated mean daily demand")
    lead_time_days: float = Field(ge=0)
    incoming_quantity: float = Field(default=0, ge=0)
    incoming_eta_days: Optional[float] = Field(default=None, ge=0)


class StockoutResponse(BaseModel):
    product_id: str
    days_remaining: Optional[float]  # None = no demand, stock never depletes
    stockout_before_replenishment: bool
    risk_level: str
    assumptions: dict
    explanation: str


class ReorderRequest(BaseModel):
    product_id: str
    available_stock: float = Field(ge=0)
    daily_demand: float = Field(ge=0)
    daily_demand_std: float = Field(default=0, ge=0)
    lead_time_days: float = Field(ge=0)
    review_period_days: float = Field(default=7, gt=0)
    service_level_z: float = Field(default=1.65, ge=0, le=3.5, description="1.65 ~ 95% service level")
    incoming_quantity: float = Field(default=0, ge=0)
    min_order_quantity: float = Field(default=0, ge=0)
    max_order_quantity: Optional[float] = Field(default=None, ge=0)


class ReorderResponse(BaseModel):
    product_id: str
    recommended_quantity: int
    suggested_order_in_days: float
    risk_level: str
    safety_stock: float
    demand_over_horizon: float
    assumptions: dict
    explanation: str
    advisory_only: bool = True  # recommendations never place orders or change stock


class SupplierOffer(BaseModel):
    offer_id: str
    supplier_id: str
    unit_price: float = Field(gt=0)
    available_quantity: float = Field(ge=0)
    lead_time_days: float = Field(ge=0)
    reliability: Optional[float] = Field(default=None, ge=0, le=1, description="None = insufficient history")
    distance_km: Optional[float] = Field(default=None, ge=0)
    is_active: bool = True
    is_verified: bool = True


class SupplierWeights(BaseModel):
    price: float = Field(default=0.35, ge=0)
    availability: float = Field(default=0.15, ge=0)
    delivery: float = Field(default=0.25, ge=0)
    reliability: float = Field(default=0.20, ge=0)
    distance: float = Field(default=0.05, ge=0)

    @model_validator(mode="after")
    def _non_zero(self):
        if sum(self.model_dump().values()) <= 0:
            raise ValueError("At least one weight must be positive")
        return self


class SupplierRankRequest(BaseModel):
    required_quantity: float = Field(gt=0)
    offers: list[SupplierOffer]
    weights: SupplierWeights = SupplierWeights()
    require_verified: bool = True


class RankedOffer(BaseModel):
    offer_id: str
    supplier_id: str
    score: float
    rank: int
    factor_scores: dict[str, float]
    contributions: dict[str, float]
    explanation: str


class ExcludedOffer(BaseModel):
    offer_id: str
    reason: str


class SupplierRankResponse(BaseModel):
    ranked: list[RankedOffer]
    excluded: list[ExcludedOffer]
    effective_weights: dict[str, float]
    notes: list[str]
