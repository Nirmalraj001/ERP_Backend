import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const paymentsRouter = Router()

// GET /api/v1/payments (Payment Ledger & AP Aging §11)
paymentsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payments = await prisma.payment.findMany({
      orderBy: { paymentDate: 'desc' },
      include: {
        vendor: { select: { id: true, vendorCode: true, name: true, bankName: true, bankAccount: true } },
        invoice: { select: { id: true, invoiceNumber: true, totalAmount: true, poId: true } },
        processedBy: { select: { id: true, fullName: true } },
      },
    })

    // Fetch unpaid/approved invoices for AP Aging & Payables
    const pendingInvoices = await prisma.supplierInvoice.findMany({
      where: {
        status: { in: ['APPROVED', 'PENDING_APPROVAL'] },
      },
      include: {
        vendor: true,
        purchaseOrder: { select: { poNumber: true } },
      },
      orderBy: { dueDate: 'asc' },
    })

    const now = new Date()
    let currentBucket = 0
    let days30Bucket = 0
    let days60Bucket = 0
    let days90PlusBucket = 0
    let totalOutstanding = 0

    const payables = pendingInvoices.map((inv) => {
      const amt = Number(inv.totalAmount)
      totalOutstanding += amt

      const diffDays = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 3600 * 24))

      let agingCategory = 'Current'
      if (diffDays > 90) {
        agingCategory = '90+ Days'
        days90PlusBucket += amt
      } else if (diffDays > 60) {
        agingCategory = '61-90 Days'
        days60Bucket += amt
      } else if (diffDays > 30) {
        agingCategory = '31-60 Days'
        days30Bucket += amt
      } else {
        agingCategory = 'Current'
        currentBucket += amt
      }

      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        supplierInvoiceRef: inv.supplierInvoiceRef,
        poNumber: inv.purchaseOrder.poNumber,
        vendorId: inv.vendorId,
        vendorName: inv.vendor.name,
        vendorCode: inv.vendor.vendorCode,
        bankName: inv.vendor.bankName || 'HDFC Bank',
        bankAccount: inv.vendor.bankAccount || '•••• 5021',
        totalAmount: amt,
        dueDate: inv.dueDate,
        daysOverdue: Math.max(0, diffDays),
        agingCategory,
        status: inv.status,
        matchStatus: inv.matchStatus,
        hasException: inv.hasException,
      }
    })

    res.json({
      success: true,
      data: {
        payments,
        payables,
        summary: {
          totalOutstanding,
          totalPaid: payments.reduce((sum, p) => sum + Number(p.amount), 0),
          agingBuckets: {
            current: currentBucket,
            days30: days30Bucket,
            days60: days60Bucket,
            days90Plus: days90PlusBucket,
          },
        },
      },
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/payments/release (Manual Payment Release with UTR §11)
const releasePaymentSchema = z.object({
  invoiceId: z.string(),
  amount: z.number().positive(),
  paymentMethod: z.enum(['BANK_TRANSFER', 'RTGS', 'NEFT', 'IMPS', 'CHEQUE']).default('BANK_TRANSFER'),
  referenceNumber: z.string().min(6, 'Mandatory UTR / Transaction Reference number required (min 6 characters)'),
  notes: z.string().optional(),
})

paymentsRouter.post('/release', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const validated = releasePaymentSchema.parse(req.body)

    const invoice = await prisma.supplierInvoice.findUnique({
      where: { id: validated.invoiceId },
      include: { vendor: true, purchaseOrder: true },
    })

    if (!invoice) {
      res.status(404).json({ success: false, message: 'Invoice not found' })
      return
    }

    if (invoice.status === 'PAID') {
      res.status(400).json({ success: false, message: 'Invoice has already been settled and paid.' })
      return
    }

    if (invoice.hasException) {
      res.status(400).json({
        success: false,
        message: 'Cannot release payment: Invoice has an active 3-Way Match Exception that requires approval first.',
      })
      return
    }

    const count = await prisma.payment.count()
    const paymentNumber = `PAY-2026-${String(count + 1).padStart(4, '0')}`

    const payment = await prisma.$transaction(async (tx) => {
      // 1. Create Payment
      const p = await tx.payment.create({
        data: {
          paymentNumber,
          invoiceId: invoice.id,
          vendorId: invoice.vendorId,
          amount: validated.amount,
          paymentMethod: validated.paymentMethod,
          referenceNumber: validated.referenceNumber, // UTR
          status: 'COMPLETED',
          processedById: req.user!.id,
          notes: validated.notes || null,
        },
      })

      // 2. Lock invoice to PAID
      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: {
          status: 'PAID',
        },
      })

      // 3. Audit Log
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'RELEASE_PAYMENT',
          entity: 'PAYMENT',
          entityId: p.id,
          details: `Manual electronic payment released for Invoice ${invoice.invoiceNumber}. Amount: ₹${validated.amount.toLocaleString('en-IN')}, UTR: ${validated.referenceNumber}, Vendor: ${invoice.vendor.name}`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })

      return p
    })

    res.status(201).json({
      success: true,
      message: `Disbursement released successfully under UTR ${validated.referenceNumber}. Invoice ${invoice.invoiceNumber} closed.`,
      data: payment,
    })
  } catch (error) {
    next(error)
  }
})
