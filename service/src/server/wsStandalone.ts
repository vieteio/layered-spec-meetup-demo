import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { handleWebSocketConnection } from "@/server/realtime/documentUpdatesHub";

const hostname = process.env.WS_HOSTNAME ?? "localhost";
const port = Number(process.env.WS_PORT ?? "3001");

const server = createServer();
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    void handleWebSocketConnection(ws, request);
  });
});

server.listen(port, hostname, () => {
  console.log(`> WebSocket ready on ws://${hostname}:${port}`);
});
