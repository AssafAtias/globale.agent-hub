import { loadConfig } from './config/environment.js';
import { buildApp } from './app.js';

const config = loadConfig();
const app = buildApp(config);

app.listen({ port: Number(config.PORT), host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});
