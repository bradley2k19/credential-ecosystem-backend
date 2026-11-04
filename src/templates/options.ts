// Single source of truth for the certificate design format: fonts, placeholders, date formats and limits.
// The validation schema, the starter layouts and GET /api/templates/options all read from here.

export const FONT_IDS = [
  'cinzel',
  'playfair-display',
  'cormorant-garamond',
  'libre-baskerville',
  'merriweather',
  'montserrat',
  'lato',
  'open-sans',
  'great-vibes'
] as const;
export type FontId = typeof FONT_IDS[number];

// The role is a hint for the editor; any font may be used in any slot.
export const FONTS: { id: FontId; label: string; role: 'heading' | 'body' | 'script' }[] = [
  { id: 'cinzel', label: 'Cinzel', role: 'heading' },
  { id: 'playfair-display', label: 'Playfair Display', role: 'heading' },
  { id: 'cormorant-garamond', label: 'Cormorant Garamond', role: 'heading' },
  { id: 'libre-baskerville', label: 'Libre Baskerville', role: 'body' },
  { id: 'merriweather', label: 'Merriweather', role: 'body' },
  { id: 'montserrat', label: 'Montserrat', role: 'heading' },
  { id: 'lato', label: 'Lato', role: 'body' },
  { id: 'open-sans', label: 'Open Sans', role: 'body' },
  { id: 'great-vibes', label: 'Great Vibes', role: 'script' }
];

export const PLACEHOLDER_NAMES = [
  'student_name',
  'student_number',
  'certificate_type',
  'program_name',
  'classification',
  'issue_date',
  'graduation_date',
  'institution_name',
  'certificate_id'
] as const;
export type PlaceholderName = typeof PLACEHOLDER_NAMES[number];

// Sample values are deliberately realistic and long, so previews show how wrapping behaves.
// Dates are ISO; the renderer formats them with the design's fields.dateFormat.
export const PLACEHOLDERS: { name: PlaceholderName; label: string; sample: string }[] = [
  { name: 'student_name', label: 'Student name', sample: 'Alexandra Catherine Montgomery-Ramgoolam' },
  { name: 'student_number', label: 'Student number', sample: 'STU-2026-004517' },
  { name: 'certificate_type', label: 'Certificate type', sample: 'Bachelor of Science (Honours)' },
  { name: 'program_name', label: 'Programme', sample: 'Software Engineering and Information Systems' },
  { name: 'classification', label: 'Classification', sample: 'First Class Honours' },
  { name: 'issue_date', label: 'Issue date', sample: '2026-07-15' },
  { name: 'graduation_date', label: 'Graduation date', sample: '2026-06-30' },
  { name: 'institution_name', label: 'Institution name', sample: 'University of Mauritius' },
  { name: 'certificate_id', label: 'Certificate ID', sample: '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b' }
];

export const DATE_FORMATS = ['DD MMMM YYYY', 'MMMM D, YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'] as const;
export type DateFormat = typeof DATE_FORMATS[number];

export const DATE_FORMAT_OPTIONS: { id: DateFormat; example: string }[] = [
  { id: 'DD MMMM YYYY', example: '15 July 2026' },
  { id: 'MMMM D, YYYY', example: 'July 15, 2026' },
  { id: 'DD/MM/YYYY', example: '15/07/2026' },
  { id: 'YYYY-MM-DD', example: '2026-07-15' }
];

/** Numeric and length limits of the design format (inclusive). */
export const DESIGN_LIMITS = {
  borderWidthMm: { min: 0.3, max: 3 },
  borderInsetMm: { min: 5, max: 20 },
  watermarkOpacity: { min: 0.03, max: 0.15 },
  logoHeightMm: { min: 10, max: 35 },
  institutionNameSizePt: { min: 10, max: 28 },
  titleSizePt: { min: 20, max: 60 },
  titleLetterSpacing: { min: 0, max: 8 },
  bodySizePt: { min: 10, max: 20 },
  bodyLineHeight: { min: 1.2, max: 2.2 },
  nameSizePt: { min: 20, max: 48 },
  footerSizePt: { min: 7, max: 12 },
  qrSizeMm: { min: 22, max: 40 },
  titleTextMaxLength: 80,
  bodyTextMaxLength: 600,
  footerTextMaxLength: 200,
  maxSignatories: 3,
  maxDesignBytes: 10 * 1024
} as const;

export const TEMPLATE_NAME_MAX_LENGTH = 60;
export const MAX_ACTIVE_TEMPLATES = 20;
