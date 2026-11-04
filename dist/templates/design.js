"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.templateDesignSchema = void 0;
exports.placeholdersIn = placeholdersIn;
exports.plainTextError = plainTextError;
exports.validateTemplateDesign = validateTemplateDesign;
const zod_1 = require("zod");
const options_1 = require("./options");
// Design format version 1. Every object is strict: unknown keys are rejected at any depth, which also
// keeps images, URLs and asset ids out of stored designs.
const hexPattern = /^#[0-9A-Fa-f]{6}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001F\u007F-\u009F]/;
const placeholderPattern = /\{\{([^{}]*)\}\}/g;
const allowedPlaceholders = new Set(options_1.PLACEHOLDER_NAMES);
/** Placeholder names used in a text, e.g. "student_name" for "{{student_name}}". */
function placeholdersIn(text) {
    return [...text.matchAll(placeholderPattern)].map((match) => match[1]);
}
/** Plain-text rules shared by design texts and template names. Returns an error message, or "" when valid. */
function plainTextError(text) {
    if (controlCharacters.test(text))
        return 'must not contain control characters or line breaks';
    if (/[<>]/.test(text))
        return 'must not contain < or >';
    return '';
}
function placeholderText(max) {
    return zod_1.z.string().max(max, { error: `must be at most ${max} characters` }).superRefine((text, ctx) => {
        const plainError = plainTextError(text);
        if (plainError)
            ctx.addIssue({ code: 'custom', message: plainError });
        for (const name of placeholdersIn(text)) {
            if (!allowedPlaceholders.has(name)) {
                ctx.addIssue({ code: 'custom', message: `uses an unknown placeholder {{${name}}}. Allowed: ${options_1.PLACEHOLDER_NAMES.map((item) => `{{${item}}}`).join(', ')}` });
            }
        }
        // Braces left over once every {{...}} is removed mean a placeholder was not closed or opened properly.
        if (/[{}]/.test(text.replace(placeholderPattern, ''))) {
            ctx.addIssue({ code: 'custom', message: 'has an unmatched { or }. Placeholders look like {{student_name}}' });
        }
    });
}
const range = (limit) => zod_1.z.number({ error: `must be a number from ${limit.min} to ${limit.max}` })
    .min(limit.min, { error: `must be from ${limit.min} to ${limit.max}` })
    .max(limit.max, { error: `must be from ${limit.min} to ${limit.max}` });
const hex = zod_1.z.string({ error: 'must be a colour in the form #RRGGBB' }).regex(hexPattern, { error: 'must be a colour in the form #RRGGBB' });
const font = zod_1.z.enum(options_1.FONT_IDS, { error: `must be one of the supported fonts: ${options_1.FONT_IDS.join(', ')}` });
const colorToken = zod_1.z.enum(['primary', 'accent', 'text', 'muted'], { error: 'must be one of primary, accent, text, muted' });
const align = zod_1.z.enum(['left', 'center', 'right'], { error: 'must be left, center or right' });
exports.templateDesignSchema = zod_1.z.strictObject({
    schemaVersion: zod_1.z.literal(1, { error: 'must be 1' }),
    page: zod_1.z.strictObject({
        size: zod_1.z.enum(['A4', 'LETTER'], { error: 'must be A4 or LETTER' }),
        orientation: zod_1.z.enum(['landscape', 'portrait'], { error: 'must be landscape or portrait' })
    }),
    theme: zod_1.z.strictObject({
        primaryColor: hex,
        accentColor: hex,
        textColor: hex,
        mutedColor: hex,
        backgroundColor: hex,
        headingFont: font,
        bodyFont: font,
        nameFont: font
    }),
    border: zod_1.z.strictObject({
        style: zod_1.z.enum(['none', 'single', 'double', 'frame'], { error: 'must be none, single, double or frame' }),
        widthMm: range(options_1.DESIGN_LIMITS.borderWidthMm),
        color: colorToken,
        insetMm: range(options_1.DESIGN_LIMITS.borderInsetMm)
    }),
    background: zod_1.z.strictObject({
        watermark: zod_1.z.enum(['none', 'logo', 'seal'], { error: 'must be none, logo or seal' }),
        watermarkOpacity: range(options_1.DESIGN_LIMITS.watermarkOpacity),
        accentBar: zod_1.z.enum(['none', 'top', 'left'], { error: 'must be none, top or left' })
    }),
    header: zod_1.z.strictObject({
        showLogo: zod_1.z.boolean(),
        showSeal: zod_1.z.boolean(),
        logoPosition: align,
        logoHeightMm: range(options_1.DESIGN_LIMITS.logoHeightMm),
        showInstitutionName: zod_1.z.boolean(),
        institutionNameColor: colorToken,
        institutionNameSizePt: range(options_1.DESIGN_LIMITS.institutionNameSizePt)
    }),
    title: zod_1.z.strictObject({
        text: placeholderText(options_1.DESIGN_LIMITS.titleTextMaxLength),
        sizePt: range(options_1.DESIGN_LIMITS.titleSizePt),
        align,
        color: colorToken,
        letterSpacing: range(options_1.DESIGN_LIMITS.titleLetterSpacing),
        uppercase: zod_1.z.boolean()
    }),
    body: zod_1.z.strictObject({
        text: placeholderText(options_1.DESIGN_LIMITS.bodyTextMaxLength).refine((text) => placeholdersIn(text).includes('student_name'), {
            error: 'must contain {{student_name}}'
        }),
        sizePt: range(options_1.DESIGN_LIMITS.bodySizePt),
        align,
        lineHeight: range(options_1.DESIGN_LIMITS.bodyLineHeight),
        nameSizePt: range(options_1.DESIGN_LIMITS.nameSizePt),
        nameColor: colorToken
    }),
    fields: zod_1.z.strictObject({
        dateFormat: zod_1.z.enum(options_1.DATE_FORMATS, { error: `must be one of: ${options_1.DATE_FORMATS.join(', ')}` }),
        showClassification: zod_1.z.boolean(),
        showGraduationDate: zod_1.z.boolean(),
        showStudentNumber: zod_1.z.boolean()
    }),
    signatories: zod_1.z.strictObject({
        ids: zod_1.z.array(zod_1.z.string().regex(uuidPattern, { error: 'must be a signatory id' }))
            .max(options_1.DESIGN_LIMITS.maxSignatories, { error: `can list at most ${options_1.DESIGN_LIMITS.maxSignatories} signatories` })
            .refine((ids) => new Set(ids).size === ids.length, { error: 'must not list the same signatory twice' }),
        showTitles: zod_1.z.boolean(),
        lineStyle: zod_1.z.enum(['line', 'none'], { error: 'must be line or none' })
    }),
    footer: zod_1.z.strictObject({
        text: placeholderText(options_1.DESIGN_LIMITS.footerTextMaxLength),
        align,
        sizePt: range(options_1.DESIGN_LIMITS.footerSizePt)
    }),
    verification: zod_1.z.strictObject({
        qrPosition: zod_1.z.enum(['bottom-left', 'bottom-center', 'bottom-right'], { error: 'must be bottom-left, bottom-center or bottom-right' }),
        qrSizeMm: range(options_1.DESIGN_LIMITS.qrSizeMm)
    })
});
const MAX_REPORTED_ISSUES = 5;
/** Validates a design against format version 1, including the 10 KB size limit. Messages name the field. */
function validateTemplateDesign(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, error: 'design must be an object' };
    }
    const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
    if (bytes > options_1.DESIGN_LIMITS.maxDesignBytes) {
        return { ok: false, error: `design must be at most ${options_1.DESIGN_LIMITS.maxDesignBytes / 1024} KB when serialised (this one is ${(bytes / 1024).toFixed(1)} KB)` };
    }
    const result = exports.templateDesignSchema.safeParse(input);
    if (result.success)
        return { ok: true, design: result.data };
    const messages = result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
        const path = issue.path.length ? `design.${issue.path.join('.')}` : 'design';
        if (issue.code === 'unrecognized_keys')
            return `${path} has unknown ${issue.keys.length === 1 ? 'key' : 'keys'}: ${issue.keys.join(', ')}`;
        if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined'))
            return `${path} is required`;
        return `${path} ${issue.message}`;
    });
    const more = result.error.issues.length - MAX_REPORTED_ISSUES;
    return { ok: false, error: `Invalid design: ${messages.join('; ')}${more > 0 ? `; and ${more} more` : ''}` };
}
