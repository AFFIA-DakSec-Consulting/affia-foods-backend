import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Phone, TriangleAlert } from 'lucide-react';
import { apiService } from '../services/api';
import { AdminProfile } from '../types';
import { AuthShell } from './ui/AuthShell';
import { RESTAURANT_LOGIN_PATH, goTo } from '../lib/route';
import { PIPELINE_ORDER, STATUS_META } from '../lib/tokens';

interface LoginScreenProps {
  onLoginSuccess: (profile: AdminProfile) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [passcode, setPasscode] = useState('');
  // Team members sign in with their phone number and personal code; the owner only types the general access code.
  const [memberMode, setMemberMode] = useState(false);
  const [phone, setPhone] = useState('');
  // Asked only when the server says this account uses an authenticator app (answer OTP_REQUIRED / OTP_INVALID).
  const [otpNeeded, setOtpNeeded] = useState(false);
  const [otp, setOtp] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (memberMode && !phone.trim()) {
      setErrorMessage('Veuillez saisir votre numéro de téléphone.');
      return;
    }
    if (!passcode.trim()) {
      setErrorMessage(memberMode ? 'Veuillez saisir votre code personnel.' : 'Veuillez saisir le code d’accès admin.');
      return;
    }

    setIsLoading(true);
    setErrorMessage('');

    try {
      const response = await apiService.adminLogin(passcode.trim(), undefined, memberMode ? phone.trim() : undefined, otpNeeded ? otp.trim() : undefined);
      setIsLoading(false);
      onLoginSuccess(response.admin);
    } catch (err: any) {
      setIsLoading(false);
      if (err?.code === 'OTP_REQUIRED' || err?.code === 'OTP_INVALID') setOtpNeeded(true);
      setErrorMessage(err?.code === 'OTP_REQUIRED' ? 'Saisissez le code de votre application d’authentification (ou un code de secours).' : err.message || 'Accès refusé. Code d’accès admin invalide.');
    }
  };

  return (
    <AuthShell
      title={<>Chaque commande.<br />Chaque livreur.<br /><span className="text-kraveo-yellow">Un seul écran serein.</span></>}
      lead="La console de répartition des livraisons AFFIA FOODS à Thiès."
      aside={(
        <div className="flex flex-wrap gap-2">
          {[...PIPELINE_ORDER, 'delivered' as const].map((key) => {
            const meta = STATUS_META[key];
            return (
              <span key={key} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold backdrop-blur bg-white/90 ${meta.text}`}>
                <span className={`k-dot ${meta.dot}`} />{meta.label}
              </span>
            );
          })}
        </div>
      )}
    >
        <div className="k-card animate-scale-in p-6 sm:p-8">
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-kraveo-ink">Bon retour</h1>
          <p className="mt-1 text-sm text-kraveo-ink2">Connectez-vous pour ouvrir le centre de commande.</p>

          {errorMessage && (
            <div id="login-error" role="alert" className="mt-6 flex items-start gap-3 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 p-3.5 text-sm text-kraveo-ink animate-fade-in">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-kraveo-danger" aria-hidden="true" />
              <span className="flex-1">{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
            {memberMode && (
              <div className="space-y-1.5">
                <label htmlFor="admin-phone" className="k-label">Votre numéro de téléphone</label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" />
                  <input id="admin-phone" type="tel" inputMode="tel" autoComplete="username" autoFocus value={phone} disabled={isLoading}
                    onChange={(e) => { setPhone(e.target.value); if (errorMessage) setErrorMessage(''); }} placeholder="77 123 45 67" className="k-input !min-h-[52px] pl-10" />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <label htmlFor="admin-passcode" className="k-label">{memberMode ? 'Votre code personnel' : 'Code d’accès admin'}</label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" />
                <input
                  id="admin-passcode"
                  type={showPassword ? 'text' : 'password'}
                  value={passcode}
                  onChange={(e) => { setPasscode(e.target.value); if (errorMessage) setErrorMessage(''); }}
                  placeholder={memberMode ? 'Le code reçu de votre administrateur' : 'Saisissez votre code d’accès'}
                  autoFocus={!memberMode}
                  autoComplete="current-password"
                  aria-invalid={Boolean(errorMessage)}
                  aria-describedby={errorMessage ? 'login-error' : undefined}
                  disabled={isLoading}
                  className="k-input !min-h-[52px] pl-10 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Masquer le code' : 'Afficher le code'}
                  aria-pressed={showPassword}
                  className="absolute right-1.5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-k-sm text-kraveo-ink3 transition-colors hover:text-kraveo-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
            </div>

            {otpNeeded && (
              <div className="space-y-1.5">
                <label htmlFor="admin-otp" className="k-label">Code de l’application d’authentification</label>
                <input id="admin-otp" inputMode="numeric" autoComplete="one-time-code" autoFocus value={otp} disabled={isLoading} maxLength={9}
                  onChange={(e) => { setOtp(e.target.value); if (errorMessage) setErrorMessage(''); }} placeholder="6 chiffres, ou un code de secours" className="k-input !min-h-[52px]" />
              </div>
            )}

            <button type="submit" disabled={isLoading} className="k-btn-accent !min-h-[52px] w-full text-base" aria-busy={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  <span>Connexion…</span>
                </>
              ) : (
                <>
                  <span>Ouvrir le centre de commande</span>
                  <ArrowRight className="h-5 w-5" aria-hidden="true" />
                </>
              )}
            </button>
            <button type="button" onClick={() => { setMemberMode((m) => !m); setErrorMessage(''); setPasscode(''); setOtpNeeded(false); setOtp(''); }} disabled={isLoading}
              className="w-full text-center text-sm font-semibold text-kraveo-g600 hover:underline">
              {memberMode ? 'Je suis le propriétaire : utiliser le code d’accès général' : 'Je suis membre de l’équipe : me connecter avec mon numéro'}
            </button>
          </form>
        </div>
      <p className="mt-6 text-center text-sm text-kraveo-ink2">
        Vous êtes restaurateur ?{' '}
        <button type="button" onClick={() => goTo(RESTAURANT_LOGIN_PATH)} className="font-semibold text-kraveo-g700 underline-offset-2 hover:underline">Accéder à l’espace restaurant</button>
      </p>
    </AuthShell>
  );
};
