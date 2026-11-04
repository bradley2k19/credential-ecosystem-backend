import { Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { plainTextError, validateTemplateDesign, type TemplateDesign } from '../templates/design';
import { DATE_FORMAT_OPTIONS, DESIGN_LIMITS, FONTS, MAX_ACTIVE_TEMPLATES, PLACEHOLDERS, TEMPLATE_NAME_MAX_LENGTH } from '../templates/options';
import { checkDesignSignatories } from '../templates/snapshot';
import { designFromStarter, findStarter, STARTER_LAYOUTS } from '../templates/starters';

type Tx = Prisma.TransactionClient;

const templateFields = { id: true, name: true, isDefault: true, isArchived: true, design: true, updatedAt: true } as const;

class TemplateRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function getInstitutionId(userId: string) {
  const institution = await prisma.institution.findUnique({
    where: { userId },
    select: { id: true }
  });
  return institution?.id;
}

/** Trims and checks a template name; returns the name and its case-insensitive key, or throws a 400. */
function readName(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) throw new TemplateRequestError(400, 'name is required');
  const name = value.trim();
  if (name.length > TEMPLATE_NAME_MAX_LENGTH) throw new TemplateRequestError(400, `name must be at most ${TEMPLATE_NAME_MAX_LENGTH} characters`);
  const textError = plainTextError(name);
  if (textError) throw new TemplateRequestError(400, `name ${textError}`);
  return { name, nameKey: name.toLowerCase() };
}

async function assertNameAvailable(tx: Tx, institutionId: string, nameKey: string, exceptTemplateId?: string) {
  const clash = await tx.certificateTemplate.findFirst({
    where: { institutionId, nameKey, ...(exceptTemplateId ? { id: { not: exceptTemplateId } } : {}) },
    select: { id: true }
  });
  if (clash) throw new TemplateRequestError(409, 'You already have a template with this name');
}

async function assertBelowTemplateLimit(tx: Tx, institutionId: string) {
  const active = await tx.certificateTemplate.count({ where: { institutionId, isArchived: false } });
  if (active >= MAX_ACTIVE_TEMPLATES) {
    throw new TemplateRequestError(400, `You can have at most ${MAX_ACTIVE_TEMPLATES} templates that are not archived. Archive one first.`);
  }
}

/** Validates the design format and that its signatories are active signatories of this institution. */
async function readDesign(tx: Tx, institutionId: string, value: unknown): Promise<TemplateDesign> {
  const validation = validateTemplateDesign(value);
  if (!validation.ok) throw new TemplateRequestError(400, validation.error);
  const signatories = await checkDesignSignatories(tx, institutionId, validation.design.signatories.ids, 'save');
  if (!signatories.ok) throw new TemplateRequestError(400, signatories.error);
  return validation.design;
}

async function findOwnTemplate(tx: Tx, institutionId: string, templateId: string) {
  return tx.certificateTemplate.findFirst({ where: { id: templateId, institutionId }, select: { ...templateFields, nameKey: true } });
}

/** Audit entries carry ids and names only, never the design. */
function writeAudit(tx: Tx, userId: string, action: string, templateId: string, details: Prisma.InputJsonObject) {
  return tx.auditLog.create({ data: { userId, action, entityType: 'certificate_template', entityId: templateId, details } });
}

function stripKey<T extends { nameKey?: string }>(template: T) {
  const { nameKey: _nameKey, ...rest } = template;
  return rest;
}

/** Runs a template operation for the institution in the token, mapping known failures to clear responses. */
async function withInstitution(req: AuthRequest, res: Response, label: string, operation: (institutionId: string) => Promise<Response>) {
  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });
    return await operation(institutionId);
  } catch (error) {
    if (error instanceof TemplateRequestError) return res.status(error.status).json({ error: error.message });
    // The database's unique (institution, name) index catches a concurrent duplicate name.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ error: 'You already have a template with this name' });
    }
    console.error(`Database error while ${label}:`, error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

export function getOptions(req: AuthRequest, res: Response) {
  return res.json({
    fonts: FONTS,
    placeholders: PLACEHOLDERS,
    dateFormats: DATE_FORMAT_OPTIONS,
    limits: DESIGN_LIMITS,
    starters: STARTER_LAYOUTS.map(({ id, name, description, design }) => ({ id, name, description, design }))
  });
}

export function listTemplates(req: AuthRequest, res: Response) {
  const includeArchived = req.query.includeArchived === 'true';
  return withInstitution(req, res, 'listing templates', async (institutionId) => {
    const templates = await prisma.certificateTemplate.findMany({
      where: { institutionId, ...(includeArchived ? {} : { isArchived: false }) },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
      select: templateFields
    });
    return res.json({ templates });
  });
}

export function getTemplate(req: AuthRequest, res: Response) {
  return withInstitution(req, res, 'loading a template', async (institutionId) => {
    const template = await findOwnTemplate(prisma, institutionId, req.params.templateId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    return res.json(stripKey(template));
  });
}

export function createTemplate(req: AuthRequest, res: Response) {
  const { name, design, starterId } = req.body ?? {};
  return withInstitution(req, res, 'creating a template', async (institutionId) => {
    const { name: templateName, nameKey } = readName(name);
    if ((design === undefined) === (starterId === undefined)) {
      throw new TemplateRequestError(400, 'Send exactly one of design or starterId');
    }
    const starter = starterId === undefined ? undefined : findStarter(starterId);
    if (starterId !== undefined && !starter) {
      throw new TemplateRequestError(400, `starterId must be one of: ${STARTER_LAYOUTS.map((item) => item.id).join(', ')}`);
    }

    const created = await prisma.$transaction(async (tx) => {
      await assertBelowTemplateLimit(tx, institutionId);
      await assertNameAvailable(tx, institutionId, nameKey);
      let resolvedDesign: TemplateDesign;
      if (starter) {
        const active = await tx.signatory.findMany({
          where: { institutionId, isActive: true },
          orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true }
        });
        resolvedDesign = await readDesign(tx, institutionId, designFromStarter(starter, active.map((signatory) => signatory.id)));
      } else {
        resolvedDesign = await readDesign(tx, institutionId, design);
      }
      const template = await tx.certificateTemplate.create({
        data: { institutionId, name: templateName, nameKey, design: resolvedDesign },
        select: templateFields
      });
      await writeAudit(tx, req.user!.id, 'TEMPLATE_CREATED', template.id, {
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

export function updateTemplate(req: AuthRequest, res: Response) {
  const body = req.body ?? {};
  return withInstitution(req, res, 'updating a template', async (institutionId) => {
    const fields = Object.keys(body);
    if (fields.length === 0) throw new TemplateRequestError(400, 'Send name, design or both');
    if (fields.some((field) => !['name', 'design'].includes(field))) throw new TemplateRequestError(400, 'Only name and design can be updated');

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await findOwnTemplate(tx, institutionId, req.params.templateId);
      if (!existing) throw new TemplateRequestError(404, 'Template not found');
      const data: Prisma.CertificateTemplateUpdateInput = {};
      if ('name' in body) {
        const { name, nameKey } = readName(body.name);
        await assertNameAvailable(tx, institutionId, nameKey, existing.id);
        data.name = name;
        data.nameKey = nameKey;
      }
      if ('design' in body) data.design = await readDesign(tx, institutionId, body.design);

      const template = await tx.certificateTemplate.update({ where: { id: existing.id }, data, select: templateFields });
      await writeAudit(tx, req.user!.id, 'TEMPLATE_UPDATED', template.id, {
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

export function cloneTemplate(req: AuthRequest, res: Response) {
  const { name } = req.body ?? {};
  return withInstitution(req, res, 'cloning a template', async (institutionId) => {
    const cloned = await prisma.$transaction(async (tx) => {
      const source = await findOwnTemplate(tx, institutionId, req.params.templateId);
      if (!source) throw new TemplateRequestError(404, 'Template not found');
      const { name: cloneName, nameKey } = readName(name === undefined ? `Copy of ${source.name}`.slice(0, TEMPLATE_NAME_MAX_LENGTH) : name);
      await assertBelowTemplateLimit(tx, institutionId);
      await assertNameAvailable(tx, institutionId, nameKey);
      // Re-validated, so a clone never carries signatories archived since the source was saved.
      const design = await readDesign(tx, institutionId, source.design);
      const template = await tx.certificateTemplate.create({
        data: { institutionId, name: cloneName, nameKey, design },
        select: templateFields
      });
      await writeAudit(tx, req.user!.id, 'TEMPLATE_CLONED', template.id, {
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

export function setDefaultTemplate(req: AuthRequest, res: Response) {
  const { templateId } = req.body ?? {};
  return withInstitution(req, res, 'setting the default template', async (institutionId) => {
    if (templateId !== null && typeof templateId !== 'string') {
      throw new TemplateRequestError(400, 'templateId must be a template id, or null to clear the default');
    }

    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.certificateTemplate.findFirst({ where: { institutionId, isDefault: true }, select: { id: true, name: true } });
      let next: { id: string; name: string } | null = null;
      if (templateId !== null) {
        const template = await findOwnTemplate(tx, institutionId, templateId);
        if (!template) throw new TemplateRequestError(404, 'Template not found');
        if (template.isArchived) throw new TemplateRequestError(400, 'An archived template cannot be the default. Unarchive it first.');
        next = { id: template.id, name: template.name };
      }

      // Unset every other default and set the new one in the same transaction, so there is never more than one.
      await tx.certificateTemplate.updateMany({
        where: { institutionId, isDefault: true, ...(next ? { id: { not: next.id } } : {}) },
        data: { isDefault: false }
      });
      if (next) await tx.certificateTemplate.update({ where: { id: next.id }, data: { isDefault: true }, select: { id: true } });

      await writeAudit(tx, req.user!.id, 'TEMPLATE_DEFAULT_CHANGED', next?.id ?? previous?.id ?? institutionId, {
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

function setArchived(req: AuthRequest, res: Response, archive: boolean) {
  return withInstitution(req, res, archive ? 'archiving a template' : 'unarchiving a template', async (institutionId) => {
    const template = await prisma.$transaction(async (tx) => {
      const existing = await findOwnTemplate(tx, institutionId, req.params.templateId);
      if (!existing) throw new TemplateRequestError(404, 'Template not found');
      if (archive && existing.isDefault) {
        throw new TemplateRequestError(400, 'The default template cannot be archived. Choose another default, or clear it, first.');
      }
      if (existing.isArchived === archive) return stripKey(existing);
      if (!archive) await assertBelowTemplateLimit(tx, institutionId);

      const updated = await tx.certificateTemplate.update({ where: { id: existing.id }, data: { isArchived: archive }, select: templateFields });
      await writeAudit(tx, req.user!.id, archive ? 'TEMPLATE_ARCHIVED' : 'TEMPLATE_UNARCHIVED', updated.id, {
        institutionId,
        templateId: updated.id,
        name: updated.name
      });
      return updated;
    });
    return res.json(template);
  });
}

export const archiveTemplate = (req: AuthRequest, res: Response) => setArchived(req, res, true);
export const unarchiveTemplate = (req: AuthRequest, res: Response) => setArchived(req, res, false);

export default {
  getOptions,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  cloneTemplate,
  setDefaultTemplate,
  archiveTemplate,
  unarchiveTemplate
};
