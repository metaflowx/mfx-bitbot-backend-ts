import { startSession, Types } from "mongoose";
import walletModel, { IWallet } from "../models/walletModel";
import { getAssetPriceInUSD } from "../services/assetPriceFromCoingecko";
import assetsModel, { IAsset } from "../models/assetsModel";
import { formatUnits, parseEther } from "viem";
import { Context } from "hono";
import { getUserBalanceAtAsset, updateWalletBalance } from "../repositories/wallet";


export const userWallet = async (c: Context) => {
    const user = c.get("user")
    try {
        const data = await walletModel.findOne({ userId: user._id }).populate("assets.assetId").select("-encryptedSymmetricKey -encryptedPrivateKey -salt")
        return c.json({success: true, message: "user wallet fetching...", data: data })
    } catch (error) {
        return c.json({ success: false, message: "Error fetching balance" })
    }
}

export const updateWalletBalanceByAdmin = async (c: Context) => {
    const { userId, assetId, balance } = await c.req.json()
    try {
        const data = await updateWalletBalance(userId, parseEther(balance).toString(),assetId)
        if (data) {
            return c.json({ success: true,message: "Balance updated successfully" })
        }
        return c.json({ success: false, message: "Error updating balance" })
    } catch (error) {
        return c.json({success: false, message: "Something went wrong" })
    }
}

export const userBalanceAtAsset = async (c: Context) => {
    const { assetId } = c.req.query()
    const user = c.get("user")
    try {
        const data = await getUserBalanceAtAsset(user._id, new Types.ObjectId(assetId))
        return c.json({success: true, message: "Balance fetching...", data: data })
    } catch (error) {
        return c.json({ message: "Error fetching balance" }, 500)
    }
}

