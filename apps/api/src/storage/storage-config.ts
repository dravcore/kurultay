import { isAbsolute } from 'node:path';
import { envInt, envString } from '../common/env';

/** 25 MiB. One number, quoted in `docker/Caddyfile` and `docs/self-hosting.md` (ADR 0024). */
export const DEFAULT_ATTACHMENT_MAX_BYTES = 26_214_400;

/**
 * 2 GiB: the per-workspace ceiling an instance gets when `ATTACHMENT_WORKSPACE_QUOTA_BYTES` is
 * unset (ADR 0027, updated 2026-08-21).
 *
 * ADR 0027 originally shipped "unset = unlimited". That was reversed once the 2026-08-18 audit's
 * SEC-02 was weighed against the published Compose topology, where `STORAGE_PATH` shares its
 * disk with Postgres: an operator who never reads the quota section is exactly the operator
 * whose database a full disk takes down. `0` is still the explicit opt-out.
 */
export const DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES = 2_147_483_648;

/** 20 GiB: the instance-wide ceiling when `ATTACHMENT_INSTANCE_QUOTA_BYTES` is unset. */
export const DEFAULT_ATTACHMENT_INSTANCE_QUOTA_BYTES = 21_474_836_480;

/**
 * 256 MiB per minute per client IP, about ten max-size uploads: the byte budget the upload
 * route charges before multer reads a request (`UploadBudgetGuard`). The request throttle
 * counts requests, which `rate-limit.ts` has always called the wrong unit for disk; this is
 * the unit that was missing.
 */
export const DEFAULT_ATTACHMENT_UPLOAD_BYTES_PER_MINUTE = 268_435_456;

/** Whether a number was read from the environment or is the built-in default. */
export type ConfigSource = 'env' | 'default';

export interface DiskStorageConfig {
  /** Absolute path of the directory attachments are written under. */
  root: string;
}

export interface StorageConfig {
  /** `undefined` when `STORAGE_PATH` is unset — attachments are off, as a type-level state. */
  disk: DiskStorageConfig | undefined;
  /** The API half of the two-layer size limit; the proxy half carries the same number. */
  maxBytes: number;
  /** Ceiling on the summed size of a workspace's FILE attachments. `0` means unlimited. */
  workspaceQuotaBytes: number;
  /** Ceiling on the summed size of every FILE attachment on the instance. `0` means unlimited. */
  instanceQuotaBytes: number;
  /** Bytes one client IP may submit to the upload route per minute. `0` means no budget. */
  uploadBytesPerMinute: number;
  /** Where each ceiling came from, so the boot log can say which numbers nobody chose. */
  sources: {
    workspaceQuota: ConfigSource;
    instanceQuota: ConfigSource;
    uploadBudget: ConfigSource;
  };
}

/**
 * Reads the storage configuration from the environment.
 *
 * `STORAGE_PATH` is the single switch, exactly as `SMTP_HOST` is for mail: set it and
 * attachments work, leave it unset and the app still boots with the feature off. There is no
 * `ATTACHMENTS_ENABLED` — this codebase reserves `_ENABLED` for default-on kill switches
 * (`CLEANUP_ENABLED`, `RATE_LIMIT_ENABLED`) and for consent (`TELEMETRY_ENABLED`), and a
 * default-off feature that needs a path in order to work is enabled by that path being set
 * (ADR 0022).
 */
export function readStorageConfig(): StorageConfig {
  const root = envString('STORAGE_PATH', '');
  // Refused here as well as in `DiskStorageBackend`'s constructor, and the duplication is the
  // point: the constructor protects the port from any caller, this protects the operator from a
  // message that never names the variable they set. A relative path would resolve against the
  // API process's working directory, which differs between `pnpm dev`, the container and any
  // script that starts the process from somewhere else.
  if (root !== '' && !isAbsolute(root)) {
    throw new Error(`Invalid STORAGE_PATH: expected an absolute path, received "${root}"`);
  }
  const maxBytes = envInt('ATTACHMENT_MAX_BYTES', DEFAULT_ATTACHMENT_MAX_BYTES);
  if (maxBytes <= 0) {
    throw new Error(
      `Invalid ATTACHMENT_MAX_BYTES: expected a positive byte count, received "${maxBytes}"`,
    );
  }

  const workspaceQuota = byteCeiling(
    'ATTACHMENT_WORKSPACE_QUOTA_BYTES',
    DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES,
  );
  const instanceQuota = byteCeiling(
    'ATTACHMENT_INSTANCE_QUOTA_BYTES',
    DEFAULT_ATTACHMENT_INSTANCE_QUOTA_BYTES,
  );
  const uploadBudget = byteCeiling(
    'ATTACHMENT_UPLOAD_BYTES_PER_MINUTE',
    DEFAULT_ATTACHMENT_UPLOAD_BYTES_PER_MINUTE,
  );

  return {
    disk: root === '' ? undefined : { root },
    maxBytes,
    workspaceQuotaBytes: workspaceQuota.bytes,
    instanceQuotaBytes: instanceQuota.bytes,
    uploadBytesPerMinute: uploadBudget.bytes,
    sources: {
      workspaceQuota: workspaceQuota.source,
      instanceQuota: instanceQuota.source,
      uploadBudget: uploadBudget.source,
    },
  };
}

/**
 * Reads a byte ceiling (a storage quota of ADR 0027, or the upload budget).
 *
 * Unset falls back to `fallback`: since 2026-08-21 that is a finite number, so an instance
 * nobody configured still has a ceiling. `0` is the explicit opt-out meaning "unlimited", the
 * same spelling the retention windows give it (`retentionDays`). A negative value is refused
 * rather than clamped, for `retentionDays`'s reason: it would otherwise read as a ceiling that
 * is always exceeded, which is a configuration error better raised at boot than answered with
 * a 413 (or a 429) on every upload.
 */
function byteCeiling(name: string, fallback: number): { bytes: number; source: ConfigSource } {
  const raw = envString(name, '');
  if (raw === '') {
    return { bytes: fallback, source: 'default' };
  }
  const bytes = envInt(name, fallback);
  if (bytes < 0) {
    throw new Error(`Invalid ${name}: expected a non-negative byte count, received "${bytes}"`);
  }
  return { bytes, source: 'env' };
}

/**
 * The combinations `readStorageConfig` accepts but an operator probably did not mean. Each is
 * a sentence for the boot log, not a refusal: a workspace quota above the instance quota is
 * merely redundant (the instance ceiling wins first), and an upload budget smaller than one
 * max-size file is a budget no single upload of that size can ever fit into.
 */
export function storageConfigWarnings(config: StorageConfig): string[] {
  const warnings: string[] = [];
  if (
    config.workspaceQuotaBytes > 0 &&
    config.instanceQuotaBytes > 0 &&
    config.workspaceQuotaBytes > config.instanceQuotaBytes
  ) {
    warnings.push(
      `ATTACHMENT_WORKSPACE_QUOTA_BYTES (${config.workspaceQuotaBytes}) is larger than ` +
        `ATTACHMENT_INSTANCE_QUOTA_BYTES (${config.instanceQuotaBytes}); the instance quota ` +
        'fills first, so no workspace can reach its own',
    );
  }
  if (config.uploadBytesPerMinute > 0 && config.uploadBytesPerMinute < config.maxBytes) {
    warnings.push(
      `ATTACHMENT_UPLOAD_BYTES_PER_MINUTE (${config.uploadBytesPerMinute}) is smaller than ` +
        `ATTACHMENT_MAX_BYTES (${config.maxBytes}); a file near the size limit can never fit ` +
        'in the per-minute budget and is answered 429 on every attempt',
    );
  }
  return warnings;
}

/**
 * The one line the boot log carries about the quotas: each effective number and whether it
 * came from the environment or is the default nobody chose. `0` is spelled out as unlimited so
 * the line reads the way the variables are documented.
 */
export function describeStorageCeilings(config: StorageConfig): string {
  const show = (bytes: number, source: ConfigSource): string =>
    `${bytes === 0 ? 'unlimited' : String(bytes)} (${source})`;
  return (
    'Attachment ceilings: ' +
    `workspaceQuotaBytes=${show(config.workspaceQuotaBytes, config.sources.workspaceQuota)} ` +
    `instanceQuotaBytes=${show(config.instanceQuotaBytes, config.sources.instanceQuota)} ` +
    `uploadBytesPerMinute=${show(config.uploadBytesPerMinute, config.sources.uploadBudget)} ` +
    `maxBytes=${config.maxBytes}`
  );
}
