import { Hono } from "hono";
import { cors } from "hono/cors";
import * as dotenv from "dotenv"
import cron from 'node-cron'
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { errorHandler, notFound } from "./middleware";
import { connectMongoDB } from './config/dbConnect';


import { Users, Admin, Investment, Referral, Dashboard, Transaction, Wallet } from './routes'
import assetsRoutes from "./routes/assets";
import Watcher from "./services/watcher";
import Sender from "./services/sender";
import { Address } from "viem";
import { scheduler } from "timers/promises";
import Balance from "./services/balance";

const app = new Hono().basePath("/api");

app.use("*", logger(), prettyJSON());

const db_url = process.env.DB_URL
connectMongoDB(db_url as string, 'bitbot-backend')

// Allow CORS globally
app.use(
  cors({
    origin: "*", // Allow all origins
    allowMethods: ["GET", "POST", "PUT", "DELETE"], // Allow specific HTTP methods
    allowHeaders: ["Content-Type", "Authorization", "token"], // Allow specific headers
    credentials: true,
  })
);


// ✅ Serve static files from the "uploads" directory using Bun's built-in file serving
app.use("/uploads/*", async (c) => {
  const filePath = `./uploads/${c.req.param("*")}`; // Get the file path from URL
  return new Response(Bun.file(filePath)); // Serve the file
});

/// Health Check
app.get("/", (c) => {
  return c.json({
    code: 400,
    message: "healthy"
  });
});

/// Routes part start

app.route('/v1/user', Users);
app.route('/v1/admin', Admin);
app.route('/v1/investment', Investment);
app.route('/v1/referral', Referral);
app.route('/v1/dashboard', Dashboard);
app.route('/v1/assets', assetsRoutes);
app.route('v1/transaction', Transaction)
app.route('v1/wallet', Wallet)




/// Routes Part end

app.onError((_err, c) => {
  const error = errorHandler(c)
  return error
})

app.notFound((c) => {
  const error = notFound(c)
  return error
})

const port = Bun.env.PORT || 8000


if (process.env.ROLE === 'Watcher') {
  /// Watcher
  try {
    /// cron job for network one run every 20 second
    cron.schedule("*/30 * * * * *", async () => {
      const depositWatcherOne = new Watcher(
        "bsc"
      )
      await depositWatcherOne.evmWorker("EVM-BSC-Watcher-1")
    })

    /// cron job for network one run every 50 second
    cron.schedule("*/45 * * * * *", async () => {
      const depositWatcherOne = new Watcher(
        "polygon"
      )
      await depositWatcherOne.evmWorker("EVM-Ploygon-Watcher-1")
    })

    /// will remove after testing
    /// cron job for network one run every 20 second
    cron.schedule("*/20 * * * * *", async () => {
      const depositWatcherOne = new Watcher(
        "amoy"
      )
      await depositWatcherOne.evmWorker("EVM-Ploygon-Testnet-Watcher-1")
    })
  } catch (error) {
    console.log(error);
  }
}
if (process.env.ROLE === 'Sender') {

  /// Sender
  try {
    /// cron job for network one run every 40 second
    cron.schedule("*/40 * * * * *", async () => {
      const withdrawSenderOne = new Sender(
        "bsc",
      )
      await withdrawSenderOne.evmWorker("EVM-BSC-Sender-1")
    })

    /// cron job for network one run every 60 second
    cron.schedule("*/60 * * * * *", async () => {
      const withdrawSenderOne = new Sender(
        "polygon"
      )
      await withdrawSenderOne.evmWorker("EVM-Polygon-Sender-1")
    })

    /// will remove after testing
    /// cron job for network one run every 40 second
    // cron.schedule("*/30 * * * * *", async () => {
    //   const withdrawSenderOne = new Sender(
    //     "amoy"
    //   )
    //   await withdrawSenderOne.evmWorker("EVM-Polygon-Testnet-Sender-1")
    // })

    /// Balance

    /// cron job for network one run every 5 mins
    cron.schedule("*/6 * * * *", async () => {
      const depositWatcherOne = new Balance(
        "bsc",
      )
      await depositWatcherOne.evmWorker("EVM-BSC-Balance-1")
    })

    /// cron job for network one run every 7 mins
    cron.schedule("*/8 * * * *", async () => {
      const depositWatcherOne = new Balance(
        "polygon",
      )
      await depositWatcherOne.evmWorker("EVM-Polygon-Balance-1")
    })

    /// cron job for network one run every 10 mins
    // cron.schedule("*/30 * * * *", async () => {
    //   const depositWatcherOne = new Balance(
    //     "amoy",
    //   )
    //   await depositWatcherOne.evmWorker("EVM-Polygon-Testnet-Balance-1")
    // })

  } catch (error) {
    console.log(error);

  }

}



export default {
  port,
  fetch: app.fetch
}
