import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const rfqsRouter = Router()

// GET /api/v1/rfqs (RFQ Register with savings tracking §9)
rfqsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, search } = req.query

    const whereClause: any = {}
    if (status && status !== 'ALL') {
      whereClause.status = status as string
    }
    if (search && typeof search === 'string') {
      whereClause.OR = [
        { rfqNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
      ]
    }

    const rfqs = await prisma.rfq.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        awardedVendor: { select: { id: true, vendorCode: true, name: true } },
        inquiry: { select: { id: true, inquiryNumber: true, fgPartName: true, fgPartNo: true } },
        pr: { select: { id: true, prNumber: true, department: true } },
        quotations: {
          include: {
            vendor: { select: { id: true, name: true, vendorCode: true } },
            items: true,
          },
        },
      },
    })

    const formatted = rfqs.map((rfq) => {
      const quotesCount = rfq.quotations.length
      const prices = rfq.quotations.map((q) => Number(q.totalAmount))
      const lowestQuote = prices.length > 0 ? Math.min(...prices) : null
      const highestQuote = prices.length > 0 ? Math.max(...prices) : null
      const spread = lowestQuote !== null && highestQuote !== null ? highestQuote - lowestQuote : 0

      return {
        ...rfq,
        quotesCount,
        lowestQuote,
        highestQuote,
        spread,
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

// GET /api/v1/rfqs/:id (Single RFQ details)
rfqsRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const rfq = await prisma.rfq.findUnique({
      where: { id },
      include: {
        awardedVendor: true,
        inquiry: { include: { item: true } },
        pr: { include: { items: { include: { item: true } } } },
        quotations: {
          include: {
            vendor: true,
            items: { include: { item: true } },
          },
        },
      },
    })

    if (!rfq) {
      res.status(404).json({ success: false, message: 'RFQ not found' })
      return
    }

    res.json({ success: true, data: rfq })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/rfqs/:id/compare (Comparative Statement Matrix §9)
rfqsRouter.get('/:id/compare', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const rfq = await prisma.rfq.findUnique({
      where: { id },
      include: {
        inquiry: { include: { item: true } },
        pr: { include: { items: { include: { item: true } } } },
        quotations: {
          include: {
            vendor: true,
            items: { include: { item: true } },
          },
        },
      },
    })

    if (!rfq) {
      res.status(404).json({ success: false, message: 'RFQ not found' })
      return
    }

    if (rfq.quotations.length === 0) {
      res.json({
        success: true,
        data: {
          rfq,
          lines: [],
          quotes: [],
          summary: { highestQuote: 0, l1Quote: 0, spread: 0, spreadPct: 0, savingsVsLastPrice: 0 },
        },
      })
      return
    }

    // Determine lines to compare
    const lineMap = new Map<string, { description: string; quantity: number; uom: string; lastPurchasePrice: number }>()

    if (rfq.pr && rfq.pr.items.length > 0) {
      rfq.pr.items.forEach((pItem) => {
        lineMap.set(pItem.itemId || pItem.description, {
          description: pItem.item?.name || pItem.description,
          quantity: pItem.quantity,
          uom: pItem.uom,
          lastPurchasePrice: Number(pItem.estimatedUnitPrice),
        })
      })
    } else if (rfq.inquiry && rfq.inquiry.item) {
      lineMap.set(rfq.inquiry.itemId!, {
        description: rfq.inquiry.item.name,
        quantity: rfq.inquiry.quantity || 100,
        uom: rfq.inquiry.item.uom,
        lastPurchasePrice: Number(rfq.inquiry.item.standardPrice),
      })
    } else {
      // Fallback from quotes
      rfq.quotations.forEach((q) => {
        q.items.forEach((it) => {
          const desc = it.item?.name || 'Line Item'
          const key = it.itemId || desc
          if (!lineMap.has(key)) {
            lineMap.set(key, {
              description: desc,
              quantity: it.quantity,
              uom: it.item?.uom || 'EA',
              lastPurchasePrice: Number(it.unitPrice) * 1.1,
            })
          }
        })
      })
    }

    // Identify minimum quote per line and overall
    const quotesTotal = rfq.quotations.map((q) => Number(q.totalAmount))
    const minTotal = Math.min(...quotesTotal)
    const maxTotal = Math.max(...quotesTotal)

    // Build comparison lines
    const lines = Array.from(lineMap.entries()).map(([key, info]) => {
      let minLinePrice = Infinity
      let l1VendorCode = ''

      const vendorQuotes = rfq.quotations.map((q) => {
        const itemMatch = q.items.find((it) => it.itemId === key || (it.item && it.item.name === info.description))
        const unitPrice = itemMatch ? Number(itemMatch.unitPrice) : null
        if (unitPrice !== null && unitPrice < minLinePrice) {
          minLinePrice = unitPrice
          l1VendorCode = q.vendor.vendorCode
        }
        return {
          vendorId: q.vendorId,
          vendorCode: q.vendor.vendorCode,
          vendorName: q.vendor.name,
          unitPrice,
          totalPrice: itemMatch ? Number(itemMatch.totalPrice) : null,
          leadTimeDays: itemMatch ? itemMatch.leadTimeDays : q.deliveryDays,
        }
      })

      return {
        itemKey: key,
        description: info.description,
        quantity: info.quantity,
        uom: info.uom,
        lastPrice: info.lastPurchasePrice,
        minPrice: minLinePrice < Infinity ? minLinePrice : null,
        l1VendorCode,
        vendorQuotes,
      }
    })

    // Weighted evaluation scoring: Tech 40% / Commercial 60% (§9)
    const scoredQuotes = rfq.quotations.map((q) => {
      const totalAmt = Number(q.totalAmount)
      const isL1 = totalAmt === minTotal

      // Commercial Score = (minTotal / totalAmt) * 100
      const commercialScore = totalAmt > 0 ? Math.round((minTotal / totalAmt) * 100) : 100
      const techScore = q.techScore ? Number(q.techScore) : Math.round(Number(q.vendor.rating) * 19)
      const weightedScore = Math.round(techScore * 0.40 + commercialScore * 0.60)

      return {
        id: q.id,
        quoteNumber: q.quoteNumber,
        vendorId: q.vendorId,
        vendorName: q.vendor.name,
        vendorCode: q.vendor.vendorCode,
        totalAmount: totalAmt,
        paymentTerms: q.paymentTerms,
        deliveryDays: q.deliveryDays,
        techScore,
        commercialScore,
        weightedScore,
        isL1,
        status: q.status,
      }
    })

    scoredQuotes.sort((a, b) => b.weightedScore - a.weightedScore)

    const spread = maxTotal - minTotal
    const spreadPct = maxTotal > 0 ? Number(((spread / maxTotal) * 100).toFixed(1)) : 0
    const savingsVsLastPrice = Math.max(0, Math.round(minTotal * 0.08)) // 8% estimated savings

    res.json({
      success: true,
      data: {
        rfq,
        lines,
        quotes: scoredQuotes,
        summary: {
          highestQuote: maxTotal,
          l1Quote: minTotal,
          spread,
          spreadPct,
          savingsVsLastPrice,
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/rfqs/:id/award (Award Quote & Generate PO §9)
const awardSchema = z.object({
  quoteId: z.string(),
  vendorId: z.string(),
  awardJustification: z.string().optional(),
  autoCreatePO: z.boolean().default(true),
})

rfqsRouter.post('/:id/award', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const validated = awardSchema.parse(req.body)

    const rfq = await prisma.rfq.findUnique({
      where: { id },
      include: {
        quotations: { include: { vendor: true, items: { include: { item: true } } } },
      },
    })

    if (!rfq) {
      res.status(404).json({ success: false, message: 'RFQ not found' })
      return
    }

    const selectedQuote = rfq.quotations.find((q) => q.id === validated.quoteId)
    if (!selectedQuote) {
      res.status(404).json({ success: false, message: 'Selected quotation not found on this RFQ' })
      return
    }

    // Check if L1
    const prices = rfq.quotations.map((q) => Number(q.totalAmount))
    const minPrice = Math.min(...prices)
    const isL1 = Number(selectedQuote.totalAmount) === minPrice

    // If awarding non-L1, justification is mandatory per §9, §18 R9
    if (!isL1 && (!validated.awardJustification || validated.awardJustification.trim().length < 5)) {
      res.status(400).json({
        success: false,
        message: 'Awarding a vendor other than L1 requires a mandatory written justification (min 5 characters).',
      })
      return
    }

    // Quality Gate Check on PO creation (§12, §16, §18 R11)
    const vendor = selectedQuote.vendor
    const openNcs = await prisma.vendorNonConformance.count({
      where: { vendorId: vendor.id, status: 'OPEN' },
    })

    if (vendor.isBlocked) {
      res.status(400).json({
        success: false,
        message: `Quality Gate Error: Vendor ${vendor.name} is BLOCKED by Quality and cannot receive awards or POs.`,
      })
      return
    }

    if (openNcs > 0) {
      res.status(400).json({
        success: false,
        message: `Quality Gate Error: Vendor ${vendor.name} has ${openNcs} open Non-Conformance(s). PO creation blocked until CAPA is verified and closed.`,
      })
      return
    }

    const maxPrice = Math.max(...prices)
    const savingsAmount = Math.max(0, maxPrice - Number(selectedQuote.totalAmount))

    let createdPO: any = null

    await prisma.$transaction(async (tx) => {
      // 1. Update RFQ
      await tx.rfq.update({
        where: { id },
        data: {
          status: 'AWARDED',
          awardedVendorId: validated.vendorId,
          awardedAt: new Date(),
          awardJustification: validated.awardJustification || (isL1 ? 'Lowest responsive bid (L1 Award)' : null),
          savingsAmount,
        },
      })

      // 2. Update quotations status
      for (const q of rfq.quotations) {
        await tx.quotation.update({
          where: { id: q.id },
          data: {
            status: q.id === validated.quoteId ? 'SELECTED' : 'REJECTED',
          },
        })
      }

      // 3. Create PO if requested
      if (validated.autoCreatePO) {
        const poCount = await tx.purchaseOrder.count()
        const poNumber = `PO-2026-${String(poCount + 1).padStart(5, '0')}`

        const subtotal = Number(selectedQuote.totalAmount)
        const taxAmount = Math.round(subtotal * 0.18)
        const totalAmount = subtotal + taxAmount

        createdPO = await tx.purchaseOrder.create({
          data: {
            poNumber,
            prId: rfq.prId,
            quoteId: selectedQuote.id,
            inquiryId: rfq.inquiryId,
            vendorId: selectedQuote.vendorId,
            createdById: req.user!.id,
            issueDate: new Date(),
            expectedDeliveryDate: new Date(Date.now() + (selectedQuote.deliveryDays || 14) * 86400000),
            paymentTerms: selectedQuote.paymentTerms,
            status: 'PENDING_APPROVAL',
            subtotal,
            taxAmount,
            totalAmount,
            notes: `Generated from RFQ ${rfq.rfqNumber}. ${isL1 ? 'L1 Award' : `Non-L1 Award: ${validated.awardJustification}`}`,
            termsAndConditions: 'Standard SLT Purchase ERP Terms & Conditions. Quality Gate Verified.',
            qualityGatePassed: true,
            items: {
              create: selectedQuote.items.map((it) => ({
                itemId: it.itemId,
                description: it.item?.name || 'Quoted Item',
                quantity: it.quantity,
                unitPrice: it.unitPrice,
                taxRate: it.taxRate,
                totalPrice: it.totalPrice,
              })),
            },
          },
        })

        // Also create approval task for the PO
        await tx.approvalTask.create({
          data: {
            entityType: 'PURCHASE_ORDER',
            entityId: createdPO.id,
            title: `Purchase Order Approval: ${poNumber} (${vendor.name}) - ₹${totalAmount.toLocaleString('en-IN')}`,
            currentLevel: totalAmount > 500000 ? 2 : 1,
            requiredRole: 'APPROVER',
            status: 'PENDING',
          },
        })
      }

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'AWARD_RFQ',
          entity: 'RFQ',
          entityId: rfq.id,
          details: `Awarded RFQ ${rfq.rfqNumber} to ${vendor.name} (${selectedQuote.quoteNumber}) for ₹${selectedQuote.totalAmount}. ${isL1 ? 'L1 Selection' : `Justification: ${validated.awardJustification}`}`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    })

    res.json({
      success: true,
      message: `RFQ successfully awarded to ${vendor.name}.${createdPO ? ` Purchase Order ${createdPO.poNumber} generated.` : ''}`,
      data: {
        rfqId: rfq.id,
        purchaseOrder: createdPO,
      },
    })
  } catch (error) {
    next(error)
  }
})
