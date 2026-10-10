import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma.js'
import { authenticate, AuthUser } from '../middleware/auth.js'

export const authRouter = Router()

const loginSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(1, 'Password is required'),
})

authRouter.post('/login', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = loginSchema.parse(req.body)

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    })

    if (!user || user.status !== 'ACTIVE') {
      res.status(401).json({
        success: false,
        message: 'Invalid email credentials or account inactive',
      })
      return
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash)
    if (!isValidPassword) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      })
      return
    }

    const payload: AuthUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      department: user.department,
    }

    const secret = process.env.JWT_SECRET || 'slt_procure_jwt_super_secure_secret_2026_key_randomized'
    const token = jwt.sign(payload, secret, { expiresIn: '7d' })

    // Set secure HttpOnly cookie
    res.cookie('slt_auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    })

    // Log login audit event
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'USER_LOGIN',
        entity: 'USER',
        entityId: user.id,
        details: `Successful login for user ${user.email} (${user.role})`,
        ipAddress: req.ip || req.socket.remoteAddress || '127.0.0.1',
      },
    })

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        department: user.department,
        avatarUrl: user.avatarUrl,
      },
    })
  } catch (error) {
    next(error)
  }
})

authRouter.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'USER_LOGOUT',
          entity: 'USER',
          entityId: req.user.id,
          details: `User ${req.user.email} logged out`,
          ipAddress: req.ip || req.socket.remoteAddress,
        },
      })
    }

    res.clearCookie('slt_auth_token', { path: '/' })
    res.json({
      success: true,
      message: 'Successfully logged out',
    })
  } catch (error) {
    next(error)
  }
})

authRouter.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        department: true,
        status: true,
        avatarUrl: true,
        createdAt: true,
      },
    })

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' })
      return
    }

    res.json({
      success: true,
      user,
    })
  } catch (error) {
    next(error)
  }
})
