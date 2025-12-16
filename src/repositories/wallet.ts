import walletModel, { IWallet } from "../models/walletModel";
import { getAssetPriceInUSD } from "../services/assetPriceFromCoingecko";
import assetsModel, { IAsset } from "../models/assetsModel";
import { formatEther, formatUnits, parseEther, parseUnits } from "viem";
import mongoose, { ClientSession, Schema, Types } from "mongoose";

/// Function to update wallet balance with transactions
export const updateWalletBalance = async (
  userId: Types.ObjectId,
  /// Positive for deposit, negative for withdrawal
  balanceChangeInWei: string,
  assetId?: Types.ObjectId
) => {
  try {
    // Find the wallet and the specific asset

    const wallet = await walletModel.findOne({ userId: userId }).populate('assets.assetId')
    if (!wallet) {
      throw new Error('Wallet not found for the user. This should not happen!');
    }

    /// In case of deposit
    if (assetId) {
      /// If the asset exists, update its balance
      const asset = wallet.assets.find((asset) => asset.assetId.equals(assetId))
      const assetData = await assetsModel.findOne({ _id: assetId }) as IAsset;
      const assetPriceInUsd = assetData.coinGeckoId === 'tether'? 1 : await getAssetPriceInUSD(assetData.coinGeckoId);
      if (asset) {
        const currentBalance = parseFloat(asset.balance);
        const change = parseFloat(balanceChangeInWei);
        asset.balance = (currentBalance + change).toString();
      } else {
        /// If the asset does not exist, add it to the wallet
        await walletModel.updateOne(
          { userId: userId },
          {
            $push: {
              assets: {
                assetId: assetId,
                balance: balanceChangeInWei
              },
            },
          },
        );
      }
      /// Convert in usd 
      let balanceInUSD = parseFloat(formatEther(BigInt(balanceChangeInWei.toString()))) * Number(assetPriceInUsd)
      balanceInUSD = parseFloat(parseEther(balanceInUSD.toString()).toString())
      wallet.totalBalanceInWeiUsd = (parseFloat(wallet.totalBalanceInWeiUsd) + balanceInUSD).toString()
      wallet.totalDepositInWeiUsd = (parseFloat(wallet.totalDepositInWeiUsd) + balanceInUSD).toString()
    } else {
      wallet.lastWithdrawalAt = new Date()
      wallet.totalFlexibleBalanceInWeiUsd = (parseFloat(wallet.totalFlexibleBalanceInWeiUsd) + parseFloat(balanceChangeInWei)).toString()
      wallet.totalWithdrawInWeiUsd = (parseFloat(wallet.totalWithdrawInWeiUsd) + parseFloat(balanceChangeInWei)).toString()
    }
    await wallet.save(); /// Save the updated wallet within the transaction
    console.log('Wallet balance updated successfully');
    return true;
  } catch (error) {
    console.error('Error updating wallet balance:', error);
    throw error; /// Throw error to trigger transaction rollback
  }
};


export const getUserBalanceAtAsset = async (
  userId: string,
  assetId: Types.ObjectId
) => {
  try {
    const wallet = await walletModel.findOne({ userId: userId }).populate('assets.assetId');

    if (!wallet) {
      return 'Wallet not found';
    }

    const asset = wallet.assets.find((asset) => asset.assetId.equals(assetId));

    if (!asset) {
      return 'Asset not found in wallet';
    }
    const assetData = await assetsModel.findOne({ _id: asset.assetId }) as IAsset;
    const assetPriceInUSD = await getAssetPriceInUSD(assetData.coinGeckoId);

    /// Convert balance 
    let balanceInUSD = Number(formatUnits(BigInt(asset.balance), assetData.decimals)) * Number(assetPriceInUSD)
    balanceInUSD = Number(parseUnits(balanceInUSD.toString(), assetData.decimals))

    return {
      balance: asset.balance,
      balanceInUSD: balanceInUSD
    };
  } catch (error) {
    console.error('Error fetching balance and lock:', error);
  }
}


/// Function to get user balance with total in USD
export const getTotalUserBalanceAtAsset = async (userId: string) => {
  try {
    const wallet = await walletModel.findOne({ userId }).populate('assets.assetId').select("-encryptedSymmetricKey -encryptedPrivateKey -salt");

    if (!wallet) {
      return 'Wallet not found';
    }

    let totalBalanceInWeiUsd = 0;

    for (const asset of wallet.assets) {
      const assetData = await assetsModel.findOne({ _id: asset.assetId }) as IAsset;

      const assetPriceInUSD = await getAssetPriceInUSD(assetData.coinGeckoId);

      /// Convert balance and lock to USD

      const balanceInUSD = Number(formatUnits(BigInt(asset.balance), assetData.decimals)) * Number(assetPriceInUSD)

      totalBalanceInWeiUsd += Number(parseUnits(balanceInUSD.toString(), assetData.decimals));
    }

    return {
      wallet,
      totalSumOfAssetBalanceInWeiUsd: totalBalanceInWeiUsd.toString()
    };
  } catch (error) {
    console.error('Error fetching user balance:', error)
  }
}

