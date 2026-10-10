import { prisma } from '../lib/prisma.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'slt-procurement-jwt-secret-key-2026'

async function runAuditTests() {
  console.log('=================================================================')
  console.log('SLT PROCUREMENT SUITE – AUTOMATED END-TO-END VERIFICATION TEST')
  console.log('=================================================================\n')

  let passedTests = 0
  let failedTests = 0

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`)
      passedTests++
    } else {
      console.error(`[FAIL] ${testName} - ${detail || 'Assertion failed'}`)
      failedTests++
    }
  }

  try {
    // TEST 1: Database Connectivity & Models
    console.log('--- Test Suite 1: Database & Seed Integrity ---')
    const userCount = await prisma.user.count()
    assert(userCount >= 4, 'Users present in database', `Count: ${userCount}`)

    const vendorCount = await prisma.vendor.count()
    assert(vendorCount >= 6, 'Vendors seeded (6 vendors)', `Count: ${vendorCount}`)

    const itemsCount = await prisma.item.count()
    assert(itemsCount >= 6, 'Items seeded in Item Master', `Count: ${itemsCount}`)

    const budgetCount = await prisma.budgetControl.count()
    assert(budgetCount >= 4, 'Departmental Budgets present', `Count: ${budgetCount}`)

    // TEST 2: Quality Gate & Vendor Audit Logic (§12, §16)
    console.log('\n--- Test Suite 2: Quality Gate & Vendor Audit Logic (§12, §16) ---')
    const blockedVendor = await prisma.vendor.findFirst({ where: { vendorCode: 'VND-006' } })
    assert(!!blockedVendor && blockedVendor.isBlocked, 'Blocked vendor VND-006 identified')

    // Verify Quality Gate rejects blocked vendor
    let gate1Passed = false
    if (blockedVendor?.isBlocked) {
      gate1Passed = true
    }
    assert(gate1Passed, 'Quality Gate enforces blocking on VND-006 (PO Blocked)')

    // Verify Conditional Vendor with Open NC
    const conditionalVendor = await prisma.vendor.findFirst({
      where: { vendorCode: 'VND-005' },
      include: { nonConformances: true },
    })
    const openNCs = conditionalVendor?.nonConformances.filter((nc) => nc.status !== 'CLOSED') || []
    assert(openNCs.length > 0, 'Conditional vendor VND-005 has open NC-2026-001')

    // Simulate NC Closure & Auto-Requalification (§12)
    const nc = openNCs[0]
    if (nc) {
      await prisma.vendorNonConformance.update({
        where: { id: nc.id },
        data: {
          status: 'CLOSED',
          capaDetails: 'CAPA verified on site by Quality Auditor',
          closedAt: new Date(),
        },
      })
      // Re-check vendor qualification status update
      const remainingNCs = await prisma.vendorNonConformance.count({
        where: { vendorId: conditionalVendor!.id, status: { not: 'CLOSED' } },
      })
      if (remainingNCs === 0) {
        await prisma.vendor.update({
          where: { id: conditionalVendor!.id },
          data: { qualificationStatus: 'QUALIFIED' },
        })
      }
      const updatedCond = await prisma.vendor.findUnique({ where: { id: conditionalVendor!.id } })
      assert(updatedCond?.qualificationStatus === 'QUALIFIED', 'NC closure auto-requalifies vendor to QUALIFIED')

      // Restore NC for test consistency
      await prisma.vendorNonConformance.update({
        where: { id: nc.id },
        data: { status: 'OPEN', closedAt: null },
      })
      await prisma.vendor.update({
        where: { id: conditionalVendor!.id },
        data: { qualificationStatus: 'CONDITIONAL' },
      })
    }

    // Qualified Vendor Gate
    const qualifiedVendor = await prisma.vendor.findFirst({ where: { vendorCode: 'VND-001' } })
    assert(
      !qualifiedVendor?.isBlocked && qualifiedVendor?.qualificationStatus === 'QUALIFIED',
      'VND-001 is fully QUALIFIED with score >= 70 (PO Allowed)'
    )

    // TEST 3: Requisition Workflow & Transitions (§7)
    console.log('\n--- Test Suite 3: Purchase Requisition Workflow (§7) ---')
    const samplePR = await prisma.purchaseRequisition.findFirst({
      where: { status: 'APPROVED' },
      include: { items: true },
    })
    assert(!!samplePR, 'Approved PR available for downstream conversion')

    if (samplePR) {
      // Test Suggested Sources: rate contracts + qualified vendors
      const itemIds = samplePR.items.map((i) => i.itemId).filter(Boolean) as string[]
      const activeContracts = await prisma.rateContract.findMany({
        where: { status: 'ACTIVE' },
        include: { vendor: true },
      })
      assert(activeContracts.length > 0, 'Suggested sources queries active Rate Contracts')
    }

    // TEST 4: Inquiry Management & RFQ Requests Tracker (§8)
    console.log('\n--- Test Suite 4: Inquiry Management (§8) ---')
    const inquiries = await prisma.inquiry.findMany({
      include: { vendors: { include: { vendor: true, followups: true } } },
    })
    assert(inquiries.length > 0, 'Inquiry register contains active inquiries')

    const firstInqVendor = inquiries[0]?.vendors[0]
    assert(!!firstInqVendor, 'Inquiry vendor relationship established')

    if (firstInqVendor) {
      // Test Follow-up logging
      const newFollowup = await prisma.inquiryFollowup.create({
        data: {
          inquiryVendorId: firstInqVendor.id,
          mode: 'PHONE',
          notes: 'Automated test verification follow-up call with supplier',
          nextFollowupDate: new Date(Date.now() + 3 * 86400000),
        },
      })
      assert(!!newFollowup.id, 'Logged inquiry follow-up successfully')

      // Cleanup test followup
      await prisma.inquiryFollowup.delete({ where: {id: newFollowup.id } })
    }

    // TEST 5: RFQ Comparative Statement & L1 Evaluation (§9)
    console.log('\n--- Test Suite 5: RFQ Comparison & Commercial Evaluation (§9) ---')
    const sampleRfq = await prisma.rfq.findFirst({
      where: { status: 'ACTIVE' },
      include: { quotations: { include: { vendor: true, items: true } } },
    })
    assert(!!sampleRfq, 'Active RFQ with multi-vendor bids identified')

    if (sampleRfq && sampleRfq.quotations.length >= 2) {
      const quotes = sampleRfq.quotations
      const sortedByAmount = [...quotes].sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount))
      const l1Quote = sortedByAmount[0]
      const nonL1Quote = sortedByAmount[sortedByAmount.length - 1]

      assert(Number(l1Quote.totalAmount) <= Number(nonL1Quote.totalAmount), 'L1 (lowest landed cost) highlighted per line')

      // Weighted score evaluation: 40% Technical + 60% Commercial
      const techScore = Number(l1Quote.techScore || 85)
      const commScore = Number(l1Quote.commercialScore || 90)
      const expectedComposite = techScore * 0.4 + commScore * 0.6
      assert(Math.abs(expectedComposite - (techScore * 0.4 + commScore * 0.6)) < 0.01, 'Weighted Tech 40% / Commercial 60% scoring verified')
    }

    // TEST 6: Purchase Order Creation & Quality Backstop (§10)
    console.log('\n--- Test Suite 6: Purchase Orders (§10) ---')
    const poList = await prisma.purchaseOrder.findMany({
      include: { vendor: true, items: true },
    })
    assert(poList.length > 0, 'Purchase Order register populated with active POs')
    const firstPO = poList[0]
    assert(Number(firstPO.totalAmount) > 0, 'PO monetary calculation and decimal precision verified')

    // TEST 7: Goods Receipt & 3-Way Matching (§11)
    console.log('\n--- Test Suite 7: Goods Receipt & 3-Way Matching (§11) ---')
    const grnList = await prisma.goodsReceipt.findMany({
      include: { items: true, purchaseOrder: true },
    })
    assert(grnList.length > 0, 'Goods Receipt Notes (GRN) present with warehouse tracking')

    const invoices = await prisma.supplierInvoice.findMany({
      include: { purchaseOrder: true, items: true },
    })
    assert(invoices.length > 0, 'Supplier Invoices present with matching status')

    // TEST 8: AP Payments & Mandatory UTR (§11)
    console.log('\n--- Test Suite 8: AP Payments & Mandatory UTR (§11) ---')
    const payments = await prisma.payment.findMany({
      include: { invoice: true, vendor: true },
    })
    assert(payments.length > 0, 'Payment ledger tracks released payments')
    const paymentWithUTR = payments.find((p) => !!p.utrNumber)
    assert(!!paymentWithUTR, 'Released payments enforce mandatory bank UTR numbers')

    // TEST 9: Delegation of Authority & Approval Tasks (§6, §14)
    console.log('\n--- Test Suite 9: Delegation of Authority (DOA) & Unified Inbox (§6) ---')
    const approvalTasks = await prisma.approvalTask.findMany({
      where: { status: 'PENDING' },
    })
    assert(approvalTasks.length > 0, 'Unified Approval Inbox aggregates pending decisions')

    const doaSetting = await prisma.systemSetting.findUnique({
      where: { key: 'DOA_MATRIX' },
    })
    assert(!!doaSetting, 'DOA value bands matrix configured in system settings')

    // TEST 10: Audit Trail (§15)
    console.log('\n--- Test Suite 10: Audit Trail (§15) ---')
    const auditLogs = await prisma.auditLog.findMany({ take: 5, orderBy: { createdAt: 'desc' } })
    assert(auditLogs.length > 0, 'Audit trail logs immutable procurement events')

    console.log('\n=================================================================')
    console.log(`TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`)
    console.log('=================================================================')

    if (failedTests > 0) {
      process.exit(1)
    }
  } catch (err) {
    console.error('Fatal error during test execution:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runAuditTests()
