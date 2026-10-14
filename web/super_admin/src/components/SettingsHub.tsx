import React, { useMemo, useState } from 'react';
import { ChevronRight, Construction, LifeBuoy, LogOut, Search, SearchX, UserRound } from 'lucide-react';
import { AdminProfile } from '../types';
import { TabType, Workspace, isSoon } from '../lib/navigation';
import { ADMIN_HUB, RESTAURANT_HUB, soonPageOf } from '../lib/settingsCatalog';
import { Avatar } from './ui/Avatar';

interface Props {
  onNavigate: (tab: TabType) => void;
  adminProfile?: AdminProfile;
  onLogout: () => void;
  workspace?: Workspace;
}

// Same layout as the Eylos settings hub: sections of cards, each opens a page. Cards without a screen yet show "Bientôt".
// The super admin sees every card of both workspaces; nothing is hidden from this role.
export const SettingsHub: React.FC<Props> = ({ onNavigate, adminProfile, onLogout, workspace = 'admin' }) => {
  const [search, setSearch] = useState('');
  const hub = workspace === 'restaurant' ? RESTAURANT_HUB : ADMIN_HUB;
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hub
      .map((section) => ({ ...section, cards: section.cards.filter((card) => !q || `${card.title} ${card.description} ${section.title}`.toLowerCase().includes(q)) }))
      .filter((section) => section.cards.length > 0);
  }, [search, hub]);
  const cardCount = hub.reduce((sum, section) => sum + section.cards.length, 0);

  return (
    <div className="flex w-full max-w-[1400px] flex-col gap-6">
      <div>
        <h1 className="font-display text-[23px] font-semibold leading-tight tracking-tight text-kraveo-ink sm:text-[26px] lg:text-[29px]">Paramètres</h1>
        <p className="mt-1 text-sm text-kraveo-ink3">{workspace === 'restaurant' ? 'Les réglages que verront les restaurants partenaires.' : `Gérez votre compte, la plateforme et vos utilisateurs. ${cardCount} rubriques, dont celles qui arrivent bientôt.`}</p>
      </div>

      <label className="flex items-center gap-2.5 rounded-xl border border-kraveo-line bg-kraveo-surface px-4 py-3 shadow-k-soft focus-within:border-kraveo-g500 focus-within:ring-2 focus-within:ring-kraveo-g500/20">
        <Search className="h-[18px] w-[18px] flex-none text-kraveo-ink3" aria-hidden="true" />
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Rechercher un paramètre" placeholder="Rechercher un paramètre…"
          className="w-full min-w-0 border-0 bg-transparent p-0 text-sm text-kraveo-ink placeholder:text-kraveo-ink3 focus:outline-none focus:ring-0" />
      </label>

      <div>
        {adminProfile && !search && workspace === 'admin' && (
          <section className="mb-7 flex flex-wrap items-center gap-4 rounded-k-xl border border-kraveo-line bg-kraveo-surface p-5 shadow-k-soft">
            <Avatar name={adminProfile.name} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-bold text-kraveo-ink">{adminProfile.name}</p>
              <p className="text-sm text-kraveo-ink3">Super administrateur{adminProfile.phone ? ` · ${adminProfile.phone}` : ''}</p>
            </div>
            <button type="button" className="k-btn-ghost" onClick={onLogout}><LogOut className="h-4 w-4" aria-hidden="true" />Se déconnecter</button>
          </section>
        )}

        {sections.map((section) => (
          <section key={section.id} className="mb-7" aria-label={section.title}>
            <h2 className="k-label mb-2.5 px-0.5">{section.title}</h2>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 min-[1700px]:grid-cols-3">
              {section.cards.map((card) => {
                const soon = isSoon(card.tab as TabType);
                return (
                  <button key={card.tab} type="button" onClick={() => onNavigate(card.tab as TabType)}
                    className="group flex h-full items-start gap-3.5 rounded-k-lg border border-kraveo-line bg-kraveo-surface px-[18px] py-[17px] text-left shadow-k-soft transition-all hover:-translate-y-0.5 hover:border-kraveo-g400/50 hover:shadow-k-lift focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kraveo-g500/40">
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-kraveo-g500/10 text-kraveo-g600"><card.icon className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[14.5px] font-semibold leading-snug text-kraveo-ink">{card.title}</span>
                        {soon && <span className="inline-flex items-center rounded-full bg-kraveo-surface2 px-2.5 py-0.5 text-[11px] font-bold text-kraveo-ink3">Bientôt</span>}
                      </span>
                      <span className="mt-0.5 block text-[12.5px] leading-normal text-kraveo-ink3">{card.description}</span>
                    </span>
                    <ChevronRight className="h-[18px] w-[18px] flex-none self-center text-kraveo-ink3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        {sections.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-14 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-kraveo-surface2 text-kraveo-ink3" aria-hidden="true"><SearchX className="h-6 w-6" /></span>
            <h3 className="text-sm font-semibold text-kraveo-ink">Aucun paramètre trouvé</h3>
            <p className="text-[13px] text-kraveo-ink3">Essayez un autre mot, par exemple « frais » ou « messages ».</p>
          </div>
        )}
      </div>
    </div>
  );
};

/** A settings page that is planned but not built: says what it will configure and what is needed first. */
export const SettingsSoonPage: React.FC<{ id: string; onBack: () => void }> = ({ id, onBack }) => {
  const entry = soonPageOf(id);
  if (!entry) return null;
  return (
    <>
      <SettingsPageHeader title={entry.title} subtitle={entry.description} onBack={onBack} />
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="k-card space-y-4 p-5 sm:p-6" aria-label="Contenu prévu">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-k-md bg-kraveo-yellow/20 text-kraveo-y700"><Construction className="h-5 w-5" aria-hidden="true" /></span>
            <div><h2 className="font-display text-base font-bold text-kraveo-ink">Bientôt disponible</h2><p className="text-sm text-kraveo-ink3">Cette page fait partie des réglages prévus.</p></div>
          </div>
          <div>
            <p className="k-label mb-2">Ce que vous pourrez régler</p>
            <ul className="space-y-2">
              {entry.planned.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-kraveo-ink2"><entry.icon className="mt-0.5 h-4 w-4 flex-none text-kraveo-g600" aria-hidden="true" />{item}</li>
              ))}
            </ul>
          </div>
          <div className="k-inset px-4 py-3"><p className="k-label !text-[10px]">Ce qu’il faut d’abord</p><p className="mt-0.5 text-sm text-kraveo-ink2">{entry.needs}</p></div>
        </section>
      </div>
    </>
  );
};

/** Header of a settings sub-page: breadcrumb back to the hub, title, subtitle. */
export const SettingsPageHeader: React.FC<{ title: string; subtitle: string; onBack: () => void }> = ({ title, subtitle, onBack }) => (
  <div className="mx-auto mb-5 max-w-3xl">
    <nav className="mb-2 flex items-center gap-1.5 text-[13px]" aria-label="Fil d’Ariane">
      <button type="button" onClick={onBack} className="rounded font-medium text-kraveo-ink3 transition-colors hover:text-kraveo-g600">Paramètres</button>
      <ChevronRight className="h-3.5 w-3.5 text-kraveo-ink3" aria-hidden="true" />
      <span className="text-kraveo-ink3">{title}</span>
    </nav>
    <h1 className="font-display text-[23px] font-semibold leading-tight tracking-tight text-kraveo-ink sm:text-[26px] lg:text-[29px]">{title}</h1>
    <p className="mt-1 text-sm text-kraveo-ink3">{subtitle}</p>
  </div>
);

/** "Mon compte": what the dashboard really knows about the signed-in admin. */
export const AccountPage: React.FC<{ adminProfile?: AdminProfile; onLogout: () => void }> = ({ adminProfile, onLogout }) => (
  <div className="mx-auto max-w-3xl space-y-5">
    <section className="k-card space-y-5 p-5 sm:p-6" aria-label="Profil">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={adminProfile?.name ?? 'Administrateur'} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-xl font-bold text-kraveo-ink">{adminProfile?.name ?? 'Administrateur'}</p>
          <p className="text-sm text-kraveo-ink3">Super administrateur</p>
        </div>
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="k-inset px-4 py-3"><dt className="k-label">Nom</dt><dd className="mt-0.5 text-sm font-bold text-kraveo-ink">{adminProfile?.name ?? '—'}</dd></div>
        <div className="k-inset px-4 py-3"><dt className="k-label">Téléphone</dt><dd className="mt-0.5 text-sm font-bold text-kraveo-ink">{adminProfile?.phone || '—'}</dd></div>
        <div className="k-inset px-4 py-3"><dt className="k-label">Rôle</dt><dd className="mt-0.5 text-sm font-bold text-kraveo-ink">Super administrateur</dd></div>
        <div className="k-inset px-4 py-3"><dt className="k-label">Connexion</dt><dd className="mt-0.5 text-sm font-bold text-kraveo-ink">Code d’accès administrateur</dd></div>
      </dl>
      <p className="text-sm text-kraveo-ink3">Ces informations viennent du serveur. Pour l’instant elles ne se modifient pas depuis le tableau de bord : le compte administrateur est défini côté serveur.</p>
    </section>

    <section className="k-card flex flex-wrap items-center justify-between gap-4 p-5 sm:p-6" aria-label="Session">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-[10px] bg-kraveo-danger/10 text-kraveo-danger"><LifeBuoy className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <h2 className="font-display text-base font-bold text-kraveo-ink">Session</h2>
          <p className="text-sm text-kraveo-ink3">Vous êtes connecté sur cet appareil. Déconnectez-vous si vous n’êtes pas seul sur cet ordinateur.</p>
        </div>
      </div>
      <button type="button" className="k-btn-danger" onClick={onLogout}><LogOut className="h-4 w-4" aria-hidden="true" />Se déconnecter</button>
    </section>
  </div>
);
