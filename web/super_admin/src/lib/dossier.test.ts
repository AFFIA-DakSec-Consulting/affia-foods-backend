import { describe, expect, it } from 'vitest';
import { dossierOf } from './dossier';
import type { Application } from '../types';

const base = { id: '1', userId: 'u', name: 'Awa', phone: '771234567', status: 'PENDING', rejectionReason: null, selfSignup: true, appliedAt: '2026-10-01T00:00:00Z', reviewedAt: null, createdAt: '2026-10-01T00:00:00Z' } as const;

describe('dossierOf', () => {
  it('a restaurant with licence, address, pin and cuisine is complete', () => {
    const app = { ...base, kind: 'VENDOR', vendor: { name: 'Chez Awa', category: 'Sénégalais', address: 'Thiès', fssaiNumber: 'L-123', isAcceptingOrders: false, lat: 14.79, lng: -16.93, hasLocation: true } } as Application;
    const d = dossierOf(app);
    expect(d.complete).toBe(true);
    expect(d.done).toBe(d.total);
  });
  it('lists what a restaurant is missing', () => {
    const app = { ...base, kind: 'VENDOR', vendor: { name: 'Chez Awa', category: 'Sénégalais', address: 'Thiès', fssaiNumber: null, isAcceptingOrders: false, hasLocation: false } } as Application;
    const d = dossierOf(app);
    expect(d.complete).toBe(false);
    expect(d.missing.map((m) => m.key)).toEqual(['fssai', 'pin']);
  });
  it('a rider needs plate, emergency contact and payout account', () => {
    const app = { ...base, kind: 'DRIVER', driver: { runnerCode: 'R1', vehicleType: 'Bike', vehicleRegNo: 'Non renseignée', emergencyPhone: '', upiId: null } } as Application;
    expect(dossierOf(app).missing.map((m) => m.key)).toEqual(['vehicle', 'emergency', 'payout']);
  });
});
