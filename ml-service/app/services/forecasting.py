"""Baseline demand forecasting (statistical baselines; no trained artifact is claimed).

Methods:
  - moving_average:          mean of the last `window` days
  - weighted_moving_average: linearly increasing weights over the last `window` days
  - dow_seasonal:            28-day level x day-of-week index (needs >= 28 days)
Selection: rolling-origin one-step-ahead backtest on the last <=28 days, scored by MAE and RMSE.
"""
from __future__ import annotations
from datetime import datetime, timezone
import numpy as np
import pandas as pd

METHOD_VERSION = "baseline-1.0"
MIN_HISTORY_DAYS = 7
MIN_BACKTEST_POINTS = 5


def to_daily_series(history: list[tuple]) -> pd.Series:
    """Aggregate (date, qty) to a continuous daily series; missing days count as zero sales."""
    if not history:
        return pd.Series(dtype=float)
    df = pd.DataFrame(history, columns=["date", "qty"])
    df["date"] = pd.to_datetime(df["date"])
    s = df.groupby("date")["qty"].sum().sort_index()
    full = pd.date_range(s.index.min(), s.index.max(), freq="D")
    return s.reindex(full, fill_value=0.0).astype(float)


def _dow_index(series: pd.Series) -> dict[int, float]:
    overall = series.mean()
    if overall <= 0:
        return {d: 1.0 for d in range(7)}
    by_dow = series.groupby(series.index.dayofweek).mean()
    return {d: float(by_dow.get(d, overall) / overall) for d in range(7)}


def _predict_day(method: str, series: pd.Series, target: pd.Timestamp, window: int) -> float:
    vals = series.to_numpy()
    if method == "moving_average":
        return float(vals[-window:].mean())
    if method == "weighted_moving_average":
        tail = vals[-window:]
        return float(np.average(tail, weights=np.arange(1, len(tail) + 1, dtype=float)))
    if method == "dow_seasonal":
        return max(0.0, float(vals[-28:].mean()) * _dow_index(series)[target.dayofweek])
    raise ValueError(method)


def backtest(series: pd.Series, method: str, window: int):
    n = len(series)
    errs = [series.iloc[i] - _predict_day(method, series.iloc[:i], series.index[i], window)
            for i in range(max(MIN_HISTORY_DAYS, n - 28), n)]
    if len(errs) < MIN_BACKTEST_POINTS:
        return None, None
    e = np.array(errs)
    return float(np.abs(e).mean()), float(np.sqrt((e ** 2).mean()))


def forecast(product_id: str, history: list[tuple], horizon_days: int) -> dict:
    series = to_daily_series(history)
    n, now = len(series), datetime.now(timezone.utc)
    base = dict(product_id=product_id, method_version=METHOD_VERSION, horizon_days=horizon_days,
                history_days=n, generated_at=now)
    if n == 0:
        return {**base, "method": "no_data", "daily_forecast": [0.0] * horizon_days, "total_forecast": 0.0,
                "daily_std": 0.0, "validation": [],
                "fallback_reason": "No sales history; forecast defaults to zero demand."}
    window = min(14, n)
    if n < MIN_HISTORY_DAYS:
        level = float(series.mean())
        return {**base, "method": "mean_fallback", "daily_forecast": [round(level, 4)] * horizon_days,
                "total_forecast": round(level * horizon_days, 4), "daily_std": float(series.std(ddof=0)),
                "validation": [],
                "fallback_reason": f"Only {n} days of history (< {MIN_HISTORY_DAYS}); simple mean used, no validation possible."}

    methods = ["moving_average", "weighted_moving_average"] + (["dow_seasonal"] if n >= 28 else [])
    scores = [dict(method=m, **dict(zip(("mae", "rmse"), backtest(series, m, window)))) for m in methods]
    scored = [s for s in scores if s["rmse"] is not None]
    if scored:
        best, reason = min(scored, key=lambda s: (s["rmse"], s["mae"]))["method"], None
    else:
        best, reason = "weighted_moving_average", "History too short to backtest; defaulted to weighted moving average."
    preds = [round(max(0.0, _predict_day(best, series, series.index[-1] + pd.Timedelta(days=k), window)), 4)
             for k in range(1, horizon_days + 1)]
    return {**base, "method": best, "daily_forecast": preds, "total_forecast": round(sum(preds), 4),
            "daily_std": float(series.iloc[-28:].std(ddof=0)), "validation": scores, "fallback_reason": reason}
