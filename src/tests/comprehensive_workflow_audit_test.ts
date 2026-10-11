import { prisma } from '../lib/prisma.js'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'slt-procurement-jwt-secret-key-2026'
const API_URL = 'http://localhost:5000/api/v1'

interface StepResult {
  step: number
  workflow: string
  action: string
  expected: string
  actual: string
  status: 'PASS' | 'FAIL'
}

const auditResults: StepResult[] = []

function recordStep(
  step: number,
  workflow: string,
  action: string,
  expected: string,
  actual: string,
  status: 'PASS' | 'FAIL'
) {
  auditResults.push({ step, workflow, action, expected, actual, status })
  const tag = status === 'PASS' ? '[PASS]' : '[FAIL]'
  console.log(`${tag} Step ${step} [${workflow}] ${action} -> ${actual}`)
}

async function runComprehensiveWorkflowAudit() {
  console.log('========================================================================')
  console.log('  SLT PROCUREMENT SUITE – COMPREHENSIVE END-TO-END WORKFLOW AUDIT TEST  ')
  console.log('========================================================================\n')

  let stepNumber = 1

  try {
    // -------------------------------------------------------------------------
    // WORKFLOW 1: Authentication & Authorization Flow
    // -------------------------------------------------------------------------
    console.log('>>> WORKFLOW 1: Authentication & User Journeys')

    // Step 1.1: Negative Login (Invalid Password)
    const badLoginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@sltprocure.com', password: 'wrongpassword' }),
    })
    const badLoginData = (await badLoginRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Authentication',
      'Login with invalid password',
      'HTTP 401 Unauthorized',
      `HTTP ${badLoginRes.status} (${badLoginData.message || 'Rejected'})`,
      badLoginRes.status === 401 ? 'PASS' : 'FAIL'
    )

    // Step 1.2: Valid Admin Login
    const adminLoginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@sltprocure.com', password: 'Admin@123' }),
    })
    const adminLoginData = (await adminLoginRes.json().catch(() => ({}))) as any
    const adminToken = adminLoginData.token || adminLoginData.data?.token
    const adminUser = adminLoginData.user || adminLoginData.data?.user
    recordStep(
      stepNumber++,
      'Authentication',
      'Admin Login (admin@sltprocure.com)',
      'HTTP 200 with JWT token and user profile',
      `HTTP ${adminLoginRes.status}, Token: ${!!adminToken ? 'Received' : 'Missing'}, User: ${adminUser?.fullName}`,
      adminLoginRes.status === 200 && !!adminToken ? 'PASS' : 'FAIL'
    )

    // Step 1.3: Procurement Officer Login
    const execLoginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'officer@sltprocure.com', password: 'Officer@123' }),
    })
    const execLoginData = (await execLoginRes.json().catch(() => ({}))) as any
    const execToken = execLoginData.token || execLoginData.data?.token
    const execUser = execLoginData.user || execLoginData.data?.user
    recordStep(
      stepNumber++,
      'Authentication',
      'Procurement Officer Login (officer@sltprocure.com)',
      'HTTP 200 with JWT token',
      `HTTP ${execLoginRes.status}, User: ${execUser?.fullName}`,
      execLoginRes.status === 200 && !!execToken ? 'PASS' : 'FAIL'
    )

    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminToken}`,
    }

    // Step 1.4: Verify Token Session (/auth/me)
    const meRes = await fetch(`${API_URL}/auth/me`, { headers: authHeaders })
    const meData = (await meRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Authentication',
      'Verify active session (/auth/me)',
      'HTTP 200 with authenticated user context',
      `HTTP ${meRes.status}, Authenticated as: ${(meData.user || meData.data)?.fullName} (${(meData.user || meData.data)?.role})`,
      meRes.status === 200 && (meData.user || meData.data)?.email === 'admin@sltprocure.com' ? 'PASS' : 'FAIL'
    )

    // -------------------------------------------------------------------------
    // WORKFLOW 2: Purchase Requisition (PR) to RFQ / PO Flow (§7)
    // -------------------------------------------------------------------------
    console.log('\n>>> WORKFLOW 2: Purchase Requisition (PR) Demand Lifecycle (§7)')

    const sampleItem = await prisma.item.findFirst()
    const costCenter = await prisma.budgetControl.findFirst()

    // Step 2.1: Create PR with Line Items
    const prPayload = {
      title: 'Precision Tooling Requisition for Q3 Machine Maintenance',
      department: 'Production',
      costCenterId: costCenter?.id,
      priority: 'HIGH',
      notes: 'Urgent replacement carbide inserts required for CNC line',
      items: [
        {
          itemId: sampleItem?.id,
          description: sampleItem?.name || 'Tungsten Carbide Milling Insert',
          quantity: 50,
          estimatedUnitPrice: 450,
          uom: sampleItem?.uom || 'NOS',
        },
      ],
    }

    const createPrRes = await fetch(`${API_URL}/requisitions`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(prPayload),
    })
    const createPrData = (await createPrRes.json().catch(() => ({}))) as any
    const createdPR = createPrData.data
    recordStep(
      stepNumber++,
      'Purchase Requisitions',
      'Create new Purchase Requisition with items',
      'HTTP 201, PR saved with status PENDING_APPROVAL and ApprovalTask created',
      `HTTP ${createPrRes.status}, PR: ${createdPR?.prNumber}, Status: ${createdPR?.status}, Amount: ₹${createdPR?.totalEstimatedAmount}`,
      createPrRes.status === 201 && createdPR?.prNumber ? 'PASS' : 'FAIL'
    )

    // Step 2.2: Verify Approval Task exists in Unified Inbox
    const approvalTask = await prisma.approvalTask.findFirst({
      where: { entityType: 'PURCHASE_REQUISITION', entityId: createdPR.id },
    })
    recordStep(
      stepNumber++,
      'Approval Inbox',
      'Verify PR routed to Unified Approval Inbox',
      'ApprovalTask created with status PENDING',
      `Task ID: ${approvalTask?.id || 'Not Found'}, Status: ${approvalTask?.status}`,
      approvalTask?.status === 'PENDING' ? 'PASS' : 'FAIL'
    )

    // Step 2.3: Approve PR in Approval Inbox
    const decidePrRes = await fetch(`${API_URL}/approvals/${approvalTask?.id}/decide`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ decision: 'APPROVE', comments: 'Budget and technical specs verified, approved.' }),
    })
    const decidePrData = (await decidePrRes.json().catch(() => ({}))) as any
    const updatedPR = await prisma.purchaseRequisition.findUnique({ where: { id: createdPR.id } })
    recordStep(
      stepNumber++,
      'Purchase Requisitions',
      'Approve Requisition via Approval Inbox',
      'HTTP 200, PR status transitions to APPROVED',
      `HTTP ${decidePrRes.status}, PR Status: ${updatedPR?.status}`,
      decidePrRes.status === 200 && updatedPR?.status === 'APPROVED' ? 'PASS' : 'FAIL'
    )

    // Step 2.4: Convert Approved PR into RFQ (§7)
    const issueRfqRes = await fetch(`${API_URL}/requisitions/${createdPR.id}/issue-rfq`, {
      method: 'POST',
      headers: authHeaders,
    })
    const issueRfqData = (await issueRfqRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Purchase Requisitions',
      'Issue RFQ from Approved PR',
      'HTTP 201, RFQ generated and linked to PR',
      `HTTP ${issueRfqRes.status}, RFQ Number: ${issueRfqData.data?.rfqNumber}`,
      issueRfqRes.status === 201 && !!issueRfqData.data?.rfqNumber ? 'PASS' : 'FAIL'
    )

    // -------------------------------------------------------------------------
    // WORKFLOW 3: Inquiry Management & Sourcing (§8)
    // -------------------------------------------------------------------------
    console.log('\n>>> WORKFLOW 3: Inquiry Management, RFQ Tracking & Follow-ups (§8)')

    const qualifiedVendors = await prisma.vendor.findMany({
      where: { isBlocked: false, qualificationStatus: 'QUALIFIED' },
      take: 2,
    })

    // Step 3.1: Create Inquiry with Multi-Vendor Invitation
    const inquiryPayload = {
      fgPartName: 'Steering Knuckle SK-400',
      fgPartNo: 'SK-400-REV3',
      customer: 'Tata Motors Commercial',
      customerTargetPrice: 2850,
      requestType: 'Subcontracting',
      itemId: sampleItem?.id,
      quantity: 150,
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      drawingSpec: 'DRG-SK-400-TATA-R3',
      vendorIds: qualifiedVendors.map((v) => v.id),
      notes: 'Inquiry for high-precision machining of forged steering knuckle',
    }

    const createInqRes = await fetch(`${API_URL}/inquiries`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(inquiryPayload),
    })
    const createInqData = (await createInqRes.json().catch(() => ({}))) as any
    const createdInquiry = createInqData.data
    recordStep(
      stepNumber++,
      'Inquiry Management',
      'Create New Inquiry Wizard (§8.3)',
      'HTTP 201, Inquiry registered with vendor invitations',
      `HTTP ${createInqRes.status}, Inquiry: ${createdInquiry?.inquiryNumber}, Vendors: ${qualifiedVendors.length}`,
      createInqRes.status === 201 && !!createdInquiry?.inquiryNumber ? 'PASS' : 'FAIL'
    )

    // Step 3.2: Query Flattened RFQ Requests Tracker (§8.1)
    const rfqRequestsRes = await fetch(`${API_URL}/inquiries/rfq-requests`, { headers: authHeaders })
    const rfqRequestsData = (await rfqRequestsRes.json().catch(() => ({}))) as any
    const targetRequestLine = (rfqRequestsData.data || []).find((r: any) => r.inquiryId === createdInquiry.id)
    recordStep(
      stepNumber++,
      'Inquiry Management',
      'View Flattened RFQ Requests Tracker (§8.1)',
      'HTTP 200, returns line-level request tracking records',
      `HTTP ${rfqRequestsRes.status}, Target Line Found: ${!!targetRequestLine}, Status: ${targetRequestLine?.status}`,
      rfqRequestsRes.status === 200 && !!targetRequestLine ? 'PASS' : 'FAIL'
    )

    // Step 3.3: Mark RFQ Mail Sent & Start Follow-up Tracking (§8.2)
    const sendMailRes = await fetch(`${API_URL}/inquiries/rfq-requests/${targetRequestLine?.id}/send-mail`, {
      method: 'POST',
      headers: authHeaders,
    })
    const sendMailData = (await sendMailRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Inquiry Management',
      'Generate & Mark RFQ Mail Sent (§8.2)',
      'HTTP 200, mailSent=true and auto-followup created',
      `HTTP ${sendMailRes.status}, mailSent: ${sendMailData.data?.mailSent}`,
      sendMailRes.status === 200 && sendMailData.data?.mailSent === true ? 'PASS' : 'FAIL'
    )

    // Step 3.4: Log Supplier Follow-up
    const followupRes = await fetch(`${API_URL}/inquiries/rfq-requests/${targetRequestLine?.id}/followups`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        mode: 'PHONE',
        notes: 'Followed up with supplier sales rep. Quotation promised by tomorrow EOD.',
        nextFollowupDate: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
      }),
    })
    const followupData = (await followupRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Inquiry Management',
      'Log Supplier Follow-up (§8.1)',
      'HTTP 201, follow-up history record created',
      `HTTP ${followupRes.status}, Mode: ${followupData.data?.mode}`,
      followupRes.status === 201 && !!followupData.data?.id ? 'PASS' : 'FAIL'
    )

    // Step 3.5: Mark Status as QUOTED with Offered Price
    const markQuotedRes = await fetch(`${API_URL}/inquiries/rfq-requests/${targetRequestLine?.id}/status`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({
        status: 'QUOTED',
        offeredPrice: 2650,
        leadTimeDays: 10,
        moq: 50,
        paymentTerms: 'Net 30',
        notes: 'Competitive quote received within customer target price.',
      }),
    })
    const markQuotedData = (await markQuotedRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Inquiry Management',
      'Mark Status QUOTED with Offered Price (§8.1)',
      'HTTP 200, offeredPrice recorded and status updated',
      `HTTP ${markQuotedRes.status}, Status: ${markQuotedData.data?.status}, Offered Price: ₹${markQuotedData.data?.offeredPrice}`,
      markQuotedRes.status === 200 && markQuotedData.data?.status === 'QUOTED' ? 'PASS' : 'FAIL'
    )

    // Step 3.6: Award & Release PO directly from Inquiry (§8, §14)
    const releasePoRes = await fetch(`${API_URL}/inquiries/rfq-requests/${targetRequestLine?.id}/release-po`, {
      method: 'POST',
      headers: authHeaders,
    })
    const releasePoData = (await releasePoRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Inquiry Management',
      'Award Quote & Release PO from Inquiry (§8, §14)',
      'HTTP 201, Purchase Order generated and Inquiry closed',
      `HTTP ${releasePoRes.status}, PO Number: ${releasePoData.data?.poNumber}, Amount: ₹${releasePoData.data?.totalAmount}`,
      releasePoRes.status === 201 && !!releasePoData.data?.poNumber ? 'PASS' : 'FAIL'
    )

    // -------------------------------------------------------------------------
    // WORKFLOW 4: RFQ Quotation Comparison & Commercial Evaluation (§9)
    // -------------------------------------------------------------------------
    console.log('\n>>> WORKFLOW 4: RFQ Quotation Comparison & L1 Evaluation (§9)')

    const existingRfq = await prisma.rfq.findFirst({
      where: { quotations: { some: {} } },
      include: { quotations: { include: { vendor: true } } },
    })

    if (existingRfq) {
      // Step 4.1: View Comparative Statement Matrix
      const compareRes = await fetch(`${API_URL}/rfqs/${existingRfq.id}/compare`, { headers: authHeaders })
      const compareData = (await compareRes.json().catch(() => ({}))) as any
      recordStep(
        stepNumber++,
        'RFQ Comparison',
        'Fetch Comparative Statement Matrix (§9)',
        'HTTP 200, returns line-level L1 comparison and weighted scores',
        `HTTP ${compareRes.status}, Quotes: ${compareData.data?.quotes?.length}, L1: ₹${compareData.data?.summary?.l1Quote}`,
        compareRes.status === 200 && !!compareData.data?.summary ? 'PASS' : 'FAIL'
      )

      // Step 4.2: Negative Test: Award Non-L1 Quote Without Justification
      const quotes = existingRfq.quotations
      if (quotes.length >= 2) {
        const sortedQuotes = [...quotes].sort((a, b) => Number(a.totalAmount) - Number(b.totalAmount))
        const nonL1Quote = sortedQuotes[sortedQuotes.length - 1]

        const badAwardRes = await fetch(`${API_URL}/rfqs/${existingRfq.id}/award`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            quoteId: nonL1Quote.id,
            vendorId: nonL1Quote.vendorId,
            awardJustification: '', // empty justification!
          }),
        })
        const badAwardData = (await badAwardRes.json().catch(() => ({}))) as any
        recordStep(
          stepNumber++,
          'RFQ Comparison',
          'Negative Test: Award Non-L1 quote without written justification',
          'HTTP 400 Bad Request (Mandatory justification enforced §9)',
          `HTTP ${badAwardRes.status} (${badAwardData.message})`,
          badAwardRes.status === 400 ? 'PASS' : 'FAIL'
        )

        // Step 4.3: Valid L1 Award & PO Creation
        const l1Quote = sortedQuotes[0]
        const goodAwardRes = await fetch(`${API_URL}/rfqs/${existingRfq.id}/award`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            quoteId: l1Quote.id,
            vendorId: l1Quote.vendorId,
            awardJustification: 'Lowest evaluated commercial bid meeting all technical criteria (L1)',
            autoCreatePO: true,
          }),
        })
        const goodAwardData = (await goodAwardRes.json().catch(() => ({}))) as any
        const poCreated = goodAwardData.data?.purchaseOrder || goodAwardData.data?.po
        recordStep(
          stepNumber++,
          'RFQ Comparison',
          'Award L1 Quote and auto-generate Purchase Order',
          'HTTP 200, RFQ status=AWARDED, PO created with quoted rates',
          `HTTP ${goodAwardRes.status}, PO Number: ${poCreated?.poNumber}, RFQ ID: ${goodAwardData.data?.rfqId}`,
          goodAwardRes.status === 200 && !!poCreated?.poNumber ? 'PASS' : 'FAIL'
        )
      }
    }

    // -------------------------------------------------------------------------
    // WORKFLOW 5: Purchase Orders & Quality Gate Enforcement (§10, §12)
    // -------------------------------------------------------------------------
    console.log('\n>>> WORKFLOW 5: Purchase Orders & Quality Gate Backstop (§10, §12)')

    const blockedVendor = await prisma.vendor.findFirst({ where: { vendorCode: 'VND-006' } })
    const conditionalVendor = await prisma.vendor.findFirst({ where: { vendorCode: 'VND-005' } })
    const qualifiedVendor = await prisma.vendor.findFirst({ where: { vendorCode: 'VND-001' } })

    // Step 5.1: Negative Test: Create PO for Blocked Vendor (Quality Gate)
    const blockedPoRes = await fetch(`${API_URL}/purchase-orders`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        vendorId: blockedVendor?.id,
        totalAmount: 45000,
        items: [{ description: 'Blocked Material', quantity: 10, unitPrice: 4500 }],
      }),
    })
    const blockedPoData = (await blockedPoRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Purchase Orders',
      'Negative Test: Attempt PO creation for Blocked Vendor (VND-006)',
      'HTTP 403 Forbidden (Quality Gate blocks blocked vendors §12)',
      `HTTP ${blockedPoRes.status} (${blockedPoData.message})`,
      blockedPoRes.status === 403 ? 'PASS' : 'FAIL'
    )

    // Step 5.2: Negative Test: Create PO for Conditional Vendor with Open NC (Quality Gate)
    const condPoRes = await fetch(`${API_URL}/purchase-orders`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        vendorId: conditionalVendor?.id,
        totalAmount: 25000,
        items: [{ description: 'Conditional Material', quantity: 10, unitPrice: 2500 }],
      }),
    })
    const condPoData = (await condPoRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Purchase Orders',
      'Negative Test: Attempt PO creation for Conditional Vendor with Open NC (VND-005)',
      'HTTP 403 Forbidden (Quality Gate blocks open NCs §12)',
      `HTTP ${condPoRes.status} (${condPoData.message})`,
      condPoRes.status === 403 ? 'PASS' : 'FAIL'
    )

    // Step 5.3: Valid PO Creation for Fully Qualified Vendor
    const validPoRes = await fetch(`${API_URL}/purchase-orders`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        vendorId: qualifiedVendor?.id,
        paymentTerms: 'Net 30',
        totalAmount: 18000,
        items: [{ description: 'High Precision CNC Milling Inserts', quantity: 100, unitPrice: 180 }],
      }),
    })
    const validPoData = (await validPoRes.json().catch(() => ({}))) as any
    const createdPO = validPoData.data
    recordStep(
      stepNumber++,
      'Purchase Orders',
      'Create PO for Qualified Vendor (VND-001)',
      'HTTP 201 Created with status APPROVED',
      `HTTP ${validPoRes.status}, PO Number: ${createdPO?.poNumber}, Vendor: ${createdPO?.vendor?.name}`,
      validPoRes.status === 201 && !!createdPO?.poNumber ? 'PASS' : 'FAIL'
    )

    // -------------------------------------------------------------------------
    // WORKFLOW 6: Goods Receipt Note (GRN) Inward Dock Process (§11)
    // -------------------------------------------------------------------------
    console.log('\n>>> WORKFLOW 6: Goods Receipt Note (GRN) & Traceability (§11)')

    const grnPayload = {
      poId: createdPO.id,
      deliveryNoteNumber: `DN-${Date.now().toString().slice(-6)}`,
      vehicleNumber: 'MH-12-QZ-4590',
      warehouse: 'Bengaluru Central Plant - Stores Bay 3',
      batchNumber: 'BAT-2026-09A',
      heatNumber: 'HEAT-9812-SS',
      remarks: 'Goods received in excellent condition with manufacturer MTC',
      items: [
        {
          poItemId: createdPO.items[0]?.id,
          quantityReceived: 100,
          quantityAccepted: 100,
          quantityRejected: 0,
        },
      ],
    }

    const createGrnRes = await fetch(`${API_URL}/goods-receipts`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(grnPayload),
    })
    const createGrnData = (await createGrnRes.json().catch(() => ({}))) as any
    const createdGRN = createGrnData.data
    const reloadedPO = await prisma.purchaseOrder.findUnique({ where: { id: createdPO.id } })
    recordStep(
      stepNumber++,
      'Goods Receipt (GRN)',
      'Post Goods Receipt against Approved PO (§11)',
      'HTTP 201, GRN created and PO transitions to PARTIALLY_RECEIVED',
      `HTTP ${createGrnRes.status}, GRN: ${createdGRN?.grnNumber}, PO Status: ${reloadedPO?.status}`,
      createGrnRes.status === 201 && reloadedPO?.status === 'PARTIALLY_RECEIVED' ? 'PASS' : 'FAIL'
    )

    // -------------------------------------------------------------------------
    // WORKFLOW 7: Supplier Invoicing & Automated 3-Way Match (§11)
    // -------------------------------------------------------------------------
    console.log('\n>>> WORKFLOW 7: Supplier Invoicing & 3-Way Matching (§11)')

    // Step 7.1: Perfect 3-Way Match Invoice
    const perfectInvPayload = {
      poId: createdPO.id,
      invoiceNumber: `INV-TEST-PERFECT-${Date.now().toString().slice(-5)}`,
      supplierInvoiceRef: `GST/2026/${Date.now().toString().slice(-4)}`,
      subtotal: 18000,
      taxAmount: 3240,
      totalAmount: 21240,
      items: [
        {
          poItemId: createdPO.items[0]?.id,
          description: 'High Precision CNC Milling Inserts',
          quantityBilled: 100,
          unitPrice: 180, // exact match with PO rate!
          totalPrice: 18000,
        },
      ],
    }

    const perfectInvRes = await fetch(`${API_URL}/supplier-invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(perfectInvPayload),
    })
    const perfectInvData = (await perfectInvRes.json().catch(() => ({}))) as any
    const perfectInv = perfectInvData.data
    recordStep(
      stepNumber++,
      'Supplier Invoices',
      'Submit Matching Invoice (Automated 3-Way Match §11)',
      'HTTP 201, matchStatus=MATCHED_3_WAY, status=APPROVED, hasException=false',
      `HTTP ${perfectInvRes.status}, Match: ${perfectInv?.matchStatus}, Status: ${perfectInv?.status}`,
      perfectInvRes.status === 201 && perfectInv?.matchStatus === 'MATCHED_3_WAY' && perfectInv?.hasException === false
        ? 'PASS'
        : 'FAIL'
    )

    // Step 7.2: Variance Exception Invoice (Price Variance > 5%)
    const varianceInvPayload = {
      poId: createdPO.id,
      invoiceNumber: `INV-TEST-VAR-${Date.now().toString().slice(-5)}`,
      supplierInvoiceRef: `GST/VAR/${Date.now().toString().slice(-4)}`,
      subtotal: 25000,
      taxAmount: 4500,
      totalAmount: 29500,
      items: [
        {
          poItemId: createdPO.items[0]?.id,
          description: 'High Precision CNC Milling Inserts',
          quantityBilled: 100,
          unitPrice: 250, // 38% higher than PO rate of 180!
          totalPrice: 25000,
        },
      ],
    }

    const varianceInvRes = await fetch(`${API_URL}/supplier-invoices`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(varianceInvPayload),
    })
    const varianceInvData = (await varianceInvRes.json().catch(() => ({}))) as any
    const varianceInv = varianceInvData.data
    recordStep(
      stepNumber++,
      'Supplier Invoices',
      'Submit Invoice with Rate Variance Exception (§11)',
      'HTTP 201, matchStatus=PRICE_VARIANCE, hasException=true, routed to Inbox',
      `HTTP ${varianceInvRes.status}, Match: ${varianceInv?.matchStatus}, hasException: ${varianceInv?.hasException}`,
      varianceInvRes.status === 201 && varianceInv?.hasException === true ? 'PASS' : 'FAIL'
    )

    // -------------------------------------------------------------------------
    // WORKFLOW 8: AP Payments & Mandatory UTR Enforcement (§11)
    // -------------------------------------------------------------------------
    console.log('\n>>> WORKFLOW 8: Accounts Payable & Electronic Disbursement (§11)')

    // Step 8.1: Negative Test: Attempt Payment on Invoice with Active Exception
    const badExceptionPaymentRes = await fetch(`${API_URL}/payments/release`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: varianceInv.id,
        amount: 29500,
        paymentMethod: 'RTGS',
        referenceNumber: 'HDFCR520261011009182',
      }),
    })
    const badExceptionPaymentData = (await badExceptionPaymentRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'AP Payments',
      'Negative Test: Attempt payment on invoice with unresolved 3-Way Match exception',
      'HTTP 400 Bad Request (Blocked until exception approved §11)',
      `HTTP ${badExceptionPaymentRes.status} (${badExceptionPaymentData.message})`,
      badExceptionPaymentRes.status === 400 ? 'PASS' : 'FAIL'
    )

    // Step 8.2: Negative Test: Attempt Payment without Mandatory UTR Number
    const noUtrPaymentRes = await fetch(`${API_URL}/payments/release`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: perfectInv.id,
        amount: 21240,
        paymentMethod: 'RTGS',
        referenceNumber: 'UTR', // too short (< 6 chars)
      }),
    })
    const noUtrPaymentData = (await noUtrPaymentRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'AP Payments',
      'Negative Test: Attempt payment release without valid mandatory bank UTR',
      'HTTP 400 Bad Request (Mandatory UTR enforced §11)',
      `HTTP ${noUtrPaymentRes.status} (${noUtrPaymentData.message || 'Validation Error'})`,
      noUtrPaymentRes.status === 400 ? 'PASS' : 'FAIL'
    )

    // Step 8.3: Valid Payment Release with Bank UTR
    const validPaymentRes = await fetch(`${API_URL}/payments/release`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        invoiceId: perfectInv.id,
        amount: 21240,
        paymentMethod: 'RTGS',
        referenceNumber: 'HDFCR5202610110048129',
        notes: 'RTGS disbursement authorized against matched 3-way invoice',
      }),
    })
    const validPaymentData = (await validPaymentRes.json().catch(() => ({}))) as any
    const reloadedInv = await prisma.supplierInvoice.findUnique({ where: { id: perfectInv.id } })
    recordStep(
      stepNumber++,
      'AP Payments',
      'Release Payment with Mandatory Bank UTR (§11)',
      'HTTP 201, Payment completed and Invoice locked to PAID',
      `HTTP ${validPaymentRes.status}, Payment: ${validPaymentData.data?.paymentNumber}, Inv Status: ${reloadedInv?.status}`,
      validPaymentRes.status === 201 && reloadedInv?.status === 'PAID' ? 'PASS' : 'FAIL'
    )

    // -------------------------------------------------------------------------
    // WORKFLOW 9: Vendor Audit, Non-Conformance & Re-qualification (§12)
    // -------------------------------------------------------------------------
    console.log('\n>>> WORKFLOW 9: Vendor Audit, Non-Conformance & Re-qualification (§12)')

    // Step 9.1: Conduct Weighted Vendor Audit (6 Parameters)
    const auditPayload = {
      vendorId: qualifiedVendor!.id,
      auditType: 'ON_SITE',
      qmsScore: 92, // 20% -> 18.4
      processScore: 88, // 20% -> 17.6
      infrastructureScore: 90, // 15% -> 13.5
      traceabilityScore: 85, // 15% -> 12.75
      deliveryScore: 90, // 15% -> 13.5
      documentationScore: 90, // 15% -> 13.5
      attachmentName: 'Audit-Report-VND001-Oct2026.pdf',
      remarks: 'Comprehensive on-site facility audit completed with excellent controls',
    }

    const auditRes = await fetch(`${API_URL}/vendor-audits`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(auditPayload),
    })
    const auditData = (await auditRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Vendor Audit',
      'Conduct Weighted Vendor Audit (6 Parameters §12)',
      'HTTP 201, totalScore calculated to 89, vendor status QUALIFIED',
      `HTTP ${auditRes.status}, Total Score: ${auditData.data?.totalScore}, Status: ${auditData.data?.resultStatus}`,
      auditRes.status === 201 && Number(auditData.data?.totalScore) >= 70 ? 'PASS' : 'FAIL'
    )

    // Step 9.2: Block and Unblock Vendor Workflow
    const blockRes = await fetch(`${API_URL}/vendors/${qualifiedVendor!.id}/block`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'Temporary quality surveillance hold' }),
    })
    const blockData = (await blockRes.json().catch(() => ({}))) as any
    const blockedVnd = await prisma.vendor.findUnique({ where: { id: qualifiedVendor!.id } })
    recordStep(
      stepNumber++,
      'Vendor Audit',
      'Block Vendor by Quality (§12)',
      'HTTP 200, vendor marked as isBlocked=true',
      `HTTP ${blockRes.status}, isBlocked: ${blockedVnd?.isBlocked}`,
      blockedVnd?.isBlocked === true ? 'PASS' : 'FAIL'
    )

    const unblockRes = await fetch(`${API_URL}/vendors/${qualifiedVendor!.id}/unblock`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ reason: 'Surveillance cleared by Lead Auditor' }),
    })
    const unblockedVnd = await prisma.vendor.findUnique({ where: { id: qualifiedVendor!.id } })
    recordStep(
      stepNumber++,
      'Vendor Audit',
      'Unblock Vendor and Reinstate Eligibility (§12)',
      'HTTP 200, vendor isBlocked=false and re-qualified',
      `HTTP ${unblockRes.status}, isBlocked: ${unblockedVnd?.isBlocked}`,
      unblockedVnd?.isBlocked === false ? 'PASS' : 'FAIL'
    )

    // -------------------------------------------------------------------------
    // WORKFLOW 10: Masters, Control Tower & Governance (§14, §15)
    // -------------------------------------------------------------------------
    console.log('\n>>> WORKFLOW 10: Masters, Control Tower & Governance (§14, §15)')

    // Step 10.1: Control Tower Dashboard Metrics
    const dashRes = await fetch(`${API_URL}/dashboard/control-tower`, { headers: authHeaders })
    const dashData = (await unblockRes.json().catch(() => ({}))) as any
    recordStep(
      stepNumber++,
      'Control Tower Dashboard',
      'Query Control Tower Cockpit Metrics (§6)',
      'HTTP 200, returns 6 KPI tiles, aging snapshot, spend trend, funnel',
      `HTTP ${dashRes.status}, Open PRs: ${dashData.summary?.openRequisitions || dashData.data?.openRequisitions}, Funnel Stages: ${(dashData.summary?.s2pFunnel || dashData.data?.s2pFunnel || []).length}`,
      dashRes.status === 200 && !!(dashData.summary || dashData.data) ? 'PASS' : 'FAIL'
    )

    // Step 10.2: Settings & Governance Matrix (§15)
    const settingsRes = await fetch(`${API_URL}/settings`, { headers: authHeaders })
    const settingsData = (await settingsRes.json().catch(() => ({}))) as any
    const doaIsArray = Array.isArray(settingsData.data?.delegationOfAuthority)
    recordStep(
      stepNumber++,
      'System Settings',
      'Query System Governance & DOA Value Bands (§15)',
      'HTTP 200, delegationOfAuthority normalized as Array of value bands',
      `HTTP ${settingsRes.status}, DOA Is Array: ${doaIsArray}, Locked Controls: ${settingsData.data?.lockedControls?.length}`,
      settingsRes.status === 200 && doaIsArray ? 'PASS' : 'FAIL'
    )

    // Step 10.3: Audit Trail Verification (§15)
    const auditLogsCount = await prisma.auditLog.count()
    recordStep(
      stepNumber++,
      'Audit Trail',
      'Verify Immutable Audit Trail Logging across all workflows (§15)',
      'AuditLog records all critical business transactions',
      `Total Logged Audit Events: ${auditLogsCount}`,
      auditLogsCount >= 10 ? 'PASS' : 'FAIL'
    )

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log('\n========================================================================')
    const passedCount = auditResults.filter((r) => r.status === 'PASS').length
    const failedCount = auditResults.filter((r) => r.status === 'FAIL').length
    console.log(`TOTAL WORKFLOW STEPS TESTED: ${auditResults.length}`)
    console.log(`PASSED: ${passedCount}`)
    console.log(`FAILED: ${failedCount}`)
    console.log('========================================================================')

    if (failedCount > 0) {
      process.exit(1)
    }
  } catch (error) {
    console.error('Fatal error during workflow audit test:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

runComprehensiveWorkflowAudit()
