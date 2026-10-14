import React from 'react';
import type { DishState } from '../lib/catalogParse';

const STATE: Record<DishState, { label: string; tone: string }> = {
  LIVE: { label: 'En ligne', tone: 'bg-kraveo-g500/10 text-kraveo-g700' },
  PENDING: { label: 'En attente de validation', tone: 'bg-kraveo-status-placed/15 text-kraveo-status-placed' },
  CHANGE_PENDING: { label: 'Changement de prix en attente', tone: 'bg-kraveo-status-preparing/15 text-kraveo-status-preparing' },
  REJECTED: { label: 'Refusé', tone: 'bg-kraveo-danger/15 text-kraveo-danger' },
  DELETED: { label: 'Supprimé', tone: 'bg-kraveo-surface2 text-kraveo-ink2' },
};

export const stateLabel = (state: DishState): string => STATE[state].label;

export const StateBadge: React.FC<{ state: DishState }> = ({ state }) => (
  <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${STATE[state].tone}`}>{STATE[state].label}</span>
);
