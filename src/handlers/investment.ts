import { Context } from 'hono';
import walletModel from '../models/walletModel';
import { Types } from 'mongoose';
import { addInvestment, calculateInvestmentStats, removeInvestment } from '../repositories/investment'; // Import function
import { distributeReferralRewards } from '../repositories/referral'; // Import the function
import { formatUnits, parseEther, parseUnits } from "viem";
import { updateWalletBalance } from '../repositories/wallet';
import investmentModel from '../models/investmentModel';



/// 4. Get All investment list
export const getInvestmentList = async (c: Context) => {
  try {
    const userId = c.get('user').id;
    const { type,sortBy = 'createdAt', sortOrder = 'desc'  } = c.req.query();
    /// Build query filter
    const filter: any = { userId };
    
    /// Add type filter if provided
    if (type) {
      filter.type = type; // Assuming your InvestmentModel has a 'type' field
    }
    const invest = await investmentModel
    .find(filter)
    .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
    .lean();
    return c.json({ success: true, message: "Successfully Fetch Invesment List", data: invest });
  } catch (error) {
    return c.json({ success: false, message: 'Server error', error });
  }
};


export const invest = async (c: Context) => {
  try {
    const userData = c.get('user');
    const { amount } = await c.req.json();

    if (!userData?._id || !amount) {
      return c.json({ success: false, message: "User ID and amount required." });
    }

    const amountUsd = Number(amount);

    if (amountUsd < 10) {
      return c.json({ success: false, message: "Amount must be at least $10" });
    }

    const wallet = await walletModel.findOne({ userId: userData._id });
    if (!wallet) {
      return c.json({ success: false, message: "User wallet not found." });
    }

    const availableUsd = Number(
      formatUnits(BigInt(wallet.totalBalanceInWeiUsd.toString()), 18)
    );

    if (amountUsd > availableUsd) {
      return c.json({ success: false, message: "Insufficient balance." });
    }

    /// ✅ SINGLE SOURCE OF TRUTH
    const result = await addInvestment(
      userData._id as Types.ObjectId,
      amountUsd
    );

    if(!result.success) {
      return c.json({ success: false, message: result.message });
    }

    return c.json(
      { success: true, message: result.message, data: result.data }
    );

  } catch (error) {
    return c.json({ success: false, message: "Server error" });
  }
};


export const redeem = async (c: Context) => {
  try {
    const userData = c.get('user');
    const { amount } = await c.req.json();

    if (!userData?._id || !amount) {
      return c.json({ success: false, message: "User ID and amount required." });
    }

    const amountUsd = Number(amount);

    if (amountUsd < 10) {
      return c.json({ success: false, message: "Amount must be at least $10" });
    }

    const wallet = await walletModel.findOne({ userId: userData._id });
    if (!wallet) {
      return c.json({ success: false, message: "User wallet not found." });
    }

    const lockedUsd = Number(
      formatUnits(BigInt(wallet.totalLockInWeiUsd.toString()), 18)
    );

    if (amountUsd > lockedUsd) {
      return c.json({ success: false, message: "Insufficient redeem balance." });
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
      { success: true, message: "Redeemed successfully", data: result.data }
    );

  } catch (error) {
    return c.json({ success: false, message: "Server error" });
  }
};


export const stats = async (c: Context) => {
  try {
    const userData = c.get('user');
    const investments = await investmentModel.find({ id: userData._id }).lean();

    if (!investments || investments.length === 0) {
      return c.json({ success: false, message: "No investments found." });
    }
    const data = await calculateInvestmentStats(investments);

    return c.json({
      success: true,
      message: "Investment stats fetched successfully.",
      data: data
    });

  } catch (error) {
    return c.json({ success: false, message: "Server error", error });
  }
}