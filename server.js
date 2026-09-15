require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const { Server } = require('socket.io');
const { connectDB } = require('./config/db');
const { auth } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const tableRoutes = require('./routes/tables');
const orderRoutes = require('./routes/orders');
const menuRoutes = require('./routes/menu');
const billingRoutes = require('./routes/billing');
const inventoryRoutes = require('./routes/inventory');
const staffRoutes = require('./routes/staff');
const attendanceRoutes = require('./routes/attendance');
const customerRoutes = require('./routes/customers');
const analyticsRoutes = require('./routes/analytics');
const hotelRoutes = require('./routes/hotel');
const aiRoutes = require('./routes/ai');
const tenantRoutes = require('./routes/tenant');
const { setupSocket } = require('./socket/socketHandler');

const app = express();
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' })); // generous for base64 menu-photo uploads (see routes/ai.js)
app.use((req, res, next) => { req.io = io; next(); });

app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'THAALI', version: '1.0.0' }));

// /api/auth is intentionally mounted before the auth gate below — login/register can't
// require the very token they're issuing (/me applies `auth` itself, per-route, in routes/auth.js).
app.use('/api/auth', authRoutes);

app.use('/api', auth);

app.use('/api/tables', tableRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/hotel', hotelRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/tenant', tenantRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

setupSocket(io);

connectDB();

const PORT = process.env.PORT;
if (!PORT) {
  console.error('❌ Missing PORT in environment — set it in backend/.env (see .env.example). Refusing to guess a default.');
  process.exit(1);
}
httpServer.listen(PORT, () => console.log(`🍽️  THAALI backend running on http://localhost:${PORT}`));
module.exports = { app, io };
