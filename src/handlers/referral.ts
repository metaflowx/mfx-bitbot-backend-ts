import { Context } from "hono";
import ReferralEarnings from "../models/referralModel";
import userModel from "../models/userModel";
import investmentModel from "../models/investmentModel";
import { calculateInvestmentStats } from '../repositories/investment';
import WalletModel from "../models/walletModel";
import mongoose, { Types } from "mongoose";
import dotenv from "dotenv";
import { formatUnits } from "viem";

dotenv.config();

/**
 * Get referral stats for the logged-in user
 */
export const getReferralStats = async (c: Context) => {
  try {
    const { fromDate, toDate } = c.req.query();
    const userId = c.get("user").id;

    const dateFilter: Record<string, any> = {};
    if (fromDate) dateFilter["$gte"] = new Date(fromDate);
    if (toDate) dateFilter["$lte"] = new Date(toDate);

    const query: Record<string, any> = { userId };
    if (Object.keys(dateFilter).length) {
      query["createdAt"] = dateFilter;
    }

    const referralStats = await ReferralEarnings.findOne(query);    
    if (!referralStats) {
      return c.json({ message: "No referral stats found" }, 404);
    }

    const levelsMap :any= referralStats.referralStats.levels || new Map();
    const levels = Object.fromEntries(levelsMap);

    const totalEarningsLevelWise: Record<string, number> = {};
    let totalEarnings = 0;
    let totalTeamCount = 0;
    let totalTeamTopUp = 0;

    for (const [levelName, level] of Object.entries(levels)) {
      const earnings = Number(level.earnings) || 0;
      const count = Number(level.count) || 0;
      totalEarningsLevelWise[levelName] = earnings;
      totalEarnings += earnings;
      totalTeamCount += count;
    }

    const getTeamTopUp = async (userIds: mongoose.Types.ObjectId[]) => {
      if (userIds.length === 0) return 0.0;
      const wallets = await WalletModel.find({ userId: { $in: userIds } });
      return wallets.reduce((sum, wallet) => {
        const deposit = wallet.totalDepositInWeiUsd
          ? Number(
              formatUnits(BigInt(wallet.totalDepositInWeiUsd.toString()), 18)
            )
          : 0;
        return sum + deposit;
      }, 0);
    };

    const levelStats :any= {};
    for (const [levelName, level] of Object.entries(levels)) {
      const teamTopUp = await getTeamTopUp(level.referrals || []);
      totalTeamTopUp += teamTopUp;

      levelStats[levelName] = {
        totalHeadcount: Number(level.count) || 0,
        teamTopUp: teamTopUp.toFixed(2),
        totalReturn: Number(level.earnings) || 0,
        todaysEarnings: 0,
      };
    }

    return c.json(
      {
        message: "Referral stats fetched successfully",
        data: {
          referralStats,
          levelStats,
          totalEarnings,
          totalEarningsLevelWise,
          totalTeamCount,
          totalTodayEarning:0,
          totalTeamTopUp: totalTeamTopUp.toFixed(2),
        },
      },
      200
    );
  } catch (error) {
    return c.json({ message: "Server error", error }, 500);
  }
};

export const getReferralUsersByLevel = async (c: Context) => {
  try {
    const { level } = c.req.query(); // Get level from query params
    const userId = c.get("user").id; // Get logged-in user's ID from the token
    const levelKey = `level${level}`;

    const validLevels = ["level1", "level2", "level3"];
    if (!validLevels.includes(levelKey)) {
      return c.json({ message: "Invalid level parameter" }, 400);
    }

    // Find referral stats for the user
    const referralStats = await ReferralEarnings.findOne({ userId }).populate({
      path: `referralStats.levels.$*.referrals`,
      select: "_id",
    })


    if (!referralStats) {
      return c.json({ message: "No referral stats found" }, 404);
    }

    const levelsMap = referralStats.referralStats.levels || new Map();
    const levels = Object.fromEntries(levelsMap as any);
    const selectedLevelData = levels[levelKey];
    if (!selectedLevelData || !selectedLevelData.referrals.length) {
      return c.json({ message: `No referrals found for ${levelKey}` }, 404);
    }
    const UserIds = selectedLevelData.referrals.map((ref:any) => ref._id);

    const info = await Promise.all(
      UserIds.map(async (userId: any) => {
        const [user, investments,referrals] = await Promise.all([
          userModel.findById(userId).select("email mobileNumber createdAt").lean(),
          investmentModel.findOne({ userId }).select("buyPackagesDetails").lean(),
          ReferralEarnings.findOne({ userId }).select("referralStats.levels.level1.count").lean(),
        ]);

        // Extract latest investment
        // const latestInvestment = investments?.buyPackagesDetails?.length
        // ? investments.buyPackagesDetails.sort(
        //     (a: any, b: any) => b.investmentDate - a.investmentDate
        //   )[0]
        // : null;

        // Fetch package details if there is a latest investment
        // let packageDetails = null;
        // if (latestInvestment) {
        // packageDetails = await packageModel
        //   .findById(latestInvestment.packageId)
        //   .select("name")
        //   .lean();
        // }        
        return {
          user,
          count:referrals?.referralStats.levels.level1.count || 0,
          // packageName:packageDetails?.name || null
        };
      })
    );
    
    return c.json(
      {
        message: `Referrals fetched for ${levelKey}`,
        data: info
      },
      200
    );
  } catch (error:any) {
    return c.json({ message: "Server error", error: error }, 500);
  }
};


/**
 * Get total referral earnings for the logged-in user
 */
export const getReferralEarnings = async (c: Context) => {
  try {
    const userId = c.get("user").id;

    const referralData = await ReferralEarnings.findOne({ userId });
    if (!referralData) {
      return c.json({ message: "No referral data found" }, 404);
    }

    /// Calculate total earnings from all levels
    const totalEarnings = Object.values(
      referralData.referralStats.levels
    ).reduce((sum, level) => sum + (level.earnings || 0), 0);

    return c.json(
      { message: "Get total referral earnings", earnings: totalEarnings },
      200
    );
  } catch (error) {
    return c.json({ message: "Server error", error }, 500);
  }
};

/**
 * Get referral earnings history
 */
export const getReferralHistory = async (c: Context) => {
  try {
    const userId = c.get("user").id;

    const referralData = await ReferralEarnings.findOne({ userId })
      .select("referralStats referrals")
      .lean();
    if (!referralData) {
      return c.json(
        { success: false, message: "No referral history found" },
        404
      );
    }

    return c.json(
      { message: "Referral history fetch successfully", history: referralData },
      200
    );
  } catch (error) {
    return c.json({ message: "Server error", error }, 500);
  }
};

export const disableReferral = async (c: Context) => {
  try {
    // Extract userId from params
    const _id = c.req.param("id");
    if (!_id) {
      return c.json({ message: "User ID is required" }, 400);
    }

    // Get new status from request body
    const { enableReferral } = await c.req.json();
    const validStatuses = [true, false];

    if (!validStatuses.includes(enableReferral)) {
      return c.json({ message: "Invalid status" }, 400);
    }
    // Find the ReferralEarnings record by ID
    const referralRecord = await ReferralEarnings.findById(_id);
    if (!referralRecord) {
          return c.json({ message: "Referral earnings data not found" }, 404);
    }
    
  // Extract userId from the referral record
  const userId = referralRecord.userId;
  // Function to recursively freeze the referral tree
  const updateReferralTree = async (userId: mongoose.Schema.Types.ObjectId) => {
    // Update the current user's enableReferral status
    const updatedReferral = await ReferralEarnings.findOneAndUpdate(
        { userId: userId},
        { $set: { enableReferral: enableReferral } },
        { new: true }
      );

    if (!updatedReferral) {
        return;
      }

    // Find all users referred by the current user
    const referredUsers = await ReferralEarnings.find({ referrerBy: userId });
      
    // Recursively freeze the referral tree for each referred user
      await Promise.all(referredUsers.map(user => updateReferralTree(user.userId)));
    };

    // Start freezing the referral tree from the given user
    await updateReferralTree(userId);

    return c.json({
      message: "Referral disabled successfully"
    });
  } catch (error) {
    return c.json({ message: "Server error", error }, 500);
  }
};

/**
 * Get referral list earnings history
 */
export const ReferralListHistory = async (c: Context) => {
  try {
    const referralData = await ReferralEarnings.find()
      .select(
        "referralStats.userId referralStats.levels referralCode enableReferral"
      )
      .populate({
        path: "userId",
        match: { role: { $ne: "ADMIN" } }, // Exclude users with role 'ADMIN'
        select: "email mobileNumber status", // Only include necessary fields
      })
      .lean();

    // Filter out entries where userId is null
    const filteredData = referralData
      .filter((item) => item.userId !== null)
      .map((item) => {
        // Extract earnings from all levels
        const levelEarnings = item.referralStats?.levels || {};
        const totalEarnings = Object.values(levelEarnings).reduce(
          (sum, level) => sum + (level.earnings || 0),
          0
        );

        return {
          ...item,
          totalEarnings, // Add total earnings field
        };
      });
    if (!filteredData || filteredData.length === 0) {
      return c.json(
        { success: false, message: "No referral history found" },
        404
      );
    }
  
    const usersWithInvestments = await Promise.all(
      filteredData.map(async (user:any) => {
            const packageData = await investmentModel.findOne(
              { userId: user.userId._id }, 
              {
                    buyPackagesDetails: {
                        $filter: {
                            input: "$buyPackagesDetails",
                            as: "package",
                            cond: true
                        }
                    }
                }
            ).populate('buyPackagesDetails.packageId');
            // if (!packageData || packageData.buyPackagesDetails.length === 0) {
            //     return {
            //         ...user,
            //         stats: null 
            //     };
            // }        
            // const stats = calculateInvestmentStats(packageData);
    
            return {
                // ...user,
                // stats 
            };
        })
      );
      console.log({usersWithInvestments});
      
    return c.json(
      { message: "Referral history fetch successfully", history: usersWithInvestments },
      200
    );
  } catch (error) {
    return c.json({ message: "Server error", error }, 500);
  }
};
