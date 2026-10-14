import React, { useEffect, useMemo, useState } from 'react';
import { Store } from 'lucide-react';
import { Vendor } from '../types';
import { VendorProfile } from '../lib/vendorProfile';
import type { SavedPin } from '../lib/vendorLocation';
import { EmptyState } from './ui/EmptyState';
import { ProfileSection, VendorProfileEditor } from './VendorProfileEditor';

interface Props {
  title: string;
  subtitle: string;
  sections: ProfileSection[];
  vendors: Vendor[];
  onSaved: (vendorId: string, profile: VendorProfile) => void;
  onAuthError?: (error: unknown) => void;
  onLocationSaved?: (vendorId: string, saved: SavedPin) => void;
  /** Optional: the picked restaurant lives in the app, so every page of the restaurant space shows the same one. */
  vendorId?: string;
  onVendorChange?: (id: string) => void;
}

/**
 * "Profil du restaurant" / "Horaires" of the restaurant space. Restaurants have no web login yet, so in the preview
 * the admin picks which restaurant to fill in (the same editor will serve the restaurant itself once it can sign in).
 */
export const RestaurantProfilePage: React.FC<Props> = ({ title, subtitle, sections, vendors, onSaved, onAuthError, onLocationSaved, vendorId: controlledId, onVendorChange }) => {
  const sorted = useMemo(() => [...vendors].sort((a, b) => a.name.localeCompare(b.name, 'fr')), [vendors]);
  const [ownId, setOwnId] = useState('');
  const vendorId = controlledId !== undefined ? controlledId : ownId;
  const setVendorId = (id: string) => (onVendorChange ? onVendorChange(id) : setOwnId(id));
  useEffect(() => { if (sorted.length && !sorted.some((v) => v.id === vendorId)) setVendorId(sorted[0].id); }, [sorted, vendorId]); // eslint-disable-line react-hooks/exhaustive-deps
  const vendor = sorted.find((v) => v.id === vendorId);

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[23px] font-semibold leading-tight tracking-tight text-kraveo-ink sm:text-[26px] lg:text-[29px]">{title}</h1>
          <p className="mt-1 text-sm text-kraveo-ink3">{subtitle}</p>
        </div>
        {sorted.length > 0 && (
          <div className="w-full sm:w-72">
            <label htmlFor="profile-vendor" className="k-label mb-1 block">Restaurant à remplir</label>
            <select id="profile-vendor" className="k-select" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              {sorted.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        )}
      </div>
      {vendor
        ? <VendorProfileEditor key={vendor.id} vendor={vendor} sections={sections} onSaved={onSaved} onLocationSaved={onLocationSaved} onAuthError={onAuthError} />
        : <div className="k-card"><EmptyState icon={Store} title="Aucun restaurant pour l’instant" description="Ajoutez ou validez un restaurant pour remplir sa fiche." /></div>}
    </div>
  );
};
