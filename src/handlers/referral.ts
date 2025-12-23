import { Context } from "hono";
import ReferralEarnings from "../models/referralModel";
import userModel from "../models/userModel";
import investmentModel from "../models/investmentModel";
import { calculateInvestmentStats } from '../repositories/investment';
import WalletModel from "../models/walletModel";
import mongoose, { Types } from "mongoose";
import dotenv from "dotenv";
import { formatUnits } from "viem";
import { LEVEL_CONFIG } from "../utils/getActiveTillLevel";

dotenv.config();

export const referralDetail = async (c: Context) => {
  try {
    const userId = c.get("user").id;

    const referralData = await ReferralEarnings.findOne({ userId: userId }).lean();
    return c.json(
      {
        success: true,
        message: "Referral fetch successfully",
        data: referralData
      },
    );
  } catch (error) {
    return c.json({ success: false, message: "Server error", error });
  }
}

export const getReferralStatsDetailed = async (c: Context) => {
  try {
    const { fromDate, toDate } = c.req.query();
    const userId = c.get("user").id;

    const dateFilter: Record<string, any> = {};
    if (fromDate) dateFilter["$gte"] = new Date(fromDate);
    if (toDate) dateFilter["$lte"] = new Date(toDate);

    // 1️⃣ Fetch referral earnings for the user
    const referralStatsDoc = await ReferralEarnings.findOne({ userId });
    if (!referralStatsDoc) {
      return c.json({ success: false, message: "No referral stats found" });
    }

    const levelsMap: any = referralStatsDoc.referralStats.levels || new Map();
    const levels = Object.fromEntries(levelsMap);
    
    // 2️⃣ Get ALL referral IDs from ALL levels
    const allReferralIds: string[] = [];
    const directReferralIds: string[] = [];
    let totalReferralCount = 0;
    let totalDirectReferralCount = 0;

    for (let i = 1; i <= 15; i++) {
      const levelKey = `level${i}`;
      const levelData = levels[levelKey];
      
      if (levelData?.referrals?.length) {
        const referralStrings = levelData.referrals.map((ref: any) => 
          ref.toString ? ref.toString() : ref
        );
        
        totalReferralCount += referralStrings.length;
        allReferralIds.push(...referralStrings);
        
        if (i === 1) {
          totalDirectReferralCount = referralStrings.length;
          directReferralIds.push(...referralStrings);
        }
      }
    }

    // 3️⃣ Get current user's investment
    const currentUserInvestments = await investmentModel.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          type: 'ADD',
          ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
        },
      },
      {
        $group: {
          _id: null,
          totalInvestment: { $sum: "$amount" },
          lastInvestmentDate: { $max: "$createdAt" },
        },
      },
    ]);

    const currentUserTotalInvestment = currentUserInvestments[0]?.totalInvestment || 0;

    // 4️⃣ Calculate TOTAL team business (ALL referrals' investments)
    let totalTeamBusiness = 0;
    let investmentResults = [];
    
    if (allReferralIds.length > 0) {
      const allReferralObjectIds = allReferralIds.map(id => new mongoose.Types.ObjectId(id));
      
      investmentResults = await investmentModel.aggregate([
        {
          $match: {
            userId: { $in: allReferralObjectIds },
            type: 'ADD',
            ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
          },
        },
        {
          $group: {
            _id: "$userId",
            totalInvestment: { $sum: "$amount" },
            lastInvestmentDate: { $max: "$createdAt" },
          },
        },
      ]);

      // Calculate total team business
      investmentResults.forEach(inv => {
        totalTeamBusiness += Number(inv.totalInvestment);
      });
    }

    // 5️⃣ Build direct referral list with THEIR team business
    const directReferralList = [];
    
    if (directReferralIds.length > 0) {
      // Get user details for direct referrals
      const directReferralObjectIds = directReferralIds.map(id => 
        new mongoose.Types.ObjectId(id)
      );
      
      const directUsers = await userModel.find({ 
        _id: { $in: directReferralObjectIds } 
      }).select('email createdAt').lean();

      const userMap: Record<string, any> = {};
      directUsers.forEach(user => {
        userMap[user._id.toString()] = user;
      });

      // Create investment map for direct referrals' PERSONAL investments
      const directInvestmentMap: Record<string, any> = {};
      investmentResults.forEach(inv => {
        const userIdString = inv._id.toString();
        directInvestmentMap[userIdString] = {
          totalInvestment: inv.totalInvestment,
          lastInvestmentDate: inv.lastInvestmentDate
        };
      });

      // For each direct referral, calculate THEIR team business
      for (const refId of directReferralIds) {
        const user = userMap[refId];
        const personalInvestment = directInvestmentMap[refId] || { 
          totalInvestment: 0, 
          lastInvestmentDate: null 
        };
        
        // Get this direct referral's team business (their downline's investments)
        let referralTeamBusiness = 0;
        
        // First, get this referral's own referral earnings to find their downline
        const referralDoc = await ReferralEarnings.findOne({ 
          userId: new mongoose.Types.ObjectId(refId) 
        });
        
        if (referralDoc) {
          // Get all referral IDs from this person's downline (their levels 1-15)
          const referralLevelsMap: any = referralDoc.referralStats.levels || new Map();
          const referralLevels = Object.fromEntries(referralLevelsMap);
          
          const allDownlineReferralIds: string[] = [];
          
          for (let i = 1; i <= 15; i++) {
            const levelKey = `level${i}`;
            const levelData = referralLevels[levelKey];
            
            if (levelData?.referrals?.length) {
              const referralStrings = levelData.referrals.map((ref: any) => 
                ref.toString ? ref.toString() : ref
              );
              allDownlineReferralIds.push(...referralStrings);
            }
          }
          
          // Calculate team business for this referral's downline
          if (allDownlineReferralIds.length > 0) {
            const downlineObjectIds = allDownlineReferralIds.map(id => 
              new mongoose.Types.ObjectId(id)
            );
            
            const downlineInvestments = await investmentModel.aggregate([
              {
                $match: {
                  userId: { $in: downlineObjectIds },
                  type: 'ADD',
                  ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
                },
              },
              {
                $group: {
                  _id: null,
                  totalInvestment: { $sum: "$amount" },
                },
              },
            ]);
            
            referralTeamBusiness = downlineInvestments[0]?.totalInvestment || 0;
          }
        }
        
        directReferralList.push({
          user: { 
            id: refId, 
            email: user?.email || "N/A" 
          },
          joined: user?.createdAt || null,
          investment: personalInvestment.totalInvestment, // Their personal investment
          teamBusiness: referralTeamBusiness, // Their team's total business
          lastInvestmentDate: personalInvestment.lastInvestmentDate,
          bonus: 25,
          earningsFromReferral: personalInvestment.totalInvestment * 0.25,
        });
      }
    }

    // 6️⃣ Get upline chain (simplified for now)
    const uplineChain = await getUplineChainWithDetails(userId, dateFilter);

    return c.json({
      success: true,
      message: "Referral stats fetched successfully",
      data: {
        totalReferralCount,
        totalDirectReferralCount,
        totalEarnings: referralStatsDoc.totalEarnings,
        totalTeamBusiness, // Business from ALL your referrals (levels 1-15)
        currentUserInvestment: currentUserTotalInvestment,
        directReferralList,
        uplineReferralList: uplineChain.map(upline => ({
          ...upline,
          earningsFromYou: currentUserTotalInvestment * (upline.bonus / 100),
        })),
      },
    });

  } catch (error) {
    console.error("Error:", error);
    return c.json({ 
      success: false, 
      message: "Server error" 
    });
  }
};

// Helper function for upline chain
async function getUplineChainWithDetails(userId: mongoose.Types.ObjectId | string, dateFilter: any, maxLevels = 15) {
  const uplineChain = [];
  let currentUserId = typeof userId === 'string' 
    ? new mongoose.Types.ObjectId(userId) 
    : userId;
  let level = 0;


  while (level < maxLevels) {
    const result = await ReferralEarnings.findOne(
      { userId: currentUserId },
      'referrerBy'
    ).populate({
      path: 'referrerBy',
      select: 'email referralCode createdAt',
      model: 'User'
    });

    if (!result || !result.referrerBy) break;

    level++;
    const bonus = LEVEL_CONFIG[level].percentage;

    // Get referrer's personal investment
    const referrerInvestments = await investmentModel.aggregate([
      {
        $match: {
          userId: result.referrerBy._id,
          type: 'ADD',
          ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
        },
      },
      {
        $group: {
          _id: "$userId",
          totalInvestment: { $sum: "$amount" },
          lastInvestmentDate: { $max: "$createdAt" },
        },
      },
    ]);

    const referrerInvestment = referrerInvestments[0] || {
      totalInvestment: 0,
      lastInvestmentDate: null
    };

    uplineChain.push({
      level: level,
      bonus: bonus,
      user: {
        id: result.referrerBy._id,
        email: result.referrerBy.email,
      },
      joined: result.referrerBy.createdAt,
      investment: referrerInvestment.totalInvestment,
      lastInvestmentDate: referrerInvestment.lastInvestmentDate,
    });

    currentUserId = result.referrerBy._id;
  }

  return uplineChain;
}

export const getReferralUsersByLevel = async (c: Context) => {
  try {
    const { level } = c.req.query(); // Get level from query params
    const userId = c.get("user").id; // Get logged-in user's ID from the token
    const levelKey = `level${level}`;

    // const validLevels = ["level1", "level2", "level3"];
    // if (!validLevels.includes(levelKey)) {
    //   return c.json({ message: "Invalid level parameter" }, 400);
    // }

    // Find referral stats for the user
    const referralStats = await ReferralEarnings.findOne({ userId }).populate({
      path: `referralStats.levels.$*.referrals`,
      select: "_id",
    }).lean();
    if (!referralStats) {
      return c.json({ message: "No referral stats found" });
    }

    const levelsMap = referralStats.referralStats.levels || new Map();
    const levels = Object.fromEntries(levelsMap as any);
    const selectedLevelData = levels[levelKey];
    if (!selectedLevelData || !selectedLevelData.referrals.length) {
      return c.json({ message: `No referrals found for ${levelKey}` }, 404);
    }
    const UserIds = selectedLevelData.referrals.map((ref: any) => ref._id);

    const info = await Promise.all(
      UserIds.map(async (userId: any) => {
        const [user, investments, referrals] = await Promise.all([
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
          count: referrals?.referralStats.levels.level1.count || 0,
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
  } catch (error: any) {
    return c.json({ message: "Server error", error: error }, 500);
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
        { userId: userId },
        { $set: { enableReferral: enableReferral } },
        { new: true }
      );

      if (!updatedReferral) {
        return;
      }

      // Find all users referred by the current user
      const referredUsers = await ReferralEarnings.find({ referrerBy: userId });

      // Recursively freeze the referral tree for each referred user
      await Promise.all(referredUsers.map(user => updateReferralTree(user.userId as any)));
    };

    // Start freezing the referral tree from the given user
    await updateReferralTree(userId as any);

    return c.json({
      message: "Referral disabled successfully"
    });
  } catch (error) {
    return c.json({ message: "Server error", error }, 500);
  }
};


