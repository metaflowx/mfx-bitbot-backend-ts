import { Context } from 'hono';
import UserModel from '../models/userModel';
import WalletModel from '../models/walletModel';
import { generateJwtToken, comparePassword, generateUniqueReferralCode } from '../utils/index';
import { addReferral, AddReferralInput } from '../repositories/referral';
import { hybridEncryptWithRSA } from '../utils/cryptography';
import { generateRandomWallet } from '../services';
import { loadRSAKeyPair } from '../utils/loadRSAKeyPair';

const { pubKey } = loadRSAKeyPair();

// **Create Admin (Only Once)**
export const createAdmin = async (c: Context) => {
    try {
        const { email, password, confirmPassword } = await c.req.json();

        if (!email || !password || !confirmPassword) {
            return c.json({ message: 'Email, Password, and Confirm Password are required' }, 400);
        }

        if (password !== confirmPassword) {
            return c.json({ message: 'Passwords do not match' }, 400);
        }

        const existingAdmin = await UserModel.findOne({ role: 'ADMIN' });
        if (existingAdmin) {
            return c.json({ message: 'Admin already exists' }, 403);
        }
        const hashedPassword = await Bun.password.hash(password, "bcrypt");

        const admin = await UserModel.create({
            email: email,
            password: hashedPassword,
            role: 'ADMIN',
            status: 'ACTIVE'
        });
        if (!admin._id) {
            return c.json({
                message: 'something went wrong'
            })
        }

        const { address, privateKey } = generateRandomWallet()

        const { encryptedSymmetricKey, encryptedData, salt } = hybridEncryptWithRSA(pubKey, privateKey, admin._id.toString());

        await WalletModel.create({
            userId: admin._id,
            address: address,
            encryptedSymmetricKey: encryptedSymmetricKey,
            encryptedPrivateKey: encryptedData,
            salt: salt,
        });

        const newReferralCode = generateUniqueReferralCode(admin._id.toString());
        const referralContext = { userId: admin._id, referrerBy: null, referralCode: newReferralCode };
        await addReferral(referralContext as AddReferralInput);


        return c.json({ message: 'Admin created successfully', admin }, 200);
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};

// **Admin Login**
export const loginAdmin = async (c: Context) => {
    try {
        const { email, password } = await c.req.json();

        if (!email || !password) {
            return c.json({ message: 'Email and Password are required' }, 400);
        }

        const admin = await UserModel.findOne({ email, role: 'ADMIN' });
        if (!admin) {
            return c.json({ message: 'Invalid email or password' }, 401);
        }

        const isPasswordValid = comparePassword(password, admin.password);
        if (!isPasswordValid) {
            return c.json({ message: 'Invalid password' }, 401);
        }
        if (!admin._id) {
            return c.json({
                message: 'something went wrong'
            })
        }

        const token = await generateJwtToken(admin._id.toString());

        return c.json({ message: 'Login successful', token, admin });
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};

// **Get Admin Details**
export const getAdmin = async (c: Context) => {
    try {
        const admin = await UserModel.findOne({ role: 'ADMIN' }).select('-password');
        if (!admin) {
            return c.json({ message: 'Admin not found' }, 404);
        }

        return c.json({ admin });
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};

// **Update Admin Details**
export const updateAdmin = async (c: Context) => {
    try {
        const { email, oldPassword, newPassword, confirmNewPassword } = await c.req.json();
        const admin = await UserModel.findOne({ role: 'ADMIN' });

        if (!admin) {
            return c.json({ message: 'Admin not found' }, 404);
        }


        if (email) admin.email = email;

        // Check if all required fields are provided
        if (!oldPassword || !newPassword || !confirmNewPassword) {
            return c.json({ message: 'All fields are required' }, 400);
        }

        // Ensure new passwords match
        if (newPassword !== confirmNewPassword) {
            return c.json({ message: 'New passwords do not match' }, 400);
        }

        if (oldPassword && newPassword) {
            const isPasswordValid = await comparePassword(oldPassword, admin.password);
            if (!isPasswordValid) {
                return c.json({ message: 'Incorrect password' }, 401);
            }
            admin.password = await Bun.password.hash(newPassword, "bcrypt");
        }

        await admin.save();
        return c.json({ message: 'Admin updated successfully', admin });
    } catch (error) {
        return c.json({ message: 'Server error', error }, 500);
    }
};

