import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { VendorStatus } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const vendorsRouter = Router()

// GET /api/v1/vendors (List with search and status filter)
vendorsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, search } = req.query

    const whereClause: any = {}
    if (status && status !== 'ALL') {
      whereClause.status = status as VendorStatus
    }
    if (search && typeof search === 'string') {
      whereClause.OR = [
        { vendorCode: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ]
    }

    const vendors = await prisma.vendor.findMany({
      where: whereClause,
      orderBy: { name: 'asc' },
      include: {
        contacts: { where: { isPrimary: true } },
        qualifications: { take: 1, orderBy: { expiryDate: 'desc' } },
      },
    })

    res.json({
      success: true,
      count: vendors.length,
      data: vendors,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/vendors/:id (Vendor 360° View)
vendorsRouter.get('/:id', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string

    const vendor = await prisma.vendor.findUnique({
      where: { id },
      include: {
        contacts: true,
        performance: { orderBy: { createdAt: 'desc' } },
        qualifications: { orderBy: { expiryDate: 'desc' } },
        rateContracts: { include: { items: { include: { item: true } } } },
        purchaseOrders: { take: 10, orderBy: { createdAt: 'desc' } },
        goodsReceipts: { take: 10, orderBy: { createdAt: 'desc' } },
        invoices: { take: 10, orderBy: { createdAt: 'desc' } },
        payments: { take: 10, orderBy: { createdAt: 'desc' } },
        audits: { take: 5, orderBy: { auditDate: 'desc' } },
        nonConformances: { orderBy: { createdAt: 'desc' } },
        inquiries: {
          include: {
            inquiry: true,
            followups: true,
          },
          take: 10,
        },
      },
    })

    if (!vendor) {
      res.status(404).json({ success: false, message: 'Vendor not found' })
      return
    }

    res.json({ success: true, data: vendor })
  } catch (error) {
    next(error)
  }
})

const createVendorSchema = z.object({
  name: z.string().min(2, 'Name is required'),
  legalName: z.string().optional(),
  email: z.string().email('Valid email is required'),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().default('USA'),
  creditTerms: z.string().default('Net 30'),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  primaryContact: z.object({
    name: z.string().min(2, 'Contact name required'),
    email: z.string().email('Valid contact email required'),
    phone: z.string().optional(),
    designation: z.string().optional(),
  }).optional(),
})

// POST /api/v1/vendors (Create Vendor)
vendorsRouter.post('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const validated = createVendorSchema.parse(req.body)
    const count = await prisma.vendor.count()
    const vendorCode = `VND-${String(count + 1).padStart(3, '0')}`

    const newVendor = await prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.create({
        data: {
          vendorCode,
          name: validated.name,
          legalName: validated.legalName || validated.name,
          email: validated.email,
          phone: validated.phone || null,
          taxId: validated.taxId || null,
          address: validated.address || null,
          city: validated.city || null,
          country: validated.country,
          status: VendorStatus.APPROVED,
          creditTerms: validated.creditTerms,
          bankName: validated.bankName || null,
          bankAccount: validated.bankAccount || null,
          contacts: validated.primaryContact
            ? {
                create: {
                  name: validated.primaryContact.name,
                  email: validated.primaryContact.email,
                  phone: validated.primaryContact.phone || null,
                  designation: validated.primaryContact.designation || 'Primary Representative',
                  isPrimary: true,
                },
              }
            : undefined,
        },
        include: { contacts: true },
      })

      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: 'CREATE_VENDOR',
          entity: 'VENDOR',
          entityId: vendor.id,
          details: `Registered vendor ${vendor.name} (${vendor.vendorCode})`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })

      return vendor
    })

    res.status(201).json({
      success: true,
      message: 'Vendor created successfully',
      data: newVendor,
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/vendors/bulk-import (Excel Bulk Import)
vendorsRouter.post('/bulk-import', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { vendors } = req.body
    if (!Array.isArray(vendors) || vendors.length === 0) {
      res.status(400).json({ success: false, message: 'Array of vendor records is required' })
      return
    }

    const imported: any[] = []
    let currentCount = await prisma.vendor.count()

    for (const v of vendors) {
      if (!v.name) continue
      currentCount++
      const vendorCode = v.vendorCode?.trim() || `VND-${String(currentCount).padStart(3, '0')}`

      const vendor = await prisma.vendor.upsert({
        where: { vendorCode },
        update: {
          name: v.name,
          legalName: v.legalName || v.name,
          email: v.email || `contact@${v.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
          phone: v.phone || null,
          taxId: v.taxId || null,
          address: v.address || null,
          city: v.city || null,
          country: v.country || 'USA',
          creditTerms: v.creditTerms || 'Net 30',
          bankName: v.bankName || null,
          bankAccount: v.bankAccount || null,
        },
        create: {
          vendorCode,
          name: v.name,
          legalName: v.legalName || v.name,
          email: v.email || `contact@${v.name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
          phone: v.phone || null,
          taxId: v.taxId || null,
          address: v.address || null,
          city: v.city || null,
          country: v.country || 'USA',
          creditTerms: v.creditTerms || 'Net 30',
          bankName: v.bankName || null,
          bankAccount: v.bankAccount || null,
          status: VendorStatus.APPROVED,
          contacts: v.contactPerson
            ? {
                create: {
                  name: v.contactPerson,
                  email: v.email || 'primary@vendor.example',
                  phone: v.phone || null,
                  isPrimary: true,
                },
              }
            : undefined,
        },
        include: { contacts: true },
      })
      imported.push(vendor)
    }

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'BULK_IMPORT_VENDORS',
          entity: 'VENDOR',
          details: `Imported ${imported.length} vendors via Excel bulk import`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    }

    res.status(201).json({
      success: true,
      message: `Successfully imported ${imported.length} vendors`,
      count: imported.length,
      data: imported,
    })
  } catch (error) {
    next(error)
  }
})

