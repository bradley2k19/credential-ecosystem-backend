import express from 'express';
import cors from 'cors';
import env from './config/env';
import errorHandler from './middleware/error.middleware';
import authRoutes from './routes/auth.routes';
import institutionRoutes from './routes/institutions.routes';
import adminRoutes from './routes/admin.routes';
import verifyRoutes from './routes/verify.routes';
import employerRoutes from './routes/employers.routes';
import studentRoutes from './routes/students.routes';

const app = express();

app.use(express.json());
app.use(
  cors({
    // Exact-match allowlist: only a listed origin is echoed back, never a wildcard or an arbitrary origin.
    // Requests without an Origin header (server-to-server tools) are not affected by CORS and still pass.
    origin: env.FRONTEND_ORIGINS,
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null });
});

app.use('/api/auth', authRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/employers', employerRoutes);
app.use('/api/students', studentRoutes);

// Centralized error handling
app.use(errorHandler);

export default app;

// If run directly, start a local server (not used on Vercel)
if (require.main === module) {
  const port = env.PORT || 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Server listening on http://localhost:${port}`);
  });
}
