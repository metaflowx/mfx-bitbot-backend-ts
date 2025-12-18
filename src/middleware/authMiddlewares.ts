import { Context, Next } from 'hono'
import { Jwt } from 'hono/utils/jwt'
//
import UserModel from '../models/userModel'

// Protect Route for Authenticated Users
export const protect = async (c: Context, next: Next) => {
    let token

    if (
      c.req.header('Authorization') &&
      c.req.header('Authorization')?.startsWith('Bearer')
    ) {
      try {
        console.log("Authorization Header:", c.req.header('Authorization'));
        
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

// Check if user is admin
export const isAdmin = async (c: Context, next: Next) => {
  const user = c.get('user')
  if (user && user.role =="ADMIN") {
    await next()
  } else {
    c.status(401)
    throw new Error('Not authorized as an admin!')
  }
}