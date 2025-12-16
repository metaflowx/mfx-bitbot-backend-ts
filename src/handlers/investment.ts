import { Context } from 'hono';
import walletModel from '../models/walletModel'; 
import{ Types } from 'mongoose';
import { addInvestment, calculateInvestmentStats, removeInvestment } from '../repositories/investment'; // Import function
import { distributeReferralRewards } from '../repositories/referral'; // Import the function
import { formatUnits, parseEther, parseUnits } from "viem";
import { updateWalletBalance } from '../repositories/wallet';
import investmentModel from '../models/investmentModel';



/// 4. Get All investment list
export const getInvestmentList = async (c: Context) => {
    try {
        const invest = await investmentModel.find().lean();
        return c.json({ data: invest }, 200);
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};


export const invest = async (c: Context) => {
  try {
    const userData = c.get('user');
    const { amount } = await c.req.json();

    if (!userData?._id || !amount) {
      return c.json({ message: "User ID and amount required." }, 400);
    }

    const amountUsd = Number(amount);

    if (amountUsd < 10) {
      return c.json({ message: "Amount must be at least $10" }, 400);
    }

    const wallet = await walletModel.findOne({ userId: userData._id });
    if (!wallet) {
      return c.json({ message: "User wallet not found." }, 404);
    }

    const availableUsd = Number(
      formatUnits(BigInt(wallet.totalBalanceInWeiUsd), 18)
    );

    if (amountUsd > availableUsd) {
      return c.json({ message: "Insufficient balance." }, 400);
    }

    /// ✅ SINGLE SOURCE OF TRUTH
    const result = await addInvestment(
      userData._id as Types.ObjectId,
      amountUsd
    );

    if (!result.success) {
      return c.json({ message: result.message }, 400);
    }

    return c.json(
      { message: result.message, data: result.data },
      200
    );

  } catch (error) {
    console.error("Invest error:", error);
    return c.json({ message: "Server error" }, 500);
  }
};


export const redeem = async (c: Context) => {
  try {
    const userData = c.get('user');
    const { amount } = await c.req.json();

    if (!userData?._id || !amount) {
      return c.json({ message: "User ID and amount required." }, 400);
    }

    const amountUsd = Number(amount);

    if (amountUsd < 10) {
      return c.json({ message: "Amount must be at least $10" }, 400);
    }

    const wallet = await walletModel.findOne({ userId: userData._id });
    if (!wallet) {
      return c.json({ message: "User wallet not found." }, 404);
    }

    const lockedUsd = Number(
      formatUnits(BigInt(wallet.totalLockInWeiUsd), 18)
    );

    if (amountUsd > lockedUsd) {
      return c.json({ message: "Insufficient redeem balance." }, 400);
    }

    /// ✅ POSITIVE amount ONLY
    const result = await removeInvestment(
      userData._id as Types.ObjectId,
      amountUsd
    );

    if (!result.success) {
      return c.json({ message: result.message }, 400);
    }

    return c.json(
      { message: "Redeemed successfully", data: result.data },
      200
    );

  } catch (error) {
    console.error("Redeem error:", error);
    return c.json({ message: "Server error" }, 500);
  }
};


export const stats = async (c: Context) => {
    try {
        const userData = c.get('user'); 
        const investments = await investmentModel.find({ id:userData._id }).lean();

        if (!investments || investments.length === 0) {
            return c.json({ message: "No investments found." }, 404);
        }
        const data = await calculateInvestmentStats(investments);

        return c.json({ 
            data: data
         }, 200);

    } catch (error) {
        console.error("Server error:", error);
        return c.json({ message: "Server error", error }, 500);
    }
}