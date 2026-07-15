import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import axios from 'axios';
import { applyPalette } from '../utils/color';

interface Branding {
  id: string;
  name: string;
  logo: string | null;
  primaryColor: string | null;
}

interface BrandingContextValue {
  branding: Branding | null;
  loading: boolean;
}

const BrandingContext = createContext<BrandingContextValue>({ branding: null, loading: true });

export function useBranding() {
  return useContext(BrandingContext);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const host = window.location.hostname;
    axios
      .get(`/api/companies/branding/by-host`, { params: { host } })
      .then(res => {
        const data = res.data?.data as Branding | null;
        setBranding(data);
        if (data?.primaryColor) applyPalette(data.primaryColor);
      })
      .catch(() => setBranding(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <BrandingContext.Provider value={{ branding, loading }}>
      {children}
    </BrandingContext.Provider>
  );
}
