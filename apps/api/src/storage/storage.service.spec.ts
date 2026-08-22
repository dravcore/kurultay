import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTempStorageDir, removeTempStorageDir } from '../../test/helpers/storage';
import { closeStorageBackend } from './storage';
import { StorageService } from './storage.service';

/**
 * The service is a pass-through, so what is worth pinning is the one thing it adds: the
 * `503` it raises when nothing is configured. A `500` there would report an operator's
 * deliberate choice as a server fault, and `GET /config` has already told the client the
 * feature is off.
 */
describe('StorageService', () => {
  let dir: string | undefined;
  const original = process.env.STORAGE_PATH;

  beforeEach(async () => {
    delete process.env.STORAGE_PATH;
    await closeStorageBackend();
  });

  afterEach(async () => {
    await removeTempStorageDir(dir);
    dir = undefined;
    if (original === undefined) delete process.env.STORAGE_PATH;
    else process.env.STORAGE_PATH = original;
    await closeStorageBackend();
  });

  async function enable(): Promise<StorageService> {
    dir = await createTempStorageDir();
    process.env.STORAGE_PATH = dir;
    await closeStorageBackend();
    return new StorageService();
  }

  it('reports the capability and the size limit without a backend', () => {
    const service = new StorageService();
    expect(service.persistsFiles).toBe(false);
    expect(service.maxBytes).toBe(26_214_400);
  });

  // Pinned as `toThrow` rather than `rejects`, and that is the measured behaviour rather than a
  // stylistic choice: these methods are plain pass-throughs, not `async`, so the guard runs
  // before any promise is constructed and the exception is raised *synchronously* from a method
  // whose signature says `Promise`. Every caller in the API `await`s it, which turns the throw
  // into the same rejection, so this is documented rather than changed — but a caller that
  // attached `.catch()` instead would never see it.
  it('answers 503, not 500, when nothing is configured', () => {
    const service = new StorageService();

    expect(() => service.write('01/98/k', Buffer.from('x'))).toThrow(ServiceUnavailableException);
    expect(() => service.createReadStream('01/98/k')).toThrow(ServiceUnavailableException);
    expect(() => service.remove('01/98/k')).toThrow(ServiceUnavailableException);
    expect(() => service.listKeys()).toThrow(ServiceUnavailableException);
  });

  it('round-trips bytes through the configured backend', async () => {
    const service = await enable();
    expect(service.persistsFiles).toBe(true);

    await service.write('01/98/k', Buffer.from('hello'));

    const stream = await service.createReadStream('01/98/k');
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello');

    const keys: string[] = [];
    for await (const entry of service.listKeys()) keys.push(entry.key);
    expect(keys).toEqual(['01/98/k']);

    await service.remove('01/98/k');
    await expect(service.createReadStream('01/98/k')).rejects.toThrow();
  });

  describe('the boot log line', () => {
    const quotaVars = ['ATTACHMENT_WORKSPACE_QUOTA_BYTES', 'ATTACHMENT_INSTANCE_QUOTA_BYTES'];
    const saved = new Map(quotaVars.map((name) => [name, process.env[name]]));

    afterEach(() => {
      for (const [name, value] of saved) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      jest.restoreAllMocks();
    });

    it('says which ceilings apply and which of them are defaults, once attachments are on', async () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const service = await enable();

      service.onModuleInit();

      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(/^Attachment ceilings: workspaceQuotaBytes=2147483648 \(default\)/),
      );
      expect(warn).not.toHaveBeenCalled();
    });

    it('warns about a workspace quota above the instance quota instead of refusing to boot', async () => {
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      process.env.ATTACHMENT_WORKSPACE_QUOTA_BYTES = '2048';
      process.env.ATTACHMENT_INSTANCE_QUOTA_BYTES = '1024';
      const service = await enable();

      service.onModuleInit();

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('is larger than'));
      expect(service.workspaceQuotaBytes).toBe(2048);
    });

    it('stays silent when attachments are off, because nothing is there to cap', () => {
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      const service = new StorageService();

      service.onModuleInit();

      expect(log).not.toHaveBeenCalled();
    });
  });

  it('closes the backend when the module is destroyed', async () => {
    const service = await enable();
    expect(service.persistsFiles).toBe(true);

    await service.onModuleDestroy();

    // The singleton was dropped, so the next read builds a fresh one from the environment.
    expect(service.persistsFiles).toBe(true);
  });
});
