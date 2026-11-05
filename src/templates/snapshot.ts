import { Prisma } from '@prisma/client';
import { validateTemplateDesign, type TemplateDesign } from './design';
import { designFromStarter, FALLBACK_STARTER_ID, FALLBACK_TEMPLATE_NAME, findStarter } from './starters';

type Db = Prisma.TransactionClient;

export interface RenderSnapshot {
  snapshotVersion: 1;
  template: { id: string | null; name: string };
  design: TemplateDesign;
  institution: { name: string; brandColor: string | null; logoAssetId: string | null; sealAssetId: string | null };
  signatories: { name: string; title: string; signatureAssetId: string | null }[];
}

/** The frozen template name from a stored snapshot, or null for certificates issued before templates existed. */
export function snapshotTemplateName(snapshot: Prisma.JsonValue | null) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const template = (snapshot as Prisma.JsonObject).template;
  if (!template || typeof template !== 'object' || Array.isArray(template)) return null;
  const name = (template as Prisma.JsonObject).name;
  return typeof name === 'string' ? name : null;
}

/**
 * For certificates issued before templates existed (stored snapshot is null): the built-in Classic design
 * without logo, seal, watermark or signatories, since none of those were chosen at the time. Computed per
 * request and never stored, so the stored snapshot stays null.
 */
export function fallbackRenderSnapshot(institutionName: string): RenderSnapshot {
  const design = structuredClone(findStarter(FALLBACK_STARTER_ID)!.design);
  design.header.showLogo = false;
  design.header.showSeal = false;
  design.background.watermark = 'none';
  design.signatories.ids = [];
  return {
    snapshotVersion: 1,
    template: { id: null, name: FALLBACK_TEMPLATE_NAME },
    design,
    institution: { name: institutionName, brandColor: null, logoAssetId: null, sealAssetId: null },
    signatories: []
  };
}

/** The stored snapshot, or the computed fallback for older certificates, with a flag saying which. */
export function renderSnapshotForResponse(stored: Prisma.JsonValue | null, institutionName: string) {
  return stored === null
    ? { renderSnapshot: fallbackRenderSnapshot(institutionName) as unknown as Prisma.JsonValue, snapshotIsFallback: true }
    : { renderSnapshot: stored, snapshotIsFallback: false };
}

export type SignatoryCheckResult = { ok: true } | { ok: false; error: string };

/**
 * Checks that every signatory id belongs to the institution and is active. `context` picks the wording:
 * on save the template is being edited; at issuance it was saved earlier and a signatory has since changed.
 */
export async function checkDesignSignatories(db: Db, institutionId: string, ids: string[], context: 'save' | 'issue'): Promise<SignatoryCheckResult> {
  if (ids.length === 0) return { ok: true };
  const found = await db.signatory.findMany({
    where: { id: { in: ids }, institutionId },
    select: { id: true, name: true, isActive: true }
  });
  for (const id of ids) {
    const signatory = found.find((item) => item.id === id);
    if (!signatory) {
      return {
        ok: false,
        error: context === 'save'
          ? `Signatory ${id} is not one of your institution's signatories`
          : `The template lists a signatory (${id}) that is not one of your institution's signatories. Update the template before issuing.`
      };
    }
    if (!signatory.isActive) {
      return {
        ok: false,
        error: context === 'save'
          ? `Signatory "${signatory.name}" is archived. Choose active signatories only.`
          : `Signatory "${signatory.name}" has been archived since this template was saved. Update the template's signatories before issuing.`
      };
    }
  }
  return { ok: true };
}

export type SnapshotResult =
  | { ok: true; snapshot: RenderSnapshot; templateId: string | null }
  | { ok: false; error: string };

/**
 * Resolves the template for a new certificate and freezes everything the renderer needs into a snapshot:
 * the given template (own and not archived), else the institution's default, else the built-in Classic.
 * The snapshot holds no student data and no image bytes, only asset ids.
 */
export async function buildRenderSnapshot(db: Db, institutionId: string, requestedTemplateId: unknown): Promise<SnapshotResult> {
  let template: { id: string; name: string; design: Prisma.JsonValue } | null = null;
  if (requestedTemplateId !== undefined && requestedTemplateId !== null) {
    if (typeof requestedTemplateId !== 'string') return { ok: false, error: 'templateId must be a string' };
    template = await db.certificateTemplate.findFirst({
      where: { id: requestedTemplateId, institutionId, isArchived: false },
      select: { id: true, name: true, design: true }
    });
    if (!template) return { ok: false, error: 'templateId must be one of your institution\'s templates that is not archived' };
  } else {
    template = await db.certificateTemplate.findFirst({
      where: { institutionId, isDefault: true, isArchived: false },
      select: { id: true, name: true, design: true }
    });
  }

  let design: TemplateDesign;
  if (template) {
    const validation = validateTemplateDesign(template.design);
    if (!validation.ok) return { ok: false, error: `The template "${template.name}" is no longer valid. ${validation.error}` };
    design = validation.design;
  } else {
    const active = await db.signatory.findMany({
      where: { institutionId, isActive: true },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true }
    });
    design = designFromStarter(findStarter(FALLBACK_STARTER_ID)!, active.map((signatory) => signatory.id));
  }

  const signatoryCheck = await checkDesignSignatories(db, institutionId, design.signatories.ids, 'issue');
  if (!signatoryCheck.ok) return signatoryCheck;

  const [institution, signatories] = await Promise.all([
    db.institution.findUnique({
      where: { id: institutionId },
      select: { name: true, brandColor: true, logoAssetId: true, sealAssetId: true }
    }),
    db.signatory.findMany({
      where: { id: { in: design.signatories.ids }, institutionId, isActive: true },
      select: { id: true, name: true, title: true, signatureAssetId: true }
    })
  ]);
  if (!institution) return { ok: false, error: 'Institution profile not found' };

  return {
    ok: true,
    templateId: template?.id ?? null,
    snapshot: {
      snapshotVersion: 1,
      template: { id: template?.id ?? null, name: template?.name ?? FALLBACK_TEMPLATE_NAME },
      design,
      institution: {
        name: institution.name,
        brandColor: institution.brandColor,
        logoAssetId: institution.logoAssetId,
        sealAssetId: institution.sealAssetId
      },
      // In the order the design lists them.
      signatories: design.signatories.ids.map((id) => {
        const signatory = signatories.find((item) => item.id === id)!;
        return { name: signatory.name, title: signatory.title, signatureAssetId: signatory.signatureAssetId };
      })
    }
  };
}
