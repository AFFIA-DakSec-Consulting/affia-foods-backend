import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, Loader2, LocateFixed, LifeBuoy, Lock, MapPin, Phone, TriangleAlert, X } from 'lucide-react';
import { ApiError, apiService } from '../services/api';
import { AuthShell } from './ui/AuthShell';
import { Field } from './ui/Field';
import { CATEGORIES, EMPTY_SIGNUP, FieldErrors, PartnerSession, SignupForm, canonicalPhone, fieldFromServer, formatPhone, frenchServerMessage, passwordStrength, signupBody, validateSignup } from '../lib/partnerSignup';
import { RESTAURANT_LOGIN_PATH, RESTAURANT_SIGNUP_PATH, goTo } from '../lib/route';

interface Props {
  mode: 'signup' | 'login';
  /** The server accepted the account or the sign-in: the session is stored, show what comes next. */
  onSession: (session: PartnerSession) => void;
}

const STEPS_ASIDE = (
  <ol className="space-y-4 text-white">
    {[
      ['1', 'Vous vous inscrivez', 'Votre nom, votre téléphone et votre restaurant. Cela prend deux minutes.'],
      ['2', 'Nous vérifions votre dossier', 'L’équipe Affia Foods contrôle vos informations et peut vous appeler.'],
      ['3', 'Vous recevez vos commandes', 'Après validation : votre fiche, votre menu, puis le bouton « Ouvert ».'],
    ].map(([n, t, d]) => (
      <li key={n} className="flex gap-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-sm font-bold">{n}</span>
        <span><span className="block font-semibold">{t}</span><span className="block text-sm text-kraveo-g100/75">{d}</span></span>
      </li>
    ))}
  </ol>
);

const ErrorBox: React.FC<{ id?: string; children: React.ReactNode }> = ({ id, children }) => (
  <div id={id} role="alert" className="mt-5 flex items-start gap-3 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 p-3.5 text-sm text-kraveo-ink animate-fade-in">
    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-kraveo-danger" aria-hidden="true" />
    <span className="flex-1">{children}</span>
  </div>
);

const PasswordInput: React.FC<{ id: string; value: string; onChange: (v: string) => void; invalid?: boolean; autoComplete: string; placeholder?: string; disabled?: boolean }> = ({ id, value, onChange, invalid, autoComplete, placeholder, disabled }) => {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" />
      <input id={id} type={shown ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} placeholder={placeholder} disabled={disabled} aria-invalid={invalid} aria-describedby={invalid ? `${id}-msg` : undefined} className="k-input !min-h-[48px] pl-10 pr-12" />
      <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={shown} className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-k-sm text-kraveo-ink3 hover:text-kraveo-ink">
        {shown ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
};

const PhoneInput: React.FC<{ id: string; value: string; onChange: (v: string) => void; invalid?: boolean; disabled?: boolean; autoFocus?: boolean }> = ({ id, value, onChange, invalid, disabled, autoFocus }) => (
  <div className="relative">
    <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" />
    <span className="pointer-events-none absolute left-10 top-1/2 -translate-y-1/2 text-sm font-semibold text-kraveo-ink2">+221</span>
    <input id={id} type="tel" inputMode="tel" autoComplete="tel-national" value={value} onChange={(e) => onChange(formatPhone(e.target.value))} placeholder="77 123 45 67" disabled={disabled} autoFocus={autoFocus} aria-invalid={invalid} aria-describedby={invalid ? `${id}-msg` : undefined} className="k-input !min-h-[48px] pl-[4.6rem]" />
  </div>
);

const STRENGTH = ['', 'Court', 'Correct', 'Bon', 'Très bon'];
const STRENGTH_TONE = ['', 'bg-kraveo-danger', 'bg-kraveo-status-placed', 'bg-kraveo-g500', 'bg-kraveo-g600'];

const Strength: React.FC<{ password: string }> = ({ password }) => {
  const level = passwordStrength(password);
  if (!level) return null;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1" aria-hidden="true">{[1, 2, 3, 4].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= level ? STRENGTH_TONE[level] : 'bg-kraveo-line'}`} />)}</div>
      <span className="text-xs font-semibold text-kraveo-ink3">{STRENGTH[level]}</span>
    </div>
  );
};

// ───────────────────────── Sign-in ─────────────────────────
const LoginForm: React.FC<{ onSession: Props['onSession'] }> = ({ onSession }) => {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canonicalPhone(phone)) { setError('Numéro sénégalais invalide (ex. 77 123 45 67).'); return; }
    if (!password) { setError('Saisissez votre mot de passe.'); return; }
    setBusy(true); setError('');
    try {
      onSession(await apiService.partnerLogin(phone.trim(), password));
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError ? frenchServerMessage(err.message) : 'Connexion impossible.');
    }
  };

  return (
    <div className="k-card animate-scale-in p-6 sm:p-8">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-kraveo-ink">Espace restaurant</h1>
      <p className="mt-1 text-sm text-kraveo-ink2">Connectez-vous pour suivre vos commandes et gérer votre fiche.</p>
      {error && <ErrorBox id="partner-login-error">{error}</ErrorBox>}
      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        <Field label="Téléphone" htmlFor="login-phone"><PhoneInput id="login-phone" value={phone} onChange={(v) => { setPhone(v); setError(''); }} disabled={busy} autoFocus /></Field>
        <Field label="Mot de passe" htmlFor="login-password"><PasswordInput id="login-password" value={password} onChange={(v) => { setPassword(v); setError(''); }} autoComplete="current-password" disabled={busy} /></Field>
        <button type="submit" disabled={busy} className="k-btn-accent !min-h-[52px] w-full text-base" aria-busy={busy}>
          {busy ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /><span>Connexion…</span></> : <><span>Se connecter</span><ArrowRight className="h-5 w-5" aria-hidden="true" /></>}
        </button>
      </form>
      <div className="mt-5 flex items-start gap-3 rounded-k-md bg-kraveo-surface2 p-3.5 text-sm text-kraveo-ink2">
        <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-kraveo-g600" aria-hidden="true" />
        <p><span className="font-semibold text-kraveo-ink">Mot de passe oublié ?</span> Contactez l’équipe Affia Foods : un administrateur vous en donne un nouveau, et vos anciens appareils sont déconnectés.</p>
      </div>
      <p className="mt-6 text-center text-sm text-kraveo-ink2">
        Pas encore partenaire ?{' '}
        <button type="button" onClick={() => goTo(RESTAURANT_SIGNUP_PATH)} className="font-semibold text-kraveo-g700 underline-offset-2 hover:underline">Inscrire mon restaurant</button>
      </p>
    </div>
  );
};

// ───────────────────────── Sign-up (2 steps) ─────────────────────────
type Pin = { lat: number; lng: number; accuracyM: number | null };
const STEP_ONE: Array<keyof FieldErrors> = ['name', 'phone', 'password'];

const SignupForm_: React.FC<{ onSession: Props['onSession'] }> = ({ onSession }) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<SignupForm>(EMPTY_SIGNUP);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pin, setPin] = useState<Pin | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');

  const set = (key: keyof SignupForm) => (value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => { if (!e[key === 'ninea' ? 'fssaiNumber' : key]) return e; const { [key === 'ninea' ? 'fssaiNumber' : key]: _, ...rest } = e; return rest; });
    setError('');
  };

  const next = () => {
    const all = validateSignup(form);
    const mine = Object.fromEntries(Object.entries(all).filter(([k]) => STEP_ONE.includes(k as keyof FieldErrors))) as FieldErrors;
    setErrors(mine);
    if (Object.keys(mine).length === 0) setStep(2);
  };

  const locate = () => {
    if (!navigator.geolocation) { setLocationError('Votre navigateur ne sait pas donner la position.'); return; }
    setLocating(true); setLocationError('');
    navigator.geolocation.getCurrentPosition(
      (p) => { setPin({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null }); setLocating(false); },
      (err) => { setLocating(false); setLocationError(err.code === err.PERMISSION_DENIED ? 'Position refusée. Vous pourrez la donner plus tard dans votre profil.' : 'Position introuvable. Réessayez, ou continuez sans.'); },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (step === 1) { next(); return; }
    const found = validateSignup(form);
    setErrors(found);
    if (Object.keys(found).length) { if (STEP_ONE.some((k) => found[k])) setStep(1); return; }
    setBusy(true); setError(''); setLocationError('');
    try {
      onSession(await apiService.partnerSignup(signupBody(form, pin)));
    } catch (err) {
      setBusy(false);
      if (!(err instanceof ApiError)) { setError('Inscription impossible. Réessayez.'); return; }
      const message = frenchServerMessage(err.message);
      const field = fieldFromServer(err.field);
      if (field === 'location') { setLocationError(message); setPin(null); return; }
      if (field) { setErrors({ [field]: message }); if (STEP_ONE.includes(field)) setStep(1); return; }
      setError(message);
    }
  };

  const phoneTaken = errors.phone?.includes('déjà un compte');

  return (
    <div className="k-card animate-scale-in p-6 sm:p-8">
      <p className="text-xs font-bold uppercase tracking-wider text-kraveo-g700">Étape {step} sur 2</p>
      <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-kraveo-ink">{step === 1 ? 'Créez votre compte' : 'Parlez-nous de votre restaurant'}</h1>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">{[1, 2].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-kraveo-g600' : 'bg-kraveo-line'}`} />)}</div>
      {error && <ErrorBox>{error}</ErrorBox>}

      <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
        {step === 1 ? (
          <>
            <Field label="Votre nom complet" htmlFor="su-name" error={errors.name} required>
              <input id="su-name" className="k-input !min-h-[48px]" value={form.name} onChange={(e) => set('name')(e.target.value)} autoComplete="name" placeholder="Awa Diop" autoFocus aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'su-name-msg' : undefined} />
            </Field>
            <Field label="Téléphone" htmlFor="su-phone" error={errors.phone} hint="Un numéro mobile sénégalais. C’est votre identifiant de connexion." required>
              <PhoneInput id="su-phone" value={form.phone} onChange={set('phone')} invalid={Boolean(errors.phone)} />
            </Field>
            {phoneTaken && <p className="-mt-3 text-sm"><button type="button" className="font-semibold text-kraveo-g700 hover:underline" onClick={() => goTo(RESTAURANT_LOGIN_PATH)}>Aller à la connexion</button></p>}
            <Field label="Mot de passe" htmlFor="su-password" error={errors.password} hint="Au moins 8 caractères. Mélangez lettres, chiffres et symboles pour le rendre solide." required>
              <PasswordInput id="su-password" value={form.password} onChange={set('password')} invalid={Boolean(errors.password)} autoComplete="new-password" />
            </Field>
            <Strength password={form.password} />
          </>
        ) : (
          <>
            <Field label="Nom du restaurant" htmlFor="su-restaurant" error={errors.restaurantName} required>
              <input id="su-restaurant" className="k-input !min-h-[48px]" value={form.restaurantName} onChange={(e) => set('restaurantName')(e.target.value)} placeholder="Chez Awa" autoFocus aria-invalid={Boolean(errors.restaurantName)} aria-describedby={errors.restaurantName ? 'su-restaurant-msg' : undefined} />
            </Field>
            <Field label="Type de cuisine" htmlFor="su-category" error={errors.category} required>
              <select id="su-category" className="k-select !min-h-[48px]" value={form.category} onChange={(e) => set('category')(e.target.value)} aria-invalid={Boolean(errors.category)}>
                <option value="">Choisir…</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Adresse de la cuisine" htmlFor="su-address" error={errors.address} hint="Le quartier et un repère connu, pour que le livreur trouve facilement." required>
              <input id="su-address" className="k-input !min-h-[48px]" value={form.address} onChange={(e) => set('address')(e.target.value)} placeholder="Escale, en face de la gare routière" autoComplete="street-address" aria-invalid={Boolean(errors.address)} aria-describedby={errors.address ? 'su-address-msg' : undefined} />
            </Field>
            <Field label="NINEA (facultatif)" htmlFor="su-ninea" error={errors.fssaiNumber} hint="Votre numéro d’identification fiscale. Vous pouvez l’ajouter plus tard, mais cela accélère la validation.">
              <input id="su-ninea" className="k-input !min-h-[48px]" value={form.ninea} onChange={(e) => set('ninea')(e.target.value)} autoCapitalize="characters" placeholder="0012345 2G3" aria-invalid={Boolean(errors.fssaiNumber)} aria-describedby={errors.fssaiNumber ? 'su-ninea-msg' : undefined} />
            </Field>
            <div className="space-y-2">
              <span className="k-label">Position sur la carte (facultatif)</span>
              {pin ? (
                <div className="flex items-center justify-between gap-3 rounded-k-md border border-kraveo-g400/30 bg-kraveo-g500/10 px-3.5 py-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-semibold text-kraveo-g700"><Check className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="truncate">Position enregistrée{pin.accuracyM != null ? ` (à ${Math.round(pin.accuracyM)} m près)` : ''}</span></span>
                  <button type="button" onClick={() => setPin(null)} aria-label="Retirer la position" className="k-icon-btn !h-8 !w-8"><X className="h-4 w-4" aria-hidden="true" /></button>
                </div>
              ) : (
                <button type="button" onClick={locate} disabled={locating} className="k-btn-ghost !min-h-[48px] w-full justify-center">
                  {locating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LocateFixed className="h-4 w-4" aria-hidden="true" />}
                  {locating ? 'Recherche de la position…' : 'Utiliser ma position actuelle'}
                </button>
              )}
              <p className="flex items-start gap-1.5 text-xs text-kraveo-ink3"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />Faites-le depuis votre cuisine : le restaurant sera placé précisément sur la carte.</p>
              {locationError && <p className="text-xs font-semibold text-kraveo-danger" role="alert">{locationError}</p>}
            </div>
          </>
        )}

        <div className="flex gap-3 pt-1">
          {step === 2 && <button type="button" onClick={() => setStep(1)} disabled={busy} className="k-btn-ghost !min-h-[52px] px-4" aria-label="Revenir à l’étape 1"><ArrowLeft className="h-5 w-5" aria-hidden="true" /></button>}
          <button type="submit" disabled={busy} className="k-btn-accent !min-h-[52px] flex-1 text-base" aria-busy={busy}>
            {busy ? <><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /><span>Envoi du dossier…</span></> : step === 1 ? <><span>Continuer</span><ArrowRight className="h-5 w-5" aria-hidden="true" /></> : <><span>Envoyer ma demande</span><Check className="h-5 w-5" aria-hidden="true" /></>}
          </button>
        </div>
      </form>

      <p className="mt-6 text-center text-sm text-kraveo-ink2">
        Déjà inscrit ?{' '}
        <button type="button" onClick={() => goTo(RESTAURANT_LOGIN_PATH)} className="font-semibold text-kraveo-g700 underline-offset-2 hover:underline">Se connecter</button>
      </p>
    </div>
  );
};

export const PartnerAuthScreen: React.FC<Props> = ({ mode, onSession }) => (
  <AuthShell
    wide={mode === 'signup'}
    title={mode === 'signup' ? <>Vendez plus.<br />Préparez sereinement.<br /><span className="text-kraveo-yellow">Nous livrons.</span></> : <>Vos commandes,<br />en direct,<br /><span className="text-kraveo-yellow">au même endroit.</span></>}
    lead={mode === 'signup' ? 'Rejoignez les restaurants partenaires d’Affia Foods à Thiès et recevez les commandes des clients de votre quartier.' : 'L’espace des restaurants partenaires d’Affia Foods à Thiès.'}
    aside={mode === 'signup' ? STEPS_ASIDE : undefined}
  >
    {mode === 'signup' ? <SignupForm_ onSession={onSession} /> : <LoginForm onSession={onSession} />}
    <p className="mt-4 text-center text-xs text-kraveo-ink3"><button type="button" className="hover:underline" onClick={() => goTo('/')}>Accès équipe Affia Foods</button></p>
  </AuthShell>
);
