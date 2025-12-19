import mongoose, { Types } from 'mongoose';
import { priceOfIndexCurrency } from '../services/priceOfIndexCurrency';
import investmentModel, { IInvestment } from '../models/investmentModel';
import { distributeReferralRewards } from './referral';
import { getActiveTillLevel } from '../utils/getActiveTillLevel';
import ReferralEarnings, { IReferralEarnings } from '../models/referralModel';
import walletModel from '../models/walletModel';
import { parseEther } from 'viem';


export const addInvestment = async (
  userId: Types.ObjectId,
  amountUsd: number
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const incomeWei = parseEther(amountUsd.toString());

    await walletModel.updateOne(
      { userId: userId },
      { $dcr: { totalFlexibleBalanceInWeiUsd: Types.Decimal128.fromString(incomeWei.toString()) } },
      { session }
    )
    /// 1️⃣ BTC price
    const { btcPrice } = await priceOfIndexCurrency();

    const btcValue = Number(
      (amountUsd / Number(btcPrice)).toFixed(8)
    );

    /// 2️⃣ Create investment
    const investment = await investmentModel.create(
      [{
        userId,
        amount: amountUsd,
        type: 'ADD',
        btcValue,
        btcPrice,
      }],
      { session }
    );

    const investmentDoc = investment[0];

    /// 3️⃣ Update referral totalInvestment & activeTillLevel
    const referral = await ReferralEarnings.findOne({ userId }).session(session);

    if (referral) {
      referral.totalInvestment += amountUsd;

      const newActiveLevel = getActiveTillLevel(referral.totalInvestment);

      if (newActiveLevel > referral.activeTillLevel) {
        referral.activeTillLevel = newActiveLevel;
      }

      await referral.save({ session });
    }
    const investmentId = investmentDoc._id as Types.ObjectId;
    /// 4️⃣ Distribute referral rewards (ATOMIC)
    await distributeReferralRewards(
      userId,
      investmentId,
      amountUsd,
      session
    );

    await session.commitTransaction();
    await session.endSession();

    return {
      success: true,
      message: 'Investment successful',
      data: investmentDoc,
    };

  } catch (error) {
    await session.abortTransaction();
    await session.endSession();

    return {
      success: false,
      message: 'Investment creation failed',
      error,
    };
  }
};


export const removeInvestment = async (
  userId: Types.ObjectId,
  amountUsd: number
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /// 1️⃣ BTC price
    const { btcPrice } = await priceOfIndexCurrency();

    const btcValue = Number(
      (amountUsd / Number(btcPrice)).toFixed(8)
    );

    /// 2️⃣ Create REMOVE investment entry
    const investment = await investmentModel.create(
      [{
        userId,
        amount: amountUsd,
        type: 'REMOVE',
        btcValue,
        btcPrice,
      }],
      { session }
    );

    const investmentDoc = investment[0];

    /// 3️⃣ Update referral totals
    const referral = await ReferralEarnings
      .findOne({ userId })
      .session(session);

    if (referral) {
      referral.totalInvestment = Math.max(
        0,
        referral.totalInvestment - amountUsd
      );

      /// recalc active level (can go down)
      referral.activeTillLevel = getActiveTillLevel(
        referral.totalInvestment
      );

      await referral.save({ session });
    }
    await session.commitTransaction();
    await session.endSession();

    return {
      success: true,
      message: 'Investment redeem successfully',
      data: investmentDoc,
    };

  } catch (error) {
    await session.abortTransaction();
    await session.endSession();

    console.error('Investment removal error:', error);
    return {
      success: false,
      message: 'Investment removal failed',
      error,
    };
  }
};




const DAY = 24 * 60 * 60 * 1000;

const isToday = (date: Date) =>
  date.toDateString() === new Date().toDateString();

const isYesterday = (date: Date) =>
  date.toDateString() ===
  new Date(Date.now() - DAY).toDateString();

const isWithinDays = (date: Date, days: number) =>
  Date.now() - date.getTime() <= days * DAY;

const calculateGrowth = (
  investment: IInvestment,
  currentPrices: {
    btcPrice: string;
    ethPrice: string;
    solanaPrice: string;
  }
): { invested: number; growth: number } => {

  let invested = 0;
  let currentValue = 0;

  const sign = investment.type === 'REMOVE' ? -1 : 1;

  const calc = (
    amount?: string,
    buyPrice?: string,
    currentPrice?: number
  ) => {
    if (!amount || !buyPrice || !currentPrice) return;

    const qty = parseFloat(amount);
    const buy = parseFloat(buyPrice);

    if (Number.isNaN(qty) || Number.isNaN(buy)) return;

    invested += sign * qty * buy;
    currentValue += sign * qty * currentPrice;
  };

  calc(
    investment.btcValue,
    investment.btcPrice,
    parseFloat(currentPrices.btcPrice)
  );

  calc(
    investment.ethValue,
    investment.ethPrice,
    parseFloat(currentPrices.ethPrice)
  );

  calc(
    investment.solanaValue,
    investment.solanaPrice,
    parseFloat(currentPrices.solanaPrice)
  );

  return {
    invested,
    growth: currentValue - invested,
  };
};







interface InvestmentStats {
  todaysSumOfInvestmentGrowth: number;
  yesterdaysSumOfInvestmentGrowth: number;
  seventhDaysSumOfInvestmentGrowth: number;
  thirtyDaysSumOfInvestmentGrowth: number;
  totalSumOfInvestmentGrowth: number;
  totalSumOfInvestment: number;
}

export const calculateInvestmentStats = async (
  investments: IInvestment[]
): Promise<InvestmentStats> => {

  const prices = await priceOfIndexCurrency();

  const stats: InvestmentStats = {
    todaysSumOfInvestmentGrowth: 0,
    yesterdaysSumOfInvestmentGrowth: 0,
    seventhDaysSumOfInvestmentGrowth: 0,
    thirtyDaysSumOfInvestmentGrowth: 0,
    totalSumOfInvestmentGrowth: 0,
    totalSumOfInvestment: 0,
  };

  for (const inv of investments) {
    const { invested, growth } = calculateGrowth(inv, prices);
    const createdAt = new Date(inv.createdAt);

    // total
    stats.totalSumOfInvestment += invested;
    stats.totalSumOfInvestmentGrowth += growth;

    /// today
    if (isToday(createdAt)) {
      stats.todaysSumOfInvestmentGrowth += growth;
    }

    /// yesterday
    if (isYesterday(createdAt)) {
      stats.yesterdaysSumOfInvestmentGrowth += growth;
    }

    /// last 7 days
    if (isWithinDays(createdAt, 7)) {
      stats.seventhDaysSumOfInvestmentGrowth += growth;
    }

    /// last 30 days
    if (isWithinDays(createdAt, 30)) {
      stats.thirtyDaysSumOfInvestmentGrowth += growth;
    }
  }

  return stats;
};

