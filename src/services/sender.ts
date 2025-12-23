import { EVMWalletService } from "./evmWallet";
import { Address, erc20Abi } from "viem";
import transactionModel, { ITransaction } from "../models/transactionModel";
import { privateKeyToAccount } from "viem/accounts";
import walletModel, { IWallet } from "../models/walletModel";
import assetsModel, { IAsset } from "../models/assetsModel";
import { updateTx } from "../handlers/transaction";
import { hybridDecryptWithRSA } from "../utils/cryptography";
import { loadRSAKeyPair } from "../utils/loadRSAKeyPair";
import mongoose from "mongoose";

export default class Sender {
    private readonly LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    private readonly CONFIRMATION_BLOCKS = 4;
    private readonly BATCH_SIZE = 5; // Small batch for withdrawals
    private readonly workerId: string;
    private walletClient: any;
    private publicClient: any;
    private account: any;
    private isInitialized: boolean = false;

    constructor(private readonly chain: string, title: string) {
        this.chain = chain;
        this.workerId = `${title}-${Date.now()}`;
    }

    private async initialize() {
        if (this.isInitialized) return;

        try {
            console.log(`[${this.workerId}] Initializing sender for ${this.chain}`);
            
            const keeperBotId = `${Bun.env.KEEPER_BOT}`;
            if (!keeperBotId) {
                throw new Error("KEEPER_BOT environment variable not set");
            }

            const wallet = await walletModel.findOne({ userId: keeperBotId }) as IWallet;
            if (!wallet) {
                throw new Error(`Keeper wallet not found for user ${keeperBotId}`);
            }

            const { privateKey: accessTokenPrivateKey } = loadRSAKeyPair();
            
            /// Decrypt private key
            const key = hybridDecryptWithRSA(
                accessTokenPrivateKey,
                wallet.encryptedPrivateKey,
                wallet.encryptedSymmetricKey,
                keeperBotId,
                wallet.salt
            ) as Address;

            /// Initialize network clients
            const network = new EVMWalletService(this.chain, key);
            this.walletClient = network.getWalletClient();
            this.publicClient = network.getPublicClient();
            this.account = privateKeyToAccount(key);

            /// Test connection
            const blockNumber = await this.publicClient.getBlockNumber();
            console.log(`[${this.workerId}] Connected to ${this.chain} at block ${blockNumber}`);
            
            this.isInitialized = true;
            
        } catch (error) {
            console.error(`[${this.workerId}] Failed to initialize sender:`, error);
            throw error;
        }
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

    private async cleanupStaleLocks() {
        try {
            const result = await transactionModel.updateMany(
                {
                    chain: this.chain,
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

    public async evmWorker() {
        console.info(`[${this.workerId}] Starting Sender for ${this.chain}`);
        
        try {
            /// Initialize wallet connection
            await this.initialize();
            
            /// Phase 1: Process pending withdrawals
            await this.processPendingWithdrawals();
            
            /// Phase 2: Confirm completed withdrawals
            await this.confirmWithdrawals();
            
            /// Phase 3: Cleanup stale locks
            await this.cleanupStaleLocks();
            
        } catch (error) {
            console.error(`[${this.workerId}] Critical error in sender:`, error);
        }
    }

    private async processPendingWithdrawals() {
        try {
            /// Find pending withdrawals (process in small batches)
            const pendingWithdrawals = await transactionModel.find({
                chain: this.chain,
                txType: 'withdrawal',
                txStatus: 'pending',
                $or: [
                    { lockedAt: null },
                    { lockedAt: { $lt: new Date(Date.now() - this.LOCK_TIMEOUT_MS) } }
                ]
            })
            .populate("assetId")
            .limit(this.BATCH_SIZE)
            .exec();

            console.log(`[${this.workerId}] Found ${pendingWithdrawals.length} pending withdrawals`);

            /// Process sequentially to avoid nonce conflicts
            for (const withdrawal of pendingWithdrawals) {
                const lockAcquired = await this.acquireLock(withdrawal._id as mongoose.Types.ObjectId);
                if (!lockAcquired) {
                    console.log(`[${this.workerId}] Could not acquire lock for ${withdrawal._id}`);
                    continue;
                }

                try {
                    await this.processSingleWithdrawal(withdrawal);
                } catch (error) {
                    console.error(`[${this.workerId}] Error processing withdrawal ${withdrawal._id}:`, error);
                    
                    /// Mark as failed on error
                    await updateTx(
                        { id: withdrawal._id },
                        {
                            txStatus: 'failed',
                            settlementStatus: 'failed',
                            errorReason: error instanceof Error ? error.message : 'Processing error'
                        },
                        { message: "Withdrawal Failed", balance: false }
                    );
                } finally {
                    await this.releaseLock(withdrawal._id as mongoose.Types.ObjectId);
                }
            }
        } catch (error) {
            console.error(`[${this.workerId}] Error in pending withdrawals phase:`, error);
        }
    }

    private async processSingleWithdrawal(withdrawal: ITransaction) {
        console.log(`[${this.workerId}] Processing withdrawal ${withdrawal._id}`);
        
        const asset = withdrawal.assetId as unknown as IAsset;
        if (!asset) {
            throw new Error(`Asset not found for withdrawal ${withdrawal._id}`);
        }

        if (!withdrawal.receiverAddress) {
            throw new Error(`Receiver address missing for withdrawal ${withdrawal._id}`);
        }

        try {
            /// Check if transaction already has a txHash (prevent duplicate sending)
            if (withdrawal.txHash) {
                console.log(`[${this.workerId}] Withdrawal ${withdrawal._id} already has txHash: ${withdrawal.txHash}`);
                
                /// Check if it's already confirmed
                const receipt = await this.publicClient.getTransactionReceipt({ 
                    hash: withdrawal.txHash as Address 
                });
                
                if (receipt) {
                    console.log(`[${this.workerId}] Transaction already exists on chain, updating status`);
                    
                    await updateTx(
                        { id: withdrawal._id },
                        {
                            txStatus: 'broadcasting',
                            remarks: 'Transaction already submitted'
                        },
                        { message: "Withdrawal Update", balance: false }
                    );
                    return;
                }
            }

            /// First update to broadcasting state
            await updateTx(
                { id: withdrawal._id },
                {
                    txStatus: 'broadcasting',
                    remarks: 'Preparing transaction'
                },
                { message: "Withdrawal Broadcasting", balance: false }
            );

            /// Estimate gas
            const gas = await this.publicClient.estimateContractGas({
                address: asset.assetAddress as Address,
                abi: erc20Abi,
                functionName: "transfer",
                args: [
                    withdrawal.receiverAddress as Address,
                    BigInt(withdrawal.amountInWei),
                ],
                account: this.account
            });

            /// Add 20% buffer to gas estimate
            const gasWithBuffer = gas * BigInt(120) / BigInt(100);

            /// Simulate transaction first (safety check)
            const { request } = await this.publicClient.simulateContract({
                address: asset.assetAddress as Address,
                abi: erc20Abi,
                functionName: "transfer",
                args: [
                    withdrawal.receiverAddress as Address,
                    BigInt(withdrawal.amountInWei),
                ],
                gas: gasWithBuffer,
                account: this.account
            });

            /// Send transaction
            console.log(`[${this.workerId}] Sending withdrawal ${withdrawal._id} to ${withdrawal.receiverAddress}`);
            const txHash = await this.walletClient.writeContract(request);
            
            console.log(`[${this.workerId}] Transaction sent: ${txHash}`);

            /// Update with txHash and move to completed state
            await updateTx(
                { id: withdrawal._id },
                {
                    txHash: txHash,
                    txStatus: 'completed',
                    settlementStatus: 'processing',
                    remarks: 'Transaction submitted to blockchain'
                },
                { message: "Withdrawal Sent", balance: true } /// Debit balance immediately
            );

            console.log(`[${this.workerId}] ✅ Withdrawal ${withdrawal._id} submitted: ${txHash}`);

        } catch (error: any) {
            console.error(`[${this.workerId}] Failed to send withdrawal ${withdrawal._id}:`, error);
            
            /// Parse error for better error message
            let errorReason = 'Transaction failed';
            if (error.message?.includes('insufficient funds')) {
                errorReason = 'Insufficient funds for transaction';
            } else if (error.message?.includes('nonce')) {
                errorReason = 'Nonce conflict, retry needed';
            } else if (error.message?.includes('gas')) {
                errorReason = 'Gas estimation failed';
            } else if (error.message?.includes('revert')) {
                errorReason = 'Transaction would revert';
            }
            
            throw new Error(`${errorReason}: ${error.message}`);
        }
    }

    private async confirmWithdrawals() {
        try {
            /// Find withdrawals that need confirmation
            const confirmingWithdrawals = await transactionModel.find({
                chain: this.chain,
                txType: 'withdrawal',
                txStatus: 'completed',
                settlementStatus: 'processing',
                txHash: { $exists: true, $ne: null },
                $or: [
                    { lockedAt: null },
                    { lockedAt: { $lt: new Date(Date.now() - this.LOCK_TIMEOUT_MS) } }
                ]
            })
            .limit(this.BATCH_SIZE)
            .exec();

            console.log(`[${this.workerId}] Found ${confirmingWithdrawals.length} withdrawals to confirm`);

            for (const withdrawal of confirmingWithdrawals) {
                const lockAcquired = await this.acquireLock(withdrawal._id as mongoose.Types.ObjectId);
                if (!lockAcquired) continue;

                try {
                    await this.confirmSingleWithdrawal(withdrawal);
                } catch (error) {
                    console.error(`[${this.workerId}] Error confirming withdrawal ${withdrawal._id}:`, error);
                } finally {
                    await this.releaseLock(withdrawal._id as mongoose.Types.ObjectId);
                }
            }
        } catch (error) {
            console.error(`[${this.workerId}] Error in confirmation phase:`, error);
        }
    }

    private async confirmSingleWithdrawal(withdrawal: ITransaction) {
        try {
            const txHash = withdrawal.txHash as Address;
            
            console.log(`[${this.workerId}] Checking confirmation for ${txHash}`);
            
            /// Wait for transaction receipt with confirmations
            const receipt = await this.publicClient.waitForTransactionReceipt({ 
                hash: txHash, 
                confirmations: this.CONFIRMATION_BLOCKS,
                timeout: 120000 /// 2 minute timeout
            });

            if (receipt.status === "success") {
                console.log(`[${this.workerId}] ✅ Withdrawal confirmed: ${txHash}`);
                
                await updateTx(
                    { id: withdrawal._id },
                    {
                        settlementStatus: 'completed',
                        remarks: 'Successfully withdrawn and confirmed on chain'
                    },
                    { message: "Withdrawal Confirmed", balance: false }
                );
            } else {
                console.log(`[${this.workerId}] ❌ Withdrawal failed on chain: ${txHash}`);
                
                await updateTx(
                    { id: withdrawal._id },
                    {
                        txStatus: 'failed',
                        settlementStatus: 'failed',
                        errorReason: 'Transaction reverted on chain'
                    },
                    { message: "Withdrawal Failed", balance: true } /// Re-credit balance on failure
                );
            }

        } catch (error: any) {
            if (error.message?.includes('timeout')) {
                console.log(`[${this.workerId}] ⏳ Waiting for more confirmations: ${withdrawal.txHash}`);
                /// Transaction is still pending, leave it in processing state
            } else if (error.message?.includes('not found')) {
                console.log(`[${this.workerId}] ❓ Transaction not found, might be dropped: ${withdrawal.txHash}`);
                
                /// Check if transaction was dropped
                const tx = await this.publicClient.getTransaction({ hash: withdrawal.txHash as Address });
                if (!tx) {
                    /// Transaction was dropped, mark as failed
                    await updateTx(
                        { id: withdrawal._id },
                        {
                            txStatus: 'failed',
                            settlementStatus: 'failed',
                            errorReason: 'Transaction dropped from mempool',
                            txHash: null /// Clear txHash so it can be retried
                        },
                        { message: "Withdrawal Dropped", balance: true } /// Re-credit balance
                    );
                }
            } else {
                throw error;
            }
        }
    }

    /// Optional: Retry failed transactions
    public async retryFailedWithdrawals() {
        try {
            const failedWithdrawals = await transactionModel.find({
                chain: this.chain,
                txType: 'withdrawal',
                txStatus: 'failed',
                settlementStatus: 'failed',
                errorReason: { $regex: /dropped|timeout|nonce/i },
                retryCount: { $lt: 3 }, /// Max 3 retries
                $or: [
                    { lockedAt: null },
                    { lockedAt: { $lt: new Date(Date.now() - this.LOCK_TIMEOUT_MS) } }
                ]
            })
            .limit(3)
            .exec();

            console.log(`[${this.workerId}] Found ${failedWithdrawals.length} failed withdrawals to retry`);

            for (const withdrawal of failedWithdrawals) {
                const lockAcquired = await this.acquireLock(withdrawal._id as mongoose.Types.ObjectId);
                if (!lockAcquired) continue;

                try {
                    /// Reset status for retry
                    await updateTx(
                        { id: withdrawal._id },
                        {
                            txStatus: 'pending',
                            settlementStatus: 'pending',
                            txHash: null,
                            errorReason: null,
                            $inc: { retryCount: 1 },
                            remarks: `Retry attempt ${(withdrawal.retryCount || 0) + 1}`
                        },
                        { message: "Withdrawal Retry", balance: false }
                    );

                    console.log(`[${this.workerId}] Reset withdrawal ${withdrawal._id} for retry`);
                } catch (error) {
                    console.error(`[${this.workerId}] Error retrying withdrawal ${withdrawal._id}:`, error);
                } finally {
                    await this.releaseLock(withdrawal._id as mongoose.Types.ObjectId);
                }
            }
        } catch (error) {
            console.error(`[${this.workerId}] Error in retry phase:`, error);
        }
    }
}