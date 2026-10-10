import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const vendorAuditRouter = Router()

// GET /api/v1/vendor-audits (Supplier Qualification Register §12)
vendorAuditRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, search } = req.query

    const whereClause: any = {}
    if (status && status !== 'ALL') {
      whereClause.qualificationStatus = status as string
    }
    if (search && typeof search === 'string') {
      whereClause.OR = [
        { vendorCode: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ]
    }

    const vendors = await prisma.vendor.findMany({
      where: whereClause,
      include: {
        audits: {
          orderBy: { auditDate: 'desc' },
          take: 1,
          include: { nonConformances: true },
        },
        nonConformances: {
          where: { status: 'OPEN' },
        },
      },
      orderBy: { rating: 'desc' },
    })

    const register = vendors.map((v) => {
      const latestAudit = v.audits[0] || null
      const openNcCount = v.nonConformances.length
      const auditScore = v.auditScore ? Number(v.auditScore) : (latestAudit ? Number(latestAudit.totalScore) : null)

      // PO Eligibility per §12 Gate logic
      let poEligibility = 'Can raise PO'
      let isEligible = true
      let eligibilityReason = ''

      if (v.isBlocked) {
        poEligibility = 'Blocked'
        isEligible = false
        eligibilityReason = v.blockedReason || 'Vendor blocked by Quality'
      } else if (v.qualificationStatus === 'PENDING_AUDIT' || auditScore === null || auditScore < 70) {
        poEligibility = 'Blocked: Audit Required'
        isEligible = false
        eligibilityReason = 'Minimum audit score 70 required'
      } else if (openNcCount > 0 || v.qualificationStatus === 'CONDITIONAL') {
        poEligibility = 'Blocked: Open NC'
        isEligible = false
        eligibilityReason = `${openNcCount} open Non-Conformance(s) pending CAPA verification`
      }

      // Rank calculation
      const liveRank = Math.max(1, Math.min(100, Math.round(Number(v.rating) * 16 + (auditScore || 70) * 0.2 - openNcCount * 5)))

      return {
        vendorId: v.id,
        vendorCode: v.vendorCode,
        vendorName: v.name,
        capabilities: v.capabilities,
        auditScore,
        openNcCount,
        liveRank,
        qualificationStatus: v.qualificationStatus,
        poEligibility,
        isEligible,
        eligibilityReason,
        isBlocked: v.isBlocked,
        blockedReason: v.blockedReason,
        latestAuditDate: latestAudit ? latestAudit.auditDate : null,
        latestAuditAttachment: latestAudit ? latestAudit.attachmentName : null,
        openNcs: v.nonConformances,
      }
    })

    // Sort by rank descending
    register.sort((a, b) => b.liveRank - a.liveRank)

    res.json({
      success: true,
      count: register.length,
      data: register,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/vendor-audits/check-gate/:vendorId (Quality Gate Check for PO Wizard §12)
vendorAuditRouter.get('/check-gate/:vendorId', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const vendorId = req.params.vendorId as string

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: {
        audits: { orderBy: { auditDate: 'desc' }, take: 1 },
        nonConformances: { where: { status: 'OPEN' } },
      },
    })

    if (!vendor) {
      res.status(404).json({ success: false, message: 'Vendor not found' })
      return
    }

    const openNcCount = vendor.nonConformances.length
    const auditScore = vendor.auditScore ? Number(vendor.auditScore) : (vendor.audits[0] ? Number(vendor.audits[0].totalScore) : null)

    if (vendor.isBlocked) {
      res.json({
        success: true,
        eligible: false,
        status: 'BLOCKED',
        reason: `Vendor is BLOCKED by Quality: "${vendor.blockedReason || 'Quality non-conformance'}"`,
        vendorName: vendor.name,
      })
      return
    }

    if (vendor.qualificationStatus === 'PENDING_AUDIT' || auditScore === null || auditScore < 70) {
      res.json({
        success: true,
        eligible: false,
        status: 'PENDING_AUDIT',
        reason: `Vendor audit score is ${auditScore !== null ? auditScore : 'unrecorded'}. Minimum score to raise a PO is 70 (Quality Gate §12).`,
        vendorName: vendor.name,
      })
      return
    }

    if (openNcCount > 0) {
      res.json({
        success: true,
        eligible: false,
        status: 'CONDITIONAL',
        reason: `Vendor has ${openNcCount} open Non-Conformance(s). PO creation blocked until CAPA is verified and closed by Quality (§12).`,
        vendorName: vendor.name,
        openNcs: vendor.nonConformances,
      })
      return
    }

    res.json({
      success: true,
      eligible: true,
      status: 'QUALIFIED',
      auditScore,
      message: 'Quality Gate passed. Vendor is fully qualified for purchase orders.',
      vendorName: vendor.name,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/vendor-audits (Conduct / Re-audit §12)
const conductAuditSchema = z.object({
  vendorId: z.string(),
  auditType: z.enum(['ON_SITE', 'DESK_REVIEW', 'SURVEILLANCE']).default('ON_SITE'),
  qmsScore: z.number().min(0).max(100), // 20%
  processScore: z.number().min(0).max(100), // 20%
  infrastructureScore: z.number().min(0).max(100), // 15%
  traceabilityScore: z.number().min(0).max(100), // 15%
  deliveryScore: z.number().min(0).max(100), // 15%
  documentationScore: z.number().min(0).max(100), // 15%
  attachmentName: z.string().min(1, 'Audit report attachment is mandatory per §12'),
  remarks: z.string().optional(),
  nonConformances: z.array(
    z.object({
      description: z.string().min(3),
      severity: z.enum(['MAJOR', 'MINOR', 'CRITICAL']).default('MINOR'),
      targetDate: z.string(),
    })
  ).optional(),
})

vendorAuditRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const validated = conductAuditSchema.parse(req.body)

    // Calculate weighted score (weighted to 100) per §12
    const totalScore = Math.round(
      validated.qmsScore * 0.20 +
      validated.processScore * 0.20 +
      validated.infrastructureScore * 0.15 +
      validated.traceabilityScore * 0.15 +
      validated.deliveryScore * 0.15 +
      validated.documentationScore * 0.15
    )

    const ncs = validated.nonConformances || []
    const hasOpenNc = ncs.length > 0

    let resultStatus = 'QUALIFIED'
    if (totalScore < 70) {
      resultStatus = 'NOT_QUALIFIED'
    } else if (hasOpenNc) {
      resultStatus = 'CONDITIONAL'
    }

    const audit = await prisma.$transaction(async (tx) => {
      // 1. Create audit record
      const createdAudit = await tx.vendorAudit.create({
        data: {
          vendorId: validated.vendorId,
          auditType: validated.auditType,
          qmsScore: validated.qmsScore,
          processScore: validated.processScore,
          infrastructureScore: validated.infrastructureScore,
          traceabilityScore: validated.traceabilityScore,
          deliveryScore: validated.deliveryScore,
          documentationScore: validated.documentationScore,
          totalScore,
          resultStatus,
          auditedById: req.user!.id,
          attachmentName: validated.attachmentName,
          remarks: validated.remarks || null,
        },
      })

      // 2. Add Non-conformances if any
      let ncIdx = 1
      for (const nc of ncs) {
        const ncCount = await tx.vendorNonConformance.count()
        const ncNumber = `NC-2026-${String(ncCount + ncIdx).padStart(3, '0')}`
        await tx.vendorNonConformance.create({
          data: {
            auditId: createdAudit.id,
            vendorId: validated.vendorId,
            ncNumber,
            description: nc.description,
            severity: nc.severity,
            targetDate: new Date(nc.targetDate),
            status: 'OPEN',
          },
        })
        ncIdx++
      }

      // 3. Update Vendor qualification status
      await tx.vendor.update({
        where: { id: validated.vendorId },
        data: {
          auditScore: totalScore,
          qualificationStatus: resultStatus,
        },
      })

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CONDUCT_VENDOR_AUDIT',
          entity: 'VENDOR_AUDIT',
          entityId: createdAudit.id,
          details: `Completed vendor audit for vendor ${validated.vendorId}. Total Score: ${totalScore}%, Result: ${resultStatus}. ${ncs.length} NC(s) recorded. Attachment: ${validated.attachmentName}`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })

      return createdAudit
    })

    res.status(201).json({
      success: true,
      message: `Audit recorded successfully. Vendor qualification status: ${resultStatus}`,
      data: {
        auditId: audit.id,
        totalScore,
        resultStatus,
      },
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/vendor-audits/non-conformances/:id/close (NC Closure & Re-qualification §12)
const closeNcSchema = z.object({
  capaDetails: z.string().min(5, 'CAPA details are required for NC closure'),
})

vendorAuditRouter.post('/non-conformances/:id/close', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const validated = closeNcSchema.parse(req.body)

    const nc = await prisma.vendorNonConformance.findUnique({
      where: { id },
      include: { vendor: true },
    })

    if (!nc) {
      res.status(404).json({ success: false, message: 'Non-conformance record not found' })
      return
    }

    await prisma.$transaction(async (tx) => {
      // 1. Close NC
      await tx.vendorNonConformance.update({
        where: { id },
        data: {
          status: 'CLOSED',
          capaDetails: validated.capaDetails,
          closedAt: new Date(),
          closedById: req.user!.id,
        },
      })

      // 2. Check remaining open NCs
      const remainingOpenNcs = await tx.vendorNonConformance.count({
        where: {
          vendorId: nc.vendorId,
          status: 'OPEN',
          id: { not: id },
        },
      })

      // If zero remaining and score >= 70, re-qualify vendor automatically per §12
      const vendorScore = nc.vendor.auditScore ? Number(nc.vendor.auditScore) : 0
      if (remainingOpenNcs === 0 && vendorScore >= 70 && !nc.vendor.isBlocked) {
        await tx.vendor.update({
          where: { id: nc.vendorId },
          data: {
            qualificationStatus: 'QUALIFIED',
          },
        })
      }

      // 3. Audit Log
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CLOSE_NON_CONFORMANCE',
          entity: 'VENDOR_NON_CONFORMANCE',
          entityId: id,
          details: `Closed NC ${nc.ncNumber} for vendor ${nc.vendor.name}. CAPA: "${validated.capaDetails}". Re-qualification status updated.`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    })

    res.json({
      success: true,
      message: `Non-conformance ${nc.ncNumber} closed successfully. Vendor qualification re-evaluated.`,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/vendor-audits/block/:vendorId (Quality vendor blocking §12)
const blockSchema = z.object({
  reason: z.string().min(5, 'Reason is required to block a vendor'),
})

vendorAuditRouter.post('/block/:vendorId', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const vendorId = req.params.vendorId as string
    const validated = blockSchema.parse(req.body)

    const vendor = await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        isBlocked: true,
        blockedReason: validated.reason,
        qualificationStatus: 'BLOCKED',
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'BLOCK_VENDOR',
        entity: 'VENDOR',
        entityId: vendorId,
        details: `Vendor ${vendor.name} (${vendor.vendorCode}) blocked by Quality. Reason: ${validated.reason}`,
        ipAddress: req.ip || '127.0.0.1',
      },
    })

    res.json({
      success: true,
      message: `Vendor ${vendor.name} has been blocked from procurement actions.`,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/vendor-audits/unblock/:vendorId (Quality vendor unblocking §12)
vendorAuditRouter.post('/unblock/:vendorId', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const vendorId = req.params.vendorId as string

    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { nonConformances: { where: { status: 'OPEN' } } },
    })

    if (!vendor) {
      res.status(404).json({ success: false, message: 'Vendor not found' })
      return
    }

    const openNcs = vendor.nonConformances.length
    const score = vendor.auditScore ? Number(vendor.auditScore) : 0
    const newQual = score >= 70 ? (openNcs > 0 ? 'CONDITIONAL' : 'QUALIFIED') : 'PENDING_AUDIT'

    await prisma.vendor.update({
      where: { id: vendorId },
      data: {
        isBlocked: false,
        blockedReason: null,
        qualificationStatus: newQual,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'UNBLOCK_VENDOR',
        entity: 'VENDOR',
        entityId: vendorId,
        details: `Vendor ${vendor.name} unblocked by Quality. Restored status: ${newQual}`,
        ipAddress: req.ip || '127.0.0.1',
      },
    })

    res.json({
      success: true,
      message: `Vendor ${vendor.name} unblocked successfully.`,
    })
  } catch (error) {
    next(error)
  }
})
