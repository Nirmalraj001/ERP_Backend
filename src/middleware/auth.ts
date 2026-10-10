import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { Role } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

export interface AuthUser {
  id: string
  email: string
  fullName: string
  role: Role
  department: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization
    const cookieToken = req.cookies?.slt_auth_token
    let token: string | undefined

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7)
    } else if (cookieToken) {
      token = cookieToken
    }

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Authentication token required',
      })
      return
    }

    const secret = process.env.JWT_SECRET || 'slt_procure_jwt_super_secure_secret_2026_key_randomized'
    const decoded = jwt.verify(token, secret) as AuthUser

    req.user = decoded
    next()
  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Invalid or expired authentication session',
    })
  }
}

export function requireRoles(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' })
      return
    }

    if (!allowedRoles.includes(req.user.role) && req.user.role !== Role.ADMIN) {
      res.status(403).json({
        success: false,
        message: `Forbidden: role '${req.user.role}' lacks permission for this action`,
      })
      return
    }

    next()
  }
}
