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
    try {
        /// Create persistent watcher instances
        const bscWatcher = new Watcher("bsc", "EVM-BSC-Watcher");
        const polygonWatcher = new Watcher("polygon", "EVM-Polygon-Watcher");
        
        /// Track cycle times for monitoring
        const cycleStats = {
            bsc: { lastStart: 0, lastEnd: 0, errorCount: 0 },
            polygon: { lastStart: 0, lastEnd: 0, errorCount: 0 }
        };
        
        /// Staggered start to prevent race conditions
        setTimeout(() => {
            cron.schedule("*/30 * * * * *", async () => {
                cycleStats.bsc.lastStart = Date.now();
                try {
                    await bscWatcher.evmWorker();
                    cycleStats.bsc.errorCount = 0; /// Reset error count on success
                } catch (error) {
                    cycleStats.bsc.errorCount++;
                    console.error(`BSC watcher error #${cycleStats.bsc.errorCount}:`, error);
                    
                    /// If too many errors, skip next cycle
                    if (cycleStats.bsc.errorCount > 3) {
                        console.warn("Too many BSC errors, pausing for 2 minutes");
                        await new Promise(resolve => setTimeout(resolve, 120000));
                        cycleStats.bsc.errorCount = 0;
                    }
                }
                cycleStats.bsc.lastEnd = Date.now();
            });
            console.log("✅ BSC watcher scheduled every 30 seconds");
        }, 10000);
        
        setTimeout(() => {
            cron.schedule("*/45 * * * * *", async () => {
                cycleStats.polygon.lastStart = Date.now();
                try {
                    await polygonWatcher.evmWorker();
                    cycleStats.polygon.errorCount = 0;
                } catch (error) {
                    cycleStats.polygon.errorCount++;
                    console.error(`Polygon watcher error #${cycleStats.polygon.errorCount}:`, error);
                    
                    if (cycleStats.polygon.errorCount > 3) {
                        console.warn("Too many Polygon errors, pausing for 2 minutes");
                        await new Promise(resolve => setTimeout(resolve, 120000));
                        cycleStats.polygon.errorCount = 0;
                    }
                }
                cycleStats.polygon.lastEnd = Date.now();
            });
            console.log("✅ Polygon watcher scheduled every 45 seconds");
        }, 20000);
        
        /// Log status every minute
        setInterval(() => {
            const now = Date.now();
            console.log("📊 Watcher Status:", {
                bsc: {
                    lastCycleDuration: cycleStats.bsc.lastEnd > 0 ? cycleStats.bsc.lastEnd - cycleStats.bsc.lastStart : 'N/A',
                    timeSinceLast: cycleStats.bsc.lastEnd > 0 ? Math.round((now - cycleStats.bsc.lastEnd) / 1000) : 'N/A',
                    errorCount: cycleStats.bsc.errorCount
                },
                polygon: {
                    lastCycleDuration: cycleStats.polygon.lastEnd > 0 ? cycleStats.polygon.lastEnd - cycleStats.polygon.lastStart : 'N/A',
                    timeSinceLast: cycleStats.polygon.lastEnd > 0 ? Math.round((now - cycleStats.polygon.lastEnd) / 1000) : 'N/A',
                    errorCount: cycleStats.polygon.errorCount
                }
            });
        }, 60000);
        
        console.log("🚀 Watchers started with staggered schedules");
        
    } catch (error) {
        console.error("Failed to start watchers:", error);
        process.exit(1);
    }
}

if (process.env.ROLE === 'Sender') {
    try {
        /// Create sender instances once
        const bscSender = new Sender("bsc", "EVM-BSC-Sender");
        const polygonSender = new Sender("polygon", "EVM-Polygon-Sender");
        
        /// Staggered start times to prevent nonce conflicts if using same wallet
        setTimeout(() => {
            cron.schedule("*/40 * * * * *", async () => {
                console.log(`[${new Date().toISOString()}] Starting BSC sender cycle`);
                await bscSender.evmWorker();
                
                /// Optional: Run retry every 10 minutes
                if (Date.now() % (10 * 60 * 1000) < 40000) {
                    await bscSender.retryFailedWithdrawals();
                }
            });
            console.log("✅ BSC sender scheduled every 40 seconds");
        }, 15000); /// Start BSC after 15 seconds
        
        setTimeout(() => {
            cron.schedule("*/55 * * * * *", async () => {
                console.log(`[${new Date().toISOString()}] Starting Polygon sender cycle`);
                await polygonSender.evmWorker();
                
                /// Optional: Run retry every 10 minutes
                if (Date.now() % (10 * 60 * 1000) < 55000) {
                    await polygonSender.retryFailedWithdrawals();
                }
            });
            console.log("✅ Polygon sender scheduled every 55 seconds");
        }, 30000); /// Start Polygon after 30 seconds
        
        console.log("🚀 Senders initialized with staggered schedules");

    /// Balance

    /// cron job for network one run every 5 mins
    cron.schedule("*/4 * * * *", async () => {
      const depositWatcherOne = new Balance(
        "bsc",
      )
      await depositWatcherOne.evmWorker("EVM-BSC-Balance-1")
    })

    /// cron job for network one run every 7 mins
    cron.schedule("*/7 * * * *", async () => {
      const depositWatcherOne = new Balance(
        "polygon",
      )
      await depositWatcherOne.evmWorker("EVM-Polygon-Balance-1")
    })
        
    } catch (error) {
        console.error("Failed to initialize senders:", error);
        process.exit(1);
    }
}



export default {
  port,
  fetch: app.fetch
}
