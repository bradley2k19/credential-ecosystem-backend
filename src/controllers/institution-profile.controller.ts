import { Response } from 'express';
import { getAddress } from 'ethers';
import { AssetKind, Prisma } from '@prisma/client';
import prisma from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { assetUrl, validateImageUpload, type ValidatedImage } from '../utils/image';

const MAX_ASSETS_PER_INSTITUTION = 50;
const MAX_ACTIVE_SIGNATORIES = 10;
const MAX_ADDRESS_LENGTH = 300;
const MAX_SIGNATORY_FIELD_LENGTH = 100;

const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const brandColorRegex = /^#[0-9A-Fa-f]{6}$/;
const AUTHORISATION_REQUIRED = 'You must confirm you are authorised to use this signature';

type Tx = Prisma.TransactionClient;

class AssetLimitError extends Error {}

async function getInstitutionId(userId: string) {
  const institution = await prisma.institution.findUnique({
    where: { userId },
    select: { id: true }
  });
  return institution?.id;
}

/** Creates a new immutable asset. Assets are only ever created: never updated or deleted. */
async function createAsset(tx: Tx, institutionId: string, kind: AssetKind, image: ValidatedImage) {
  const count = await tx.institutionAsset.count({ where: { institutionId } });
  if (count >= MAX_ASSETS_PER_INSTITUTION) throw new AssetLimitError();
  return tx.institutionAsset.create({
    data: {
      institutionId,
      kind,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      data: image.data
    },
    // Never read the image bytes back outside the public asset endpoint.
    select: { id: true }
  });
}

/** Audit entries carry ids and field names only, never image data. */
function writeAudit(tx: Tx, userId: string, action: string, entityType: string, entityId: string, details: Prisma.InputJsonObject) {
  return tx.auditLog.create({ data: { userId, action, entityType, entityId, details } });
}

function assetLimitResponse(res: Response) {
  return res.status(400).json({
    error: `Your institution has reached the limit of ${MAX_ASSETS_PER_INSTITUTION} uploaded images. Contact the platform administrator.`
  });
}

async function loadProfile(institutionId: string) {
  const [institution, signatoryCount] = await Promise.all([
    prisma.institution.findUnique({
      where: { id: institutionId },
      select: {
        name: true,
        registrationNumber: true,
        address: true,
        contactEmail: true,
        brandColor: true,
        walletAddress: true,
        isVerified: true,
        logoAssetId: true,
        sealAssetId: true
      }
    }),
    prisma.signatory.count({ where: { institutionId, isActive: true } })
  ]);
  if (!institution) return null;

  let walletAddress: string | null = null;
  try {
    walletAddress = institution.walletAddress ? getAddress(institution.walletAddress) : null;
  } catch {
    walletAddress = null;
  }

  return {
    name: institution.name,
    registrationNumber: institution.registrationNumber,
    address: institution.address,
    contactEmail: institution.contactEmail,
    brandColor: institution.brandColor,
    walletAddress,
    isVerified: institution.isVerified,
    logoUrl: assetUrl(institution.logoAssetId),
    sealUrl: assetUrl(institution.sealAssetId),
    signatoryCount
  };
}

export async function getProfile(req: AuthRequest, res: Response) {
  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });
    const profile = await loadProfile(institutionId);
    if (!profile) return res.status(404).json({ error: 'Institution profile not found' });
    return res.json(profile);
  } catch (error) {
    console.error('Database error while loading institution profile:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export async function updateProfile(req: AuthRequest, res: Response) {
  const body = req.body ?? {};
  if ('name' in body || 'registrationNumber' in body) {
    return res.status(400).json({ error: 'Name and registration number cannot be changed here' });
  }
  const allowedFields = ['address', 'contactEmail', 'brandColor'];
  const fields = Object.keys(body);
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  if (fields.some((field) => !allowedFields.includes(field))) {
    return res.status(400).json({ error: 'Only address, contactEmail and brandColor can be updated' });
  }

  const data: Prisma.InstitutionUpdateInput = {};
  if ('address' in body) {
    if (body.address !== null && typeof body.address !== 'string') return res.status(400).json({ error: 'address must be text' });
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    if (address.length > MAX_ADDRESS_LENGTH) return res.status(400).json({ error: `address must be at most ${MAX_ADDRESS_LENGTH} characters` });
    data.address = address || null;
  }
  if ('contactEmail' in body) {
    if (body.contactEmail !== null && typeof body.contactEmail !== 'string') return res.status(400).json({ error: 'contactEmail must be a valid email address' });
    const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : '';
    if (contactEmail && !emailRegex.test(contactEmail)) return res.status(400).json({ error: 'contactEmail must be a valid email address' });
    data.contactEmail = contactEmail || null;
  }
  if ('brandColor' in body) {
    if (body.brandColor !== null && (typeof body.brandColor !== 'string' || !brandColorRegex.test(body.brandColor))) {
      return res.status(400).json({ error: 'brandColor must be a colour in the form #RRGGBB, or null to clear it' });
    }
    data.brandColor = body.brandColor === null ? null : body.brandColor.toUpperCase();
  }

  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

    await prisma.$transaction(async (tx) => {
      await tx.institution.update({ where: { id: institutionId }, data, select: { id: true } });
      await writeAudit(tx, req.user!.id, 'INSTITUTION_PROFILE_UPDATED', 'institution', institutionId, {
        institutionId,
        fields
      });
    });
    return res.json(await loadProfile(institutionId));
  } catch (error) {
    console.error('Database error while updating institution profile:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

/** Sets the logo or seal: a new asset is created and the institution re-pointed at it. The old asset is kept. */
async function setBrandAsset(req: AuthRequest, res: Response, kind: 'LOGO' | 'SEAL') {
  const validation = validateImageUpload(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

    await prisma.$transaction(async (tx) => {
      const current = await tx.institution.findUnique({ where: { id: institutionId }, select: { logoAssetId: true, sealAssetId: true } });
      const asset = await createAsset(tx, institutionId, kind, validation.image);
      await tx.institution.update({
        where: { id: institutionId },
        data: kind === 'LOGO' ? { logoAssetId: asset.id } : { sealAssetId: asset.id },
        select: { id: true }
      });
      await writeAudit(tx, req.user!.id, kind === 'LOGO' ? 'INSTITUTION_LOGO_SET' : 'INSTITUTION_SEAL_SET', 'institution', institutionId, {
        institutionId,
        assetId: asset.id,
        previousAssetId: (kind === 'LOGO' ? current?.logoAssetId : current?.sealAssetId) ?? null,
        mimeType: validation.image.mimeType,
        sizeBytes: validation.image.sizeBytes,
        width: validation.image.width,
        height: validation.image.height
      });
    });
    return res.json(await loadProfile(institutionId));
  } catch (error) {
    if (error instanceof AssetLimitError) return assetLimitResponse(res);
    console.error(`Database error while setting institution ${kind.toLowerCase()}:`, error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

/** Removing the logo or seal only unlinks it; the asset itself stays available. */
async function removeBrandAsset(req: AuthRequest, res: Response, kind: 'LOGO' | 'SEAL') {
  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

    await prisma.$transaction(async (tx) => {
      const current = await tx.institution.findUnique({ where: { id: institutionId }, select: { logoAssetId: true, sealAssetId: true } });
      const previousAssetId = (kind === 'LOGO' ? current?.logoAssetId : current?.sealAssetId) ?? null;
      if (!previousAssetId) return;
      await tx.institution.update({
        where: { id: institutionId },
        data: kind === 'LOGO' ? { logoAssetId: null } : { sealAssetId: null },
        select: { id: true }
      });
      await writeAudit(tx, req.user!.id, kind === 'LOGO' ? 'INSTITUTION_LOGO_REMOVED' : 'INSTITUTION_SEAL_REMOVED', 'institution', institutionId, {
        institutionId,
        previousAssetId
      });
    });
    return res.json(await loadProfile(institutionId));
  } catch (error) {
    console.error(`Database error while removing institution ${kind.toLowerCase()}:`, error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

export const setLogo = (req: AuthRequest, res: Response) => setBrandAsset(req, res, 'LOGO');
export const removeLogo = (req: AuthRequest, res: Response) => removeBrandAsset(req, res, 'LOGO');
export const setSeal = (req: AuthRequest, res: Response) => setBrandAsset(req, res, 'SEAL');
export const removeSeal = (req: AuthRequest, res: Response) => removeBrandAsset(req, res, 'SEAL');

const signatoryFields = { id: true, name: true, title: true, signatureAssetId: true, displayOrder: true } as const;

function toSignatory(row: Prisma.SignatoryGetPayload<{ select: typeof signatoryFields }>) {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    signatureUrl: assetUrl(row.signatureAssetId),
    displayOrder: row.displayOrder
  };
}

function listActiveSignatories(institutionId: string) {
  return prisma.signatory.findMany({
    where: { institutionId, isActive: true },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    select: signatoryFields
  });
}

/** An active signatory of this institution. Another institution's id is indistinguishable from an unknown one. */
function findOwnSignatory(institutionId: string, signatoryId: string) {
  return prisma.signatory.findFirst({
    where: { id: signatoryId, institutionId, isActive: true },
    select: { id: true, signatureAssetId: true }
  });
}

function readSignatoryText(value: unknown, field: 'name' | 'title'): { value?: string; error?: string } {
  if (typeof value !== 'string' || !value.trim()) return { error: `${field} is required` };
  const trimmed = value.trim();
  if (trimmed.length > MAX_SIGNATORY_FIELD_LENGTH) return { error: `${field} must be at most ${MAX_SIGNATORY_FIELD_LENGTH} characters` };
  return { value: trimmed };
}

export async function listSignatories(req: AuthRequest, res: Response) {
  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });
    const signatories = await listActiveSignatories(institutionId);
    return res.json({ signatories: signatories.map(toSignatory) });
  } catch (error) {
    console.error('Database error while listing signatories:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable' });
  }
}

export async function createSignatory(req: AuthRequest, res: Response) {
  const { name, title, signature, confirmAuthorised } = req.body ?? {};
  const nameResult = readSignatoryText(name, 'name');
  if (nameResult.error) return res.status(400).json({ error: nameResult.error });
  const titleResult = readSignatoryText(title, 'title');
  if (titleResult.error) return res.status(400).json({ error: titleResult.error });

  let image: ValidatedImage | undefined;
  if (signature !== undefined && signature !== null) {
    if (confirmAuthorised !== true) return res.status(400).json({ error: AUTHORISATION_REQUIRED });
    const validation = validateImageUpload(signature);
    if (!validation.ok) return res.status(400).json({ error: validation.error });
    image = validation.image;
  }

  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

    const created = await prisma.$transaction(async (tx) => {
      const active = await tx.signatory.aggregate({
        where: { institutionId, isActive: true },
        _count: { _all: true },
        _max: { displayOrder: true }
      });
      if (active._count._all >= MAX_ACTIVE_SIGNATORIES) return null;

      const asset = image ? await createAsset(tx, institutionId, 'SIGNATURE', image) : null;
      const signatory = await tx.signatory.create({
        data: {
          institutionId,
          name: nameResult.value!,
          title: titleResult.value!,
          signatureAssetId: asset?.id ?? null,
          displayOrder: (active._max.displayOrder ?? -1) + 1,
          authorisationConfirmedAt: asset ? new Date() : null
        },
        select: signatoryFields
      });
      await writeAudit(tx, req.user!.id, 'SIGNATORY_CREATED', 'signatory', signatory.id, {
        institutionId,
        signatoryId: signatory.id,
        signatureAssetId: asset?.id ?? null
      });
      return signatory;
    });

    if (!created) {
      return res.status(400).json({ error: `An institution can have at most ${MAX_ACTIVE_SIGNATORIES} active signatories. Archive one first.` });
    }
    return res.status(201).json(toSignatory(created));
  } catch (error) {
    if (error instanceof AssetLimitError) return assetLimitResponse(res);
    console.error('Database error while creating signatory:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

export async function updateSignatory(req: AuthRequest, res: Response) {
  const body = req.body ?? {};
  const fields = Object.keys(body);
  if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
  if (fields.some((field) => !['name', 'title', 'displayOrder'].includes(field))) {
    return res.status(400).json({ error: 'Only name, title and displayOrder can be updated here' });
  }

  const data: Prisma.SignatoryUpdateInput = {};
  if ('name' in body) {
    const result = readSignatoryText(body.name, 'name');
    if (result.error) return res.status(400).json({ error: result.error });
    data.name = result.value;
  }
  if ('title' in body) {
    const result = readSignatoryText(body.title, 'title');
    if (result.error) return res.status(400).json({ error: result.error });
    data.title = result.value;
  }
  if ('displayOrder' in body) {
    if (!Number.isInteger(body.displayOrder) || body.displayOrder < 0 || body.displayOrder > 1000) {
      return res.status(400).json({ error: 'displayOrder must be a whole number from 0 to 1000' });
    }
    data.displayOrder = body.displayOrder;
  }

  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });
    const existing = await findOwnSignatory(institutionId, req.params.signatoryId);
    if (!existing) return res.status(404).json({ error: 'Signatory not found' });

    const updated = await prisma.$transaction(async (tx) => {
      const signatory = await tx.signatory.update({ where: { id: existing.id }, data, select: signatoryFields });
      await writeAudit(tx, req.user!.id, 'SIGNATORY_UPDATED', 'signatory', existing.id, {
        institutionId,
        signatoryId: existing.id,
        fields
      });
      return signatory;
    });
    return res.json(toSignatory(updated));
  } catch (error) {
    console.error('Database error while updating signatory:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

export async function reorderSignatories(req: AuthRequest, res: Response) {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.some((value) => typeof value !== 'string')) {
    return res.status(400).json({ error: 'ids must be a list of signatory ids' });
  }

  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });

    const active = await prisma.signatory.findMany({ where: { institutionId, isActive: true }, select: { id: true } });
    const activeIds = new Set(active.map((signatory) => signatory.id));
    const isCompletePermutation = ids.length === activeIds.size
      && new Set(ids).size === ids.length
      && ids.every((value: string) => activeIds.has(value));
    if (!isCompletePermutation) {
      return res.status(400).json({ error: 'ids must list every active signatory of your institution exactly once' });
    }

    await prisma.$transaction(async (tx) => {
      for (const [index, signatoryId] of (ids as string[]).entries()) {
        await tx.signatory.update({ where: { id: signatoryId }, data: { displayOrder: index }, select: { id: true } });
      }
      await writeAudit(tx, req.user!.id, 'SIGNATORIES_REORDERED', 'institution', institutionId, { institutionId, order: ids });
    });

    const signatories = await listActiveSignatories(institutionId);
    return res.json({ signatories: signatories.map(toSignatory) });
  } catch (error) {
    console.error('Database error while reordering signatories:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

export async function setSignature(req: AuthRequest, res: Response) {
  const body = req.body ?? {};
  // Accept { data, mimeType, confirmAuthorised } or the same nesting as create: { signature: {...}, confirmAuthorised }.
  const upload = body.signature && typeof body.signature === 'object' ? body.signature : body;
  if (body.confirmAuthorised !== true) return res.status(400).json({ error: AUTHORISATION_REQUIRED });
  const validation = validateImageUpload(upload);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });
    const existing = await findOwnSignatory(institutionId, req.params.signatoryId);
    if (!existing) return res.status(404).json({ error: 'Signatory not found' });

    const updated = await prisma.$transaction(async (tx) => {
      const asset = await createAsset(tx, institutionId, 'SIGNATURE', validation.image);
      const signatory = await tx.signatory.update({
        where: { id: existing.id },
        data: { signatureAssetId: asset.id, authorisationConfirmedAt: new Date() },
        select: signatoryFields
      });
      await writeAudit(tx, req.user!.id, 'SIGNATORY_SIGNATURE_SET', 'signatory', existing.id, {
        institutionId,
        signatoryId: existing.id,
        assetId: asset.id,
        previousAssetId: existing.signatureAssetId
      });
      return signatory;
    });
    return res.json(toSignatory(updated));
  } catch (error) {
    if (error instanceof AssetLimitError) return assetLimitResponse(res);
    console.error('Database error while setting signature:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

/** Unlinks the signature image; the asset itself is kept. */
export async function removeSignature(req: AuthRequest, res: Response) {
  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });
    const existing = await findOwnSignatory(institutionId, req.params.signatoryId);
    if (!existing) return res.status(404).json({ error: 'Signatory not found' });

    const updated = await prisma.$transaction(async (tx) => {
      const signatory = await tx.signatory.update({
        where: { id: existing.id },
        data: { signatureAssetId: null, authorisationConfirmedAt: null },
        select: signatoryFields
      });
      if (existing.signatureAssetId) {
        await writeAudit(tx, req.user!.id, 'SIGNATORY_SIGNATURE_REMOVED', 'signatory', existing.id, {
          institutionId,
          signatoryId: existing.id,
          previousAssetId: existing.signatureAssetId
        });
      }
      return signatory;
    });
    return res.json(toSignatory(updated));
  } catch (error) {
    console.error('Database error while removing signature:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

/** Archives the signatory (isActive false). The row is never deleted. */
export async function archiveSignatory(req: AuthRequest, res: Response) {
  try {
    const institutionId = req.user ? await getInstitutionId(req.user.id) : undefined;
    if (!institutionId) return res.status(403).json({ error: 'Institution profile not found' });
    const existing = await findOwnSignatory(institutionId, req.params.signatoryId);
    if (!existing) return res.status(404).json({ error: 'Signatory not found' });

    await prisma.$transaction(async (tx) => {
      await tx.signatory.update({ where: { id: existing.id }, data: { isActive: false }, select: { id: true } });
      await writeAudit(tx, req.user!.id, 'SIGNATORY_ARCHIVED', 'signatory', existing.id, { institutionId, signatoryId: existing.id });
    });
    return res.json({ message: 'Signatory archived' });
  } catch (error) {
    console.error('Database error while archiving signatory:', error instanceof Error ? error.message : error);
    return res.status(503).json({ error: 'Database unreachable or operation failed' });
  }
}

export default {
  getProfile,
  updateProfile,
  setLogo,
  removeLogo,
  setSeal,
  removeSeal,
  listSignatories,
  createSignatory,
  updateSignatory,
  reorderSignatories,
  setSignature,
  removeSignature,
  archiveSignatory
};
