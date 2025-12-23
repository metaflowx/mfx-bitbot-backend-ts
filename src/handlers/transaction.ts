import { Context } from "hono";
import AssetsModel from "../models/assetsModel";
import WalletModel from "../models/walletModel";
import TransactionModel from "../models/transactionModel";
import UserModel from "../models/userModel";
import { comparePassword } from "../utils";
import transactionModel from "../models/transactionModel";
import { updateWalletBalance } from "../repositories/wallet";
import { randomUUIDv7 } from "bun";
import { parseEther } from "viem";
import { formatUnits, parseUnits } from "viem";
import referralModel from "../models/referralModel";
import mongoose, { ClientSession } from "mongoose";



export const txRequestForDeposit = async (c: Context) => {
    const user = c.get('user');
    const { assetId } = c.req.query();
    try {

        const asset = await AssetsModel.findById({ _id: assetId, depositEnabled: true });
        if (!asset) {
            return c.json({ success: false, message: 'Asset not allowed for deposit' });
        }

        const wallet = await WalletModel.findOne({ userId: user._id });
        if (!wallet) {
            return c.json({ success: false, message: 'Wallet not found' });
        }
        const tx = await transactionModel.create({
            userId: user._id,
            assetId: assetId,
            chain: asset.chainId === 56 ? "bsc" : "polygon",
            txType: 'deposit',
            txHash: randomUUIDv7('hex')
        })
        return c.json({
            success: true,
            message: 'Deposit transaction created successfully',
            data: {
                txId: tx._id,
                asset: asset,
                depositAddress: wallet.address
            }
        });
    } catch (error) {
        return c.json({ success: false, message: 'Error fetching deposit details', error });
    }
}

export const txConfirmRequestForDeposit = async (c: Context) => {
    const user = c.get('user');
    const { txId } = c.req.query();
    
    try {
        // Validate txId format
        if (!txId || !mongoose.Types.ObjectId.isValid(txId)) {
            return c.json({ 
                success: false, 
                message: 'Invalid transaction ID' 
            });
        }

        /// Find the transaction with stricter validation
        const txData = await transactionModel.findOne({
            _id: txId,
            userId: user._id,
            txType: 'deposit', /// MUST be a deposit
            txStatus: 'pending', /// MUST be pending (not already confirmed/failed/completed)
            settlementStatus: 'pending' /// MUST not be in settlement process
        });

        if (!txData) {
            /// More specific error messages
            const existingTx = await transactionModel.findOne({
                _id: txId,
                userId: user._id
            });
            
            if (!existingTx) {
                return c.json({ 
                    success: false, 
                    message: 'Transaction not found or does not belong to you' 
                });
            }
            
            if (existingTx.txType !== 'deposit') {
                return c.json({ 
                    success: false, 
                    message: 'Only deposit transactions can be confirmed' 
                });
            }
            
            if (existingTx.txStatus !== 'pending') {
                return c.json({ 
                    success: false, 
                    message: `Transaction is already ${existingTx.txStatus}. Cannot confirm again.` 
                });
            }
            
            return c.json({ 
                success: false, 
                message: 'Transaction cannot be confirmed' 
            });
        }

        /// Add idempotency check - prevent duplicate confirmations
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            /// Use findOneAndUpdate with optimistic concurrency
            const updatedTx = await transactionModel.findOneAndUpdate(
                {
                    _id: txId,
                    userId: user._id,
                    txType: 'deposit',
                    txStatus: 'pending',
                    settlementStatus: 'pending'
                },
                {
                    $set: { 
                        txStatus: "confirmed",
                        updatedAt: new Date()
                    }
                },
                {
                    new: true,
                    session,
                    runValidators: true
                }
            );

            if (!updatedTx) {
                await session.abortTransaction();
                return c.json({ 
                    success: false, 
                    message: 'Transaction was modified by another process. Please try again.' 
                });
            }

            await session.commitTransaction();
            
            /// Log the confirmation
            console.log(`User ${user._id} confirmed deposit ${txId}`);
            
            return c.json({ 
                success: true, 
                message: 'Transaction confirmed successfully',
                data: {
                    txId: updatedTx._id,
                    txStatus: updatedTx.txStatus,
                    txType: updatedTx.txType
                }
            });

        } catch (transactionError) {
            await session.abortTransaction();
            throw transactionError;
        } finally {
            session.endSession();
        }

    } catch (e) {
        console.error(`Error confirming transaction ${txId} for user ${user._id}:`, e);
        
        return c.json({ 
            success: false, 
            message: 'Error confirming transaction', 
            error: e
        });
    }
}

export const txRequestForWithdrawal = async (c: Context) => {
    const { assetId, withdrawalAddress, withdrawalAmount, password } = await c.req.json();
    const user = c.get('user');
    const now = new Date()
    try {
        const wallet = await WalletModel.findOne({ userId: user._id })
        if (!wallet) {
            return c.json({ success: false, message: "User wallet not found." });
        }
        const referral = await referralModel.findOne({ userId: user._id })
        if (referral && !referral.enableReferral) {
            return c.json({ success: false, message: "You Must Activate a Higher Level  to Withdraw Cash" });
        }
        if (wallet.lastWithdrawalAt) {
            const lastWithdrawalTime = new Date(wallet.lastWithdrawalAt);
            const timeSinceLastWithdrawal = now.getTime() - lastWithdrawalTime.getTime();
            const twentyFourHoursInMs = 24 * 60 * 60 * 1000; /// 24 hours

            if (timeSinceLastWithdrawal < twentyFourHoursInMs) {
                return c.json({ success: false, message: "Please wait 24 hours before your next withdrawal." });
            }
        }
        if (withdrawalAmount == 0) return c.json({ message: "Withdrawal amount should be greater than zero." }, 400);
        if (withdrawalAmount > parseFloat(formatUnits(BigInt(wallet.totalFlexibleBalanceInWeiUsd.toString()), 18))) {
            return c.json({ success: false, message: "Insufficient balance." });
        }

        const asset = await AssetsModel.findById({ _id: assetId, withdrawalEnabled: true });
        if (!asset) {
            return c.json({ success: false, message: 'Asset not allowed for withdrawal' });
        }
        const data = await UserModel.findById({ _id: user._id })
        if (!data) {
            return c.json({ success: false, message: 'User not found' });
        }
        const isPasswordValid = comparePassword(password, data.password);
        if (!isPasswordValid) {
            return c.json({ success: false, message: 'Invalid password' });
        }
        const tx = await TransactionModel.create({
            userId: user._id,
            assetId: assetId,
            txType: 'withdrawal',
            txHash: randomUUIDv7('hex'),
            receiverAddress: withdrawalAddress,
            amountInWei: parseEther(withdrawalAmount).toString()
        })
        if (tx) {
            await updateWalletBalance(user._id, `-${parseEther(withdrawalAmount)}`)
            return c.json({ success: true, message: 'Withdrawal request sent successfully', data: tx });
        }
        return c.json({ success: false, message: 'Error creating withdrawal request' });
    } catch (error) {
        return c.json({ success: false, message: 'Error fetching withdrawal details', error });
    }
}

export const getTransactionById = async (c: Context) => {
    const { txId } = c.req.query();
    try {
        const tx = await TransactionModel
            .findById(txId)
            .populate('userId', '-password')
            .populate('assetId');
        if (!tx) {
            return c.json({ success: false, message: 'Transaction not found' });
        }
        return c.json({ success: true, message: "Transaction fetching done", data: tx });
    } catch (error) {
        return c.json({ success: false, message: 'Error fetching transaction details', error });
    }
}

export const getTransactionList = async (c: Context) => {
    const user = c.get('user');

    const { txType, txStatus, settlementStatus, page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = c.req.query();

    try {
        const filter: any = { userId: user._id };
        if (txType) filter.txType = txType;
        if (txStatus) filter.txStatus = txStatus;
        if (settlementStatus) filter.settlementStatus = settlementStatus;

        const page_ = parseInt(page) || 1;
        const limit_ = parseInt(limit) || 10;
        const skip = (page_ - 1) * limit_;

        const txs = await TransactionModel
            .find(filter)
            .populate('userId', '-password')
            .populate('assetId')
            .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
            .skip(skip)
            .limit(limit_);

        const total = await TransactionModel.countDocuments(filter);

        return c.json({
            success: true,
            message: "Transactions fetching done",
            page: page_,
            limit: limit_,
            total,
            totalPages: Math.ceil(total / limit_),
            data: txs,
        });
    } catch (error) {
        return c.json({ success: false, message: 'Error fetching transactions', error });
    }
}
type Info = {
    message: string,
    balance: boolean
}

export const updateTx = async (query: any, req: any, info: Info, balanceReq?: any) => {
    let session: ClientSession | null = null;
    try {
        session = await mongoose.startSession();
        session.startTransaction();

        /// Check if transaction exists
        const existingTx = await TransactionModel.findOne({ _id: query.id });

        if (!existingTx) {
             await session.abortTransaction();
            console.error('Transaction does not exist. Skipping update.');
            return { success: false, message: 'Transaction not found' };
        }
        /// Update the transaction
        const updatedTx = await TransactionModel.findByIdAndUpdate(
            query.id,
            { $set: req },
            { new: true, upsert: false,session }
        );

        if (!updatedTx) {
            await session.abortTransaction();
            return { success: false, message: 'Transaction update failed' };
        }

        console.log(`${info.message} Tx updated:, ${updatedTx}`);

         if (info.balance && balanceReq) {
            await updateWalletBalance(
                balanceReq.userId,
                balanceReq.amountInWei,
                balanceReq.assetId,
                session
            );
        }
        await session.commitTransaction();
        session.endSession();
        return { success: true, message: 'Transaction updated successfully', data: updatedTx };
    } catch (error) {
        if (session) {
            await session.abortTransaction();
            session.endSession();
        }
        console.error('Error in updateDepositTx:', error);
        return { success: false, message: 'Internal server error', error };
    }
}



