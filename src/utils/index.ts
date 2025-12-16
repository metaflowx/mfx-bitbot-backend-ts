import { Context, Next } from 'hono';
import {Jwt} from "hono/utils/jwt"
import UserModel from '../models/userModel';
import { createHash } from 'node:crypto'

export const comparePassword = (password: string, hashPassword: string) => {
  return Bun.password.verifySync(password, hashPassword)
};

export const generateJwtToken = (userId: string) => {

    const payload_ = {
        id: userId,
        /// Token expires in 5 days
        exp: Math.floor(Date.now()/1000) + 5*24*60*60 
    }
    return Jwt.sign(
        payload_,
        Bun.env.JWT_SECRET || "mfx-bitbot-backend"
    )
}


/// Protect Route for Authenticated Users
export const protect = async (c: Context, next: Next) => {
    let token
  
    if (
      c.req.header('Authorization') &&
      c.req.header('Authorization')?.startsWith('Bearer')
    ) {
      try {
        token = c.req.header('Authorization')?.replace(/Bearer\s+/i, '')
        if (!token) {
          return c.json({ message: 'Not authorized to access this route' })
        }
        const { id } = await Jwt.verify(token, Bun.env.JWT_SECRET || "mfx-bitbot-backend")
        const user = await UserModel.findById(id).select('-password')
        c.set('user', user)
  
        await next()
      } catch (err) {
        throw new Error('Invalid token! You are not authorized!')
      }
    }
  
    if (!token) {
      throw new Error('Not authorized! No token found!')
    }
  }
  
/// Check if user is admin
export const isAdmin = async (c: Context, next: Next) => {
    const user = c.get('user')
  
    if (user && user.isAdmin) {
      await next()
    } else {
      c.status(401)
      throw new Error('Not authorized as an admin!')
    }
  }

export const generateUniqueReferralCode = (userId: string,len:number = 11): string => {
  return createHash("sha256")
    .update(userId)
    .digest("hex")
    .substring(0, len)
    .toUpperCase()
}