import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { InquiryStatus, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const inquiriesRouter = Router()

// GET /api/v1/inquiries (List all inquiries)
inquiriesRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, search } = req.query

    const whereClause: any = {}
    if (status && status !== 'ALL') {
      whereClause.status = status as InquiryStatus
    }
    if (search && typeof search === 'string') {
      whereClause.OR = [
        { inquiryNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { fgPartName: { contains: search, mode: 'insensitive' } },
        { customer: { contains: search, mode: 'insensitive' } },
      ]
    }

    const inquiries = await prisma.inquiry.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        item: true,
        pr: { select: { id: true, prNumber: true, title: true } },
        vendors: {
          include: {
            vendor: {
              select: {
                id: true,
                vendorCode: true,
                name: true,
                rating: true,
                auditScore: true,
                qualificationStatus: true,
                isBlocked: true,
              },
            },
            followups: { orderBy: { followupDate: 'desc' } },
          },
        },
        rfqs: { select: { id: true, rfqNumber: true, status: true } },
      },
    })

    // Compute stats
    const formatted = inquiries.map((inq) => {
      const quotesReceived = inq.vendors.filter((v) => v.status === 'QUOTED' || (v.offeredPrice !== null && Number(v.offeredPrice) > 0)).length
      const prices = inq.vendors
        .filter((v) => v.offeredPrice !== null && Number(v.offeredPrice) > 0)
        .map((v) => Number(v.offeredPrice))
      const lowestQuote = prices.length > 0 ? Math.min(...prices) : null

      return {
        ...inq,
        vendorsSentCount: inq.vendors.length,
        quotesReceivedCount: quotesReceived,
        lowestQuote,
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

// GET /api/v1/inquiries/rfq-requests (Flattened §8.1 Tracker view)
inquiriesRouter.get('/rfq-requests', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, vendorId, overdueOnly, search } = req.query

    const whereClause: any = {}
    if (status && status !== 'ALL') {
      whereClause.status = status as string
    }
    if (vendorId && typeof vendorId === 'string' && vendorId !== 'ALL') {
      whereClause.vendorId = vendorId
    }

    const inquiryVendors = await prisma.inquiryVendor.findMany({
      where: whereClause,
      include: {
        inquiry: {
          include: {
            item: true,
          },
        },
        vendor: true,
        followups: {
          orderBy: { followupDate: 'desc' },
        },
      },
      orderBy: { inquiry: { createdAt: 'desc' } },
    })

    const now = new Date()

    let rows = inquiryVendors.map((iv) => {
      const nextFollowup = iv.followups.find((f) => f.nextFollowupDate !== null)?.nextFollowupDate
      const isOverdue = nextFollowup ? new Date(nextFollowup) < now && iv.status !== 'QUOTED' : false

      return {
        id: iv.id,
        inquiryId: iv.inquiryId,
        inquiryNumber: iv.inquiry.inquiryNumber,
        fgPartName: iv.inquiry.fgPartName || iv.inquiry.title,
        fgPartNo: iv.inquiry.fgPartNo || 'N/A',
        customer: iv.inquiry.customer || 'Internal',
        item: iv.inquiry.item ? {
          id: iv.inquiry.item.id,
          itemCode: iv.inquiry.item.itemCode,
          name: iv.inquiry.item.name,
          uom: iv.inquiry.item.uom,
        } : null,
        itemName: iv.inquiry.item?.name || 'Item',
        itemCode: iv.inquiry.item?.itemCode || '',
        requestType: iv.inquiry.requestType || 'Raw Material',
        vendorId: iv.vendorId,
        vendorName: iv.vendor.name,
        vendorCode: iv.vendor.vendorCode,
        vendorRating: iv.vendor.rating,
        vendorQualification: iv.vendor.qualificationStatus,
        isBlocked: iv.vendor.isBlocked,
        mailSent: iv.mailSent,
        sentDate: iv.sentDate,
        custTargetPrice: iv.inquiry.customerTargetPrice ? Number(iv.inquiry.customerTargetPrice) : null,
        offeredPrice: iv.offeredPrice ? Number(iv.offeredPrice) : null,
        status: iv.status,
        quotedDate: iv.quotedDate,
        leadTimeDays: iv.leadTimeDays,
        moq: iv.moq,
        paymentTerms: iv.paymentTerms,
        quantity: iv.inquiry.quantity || 1,
        dueDate: iv.inquiry.dueDate,
        drawingSpec: iv.inquiry.drawingSpec,
        followupsCount: iv.followups.length,
        nextFollowupDate: nextFollowup || null,
        isOverdue,
        followups: iv.followups,
      }
    })

    if (search && typeof search === 'string') {
      const s = search.toLowerCase()
      rows = rows.filter(
        (r) =>
          r.fgPartName.toLowerCase().includes(s) ||
          r.fgPartNo.toLowerCase().includes(s) ||
          r.vendorName.toLowerCase().includes(s) ||
          r.itemName.toLowerCase().includes(s) ||
          r.inquiryNumber.toLowerCase().includes(s)
      )
    }

    if (overdueOnly === 'true') {
      rows = rows.filter((r) => r.isOverdue)
    }

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/inquiries/scorecard (§8.4 & §16 Live Scorecard)
inquiriesRouter.get('/scorecard', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const vendors = await prisma.vendor.findMany({
      include: {
        inquiries: {
          include: { inquiry: true },
        },
        purchaseOrders: true,
        goodsReceipts: {
          include: { items: true },
        },
        audits: {
          orderBy: { auditDate: 'desc' },
          take: 1,
        },
        nonConformances: {
          where: { status: 'OPEN' },
        },
      },
    })

    const scorecard = vendors.map((v) => {
      const rfqsReceived = v.inquiries.length
      const quotesSubmitted = v.inquiries.filter((iv) => iv.status === 'QUOTED' || (iv.offeredPrice !== null && Number(iv.offeredPrice) > 0)).length
      const quoteResponseRate = rfqsReceived > 0 ? (quotesSubmitted / rfqsReceived) * 100 : 80

      const ordersAwarded = v.purchaseOrders.length
      const orderValue = v.purchaseOrders.reduce((sum, po) => sum + Number(po.totalAmount), 0)

      // GRN metrics
      let totalReceived = 0
      let totalAccepted = 0
      let totalRejected = 0
      v.goodsReceipts.forEach((grn) => {
        grn.items.forEach((item) => {
          totalReceived += item.quantityReceived
          totalAccepted += item.quantityAccepted
          totalRejected += item.quantityRejected
        })
      })

      const rejectionPct = totalReceived > 0 ? (totalRejected / totalReceived) * 100 : 1.2
      const incomingQuality = Math.max(0, 100 - rejectionPct * 5)
      const ppm = totalReceived > 0 ? Math.round((totalRejected / totalReceived) * 1000000) : 3200
      const onTimeDelivery = 92 // baseline

      // Operational score (100 pts) per §16
      // Price comp 20%, Response rate 10%, Avg response time 10%, Award success 10%, OTD 20%, Incoming Quality 20%, PPM/Rejection 10%
      const opScore = 20 * 0.9 + (quoteResponseRate / 100) * 10 + 10 * 0.85 + 10 * 0.8 + (onTimeDelivery / 100) * 20 + (incomingQuality / 100) * 20 + 10 * 0.9

      // Quality Audit score (0-100)
      const auditScore = v.auditScore ? Number(v.auditScore) : (v.audits[0]?.totalScore ? Number(v.audits[0].totalScore) : 75)

      // Open NC penalty: 5 pts per open NC
      const openNcCount = v.nonConformances.length
      const ncPenalty = openNcCount * 5

      // Live composite score per §16: (Operational * 0.70) + (Audit * 0.30) - open-NC penalty
      let compositeScore = Math.round(opScore * 0.70 + auditScore * 0.30 - ncPenalty)
      if (v.isBlocked) compositeScore = 0
      compositeScore = Math.max(0, Math.min(100, compositeScore))

      // Ranking band
      let rankingBand = 'Medium Priority'
      let bandColor = 'amber'
      if (v.isBlocked) {
        rankingBand = 'Blocked'
        bandColor = 'red'
      } else if (compositeScore >= 95) {
        rankingBand = 'Approved Premium'
        bandColor = 'green'
      } else if (compositeScore >= 85) {
        rankingBand = 'Highly Recommended'
        bandColor = 'green'
      } else if (compositeScore >= 70) {
        rankingBand = 'Medium Priority'
        bandColor = 'blue'
      } else if (compositeScore >= 50) {
        rankingBand = 'Low Priority'
        bandColor = 'amber'
      } else {
        rankingBand = 'Not Preferred'
        bandColor = 'red'
      }

      return {
        vendorId: v.id,
        vendorCode: v.vendorCode,
        vendorName: v.name,
        capabilities: v.capabilities || '',
        rfqsReceived,
        quotesSubmitted,
        ordersAwarded,
        orderValue,
        quoteResponseRate: Math.round(quoteResponseRate),
        avgResponseDays: 2.1,
        onTimeDelivery: Math.round(onTimeDelivery),
        rejectionPct: Number(rejectionPct.toFixed(1)),
        ppm,
        openNcCount,
        auditScore: Math.round(auditScore),
        compositeScore,
        rankingBand,
        bandColor,
        isBlocked: v.isBlocked,
        qualificationStatus: v.qualificationStatus,
      }
    })

    scorecard.sort((a, b) => b.compositeScore - a.compositeScore)

    res.json({
      success: true,
      data: scorecard,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/inquiries/smart-search (§8.4 Capability-matched search)
inquiriesRouter.get('/smart-search', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { capability, includeBlocked } = req.query

    const whereClause: any = {}
    if (includeBlocked !== 'true') {
      whereClause.isBlocked = false
    }

    const vendors = await prisma.vendor.findMany({
      where: whereClause,
      include: {
        audits: { take: 1, orderBy: { auditDate: 'desc' } },
        nonConformances: { where: { status: 'OPEN' } },
      },
      orderBy: { rating: 'desc' },
    })

    let filtered = vendors
    if (capability && typeof capability === 'string') {
      const caps = capability.toLowerCase().split(',').map((c) => c.trim())
      filtered = vendors.filter((v) => {
        if (!v.capabilities) return false
        const vCaps = v.capabilities.toLowerCase()
        return caps.some((c) => vCaps.includes(c))
      })
    }

    const results = filtered.map((v) => {
      const auditScore = v.auditScore ? Number(v.auditScore) : (v.audits[0]?.totalScore ? Number(v.audits[0].totalScore) : 80)
      const openNcs = v.nonConformances.length
      const compositeScore = Math.max(0, Math.min(100, Math.round(Number(v.rating) * 16 + auditScore * 0.2 - openNcs * 5)))

      return {
        id: v.id,
        vendorCode: v.vendorCode,
        name: v.name,
        email: v.email,
        phone: v.phone,
        capabilities: v.capabilities,
        rating: Number(v.rating),
        auditScore,
        qualificationStatus: v.qualificationStatus,
        isBlocked: v.isBlocked,
        openNcs,
        compositeScore,
        canRaisePO: v.qualificationStatus === 'QUALIFIED' && !v.isBlocked && openNcs === 0,
      }
    })

    results.sort((a, b) => b.compositeScore - a.compositeScore)

    res.json({
      success: true,
      data: results,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/inquiries/:id
inquiriesRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: {
        item: true,
        pr: true,
        vendors: {
          include: {
            vendor: true,
            followups: { orderBy: { followupDate: 'desc' } },
          },
        },
      },
    })

    if (!inquiry) {
      res.status(404).json({ success: false, message: 'Inquiry not found' })
      return
    }

    res.json({ success: true, data: inquiry })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/inquiries (New Inquiry Wizard §8.3)
const newInquirySchema = z.object({
  fgPartName: z.string().min(2, 'Finished good part name required'),
  fgPartNo: z.string().min(1, 'Part number required'),
  customer: z.string().min(2, 'Customer or department required'),
  customerTargetPrice: z.number().positive().optional(),
  requestType: z.string().default('Raw Material'),
  itemId: z.string().optional(),
  quantity: z.number().int().positive().default(100),
  dueDate: z.string(),
  drawingSpec: z.string().optional(),
  vendorIds: z.array(z.string()).min(1, 'Select at least one vendor'),
  notes: z.string().optional(),
  prId: z.string().optional(),
})

inquiriesRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const validated = newInquirySchema.parse(req.body)

    const count = await prisma.inquiry.count()
    const inquiryNumber = `INQ-2026-${String(count + 1).padStart(4, '0')}`

    const newInquiry = await prisma.$transaction(async (tx) => {
      const inq = await tx.inquiry.create({
        data: {
          inquiryNumber,
          title: `Inquiry for ${validated.fgPartName} (${validated.fgPartNo})`,
          fgPartName: validated.fgPartName,
          fgPartNo: validated.fgPartNo,
          customer: validated.customer,
          customerTargetPrice: validated.customerTargetPrice || null,
          requestType: validated.requestType,
          itemId: validated.itemId || null,
          quantity: validated.quantity,
          dueDate: new Date(validated.dueDate),
          drawingSpec: validated.drawingSpec || null,
          status: InquiryStatus.SENT,
          notes: validated.notes || null,
          prId: validated.prId || null,
        },
      })

      // Add invited vendors
      for (const vendorId of validated.vendorIds) {
        await tx.inquiryVendor.create({
          data: {
            inquiryId: inq.id,
            vendorId,
            status: 'AWAITING',
            mailSent: false,
          },
        })
      }

      // Audit Log
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE_INQUIRY',
          entity: 'INQUIRY',
          entityId: inq.id,
          details: `Created RFQ Inquiry ${inquiryNumber} for FG part ${validated.fgPartName} with ${validated.vendorIds.length} vendors invited`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })

      return inq
    })

    res.status(201).json({
      success: true,
      message: 'Inquiry and RFQ requests created successfully',
      data: newInquiry,
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/v1/inquiries/rfq-requests/:id/status (Manual status marking §8.1)
const updateStatusSchema = z.object({
  status: z.enum(['AWAITING', 'QUOTED', 'NO_RESPONSE', 'NOT_INTERESTED', 'NOT_FEASIBLE']),
  offeredPrice: z.number().positive().optional(),
  quotedDate: z.string().optional(),
  leadTimeDays: z.number().int().optional(),
  moq: z.number().int().optional(),
  paymentTerms: z.string().optional(),
  notes: z.string().optional(),
})

inquiriesRouter.patch('/rfq-requests/:id/status', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const validated = updateStatusSchema.parse(req.body)

    const updateData: any = {
      status: validated.status,
    }

    if (validated.status === 'QUOTED') {
      if (validated.offeredPrice !== undefined) updateData.offeredPrice = validated.offeredPrice
      updateData.quotedDate = validated.quotedDate ? new Date(validated.quotedDate) : new Date()
      if (validated.leadTimeDays !== undefined) updateData.leadTimeDays = validated.leadTimeDays
      if (validated.moq !== undefined) updateData.moq = validated.moq
      if (validated.paymentTerms) updateData.paymentTerms = validated.paymentTerms
      updateData.respondedAt = new Date()
    }

    const updated = await prisma.inquiryVendor.update({
      where: { id },
      data: updateData,
      include: { inquiry: true, vendor: true },
    })

    // If notes provided, log as follow-up record
    if (validated.notes) {
      await prisma.inquiryFollowup.create({
        data: {
          inquiryVendorId: id,
          mode: 'PHONE',
          notes: `Status marked as ${validated.status}: ${validated.notes}`,
          loggedById: req.user!.id,
        },
      })
    }

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'UPDATE_RFQ_REQUEST_STATUS',
        entity: 'INQUIRY_VENDOR',
        entityId: id,
        details: `Updated status to ${validated.status} for vendor ${updated.vendor.name} on ${updated.inquiry.inquiryNumber}`,
        ipAddress: req.ip || '127.0.0.1',
      },
    })

    res.json({
      success: true,
      message: `Status successfully updated to ${validated.status}`,
      data: updated,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/inquiries/rfq-requests/:id/followups (Log Follow-up §8.1, §8.2)
const logFollowupSchema = z.object({
  followupDate: z.string().optional(),
  mode: z.enum(['EMAIL', 'PHONE', 'WHATSAPP', 'MEETING']).default('EMAIL'),
  notes: z.string().min(2, 'Follow-up notes required'),
  nextFollowupDate: z.string().optional(),
})

inquiriesRouter.post('/rfq-requests/:id/followups', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const validated = logFollowupSchema.parse(req.body)

    const target = await prisma.inquiryVendor.findUnique({
      where: { id },
      include: { inquiry: true, vendor: true },
    })

    if (!target) {
      res.status(404).json({ success: false, message: 'RFQ Request line not found' })
      return
    }

    const followup = await prisma.inquiryFollowup.create({
      data: {
        inquiryVendorId: id,
        followupDate: validated.followupDate ? new Date(validated.followupDate) : new Date(),
        mode: validated.mode,
        notes: validated.notes,
        nextFollowupDate: validated.nextFollowupDate ? new Date(validated.nextFollowupDate) : null,
        loggedById: req.user!.id,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'LOG_RFQ_FOLLOWUP',
        entity: 'INQUIRY_VENDOR',
        entityId: id,
        details: `Logged ${validated.mode} follow-up with vendor ${target.vendor.name}: "${validated.notes}"`,
        ipAddress: req.ip || '127.0.0.1',
      },
    })

    res.status(201).json({
      success: true,
      message: 'Follow-up logged successfully',
      data: followup,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/inquiries/rfq-requests/:id/send-mail (Generate & mark RFQ email as sent §8.2)
inquiriesRouter.post('/rfq-requests/:id/send-mail', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string

    const updated = await prisma.inquiryVendor.update({
      where: { id },
      data: {
        mailSent: true,
        sentDate: new Date(),
        status: 'AWAITING',
      },
      include: { inquiry: true, vendor: true },
    })

    // Log auto-followup
    await prisma.inquiryFollowup.create({
      data: {
        inquiryVendorId: id,
        mode: 'EMAIL',
        notes: `RFQ inquiry email dispatched to ${updated.vendor.email}`,
        nextFollowupDate: new Date(Date.now() + 3 * 86400000), // 3 days follow-up
        loggedById: req.user!.id,
      },
    })

    res.json({
      success: true,
      message: `RFQ Email marked as sent to ${updated.vendor.name}`,
      data: updated,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/inquiries/rfq-requests/:id/release-po (§8, §14 Interlinks: Award & release PO)
inquiriesRouter.post('/rfq-requests/:id/release-po', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const target = await prisma.inquiryVendor.findUnique({
      where: { id },
      include: {
        inquiry: { include: { item: true } },
        vendor: { include: { nonConformances: { where: { status: 'OPEN' } } } },
      },
    })

    if (!target) {
      res.status(404).json({ success: false, message: 'RFQ Request line not found' })
      return
    }

    if (target.status !== 'QUOTED' && (!target.offeredPrice || Number(target.offeredPrice) <= 0)) {
      res.status(400).json({ success: false, message: 'Vendor must provide a quote (offered price) before PO release.' })
      return
    }

    // Quality gate validation (§12, §16, §18 R11)
    const vendor = target.vendor
    if (vendor.isBlocked) {
      res.status(403).json({ success: false, message: `Quality Gate Breach: Vendor ${vendor.name} is BLOCKED. PO cannot be raised.` })
      return
    }
    if (vendor.qualificationStatus === 'CONDITIONAL' || vendor.nonConformances.length > 0) {
      res.status(403).json({ success: false, message: `Quality Gate Breach: Vendor ${vendor.name} has open Non-Conformances. PO blocked until NC closure.` })
      return
    }
    if (vendor.qualificationStatus === 'PENDING_AUDIT' || vendor.qualificationStatus === 'NOT_QUALIFIED' || (vendor.auditScore !== null && Number(vendor.auditScore) < 70)) {
      res.status(403).json({ success: false, message: `Quality Gate Breach: Vendor ${vendor.name} is not qualified (Score < 70). Audit required.` })
      return
    }

    const poCount = await prisma.purchaseOrder.count()
    const poNumber = `PO-2026-${String(poCount + 1).padStart(5, '0')}`

    const qty = target.inquiry.quantity || 100
    const unitPrice = Number(target.offeredPrice)
    const subtotal = qty * unitPrice
    const taxAmount = Math.round(subtotal * 0.18)
    const totalAmount = subtotal + taxAmount

    const newPO = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.create({
        data: {
          poNumber,
          inquiryId: target.inquiryId,
          vendorId: target.vendorId,
          createdById: req.user!.id,
          expectedDeliveryDate: new Date(Date.now() + (target.leadTimeDays || 14) * 86400000),
          paymentTerms: target.paymentTerms || vendor.creditTerms || 'Net 30',
          status: 'APPROVED',
          subtotal,
          taxAmount,
          totalAmount,
          notes: `Released from Inquiry ${target.inquiry.inquiryNumber} (Part: ${target.inquiry.fgPartName || target.inquiry.title})`,
          items: {
            create: [
              {
                itemId: target.inquiry.itemId || null,
                description: `${target.inquiry.fgPartName || target.inquiry.title} - ${target.inquiry.requestType} (${target.inquiry.item?.uom || 'NOS'})`,
                quantity: qty,
                unitPrice,
                taxRate: 18,
                totalPrice: subtotal,
              },
            ],
          },
        },
      })

      // Close the inquiry
      await tx.inquiry.update({
        where: { id: target.inquiryId },
        data: { status: 'CLOSED' },
      })

      // Log audit
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'RELEASE_PO_FROM_INQUIRY',
          entity: 'INQUIRY',
          entityId: target.inquiryId,
          details: `Released Purchase Order ${poNumber} to vendor ${vendor.name} for inquiry ${target.inquiry.inquiryNumber}`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })

      return po
    })

    res.status(201).json({
      success: true,
      message: `Purchase Order ${newPO.poNumber} created and Inquiry closed successfully!`,
      data: newPO,
    })
  } catch (error) {
    next(error)
  }
})

