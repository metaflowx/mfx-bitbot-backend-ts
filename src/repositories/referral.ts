import ReferralEarnings, { IReferralEarnings } from '../models/referralModel';
import mongoose, { Types } from 'mongoose';
import dotenv from "dotenv";
import walletModel from '../models/walletModel';
import { parseEther } from 'viem';
import InvestmentModel from "../models/investmentModel";
import { LEVEL_CONFIG } from '../utils/getActiveTillLevel';


dotenv.config();

export interface AddReferralInput {
    userId: Types.ObjectId;
    referrerBy: Types.ObjectId | null;
    referralCode: string;
}

export const addReferral = async ({
    userId,
    referrerBy,
    referralCode,
}: AddReferralInput) => {

    /// 1️⃣ Create referral doc for new user
    let newUserReferral: IReferralEarnings | null = await ReferralEarnings.findOne({ userId });

    if (!newUserReferral) {
        newUserReferral = await ReferralEarnings.create({
            userId,
            referrerBy,
            referralCode,
            totalInvestment: 0,
            totalEarnings: 0,
            activeTillLevel: 4,
            enableReferral: true,
        });
    }

    /// 2️⃣ Traverse upline tree
    let currentReferrerId: Types.ObjectId | null = referrerBy;

    for (let level = 1; level <= 15 && currentReferrerId; level++) {

        const upline: IReferralEarnings | null =
            await ReferralEarnings.findOne({
                userId: currentReferrerId,
            });

        if (!upline) break;

        const levelKey = `level${level}`;
        const levelData = upline.referralStats.levels.get(levelKey);

        if (!levelData) break;

        /// 🔐 Prevent duplicate
        if (!levelData.referrals.some(id => id.equals(userId))) {
            levelData.referrals.push(userId);
            levelData.count += 1;
        }

        await upline.save();

        currentReferrerId = upline.referrerBy || null;
    }

    return newUserReferral;
};



/// WITH ATOMIC TRANSACTION

export const distributeReferralRewards = async (
  userId: Types.ObjectId,
  investmentId: Types.ObjectId,
  investmentAmountUsd: number
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let currentReferrerId: Types.ObjectId | null = userId;

    for (let level = 1; level <= 15; level++) {

      const currentUser = await ReferralEarnings
        .findOne({ userId: currentReferrerId })
        .session(session);

      if (!currentUser || !currentUser.referrerBy) break;

      const upline = await ReferralEarnings
        .findOne({ userId: currentUser.referrerBy })
        .session(session);

      if (!upline || !upline.enableReferral) {
        currentReferrerId = currentUser.referrerBy;
        continue;
      }

      /// Idempotency check
      if (upline.processedInvestments.some(id => id.equals(investmentId))) {
        currentReferrerId = upline.userId;
        continue;
      }

      const levelKey = `level${level}`;
      const levelData = upline.referralStats.levels.get(levelKey);
      if (!levelData) break;

      const { percentage } = LEVEL_CONFIG[level];

      /// SAFE MONEY CALCULATION
      const incomeUsd = Number(
        ((investmentAmountUsd * percentage) / 100).toFixed(8)
      );

      const incomeWei = parseEther(incomeUsd.toString());

      if (level <= upline.activeTillLevel) {
        /// ACTIVE
        levelData.earnings += incomeUsd;
        upline.totalEarnings += incomeUsd;

        const walletRes = await walletModel.updateOne(
          { userId: upline.userId },
          { $inc: { totalFlexibleBalanceInWeiUsd: incomeWei.toString() } },
          { session }
        );

        if (walletRes.matchedCount === 0) {
          throw new Error(`Wallet not found for user ${upline.userId}`);
        }
      } else {
        /// ❌ MISSED
        levelData.missedEarnings += incomeUsd;
      }

      /// 🔒 Mark investment processed
      upline.processedInvestments.push(investmentId);

      await upline.save({ session });

      currentReferrerId = upline.userId;
    }

    await session.commitTransaction();
    session.endSession();

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};




