'use client';

import { useSyncExternalStore } from 'react';
import { getHtmlHasDarkClass, subscribeHtmlDarkClass } from '@/lib/theme-preference';

/**
 * Marketing logo: `/public/logo.png` (light UI) and `/public/logo_dark.png` (when `html.dark`).
 */
export function BrandLogo({ height = 36, maxWidth = 200 }: { height?: number; maxWidth?: number }) {
  const dark = useSyncExternalStore(subscribeHtmlDarkClass, getHtmlHasDarkClass, () => false);
  const src = dark ? '/logo_dark.png' : '/logo.png';

  return (
    <img
      src={src}
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
