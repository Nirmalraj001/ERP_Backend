import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

export const settingsRouter = Router()

// Default configurations per §2.3, §15
const DEFAULT_DOA = [
  { valueBand: 'Up to ₹1,00,000', maxLimit: 100000, authority: 'Purchase Executive', description: 'Standard low-value purchase' },
  { valueBand: 'Up to ₹5,00,000', maxLimit: 500000, authority: 'Purchase Manager', description: 'Operational procurement' },
  { valueBand: 'Up to ₹25,00,000', maxLimit: 2500000, authority: 'Management', description: 'High-value capital / contract purchases' },
  { valueBand: 'Above ₹25,00,000', maxLimit: null, authority: 'Management + Director sign-off', description: 'Executive board level approval' },
]

const DEFAULT_COMPANY_PROFILE = {
  companyName: 'SLT Engineering Ltd.',
  brandTitle: 'SLT Procurement Suite',
  gstin: '29AABCS1429B1Z2',
  pan: 'AABCS1429B',
  cin: 'L29100KA1998PLC024112',
  address: 'Plot 42, Electronic City Phase II, Hosur Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560100',
  country: 'India',
  phone: '+91 (80) 4192-8000',
  email: 'procurement@slt-engineering.com',
  website: 'https://slt-engineering.com',
  currentFiscalYear: 'FY 2026-27',
}

const DEFAULT_LOCKED_CONTROLS = [
  { code: 'CTRL-01', name: 'Immutable Approved POs', rule: 'Approved POs cannot be deleted; only cancelled/closed with justification.', status: 'LOCKED_ACTIVE' },
  { code: 'CTRL-02', name: 'Master Item Spec Protection', rule: 'Item spec, HSN code, and UOM are fetched read-only from Item Master on all documents.', status: 'LOCKED_ACTIVE' },
  { code: 'CTRL-03', name: 'Downstream Quantity Lock', rule: 'PO line quantity locks immediately once a GRN dock receipt is posted against it.', status: 'LOCKED_ACTIVE' },
  { code: 'CTRL-04', name: 'Downstream Rate Lock', rule: 'PO item rate locks immediately once a supplier invoice is booked against it.', status: 'LOCKED_ACTIVE' },
  { code: 'CTRL-05', name: 'Settlement Invoice Lock', rule: 'Supplier invoice locks completely once any payment or UTR is released against it.', status: 'LOCKED_ACTIVE' },
  { code: 'CTRL-06', name: 'Mandatory Manual UTR Release', rule: 'Payment release is never automatic; manual authorization with valid bank UTR is mandatory.', status: 'LOCKED_ACTIVE' },
  { code: 'CTRL-07', name: 'Quality Gate Enforcement', rule: 'PO wizard is strictly blocked if vendor is un-audited (score < 70) or has open Non-Conformances.', status: 'LOCKED_ACTIVE' },
  { code: 'CTRL-08', name: 'Gapless Enterprise Numbering', rule: 'Consecutive gapless sequence numbers enforced for PR, PO, GRN, INV, and PAY documents.', status: 'LOCKED_ACTIVE' },
]

const DEFAULT_ROLE_PERMISSIONS = [
  { role: 'Purchase Executive', capabilities: ['Raise PR', 'Create PO', 'Book Invoice', 'View all reports'] },
  { role: 'Purchase Manager', capabilities: ['Approve PR & PO within DOA (<= ₹5L)', 'Create PO', 'Award RFQs'] },
  { role: 'Stores', capabilities: ['Record GRN dock receipt', 'Inspect physical delivery', 'Track batch & heat #'] },
  { role: 'Quality', capabilities: ['Vendor Audit', 'NC Closure & CAPA', 'Vendor Blocking & Unblocking', 'Inspection Sign-off'] },
  { role: 'Accounts', capabilities: ['3-Way Match Verification', 'Book Invoice', 'Release Manual Payment (UTR)'] },
  { role: 'Management', capabilities: ['Full authority incl. overrides', 'Vendor Master updates', 'DOA > ₹5L Approvals'] },
]

// GET /api/v1/settings
settingsRouter.get('/', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dbSettings = await prisma.systemSetting.findMany()
    const settingsMap = new Map(dbSettings.map((s) => [s.key, s.value]))

    const companyProfile = settingsMap.has('COMPANY_PROFILE')
      ? JSON.parse(settingsMap.get('COMPANY_PROFILE')!)
      : DEFAULT_COMPANY_PROFILE

    let doa = DEFAULT_DOA
    if (settingsMap.has('DOA_MATRIX')) {
      try {
        const parsed = JSON.parse(settingsMap.get('DOA_MATRIX')!)
        if (Array.isArray(parsed)) {
          doa = parsed
        } else if (parsed && typeof parsed === 'object') {
          doa = Object.entries(parsed).map(([key, val]: [string, any]) => ({
            valueBand: val.description || val.valueBand || key,
            maxLimit: val.maxAmount !== undefined ? val.maxAmount : val.maxLimit,
            authority: val.authority || 'Management',
            description: val.description || val.workflow || '',
          }))
        }
      } catch {
        doa = DEFAULT_DOA
      }
    }

    res.json({
      success: true,
      data: {
        companyProfile,
        delegationOfAuthority: doa,
        lockedControls: DEFAULT_LOCKED_CONTROLS,
        rolePermissions: DEFAULT_ROLE_PERMISSIONS,
        systemSettings: dbSettings,
      },
    })
  } catch (error) {
    next(error)
  }
})

// PATCH /api/v1/settings/:key
settingsRouter.patch('/:key', authenticate, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const key = req.params.key as string
    const { value, description } = req.body

    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)

    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: {
        value: stringValue,
        description: description || undefined,
      },
      create: {
        key,
        value: stringValue,
        description: description || 'System configuration parameter',
      },
    })

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'UPDATE_SYSTEM_SETTING',
        entity: 'SYSTEM_SETTING',
        entityId: setting.id,
        details: `Updated setting parameter "${key}"`,
        ipAddress: req.ip || '127.0.0.1',
      },
    })

    res.json({
      success: true,
      message: `Setting ${key} updated successfully`,
      data: setting,
    })
  } catch (error) {
    next(error)
  }
})
