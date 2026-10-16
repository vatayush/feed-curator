import type { Adapter, Site } from '../types';
import { linkedinAdapter } from './linkedin';
import { xAdapter } from './x';

export const adapters: Record<Site, Adapter> = { x: xAdapter, linkedin: linkedinAdapter };

export function siteForHost(hostname: string): Site | null {
  if (hostname === 'x.com' || hostname.endsWith('.x.com')) return 'x';
  if (hostname.endsWith('linkedin.com')) return 'linkedin';
  return null;
}
