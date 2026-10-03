import app from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";

async function start() {
  await connectDB();
  app.listen(env.port, () => {
    console.log(`Server is running on port ${env.port}`);
  });
}

start();

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
})