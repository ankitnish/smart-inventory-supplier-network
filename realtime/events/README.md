# Socket.IO event contracts (Phase 5)
Rooms: `user:<id>`, `shop:<shopId>`, `supplier:<supplierId>`; join only after server-side auth.
Events: inventory:updated, inventory:low-stock, inventory:stockout-risk, purchase-order:created,
purchase-order:status-updated, delivery:status-updated, notification:created.
Fallback: client polls `/api/notifications` when the socket is disconnected.
