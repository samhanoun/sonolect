import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";

const serviceName = "sonolect-sync-service";
const app = Fastify({ logger: true });

await app.register(helmet);
await app.register(cors, { origin: false });

app.get("/health", async () => ({ status: "ok", service: serviceName }));

const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: "0.0.0.0", port });
