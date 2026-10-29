import { createContext, useContext, useEffect, useState } from 'react';

export interface Brand {
  businessName: string;
  tagline: string;
}

/** The signed-in workspace's own name; provided by the console, so no company is hard-coded in the UI. */
export const BrandContext = createContext<Brand>({ businessName: '', tagline: '' });
export const useBrand = () => useContext(BrandContext);

export interface Product {
  productName: string;
  signupEnabled: boolean;
}

/** Product-level info for the sign-in screen (before anyone belongs to a workspace). */
export function useProduct(): Product {
  const [p, setP] = useState<Product>({ productName: 'Lead Console', signupEnabled: false });
  useEffect(() => {
    fetch('/admin/api/brand')
      .then((r) => r.json())
      .then((b: Product) => {
        setP(b);
        document.title = b.productName;
      })
      .catch(() => undefined);
  }, []);
  return p;
}
