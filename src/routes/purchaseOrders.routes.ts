import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { POStatus, Role } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const purchaseOrdersRouter = Router()

// GET /api/v1/purchase-orders (List)
purchaseOrdersRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, search } = req.query

    const whereClause: any = {}
    if (status && status !== 'ALL') {
      whereClause.status = status as POStatus
    }
    if (search && typeof search === 'string') {
      whereClause.OR = [
        { poNumber: { contains: search, mode: 'insensitive' } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
      ]
    }

    const pos = await prisma.purchaseOrder.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      include: {
        vendor: { select: { id: true, name: true, vendorCode: true, email: true } },
        createdBy: { select: { id: true, fullName: true } },
        approvedBy: { select: { id: true, fullName: true } },
        items: true,
      },
    })

    res.json({
      success: true,
      count: pos.length,
      data: pos,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/purchase-orders/:id
purchaseOrdersRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const po = await prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        vendor: true,
        createdBy: { select: { id: true, fullName: true, email: true } },
        approvedBy: { select: { id: true, fullName: true, email: true } },
        items: { include: { item: true } },
        goodsReceipts: { include: { items: true } },
        invoices: true,
      },
    })

    if (!po) {
      res.status(404).json({ success: false, message: 'Purchase Order not found' })
      return
    }

    res.json({ success: true, data: po })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/purchase-orders (Create Single PO)
purchaseOrdersRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { poNumber, vendorId, expectedDeliveryDate, paymentTerms, totalAmount, items } = req.body

    const count = await prisma.purchaseOrder.count()
    const finalPoNumber = poNumber || `PO-2026-${String(count + 1).padStart(5, '0')}`

    let targetVendorId = vendorId
    if (!targetVendorId) {
      const topVendor = await prisma.vendor.findFirst({
        where: { isBlocked: false, qualificationStatus: 'QUALIFIED' },
      })
      if (topVendor) targetVendorId = topVendor.id
    }

    if (!targetVendorId) {
      res.status(400).json({ success: false, message: 'Vendor ID is required to create a Purchase Order.' })
      return
    }

    // Validate target vendor and enforce Quality Gate (§12, §16)
    const vendor = await prisma.vendor.findUnique({
      where: { id: targetVendorId },
      include: { nonConformances: { where: { status: 'OPEN' } } },
    })

    if (!vendor) {
      res.status(404).json({ success: false, message: 'Vendor not found' })
      return
    }

    if (vendor.isBlocked) {
      res.status(403).json({
        success: false,
        message: `Quality Gate Breach: Vendor ${vendor.name} is BLOCKED (${vendor.blockedReason || 'Quality restriction'}). PO creation blocked (§12).`,
      })
      return
    }

    if (vendor.qualificationStatus === 'CONDITIONAL' || vendor.nonConformances.length > 0) {
      res.status(403).json({
        success: false,
        message: `Quality Gate Breach: Vendor ${vendor.name} has open Non-Conformances. PO creation blocked until CAPA is verified and closed (§12).`,
      })
      return
    }

    if (
      vendor.qualificationStatus === 'PENDING_AUDIT' ||
      vendor.qualificationStatus === 'NOT_QUALIFIED' ||
      (vendor.auditScore !== null && Number(vendor.auditScore) < 70)
    ) {
      res.status(403).json({
        success: false,
        message: `Quality Gate Breach: Vendor ${vendor.name} is not qualified (Score < 70). Audit required before raising PO (§12).`,
      })
      return
    }

    const calculatedTotal = totalAmount || 15000
    const calculatedSubtotal = Math.round(calculatedTotal / 1.18)
    const calculatedTax = calculatedTotal - calculatedSubtotal

    const newPO = await prisma.purchaseOrder.create({
      data: {
        poNumber: finalPoNumber,
        vendorId: targetVendorId,
        createdById: req.user!.id,
        expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : new Date(Date.now() + 14 * 86400000),
        paymentTerms: paymentTerms || 'Net 30',
        status: POStatus.APPROVED,
        subtotal: calculatedSubtotal,
        taxAmount: calculatedTax,
        totalAmount: calculatedTotal,
        items: {
          create: Array.isArray(items) && items.length > 0
            ? items.map((it: any) => ({
                description: it.description || 'Industrial Grade Component',
                quantity: it.quantity || 10,
                unitPrice: it.unitPrice || 150,
                taxRate: it.taxRate || 18,
                totalPrice: (it.quantity || 10) * (it.unitPrice || 150),
              }))
            : [{
                description: 'Industrial Grade Procurement Component Package',
                quantity: 10,
                unitPrice: calculatedSubtotal / 10,
                taxRate: 18,
                totalPrice: calculatedSubtotal,
              }],
        },
      },
      include: {
        vendor: true,
        items: true,
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'CREATE_PURCHASE_ORDER',
        entity: 'PURCHASE_ORDER',
        entityId: newPO.id,
        details: `Created Purchase Order ${newPO.poNumber} for vendor ${newPO.vendor.name}`,
        ipAddress: req.ip || '127.0.0.1',
      },
    })

    res.status(201).json({ success: true, message: 'Purchase Order created successfully', data: newPO })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/purchase-orders/bulk-import (Excel Bulk Import)
purchaseOrdersRouter.post('/bulk-import', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orders } = req.body
    if (!Array.isArray(orders) || orders.length === 0) {
      res.status(400).json({ success: false, message: 'Array of purchase orders is required' })
      return
    }

    const importedPOs: any[] = []
    let count = await prisma.purchaseOrder.count()

    // Cache existing vendors
    const existingVendors = await prisma.vendor.findMany()

    for (const ord of orders) {
      count++
      const finalPoNumber = ord.poNumber?.trim() || `PO-2026-${String(count).padStart(5, '0')}`

      // Match vendor by code or name, or fallback
      let vendor = existingVendors.find(
        (v) =>
          v.vendorCode.toLowerCase() === (ord.vendorCodeOrName || '').toLowerCase() ||
          v.name.toLowerCase().includes((ord.vendorCodeOrName || '').toLowerCase())
      )

      if (!vendor) {
        // If not found, create or use first vendor
        if (ord.vendorCodeOrName) {
          vendor = await prisma.vendor.create({
            data: {
              vendorCode: `VND-${String(count + 10).padStart(3, '0')}`,
              name: ord.vendorCodeOrName,
              email: `sales@${ord.vendorCodeOrName.toLowerCase().replace(/[^a-z0-9]/g, '')}.example`,
            },
          })
          existingVendors.push(vendor)
        } else if (existingVendors.length > 0) {
          vendor = existingVendors[0]
        }
      }

      if (!vendor) continue

      const qty = Number(ord.quantity) || 10
      const price = Number(ord.unitPrice) || 100
      const taxRate = Number(ord.taxRate) || 18
      const subtotal = qty * price
      const taxAmount = (subtotal * taxRate) / 100
      const totalAmount = subtotal + taxAmount

      const created = await prisma.purchaseOrder.upsert({
        where: { poNumber: finalPoNumber },
        update: {
          vendorId: vendor.id,
          expectedDeliveryDate: ord.deliveryDate ? new Date(ord.deliveryDate) : new Date(Date.now() + 14 * 86400000),
          paymentTerms: ord.paymentTerms || 'Net 30',
          subtotal,
          taxAmount,
          totalAmount,
          notes: ord.notes || null,
        },
        create: {
          poNumber: finalPoNumber,
          vendorId: vendor.id,
          createdById: req.user!.id,
          expectedDeliveryDate: ord.deliveryDate ? new Date(ord.deliveryDate) : new Date(Date.now() + 14 * 86400000),
          paymentTerms: ord.paymentTerms || 'Net 30',
          status: POStatus.APPROVED,
          subtotal,
          taxAmount,
          totalAmount,
          notes: ord.notes || null,
          items: {
            create: [
              {
                description: ord.itemDescription || 'Industrial Grade Procurement Component',
                quantity: qty,
                unitPrice: price,
                taxRate,
                totalPrice: subtotal,
              },
            ],
          },
        },
        include: { vendor: true, items: true },
      })

      importedPOs.push(created)
    }

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'BULK_IMPORT_PURCHASE_ORDERS',
          entity: 'PURCHASE_ORDER',
          details: `Imported ${importedPOs.length} purchase orders from Excel`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    }

    res.status(201).json({
      success: true,
      message: `Successfully imported ${importedPOs.length} purchase orders`,
      count: importedPOs.length,
      data: importedPOs,
    })
  } catch (error) {
    next(error)
  }
})

