import { userAsksAboutImageCapability } from './image-capability-intent';

describe('image-capability-intent', () => {
  it('detects questions about image understanding', () => {
    expect(userAsksAboutImageCapability('can u understand image')).toBe(true);
    expect(userAsksAboutImageCapability('Can you see photos?')).toBe(true);
    expect(userAsksAboutImageCapability('hello there')).toBe(false);
  });
});
