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
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use((0, cors_1.default)({
    origin: env_1.default.FRONTEND_URL
}));
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});
app.use('/api/auth', auth_routes_1.default);
app.use('/api/institutions', institutions_routes_1.default);
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
