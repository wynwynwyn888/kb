'use client';

/**
 * Marketing logo from `/public/logo.png` (synced from repo `public/` for Next static serving).
 */
export function BrandLogo({ height = 36, maxWidth = 200 }: { height?: number; maxWidth?: number }) {
  return (
    <img
      src="/logo.png"
      alt="AISBP"
      height={height}
      style={{
        height,
        width: 'auto',
        maxWidth,
        objectFit: 'contain',
        display: 'block',
      }}
    />
  );
}
