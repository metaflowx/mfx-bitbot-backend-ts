import { Context, Next } from 'hono';
import {Jwt} from "hono/utils/jwt"
import UserModel from '../models/userModel';
import { createHash } from 'node:crypto'

export const comparePassword = (password: string, hashPassword: string) => {
  return Bun.password.verifySync(password, hashPassword)
};

export const generateJwtToken = (userId: string,role: string) => {

    const payload_ = {
        id: userId,
        role: role,
        /// Token expires in 2 days
        exp: Math.floor(Date.now()/1000) + 2*24*60*60 
    }
    return Jwt.sign(
        payload_,
        Bun.env.JWT_SECRET || "mfx-bitbot-backend"
    )
}

export const generateUniqueReferralCode = (userId: string,len:number = 11): string => {
  return createHash("sha256")
    .update(userId)
    .digest("hex")
    .substring(0, len)
    .toUpperCase()
}