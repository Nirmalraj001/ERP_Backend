import { Router, Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const goodsReceiptsRouter = Router()

// GET /api/v1/goods-receipts
goodsReceiptsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const receipts = await prisma.goodsReceipt.findMany({
      orderBy: { receiptDate: 'desc' },
      include: {
        vendor: { select: { name: true, vendorCode: true } },
        purchaseOrder: { select: { poNumber: true, totalAmount: true } },
        receivedBy: { select: { fullName: true } },
        items: true,
      },
    })

    res.json({
      success: true,
      count: receipts.length,
      data: receipts,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/goods-receipts (Create GRN against PO §11)
goodsReceiptsRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { poId, deliveryNoteNumber, vehicleNumber, warehouse, batchNumber, heatNumber, remarks, items } = req.body

    const po = await prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true, vendor: true },
    })

    if (!po) {
      res.status(404).json({ success: false, message: 'Purchase Order not found' })
      return
    }

    if (po.status !== 'APPROVED' && po.status !== 'PARTIALLY_RECEIVED') {
      res.status(400).json({
        success: false,
        message: `Goods can only be received against APPROVED or PARTIALLY_RECEIVED Purchase Orders. Current status: ${po.status}`,
      })
      return
    }

    const count = await prisma.goodsReceipt.count()
    const grnNumber = `GRN-2026-${String(count + 1).padStart(5, '0')}`

    const combinedRemarks = [
      remarks,
      warehouse ? `Warehouse: ${warehouse}` : null,
      batchNumber ? `Batch: ${batchNumber}` : null,
      heatNumber ? `Heat: ${heatNumber}` : null,
    ].filter(Boolean).join(' | ') || null

    const newGRN = await prisma.$transaction(async (tx) => {
      const grn = await tx.goodsReceipt.create({
        data: {
          grnNumber,
          poId: po.id,
          vendorId: po.vendorId,
          receivedById: req.user!.id,
          receiptDate: new Date(),
          deliveryNoteNumber: deliveryNoteNumber || `DN-${Date.now().toString().slice(-6)}`,
          vehicleNumber: vehicleNumber || null,
          status: 'ACCEPTED',
          remarks: combinedRemarks,
          items: {
            create: Array.isArray(items) && items.length > 0
              ? items.map((it: any) => ({
                  poItemId: it.poItemId || po.items[0]?.id,
                  quantityReceived: Number(it.quantityReceived) || 1,
                  quantityAccepted: Number(it.quantityAccepted) || Number(it.quantityReceived) || 1,
                  quantityRejected: Number(it.quantityRejected) || 0,
                  rejectionReason: it.rejectionReason || null,
                }))
              : po.items.map((pi) => ({
                  poItemId: pi.id,
                  quantityReceived: pi.quantity,
                  quantityAccepted: pi.quantity,
                  quantityRejected: 0,
                })),
          },
        },
        include: { items: true, vendor: true, purchaseOrder: true },
      })

      // Update PO status to PARTIALLY_RECEIVED (§10 Lifecycle)
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: 'PARTIALLY_RECEIVED' },
      })

      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE_GRN',
          entity: 'GOODS_RECEIPT',
          entityId: grn.id,
          details: `Created GRN ${grnNumber} against PO ${po.poNumber} with warehouse receipt`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })

      return grn
    })

    res.status(201).json({
      success: true,
      message: `Goods Receipt ${newGRN.grnNumber} posted successfully`,
      data: newGRN,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/goods-receipts/bulk-import (Excel Bulk Import)
goodsReceiptsRouter.post('/bulk-import', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { receipts } = req.body
    if (!Array.isArray(receipts) || receipts.length === 0) {
      res.status(400).json({ success: false, message: 'Array of receipts is required' })
      return
    }

    const importedGRNs: any[] = []
    let count = await prisma.goodsReceipt.count()
    const firstPO = await prisma.purchaseOrder.findFirst({ include: { vendor: true, items: true } })

    for (const r of receipts) {
      count++
      const grnNumber = r.grnNumber?.trim() || `GRN-2026-${String(count + 1).padStart(5, '0')}`

      // Match PO
      let targetPO = firstPO
      if (r.poNumber) {
        const foundPO = await prisma.purchaseOrder.findUnique({
          where: { poNumber: r.poNumber },
          include: { vendor: true, items: true },
        })
        if (foundPO) targetPO = foundPO
      }

      if (!targetPO || !targetPO.items.length) continue

      const qty = Number(r.quantityReceived) || 10
      const poItemId = targetPO.items[0].id

      const grn = await prisma.goodsReceipt.upsert({
        where: { grnNumber },
        update: {
          deliveryNoteNumber: r.deliveryNoteNumber || null,
          vehicleNumber: r.vehicleNumber || null,
          remarks: r.remarks || null,
        },
        create: {
          grnNumber,
          poId: targetPO.id,
          vendorId: targetPO.vendorId,
          receivedById: req.user!.id,
          receiptDate: r.receiptDate ? new Date(r.receiptDate) : new Date(),
          deliveryNoteNumber: r.deliveryNoteNumber || 'DN-SAMPLE-01',
          vehicleNumber: r.vehicleNumber || 'TRK-901',
          status: 'ACCEPTED',
          remarks: r.remarks || 'Accepted dock receipt',
          items: {
            create: [
              {
                poItemId,
                quantityReceived: qty,
                quantityAccepted: qty,
                quantityRejected: 0,
              },
            ],
          },
        },
        include: { vendor: true, purchaseOrder: true },
      })

      importedGRNs.push(grn)
    }

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'BULK_IMPORT_GRN',
          entity: 'GOODS_RECEIPT',
          details: `Imported ${importedGRNs.length} goods receipt notes from Excel`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    }

    res.status(201).json({
      success: true,
      message: `Successfully imported ${importedGRNs.length} goods receipts`,
      count: importedGRNs.length,
      data: importedGRNs,
    })
  } catch (error) {
    next(error)
  }
})

