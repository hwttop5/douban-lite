import { createApp } from "./server";

const context = createApp();
context.sync.start();

context.app.listen(context.config.port, () => {
  console.log(`douban-lite api listening on http://localhost:${context.config.port}`);
});
