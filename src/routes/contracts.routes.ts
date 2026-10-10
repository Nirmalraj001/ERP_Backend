import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const contractsRouter = Router()

// GET /api/v1/rate-contracts (Drawdown tracking & renewal calendar §14)
contractsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const contracts = await prisma.rateContract.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { id: true, vendorCode: true, name: true, rating: true, qualificationStatus: true } },
        items: {
          include: {
            item: true,
          },
        },
      },
    })

    const now = new Date()

    const formatted = contracts.map((c) => {
      const totalVal = Number(c.totalValue)
      const spentVal = Number(c.spentAmount)
      const drawdownPct = totalVal > 0 ? Number(((spentVal / totalVal) * 100).toFixed(1)) : 0
      const remainingBalance = Math.max(0, totalVal - spentVal)

      const diffDays = Math.ceil((new Date(c.endDate).getTime() - now.getTime()) / (1000 * 3600 * 24))
      let validityStatus = 'ACTIVE'
      if (diffDays <= 0) {
        validityStatus = 'EXPIRED'
      } else if (diffDays <= 30) {
        validityStatus = 'EXPIRING_SOON'
      }

      return {
        ...c,
        totalValue: totalVal,
        spentAmount: spentVal,
        drawdownPct,
        remainingBalance,
        daysRemaining: Math.max(0, diffDays),
        validityStatus,
      }
    })

    res.json({
      success: true,
      count: formatted.length,
      data: formatted,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/rate-contracts/check-maverick (Maverick-spend detection §14)
contractsRouter.get('/check-maverick', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { itemId, vendorId, proposedUnitPrice } = req.query

    if (!itemId || typeof itemId !== 'string') {
      res.status(400).json({ success: false, message: 'itemId is required' })
      return
    }

    const now = new Date()
    // Look for active rate contract for this item
    const contractItem = await prisma.rateContractItem.findFirst({
      where: {
        itemId,
        contract: {
          status: 'ACTIVE',
          endDate: { gte: now },
        },
      },
      include: {
        contract: {
          include: { vendor: true },
        },
        item: true,
      },
    })

    if (!contractItem) {
      res.json({
        success: true,
        hasContract: false,
        isMaverick: false,
        message: 'No active rate contract exists for this item. Off-contract procurement allowed.',
      })
      return
    }

    const contractedPrice = Number(contractItem.contractedPrice)
    const proposedPrice = proposedUnitPrice ? Number(proposedUnitPrice) : null
    const contractedVendorId = contractItem.contract.vendorId

    const isDifferentVendor = vendorId && vendorId !== contractedVendorId
    const isHigherPrice = proposedPrice !== null && proposedPrice > contractedPrice

    const isMaverick = Boolean(isDifferentVendor || isHigherPrice)

    res.json({
      success: true,
      hasContract: true,
      isMaverick,
      contractDetails: {
        contractNumber: contractItem.contract.contractNumber,
        contractTitle: contractItem.contract.title,
        contractedVendorId: contractItem.contract.vendorId,
        contractedVendorName: contractItem.contract.vendor.name,
        contractedPrice,
        itemName: contractItem.item.name,
        validUntil: contractItem.contract.endDate,
      },
      warningMessage: isMaverick
        ? `Maverick Spend Warning: An active Rate Contract (${contractItem.contract.contractNumber}) exists with ${contractItem.contract.vendor.name} at ₹${contractedPrice.toFixed(2)}. ${isDifferentVendor ? 'Purchasing from an off-contract vendor' : ''} ${isHigherPrice ? `at a higher rate (₹${proposedPrice})` : ''} violates company purchasing guidelines.`
        : null,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/rate-contracts (Create Rate Contract)
const createContractSchema = z.object({
  vendorId: z.string(),
  title: z.string().min(3),
  startDate: z.string(),
  endDate: z.string(),
  totalValue: z.number().positive(),
  terms: z.string().optional(),
  items: z.array(
    z.object({
      itemId: z.string(),
      contractedPrice: z.number().positive(),
      minQuantity: z.number().int().positive().default(1),
    })
  ).min(1),
})

contractsRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const validated = createContractSchema.parse(req.body)

    const count = await prisma.rateContract.count()
    const contractNumber = `RC-2026-${String(count + 1).padStart(4, '0')}`

    const contract = await prisma.rateContract.create({
      data: {
        contractNumber,
        vendorId: validated.vendorId,
        title: validated.title,
        startDate: new Date(validated.startDate),
        endDate: new Date(validated.endDate),
        totalValue: validated.totalValue,
        terms: validated.terms || 'Standard volume purchase terms',
        items: {
          create: validated.items.map((it) => ({
            itemId: it.itemId,
            contractedPrice: it.contractedPrice,
            minQuantity: it.minQuantity,
          })),
        },
      },
      include: { vendor: true, items: { include: { item: true } } },
    })

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'CREATE_RATE_CONTRACT',
        entity: 'RATE_CONTRACT',
        entityId: contract.id,
        details: `Established Rate Contract ${contractNumber} for ₹${validated.totalValue.toLocaleString('en-IN')} with vendor ${contract.vendor.name}`,
        ipAddress: req.ip || '127.0.0.1',
      },
    })

    res.status(201).json({
      success: true,
      message: `Rate Contract ${contractNumber} established successfully`,
      data: contract,
    })
  } catch (error) {
    next(error)
  }
})
