"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_TEMPLATE_NAME = exports.FALLBACK_STARTER_ID = exports.STARTER_LAYOUTS = void 0;
exports.findStarter = findStarter;
exports.designFromStarter = designFromStarter;
const classic = {
    schemaVersion: 1,
    page: { size: 'A4', orientation: 'landscape' },
    theme: {
        primaryColor: '#1F2A44',
        accentColor: '#B08D57',
        textColor: '#1F2937',
        mutedColor: '#6B7280',
        backgroundColor: '#FFFDF7',
        headingFont: 'cinzel',
        bodyFont: 'libre-baskerville',
        nameFont: 'great-vibes'
    },
    border: { style: 'double', widthMm: 1.2, color: 'accent', insetMm: 10 },
    background: { watermark: 'seal', watermarkOpacity: 0.06, accentBar: 'none' },
    header: {
        showLogo: true,
        showSeal: false,
        logoPosition: 'center',
        logoHeightMm: 22,
        showInstitutionName: true,
        institutionNameColor: 'primary',
        institutionNameSizePt: 20
    },
    title: { text: 'Certificate of Achievement', sizePt: 40, align: 'center', color: 'primary', letterSpacing: 3, uppercase: true },
    body: {
        text: 'This is to certify that {{student_name}} has been awarded the {{certificate_type}} in {{program_name}}, having fulfilled all the requirements prescribed by {{institution_name}}.',
        sizePt: 14,
        align: 'center',
        lineHeight: 1.6,
        nameSizePt: 40,
        nameColor: 'primary'
    },
    fields: { dateFormat: 'DD MMMM YYYY', showClassification: true, showGraduationDate: true, showStudentNumber: false },
    signatories: { ids: [], showTitles: true, lineStyle: 'line' },
    footer: { text: 'Awarded on {{issue_date}}', align: 'center', sizePt: 9 },
    verification: { qrPosition: 'bottom-right', qrSizeMm: 26 }
};
const modern = {
    schemaVersion: 1,
    page: { size: 'A4', orientation: 'landscape' },
    theme: {
        primaryColor: '#0F172A',
        accentColor: '#0F766E',
        textColor: '#1E293B',
        mutedColor: '#64748B',
        backgroundColor: '#FFFFFF',
        headingFont: 'montserrat',
        bodyFont: 'lato',
        nameFont: 'montserrat'
    },
    border: { style: 'single', widthMm: 0.4, color: 'muted', insetMm: 8 },
    background: { watermark: 'none', watermarkOpacity: 0.05, accentBar: 'left' },
    header: {
        showLogo: true,
        showSeal: false,
        logoPosition: 'left',
        logoHeightMm: 16,
        showInstitutionName: true,
        institutionNameColor: 'primary',
        institutionNameSizePt: 14
    },
    title: { text: 'Certificate', sizePt: 34, align: 'left', color: 'primary', letterSpacing: 1, uppercase: false },
    body: {
        text: 'Awarded to {{student_name}} for successfully completing the {{certificate_type}} in {{program_name}}.',
        sizePt: 13,
        align: 'left',
        lineHeight: 1.5,
        nameSizePt: 34,
        nameColor: 'accent'
    },
    fields: { dateFormat: 'MMMM D, YYYY', showClassification: true, showGraduationDate: false, showStudentNumber: true },
    signatories: { ids: [], showTitles: true, lineStyle: 'line' },
    footer: { text: '{{institution_name}} · Issued {{issue_date}}', align: 'left', sizePt: 8 },
    verification: { qrPosition: 'bottom-right', qrSizeMm: 24 }
};
const minimal = {
    schemaVersion: 1,
    page: { size: 'A4', orientation: 'landscape' },
    theme: {
        primaryColor: '#111827',
        accentColor: '#6B7280',
        textColor: '#111827',
        mutedColor: '#9CA3AF',
        backgroundColor: '#FFFFFF',
        headingFont: 'lato',
        bodyFont: 'lato',
        nameFont: 'lato'
    },
    border: { style: 'none', widthMm: 0.3, color: 'muted', insetMm: 12 },
    background: { watermark: 'none', watermarkOpacity: 0.05, accentBar: 'none' },
    header: {
        showLogo: true,
        showSeal: false,
        logoPosition: 'center',
        logoHeightMm: 14,
        showInstitutionName: true,
        institutionNameColor: 'muted',
        institutionNameSizePt: 11
    },
    title: { text: 'Certificate of Completion', sizePt: 22, align: 'center', color: 'text', letterSpacing: 4, uppercase: true },
    body: {
        text: '{{student_name}} has completed the {{certificate_type}} in {{program_name}}.',
        sizePt: 12,
        align: 'center',
        lineHeight: 1.8,
        nameSizePt: 30,
        nameColor: 'text'
    },
    fields: { dateFormat: 'DD MMMM YYYY', showClassification: false, showGraduationDate: false, showStudentNumber: false },
    signatories: { ids: [], showTitles: true, lineStyle: 'none' },
    footer: { text: '', align: 'center', sizePt: 8 },
    verification: { qrPosition: 'bottom-center', qrSizeMm: 22 }
};
exports.STARTER_LAYOUTS = [
    { id: 'classic', name: 'Classic', description: 'Formal and traditional: double border, serif lettering, a script name and a faint seal watermark.', signatoryCount: 2, design: classic },
    { id: 'modern', name: 'Modern', description: 'Clean and contemporary: thin border, an accent bar on the left and a left-aligned layout.', signatoryCount: 2, design: modern },
    { id: 'minimal', name: 'Minimal', description: 'Quiet and spacious: no border, one typeface and a small centred title.', signatoryCount: 1, design: minimal }
];
/** Used at issuance when neither a templateId nor a default template is available. */
exports.FALLBACK_STARTER_ID = 'classic';
exports.FALLBACK_TEMPLATE_NAME = 'Classic (built-in)';
function findStarter(starterId) {
    return exports.STARTER_LAYOUTS.find((starter) => starter.id === starterId);
}
/** A copy of the starter's design with up to `signatoryCount` of the institution's active signatories, in display order. */
function designFromStarter(starter, activeSignatoryIds) {
    const design = structuredClone(starter.design);
    design.signatories.ids = activeSignatoryIds.slice(0, starter.signatoryCount);
    return design;
}
