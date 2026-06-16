import { validateMediaFetchUrl } from './ssrf-safe-url';

describe('validateMediaFetchUrl', () => {
  it('allows GHL CDN hosts', () => {
    expect(validateMediaFetchUrl('https://cdn.msgsndr.com/foo/bar.jpg').ok).toBe(true);
    expect(validateMediaFetchUrl('https://storage.googleapis.com/bucket/file.mp3').ok).toBe(true);
  });

  it('blocks private IPs and localhost', () => {
    expect(validateMediaFetchUrl('http://127.0.0.1/audio').ok).toBe(false);
    expect(validateMediaFetchUrl('http://169.254.169.254/meta').ok).toBe(false);
    expect(validateMediaFetchUrl('http://localhost/file').ok).toBe(false);
    expect(validateMediaFetchUrl('http://10.0.0.5/file').ok).toBe(false);
  });

  it('blocks unknown public hosts', () => {
    expect(validateMediaFetchUrl('https://evil.example.com/payload').ok).toBe(false);
  });

  it('blocks non-http(s) schemes', () => {
    expect(validateMediaFetchUrl('file:///etc/passwd').ok).toBe(false);
  });
});
