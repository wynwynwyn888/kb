const mockInternalClient = { from: jest.fn() };
const mockCallerClient = { from: jest.fn() };
const mockCreateUserDatabaseClient = jest.fn(() => mockCallerClient);

jest.mock('../../lib/supabase', () => ({
  getSupabaseService: () => mockInternalClient,
}));
jest.mock('../../lib/database/user-database-client', () => ({
  createUserDatabaseClient: (token: string) => mockCreateUserDatabaseClient(token),
}));

import { TagRulesService } from './tag-rules.service';

function queryResult(data: unknown, error: unknown = null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data, error });
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  return { chain: { select }, select, eq, maybeSingle };
}

describe('TagRulesService caller-scoped tagging settings read', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses a fresh caller client and maps an existing setting', async () => {
    const query = queryResult({ automatic_tagging_enabled: true });
    mockCallerClient.from.mockReturnValue(query.chain);
    const service = new TagRulesService({} as never);

    await expect(service.getTaggingSettingsForCaller('tenant-a', 'jwt-a')).resolves.toEqual({
      automaticTaggingEnabled: true,
    });
    expect(mockCreateUserDatabaseClient).toHaveBeenCalledWith('jwt-a');
    expect(mockCallerClient.from).toHaveBeenCalledWith('tenant_tagging_settings');
    expect(query.select).toHaveBeenCalledWith('automatic_tagging_enabled');
    expect(query.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a');
    expect(mockInternalClient.from).not.toHaveBeenCalled();
  });

  it('preserves the false default for an authorized missing row', async () => {
    const query = queryResult(null);
    mockCallerClient.from.mockReturnValue(query.chain);
    const service = new TagRulesService({} as never);
    await expect(service.getTaggingSettingsForCaller('tenant-a', 'jwt-a')).resolves.toEqual({
      automaticTaggingEnabled: false,
    });
  });

  it('keeps internal reads on the internal client', async () => {
    const query = queryResult({ automatic_tagging_enabled: false });
    mockInternalClient.from.mockReturnValue(query.chain);
    const service = new TagRulesService({} as never);
    await service.getTaggingSettings('tenant-a');
    expect(mockInternalClient.from).toHaveBeenCalledWith('tenant_tagging_settings');
    expect(mockCreateUserDatabaseClient).not.toHaveBeenCalled();
  });

  it('returns a generic error without leaking database details', async () => {
    const query = queryResult(null, { message: 'Bearer secret-token database detail' });
    mockCallerClient.from.mockReturnValue(query.chain);
    const service = new TagRulesService({} as never);
    const warning = jest.spyOn((service as unknown as { logger: { warn: (message: string) => void } }).logger, 'warn');
    await expect(service.getTaggingSettingsForCaller('tenant-a', 'jwt-a')).rejects.toThrow(
      'Could not load tagging settings',
    );
    expect(warning).toHaveBeenCalledWith('getTaggingSettings failed');
    expect(warning).not.toHaveBeenCalledWith(expect.stringContaining('secret-token'));
  });
});
