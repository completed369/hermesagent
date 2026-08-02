import { randomBytes } from 'node:crypto';
import { enforceWorkspaceCapability, prisma } from '@ventureos/database';
import { LicenseKeyInvalidError, LicenseKeyNotFoundError } from './errors.js';

function generateLicenseKeyValue(): string {
  const segment = () => randomBytes(4).toString('hex').toUpperCase();
  return `VOS-${segment()}-${segment()}-${segment()}`;
}

/**
 * Issues a new license key for a self-hosted/exportable install (master
 * spec section 3's long-term "resell the platform itself" objective). The
 * key value itself is stored (not hashed) because it is validated by
 * `validateLicenseKey` below via a direct DB lookup within the same trust
 * boundary as everything else in this application -- unlike a password, it
 * is not a secret an attacker could use to escalate privilege on its own
 * (it only proves "this install is licensed", the same class of fact as a
 * plan tier), so the extra complexity of hashing is not warranted here.
 */
export async function issueLicenseKey(workspaceId: string, expiresInDays?: number) {
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  await enforceWorkspaceCapability({
    workspaceId,
    capability: 'LICENSE_EXPORT',
    stage: 'DISPATCH',
    providerMode: 'internal',
    recordAllow: true,
    correlationReference: 'license:issue',
  });

  return prisma.licenseKey.create({
    data: {
      workspaceId,
      key: generateLicenseKeyValue(),
      status: 'ACTIVE',
      expiresAt,
    },
  });
}

/** Validates a license key: must exist, be ACTIVE, and not be past its
 * expiry. Fails closed -- an expired key is auto-flipped to EXPIRED and
 * rejected, never silently treated as still valid. */
export async function validateLicenseKey(key: string) {
  const licenseKey = await prisma.licenseKey.findUnique({ where: { key } });
  if (!licenseKey) {
    throw new LicenseKeyNotFoundError(`No license key matches '${key}'.`);
  }

  if (licenseKey.status === 'REVOKED') {
    throw new LicenseKeyInvalidError(`License key '${key}' has been revoked.`);
  }

  if (licenseKey.expiresAt && licenseKey.expiresAt < new Date()) {
    if (licenseKey.status !== 'EXPIRED') {
      await enforceWorkspaceCapability({
        workspaceId: licenseKey.workspaceId,
        capability: 'LICENSE_EXPORT',
        stage: 'DISPATCH',
        providerMode: 'internal',
        recordAllow: true,
        correlationReference: `license:expire:${licenseKey.id}`,
      });
      await prisma.licenseKey.update({ where: { key }, data: { status: 'EXPIRED' } });
    }
    throw new LicenseKeyInvalidError(
      `License key '${key}' expired on ${licenseKey.expiresAt.toISOString()}.`,
    );
  }

  return licenseKey;
}

/** Revokes a license key immediately, regardless of its expiry. */
export async function revokeLicenseKey(workspaceId: string, id: string) {
  const licenseKey = await prisma.licenseKey.findFirst({
    where: { id, workspaceId },
    select: { workspaceId: true, status: true },
  });
  if (!licenseKey) throw new LicenseKeyNotFoundError('License key not found.');
  if (licenseKey.status === 'REVOKED') {
    throw new LicenseKeyInvalidError('License key is already revoked.');
  }
  await enforceWorkspaceCapability({
    workspaceId: licenseKey.workspaceId,
    capability: 'LICENSE_EXPORT',
    stage: 'DISPATCH',
    providerMode: 'internal',
    recordAllow: true,
    correlationReference: `license:revoke:${id}`,
  });
  const updated = await prisma.licenseKey.updateMany({
    where: { id, workspaceId, status: { not: 'REVOKED' } },
    data: { status: 'REVOKED', revokedAt: new Date() },
  });
  if (updated.count !== 1) throw new LicenseKeyInvalidError('License key is already revoked.');
  return prisma.licenseKey.findFirstOrThrow({ where: { id, workspaceId } });
}
