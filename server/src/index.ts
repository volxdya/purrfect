import { buildApp } from './app.js';
import { config } from './config.js';

const { app } = await buildApp({ ...config, logger: true });
await app.listen({ port: config.port, host: config.host });
