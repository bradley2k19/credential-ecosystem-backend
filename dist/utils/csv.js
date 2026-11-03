"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.csvField = csvField;
exports.toCsv = toCsv;
exports.csvDate = csvDate;
// Spreadsheet apps treat a leading =, +, -, @, tab or carriage return as the start of a formula.
const formulaTrigger = /^[=+\-@\t\r]/;
/** Escapes one CSV field (RFC 4180) and neutralises spreadsheet formula injection in text values. */
function csvField(value) {
    if (value === null || value === undefined)
        return '';
    const safe = formulaTrigger.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
/** Joins rows into a CSV document with CRLF line endings. */
function toCsv(header, rows) {
    return [header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}
/** YYYY-MM-DD in UTC, matching how certificate dates are stored. */
function csvDate(value) {
    return value ? value.toISOString().slice(0, 10) : '';
}
exports.default = { csvField, toCsv, csvDate };
