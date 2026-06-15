import { userAsksAboutImageCapability, userAsksAboutRecentPhotoContent } from './image-capability-intent';

describe('image-capability-intent', () => {
  it('detects questions about image understanding', () => {
    expect(userAsksAboutImageCapability('can u understand image')).toBe(true);
    expect(userAsksAboutImageCapability('Can you see photos?')).toBe(true);
    expect(userAsksAboutImageCapability('hello there')).toBe(false);
  });

  it('detects follow-up questions about a recent photo', () => {
    expect(userAsksAboutRecentPhotoContent('whats the photo')).toBe(true);
    expect(userAsksAboutRecentPhotoContent("what's in the image")).toBe(true);
    expect(userAsksAboutRecentPhotoContent('describe the picture')).toBe(true);
    expect(userAsksAboutRecentPhotoContent('hello there')).toBe(false);
  });
});
