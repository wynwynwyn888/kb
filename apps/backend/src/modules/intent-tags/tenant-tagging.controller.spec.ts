import { TenantTaggingController } from './tenant-tagging.controller';

describe('TenantTaggingController caller-scoped GET', () => {
  it('authorizes before reading with the caller token', async () => {
    const ensureTenantAccessOrThrow = jest.fn().mockResolvedValue(undefined);
    const getTaggingSettingsForCaller = jest.fn().mockResolvedValue({ automaticTaggingEnabled: false });
    const controller = new TenantTaggingController(
      { getTaggingSettingsForCaller } as never,
      {} as never,
      { ensureTenantAccessOrThrow } as never,
    );

    await expect(controller.getTaggingSettings('tenant-a', { id: 'founder' } as never, 'jwt-a')).resolves.toEqual({
      automaticTaggingEnabled: false,
    });
    expect(ensureTenantAccessOrThrow).toHaveBeenCalledWith('tenant-a', 'founder');
    expect(getTaggingSettingsForCaller).toHaveBeenCalledWith('tenant-a', 'jwt-a');
    expect(ensureTenantAccessOrThrow.mock.invocationCallOrder[0]).toBeLessThan(
      getTaggingSettingsForCaller.mock.invocationCallOrder[0],
    );
  });
});
