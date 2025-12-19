import walletModel, { IWallet } from "../models/walletModel";
import { getAssetPriceInUSD } from "../services/assetPriceFromCoingecko";
import assetsModel, { IAsset } from "../models/assetsModel";
import { formatEther, formatUnits, parseEther, parseUnits } from "viem";
import mongoose, { ClientSession, Types } from "mongoose";
import { calculateUsdValueInWei } from "../utils/calculateUsdValueInWei";

/// Function to update wallet balance with transactions
export const updateWalletBalance = async (
  userId: Types.ObjectId,
  balanceChangeInWei: string,
  assetId?: Types.ObjectId,
  session?: ClientSession
) => {
  let ownSession: ClientSession | null = null;
  
  try {
    /// Start session if not provided
    const activeSession = session || (ownSession = await mongoose.startSession());
    if (ownSession) ownSession.startTransaction();
    
    /// 1. Validate input
    const balanceChange = BigInt(balanceChangeInWei);
    if (balanceChange === 0n) {
      throw new Error("Balance change cannot be zero");
    }
    
    /// 2. Atomic operation with optimistic locking
    const wallet = await walletModel.findOne({ userId }).session(activeSession);
    if (!wallet) throw new Error("Wallet not found");
    
    /// 3. For assets, validate balance won't go negative (In case of deposit)
    if (assetId) {
      const asset = await assetsModel.findById(assetId).session(activeSession);
      if (!asset) throw new Error("Asset not found");
      
      const existingAsset = wallet.assets.find(a => a.assetId.equals(assetId));
      
      if (existingAsset) {
        const currentBalance = BigInt(existingAsset.balance.toString());
        const newBalance = currentBalance + balanceChange;
        
        if (newBalance < 0n) {
          throw new Error("Insufficient asset balance");
        }
        
        /// Update with atomic operation
        const updateResult = await walletModel.updateOne(
          { 
            userId, 
            "assets.assetId": assetId,
            [`assets.${wallet.assets.findIndex(a => a.assetId.equals(assetId))}.balance`]: existingAsset.balance
          },
          { 
            $inc: { "assets.$.balance": Types.Decimal128.fromString(balanceChangeInWei) } 
          },
          { session: activeSession }
        );
        
        if (updateResult.modifiedCount === 0) {
          throw new Error("Concurrent modification detected");
        }
      } else if (balanceChange < 0n) {
        throw new Error("Cannot withdraw non-existent asset");
      } else {
        /// Add new asset
        await walletModel.updateOne(
          { userId },
          { $push: { assets: { assetId, balance: Types.Decimal128.fromString(balanceChangeInWei) } } },
          { session: activeSession }
        );
      }
      
      /// 4. Safer USD calculation 
      let assetPrice: string;
      if (asset.coinGeckoId === "tether") {
        assetPrice = "1.0";
      } else {
        assetPrice = await getAssetPriceInUSD(asset.coinGeckoId);
      }
      const usdValue = calculateUsdValueInWei(balanceChange, assetPrice);
      
      /// Update totals
      await walletModel.updateOne(
        { userId },
        { 
          $inc: { 
            totalBalanceInWeiUsd: usdValue,
            totalDepositInWeiUsd: usdValue
          } 
        },
        { session: activeSession }
      );
      
    } else {
      /// for withdraw
      /// 5. For flexible balance, validate
      const currentFlexible = BigInt(wallet.totalFlexibleBalanceInWeiUsd?.toString() || "0");
      const newFlexible = currentFlexible + balanceChange;
      
      if (newFlexible < 0n) {
        throw new Error("Insufficient flexible balance");
      }
      
      await walletModel.updateOne(
        { userId },
        {
          $inc: { 
            totalFlexibleBalanceInWeiUsd: Types.Decimal128.fromString(balanceChangeInWei),
            totalWithdrawInWeiUsd: Types.Decimal128.fromString(balanceChangeInWei)
          },
          $set: { lastWithdrawalAt: new Date() }
        },
        { session: activeSession }
      );
    }
    
    if (ownSession) {
      await ownSession.commitTransaction();
      await ownSession.endSession();
    }
    
    return true;
    
  } catch (error) {
    if (ownSession) {
      await ownSession.abortTransaction();
      await ownSession.endSession();
    }
    console.error("Error updating wallet balance:", error);
    throw error;
  }
};

export const getUserBalanceAtAsset = async (
  userId: string,
  assetId: Types.ObjectId
) => {
  const wallet = await walletModel.findOne({ userId }).populate('assets.assetId');
  if (!wallet) throw new Error("Wallet not found");

  const asset = wallet.assets.find(a => a.assetId.equals(assetId));
  if (!asset) throw new Error("Asset not found in wallet");

  const assetData = await assetsModel.findById(asset.assetId) as IAsset;
  const assetPrice = await getAssetPriceInUSD(assetData.coinGeckoId);

  const balanceInWei = BigInt(asset.balance.toString());
  const balanceInUSD = (Number(balanceInWei) * Number(assetPrice));

  return {
    balance: asset.balance,
    balanceInUSD: balanceInUSD.toString()
  };
};



