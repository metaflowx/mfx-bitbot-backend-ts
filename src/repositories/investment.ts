import mongoose, { Types } from 'mongoose';
import { priceOfIndexCurrency } from '../services/priceOfIndexCurrency';
import investmentModel, { IInvestment } from '../models/investmentModel';
import { distributeReferralRewards } from './referral';
import { getActiveTillLevel } from '../utils/getActiveTillLevel';
import ReferralEarnings, { IReferralEarnings } from '../models/referralModel';
import walletModel from '../models/walletModel';
import { formatUnits, parseEther } from 'viem';


export const addInvestment = async (
  userId: Types.ObjectId,
  amountUsd: number
) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await walletModel.findOne({ userId }).session(session);
    if (!wallet) {
      await session.abortTransaction();
      await session.endSession();
      return {
        success: false,
        message: 'User wallet not found',
      };
    }
    const availableUsdFromInvestmentWallet = parseFloat(
      formatUnits(BigInt(wallet.totalBalanceInWeiUsd.toString()), 18)
    );

    const availableUsdFromWithdrawableWallet = parseFloat(
      formatUnits(BigInt(wallet.totalFlexibleBalanceInWeiUsd.toString()), 18)
    );
    const totalAvailable = availableUsdFromInvestmentWallet + availableUsdFromWithdrawableWallet;

    /// Check balance inside transaction
    if (amountUsd > totalAvailable) {
      await session.abortTransaction();
      await session.endSession();
      return {
        success: false,
        message: `Insufficient balance. Available: $${totalAvailable.toFixed(2)}`
      };
    }

    /// 1️⃣ BTC price
    const { btcPrice } = await priceOfIndexCurrency();

    const btcValue = parseFloat(
      ((amountUsd * 0.55) / Number(btcPrice)).toFixed(10) /// 55%
    );

    // Calculate how much to deduct from each balance
    let deductFromInvesment = 0;
    let deductFromWithdrawable = 0;

    if (availableUsdFromInvestmentWallet >= amountUsd) {
      /// All from investment balance
      deductFromInvesment = amountUsd;
    } else if (availableUsdFromInvestmentWallet > 0) {
      /// Part from invesment, rest from withdrawal flexible wallet
      deductFromInvesment = availableUsdFromInvestmentWallet;
      deductFromWithdrawable = amountUsd - deductFromInvesment;
    } else {
      /// All from withdrawa; flexible balance
      deductFromWithdrawable = amountUsd;
    }

    const currentLockedBtc = parseFloat(wallet.totalLockInBtc.toString());
    const newLockedBtc = currentLockedBtc + btcValue;

    /// Prepare update operations
    const updateOperations: any = {
      $inc: {
        totalLockInBtc: Types.Decimal128.fromString(btcValue.toString())
      }
    };

    // Deduct from appropriate balances (convert to Decimal128)
    if (deductFromInvesment > 0) {
      updateOperations.$inc.totalBalanceInWeiUsd =
        Types.Decimal128.fromString(`-${parseEther(deductFromInvesment.toString())}`);
    }

    if (deductFromWithdrawable > 0) {
      updateOperations.$inc.totalFlexibleBalanceInWeiUsd =
        Types.Decimal128.fromString(`-${parseEther(deductFromWithdrawable.toString())}`);
    }

    await walletModel.updateOne(
      { userId: userId },
      updateOperations,
      { session }
    )

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
      /// TO-DO : if user remove all btc then referral will be disbale but after again invesment it will be enable again
      /// Enable referral if BTC was 0 and now adding investment
      if (currentLockedBtc === 0 && btcValue > 0) {
        referral.enableReferral = true;
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


    const wallet = await walletModel.findOne({ userId }).session(session);
    if (!wallet) {
      await session.abortTransaction();
      await session.endSession();
      return {
        success: false,
        message: 'User wallet not found',
      };
    }
    const availableBtcLocked = parseFloat(wallet.totalLockInBtc.toString())


    /// 1️⃣ BTC price
    const { btcPrice } = await priceOfIndexCurrency();

    const btcValue = Number(
      (amountUsd / Number(btcPrice)).toFixed(10)
    );

    /// Check balance inside transaction
    if (btcValue > availableBtcLocked) {
      await session.abortTransaction();
      await session.endSession();
      return {
        success: false,
        message: `Insufficient BTC balance. Available: $${availableBtcLocked}`
      };
    }

    /// Calculate new BTC total after removal
    const newLockedBtc = availableBtcLocked - btcValue;

    await walletModel.updateOne(
      { userId: userId },
      {
        $inc: {
          totalFlexibleBalanceInWeiUsd: Types.Decimal128.fromString(parseEther(amountUsd.toString()).toString()),
          totalLockInBtc: Types.Decimal128.fromString(`-${btcValue.toString()}`)
        }
      },
      { session }
    )

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
      if (newLockedBtc <= 0) {
        referral.enableReferral = false
      }
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

interface PercentageResult {
  value: number;      /// Raw percentage (-5.25)
  formatted: string;  /// Formatted string ("-5.25%")
  isProfit: boolean;  /// true if positive, false if negative
  sign: string;       /// "+" or "-" or ""
}

const calculatePercentageEnhanced = (
  growth: number,
  basis: number
): PercentageResult => {
  if (basis <= 0) {
    return {
      value: 0,
      formatted: "+0%",
      isProfit: false,
      sign: ""
    };
  }

  const percentage = (growth / basis) * 100;
  const isProfit = percentage > 0;
  const sign = percentage > 0 ? "+" : percentage < 0 ? "-" : "";

  return {
    value: percentage,
    formatted: `${sign}${Math.abs(percentage).toFixed(2)}%`,
    isProfit,
    sign
  };
};


const DAY = 24 * 60 * 60 * 1000;

interface InvestmentStats {
  /// Growth in USD
  todaysSumOfInvestmentGrowth: number;
  yesterdaysSumOfInvestmentGrowth: number;
  seventhDaysSumOfInvestmentGrowth: number;
  thirtyDaysSumOfInvestmentGrowth: number;
  totalSumOfInvestmentGrowth: number;
  totalSumOfInvestment: number;
  currentCostBasis: number;
  totalBtcInvestment: number;

  /// Holdings info
  currentBtcHoldings: number;
  currentHoldingsValueUsd: number;

  /// NEW: Percentage metrics
  todaysGrowthPercentage: PercentageResult;      /// Today's growth as % of cost basis
  seventhDaysGrowthPercentage: PercentageResult;  /// 7-day growth as % of cost basis  
  thirtyDaysGrowthPercentage: PercentageResult;   /// 30-day growth as % of cost basis
  totalGrowthPercentage: PercentageResult;        /// Overall growth as % of cost basis

  /// NEW: ROI and performance metrics
  overallROI: PercentageResult;                   /// (Current Value - Total Invested) / Total Invested
  currentHoldingsROI: PercentageResult;           /// Growth % on current holdings only

  /// NEW: Time-weighted metrics (optional)
  dailyAverageGrowth: number;           /// Average daily growth rate
  estimatedMonthlyReturn: number;       /// Projected monthly return
}

export const calculateInvestmentStats = async (
  investments: IInvestment[]
): Promise<InvestmentStats> => {

  /// 1. Get current price
  const { btcPrice: currentBtcPriceStr } = await priceOfIndexCurrency();
  const currentBtcPrice = parseFloat(currentBtcPriceStr);

  /// 2. Track portfolio using FIFO
  let currentBtc = 0;
  let currentCostBasis = 0;
  const btcInventory: Array<{ btcAmount: number; costUsd: number }> = [];

  /// Store portfolio at each transaction
  const portfolioSnapshots: Array<{
    date: Date;
    btcAmount: number;
    costBasis: number;
    btcPrice: number;
  }> = [];

  /// Track last known market price
  let currentMarketPrice = currentBtcPrice;

  for (const inv of investments) {
    const btcAmount = parseFloat(inv.btcValue);
    const transactionDate = new Date(inv.createdAt);

    /// For ADD transactions, update market price
    if (inv.type === 'ADD') {
      currentMarketPrice = parseFloat(inv.btcPrice);
      const btcPurchaseUsd = parseFloat(inv.amount) * 0.55;

      btcInventory.push({ btcAmount, costUsd: btcPurchaseUsd });
      currentBtc += btcAmount;
      currentCostBasis += btcPurchaseUsd;
    } else {
      /// REMOVE - FIFO logic
      let btcToRemove = btcAmount;

      while (btcToRemove > 0 && btcInventory.length > 0) {
        const oldestLot = btcInventory[0];

        if (oldestLot.btcAmount >= btcToRemove) {
          /// Remove portion from this lot
          const costToRemove = (btcToRemove / oldestLot.btcAmount) * oldestLot.costUsd;
          oldestLot.btcAmount -= btcToRemove;
          oldestLot.costUsd -= costToRemove;
          currentCostBasis -= costToRemove;
          btcToRemove = 0;

          if (oldestLot.btcAmount < 0.00000001) {
            btcInventory.shift();
          }
        } else {
          /// Remove entire lot
          btcToRemove -= oldestLot.btcAmount;
          currentCostBasis -= oldestLot.costUsd;
          btcInventory.shift();
        }
      }

      currentBtc -= btcAmount;
    }

    /// Record portfolio state AFTER this transaction
    portfolioSnapshots.push({
      date: transactionDate,
      btcAmount: currentBtc,
      costBasis: currentCostBasis,
      btcPrice: currentMarketPrice
    });
  }

  /// 3. Calculate current values
  const finalBtcHeld = currentBtc;
  const finalCostBasis = currentCostBasis;
  const currentHoldingsValueUsd = finalBtcHeld * currentBtcPrice;
  const totalUnrealizedGrowth = currentHoldingsValueUsd - finalCostBasis;

  /// 4. Helper functions for time-based calculations
  const findHistoricalValue = (targetDate: Date): number => {
    if (portfolioSnapshots.length === 0) return 0;

    const targetDateOnly = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate()
    );

    let closestValue = 0;
    let closestDateDiff = Infinity;

    for (const snapshot of portfolioSnapshots) {
      const snapshotDate = new Date(snapshot.date);
      const snapshotDateOnly = new Date(
        snapshotDate.getFullYear(),
        snapshotDate.getMonth(),
        snapshotDate.getDate()
      );

      if (snapshotDateOnly <= targetDateOnly) {
        const dateDiff = targetDateOnly.getTime() - snapshotDateOnly.getTime();

        if (dateDiff < closestDateDiff) {
          closestDateDiff = dateDiff;
          closestValue = snapshot.btcAmount * snapshot.btcPrice;
        }
      }
    }

    return closestValue;
  };

  const hasDataForPeriod = (targetDate: Date): boolean => {
    if (portfolioSnapshots.length === 0) return false;

    const firstSnapshotDate = new Date(portfolioSnapshots[0].date);
    const firstDateOnly = new Date(
      firstSnapshotDate.getFullYear(),
      firstSnapshotDate.getMonth(),
      firstSnapshotDate.getDate()
    );

    const targetDateOnly = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate()
    );

    return targetDateOnly >= firstDateOnly;
  };

  /// 5. Calculate period growth (FIXED)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - DAY);
  const sevenDaysAgo = new Date(today.getTime() - 7 * DAY);
  const thirtyDaysAgo = new Date(today.getTime() - 30 * DAY);
  const dayBeforeYesterday = new Date(yesterday.getTime() - DAY);

  const currentPortfolioValue = currentHoldingsValueUsd;

  /// Calculate today's growth
  let todayGrowth = 0;
  if (hasDataForPeriod(yesterday)) {
    const yesterdayValue = findHistoricalValue(yesterday);
    todayGrowth = currentPortfolioValue - yesterdayValue;
  }

  /// Calculate 7-day growth
  let sevenDaysGrowth = 0;
  if (hasDataForPeriod(sevenDaysAgo)) {
    const sevenDaysAgoValue = findHistoricalValue(sevenDaysAgo);
    sevenDaysGrowth = currentPortfolioValue - sevenDaysAgoValue;
  } else {
    /// Investments started within 7 days = total growth
    sevenDaysGrowth = totalUnrealizedGrowth;
  }

  /// Calculate 30-day growth
  let thirtyDaysGrowth = 0;
  if (hasDataForPeriod(thirtyDaysAgo)) {
    const thirtyDaysAgoValue = findHistoricalValue(thirtyDaysAgo);
    thirtyDaysGrowth = currentPortfolioValue - thirtyDaysAgoValue;
  } else {
    /// Investments started within 30 days = total growth
    thirtyDaysGrowth = totalUnrealizedGrowth;
  }

  /// Calculate yesterday's growth
  let yesterdaysGrowth = 0;
  if (hasDataForPeriod(dayBeforeYesterday)) {
    const dayBeforeYesterdayValue = findHistoricalValue(dayBeforeYesterday);
    const yesterdayValue = findHistoricalValue(yesterday);
    yesterdaysGrowth = yesterdayValue - dayBeforeYesterdayValue;
  }

  /// 6. Calculate investment totals
  const totalInvestedForBtc = investments
    .filter(inv => inv.type === 'ADD')
    .reduce((sum, inv) => sum + (parseFloat(inv.amount) * 0.55), 0);

  const totalMoneyInvested = investments
    .filter(inv => inv.type === 'ADD')
    .reduce((sum, inv) => sum + parseFloat(inv.amount), 0);

  /// 7. Helper for percentages
  const calculatePercentage = (growth: number, basis: number): number => {
    return basis > 0 ? (growth / basis) * 100 : 0;
  };

  const firstInvestmentDate = portfolioSnapshots.length > 0
    ? new Date(portfolioSnapshots[0].date)
    : new Date();
  const totalDaysHeld = Math.max(1, (now.getTime() - firstInvestmentDate.getTime()) / DAY);

  /// 8. Return complete stats
  return {
    /// Growth in USD
    todaysSumOfInvestmentGrowth: todayGrowth,
    yesterdaysSumOfInvestmentGrowth: yesterdaysGrowth,
    seventhDaysSumOfInvestmentGrowth: sevenDaysGrowth,
    thirtyDaysSumOfInvestmentGrowth: thirtyDaysGrowth,
    totalSumOfInvestmentGrowth: totalUnrealizedGrowth,

    /// Investment amounts
    totalSumOfInvestment: totalMoneyInvested,
    currentCostBasis: finalCostBasis,
    totalBtcInvestment: totalInvestedForBtc,

    /// Holdings info
    currentBtcHoldings: finalBtcHeld,
    currentHoldingsValueUsd: currentHoldingsValueUsd,

    /// Percentage metrics
    todaysGrowthPercentage: calculatePercentageEnhanced(todayGrowth, finalCostBasis),
    seventhDaysGrowthPercentage: calculatePercentageEnhanced(sevenDaysGrowth, finalCostBasis),
    thirtyDaysGrowthPercentage: calculatePercentageEnhanced(thirtyDaysGrowth, finalCostBasis),
    totalGrowthPercentage: calculatePercentageEnhanced(totalUnrealizedGrowth, finalCostBasis),

    /// ROI metrics
    overallROI: calculatePercentageEnhanced(currentHoldingsValueUsd - totalMoneyInvested, totalMoneyInvested),
    currentHoldingsROI: calculatePercentageEnhanced(totalUnrealizedGrowth, finalCostBasis),

    /// Time-weighted metrics
    dailyAverageGrowth: totalDaysHeld > 0 ? totalUnrealizedGrowth / totalDaysHeld : 0,
    estimatedMonthlyReturn: totalDaysHeld > 0 ? (totalUnrealizedGrowth / totalDaysHeld) * 30 : 0
  };
};


export const getEmptyStats = (): InvestmentStats => ({
  todaysSumOfInvestmentGrowth: 0,
  yesterdaysSumOfInvestmentGrowth: 0,
  seventhDaysSumOfInvestmentGrowth: 0,
  thirtyDaysSumOfInvestmentGrowth: 0,
  totalSumOfInvestmentGrowth: 0,
  totalSumOfInvestment: 0,
  currentCostBasis: 0,
  totalBtcInvestment: 0,
  currentBtcHoldings: 0,
  currentHoldingsValueUsd: 0,
  todaysGrowthPercentage: {
    value: 0,      
    formatted: "+0%",
    isProfit: false,
    sign: ''
  },
  seventhDaysGrowthPercentage: {
    value: 0,      
    formatted: "+0%",
    isProfit: false,
    sign: ''
  },
  thirtyDaysGrowthPercentage: {
    value: 0,      
    formatted: "+0%",
    isProfit: false,
    sign: ''
  },
  totalGrowthPercentage: {
    value: 0,      
    formatted: "+0%",
    isProfit: false,
    sign: ''
  },
  overallROI: {
    value: 0,      
    formatted: "+0%",
    isProfit: false,
    sign: ''
  },
  currentHoldingsROI: {
    value: 0,      
    formatted: "+0%",
    isProfit: false,
    sign: ''
  },
  dailyAverageGrowth: 0,
  estimatedMonthlyReturn: 0
});
