import { createTempStorageDir, removeTempStorageDir } from '../../test/helpers/storage';
import {
  attachmentsEnabled,
  closeStorageBackend,
  createStorageBackend,
  getStorageBackend,
  getStorageConfig,
} from './storage';
import {
  DEFAULT_ATTACHMENT_INSTANCE_QUOTA_BYTES,
  DEFAULT_ATTACHMENT_MAX_BYTES,
  DEFAULT_ATTACHMENT_UPLOAD_BYTES_PER_MINUTE,
  DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES,
  describeStorageCeilings,
  readStorageConfig,
  storageConfigWarnings,
} from './storage-config';

/**
 * Follows `mail-config.spec.ts`: every test clears the variables it set and resets the
 * process-wide singleton. The reset hook exists for exactly this — a spec that changes
 * `STORAGE_PATH` after something has already read it would otherwise be reading a backend
 * built from the previous value.
 */
const VARS = [
  'STORAGE_PATH',
  'ATTACHMENT_MAX_BYTES',
  'ATTACHMENT_WORKSPACE_QUOTA_BYTES',
  'ATTACHMENT_INSTANCE_QUOTA_BYTES',
  'ATTACHMENT_UPLOAD_BYTES_PER_MINUTE',
];

describe('storage configuration', () => {
  const original = new Map(VARS.map((name) => [name, process.env[name]]));
  const dirs: string[] = [];

  beforeEach(async () => {
    for (const name of VARS) delete process.env[name];
    await closeStorageBackend();
  });

  afterEach(async () => {
    for (const name of VARS) delete process.env[name];
    await closeStorageBackend();
  });

  afterAll(async () => {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const dir of dirs) await removeTempStorageDir(dir);
    await closeStorageBackend();
  });

  it('is off when STORAGE_PATH is unset', () => {
    expect(attachmentsEnabled()).toBe(false);
    expect(getStorageBackend()).toBeUndefined();
  });

  it('is off when STORAGE_PATH is blank rather than absent', () => {
    process.env.STORAGE_PATH = '   ';
    expect(readStorageConfig().disk).toBeUndefined();
    expect(attachmentsEnabled()).toBe(false);
  });

  it('is on when STORAGE_PATH is set', async () => {
    const dir = await createTempStorageDir();
    dirs.push(dir);
    process.env.STORAGE_PATH = dir;

    expect(attachmentsEnabled()).toBe(true);
    expect(getStorageBackend()?.backend).toBe('disk');
  });

  it('defaults the size limit to 25 MiB', () => {
    expect(getStorageConfig().maxBytes).toBe(26_214_400);
    expect(DEFAULT_ATTACHMENT_MAX_BYTES).toBe(26_214_400);
  });

  it('reads the size limit from the environment', () => {
    process.env.ATTACHMENT_MAX_BYTES = '1024';
    expect(getStorageConfig().maxBytes).toBe(1024);
  });

  it('refuses a non-positive size limit at boot rather than at upload time', () => {
    process.env.ATTACHMENT_MAX_BYTES = '0';
    expect(() => getStorageConfig()).toThrow(/ATTACHMENT_MAX_BYTES/);
  });

  /**
   * The error an operator actually sees, and it names the variable they set.
   *
   * `DiskStorageBackend`'s constructor refuses a relative root too, but its message is about a
   * "storage root" — a phrase that appears nowhere in `.env.example`. A relative `STORAGE_PATH`
   * would resolve against the API process's working directory, which is a different directory
   * under `pnpm dev`, under Docker and under a `cron`-invoked script, so "it worked on my
   * machine and the files vanished in production" is the failure being refused here.
   */
  it('refuses a relative STORAGE_PATH, naming the variable', () => {
    process.env.STORAGE_PATH = 'attachments';
    expect(() => getStorageConfig()).toThrow(/STORAGE_PATH/);
  });

  it('builds the same backend the singleton would, from a config alone', async () => {
    const dir = await createTempStorageDir();
    dirs.push(dir);

    const ceilings = {
      workspaceQuotaBytes: 0,
      instanceQuotaBytes: 0,
      uploadBytesPerMinute: 0,
      sources: { workspaceQuota: 'env', instanceQuota: 'env', uploadBudget: 'env' },
    } as const;
    expect(createStorageBackend({ disk: undefined, maxBytes: 1, ...ceilings })).toBeUndefined();
    expect(
      createStorageBackend({ disk: { root: dir }, maxBytes: 1, ...ceilings })?.persistsFiles,
    ).toBe(true);
  });

  /**
   * The reversal of ADR 0027's "unset = unlimited" (its 2026-08-21 update): an instance nobody
   * configured still has a finite ceiling, because the shipped Compose topology puts the
   * attachment volume on Postgres's disk and a full disk stops the database, not just uploads.
   */
  it('defaults both storage quotas to finite numbers when the variables are unset', () => {
    const config = getStorageConfig();

    expect(config.workspaceQuotaBytes).toBe(DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES);
    expect(config.instanceQuotaBytes).toBe(DEFAULT_ATTACHMENT_INSTANCE_QUOTA_BYTES);
    expect(DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES).toBe(2 * 1024 ** 3);
    expect(DEFAULT_ATTACHMENT_INSTANCE_QUOTA_BYTES).toBe(20 * 1024 ** 3);
    expect(config.sources).toEqual({
      workspaceQuota: 'default',
      instanceQuota: 'default',
      uploadBudget: 'default',
    });
  });

  it('treats a blank variable as unset, not as zero', () => {
    // `.env.example` ships the lines filled in, but an operator who blanks one has not opted
    // out of the ceiling; only a written `0` does that.
    process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = '   ';
    expect(getStorageConfig().workspaceQuotaBytes).toBe(DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES);
    expect(getStorageConfig().sources.workspaceQuota).toBe('default');
  });

  it('keeps the instance default no smaller than the workspace default', () => {
    expect(DEFAULT_ATTACHMENT_INSTANCE_QUOTA_BYTES).toBeGreaterThanOrEqual(
      DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES,
    );
  });

  it('reads an explicit 0 as unlimited, the opt-out', () => {
    process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = '0';
    process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = '0';
    const config = getStorageConfig();

    expect(config.workspaceQuotaBytes).toBe(0);
    expect(config.instanceQuotaBytes).toBe(0);
    expect(config.sources.workspaceQuota).toBe('env');
    expect(config.sources.instanceQuota).toBe('env');
  });

  it('reads both quotas from the environment', () => {
    process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = '1024';
    process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = '4096';
    expect(getStorageConfig().workspaceQuotaBytes).toBe(1024);
    expect(getStorageConfig().instanceQuotaBytes).toBe(4096);
  });

  it('refuses a negative quota at boot, naming the variable', () => {
    // `0` means unlimited (the retention windows' spelling); a negative value would read as a
    // quota that is always exceeded, so it is a configuration error rather than a clamp.
    process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = '-1';
    expect(() => getStorageConfig()).toThrow(/ATTACHMENT_WORKSPACE_QUOTA_BYTES/);

    delete process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES;
    process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = '-1';
    expect(() => readStorageConfig()).toThrow(/ATTACHMENT_INSTANCE_QUOTA_BYTES/);
  });

  it('defaults the upload byte budget to 256 MiB a minute', () => {
    expect(getStorageConfig().uploadBytesPerMinute).toBe(
      DEFAULT_ATTACHMENT_UPLOAD_BYTES_PER_MINUTE,
    );
    expect(DEFAULT_ATTACHMENT_UPLOAD_BYTES_PER_MINUTE).toBe(256 * 1024 ** 2);
  });

  it('reads the upload byte budget from the environment, with 0 switching it off', () => {
    process.env.ATTACHMENT_UPLOAD_BYTES_PER_MINUTE = '0';
    expect(readStorageConfig().uploadBytesPerMinute).toBe(0);

    process.env.ATTACHMENT_UPLOAD_BYTES_PER_MINUTE = '4096';
    expect(readStorageConfig().uploadBytesPerMinute).toBe(4096);
  });

  it('refuses a negative upload byte budget at boot, naming the variable', () => {
    process.env.ATTACHMENT_UPLOAD_BYTES_PER_MINUTE = '-5';
    expect(() => readStorageConfig()).toThrow(/ATTACHMENT_UPLOAD_BYTES_PER_MINUTE/);
  });

  describe('boot-time warnings', () => {
    it('warns, rather than refusing, when the workspace quota is above the instance quota', () => {
      process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = '4096';
      process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = '1024';

      const config = readStorageConfig();

      expect(config.workspaceQuotaBytes).toBe(4096);
      expect(storageConfigWarnings(config)).toEqual([
        expect.stringMatching(/ATTACHMENT_WORKSPACE_QUOTA_BYTES \(4096\) is larger than/),
      ]);
    });

    it('does not warn when one of the two quotas is unlimited', () => {
      process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = '4096';
      process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = '0';

      expect(storageConfigWarnings(readStorageConfig())).toEqual([]);
    });

    it('warns when a single max-size file can never fit in the per-minute budget', () => {
      process.env.ATTACHMENT_MAX_BYTES = '1000';
      process.env.ATTACHMENT_UPLOAD_BYTES_PER_MINUTE = '999';

      expect(storageConfigWarnings(readStorageConfig())).toEqual([
        expect.stringMatching(/ATTACHMENT_UPLOAD_BYTES_PER_MINUTE \(999\) is smaller than/),
      ]);
    });

    it('is silent on the defaults', () => {
      expect(storageConfigWarnings(readStorageConfig())).toEqual([]);
    });
  });

  describe('describeStorageCeilings', () => {
    it('names every ceiling with its source, spelling 0 as unlimited', () => {
      process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = '0';
      process.env.ATTACHMENT_UPLOAD_BYTES_PER_MINUTE = '4096';

      expect(describeStorageCeilings(readStorageConfig())).toBe(
        'Attachment ceilings: ' +
          `workspaceQuotaBytes=${DEFAULT_ATTACHMENT_WORKSPACE_QUOTA_BYTES} (default) ` +
          'instanceQuotaBytes=unlimited (env) uploadBytesPerMinute=4096 (env) ' +
          `maxBytes=${DEFAULT_ATTACHMENT_MAX_BYTES}`,
      );
    });
  });

  it('rebuilds after a reset, so a changed STORAGE_PATH is actually read again', async () => {
    expect(getStorageBackend()).toBeUndefined();

    const dir = await createTempStorageDir();
    dirs.push(dir);
    process.env.STORAGE_PATH = dir;
    // Still undefined: the singleton has already answered once and is not re-reading the env.
    expect(getStorageBackend()).toBeUndefined();

    await closeStorageBackend();
    expect(getStorageBackend()?.persistsFiles).toBe(true);
  });
});
