import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import { authRouter } from './routes/auth.routes.js'
import { dashboardRouter } from './routes/dashboard.routes.js'
import { requisitionsRouter } from './routes/requisitions.routes.js'
import { vendorsRouter } from './routes/vendors.routes.js'
import { purchaseOrdersRouter } from './routes/purchaseOrders.routes.js'
import { approvalsRouter } from './routes/approvals.routes.js'
import { itemsRouter } from './routes/items.routes.js'
import { goodsReceiptsRouter } from './routes/goodsReceipts.routes.js'
import { invoicesRouter } from './routes/invoices.routes.js'
import { reportsRouter } from './routes/reports.routes.js'
import { inquiriesRouter } from './routes/inquiries.routes.js'
import { rfqsRouter } from './routes/rfqs.routes.js'
import { vendorAuditRouter } from './routes/vendorAudit.routes.js'
import { paymentsRouter } from './routes/payments.routes.js'
import { contractsRouter } from './routes/contracts.routes.js'
import { settingsRouter } from './routes/settings.routes.js'
import { errorHandler } from './middleware/errorHandler.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

// Security & Parsing Middlewares
app.use(helmet())
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)
app.use(cookieParser())
app.use(express.json())

// Request Logger
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms`)
  })
  next()
})

// Healthcheck
app.get(['/api/v1/health', '/api/health'], (req, res) => {
  res.json({
    status: 'online',
    service: 'SLT Procurement Suite API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  })
})

// Mount API Endpoints (supporting both /api/v1 and /api prefixes)
const apiRoutes = [
  { path: '/auth', router: authRouter },
  { path: '/dashboard', router: dashboardRouter },
  { path: '/requisitions', router: requisitionsRouter },
  { path: '/inquiries', router: inquiriesRouter },
  { path: '/rfqs', router: rfqsRouter },
  { path: '/vendors', router: vendorsRouter },
  { path: '/vendor-audits', vendor: vendorAuditRouter },
  { path: '/purchase-orders', router: purchaseOrdersRouter },
  { path: '/approvals', router: approvalsRouter },
  { path: '/items', router: itemsRouter },
  { path: '/goods-receipts', router: goodsReceiptsRouter },
  { path: '/supplier-invoices', router: invoicesRouter },
  { path: '/payments', router: paymentsRouter },
  { path: '/rate-contracts', router: contractsRouter },
  { path: '/settings', router: settingsRouter },
  { path: '/reports', router: reportsRouter },
]

for (const route of apiRoutes) {
  const router = route.router || (route as any).vendor
  app.use(`/api/v1${route.path}`, router)
  app.use(`/api${route.path}`, router)
}

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Cannot ${req.method} ${req.originalUrl} - Endpoint not found`,
  })
})

// Centralized Error Handler
app.use(errorHandler)

app.listen(PORT, () => {
  console.log(`=================================================`)
  console.log(`  SLT Procurement Suite API Server Running       `)
  console.log(`  Port: http://localhost:${PORT}                 `)
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`)
  console.log(`=================================================`)
})
