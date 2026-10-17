import React from 'react';
import { LogoBadge } from './Logo';

interface Props {
  /** Big sentence of the brand panel (desktop). */
  title: React.ReactNode;
  lead: string;
  /** Extra block under the lead (chips, steps…). */
  aside?: React.ReactNode;
  children: React.ReactNode;
  /** Width of the form column. */
  wide?: boolean;
}

/** Two-column sign-in / sign-up layout shared by the admin login and the restaurant pages. */
export const AuthShell: React.FC<Props> = ({ title, lead, aside, children, wide = false }) => (
  <div className="relative min-h-screen overflow-hidden bg-kraveo-night lg:grid lg:grid-cols-[1.1fr_1fr]">
    <section className="relative hidden overflow-hidden bg-gradient-to-br from-kraveo-g800 via-kraveo-g900 to-kraveo-g950 lg:flex lg:flex-col lg:justify-between lg:p-14" aria-hidden="true">
      <div className="pointer-events-none absolute -left-32 -top-32 h-[520px] w-[520px] rounded-full bg-kraveo-g400/25 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 right-0 h-[420px] w-[420px] rounded-full bg-kraveo-yellow/10 blur-[120px]" />
      <div className="k-map-grid pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div className="relative animate-fade-up"><LogoBadge imgClassName="h-14" /></div>
      <div className="relative max-w-xl">
        <h2 className="k-reveal font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-white xl:text-6xl" style={{ ['--i' as string]: 1 }}>{title}</h2>
        <p className="k-reveal mt-6 max-w-md text-base text-kraveo-g100/80" style={{ ['--i' as string]: 2 }}>{lead}</p>
        {aside && <div className="k-reveal mt-10" style={{ ['--i' as string]: 3 }}>{aside}</div>}
      </div>
      <p className="relative text-xs text-kraveo-g200/70">Réseau AFFIA FOODS · Conçu pour Thiès, Sénégal</p>
    </section>

    <main className="relative flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[360px] w-[360px] -translate-x-1/2 rounded-full bg-kraveo-g500/10 blur-[110px] lg:hidden" />
      <div className={`relative w-full ${wide ? 'max-w-lg' : 'max-w-md'}`}>
        <div className="mb-8 flex justify-center animate-fade-up lg:hidden"><LogoBadge imgClassName="h-14" /></div>
        {children}
        <p className="mt-6 text-center text-xs text-kraveo-ink3 lg:hidden">Réseau AFFIA FOODS · Conçu pour Thiès, Sénégal</p>
      </div>
    </main>
  </div>
);
