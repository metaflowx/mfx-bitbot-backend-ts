import ReferralEarnings, { IReferralEarnings } from '../models/referralModel';
import mongoose, { ClientSession, Types } from 'mongoose';
import dotenv from "dotenv";
import walletModel from '../models/walletModel';
import { parseEther } from 'viem';
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
  investmentAmountUsd: number,
  session?: ClientSession
) => {
  let ownSession: ClientSession | null = null;
  try {
    const activeSession = session || (ownSession = await mongoose.startSession());
    if (ownSession) ownSession.startTransaction();

    let currentReferrerId: Types.ObjectId | null = userId;

    for (let level = 1; level <= 15; level++) {

      const currentUser = await ReferralEarnings
        .findOne({ userId: currentReferrerId })
        .session(activeSession);

      if (!currentUser || !currentUser.referrerBy) break;

      const upline = await ReferralEarnings
        .findOne({ userId: currentUser.referrerBy })
        .session(activeSession);

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
      let levelData = upline.referralStats.levels.get(levelKey);
      if (!levelData) {
        levelData = { earnings: 0,count:0, missedEarnings: 0, referrals: [] };
        upline.referralStats.levels.set(levelKey, levelData);
      }

      const { percentage } = LEVEL_CONFIG[level];

      /// SAFE MONEY CALCULATION
      const incomeUsd = Number(
        ((investmentAmountUsd * percentage) / 100).toFixed(8)
      );

      const incomeWei = parseEther(incomeUsd.toString());

      if (level <= upline.activeTillLevel) {
        /// ACTIVE
        levelData.earnings += incomeUsd;
        const walletRes = await walletModel.updateOne(
          { userId: upline.userId },
          { $inc: { totalFlexibleBalanceInWeiUsd: new mongoose.Types.Decimal128(incomeWei.toString()) } },
          { session: activeSession }
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

      /// Recalculate totalEarnings from all levels (safe)
      const totalEarnings = Array.from(upline.referralStats.levels.values())
        .reduce((sum, lvl) => sum + (lvl.earnings || 0), 0);
      upline.totalEarnings = totalEarnings;

      await upline.save({ session: activeSession });

      currentReferrerId = upline.userId;
    }

    if (ownSession) {
      await ownSession.commitTransaction();
      await ownSession.endSession();
    }

  } catch (error) {
    if (ownSession) {
      await ownSession.abortTransaction();
      await ownSession.endSession();
    }
    throw error;
  }
};




