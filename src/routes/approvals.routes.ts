import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { PRStatus, Role } from '@prisma/client'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const approvalsRouter = Router()

// GET /api/v1/approvals (Inbox for active user)
approvalsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status = 'PENDING' } = req.query

    const tasks = await prisma.approvalTask.findMany({
      where: {
        status: status as string,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        assignedTo: { select: { fullName: true, email: true } },
        approvedBy: { select: { fullName: true } },
      },
    })

    res.json({
      success: true,
      count: tasks.length,
      data: tasks,
    })
  } catch (error) {
    next(error)
  }
})

const decisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'RETURN']),
  comments: z.string().min(2, 'Comments are required for audit trail'),
})

// POST /api/v1/approvals/:id/decide
approvalsRouter.post('/:id/decide', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string
    const { decision, comments } = decisionSchema.parse(req.body)

    const task = await prisma.approvalTask.findUnique({
      where: { id },
    })

    if (!task) {
      res.status(404).json({ success: false, message: 'Approval task not found' })
      return
    }

    if (task.status !== 'PENDING') {
      res.status(400).json({ success: false, message: 'Task has already been processed' })
      return
    }

    const newStatus = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'RETURNED'

    await prisma.$transaction(async (tx) => {
      // 1. Update approval task
      await tx.approvalTask.update({
        where: { id },
        data: {
          status: newStatus,
          approvedAt: new Date(),
          approvedById: req.user!.id,
          comments,
        },
      })

      // 2. Add history record
      await tx.approvalHistory.create({
        data: {
          taskId: task.id,
          step: task.currentLevel,
          action: decision,
          actorId: req.user!.id,
          comments,
        },
      })

      // 3. Update underlying target entity state
      if (task.entityType === 'PURCHASE_REQUISITION') {
        await tx.purchaseRequisition.update({
          where: { id: task.entityId },
          data: {
            status: decision === 'APPROVE' ? PRStatus.APPROVED : PRStatus.REJECTED,
            approvedAt: decision === 'APPROVE' ? new Date() : null,
            approvedById: decision === 'APPROVE' ? req.user!.id : null,
            rejectionReason: decision !== 'APPROVE' ? comments : null,
          },
        })
      } else if (task.entityType === 'PURCHASE_ORDER') {
        await tx.purchaseOrder.update({
          where: { id: task.entityId },
          data: {
            status: decision === 'APPROVE' ? 'APPROVED' : 'CANCELLED',
            approvedAt: decision === 'APPROVE' ? new Date() : null,
            approvedById: decision === 'APPROVE' ? req.user!.id : null,
          },
        })
      } else if (task.entityType === 'QUOTE_AWARD' || task.entityType === 'RFQ') {
        await tx.rfq.update({
          where: { id: task.entityId },
          data: {
            status: decision === 'APPROVE' ? 'AWARDED' : 'CLOSED',
          },
        })
      } else if (task.entityType === 'MATCH_EXCEPTION' || task.entityType === 'SUPPLIER_INVOICE') {
        await tx.supplierInvoice.update({
          where: { id: task.entityId },
          data: {
            status: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
            hasException: decision === 'APPROVE' ? false : true,
            approvedAt: decision === 'APPROVE' ? new Date() : null,
            approvedById: decision === 'APPROVE' ? req.user!.id : null,
          },
        })
      }

      // 4. Audit Log
      await tx.auditLog.create({
        data: {
          userId: req.user!.id,
          action: `${decision}_${task.entityType}`,
          entity: task.entityType,
          entityId: task.entityId,
          details: `${decision} action recorded on approval task ${task.id}. Reason: "${comments}"`,
          ipAddress: req.ip || '127.0.0.1',
        },
      })
    })

    res.json({
      success: true,
      message: `Task successfully ${newStatus.toLowerCase()}`,
    })
  } catch (error) {
    next(error)
  }
})
