import UserModel from '../models/userModel';
import WalletModel from '../models/walletModel';
import ReferralEarnings from '../models/referralModel';
import { Context } from 'hono';
import { generateJwtToken, comparePassword, generateUniqueReferralCode } from '../utils/index';
import { addReferral, AddReferralInput } from '../repositories/referral'; // Import the function
import { generateRandomWallet } from '../services';
import { hybridEncryptWithRSA } from '../utils/cryptography';
import { calculateInvestmentStats } from '../repositories/investment';
import investmentModel from '../models/investmentModel';
import { loadRSAKeyPair } from '../utils/loadRSAKeyPair';

const { pubKey: accessTokenPublicKey } = loadRSAKeyPair();



// Create User
export const createUser = async (c: Context) => {
    try {
        const { email, password, confirmPassword, referralCode } = await c.req.json();

        // Ensure either email or mobile number is provided
        if (!password || !confirmPassword) {
            return c.json({ success: false,message: 'Password or Confirm Password is required' });
        }

        // Ensure passwords match
        if (password !== confirmPassword) {
            return c.json({ success: false, message: 'Passwords do not match' });
        }
        if (!referralCode) {
            return c.json({success: false, message: 'referralCode is required' });
        }
        if (!email) {
            return c.json({ success: false, message: 'Either email is required' });
        }


        // Check if user already exists
        const existingUser = await UserModel.findOne(email);
        if (existingUser) {
            return c.json({success: false, message: 'User already exists' });
        }
        let referData = await ReferralEarnings.findOne({ referralCode: referralCode });
        if (!referData) {
            return c.json({
                success: false,
                message: 'Invalid referral code'
            })
        }

        const hashPassword = await Bun.password.hash(password)

        const data = await UserModel.create({
            email: email,
            password: hashPassword
        })
        if (!data._id) {
            return c.json({
                success: false,
                message: 'something went wrong'
            })
        }

        const { address, privateKey } = generateRandomWallet()

        const { encryptedSymmetricKey, encryptedData, salt } = hybridEncryptWithRSA(accessTokenPublicKey, privateKey, data._id.toString());

        await WalletModel.create({
            userId: data._id,
            address: address,
            encryptedSymmetricKey: encryptedSymmetricKey,
            encryptedPrivateKey: encryptedData,
            salt: salt,
        })


        const newReferralCode = generateUniqueReferralCode(data._id.toString());

        const referralContext = { userId: data._id, referrerBy: referData.userId, referralCode: newReferralCode };
        await addReferral(referralContext as AddReferralInput);

        /// Generate JWT Token
        const token = await generateJwtToken(data._id.toString());

        return c.json({ success: true,message: 'User created successfully', data: { token } });
    } catch (error) {
        return c.json({ success: false, message: 'Server error', error });
    }
};


export const loginUser = async (c: Context) => {
    try {
        const { email, mobileNumber, password } = await c.req.json();

        // Ensure email or mobile number is provided
        if (!email && !mobileNumber) {
            return c.json({success: false, message: 'Either email or mobile number is required' });
        }

        // Build query dynamically based on provided login credential
        const query: any = {};
        if (email) query.email = email;
        if (mobileNumber) query.mobileNumber = mobileNumber;

        // Find user by email or mobile number
        const user = await UserModel.findOne(query);
        if (!user) {
            return c.json({success: false, message: 'Invalid email or mobile number' });
        }

        // Compare password
        const isPasswordValid = comparePassword(password, user.password);
        if (!isPasswordValid) {
            return c.json({success: false, message: 'Invalid password' });
        }

        if (!user._id) {
            return c.json({
                message: 'something went wrong'
            })
        }

        const token = await generateJwtToken(user._id.toString());
        return c.json({success: true, message: 'Login successful', token, user });
    } catch (error) {
        return c.json({success: false, message: 'Server error', error });
    }
};

// Get All Users
// export const getAllUsers = async (c: Context) => {
//     try {
//         const users = await UserModel.find();

//         return c.json(users);
//     } catch (error) {
//         return c.json({ message: 'Server error', error }, 500);
//     }
// };


// Get All Users with Wallets and Decrypt Private Key
export const getAllUsers = async (c: Context) => {
    try {
        const { status, page, limit, sortBy = 'createdAt', sortOrder = 'desc' } = c.req.query();
        const page_ = parseInt(page) || 1;
        const limit_ = parseInt(limit) || 10;
        const skip = (page_ - 1) * limit_;
        const filter: any = { role: "USER" };

        const usersWithWallets = await UserModel.aggregate([
            { $match: filter },
            { $sort: { [sortBy]: sortOrder === "asc" ? 1 : -1 } },
            { $skip: skip },
            { $limit: limit_ },
        ]);
        const usersWithInvestments = await Promise.all(
            usersWithWallets.map(async (user) => {
                const referralData: any = await ReferralEarnings.findOne({ userId: user._id })
                    .select("referralStats referrals")
                    .lean();
                const totalCommissionEarning = Object.values(referralData.referralStats.levels).reduce(
                    (sum: any, level: any) => sum + level.earnings,
                    0
                );

                const wallets = await WalletModel.findOne({ userId: user._id }).select("address");
                const data = await investmentModel.find(
                    { userId: user._id }
                ).lean();
                if (!data || data.length === 0) {
                    return {
                        ...user,
                        wallets,
                        totalCommissionEarning,
                        stats: null
                    };
                }
                const stats = calculateInvestmentStats(data);

                return {
                    ...user,
                    wallets,
                    totalCommissionEarning,
                    stats
                };
            })
        );
        const total = await UserModel.countDocuments(filter);

        return c.json({
            message: "users fetching done",
            page: page_,
            limit: limit_,
            total,
            totalPages: Math.ceil(total / limit_),
            data: usersWithInvestments,
        });
    } catch (error) {
        console.error(error);
        return c.json({ message: 'Server error', error }, 500);
    }
};

// Get User by ID
export const getUserById = async (c: Context) => {
    try {
        const userId = c.get('user'); // Get user ID from middleware
        if (!userId) {
            return c.json({success: false, message: 'Unauthorized' });
        }
        const user = await UserModel.findById(userId).select('-password'); // Exclude password
        if (!user) return c.json({success: false, message: 'User not found' });
        // Find referral code by userId
        const referral = await ReferralEarnings.findOne({ userId });
        const referralCode = referral ? referral.referralCode : null; // Assuming referral code field is "code"

        return c.json({success: true, ...user.toObject(), referralCode });
    } catch (error) {
        return c.json({success: false, message: 'Server error', error });
    }
};

// update password 
export const updatePassword = async (c: Context) => {
    try {
        const userId = c.get('user'); // Extract user ID from middleware
        if (!userId) {
            return c.json({ message: 'Unauthorized' }, 401);
        }

        const { oldPassword, newPassword, confirmNewPassword } = await c.req.json();

        // Check if all required fields are provided
        if (!oldPassword || !newPassword || !confirmNewPassword) {
            return c.json({ message: 'All fields are required' }, 400);
        }

        // Ensure new passwords match
        if (newPassword !== confirmNewPassword) {
            return c.json({ message: 'New passwords do not match' }, 400);
        }

        // Fetch user from database
        const user = await UserModel.findById(userId);
        if (!user) {
            return c.json({ message: 'User not found' }, 404);
        }

        // Verify old password
        const isOldPasswordValid = await comparePassword(oldPassword, user.password);
        if (!isOldPasswordValid) {
            return c.json({ message: 'Incorrect old password' }, 401);
        }

        // Hash new password
        const hashedNewPassword = await Bun.password.hash(newPassword, "bcrypt");

        // Update password in database
        user.password = hashedNewPassword;
        await user.save();

        return c.json({ message: 'Password updated successfully' });
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};

// Delete User
export const deleteUser = async (c: Context) => {
    try {
        const userId = c.get('user'); // Get user ID from middleware
        if (!userId) {
            return c.json({ message: 'Unauthorized' }, 401);
        }
        const user = await UserModel.findByIdAndDelete(userId);
        if (!user) return c.json({ message: 'User not found' }, 404);

        return c.json({ message: 'User deleted successfully' });
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};


// Change User Status
export const changeUserStatus = async (c: Context) => {
    try {

        // Extract userId from params
        const userId = c.req.param('id');
        if (!userId) {
            return c.json({ message: 'User ID is required' }, 400);
        }

        // Get new status from request body
        const { status } = await c.req.json();
        const validStatuses = ['ACTIVE', 'DELETE', 'INACTIVE', 'BLOCK', 'FREEZE'];

        if (!validStatuses.includes(status)) {
            return c.json({ message: 'Invalid status' }, 400);
        }

        // Update user status
        const updatedUser = await UserModel.findByIdAndUpdate(
            userId,
            { status },
            { new: true }
        );

        if (!updatedUser) {
            return c.json({ message: 'User not found' }, 404);
        }

        return c.json({ message: 'User status updated successfully' });
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};
