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
import assetRoutes from './routes/assets.routes';

const app = express();

// CORS runs first so every response carries its headers, including body-size errors from the parsers below
// and the public asset images, which the frontend reads when capturing a certificate.
app.use(
  cors({
    // Exact-match allowlist: only a listed origin is echoed back, never a wildcard or an arbitrary origin.
    // Requests without an Origin header (server-to-server tools) are not affected by CORS and still pass.
    origin: env.FRONTEND_ORIGINS,
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// Image uploads carry up to 500 KB as base64, so only these routes accept JSON bodies up to 1 MB.
// They are parsed first; the default parser below then skips the already-parsed body.
const uploadRoutes = [
  /^\/api\/institutions\/me\/(logo|seal)\/?$/,
  /^\/api\/institutions\/me\/signatories\/?$/,
  /^\/api\/institutions\/me\/signatories\/[^/]+\/signature\/?$/
];
const uploadJsonParser = express.json({ limit: '1mb' });
app.use((req, res, next) => (uploadRoutes.some((route) => route.test(req.path)) ? uploadJsonParser(req, res, next) : next()));
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null });
});

app.use('/api/auth', authRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/verify', verifyRoutes);
app.use('/api/employers', employerRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/assets', assetRoutes);

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
