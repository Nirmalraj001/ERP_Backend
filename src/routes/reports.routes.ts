import { Router, Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const reportsRouter = Router()

// GET /api/v1/reports/audit-trail
reportsRouter.get('/audit-trail', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const logs = await prisma.auditLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { fullName: true, email: true, role: true } },
      },
    })

    res.json({
      success: true,
      count: logs.length,
      data: logs,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/reports/spend-analytics
reportsRouter.get('/spend-analytics', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const [vendors, budgets, totalSpend] = await Promise.all([
      prisma.vendor.findMany({
        take: 5,
        orderBy: { rating: 'desc' },
        select: { vendorCode: true, name: true, rating: true, status: true },
      }),
      prisma.budgetControl.findMany({
        select: { costCenterCode: true, name: true, allocatedAmount: true, spentAmount: true, committedAmount: true },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'COMPLETED' },
      }),
    ])

    res.json({
      success: true,
      analytics: {
        totalSpend: Number(totalSpend._sum.amount || 0),
        topVendors: vendors,
        budgetUtilization: budgets,
      },
    })
  } catch (error) {
    next(error)
  }
})
