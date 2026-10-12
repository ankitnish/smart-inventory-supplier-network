import http from "http";
import { Server } from "socket.io";
import { env } from "./config/env";
import { createApp } from "./app";

const server = http.createServer(createApp());
// Realtime auth + per-user rooms are added in Phase 5 (events documented in /realtime/events).
new Server(server, { cors: { origin: env.CORS_ORIGIN.split(","), credentials: true } });
server.listen(env.PORT, () => console.log(JSON.stringify({ level: "info", msg: `API listening on :${env.PORT}` })));
