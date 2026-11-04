"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const assets_controller_1 = __importDefault(require("../controllers/assets.controller"));
const router = (0, express_1.Router)();
// Public on purpose: see assets.controller.ts.
router.get('/:assetId', assets_controller_1.default.getAsset);
exports.default = router;
