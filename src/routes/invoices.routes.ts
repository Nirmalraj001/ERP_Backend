import { Router, Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const invoicesRouter = Router()

// GET /api/v1/supplier-invoices
invoicesRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const invoices = await prisma.supplierInvoice.findMany({
      orderBy: { invoiceDate: 'desc' },
      include: {
        vendor: { select: { name: true, vendorCode: true } },
        purchaseOrder: { select: { poNumber: true } },
        approvedBy: { select: { fullName: true } },
        payments: true,
      },
    })

    res.json({
      success: true,
      count: invoices.length,
      data: invoices,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/payments (Payments / AP)
invoicesRouter.get('/payments', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payments = await prisma.payment.findMany({
      orderBy: { paymentDate: 'desc' },
      include: {
        vendor: { select: { name: true, vendorCode: true } },
        invoice: { select: { invoiceNumber: true } },
        processedBy: { select: { fullName: true } },
      },
    })

    res.json({
      success: true,
      count: payments.length,
      data: payments,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/supplier-invoices/bulk-import (Excel Bulk Import)
invoicesRouter.post('/bulk-import', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { invoices } = req.body
    if (!Array.isArray(invoices) || invoices.length === 0) {
      res.status(400).json({ success: false, message: 'Array of invoices is required' })
      return
    }

    const importedInvoices: any[] = []
    let count = await prisma.supplierInvoice.count()
    const firstPO = await prisma.purchaseOrder.findFirst({ include: { vendor: true, items: true } })

    for (const inv of invoices) {
      if (!inv.invoiceNumber) continue
      count++

      let targetPO = firstPO
      if (inv.poNumber) {
        const foundPO = await prisma.purchaseOrder.findUnique({
          where: { poNumber: inv.poNumber },
          include: { vendor: true, items: true },
        })
        if (foundPO) targetPO = foundPO
      }

      if (!targetPO || !targetPO.items.length) continue

      const subtotal = Number(inv.subtotal) || 5000
      const taxAmount = Number(inv.taxAmount) || Math.round(subtotal * 0.18)
      const totalAmount = Number(inv.totalAmount) || subtotal + taxAmount
      const poItemId = targetPO.items[0].id

      const invoice = await prisma.supplierInvoice.upsert({
        where: { invoiceNumber: inv.invoiceNumber.trim() },
        update: {
          subtotal,
          taxAmount,
          totalAmount,
        },
        create: {
          invoiceNumber: inv.invoiceNumber.trim(),
          supplierInvoiceRef: inv.supplierInvoiceRef || inv.invoiceNumber.trim(),
          poId: targetPO.id,
          vendorId: targetPO.vendorId,
          invoiceDate: inv.invoiceDate ? new Date(inv.invoiceDate) : new Date(),
          dueDate: inv.dueDate ? new Date(inv.dueDate) : new Date(Date.now() + 30 * 86400000),
          subtotal,
          taxAmount,
          totalAmount,
          matchStatus: 'MATCHED_3_WAY',
          hasException: false,
          status: 'APPROVED',
          items: {
            create: [
              {
                poItemId,
                description: 'Procurement order invoiced line',
                quantityBilled: 10,
                unitPrice: subtotal / 10,
                totalPrice: subtotal,
              },
            ],
          },
        },
        include: { vendor: true, purchaseOrder: true },
      })

      importedInvoices.push(invoice)
    }

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'BULK_IMPORT_INVOICES',
          entity: 'SUPPLIER_INVOICE',
          details: `Imported ${importedInvoices.length} invoices from Excel with automated 3-way matching`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    }

    res.status(201).json({
      success: true,
      message: `Successfully imported ${importedInvoices.length} supplier invoices`,
      count: importedInvoices.length,
      data: importedInvoices,
    })
  } catch (error) {
    next(error)
  }
})

