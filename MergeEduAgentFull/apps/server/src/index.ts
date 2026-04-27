import { appConfig } from "./config.js";
import { createApp } from "./app.js";
import { createServerDeps } from "./bootstrap.js";

async function bootstrap() {
  const deps = await createServerDeps();
  const app = createApp(deps);

  app.listen(appConfig.port, () => {
    console.log(`[server] listening on http://localhost:${appConfig.port}`);
  });
}

bootstrap().catch((error) => {
  console.error("[server] failed to start", error);
  process.exit(1);
});
