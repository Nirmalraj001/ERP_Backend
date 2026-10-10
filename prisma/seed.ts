import { Role, UserStatus, VendorStatus, PRPriority, PRStatus, InquiryStatus, POStatus, GRNStatus, InvoiceStatus, MatchStatus, PaymentStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/lib/prisma.js'

async function main() {
  console.log('--- Seeding SLT Procurement Suite Database with Complete Enterprise Indian Data ---')

  // 1. Clean existing records in sequence
  await prisma.systemSetting.deleteMany()
  await prisma.inquiryFollowup.deleteMany()
  await prisma.vendorNonConformance.deleteMany()
  await prisma.vendorAudit.deleteMany()
  await prisma.approvalHistory.deleteMany()
  await prisma.approvalTask.deleteMany()
  await prisma.payment.deleteMany()
  await prisma.supplierInvoiceItem.deleteMany()
  await prisma.supplierInvoice.deleteMany()
  await prisma.goodsReceiptItem.deleteMany()
  await prisma.goodsReceipt.deleteMany()
  await prisma.purchaseOrderItem.deleteMany()
  await prisma.purchaseOrder.deleteMany()
  await prisma.quotationItem.deleteMany()
  await prisma.quotation.deleteMany()
  await prisma.rfq.deleteMany()
  await prisma.inquiryVendor.deleteMany()
  await prisma.inquiry.deleteMany()
  await prisma.requisitionItem.deleteMany()
  await prisma.purchaseRequisition.deleteMany()
  await prisma.rateContractItem.deleteMany()
  await prisma.rateContract.deleteMany()
  await prisma.vendorQualification.deleteMany()
  await prisma.vendorPerformance.deleteMany()
  await prisma.vendorContact.deleteMany()
  await prisma.vendor.deleteMany()
  await prisma.item.deleteMany()
  await prisma.itemCategory.deleteMany()
  await prisma.budgetControl.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.user.deleteMany()

  // 2. Hash default passwords
  const adminPassword = await bcrypt.hash('Admin@123', 10)
  const userPassword = await bcrypt.hash('User@123', 10)
  const approverPassword = await bcrypt.hash('Approver@123', 10)
  const officerPassword = await bcrypt.hash('Officer@123', 10)
  const financePassword = await bcrypt.hash('Finance@123', 10)

  // 3. Seed Users (Matching manual roles §2.3)
  const admin = await prisma.user.create({
    data: {
      email: 'admin@sltprocure.com',
      passwordHash: adminPassword,
      fullName: 'Rajesh Sharma',
      role: Role.ADMIN,
      department: 'Management',
      status: UserStatus.ACTIVE,
    },
  })

  const approver = await prisma.user.create({
    data: {
      email: 'approver@sltprocure.com',
      passwordHash: approverPassword,
      fullName: 'Vikram Malhotra',
      role: Role.APPROVER,
      department: 'Purchase Manager',
      status: UserStatus.ACTIVE,
    },
  })

  const officer = await prisma.user.create({
    data: {
      email: 'officer@sltprocure.com',
      passwordHash: officerPassword,
      fullName: 'Amit Patel',
      role: Role.PROCUREMENT_OFFICER,
      department: 'Purchase Executive',
      status: UserStatus.ACTIVE,
    },
  })

  const finance = await prisma.user.create({
    data: {
      email: 'finance@sltprocure.com',
      passwordHash: financePassword,
      fullName: 'Priya Sundaram',
      role: Role.FINANCE_OFFICER,
      department: 'Accounts',
      status: UserStatus.ACTIVE,
    },
  })

  const requester = await prisma.user.create({
    data: {
      email: 'requester@sltprocure.com',
      passwordHash: userPassword,
      fullName: 'Suresh Kumar',
      role: Role.DEPARTMENT_USER,
      department: 'Stores / Plant Operations',
      status: UserStatus.ACTIVE,
    },
  })

  console.log('✓ Users created (Rajesh Sharma, Vikram Malhotra, Amit Patel, Priya Sundaram, Suresh Kumar)')

  // 4. Budgets / Cost Centers (4 Indian Manufacturing Hubs)
  const budgetMfg = await prisma.budgetControl.create({
    data: {
      costCenterCode: 'CC-MFG-PUNE',
      name: 'Manufacturing & Heavy Engineering (Pune Plant 102)',
      department: 'Manufacturing Operations',
      fiscalYear: 'FY 2026-27',
      allocatedAmount: 50000000.0, // ₹5.00 Cr
      committedAmount: 14250000.0,
      spentAmount: 8900000.0,
      status: 'ACTIVE',
    },
  })

  const budgetAuto = await prisma.budgetControl.create({
    data: {
      costCenterCode: 'CC-AUTO-BLR',
      name: 'Industrial Automation & Robotics (Bengaluru Tech Hub)',
      department: 'Automation & Instrumentation',
      fiscalYear: 'FY 2026-27',
      allocatedAmount: 35000000.0, // ₹3.50 Cr
      committedAmount: 8500000.0,
      spentAmount: 5200000.0,
      status: 'ACTIVE',
    },
  })

  const budgetFac = await prisma.budgetControl.create({
    data: {
      costCenterCode: 'CC-FAC-CHN',
      name: 'Plant Infrastructure, Utilities & ETP (Chennai Hub)',
      department: 'Facilities & Logistics',
      fiscalYear: 'FY 2026-27',
      allocatedAmount: 20000000.0, // ₹2.00 Cr
      committedAmount: 4800000.0,
      spentAmount: 3100000.0,
      status: 'ACTIVE',
    },
  })

  const budgetQA = await prisma.budgetControl.create({
    data: {
      costCenterCode: 'CC-QA-MUM',
      name: 'Central Metallurgy & Quality Assurance (Mumbai Lab)',
      department: 'Quality Assurance',
      fiscalYear: 'FY 2026-27',
      allocatedAmount: 15000000.0, // ₹1.50 Cr
      committedAmount: 2500000.0,
      spentAmount: 1200000.0,
      status: 'ACTIVE',
    },
  })

  console.log('✓ Cost Centers & Budgets created')

  // 5. Item Categories & Items (with HSN, GST, ABC Class, and Reorder thresholds)
  const catSteel = await prisma.itemCategory.create({
    data: {
      code: 'CAT-STL',
      name: 'Structural Steel & Heavy Alloys',
      description: 'IS 2062 Grade structural steel beams, hollow sections, MS plates, and alloy bars',
    },
  })

  const catElectrical = await prisma.itemCategory.create({
    data: {
      code: 'CAT-ELEC',
      name: 'Switchgear, Electrical & Instrumentation',
      description: 'Variable frequency drives (VFD), industrial PLCs, smart meters, and heavy switchgear',
    },
  })

  const catPumps = await prisma.itemCategory.create({
    data: {
      code: 'CAT-PUMP',
      name: 'Industrial Pumps, Valves & Flow Control',
      description: 'Centrifugal slurry pumps, gate valves, actuators, and industrial piping manifolds',
    },
  })

  const catLubricants = await prisma.itemCategory.create({
    data: {
      code: 'CAT-MRO',
      name: 'Industrial Lubricants & Consumables',
      description: 'Anti-wear hydraulic oils, gear lubricants, turbine oils, and shop-floor safety gear',
    },
  })

  const item1 = await prisma.item.create({
    data: {
      itemCode: 'ITM-IS2062-E250',
      name: 'Tata Structura MS Hollow Sections & Heavy Beams (IS 2062 E250BR)',
      description: 'Hot rolled high-strength structural steel square hollow section (150x150x6mm, 6m length) certified to IS 2062',
      categoryId: catSteel.id,
      uom: 'MTR',
      standardPrice: 4850.0,
      hsnCode: '7216.50',
      gstRate: 18.0,
      abcClass: 'A',
      minStock: 25,
      reorderLevel: 30,
      stockCoverDays: 45,
      currentStock: 80,
      status: 'ACTIVE',
    },
  })

  const item2 = await prisma.item.create({
    data: {
      itemCode: 'ITM-LNT-VFD',
      name: 'L&T Heavy Duty Variable Frequency Drive (VFD 45kW / 415V 3-Phase)',
      description: 'Larsen & Toubro Sx2000 series 45kW AC drive with built-in EMC filter, RS-485 Modbus, IP55 rugged enclosure',
      categoryId: catElectrical.id,
      uom: 'EA',
      standardPrice: 142000.0,
      hsnCode: '8504.40',
      gstRate: 18.0,
      abcClass: 'A',
      minStock: 5,
      reorderLevel: 6,
      stockCoverDays: 30,
      currentStock: 14,
      status: 'ACTIVE',
    },
  })

  const item3 = await prisma.item.create({
    data: {
      itemCode: 'ITM-KBL-PUMP',
      name: 'Kirloskar End Suction Industrial Centrifugal Pump (Model DB 65/26)',
      description: 'Heavy duty back pull-out centrifugal water pump with high-efficiency IE3 motor, bronze impeller, 120 m3/hr flow',
      categoryId: catPumps.id,
      uom: 'SET',
      standardPrice: 88500.0,
      hsnCode: '8413.70',
      gstRate: 18.0,
      abcClass: 'B',
      minStock: 3,
      reorderLevel: 4,
      stockCoverDays: 20,
      currentStock: 8,
      status: 'ACTIVE',
    },
  })

  const item4 = await prisma.item.create({
    data: {
      itemCode: 'ITM-IOCL-VG68',
      name: 'Servo System 68 Anti-Wear Hydraulic Fluid (210L Steel Barrel - IOCL)',
      description: 'Indian Oil SERVO SYSTEM 68 high viscosity index anti-wear hydraulic oil conforming to IS 10522:1983 standards',
      categoryId: catLubricants.id,
      uom: 'DRUM',
      standardPrice: 38400.0,
      hsnCode: '2710.19',
      gstRate: 18.0,
      abcClass: 'C',
      minStock: 15,
      reorderLevel: 20,
      stockCoverDays: 60,
      currentStock: 45,
      status: 'ACTIVE',
    },
  })

  const item5 = await prisma.item.create({
    data: {
      itemCode: 'TL-INS-CNMG',
      name: 'Carbide Insert CNMG',
      description: 'ISO Standard CNC turning inserts CNMG 120408 for steel machining',
      categoryId: catElectrical.id,
      uom: 'NOS',
      standardPrice: 312.0,
      hsnCode: '8209.00',
      gstRate: 18.0,
      abcClass: 'B',
      minStock: 50,
      reorderLevel: 60,
      stockCoverDays: 30,
      currentStock: 120,
      status: 'ACTIVE',
    },
  })

  const item6 = await prisma.item.create({
    data: {
      itemCode: 'OIL-VG68',
      name: 'Hydraulic Oil VG68',
      description: 'ISO VG 68 industrial hydraulic fluid for machine tools',
      categoryId: catLubricants.id,
      uom: 'LTR',
      standardPrice: 172.0,
      hsnCode: '2710.19',
      gstRate: 18.0,
      abcClass: 'C',
      minStock: 200,
      reorderLevel: 250,
      stockCoverDays: 45,
      currentStock: 480,
      status: 'ACTIVE',
    },
  })

  console.log('✓ Item Master records populated')

  // 6. Vendors (with capabilities, audit score, and PO gate status)
  const vendor1 = await prisma.vendor.create({
    data: {
      vendorCode: 'VND-001',
      name: 'Tata Steel BSL Limited',
      legalName: 'Tata Steel BSL Limited (A Tata Enterprise)',
      email: 'b2b.sales@tatasteel.com',
      phone: '+91-22-6665-8282',
      taxId: '27AAACT2727Q1ZW',
      address: 'Bombay House, 24 Homi Mody Street, Fort',
      city: 'Mumbai, Maharashtra',
      country: 'India',
      status: VendorStatus.APPROVED,
      rating: 4.9,
      creditTerms: 'Net 30',
      bankName: 'State Bank of India',
      bankAccount: '40918239012',
      capabilities: 'Structural Steel, Heavy Beams, MS Sections, IS 2062',
      qualificationStatus: 'QUALIFIED',
      auditScore: 98.5,
    },
  })

  await prisma.vendorContact.createMany({
    data: [
      {
        vendorId: vendor1.id,
        name: 'Rajesh Nair',
        email: 'r.nair@tatasteel.com',
        phone: '+91-98201-44321',
        designation: 'Head of Institutional Sourcing & EPC Sales',
        isPrimary: true,
      },
      {
        vendorId: vendor1.id,
        name: 'Neha Kulkarni',
        email: 'n.kulkarni@tatasteel.com',
        phone: '+91-98201-44322',
        designation: 'Key Account Manager (Western Region)',
        isPrimary: false,
      },
    ],
  })

  await prisma.vendorPerformance.create({
    data: {
      vendorId: vendor1.id,
      period: 'Q4 2025',
      onTimeDeliveryScore: 98.8,
      qualityScore: 99.4,
      complianceScore: 100.0,
      overallScore: 99.4,
      reviewNotes: 'Outstanding dispatch speed from Khopoli plant with complete NABL test certificates.',
    },
  })

  await prisma.vendorQualification.create({
    data: {
      vendorId: vendor1.id,
      certType: 'ISO 9001:2015 & BIS Certification',
      certNumber: 'CERT-ISO-9001-TATA-IND',
      issueDate: new Date('2024-01-15'),
      expiryDate: new Date('2027-01-14'),
      status: 'VALID',
      verifiedBy: 'Rajesh Sharma',
    },
  })

  // Full 6-parameter audit record for Vendor 1
  await prisma.vendorAudit.create({
    data: {
      vendorId: vendor1.id,
      auditType: 'ON_SITE',
      qmsScore: 98.0,
      processScore: 99.0,
      infrastructureScore: 98.0,
      traceabilityScore: 100.0,
      deliveryScore: 98.0,
      documentationScore: 98.0,
      totalScore: 98.5,
      resultStatus: 'QUALIFIED',
      auditedById: admin.id,
      attachmentName: 'TataSteel-AuditReport-2026.pdf',
      remarks: 'Comprehensive plant audit at Khopoli manufacturing facility passed with zero non-conformances.',
    },
  })

  const vendor2 = await prisma.vendor.create({
    data: {
      vendorCode: 'VND-002',
      name: 'Larsen & Toubro Electrical & Automation Ltd',
      legalName: 'Larsen & Toubro Limited (Electrical & Industrial Automation Division)',
      email: 'orders.ea@larsentoubro.com',
      phone: '+91-265-245-1200',
      taxId: '24AAACL0140P1ZT',
      address: 'L&T Knowledge City, NH-8, Waghodia Road',
      city: 'Vadodara, Gujarat',
      country: 'India',
      status: VendorStatus.APPROVED,
      rating: 4.8,
      creditTerms: 'Net 45',
      bankName: 'HDFC Bank',
      bankAccount: '5020008819201',
      capabilities: 'Switchgear, Industrial Automation, VFD Drives, PLCs',
      qualificationStatus: 'QUALIFIED',
      auditScore: 96.0,
    },
  })

  await prisma.vendorContact.create({
    data: {
      vendorId: vendor2.id,
      name: 'Ananya Deshmukh',
      email: 'a.deshmukh@larsentoubro.com',
      phone: '+91-98795-12345',
      designation: 'Vice President - Industrial Automation & Switchgear',
      isPrimary: true,
    },
  })

  await prisma.vendorPerformance.create({
    data: {
      vendorId: vendor2.id,
      period: 'Q4 2025',
      onTimeDeliveryScore: 97.5,
      qualityScore: 99.0,
      complianceScore: 99.5,
      overallScore: 98.6,
      reviewNotes: 'Consistent product build quality and proactive PLC firmware compatibility support.',
    },
  })

  await prisma.vendorAudit.create({
    data: {
      vendorId: vendor2.id,
      auditType: 'ON_SITE',
      qmsScore: 96.0,
      processScore: 96.0,
      infrastructureScore: 97.0,
      traceabilityScore: 95.0,
      deliveryScore: 96.0,
      documentationScore: 96.0,
      totalScore: 96.0,
      resultStatus: 'QUALIFIED',
      auditedById: admin.id,
      attachmentName: 'LT-Electrical-Audit-2026.pdf',
      remarks: 'Certified for medium and heavy electrical drives with ISO 14001 compliance.',
    },
  })

  const vendor3 = await prisma.vendor.create({
    data: {
      vendorCode: 'VND-003',
      name: 'Kirloskar Brothers Limited',
      legalName: 'Kirloskar Brothers Limited (Industrial Pumps & Valves)',
      email: 'corporate.sales@kbl.co.in',
      phone: '+91-20-2721-4000',
      taxId: '27AAACK1188D1Z2',
      address: 'Yamuna, Survey No. 98/(3 to 7), Baner',
      city: 'Pune, Maharashtra',
      country: 'India',
      status: VendorStatus.APPROVED,
      rating: 4.7,
      creditTerms: 'Net 30',
      bankName: 'ICICI Bank',
      bankAccount: '003905001188',
      capabilities: 'Centrifugal Pumps, Industrial Valves, Slurry Handling, Motors',
      qualificationStatus: 'QUALIFIED',
      auditScore: 94.0,
    },
  })

  await prisma.vendorContact.create({
    data: {
      vendorId: vendor3.id,
      name: 'Milind Joshi',
      email: 'm.joshi@kbl.co.in',
      phone: '+91-98220-56789',
      designation: 'General Manager - Project Sourcing & Heavy Pumps',
      isPrimary: true,
    },
  })

  await prisma.vendorAudit.create({
    data: {
      vendorId: vendor3.id,
      auditType: 'ON_SITE',
      qmsScore: 94.0,
      processScore: 95.0,
      infrastructureScore: 93.0,
      traceabilityScore: 94.0,
      deliveryScore: 94.0,
      documentationScore: 94.0,
      totalScore: 94.0,
      resultStatus: 'QUALIFIED',
      auditedById: admin.id,
      attachmentName: 'KBL-Pumps-AuditReport.pdf',
      remarks: 'Hydrostatic test bay certified for high-flow centrifugal slurry pump systems.',
    },
  })

  const vendor4 = await prisma.vendor.create({
    data: {
      vendorCode: 'VND-004',
      name: 'Indian Oil Corporation Ltd (Lubricants Division)',
      legalName: 'Indian Oil Corporation Limited (SERVO Industrial Lubricants)',
      email: 'servolubes@indianoil.in',
      phone: '+91-22-2644-7611',
      taxId: '27AAACI1681G1ZM',
      address: 'IndianOil Bhavan, G-9, Ali Yavar Jung Marg, Bandra (East)',
      city: 'Mumbai, Maharashtra',
      country: 'India',
      status: VendorStatus.APPROVED,
      rating: 4.6,
      creditTerms: 'Net 30',
      bankName: 'Punjab National Bank',
      bankAccount: '112000210089',
      capabilities: 'Industrial Lubricants, Hydraulic Oils, Turbine Fluids, Greases',
      qualificationStatus: 'QUALIFIED',
      auditScore: 97.0,
    },
  })

  await prisma.vendorContact.create({
    data: {
      vendorId: vendor4.id,
      name: 'Sandeep Verma',
      email: 'sandeep.verma@indianoil.in',
      phone: '+91-98110-33445',
      designation: 'Chief Manager - Industrial & Institutional Sales',
      isPrimary: true,
    },
  })

  await prisma.vendorAudit.create({
    data: {
      vendorId: vendor4.id,
      auditType: 'SURVEILLANCE',
      qmsScore: 98.0,
      processScore: 98.0,
      infrastructureScore: 96.0,
      traceabilityScore: 97.0,
      deliveryScore: 97.0,
      documentationScore: 96.0,
      totalScore: 97.0,
      resultStatus: 'QUALIFIED',
      auditedById: admin.id,
      attachmentName: 'IOCL-Refinery-Lubes-Audit.pdf',
      remarks: 'PSU refinery supply chain verified with automated batch blending logs.',
    },
  })

  // Vendor 5: Conditional Vendor (with open NC to test PO Quality Gate blocking!)
  const vendor5 = await prisma.vendor.create({
    data: {
      vendorCode: 'VND-005',
      name: 'NovaCast Precision Forgings Pvt. Ltd.',
      legalName: 'NovaCast Precision Forgings Private Limited',
      email: 'sales@novacast.example',
      phone: '+91-20-4100-2200',
      taxId: '27AABCN9912K1ZT',
      address: 'Plot 45, Chakan Industrial Area, Phase II',
      city: 'Pune, Maharashtra',
      country: 'India',
      status: VendorStatus.PENDING_REVIEW,
      rating: 4.1,
      creditTerms: 'Net 30',
      bankName: 'Axis Bank',
      bankAccount: '912010048129',
      capabilities: 'Castings, CNC Machining, Forgings',
      qualificationStatus: 'CONDITIONAL',
      auditScore: 78.0,
    },
  })

  const audit5 = await prisma.vendorAudit.create({
    data: {
      vendorId: vendor5.id,
      auditType: 'ON_SITE',
      qmsScore: 75.0,
      processScore: 80.0,
      infrastructureScore: 78.0,
      traceabilityScore: 76.0,
      deliveryScore: 82.0,
      documentationScore: 77.0,
      totalScore: 78.0,
      resultStatus: 'CONDITIONAL',
      auditedById: admin.id,
      attachmentName: 'NovaCast-InitialAudit-2026.pdf',
      remarks: 'Audit passed above 70% threshold but 1 Major Non-Conformance noted in spectrometer calibration.',
    },
  })

  await prisma.vendorNonConformance.create({
    data: {
      auditId: audit5.id,
      vendorId: vendor5.id,
      ncNumber: 'NC-2026-001',
      description: 'Calibration certificate for spark optical spectrometer expired on 15 Feb 2026; heats untested.',
      severity: 'MAJOR',
      targetDate: new Date('2026-11-15'),
      status: 'OPEN',
      capaDetails: 'Vendor submitted quotation from NABL lab for recalibration; pending site audit verification.',
    },
  })

  // Vendor 6: Blocked Vendor (to test exclusion from ordering and searches)
  await prisma.vendor.create({
    data: {
      vendorCode: 'VND-006',
      name: 'Omega Fasteners & Hardware Ltd.',
      legalName: 'Omega Heavy Fasteners Limited',
      email: 'orders@omegafasteners.example',
      phone: '+91-22-2850-9922',
      taxId: '27AABCO4410J1ZX',
      address: 'Andheri East Industrial Estate',
      city: 'Mumbai, Maharashtra',
      country: 'India',
      status: VendorStatus.SUSPENDED,
      rating: 2.8,
      creditTerms: 'Advance',
      bankName: 'Union Bank of India',
      bankAccount: '312010099881',
      capabilities: 'Fasteners, High-Tensile Bolts, Studs',
      qualificationStatus: 'BLOCKED',
      isBlocked: true,
      blockedReason: 'Persistent 14% batch failure in proof-load tests and failure to respond to CAR notice.',
      auditScore: 48.0,
    },
  })

  console.log('✓ Vendors populated (4 Qualified, 1 Conditional with Open NC, 1 Blocked)')

  // 7. Rate Contracts
  const rateContract1 = await prisma.rateContract.create({
    data: {
      contractNumber: 'RC-2026-TATA-01',
      vendorId: vendor1.id,
      title: 'Annual Rate Contract for Structural Steel & IS 2062 Sections',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      totalValue: 15000000.0,
      spentAmount: 286150.0,
      status: 'ACTIVE',
      terms: 'Fixed unit pricing guaranteed for 12 months with 5 business day delivery window ex-Khopoli works.',
    },
  })

  await prisma.rateContractItem.create({
    data: {
      contractId: rateContract1.id,
      itemId: item1.id,
      contractedPrice: 4850.0,
      minQuantity: 10,
    },
  })

  const rateContract2 = await prisma.rateContract.create({
    data: {
      contractNumber: 'RC-2026-LT-02',
      vendorId: vendor2.id,
      title: 'Annual Rate Contract for Industrial VFD Drives & Switchgear',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      totalValue: 8500000.0,
      spentAmount: 670240.0,
      status: 'ACTIVE',
      terms: 'Standard OEM warranty 24 months, on-site diagnostics within 24 hours across Western Region.',
    },
  })

  await prisma.rateContractItem.create({
    data: {
      contractId: rateContract2.id,
      itemId: item2.id,
      contractedPrice: 142000.0,
      minQuantity: 2,
    },
  })

  const rateContract3 = await prisma.rateContract.create({
    data: {
      contractNumber: 'RC-2026-KBL-03',
      vendorId: vendor3.id,
      title: 'Annual Supply Agreement for Industrial Centrifugal Pumps & Spares',
      startDate: new Date('2026-02-01'),
      endDate: new Date('2027-01-31'),
      totalValue: 4500000.0,
      spentAmount: 313290.0,
      status: 'ACTIVE',
      terms: 'Includes pre-dispatch hydrostatic test reports and free alignment inspection.',
    },
  })

  await prisma.rateContractItem.create({
    data: {
      contractId: rateContract3.id,
      itemId: item3.id,
      contractedPrice: 88500.0,
      minQuantity: 1,
    },
  })

  const rateContract4 = await prisma.rateContract.create({
    data: {
      contractNumber: 'RC-2026-IOCL-04',
      vendorId: vendor4.id,
      title: 'Annual Petroleum & Hydraulic Lubricants Supply Agreement',
      startDate: new Date('2026-01-15'),
      endDate: new Date('2026-12-31'),
      totalValue: 3500000.0,
      spentAmount: 181248.0,
      status: 'ACTIVE',
      terms: 'Direct refinery pricing benchmarked with quarterly crude adjustment formula.',
    },
  })

  await prisma.rateContractItem.create({
    data: {
      contractId: rateContract4.id,
      itemId: item4.id,
      contractedPrice: 38400.0,
      minQuantity: 4,
    },
  })

  console.log('✓ Rate Contracts created')

  // 8. Purchase Requisitions
  const pr1 = await prisma.purchaseRequisition.create({
    data: {
      prNumber: 'PR-2026-00101',
      title: 'Urgent Structural Steel Hollow Sections for Line 4 Expansion',
      department: 'Manufacturing Operations',
      requesterId: requester.id,
      costCenterId: budgetMfg.id,
      priority: PRPriority.HIGH,
      status: PRStatus.APPROVED,
      totalEstimatedAmount: 242500.0,
      approvedAt: new Date('2026-03-02'),
      approvedById: approver.id,
      notes: 'Line 4 structural mezzanine fabrication scheduled for mid-month. Approved under Q1 capital budget.',
    },
  })

  const pr1Item = await prisma.requisitionItem.create({
    data: {
      requisitionId: pr1.id,
      itemId: item1.id,
      description: 'Tata Structura MS Hollow Sections (IS 2062 E250BR, 150x150x6mm)',
      quantity: 50,
      estimatedUnitPrice: 4850.0,
      estimatedTotalPrice: 242500.0,
      uom: 'MTR',
      requiredByDate: new Date('2026-03-30'),
    },
  })

  const pr2 = await prisma.purchaseRequisition.create({
    data: {
      prNumber: 'PR-2026-00102',
      title: 'L&T 45kW VFD Units for Chiller Plant Energy Optimization',
      department: 'Automation & Instrumentation',
      requesterId: requester.id,
      costCenterId: budgetAuto.id,
      priority: PRPriority.MEDIUM,
      status: PRStatus.PENDING_APPROVAL,
      totalEstimatedAmount: 568000.0,
      notes: 'Replacement of older rewound motors with energy efficient VFD speed drives in plant chiller room.',
    },
  })

  await prisma.requisitionItem.create({
    data: {
      requisitionId: pr2.id,
      itemId: item2.id,
      description: 'L&T Heavy Duty Variable Frequency Drive (VFD 45kW / 415V 3-Phase)',
      quantity: 4,
      estimatedUnitPrice: 142000.0,
      estimatedTotalPrice: 568000.0,
      uom: 'EA',
      requiredByDate: new Date('2026-04-15'),
    },
  })

  const pr3 = await prisma.purchaseRequisition.create({
    data: {
      prNumber: 'PR-2026-00103',
      title: 'Kirloskar DB 65/26 Centrifugal Pump Sets for ETP Plant',
      department: 'Facilities & Logistics',
      requesterId: requester.id,
      costCenterId: budgetFac.id,
      priority: PRPriority.HIGH,
      status: PRStatus.APPROVED,
      totalEstimatedAmount: 265500.0,
      approvedAt: new Date('2026-03-05'),
      approvedById: approver.id,
      notes: 'Effluent treatment plant pump refurbishment required for state pollution control board compliance audit.',
    },
  })

  const pr3Item = await prisma.requisitionItem.create({
    data: {
      requisitionId: pr3.id,
      itemId: item3.id,
      description: 'Kirloskar End Suction Industrial Centrifugal Pump (Model DB 65/26)',
      quantity: 3,
      estimatedUnitPrice: 88500.0,
      estimatedTotalPrice: 265500.0,
      uom: 'SET',
      requiredByDate: new Date('2026-04-05'),
    },
  })

  const pr4 = await prisma.purchaseRequisition.create({
    data: {
      prNumber: 'PR-2026-00104',
      title: 'Servo System 68 Anti-Wear Hydraulic Fluid Barrels Replenishment',
      department: 'Manufacturing Operations',
      requesterId: requester.id,
      costCenterId: budgetMfg.id,
      priority: PRPriority.MEDIUM,
      status: PRStatus.APPROVED,
      totalEstimatedAmount: 153600.0,
      approvedAt: new Date('2026-03-06'),
      approvedById: approver.id,
      notes: 'Scheduled semi-annual hydraulic oil change for hydraulic presses 1 through 4.',
    },
  })

  const pr4Item = await prisma.requisitionItem.create({
    data: {
      requisitionId: pr4.id,
      itemId: item4.id,
      description: 'Servo System 68 Anti-Wear Hydraulic Fluid (210L Steel Barrel - IOCL)',
      quantity: 4,
      estimatedUnitPrice: 38400.0,
      estimatedTotalPrice: 153600.0,
      uom: 'DRUM',
      requiredByDate: new Date('2026-04-10'),
    },
  })

  console.log('✓ Purchase Requisitions created')

  // 9. Inquiries, RFQs & Quotations
  const inquiry1 = await prisma.inquiry.create({
    data: {
      inquiryNumber: 'INQ-2026-0051',
      prId: pr1.id,
      itemId: item1.id,
      title: 'Commercial Sourcing for IS 2062 Structural Steel Sections',
      fgPartName: 'Gear Housing Assembly (GH-220)',
      fgPartNo: 'GH-220',
      customer: 'Ashok Leyland Ltd',
      customerTargetPrice: 260000.0,
      requestType: 'Raw Material',
      drawingSpec: 'DRG-GH-220 R1',
      quantity: 50,
      dueDate: new Date('2026-03-20'),
      status: InquiryStatus.QUOTES_RECEIVED,
      notes: 'Invited primary approved steel stockists under master agreement.',
    },
  })

  const inqVen1 = await prisma.inquiryVendor.create({
    data: {
      inquiryId: inquiry1.id,
      vendorId: vendor1.id,
      status: 'QUOTED',
      offeredPrice: 242500.0,
      quotedDate: new Date('2026-02-28'),
      mailSent: true,
      sentDate: new Date('2026-02-25'),
      leadTimeDays: 5,
      moq: 10,
      paymentTerms: 'Net 30',
      respondedAt: new Date('2026-02-28'),
    },
  })

  await prisma.inquiryFollowup.create({
    data: {
      inquiryVendorId: inqVen1.id,
      mode: 'PHONE',
      notes: 'Discussed dispatch schedule from Khopoli works. Delivery within 5 days confirmed.',
      nextFollowupDate: new Date('2026-03-05'),
      loggedById: officer.id,
    },
  })

  const rfq1 = await prisma.rfq.create({
    data: {
      rfqNumber: 'RFQ-2026-0082',
      inquiryId: inquiry1.id,
      prId: pr1.id,
      title: 'RFQ for 50 Mtrs Tata Structura Hollow Sections',
      deadline: new Date('2026-03-25'),
      terms: 'FOR Destination Pune Works, GST 18%, Mill Test Certificate mandatory.',
      status: 'AWARDED',
      awardedVendorId: vendor1.id,
      awardJustification: 'L1 compliant bidder with guaranteed 5-day dispatch.',
      awardedAt: new Date('2026-03-01'),
      savingsAmount: 17500.0,
    },
  })

  const quote1 = await prisma.quotation.create({
    data: {
      quoteNumber: 'QT-TATA-9921',
      rfqId: rfq1.id,
      vendorId: vendor1.id,
      quoteDate: new Date('2026-02-28'),
      validUntil: new Date('2026-04-30'),
      totalAmount: 242500.0,
      paymentTerms: 'Net 30',
      deliveryDays: 5,
      status: 'SELECTED',
      techScore: 95.0,
      commercialScore: 98.0,
      compositeScore: 96.8,
      isL1: true,
      notes: 'Honoring rate contract agreement #RC-2026-TATA-01.',
    },
  })

  await prisma.quotationItem.create({
    data: {
      quotationId: quote1.id,
      itemId: item1.id,
      quantity: 50,
      unitPrice: 4850.0,
      taxRate: 18.0,
      totalPrice: 242500.0,
      leadTimeDays: 5,
    },
  })

  // RFQ-2026-0114 (Matching Screenshot Page 15 Comparative Statement)
  const rfq2 = await prisma.rfq.create({
    data: {
      rfqNumber: 'RFQ-2026-0114',
      prId: pr1.id,
      title: 'Formal Multi-Vendor RFQ: Carbide Inserts & Hydraulic Oil',
      deadline: new Date('2026-07-12'),
      terms: 'Standard SLT Commercial terms. GST separate. 30 days price validity.',
      status: 'ACTIVE',
    },
  })

  // Quote 1: Vendor 1 (Precision Tools Co. - L1 on Carbide)
  const quote2_1 = await prisma.quotation.create({
    data: {
      quoteNumber: 'QT-2026-PREC-01',
      rfqId: rfq2.id,
      vendorId: vendor1.id,
      validUntil: new Date('2026-08-30'),
      totalAmount: 115600.0,
      deliveryDays: 7,
      techScore: 96.0,
      commercialScore: 98.0,
      compositeScore: 97.2,
      isL1: true,
      notes: 'Carbide inserts quoted at 312 L1 rate. Hydraulic oil at 172.',
    },
  })

  await prisma.quotationItem.createMany({
    data: [
      {
        quotationId: quote2_1.id,
        itemId: item5.id,
        quantity: 150,
        unitPrice: 312.0,
        taxRate: 18.0,
        totalPrice: 46800.0,
        leadTimeDays: 7,
      },
      {
        quotationId: quote2_1.id,
        itemId: item6.id,
        quantity: 400,
        unitPrice: 172.0,
        taxRate: 18.0,
        totalPrice: 68800.0,
        leadTimeDays: 7,
      },
    ],
  })

  // Quote 2: Vendor 2 (SKF Bearings India)
  const quote2_2 = await prisma.quotation.create({
    data: {
      quoteNumber: 'QT-2026-SKF-02',
      rfqId: rfq2.id,
      vendorId: vendor2.id,
      validUntil: new Date('2026-08-30'),
      totalAmount: 48750.0,
      deliveryDays: 10,
      techScore: 88.0,
      commercialScore: 85.0,
      compositeScore: 86.2,
      isL1: false,
      notes: 'Carbide inserts only quoted at 325 rate.',
    },
  })

  await prisma.quotationItem.create({
    data: {
      quotationId: quote2_2.id,
      itemId: item5.id,
      quantity: 150,
      unitPrice: 325.0,
      taxRate: 18.0,
      totalPrice: 48750.0,
      leadTimeDays: 10,
    },
  })

  // Quote 3: Vendor 3 (ABC Steel Pvt. Ltd. - L1 on Hydraulic Oil)
  const quote2_3 = await prisma.quotation.create({
    data: {
      quoteNumber: 'QT-2026-ABC-03',
      rfqId: rfq2.id,
      vendorId: vendor3.id,
      validUntil: new Date('2026-08-30'),
      totalAmount: 67200.0,
      deliveryDays: 5,
      techScore: 74.0,
      commercialScore: 92.0,
      compositeScore: 84.8,
      isL1: false,
      notes: 'Hydraulic oil quoted at 168 L1 rate.',
    },
  })

  await prisma.quotationItem.create({
    data: {
      quotationId: quote2_3.id,
      itemId: item6.id,
      quantity: 400,
      unitPrice: 168.0,
      taxRate: 18.0,
      totalPrice: 67200.0,
      leadTimeDays: 5,
    },
  })

  // 10. Purchase Orders
  const po1 = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-2026-00441',
      prId: pr1.id,
      quoteId: quote1.id,
      inquiryId: inquiry1.id,
      vendorId: vendor1.id,
      createdById: officer.id,
      issueDate: new Date('2026-03-01'),
      expectedDeliveryDate: new Date('2026-03-10'),
      paymentTerms: 'Net 30',
      status: POStatus.ISSUED,
      subtotal: 242500.0,
      taxAmount: 43650.0,
      totalAmount: 286150.0,
      qualityGatePassed: true,
      notes: 'Deliver directly to Bay 4 Receiving Dock, Pune Plant 102. Mill Test Certificate mandatory.',
      termsAndConditions: '1. Material must conform to IS 2062:2011 Grade E250BR.\n2. Original manufacturer test certificate required with challan.\n3. Inspection by SLT Quality within 48 hours of dock receipt.',
      approvedAt: new Date('2026-03-02'),
      approvedById: approver.id,
    },
  })

  const po1Item = await prisma.purchaseOrderItem.create({
    data: {
      poId: po1.id,
      itemId: item1.id,
      description: 'Tata Structura MS Hollow Sections (IS 2062 E250BR, 150x150x6mm)',
      quantity: 50,
      unitPrice: 4850.0,
      taxRate: 18.0,
      totalPrice: 286150.0,
      quantityReceived: 50,
      quantityBilled: 50,
    },
  })

  const po2 = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-2026-00442',
      prId: pr2.id,
      vendorId: vendor2.id,
      createdById: officer.id,
      issueDate: new Date('2026-03-03'),
      expectedDeliveryDate: new Date('2026-03-15'),
      paymentTerms: 'Net 45',
      status: POStatus.ISSUED,
      subtotal: 568000.0,
      taxAmount: 102240.0,
      totalAmount: 670240.0,
      qualityGatePassed: true,
      notes: 'Ship via registered express carrier to Bengaluru Tech Hub. Mark crates with PO-2026-00442.',
      approvedAt: new Date('2026-03-04'),
      approvedById: approver.id,
    },
  })

  const po2Item = await prisma.purchaseOrderItem.create({
    data: {
      poId: po2.id,
      itemId: item2.id,
      description: 'L&T Heavy Duty Variable Frequency Drive (VFD 45kW / 415V 3-Phase)',
      quantity: 4,
      unitPrice: 142000.0,
      taxRate: 18.0,
      totalPrice: 670240.0,
      quantityReceived: 4,
      quantityBilled: 4,
    },
  })

  const po3 = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-2026-00443',
      prId: pr3.id,
      vendorId: vendor3.id,
      createdById: officer.id,
      issueDate: new Date('2026-03-05'),
      expectedDeliveryDate: new Date('2026-03-18'),
      paymentTerms: 'Net 30',
      status: POStatus.ISSUED,
      subtotal: 265500.0,
      taxAmount: 47790.0,
      totalAmount: 313290.0,
      qualityGatePassed: true,
      notes: 'Delivery to Chennai Hub Central Stores. Include motor test certificates and warranty card.',
      approvedAt: new Date('2026-03-06'),
      approvedById: approver.id,
    },
  })

  const po3Item = await prisma.purchaseOrderItem.create({
    data: {
      poId: po3.id,
      itemId: item3.id,
      description: 'Kirloskar End Suction Industrial Centrifugal Pump (Model DB 65/26)',
      quantity: 3,
      unitPrice: 88500.0,
      taxRate: 18.0,
      totalPrice: 313290.0,
      quantityReceived: 3,
      quantityBilled: 3,
    },
  })

  const po4 = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-2026-00444',
      prId: pr4.id,
      vendorId: vendor4.id,
      createdById: officer.id,
      issueDate: new Date('2026-03-06'),
      expectedDeliveryDate: new Date('2026-03-12'),
      paymentTerms: 'Net 30',
      status: POStatus.APPROVED,
      subtotal: 153600.0,
      taxAmount: 27648.0,
      totalAmount: 181248.0,
      qualityGatePassed: true,
      notes: 'Deliver 4 sealed drums to Lubricants Basement Storage, Pune Works.',
      approvedAt: new Date('2026-03-07'),
      approvedById: approver.id,
    },
  })

  const po4Item = await prisma.purchaseOrderItem.create({
    data: {
      poId: po4.id,
      itemId: item4.id,
      description: 'Servo System 68 Anti-Wear Hydraulic Fluid (210L Steel Barrel - IOCL)',
      quantity: 4,
      unitPrice: 38400.0,
      taxRate: 18.0,
      totalPrice: 181248.0,
      quantityReceived: 4,
      quantityBilled: 4,
    },
  })

  console.log('✓ Purchase Orders created')

  // 11. Goods Receipts (GRN)
  const grn1 = await prisma.goodsReceipt.create({
    data: {
      grnNumber: 'GRN-2026-00219',
      poId: po1.id,
      vendorId: vendor1.id,
      receivedById: requester.id,
      receiptDate: new Date('2026-03-08'),
      deliveryNoteNumber: 'DC-TATA-44102',
      vehicleNumber: 'MH-12-RN-8821',
      status: GRNStatus.ACCEPTED,
      remarks: 'All 50 meters structural hollow sections inspected, gauge verified, mill test cert logged.',
    },
  })

  await prisma.goodsReceiptItem.create({
    data: {
      grnId: grn1.id,
      poItemId: po1Item.id,
      quantityReceived: 50,
      quantityAccepted: 50,
      quantityRejected: 0,
    },
  })

  const grn2 = await prisma.goodsReceipt.create({
    data: {
      grnNumber: 'GRN-2026-00220',
      poId: po2.id,
      vendorId: vendor2.id,
      receivedById: requester.id,
      receiptDate: new Date('2026-03-10'),
      deliveryNoteNumber: 'DC-LT-99120',
      vehicleNumber: 'GJ-06-TT-5021',
      status: GRNStatus.ACCEPTED,
      remarks: '4 VFD panels received intact in original moisture-barrier packaging. Serial numbers recorded.',
    },
  })

  await prisma.goodsReceiptItem.create({
    data: {
      grnId: grn2.id,
      poItemId: po2Item.id,
      quantityReceived: 4,
      quantityAccepted: 4,
      quantityRejected: 0,
    },
  })

  const grn3 = await prisma.goodsReceipt.create({
    data: {
      grnNumber: 'GRN-2026-00221',
      poId: po3.id,
      vendorId: vendor3.id,
      receivedById: requester.id,
      receiptDate: new Date('2026-03-12'),
      deliveryNoteNumber: 'DC-KBL-77401',
      vehicleNumber: 'MH-14-AZ-6619',
      status: GRNStatus.ACCEPTED,
      remarks: '3 pump skids unloaded at Chennai stores. Impeller rotation checked freely by mechanical engineer.',
    },
  })

  await prisma.goodsReceiptItem.create({
    data: {
      grnId: grn3.id,
      poItemId: po3Item.id,
      quantityReceived: 3,
      quantityAccepted: 3,
      quantityRejected: 0,
    },
  })

  const grn4 = await prisma.goodsReceipt.create({
    data: {
      grnNumber: 'GRN-2026-00222',
      poId: po4.id,
      vendorId: vendor4.id,
      receivedById: requester.id,
      receiptDate: new Date('2026-03-11'),
      deliveryNoteNumber: 'DC-IOCL-8812',
      vehicleNumber: 'MH-04-KA-3129',
      status: GRNStatus.ACCEPTED,
      remarks: '4 sealed drums inspected with IOCL tamper-proof seals intact. Batch number SERVO-26-04.',
    },
  })

  await prisma.goodsReceiptItem.create({
    data: {
      grnId: grn4.id,
      poItemId: po4Item.id,
      quantityReceived: 4,
      quantityAccepted: 4,
      quantityRejected: 0,
    },
  })

  console.log('✓ Goods Receipts created')

  // 12. Supplier Invoices & 3-Way Matching
  const invoice1 = await prisma.supplierInvoice.create({
    data: {
      invoiceNumber: 'INV-2026-9041',
      supplierInvoiceRef: 'TATA-INV-44102',
      poId: po1.id,
      vendorId: vendor1.id,
      invoiceDate: new Date('2026-03-09'),
      dueDate: new Date('2026-04-08'),
      subtotal: 242500.0,
      taxAmount: 43650.0,
      totalAmount: 286150.0,
      matchStatus: MatchStatus.MATCHED_3_WAY,
      status: InvoiceStatus.APPROVED,
      approvedAt: new Date('2026-03-11'),
      approvedById: finance.id,
      notes: '3-Way Match Verified (PO #PO-2026-00441 == GRN #GRN-2026-00219 == Invoice #TATA-INV-44102). Quantities and pricing exact.',
    },
  })

  await prisma.supplierInvoiceItem.create({
    data: {
      invoiceId: invoice1.id,
      poItemId: po1Item.id,
      description: 'Tata Structura MS Hollow Sections (IS 2062 E250BR, 150x150x6mm)',
      quantityBilled: 50,
      unitPrice: 4850.0,
      totalPrice: 286150.0,
    },
  })

  const invoice2 = await prisma.supplierInvoice.create({
    data: {
      invoiceNumber: 'INV-2026-9042',
      supplierInvoiceRef: 'LT-INV-88910',
      poId: po2.id,
      vendorId: vendor2.id,
      invoiceDate: new Date('2026-03-11'),
      dueDate: new Date('2026-04-25'),
      subtotal: 568000.0,
      taxAmount: 102240.0,
      totalAmount: 670240.0,
      matchStatus: MatchStatus.MATCHED_3_WAY,
      status: InvoiceStatus.APPROVED,
      approvedAt: new Date('2026-03-12'),
      approvedById: finance.id,
      notes: '3-Way Match Verified (PO #PO-2026-00442 == GRN #GRN-2026-00220 == Invoice #LT-INV-88910). E-Way bill verified.',
    },
  })

  await prisma.supplierInvoiceItem.create({
    data: {
      invoiceId: invoice2.id,
      poItemId: po2Item.id,
      description: 'L&T Heavy Duty Variable Frequency Drive (VFD 45kW / 415V 3-Phase)',
      quantityBilled: 4,
      unitPrice: 142000.0,
      totalPrice: 670240.0,
    },
  })

  const invoice3 = await prisma.supplierInvoice.create({
    data: {
      invoiceNumber: 'INV-2026-9043',
      supplierInvoiceRef: 'KBL-INV-11029',
      poId: po3.id,
      vendorId: vendor3.id,
      invoiceDate: new Date('2026-03-13'),
      dueDate: new Date('2026-04-12'),
      subtotal: 265500.0,
      taxAmount: 47790.0,
      totalAmount: 313290.0,
      matchStatus: MatchStatus.MATCHED_3_WAY,
      status: InvoiceStatus.APPROVED,
      approvedAt: new Date('2026-03-14'),
      approvedById: finance.id,
      notes: '3-Way Match Verified (PO #PO-2026-00443 == GRN #GRN-2026-00221 == Invoice #KBL-INV-11029). Clean delivery match.',
    },
  })

  await prisma.supplierInvoiceItem.create({
    data: {
      invoiceId: invoice3.id,
      poItemId: po3Item.id,
      description: 'Kirloskar End Suction Industrial Centrifugal Pump (Model DB 65/26)',
      quantityBilled: 3,
      unitPrice: 88500.0,
      totalPrice: 313290.0,
    },
  })

  const invoice4 = await prisma.supplierInvoice.create({
    data: {
      invoiceNumber: 'INV-2026-9044',
      supplierInvoiceRef: 'IOCL-INV-22104',
      poId: po4.id,
      vendorId: vendor4.id,
      invoiceDate: new Date('2026-03-12'),
      dueDate: new Date('2026-04-11'),
      subtotal: 153600.0,
      taxAmount: 27648.0,
      totalAmount: 181248.0,
      matchStatus: MatchStatus.MATCHED_3_WAY,
      status: InvoiceStatus.APPROVED,
      approvedAt: new Date('2026-03-13'),
      approvedById: finance.id,
      notes: '3-Way Match Verified (PO #PO-2026-00444 == GRN #GRN-2026-00222 == Invoice #IOCL-INV-22104). Refinery batch cleared.',
    },
  })

  await prisma.supplierInvoiceItem.create({
    data: {
      invoiceId: invoice4.id,
      poItemId: po4Item.id,
      description: 'Servo System 68 Anti-Wear Hydraulic Fluid (210L Steel Barrel - IOCL)',
      quantityBilled: 4,
      unitPrice: 38400.0,
      totalPrice: 181248.0,
    },
  })

  console.log('✓ Supplier Invoices created')

  // 13. Payments
  await prisma.payment.create({
    data: {
      paymentNumber: 'PAY-2026-00088',
      invoiceId: invoice1.id,
      vendorId: vendor1.id,
      paymentDate: new Date('2026-03-15'),
      amount: 286150.0,
      paymentMethod: 'RTGS',
      referenceNumber: 'RTGS-SBI-9912048',
      utrNumber: 'SBIN00018273645',
      status: PaymentStatus.COMPLETED,
      processedById: finance.id,
      notes: 'Settled via State Bank of India RTGS corporate banking gateway.',
    },
  })

  await prisma.payment.create({
    data: {
      paymentNumber: 'PAY-2026-00089',
      invoiceId: invoice2.id,
      vendorId: vendor2.id,
      paymentDate: new Date('2026-03-16'),
      amount: 670240.0,
      paymentMethod: 'NEFT',
      referenceNumber: 'HDFC-NEFT-8830192',
      utrNumber: 'HDFCR520261001001',
      status: PaymentStatus.COMPLETED,
      processedById: finance.id,
      notes: 'Settled via HDFC Bank corporate bulk payment gateway.',
    },
  })

  await prisma.payment.create({
    data: {
      paymentNumber: 'PAY-2026-00090',
      invoiceId: invoice3.id,
      vendorId: vendor3.id,
      paymentDate: new Date('2026-03-17'),
      amount: 313290.0,
      paymentMethod: 'RTGS',
      referenceNumber: 'ICICI-RTGS-6629104',
      utrNumber: 'ICICR520261002002',
      status: PaymentStatus.COMPLETED,
      processedById: finance.id,
      notes: 'Settled via ICICI Bank corporate treasury transfer.',
    },
  })

  await prisma.payment.create({
    data: {
      paymentNumber: 'PAY-2026-00091',
      invoiceId: invoice4.id,
      vendorId: vendor4.id,
      paymentDate: new Date('2026-03-18'),
      amount: 181248.0,
      paymentMethod: 'RTGS',
      referenceNumber: 'PUNB-RTGS-5510294',
      utrNumber: 'PUNBR520261003003',
      status: PaymentStatus.COMPLETED,
      processedById: finance.id,
      notes: 'Settled via Punjab National Bank RTGS corporate portal.',
    },
  })

  console.log('✓ Payments created')

  // 14. Unified Approval Inbox Tasks (4 Types: PR, PO, Quote Award, Match Exception per §6)
  await prisma.approvalTask.create({
    data: {
      entityType: 'PURCHASE_REQUISITION',
      entityId: pr2.id,
      title: 'PR-2026-00102 — L&T 45kW VFD Units for Chiller Automation',
      currentLevel: 2,
      requiredRole: Role.APPROVER,
      status: 'PENDING',
      assignedToId: approver.id,
      comments: 'Awaiting Purchase Manager sign-off within Delegation of Authority (Band: Up to ₹5,00,000 / ₹5,68,000 requires Management).',
    },
  })

  await prisma.approvalTask.create({
    data: {
      entityType: 'PURCHASE_ORDER',
      entityId: po3.id,
      title: 'PO-2026-00443 — Kirloskar Centrifugal Pumps (₹3,13,290.00)',
      currentLevel: 1,
      requiredRole: Role.APPROVER,
      status: 'PENDING',
      assignedToId: approver.id,
      comments: 'Standard Purchase Manager DOA review prior to dock dispatch release.',
    },
  })

  await prisma.approvalTask.create({
    data: {
      entityType: 'QUOTE_AWARD',
      entityId: rfq1.id,
      title: 'Quote Award RFQ-2026-0082 — L1 Evaluation & Technical Sign-off',
      currentLevel: 1,
      requiredRole: Role.APPROVER,
      status: 'PENDING',
      assignedToId: approver.id,
      comments: 'Comparative statement evaluation: Tata Steel rated 96.8 composite score with ₹17,500 negotiated savings.',
    },
  })

  await prisma.approvalTask.create({
    data: {
      entityType: 'MATCH_EXCEPTION',
      entityId: invoice3.id,
      title: 'Match Exception INV-2026-9043 — Minor Freight Tolerance Verification',
      currentLevel: 1,
      requiredRole: Role.APPROVER,
      status: 'PENDING',
      assignedToId: approver.id,
      comments: '3-way tolerance check within 0.5% buffer; required Accounts/Management authorization before release.',
    },
  })

  console.log('✓ Unified Approval Inbox tasks seeded across all 4 documented streams')

  // 15. System Settings (§15)
  await prisma.systemSetting.createMany({
    data: [
      {
        key: 'COMPANY_PROFILE',
        value: JSON.stringify({
          companyName: 'SLT Procurement India Private Limited',
          division: 'Source-to-Pay Industrial ERP',
          corporateOffice: 'Express Towers, Nariman Point, Mumbai 400021',
          gstin: '27AAACS9981P1ZV',
          pan: 'AAACS9981P',
          financialYear: 'FY 2026-27',
          activePlants: ['Pune Works - Plant 102', 'Bengaluru Tech Hub', 'Chennai Works'],
        }),
        description: 'Corporate organizational profile and legal registration details',
      },
      {
        key: 'DOA_MATRIX',
        value: JSON.stringify({
          band1: { maxAmount: 100000, authority: 'Purchase Executive', description: 'Up to ₹1,00,000' },
          band2: { maxAmount: 500000, authority: 'Purchase Manager', description: 'Up to ₹5,00,000' },
          band3: { maxAmount: 2500000, authority: 'Management', description: 'Up to ₹25,00,000' },
          band4: { maxAmount: null, authority: 'Management + Director sign-off', description: 'Above ₹25,00,000' },
        }),
        description: 'Delegation of Authority value bands for PR and PO sign-off',
      },
      {
        key: 'LOCKED_CONTROLS',
        value: JSON.stringify({
          approvedPoImmutable: true,
          specReadOnlyFromMaster: true,
          quantityLockedOnGRN: true,
          rateLockedOnInvoice: true,
          manualPaymentWithUtrMandatory: true,
          qualityGateOnPoEnforced: true,
          minimumAuditScoreToRaisePo: 70,
          gaplessNumberingEnforced: true,
        }),
        description: 'Strict immutable business rules and audit-grade controls',
      },
    ],
  })

  console.log('✓ System Settings seeded (Company Profile, DOA Matrix, Locked Controls)')

  // 16. Audit Logs
  await prisma.auditLog.createMany({
    data: [
      {
        userId: admin.id,
        action: 'SYSTEM_BOOTSTRAP',
        entity: 'SYSTEM',
        details: 'Initial system provisioning and baseline master configuration for SLT India Procurement.',
        ipAddress: '127.0.0.1',
      },
      {
        userId: requester.id,
        action: 'CREATE_PR',
        entity: 'PURCHASE_REQUISITION',
        entityId: pr1.id,
        details: 'Submitted purchase requisition PR-2026-00101 for ₹2,42,500.00 (Tata Steel Hollow Sections).',
        ipAddress: '192.168.1.45',
      },
      {
        userId: approver.id,
        action: 'APPROVE_PR',
        entity: 'PURCHASE_REQUISITION',
        entityId: pr1.id,
        details: 'Approved PR-2026-00101 under budget CC-MFG-PUNE.',
        ipAddress: '192.168.1.10',
      },
      {
        userId: officer.id,
        action: 'ISSUE_PO',
        entity: 'PURCHASE_ORDER',
        entityId: po1.id,
        details: 'Issued Purchase Order PO-2026-00441 for ₹2,86,150.00 to Tata Steel BSL Ltd.',
        ipAddress: '192.168.1.22',
      },
      {
        userId: finance.id,
        action: 'EXECUTE_PAYMENT',
        entity: 'PAYMENT',
        details: 'Processed electronic settlement RTGS-SBI-9912048 for ₹2,86,150.00 to Tata Steel BSL.',
        ipAddress: '192.168.1.18',
      },
    ],
  })

  console.log('--- SLT Procurement Suite Database Successfully Seeded with Complete Enterprise Data! ---')
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
