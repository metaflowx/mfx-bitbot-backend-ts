import { EVMWalletService } from "./evmWallet";
import transactionModel, { ITransaction } from "../models/transactionModel";
import walletModel, { IWallet } from "../models/walletModel";
import { updateTx } from "../handlers/transaction";
import assetsModel, { IAsset } from "../models/assetsModel";
import { Address, parseAbiItem } from "viem";
import mongoose from "mongoose";

export default class Watcher {
    private readonly LOCK_TIMEOUT_MS = 5 * 60 * 1000; /// 5 minutes
    private readonly CONFIRMATION_BLOCKS = 4; /// Adjust per chain
    private readonly BATCH_SIZE = 20;
    private readonly MAX_BLOCK_RANGE = 500;
    private readonly workerId: string;

    constructor(private readonly chain: string, title: string) {
        this.chain = chain.toLowerCase();
        this.workerId = `${title}-${Date.now()}`;
    }

    private async acquireLock(transactionId: mongoose.Types.ObjectId): Promise<boolean> {
        try {
            const result = await transactionModel.findOneAndUpdate(
                {
                    _id: transactionId,
                    $or: [
                        { lockedAt: null },
                        { lockedAt: { $lt: new Date(Date.now() - this.LOCK_TIMEOUT_MS) } }
                    ]
                },
                {
                    $set: {
                        lockedAt: new Date(),
                        lockedBy: this.workerId
                    }
                }
            ).exec();
            
            return result !== null;
        } catch (error) {
            console.error(`[${this.workerId}] Failed to acquire lock for ${transactionId}:`, error);
            return false;
        }
    }

    private async releaseLock(transactionId: mongoose.Types.ObjectId): Promise<void> {
        try {
            await transactionModel.findByIdAndUpdate(
                transactionId,
                {
                    $unset: {
                        lockedAt: 1,
                        lockedBy: 1
                    }
                }
            ).exec();
        } catch (error) {
            console.error(`[${this.workerId}] Failed to release lock for ${transactionId}:`, error);
        }
    }

    private generateUniqueIndex(txHash: string, logIndex: number): string {
        return `${this.chain}:${txHash}:${logIndex}`;
    }

    public async evmWorker() {
        console.info(`[${this.workerId}] Starting Watcher for ${this.chain}`);
        
        const network = new EVMWalletService(this.chain);
        const client = network.getPublicClient();
        
        try {
            const currentBlock = await client.getBlockNumber();
            
            /// Phase 1: Watch for new deposits (equivalent to old Step 1)
            await this.scanForUserDeposits(client, currentBlock);
            
            /// Phase 2: Process detected deposits (equivalent to old Step 2)
            await this.processDetectedDeposits(client, currentBlock);
            
            /// Phase 3: Process confirming deposits (equivalent to old Step 4)
            await this.processConfirmingDeposits(client, currentBlock);
            
            /// Phase 4: Settle confirmed deposits (equivalent to old Step 5)
            await this.settleConfirmedDeposits();
            
            /// Phase 5: Cleanup stale locks
            await this.cleanupStaleLocks();
            
        } catch (error) {
            console.error(`[${this.workerId}] Critical error:`, error);
        }
    }

    private async scanForUserDeposits(client: any, currentBlock: bigint) {
        try {
            /// Find wallets to watch (similar to old approach but more targeted)
            const userInitiatedDeposits = await transactionModel.find({
                chain: this.chain,
                txType: 'deposit',
                txStatus: 'confirmed',
                settlementStatus: 'pending',
                $or: [
                    { lockedAt: null },
                    { lockedAt: { $lt: new Date(Date.now() - this.LOCK_TIMEOUT_MS) } }
                ]
            })
            .populate("userId")
            .populate("assetId")
            .limit(this.BATCH_SIZE)
            .exec();

            for (const watchTx of userInitiatedDeposits) {
                const lockAcquired = await this.acquireLock(watchTx._id as mongoose.Types.ObjectId);
                if(!lockAcquired) {
                    console.log(`[${this.workerId}] Could not acquire lock for ${watchTx._id}`)
                    continue;
                }
                try {
                    const userWallet = await walletModel.findOne({ 
                        userId: watchTx.userId._id 
                    }).exec() as IWallet;
                    
                    const asset = await assetsModel.findOne({ 
                        _id: watchTx.assetId._id 
                    }).exec() as IAsset;

                    if (!userWallet || !asset) {
                        await this.releaseLock(watchTx._id as mongoose.Types.ObjectId);
                        continue;
                    }

                    /// Scan for deposit events (similar to old Step 2)
                    const logs = await client.getLogs({
                        address: asset.assetAddress as Address,
                        event: asset.assetAddress !== '0x0000000000000000000000000000000000001010'
                            ? parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')
                            : parseAbiItem('event LogTransfer(address indexed token,address indexed from,address indexed to,uint256 amount,uint256 input1,uint256 input2,uint256 output1,uint256 output2)'),
                        args: { to: userWallet.address as Address },
                        fromBlock: currentBlock - BigInt(this.MAX_BLOCK_RANGE),
                        toBlock: currentBlock
                    });

                    if (logs.length > 0) {
                        /// ❌ CRITICAL FIX: Process logs sequentially, not in parallel
                        /// This prevents MongoDB transaction conflicts in updateTx
                        for (const log of logs) {
                            await this.handleDetectedLog(log, userWallet, asset, watchTx);
                        }
                    } else {
                         /// No logs found - could be pending or user hasn't sent yet
                        console.log(`[${this.workerId}] No deposit logs found for ${watchTx._id}`);
                        
                        /// Optional: Check if it's been too long and mark as failed
                        const depositAge = Date.now() - watchTx.createdAt.getTime();
                        const MAX_WAIT_TIME = 12 * 60 * 60 * 1000; /// 12 hours
                        
                        if (depositAge > MAX_WAIT_TIME) {
                            const updateData = {
                                txStatus: "failed",
                                settlementStatus: "failed",
                                errorReason: "Deposit not detected within 12 hours"
                            };
                            
                            await updateTx(
                                { id: watchTx._id },
                                updateData,
                                { message: "Deposit Timeout", balance: false }
                            );
                        }
                    }
                } catch (error) {
                    console.error(`[${this.workerId}] Error watching for deposits:`, error);
                } finally {
                    await this.releaseLock(watchTx._id as mongoose.Types.ObjectId);
                }
            }
        } catch (error) {
            console.error(`[${this.workerId}] Error in watch phase:`, error);
        }
    }

    private async handleDetectedLog(log: any, userWallet: IWallet, asset: IAsset, watchTx: ITransaction) {
        const uniqueIndex = this.generateUniqueIndex(
            log.transactionHash,
            log.logIndex || 0
        );

        try {
            /// Check if transaction already exists using uniqueIndex
            const existingTx = await transactionModel.findOne({
                uniqueIndex,
                txType: 'deposit'
            }).exec();

            if (existingTx) {
                console.log(`[${this.workerId}] Transaction already processed: ${uniqueIndex}`);
                return;
            }

            /// Also check by txHash and receiver for additional safety
            const duplicateTx = await transactionModel.findOne({
                txHash: log.transactionHash,
                receiverAddress: userWallet.address,
                txType: 'deposit',
                chain: this.chain
            }).exec();

            if (duplicateTx) {
                console.log(`[${this.workerId}] Duplicate transaction: ${log.transactionHash}`);
                return;
            }

            /// Use updateTx to create detected transaction
            const amountInWei = asset.assetAddress !== '0x0000000000000000000000000000000000001010'
                ? log.args.value.toString()
                : log.args.amount.toString();

            /// Then use updateTx to update to confirming state
            const updateData = {
                amountInWei: amountInWei,
                txHash: log.transactionHash,
                logIndex: log.logIndex,
                uniqueIndex: uniqueIndex,
                blockNumber: Number(log.blockNumber),
                receiverAddress: userWallet.address,
                txStatus: 'detected',
                remarks: `Deposit detected in block ${log.blockNumber}`
            };
            
            const result = await updateTx(
                { id: watchTx._id },
                updateData,
                { message: "Deposit Detection", balance: false }
            );

            if (result.success) {
                console.log(`[${this.workerId}] New deposit detected: ${uniqueIndex}`);
            } else {
                console.error(`[${this.workerId}] Failed to update detected tx:`, result.message);
            }

        } catch (error: any) {
            if (error.code === 11000) {
                console.log(`[${this.workerId}] Race condition - duplicate detected: ${uniqueIndex}`);
            } else {
                console.error(`[${this.workerId}] Error handling log:`, error);
            }
        }
    }

    private async processDetectedDeposits(client: any, currentBlock: bigint) {
        try {
            /// Find deposits in detected state (similar to old approach)
            const detectedTxs = await transactionModel.find({
                chain: this.chain,
                txType: 'deposit',
                txStatus: 'detected',
                $or: [
                    { lockedAt: null },
                    { lockedAt: { $lt: new Date(Date.now() - this.LOCK_TIMEOUT_MS) } }
                ]
            })
            .populate("userId")
            .populate("assetId")
            .limit(this.BATCH_SIZE)
            .exec();

            for (const tx of detectedTxs) {
                const lockAcquired = await this.acquireLock(tx._id as mongoose.Types.ObjectId);
                if (!lockAcquired) continue;

                try {
                    /// Use updateTx to move to confirming state
                    const updateData = {
                        txStatus: 'confirming', /// Using your existing state
                        settlementStatus: 'processing',
                        remarks: 'Waiting for blockchain confirmations'
                    };

                    const result = await updateTx(
                        { id: tx._id },
                        updateData,
                        { message: "Deposit Processing", balance: false }
                    );

                    if (result.success) {
                        console.log(`[${this.workerId}] Processing deposit: ${tx.txHash}`);
                    }

                } catch (error) {
                    console.error(`[${this.workerId}] Error processing detected deposit:`, error);
                } finally {
                    await this.releaseLock(tx._id as mongoose.Types.ObjectId);
                }
            }
        } catch (error) {
            console.error(`[${this.workerId}] Error in process detected phase:`, error);
        }
    }

    private async processConfirmingDeposits(client: any, currentBlock: bigint) {
        try {
            
            const processingTxs = await transactionModel.find({
                chain: this.chain,
                txType: 'deposit',
                txStatus: 'confirming',
                settlementStatus: 'processing',
                blockNumber: { $ne: null }, /// Must have block number
                $or: [
                    { lockedAt: null },
                    { lockedAt: { $lt: new Date(Date.now() - this.LOCK_TIMEOUT_MS) } }
                ]
            })
            .populate("userId")
            .populate("assetId")
            .limit(this.BATCH_SIZE)
            .exec();

            for (const tx of processingTxs) {
                const lockAcquired = await this.acquireLock(tx._id as mongoose.Types.ObjectId);
                if (!lockAcquired) continue;

                try {
                    /// Check transaction receipt (same as old Step 4)
                    const receipt = await client.getTransactionReceipt({ 
                        hash: tx.txHash as Address 
                    });

                    if (!receipt) {
                        /// Transaction not mined yet
                        await this.releaseLock(tx._id as mongoose.Types.ObjectId);
                        continue;
                    }

                    if (receipt.status === "success") {
                        /// Check confirmations
                        const confirmations = Number(currentBlock) - (tx.blockNumber || 0);
                        
                        if (confirmations >= this.CONFIRMATION_BLOCKS) {
                            /// Move to confirmed state using updateTx
                            const updateData = {
                                txStatus: "completed",
                                settlementStatus: "crediting",
                                remarks: `Confirmed with ${confirmations} blocks`
                            };
                            
                            const result = await updateTx(
                                { id: tx._id },
                                updateData,
                                { message: "Deposit Confirmation", balance: false }
                            );

                            if (result.success) {
                                console.log(`[${this.workerId}] Deposit confirmed: ${tx.txHash}`);
                            }
                        } else {
                            // Still waiting for confirmations
                            console.log(`[${this.workerId}] Waiting confirmations for ${tx.txHash}: ${confirmations}/${this.CONFIRMATION_BLOCKS}`);
                        }
                    } else {
                        // Transaction failed
                        const updateData = {
                            txStatus: "failed",
                            settlementStatus: "failed",
                            errorReason: "Transaction reverted"
                        };
                        
                        await updateTx(
                            { id: tx._id },
                            updateData,
                            { message: "Deposit Failed", balance: false }
                        );
                        
                        console.log(`[${this.workerId}] Deposit failed: ${tx.txHash}`);
                    }

                } catch (error) {
                    console.error(`[${this.workerId}] Error confirming deposit:`, error);
                } finally {
                    await this.releaseLock(tx._id as mongoose.Types.ObjectId);
                }
            }
        } catch (error) {
            console.error(`[${this.workerId}] Error in confirmation phase:`, error);
        }
    }

    private async settleConfirmedDeposits() {
        try {
            /// Find deposits ready for settlement (equivalent to old pendingWithdrawalTx)
            const readyTxs = await transactionModel.find({
                chain: this.chain,
                txType: "deposit",
                txStatus: "completed",
                settlementStatus: "crediting",
                $or: [
                    { lockedAt: null },
                    { lockedAt: { $lt: new Date(Date.now() - this.LOCK_TIMEOUT_MS) } }
                ]
            })
            .populate("userId")
            .populate("assetId")
            .limit(this.BATCH_SIZE)
            .exec();

            for (const tx of readyTxs) {
                const lockAcquired = await this.acquireLock(tx._id as mongoose.Types.ObjectId);
                if (!lockAcquired) continue;

                try {
                    // Use updateTx with balance update (same as old Step 5)
                    const updateData = {
                        settlementStatus: "completed",
                        remarks: "Deposit Successfully"
                    };
                    
                    const balanceData = {
                        userId: tx.userId._id,
                        assetId: tx.assetId,
                        amountInWei: tx.amountInWei
                    };
                    
                    const result = await updateTx(
                        { id: tx._id },
                        updateData,
                        { message: "Deposit", balance: true },
                        balanceData
                    );

                    if (result.success) {
                        console.log(`[${this.workerId}] Deposit settled: ${tx.txHash}`);
                    } else {
                        console.error(`[${this.workerId}] Failed to settle deposit:`, result.message);
                    }

                } catch (error) {
                    console.error(`[${this.workerId}] Error settling deposit:`, error);
                } finally {
                    await this.releaseLock(tx._id as mongoose.Types.ObjectId);
                }
            }
        } catch (error) {
            console.error(`[${this.workerId}] Error in settlement phase:`, error);
        }
    }

    private async cleanupStaleLocks() {
        try {
            const result = await transactionModel.updateMany(
                {
                    lockedAt: { 
                        $lt: new Date(Date.now() - this.LOCK_TIMEOUT_MS) 
                    }
                },
                {
                    $unset: {
                        lockedAt: 1,
                        lockedBy: 1
                    }
                }
            ).exec();

            if (result.modifiedCount > 0) {
                console.log(`[${this.workerId}] Cleaned ${result.modifiedCount} stale locks`);
            }
        } catch (error) {
            console.error(`[${this.workerId}] Error cleaning stale locks:`, error);
        }
    }

    /// Optional: Add reconciliation for safety
    private async reconcileInconsistentTxs() {
        try {
            // Find transactions that might be stuck
            const stuckTxs = await transactionModel.find({
                chain: this.chain,
                txType: 'deposit',
                $or: [
                    { 
                        txStatus: 'completed', 
                        settlementStatus: { $nin: ['completed', 'failed'] } 
                    },
                    { 
                        txStatus: 'processing', 
                        updatedAt: { $lt: new Date(Date.now() - 30 * 60 * 1000) } /// 30 minutes
                    }
                ]
            })
            .limit(10)
            .exec();

            for (const tx of stuckTxs) {
                console.log(`[${this.workerId}] Found stuck transaction: ${tx._id}`);
                // Add recovery logic here if needed
            }
        } catch (error) {
            console.error(`[${this.workerId}] Error in reconciliation:`, error);
        }
    }
}