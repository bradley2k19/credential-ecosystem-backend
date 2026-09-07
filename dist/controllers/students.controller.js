"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.placeholder = void 0;
const placeholder = (req, res) => {
    res.json({ message: 'students controller placeholder' });
};
exports.placeholder = placeholder;
exports.default = { placeholder: exports.placeholder };
