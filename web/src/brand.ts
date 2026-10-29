import { useEffect, useState } from 'react';

export interface Brand {
  businessName: string;
  tagline: string;
}

let cached: Brand | null = null;

/** Business name configured on the server (BUSINESS_NAME); the UI carries no hard-coded company. */
export function useBrand(): Brand {
  const [brand, setBrand] = useState<Brand>(cached ?? { businessName: '', tagline: '' });
  useEffect(() => {
    if (cached) return;
    fetch('/admin/api/brand')
      .then((r) => r.json())
      .then((b: Brand) => {
        cached = b;
        setBrand(b);
        document.title = `${b.businessName} · Lead Console`;
      })
      .catch(() => undefined);
  }, []);
  return brand;
}
