import { z } from 'zod';
import { DATE_FORMATS, DESIGN_LIMITS as L, FONT_IDS, PLACEHOLDER_NAMES } from './options';

// Design format version 1. Every object is strict: unknown keys are rejected at any depth, which also
// keeps images, URLs and asset ids out of stored designs.

const hexPattern = /^#[0-9A-Fa-f]{6}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const controlCharacters = /[\u0000-\u001F\u007F-\u009F]/;
const placeholderPattern = /\{\{([^{}]*)\}\}/g;
const allowedPlaceholders = new Set<string>(PLACEHOLDER_NAMES);

/** Placeholder names used in a text, e.g. "student_name" for "{{student_name}}". */
export function placeholdersIn(text: string) {
  return [...text.matchAll(placeholderPattern)].map((match) => match[1]);
}

/** Plain-text rules shared by design texts and template names. Returns an error message, or "" when valid. */
export function plainTextError(text: string) {
  if (controlCharacters.test(text)) return 'must not contain control characters or line breaks';
  if (/[<>]/.test(text)) return 'must not contain < or >';
  return '';
}

function placeholderText(max: number) {
  return z.string().max(max, { error: `must be at most ${max} characters` }).superRefine((text, ctx) => {
    const plainError = plainTextError(text);
    if (plainError) ctx.addIssue({ code: 'custom', message: plainError });
    for (const name of placeholdersIn(text)) {
      if (!allowedPlaceholders.has(name)) {
        ctx.addIssue({ code: 'custom', message: `uses an unknown placeholder {{${name}}}. Allowed: ${PLACEHOLDER_NAMES.map((item) => `{{${item}}}`).join(', ')}` });
      }
    }
    // Braces left over once every {{...}} is removed mean a placeholder was not closed or opened properly.
    if (/[{}]/.test(text.replace(placeholderPattern, ''))) {
      ctx.addIssue({ code: 'custom', message: 'has an unmatched { or }. Placeholders look like {{student_name}}' });
    }
  });
}

const range = (limit: { min: number; max: number }) =>
  z.number({ error: `must be a number from ${limit.min} to ${limit.max}` })
    .min(limit.min, { error: `must be from ${limit.min} to ${limit.max}` })
    .max(limit.max, { error: `must be from ${limit.min} to ${limit.max}` });

const hex = z.string({ error: 'must be a colour in the form #RRGGBB' }).regex(hexPattern, { error: 'must be a colour in the form #RRGGBB' });
const font = z.enum(FONT_IDS, { error: `must be one of the supported fonts: ${FONT_IDS.join(', ')}` });
const colorToken = z.enum(['primary', 'accent', 'text', 'muted'], { error: 'must be one of primary, accent, text, muted' });
const align = z.enum(['left', 'center', 'right'], { error: 'must be left, center or right' });

export const templateDesignSchema = z.strictObject({
  schemaVersion: z.literal(1, { error: 'must be 1' }),
  page: z.strictObject({
    size: z.enum(['A4', 'LETTER'], { error: 'must be A4 or LETTER' }),
    orientation: z.enum(['landscape', 'portrait'], { error: 'must be landscape or portrait' })
  }),
  theme: z.strictObject({
    primaryColor: hex,
    accentColor: hex,
    textColor: hex,
    mutedColor: hex,
    backgroundColor: hex,
    headingFont: font,
    bodyFont: font,
    nameFont: font
  }),
  border: z.strictObject({
    style: z.enum(['none', 'single', 'double', 'frame'], { error: 'must be none, single, double or frame' }),
    widthMm: range(L.borderWidthMm),
    color: colorToken,
    insetMm: range(L.borderInsetMm)
  }),
  background: z.strictObject({
    watermark: z.enum(['none', 'logo', 'seal'], { error: 'must be none, logo or seal' }),
    watermarkOpacity: range(L.watermarkOpacity),
    accentBar: z.enum(['none', 'top', 'left'], { error: 'must be none, top or left' })
  }),
  header: z.strictObject({
    showLogo: z.boolean(),
    showSeal: z.boolean(),
    logoPosition: align,
    logoHeightMm: range(L.logoHeightMm),
    showInstitutionName: z.boolean(),
    institutionNameColor: colorToken,
    institutionNameSizePt: range(L.institutionNameSizePt)
  }),
  title: z.strictObject({
    text: placeholderText(L.titleTextMaxLength),
    sizePt: range(L.titleSizePt),
    align,
    color: colorToken,
    letterSpacing: range(L.titleLetterSpacing),
    uppercase: z.boolean()
  }),
  body: z.strictObject({
    text: placeholderText(L.bodyTextMaxLength).refine((text) => placeholdersIn(text).includes('student_name'), {
      error: 'must contain {{student_name}}'
    }),
    sizePt: range(L.bodySizePt),
    align,
    lineHeight: range(L.bodyLineHeight),
    nameSizePt: range(L.nameSizePt),
    nameColor: colorToken
  }),
  fields: z.strictObject({
    dateFormat: z.enum(DATE_FORMATS, { error: `must be one of: ${DATE_FORMATS.join(', ')}` }),
    showClassification: z.boolean(),
    showGraduationDate: z.boolean(),
    showStudentNumber: z.boolean()
  }),
  signatories: z.strictObject({
    ids: z.array(z.string().regex(uuidPattern, { error: 'must be a signatory id' }))
      .max(L.maxSignatories, { error: `can list at most ${L.maxSignatories} signatories` })
      .refine((ids) => new Set(ids).size === ids.length, { error: 'must not list the same signatory twice' }),
    showTitles: z.boolean(),
    lineStyle: z.enum(['line', 'none'], { error: 'must be line or none' })
  }),
  footer: z.strictObject({
    text: placeholderText(L.footerTextMaxLength),
    align,
    sizePt: range(L.footerSizePt)
  }),
  verification: z.strictObject({
    qrPosition: z.enum(['bottom-left', 'bottom-center', 'bottom-right'], { error: 'must be bottom-left, bottom-center or bottom-right' }),
    qrSizeMm: range(L.qrSizeMm)
  })
});

export type TemplateDesign = z.infer<typeof templateDesignSchema>;

export type DesignValidationResult = { ok: true; design: TemplateDesign } | { ok: false; error: string };

const MAX_REPORTED_ISSUES = 5;

/** Validates a design against format version 1, including the 10 KB size limit. Messages name the field. */
export function validateTemplateDesign(input: unknown): DesignValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'design must be an object' };
  }
  const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  if (bytes > L.maxDesignBytes) {
    return { ok: false, error: `design must be at most ${L.maxDesignBytes / 1024} KB when serialised (this one is ${(bytes / 1024).toFixed(1)} KB)` };
  }

  const result = templateDesignSchema.safeParse(input);
  if (result.success) return { ok: true, design: result.data };

  const messages = result.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.length ? `design.${issue.path.join('.')}` : 'design';
    if (issue.code === 'unrecognized_keys') return `${path} has unknown ${issue.keys.length === 1 ? 'key' : 'keys'}: ${issue.keys.join(', ')}`;
    if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined')) return `${path} is required`;
    return `${path} ${issue.message}`;
  });
  const more = result.error.issues.length - MAX_REPORTED_ISSUES;
  return { ok: false, error: `Invalid design: ${messages.join('; ')}${more > 0 ? `; and ${more} more` : ''}` };
}
