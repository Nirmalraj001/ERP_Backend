import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { PRPriority, PRStatus, Role } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const requisitionsRouter = Router()

// GET /api/v1/requisitions (List with filters)
requisitionsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, priority, search } = req.query

    const whereClause: any = {}
    if (status && status !== 'ALL') {
      whereClause.status = status as PRStatus
    }
    if (priority && priority !== 'ALL') {
      whereClause.priority = priority as PRPriority
    }
    if (search && typeof search === 'string') {
      whereClause.OR = [
        { prNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { department: { contains: search, mode: 'insensitive' } },
      ]
    }

    const requisitions = await prisma.purchaseRequisition.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        requester: { select: { id: true, fullName: true, department: true } },
        approvedBy: { select: { id: true, fullName: true } },
        costCenter: { select: { id: true, costCenterCode: true, name: true } },
        items: true,
      },
    })

    res.json({
      success: true,
      count: requisitions.length,
      data: requisitions,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/requisitions/:id
requisitionsRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const pr = await prisma.purchaseRequisition.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, fullName: true, email: true, department: true } },
        approvedBy: { select: { id: true, fullName: true, email: true } },
        costCenter: true,
        items: { include: { item: true } },
      },
    })

    if (!pr) {
      res.status(404).json({ success: false, message: 'Purchase Requisition not found' })
      return
    }

    res.json({ success: true, data: pr })
  } catch (error) {
    next(error)
  }
})

const createPRSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters'),
  department: z.string().min(2, 'Department is required'),
  costCenterId: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  notes: z.string().optional(),
  items: z.array(
    z.object({
      itemId: z.string().optional(),
      description: z.string().min(2, 'Description required'),
      quantity: z.number().int().positive('Quantity must be greater than 0'),
      estimatedUnitPrice: z.number().positive('Unit price must be positive'),
      uom: z.string().default('EA'),
      requiredByDate: z.string().optional(),
    })
  ).min(1, 'At least one line item is required'),
})

// POST /api/v1/requisitions (Create PR)
requisitionsRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const validated = createPRSchema.parse(req.body)
    const count = await prisma.purchaseRequisition.count()
    const prNumber = `PR-2026-${String(count + 101).padStart(5, '0')}`

    const totalEstimatedAmount = validated.items.reduce(
      (acc, item) => acc + item.quantity * item.estimatedUnitPrice,
      0
    )

    // Multi-step transaction: Create PR + Line Items + Approval Task
    const newPR = await prisma.$transaction(async (tx) => {
      const pr = await tx.purchaseRequisition.create({
        data: {
          prNumber,
          title: validated.title,
          department: validated.department,
          requesterId: req.user!.id,
          costCenterId: validated.costCenterId || null,
          priority: validated.priority as PRPriority,
          status: PRStatus.PENDING_APPROVAL,
          totalEstimatedAmount,
          notes: validated.notes || null,
          items: {
            create: validated.items.map((item) => ({
              itemId: item.itemId || null,
              description: item.description,
              quantity: item.quantity,
              estimatedUnitPrice: item.estimatedUnitPrice,
              estimatedTotalPrice: item.quantity * item.estimatedUnitPrice,
              uom: item.uom,
              requiredByDate: item.requiredByDate ? new Date(item.requiredByDate) : null,
            })),
          },
        },
        include: { items: true },
      })

      // Create workflow approval task
      await tx.approvalTask.create({
        data: {
          entityType: 'PURCHASE_REQUISITION',
          entityId: pr.id,
          title: `Requisition Approval: ${pr.prNumber} ($${totalEstimatedAmount.toLocaleString()})`,
          currentLevel: 1,
          requiredRole: Role.APPROVER,
          status: 'PENDING',
          comments: `Submitted by ${req.user!.fullName} (${req.user!.department})`,
        },
      })

      // Audit trail
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE_PR',
          entity: 'PURCHASE_REQUISITION',
          entityId: pr.id,
          details: `Created requisition ${pr.prNumber} with total value $${totalEstimatedAmount}`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })

      return pr
    })

    res.status(201).json({
      success: true,
      message: 'Purchase requisition submitted successfully for approval',
      data: newPR,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/requisitions/bulk-import (Excel Bulk Import)
requisitionsRouter.post('/bulk-import', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { requisitions } = req.body
    if (!Array.isArray(requisitions) || requisitions.length === 0) {
      res.status(400).json({ success: false, message: 'Array of requisitions is required' })
      return
    }

    const importedPRs: any[] = []
    let count = await prisma.purchaseRequisition.count()
    const firstCostCenter = await prisma.budgetControl.findFirst()

    for (const item of requisitions) {
      count++
      const prNumber = item.prNumber?.trim() || `PR-2026-${String(count + 100).padStart(5, '0')}`
      const qty = Number(item.quantity) || 10
      const price = Number(item.estimatedUnitPrice) || 100
      const totalEstimatedAmount = qty * price

      const priorityVal = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(item.priority?.toUpperCase())
        ? (item.priority.toUpperCase() as PRPriority)
        : PRPriority.MEDIUM

      const pr = await prisma.purchaseRequisition.upsert({
        where: { prNumber },
        update: {
          title: item.title || 'Procurement Requisition Package',
          department: item.department || 'Operations',
          totalEstimatedAmount,
          notes: item.purpose || item.notes || null,
        },
        create: {
          prNumber,
          title: item.title || 'Procurement Requisition Package',
          department: item.department || 'Operations',
          requesterId: req.user!.id,
          costCenterId: firstCostCenter?.id || null,
          priority: priorityVal,
          status: PRStatus.APPROVED,
          totalEstimatedAmount,
          notes: item.purpose || item.notes || null,
          items: {
            create: [
              {
                description: item.itemDescription || 'Industrial Requisition Item',
                quantity: qty,
                estimatedUnitPrice: price,
                estimatedTotalPrice: totalEstimatedAmount,
                uom: item.uom || 'EA',
                requiredByDate: item.requiredByDate ? new Date(item.requiredByDate) : new Date(Date.now() + 14 * 86400000),
              },
            ],
          },
        },
        include: { items: true, requester: true },
      })

      importedPRs.push(pr)
    }

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'BULK_IMPORT_REQUISITIONS',
          entity: 'PURCHASE_REQUISITION',
          details: `Imported ${importedPRs.length} purchase requisitions from Excel`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    }

    res.status(201).json({
      success: true,
      message: `Successfully imported ${importedPRs.length} requisitions`,
      count: importedPRs.length,
      data: importedPRs,
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/v1/requisitions/:id/status (Update PR status e.g. Approve, Reject, Submit)
requisitionsRouter.patch('/:id/status', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const { status, rejectionReason } = req.body

    const existing = await prisma.purchaseRequisition.findUnique({
      where: { id },
    })

    if (!existing) {
      res.status(404).json({ success: false, message: 'Requisition not found' })
      return
    }

    const updated = await prisma.purchaseRequisition.update({
      where: { id },
      data: {
        status: status as PRStatus,
        rejectionReason: rejectionReason || existing.rejectionReason,
        approvedAt: status === PRStatus.APPROVED ? new Date() : existing.approvedAt,
        approvedById: status === PRStatus.APPROVED ? req.user?.id : existing.approvedById,
      },
      include: {
        requester: { select: { id: true, fullName: true, department: true } },
        items: true,
      },
    })

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: `UPDATE_PR_STATUS_${status}`,
          entity: 'PURCHASE_REQUISITION',
          entityId: id,
          details: `Requisition ${existing.prNumber} status transitioned from ${existing.status} to ${status}`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    }

    res.json({ success: true, message: `Requisition status updated to ${status}`, data: updated })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/requisitions/:id/issue-rfq (Convert/Issue RFQ from Approved PR)
requisitionsRouter.post('/:id/issue-rfq', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const pr = await prisma.purchaseRequisition.findUnique({
      where: { id },
      include: { items: { include: { item: true } } },
    })

    if (!pr) {
      res.status(404).json({ success: false, message: 'Requisition not found' })
      return
    }

    const rfqCount = await prisma.rfq.count()
    const rfqNumber = `RFQ-2026-${String(rfqCount + 115).padStart(4, '0')}`

    const newRfq = await prisma.$transaction(async (tx) => {
      const createdRfq = await tx.rfq.create({
        data: {
          rfqNumber,
          title: `RFQ for PR ${pr.prNumber}: ${pr.title}`,
          prId: pr.id,
          status: 'ACTIVE',
          deadline: new Date(Date.now() + 7 * 86400000),
        },
      })

      await tx.purchaseRequisition.update({
        where: { id: pr.id },
        data: { status: PRStatus.INQUIRY_CREATED },
      })

      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'ISSUE_RFQ_FROM_PR',
          entity: 'PURCHASE_REQUISITION',
          entityId: pr.id,
          details: `Generated ${rfqNumber} from Requisition ${pr.prNumber}`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })

      return createdRfq
    })

    res.status(201).json({
      success: true,
      message: `RFQ ${rfqNumber} successfully issued for ${pr.prNumber}`,
      data: newRfq,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/requisitions/:id/convert-to-po (Convert PR directly to PO)
requisitionsRouter.post('/:id/convert-to-po', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const { vendorId, overrideReason } = req.body

    const pr = await prisma.purchaseRequisition.findUnique({
      where: { id },
      include: { items: { include: { item: true } } },
    })

    if (!pr) {
      res.status(404).json({ success: false, message: 'Requisition not found' })
      return
    }

    // Quality gate validation for target vendor
    let targetVendorId = vendorId
    if (!targetVendorId) {
      const topQualified = await prisma.vendor.findFirst({
        where: { isBlocked: false, qualificationStatus: 'QUALIFIED' },
      })
      if (!topQualified) {
        res.status(400).json({ success: false, message: 'No qualified vendor found. Please specify an audited vendor.' })
        return
      }
      targetVendorId = topQualified.id
    }

    const vendor = await prisma.vendor.findUnique({
      where: { id: targetVendorId },
    })

    if (!vendor) {
      res.status(404).json({ success: false, message: 'Vendor not found' })
      return
    }

    if (vendor.isBlocked && !overrideReason) {
      res.status(403).json({
        success: false,
        message: `Quality Gate Breach: Vendor ${vendor.name} is BLOCKED (${vendor.blockedReason || 'Audit restriction'}). PO creation blocked (§12).`,
      })
      return
    }

    if (vendor.qualificationStatus === 'CONDITIONAL' && !overrideReason) {
      res.status(403).json({
        success: false,
        message: `Quality Gate Breach: Vendor ${vendor.name} has open Non-Conformances. PO creation blocked until CAPA is verified (§12).`,
      })
      return
    }

    const poCount = await prisma.purchaseOrder.count()
    const poNumber = `PO-2026-${String(poCount + 1).padStart(5, '0')}`

    const subtotal = Number(pr.totalEstimatedAmount)
    const taxAmount = Math.round(subtotal * 0.18)
    const totalAmount = subtotal + taxAmount

    const prItems = (pr as any).items || []

    const newPO = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          vendorId: targetVendorId,
          createdById: req.user!.id,
          prId: pr.id,
          subtotal,
          taxAmount,
          totalAmount,
          paymentTerms: vendor.creditTerms || 'Net 30',
          expectedDeliveryDate: new Date(Date.now() + 14 * 86400000),
          status: 'APPROVED',
          items: {
            create: prItems.map((it: any) => ({
              itemId: it.itemId || null,
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.estimatedUnitPrice,
              totalPrice: it.estimatedTotalPrice,
              uom: it.uom,
            })),
          },
        },
      })

      await tx.purchaseRequisition.update({
        where: { id: pr.id },
        data: { status: PRStatus.PO_CREATED },
      })

      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CONVERT_PR_TO_PO',
          entity: 'PURCHASE_REQUISITION',
          entityId: pr.id,
          details: `Directly converted ${pr.prNumber} to Purchase Order ${poNumber} for vendor ${vendor.name}`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })

      return po
    })

    res.status(201).json({
      success: true,
      message: `Purchase Order ${poNumber} generated successfully from ${pr.prNumber}`,
      data: newPO,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/requisitions/:id/suggested-sources (Suggested sources: active rate contracts + top-scoring vendors §7)
requisitionsRouter.get('/:id/suggested-sources', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const pr = await prisma.purchaseRequisition.findUnique({
      where: { id },
      include: { items: { include: { item: true } } },
    })

    if (!pr) {
      res.status(404).json({ success: false, message: 'Requisition not found' })
      return
    }

    const prItems = (pr as any).items || []
    const itemIds = prItems.map((i: any) => i.itemId).filter(Boolean) as string[]

    const rateContracts = await prisma.rateContract.findMany({
      where: {
        status: 'ACTIVE',
        endDate: { gte: new Date() },
        ...(itemIds.length > 0 ? { items: { some: { itemId: { in: itemIds } } } } : {}),
      },
      include: { vendor: true, items: { include: { item: true } } },
    })

    const qualifiedVendors = await prisma.vendor.findMany({
      where: { isBlocked: false, qualificationStatus: 'QUALIFIED' },
      take: 4,
      orderBy: { rating: 'desc' },
    })

    res.json({
      success: true,
      data: {
        rateContracts,
        qualifiedVendors,
      },
    })
  } catch (error) {
    next(error)
  }
})



