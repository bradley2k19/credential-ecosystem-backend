"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const env_1 = __importDefault(require("./config/env"));
const error_middleware_1 = __importDefault(require("./middleware/error.middleware"));
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const institutions_routes_1 = __importDefault(require("./routes/institutions.routes"));
const admin_routes_1 = __importDefault(require("./routes/admin.routes"));
const verify_routes_1 = __importDefault(require("./routes/verify.routes"));
const employers_routes_1 = __importDefault(require("./routes/employers.routes"));
const students_routes_1 = __importDefault(require("./routes/students.routes"));
const assets_routes_1 = __importDefault(require("./routes/assets.routes"));
const templates_routes_1 = __importDefault(require("./routes/templates.routes"));
const app = (0, express_1.default)();
// CORS runs first so every response carries its headers, including body-size errors from the parsers below
// and the public asset images, which the frontend reads when capturing a certificate.
app.use((0, cors_1.default)({
    // Exact-match allowlist: only a listed origin is echoed back, never a wildcard or an arbitrary origin.
    // Requests without an Origin header (server-to-server tools) are not affected by CORS and still pass.
    origin: env_1.default.FRONTEND_ORIGINS,
    allowedHeaders: ['Content-Type', 'Authorization']
}));
// Image uploads carry up to 500 KB as base64, so only these routes accept JSON bodies up to 1 MB.
// They are parsed first; the default parser below then skips the already-parsed body.
const uploadRoutes = [
    /^\/api\/institutions\/me\/(logo|seal)\/?$/,
    /^\/api\/institutions\/me\/signatories\/?$/,
    /^\/api\/institutions\/me\/signatories\/[^/]+\/signature\/?$/
];
const uploadJsonParser = express_1.default.json({ limit: '1mb' });
app.use((req, res, next) => (uploadRoutes.some((route) => route.test(req.path)) ? uploadJsonParser(req, res, next) : next()));
app.use(express_1.default.json());
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null });
});
app.use('/api/auth', auth_routes_1.default);
app.use('/api/institutions', institutions_routes_1.default);
app.use('/api/admin', admin_routes_1.default);
app.use('/api/verify', verify_routes_1.default);
app.use('/api/employers', employers_routes_1.default);
app.use('/api/students', students_routes_1.default);
app.use('/api/assets', assets_routes_1.default);
app.use('/api/templates', templates_routes_1.default);
// Centralized error handling
app.use(error_middleware_1.default);
exports.default = app;
// If run directly, start a local server (not used on Vercel)
if (require.main === module) {
    const port = env_1.default.PORT || 3000;
    app.listen(port, () => {
        // eslint-disable-next-line no-console
        console.log(`Server listening on http://localhost:${port}`);
    });
}
