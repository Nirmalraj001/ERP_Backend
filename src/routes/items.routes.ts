import { Router, Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const itemsRouter = Router()

// GET /api/v1/items (Item Master)
itemsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { category, search } = req.query
    const whereClause: any = {}

    if (category && category !== 'ALL') {
      whereClause.categoryId = category as string
    }

    if (search && typeof search === 'string') {
      whereClause.OR = [
        { itemCode: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ]
    }

    const items = await prisma.item.findMany({
      where: whereClause,
      orderBy: { itemCode: 'asc' },
      include: { category: true },
    })

    res.json({
      success: true,
      count: items.length,
      data: items,
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/items/categories
itemsRouter.get('/categories', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const categories = await prisma.itemCategory.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { items: true } } },
    })
    res.json({ success: true, data: categories })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/items/budgets (Budget control list)
itemsRouter.get('/budgets', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const budgets = await prisma.budgetControl.findMany({
      orderBy: { costCenterCode: 'asc' },
    })
    res.json({ success: true, data: budgets })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/items/rate-contracts
itemsRouter.get('/rate-contracts', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const contracts = await prisma.rateContract.findMany({
      orderBy: { contractNumber: 'asc' },
      include: {
        vendor: { select: { name: true, vendorCode: true } },
        items: { include: { item: true } },
      },
    })
    res.json({ success: true, data: contracts })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/items/bulk-import (Excel Bulk Import)
itemsRouter.post('/bulk-import', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { items } = req.body
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: 'Array of items is required' })
      return
    }

    const importedItems: any[] = []
    let count = await prisma.item.count()

    for (const it of items) {
      if (!it.name) continue
      count++
      const itemCode = it.itemCode?.trim() || `ITM-${String(count).padStart(3, '0')}`
      const standardPrice = Number(it.standardPrice) || 100
      const minStock = Number(it.minStock) || 10
      const currentStock = Number(it.currentStock) || 50

      // Find or create category
      let categoryId: string | undefined = undefined
      if (it.category) {
        const cat = await prisma.itemCategory.upsert({
          where: { code: it.category.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 10) },
          update: { name: it.category },
          create: {
            code: it.category.toUpperCase().replace(/[^A-Z0-9]/g, '_').slice(0, 10),
            name: it.category,
          },
        })
        categoryId = cat.id
      }

      const created = await prisma.item.upsert({
        where: { itemCode },
        update: {
          name: it.name,
          description: it.description || null,
          categoryId,
          uom: it.uom || 'EA',
          standardPrice,
          minStock,
          currentStock,
        },
        create: {
          itemCode,
          name: it.name,
          description: it.description || null,
          categoryId,
          uom: it.uom || 'EA',
          standardPrice,
          minStock,
          currentStock,
        },
        include: { category: true },
      })

      importedItems.push(created)
    }

    if (req.user) {
      await prisma.auditLog.create({
        data: {
          userId: req.user.id,
          action: 'BULK_IMPORT_ITEMS',
          entity: 'ITEM',
          details: `Imported ${importedItems.length} items from Excel into master catalog`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    }

    res.status(201).json({
      success: true,
      message: `Successfully imported ${importedItems.length} items`,
      count: importedItems.length,
      data: importedItems,
    })
  } catch (error) {
    next(error)
  }
})

