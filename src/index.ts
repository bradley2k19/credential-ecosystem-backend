import express from 'express';
import cors from 'cors';
import env from './config/env';
import errorHandler from './middleware/error.middleware';

const app = express();

app.use(express.json());
app.use(
  cors({
    origin: env.FRONTEND_URL
  })
);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

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
