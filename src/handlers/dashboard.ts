import { Context } from "hono";
import UserModel from '../models/userModel';
import InvestmentModel from '../models/investmentModel'; 
import { calculateInvestmentStats } from "../repositories/investment";
import walletModel from '../models/walletModel';
// Get All Tasks
export const dashboard = async (c: Context) => {
    try {
        let totalUserEarning = 0;
        const userCount = await UserModel.countDocuments({ role: "USER" });
        const blockedUserCount = await UserModel.countDocuments({ role: "USER", status: "BLOCK" });
        // const activePackageCount = await PackageModel.countDocuments({ status: "ACTIVE" });
        const totalBuyInvestmentPlans = await InvestmentModel.aggregate([
            { $unwind: "$buyPackagesDetails" }, // Unwind the array to count each package separately
            { $count: "total" } // Count the total number of bought investment plans
        ]);
        let totalInvestment=await InvestmentModel.aggregate([
            {
                $unwind: "$buyPackagesDetails"
            },
            {
                $lookup: {
                    from: "packages", 
                    localField: "buyPackagesDetails.packageId",
                    foreignField: "_id",
                    as: "packageInfo"
                }
            },
            {
                $unwind: "$packageInfo"
            },
            {
                $group: {
                    _id: null,
                    totalInvestment: { $sum: "$packageInfo.amount" }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalInvestment: 1
                }
            }
        ]);
        
        const usersWithWallets = await UserModel.find({ role: "USER" });
        const usersWithInvestments = await Promise.all(
            usersWithWallets.map(async (user) => {

                const packageData = await InvestmentModel.findOne(
                    { userId: user._id },
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
                //         stats: null 
                //     };
                // }        
                // const stats = calculateInvestmentStats(packageData);
        
                return {
                    stats:"" 
                };
            })
        );
        for (const element of usersWithInvestments) {
            if (element.stats) {
                // let earnings = element.stats.totalSumOfInvestmentEarnings;
                
                // Ensure earnings is a valid number before adding
                // if (!isNaN(earnings)) {
                //     totalUserEarning += earnings;
                // }
            }
        }
        const totalFlexibleBalanceSum = await walletModel.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: { $toDecimal: "$totalFlexibleBalanceInWeiUsd" } }
                }
            }
        ]);
        
        const totalSubscriptionCount = totalBuyInvestmentPlans.length > 0 ? totalBuyInvestmentPlans[0].total : 0;
        return c.json({ message: "dashboard data fetch successfully", userCount: userCount, totalUserEarning: totalUserEarning,totalFlexibleBalanceSum: totalFlexibleBalanceSum[0]?.total?.toString() || "0", totalUserInvestment: totalInvestment[0].totalInvestment , blockUser: blockedUserCount, activePackageCount: 1, platefromTotalEarnig: 0, totalSubscriptionCount:totalSubscriptionCount }, 200);

    } catch (error) {
        console.error('Error fetching tasks:', error);
        return c.json({ message: 'Server error', error }, 500);
    }
};
