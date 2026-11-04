"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unarchiveTemplate = exports.archiveTemplate = void 0;
exports.getOptions = getOptions;
exports.listTemplates = listTemplates;
exports.getTemplate = getTemplate;
exports.createTemplate = createTemplate;
exports.updateTemplate = updateTemplate;
exports.cloneTemplate = cloneTemplate;
exports.setDefaultTemplate = setDefaultTemplate;
const client_1 = require("@prisma/client");
const db_1 = __importDefault(require("../config/db"));
const design_1 = require("../templates/design");
const options_1 = require("../templates/options");
const snapshot_1 = require("../templates/snapshot");
const starters_1 = require("../templates/starters");
const templateFields = { id: true, name: true, isDefault: true, isArchived: true, design: true, updatedAt: true };
class TemplateRequestError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
async function getInstitutionId(userId) {
    const institution = await db_1.default.institution.findUnique({
        where: { userId },
        select: { id: true }
    });
    return institution?.id;
}
/** Trims and checks a template name; returns the name and its case-insensitive key, or throws a 400. */
function readName(value) {
    if (typeof value !== 'string' || !value.trim())
        throw new TemplateRequestError(400, 'name is required');
    const name = value.trim();
    if (name.length > options_1.TEMPLATE_NAME_MAX_LENGTH)
        throw new TemplateRequestError(400, `name must be at most ${options_1.TEMPLATE_NAME_MAX_LENGTH} characters`);
    const textError = (0, design_1.plainTextError)(name);
    if (textError)
        throw new TemplateRequestError(400, `name ${textError}`);
    return { name, nameKey: name.toLowerCase() };
}
async function assertNameAvailable(tx, institutionId, nameKey, exceptTemplateId) {
    const clash = await tx.certificateTemplate.findFirst({
        where: { institutionId, nameKey, ...(exceptTemplateId ? { id: { not: exceptTemplateId } } : {}) },
        select: { id: true }
    });
    if (clash)
        throw new TemplateRequestError(409, 'You already have a template with this name');
}
async function assertBelowTemplateLimit(tx, institutionId) {
    const active = await tx.certificateTemplate.count({ where: { institutionId, isArchived: false } });
    if (active >= options_1.MAX_ACTIVE_TEMPLATES) {
        throw new TemplateRequestError(400, `You can have at most ${options_1.MAX_ACTIVE_TEMPLATES} templates that are not archived. Archive one first.`);
    }
}
/** Validates the design format and that its signatories are active signatories of this institution. */
async function readDesign(tx, institutionId, value) {
    const validation = (0, design_1.validateTemplateDesign)(value);
    if (!validation.ok)
        throw new TemplateRequestError(400, validation.error);
    const signatories = await (0, snapshot_1.checkDesignSignatories)(tx, institutionId, validation.design.signatories.ids, 'save');
    if (!signatories.ok)
        throw new TemplateRequestError(400, signatories.error);
    return validation.design;
}
async function findOwnTemplate(tx, institutionId, templateId) {
    return tx.certificateTemplate.findFirst({ where: { id: templateId, institutionId }, select: { ...templateFields, nameKey: true } });
}
/** Audit entries carry ids and names only, never the design. */
function writeAudit(tx, userId, action, templateId, details) {
    return tx.auditLog.create({ data: { userId, action, entityType: 'certificate_template', entityId: templateId, details } });
}
function stripKey(template) {
    const { nameKey: _nameKey, ...rest } = template;
    return rest;
}
/** Runs a template operation for the institution in the token, mapping known failures to clear responses. */
async function withInstitution(req, res, label, operation) {
    try {
        const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
        if (!institutionId)
            return res.status(403).json({ error: 'Institution profile not found' });
        return await operation(institutionId);
    }
    catch (error) {
        if (error instanceof TemplateRequestError)
            return res.status(error.status).json({ error: error.message });
        // The database's unique (institution, name) index catches a concurrent duplicate name.
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return res.status(409).json({ error: 'You already have a template with this name' });
        }
        console.error(`Database error while ${label}:`, error instanceof Error ? error.message : error);
        return res.status(503).json({ error: 'Database unreachable or operation failed' });
    }
}
function getOptions(req, res) {
    return res.json({
        fonts: options_1.FONTS,
        placeholders: options_1.PLACEHOLDERS,
        dateFormats: options_1.DATE_FORMAT_OPTIONS,
        limits: options_1.DESIGN_LIMITS,
        starters: starters_1.STARTER_LAYOUTS.map(({ id, name, description, design }) => ({ id, name, description, design }))
    });
}
function listTemplates(req, res) {
    const includeArchived = req.query.includeArchived === 'true';
    return withInstitution(req, res, 'listing templates', async (institutionId) => {
        const templates = await db_1.default.certificateTemplate.findMany({
            where: { institutionId, ...(includeArchived ? {} : { isArchived: false }) },
            orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
            select: templateFields
        });
        return res.json({ templates });
    });
}
function getTemplate(req, res) {
    return withInstitution(req, res, 'loading a template', async (institutionId) => {
        const template = await findOwnTemplate(db_1.default, institutionId, req.params.templateId);
        if (!template)
            return res.status(404).json({ error: 'Template not found' });
        return res.json(stripKey(template));
    });
}
function createTemplate(req, res) {
    const { name, design, starterId } = req.body ?? {};
    return withInstitution(req, res, 'creating a template', async (institutionId) => {
        const { name: templateName, nameKey } = readName(name);
        if ((design === undefined) === (starterId === undefined)) {
            throw new TemplateRequestError(400, 'Send exactly one of design or starterId');
        }
        const starter = starterId === undefined ? undefined : (0, starters_1.findStarter)(starterId);
        if (starterId !== undefined && !starter) {
            throw new TemplateRequestError(400, `starterId must be one of: ${starters_1.STARTER_LAYOUTS.map((item) => item.id).join(', ')}`);
        }
        const created = await db_1.default.$transaction(async (tx) => {
            await assertBelowTemplateLimit(tx, institutionId);
            await assertNameAvailable(tx, institutionId, nameKey);
            let resolvedDesign;
            if (starter) {
                const active = await tx.signatory.findMany({
                    where: { institutionId, isActive: true },
                    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
                    select: { id: true }
                });
                resolvedDesign = await readDesign(tx, institutionId, (0, starters_1.designFromStarter)(starter, active.map((signatory) => signatory.id)));
            }
            else {
                resolvedDesign = await readDesign(tx, institutionId, design);
            }
            const template = await tx.certificateTemplate.create({
                data: { institutionId, name: templateName, nameKey, design: resolvedDesign },
                select: templateFields
            });
            await writeAudit(tx, req.user.id, 'TEMPLATE_CREATED', template.id, {
                institutionId,
                templateId: template.id,
                name: template.name,
                starterId: starter?.id ?? null
            });
            return template;
        });
        return res.status(201).json(created);
    });
}
function updateTemplate(req, res) {
    const body = req.body ?? {};
    return withInstitution(req, res, 'updating a template', async (institutionId) => {
        const fields = Object.keys(body);
        if (fields.length === 0)
            throw new TemplateRequestError(400, 'Send name, design or both');
        if (fields.some((field) => !['name', 'design'].includes(field)))
            throw new TemplateRequestError(400, 'Only name and design can be updated');
        const updated = await db_1.default.$transaction(async (tx) => {
            const existing = await findOwnTemplate(tx, institutionId, req.params.templateId);
            if (!existing)
                throw new TemplateRequestError(404, 'Template not found');
            const data = {};
            if ('name' in body) {
                const { name, nameKey } = readName(body.name);
                await assertNameAvailable(tx, institutionId, nameKey, existing.id);
                data.name = name;
                data.nameKey = nameKey;
            }
            if ('design' in body)
                data.design = await readDesign(tx, institutionId, body.design);
            const template = await tx.certificateTemplate.update({ where: { id: existing.id }, data, select: templateFields });
            await writeAudit(tx, req.user.id, 'TEMPLATE_UPDATED', template.id, {
                institutionId,
                templateId: template.id,
                name: template.name,
                ...(data.name && existing.name !== template.name ? { previousName: existing.name } : {}),
                fields
            });
            return template;
        });
        return res.json(updated);
    });
}
function cloneTemplate(req, res) {
    const { name } = req.body ?? {};
    return withInstitution(req, res, 'cloning a template', async (institutionId) => {
        const cloned = await db_1.default.$transaction(async (tx) => {
            const source = await findOwnTemplate(tx, institutionId, req.params.templateId);
            if (!source)
                throw new TemplateRequestError(404, 'Template not found');
            const { name: cloneName, nameKey } = readName(name === undefined ? `Copy of ${source.name}`.slice(0, options_1.TEMPLATE_NAME_MAX_LENGTH) : name);
            await assertBelowTemplateLimit(tx, institutionId);
            await assertNameAvailable(tx, institutionId, nameKey);
            // Re-validated, so a clone never carries signatories archived since the source was saved.
            const design = await readDesign(tx, institutionId, source.design);
            const template = await tx.certificateTemplate.create({
                data: { institutionId, name: cloneName, nameKey, design },
                select: templateFields
            });
            await writeAudit(tx, req.user.id, 'TEMPLATE_CLONED', template.id, {
                institutionId,
                templateId: template.id,
                name: template.name,
                sourceTemplateId: source.id,
                sourceName: source.name
            });
            return template;
        });
        return res.status(201).json(cloned);
    });
}
function setDefaultTemplate(req, res) {
    const { templateId } = req.body ?? {};
    return withInstitution(req, res, 'setting the default template', async (institutionId) => {
        if (templateId !== null && typeof templateId !== 'string') {
            throw new TemplateRequestError(400, 'templateId must be a template id, or null to clear the default');
        }
        const result = await db_1.default.$transaction(async (tx) => {
            const previous = await tx.certificateTemplate.findFirst({ where: { institutionId, isDefault: true }, select: { id: true, name: true } });
            let next = null;
            if (templateId !== null) {
                const template = await findOwnTemplate(tx, institutionId, templateId);
                if (!template)
                    throw new TemplateRequestError(404, 'Template not found');
                if (template.isArchived)
                    throw new TemplateRequestError(400, 'An archived template cannot be the default. Unarchive it first.');
                next = { id: template.id, name: template.name };
            }
            // Unset every other default and set the new one in the same transaction, so there is never more than one.
            await tx.certificateTemplate.updateMany({
                where: { institutionId, isDefault: true, ...(next ? { id: { not: next.id } } : {}) },
                data: { isDefault: false }
            });
            if (next)
                await tx.certificateTemplate.update({ where: { id: next.id }, data: { isDefault: true }, select: { id: true } });
            await writeAudit(tx, req.user.id, 'TEMPLATE_DEFAULT_CHANGED', next?.id ?? previous?.id ?? institutionId, {
                institutionId,
                templateId: next?.id ?? null,
                name: next?.name ?? null,
                previousTemplateId: previous?.id ?? null,
                previousName: previous?.name ?? null
            });
            return next;
        });
        return res.json({ defaultTemplateId: result?.id ?? null });
    });
}
function setArchived(req, res, archive) {
    return withInstitution(req, res, archive ? 'archiving a template' : 'unarchiving a template', async (institutionId) => {
        const template = await db_1.default.$transaction(async (tx) => {
            const existing = await findOwnTemplate(tx, institutionId, req.params.templateId);
            if (!existing)
                throw new TemplateRequestError(404, 'Template not found');
            if (archive && existing.isDefault) {
                throw new TemplateRequestError(400, 'The default template cannot be archived. Choose another default, or clear it, first.');
            }
            if (existing.isArchived === archive)
                return stripKey(existing);
            if (!archive)
                await assertBelowTemplateLimit(tx, institutionId);
            const updated = await tx.certificateTemplate.update({ where: { id: existing.id }, data: { isArchived: archive }, select: templateFields });
            await writeAudit(tx, req.user.id, archive ? 'TEMPLATE_ARCHIVED' : 'TEMPLATE_UNARCHIVED', updated.id, {
                institutionId,
                templateId: updated.id,
                name: updated.name
            });
            return updated;
        });
        return res.json(template);
    });
}
const archiveTemplate = (req, res) => setArchived(req, res, true);
exports.archiveTemplate = archiveTemplate;
const unarchiveTemplate = (req, res) => setArchived(req, res, false);
exports.unarchiveTemplate = unarchiveTemplate;
exports.default = {
    getOptions,
    listTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    cloneTemplate,
    setDefaultTemplate,
    archiveTemplate: exports.archiveTemplate,
    unarchiveTemplate: exports.unarchiveTemplate
};
