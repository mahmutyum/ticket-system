import { createContext, useContext } from 'react';

export interface Branding {
  id: string;
  name: string;
  logo: string | null;
  primaryColor: string | null;
}

export interface BrandingContextValue {
  branding: Branding | null;
  loading: boolean;
}

export const BrandingContext = createContext<BrandingContextValue>({ branding: null, loading: true });

export function useBranding() {
  return useContext(BrandingContext);
}
