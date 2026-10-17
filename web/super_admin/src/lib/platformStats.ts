// Platform-wide figures for the admin home (no React). Everything here is computed from COMPLETE server lists
// (every restaurant, every rider) or from server-side totals, never from the page of recent orders.
import type { AnalyticsData, ApprovalStatus, DriverPartner, Vendor } from '../types';
import { vendorHasRealPin } from './campus';
import { profileProgress } from './restaurantStats';

export type StatusCounts = Record<ApprovalStatus, number>;
export const EMPTY_COUNTS: StatusCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };

const tally = (statuses: Array<ApprovalStatus | undefined>): StatusCounts => {
  const counts = { ...EMPTY_COUNTS };
  // The server only omits the status on very old rows; those were created by the team, so they are approved.
  for (const status of statuses) counts[status ?? 'APPROVED'] += 1;
  return counts;
};

export const total = (counts: StatusCounts): number => counts.PENDING + counts.APPROVED + counts.REJECTED + counts.SUSPENDED;

export interface PartnerFigures { restaurants: StatusCounts; riders: StatusCounts; all: StatusCounts; registered: number }

/** Registrations by decision, for restaurants and riders, and both together. */
export const partnerFigures = (vendors: Vendor[], riders: DriverPartner[]): PartnerFigures => {
  const restaurants = tally(vendors.map((v) => v.approvalStatus));
  const rid = tally(riders.map((r) => r.approvalStatus));
  const all: StatusCounts = { PENDING: restaurants.PENDING + rid.PENDING, APPROVED: restaurants.APPROVED + rid.APPROVED, REJECTED: restaurants.REJECTED + rid.REJECTED, SUSPENDED: restaurants.SUSPENDED + rid.SUSPENDED };
  return { restaurants, riders: rid, all, registered: total(all) };
};

export interface RestaurantFigures { approved: number; open: number; closed: number; incompleteSheet: number; withoutPin: number }

/** What the approved restaurants are doing right now, and what is missing on their sheet. */
export const restaurantFigures = (vendors: Vendor[]): RestaurantFigures => {
  const approved = vendors.filter((v) => (v.approvalStatus ?? 'APPROVED') === 'APPROVED');
  const open = approved.filter((v) => v.isAcceptingOrders).length;
  return {
    approved: approved.length,
    open,
    closed: approved.length - open,
    incompleteSheet: approved.filter((v) => profileProgress(v).percent < 100).length,
    withoutPin: approved.filter((v) => !vendorHasRealPin(v)).length,
  };
};

export interface RiderFigures { approved: number; online: number; inTransit: number; offline: number }

export const riderFigures = (riders: DriverPartner[]): RiderFigures => {
  const approved = riders.filter((r) => (r.approvalStatus ?? 'APPROVED') === 'APPROVED');
  const inTransit = approved.filter((r) => r.dutyStatus === 'IN_TRANSIT').length;
  const online = approved.filter((r) => r.dutyStatus === 'ONLINE').length;
  return { approved: approved.length, online, inTransit, offline: approved.length - online - inTransit };
};

/** The server calls it `activeClients` (the older type said `activeStudents`): read whichever the server sent. */
export const activeClientsOf = (data: Pick<AnalyticsData, 'activeStudents'> & { activeClients?: number }): number =>
  Number.isFinite(data.activeClients) ? (data.activeClients as number) : Number.isFinite(data.activeStudents) ? data.activeStudents : 0;

/** Age in whole days of the oldest waiting application, or null when nothing waits or the list may be cut short. */
export const oldestWaitDays = (waiting: Array<{ appliedAt: string }>, pendingTotal: number, now: number): number | null => {
  if (!waiting.length || waiting.length < pendingTotal) return null; // the server list is capped: do not state a wrong "oldest"
  const oldest = Math.min(...waiting.map((a) => Date.parse(a.appliedAt)).filter(Number.isFinite));
  return Number.isFinite(oldest) ? Math.max(0, Math.floor((now - oldest) / 86_400_000)) : null;
};

/** "3 %" of the whole, for the stacked bar; 0 when the whole is empty. */
export const share = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 100) : 0);
