import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Clock, Eye, EyeOff, Lock, Mail, ShieldAlert } from 'lucide-react';
import vidhyaVidhaiLogo from '../../assets/vidhya-vidhai-logo.png';
import vidhyaVidhaiMark from '../../assets/vidhya-vidhai-mark.png';
import { loadGoogleIdentityScript } from '../../services/authService';

export interface AuthNoticeState {
  kind: 'pending_approval' | 'access_denied';
  email?: string;
  message: string;
}

interface AuthGateProps {
  isLiveBackend: boolean;
  googleClientId: string;
  onGoogleTokenSuccess: (idToken: string) => Promise<void>;
  onEmailSignIn: (email: string) => Promise<void>;
  authNotice: AuthNoticeState | null;
  onResetAuthNotice?: () => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const AuthGate: React.FC<AuthGateProps> = ({
  isLiveBackend,
  googleClientId,
  onGoogleTokenSuccess,
  onEmailSignIn,
  authNotice,
  onResetAuthNotice,
}) => {
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const [gisReady, setGisReady] = useState(false);
  const [gisLoadError, setGisLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isLiveBackend || !googleClientId || authNotice) return;
    let active = true;

    loadGoogleIdentityScript()
      .then(() => {
        if (!active) return;
        const googleObj = (
          window as unknown as {
            google?: {
              accounts?: {
                id?: {
                  initialize: (cfg: {
                    client_id: string;
                    callback: (res: { credential?: string }) => void;
                  }) => void;
                  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void;
                };
              };
            };
          }
        ).google;

        if (!googleObj?.accounts?.id) {
          setGisLoadError('Google Identity Services did not initialize.');
          return;
        }

        googleObj.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => {
            if (response.credential) {
              void onGoogleTokenSuccess(response.credential);
            }
          },
        });

        if (buttonContainerRef.current) {
          buttonContainerRef.current.innerHTML = '';
          googleObj.accounts.id.renderButton(buttonContainerRef.current, {
            theme: 'outline',
            size: 'large',
            shape: 'pill',
            width: 340,
          });
        }
        setGisReady(true);
      })
      .catch((err) => {
        if (active) setGisLoadError(err instanceof Error ? err.message : 'Unable to load Google Sign-In');
      });

    return () => {
      active = false;
    };
  }, [authNotice, googleClientId, isLiveBackend, onGoogleTokenSuccess]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      setFormError('Enter a valid workspace email address.');
      emailInputRef.current?.focus();
      return;
    }
    if (isLiveBackend) {
      setFormError('Use the Google Sign-In button below to verify your account.');
      return;
    }
    if (!password) {
      setFormError('Enter your workspace password to continue.');
      passwordInputRef.current?.focus();
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      await onEmailSignIn(cleanEmail);
    } finally {
      setSubmitting(false);
    }
  };

  const handleLocalGoogleClick = async () => {
    const cleanEmail = email.trim();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      setFormError('Enter your Google email address above to continue.');
      emailInputRef.current?.focus();
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await onEmailSignIn(cleanEmail);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ct-auth-stage relative min-h-dvh flex flex-col items-center justify-center p-4 sm:p-6 overflow-hidden">
      {/* Sweeping concentric orbital hairline rings */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden"
      >
        <div className="w-[480px] h-[480px] rounded-full border border-[#FFFFFF]/85" />
        <div className="absolute w-[740px] h-[740px] rounded-full border border-[#1EA7FF]/[0.20]" />
        <div className="absolute w-[1040px] h-[1040px] rounded-full border border-[#0A1B2C]/[0.06]" />
      </div>

      <main className="relative z-10 w-full flex flex-col items-center justify-center">
        {/* Top-left workspace mark — Vidhya Vidhai Foundation in front of Career Tours */}
        <div className="w-full max-w-[420px] mb-5 sm:mb-0 sm:w-auto sm:fixed sm:top-7 sm:left-8 flex items-center gap-2.5">
          <img
            src={vidhyaVidhaiMark}
            alt=""
            aria-hidden="true"
            width={230}
            height={230}
            className="w-7 h-7 object-contain shrink-0 select-none"
          />
          <div className="flex flex-wrap items-center gap-x-1.5 text-sm tracking-tight">
            <span className="font-medium text-[#0A1B2C]">Vidhya Vidhai Foundation</span>
            <span className="text-[#33475B]" aria-hidden="true">
              ·
            </span>
            <span className="font-medium text-[#006BB8]">Career Tours</span>
          </div>
        </div>

        <section
          aria-labelledby="auth-heading"
          className="ct-auth-card relative w-full max-w-[420px] p-7 sm:p-8 flex flex-col gap-5"
        >
          {/* Transparent Vidhya Vidhai Foundation brand logo */}
          <div className="flex flex-col items-center text-center">
            <img
              src={vidhyaVidhaiLogo}
              alt="Vidhya Vidhai Foundation — Educate, Innovate, Lead"
              width={824}
              height={176}
              fetchPriority="high"
              decoding="sync"
              className="w-[224px] sm:w-[252px] h-auto object-contain mb-4 select-none"
            />
            <h1
              id="auth-heading"
              className="text-xl sm:text-[1.45rem] font-medium text-[#0A1B2C] tracking-tight"
            >
              Sign in with email
            </h1>
            <p className="text-xs sm:text-[13px] text-[#243647] mt-1.5 leading-relaxed max-w-[35ch] text-balance">
              Enter the Vidhya Vidhai Foundation · Career Tours workspace to log classroom data or view programme reports.
            </p>
          </div>

        {authNotice?.kind === 'pending_approval' ? (
          <div
            role="status"
            className="p-4 rounded-2xl bg-[#FFFBEB] border border-[#B45309]/40 text-sm text-[#0A1B2C] flex flex-col gap-3"
          >
            <div className="flex items-start gap-2.5">
              <Clock className="w-5 h-5 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="text-base font-medium text-[#0A1B2C]">Account Pending Approval</h2>
                <p className="text-xs sm:text-sm text-[#243647] mt-1 leading-relaxed">
                  {authNotice.message}
                </p>
                {authNotice.email && (
                  <p className="text-xs font-mono text-[#92400E] mt-1.5">{authNotice.email}</p>
                )}
              </div>
            </div>
            {onResetAuthNotice && (
              <button
                type="button"
                onClick={onResetAuthNotice}
                className="ct-btn-secondary w-full justify-center text-sm rounded-xl"
              >
                Sign in with a different Google account
              </button>
            )}
          </div>
        ) : authNotice?.kind === 'access_denied' ? (
          <div
            role="alert"
            className="p-4 rounded-2xl bg-[#FFF1F2] border border-[#BE123C]/40 text-sm text-[#0A1B2C] flex flex-col gap-3"
          >
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-[#BE123C] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="text-base font-medium text-[#0A1B2C]">Access Denied</h2>
                <p className="text-xs sm:text-sm text-[#243647] mt-1 leading-relaxed">
                  {authNotice.message}
                </p>
                {authNotice.email && (
                  <p className="text-xs font-mono text-[#BE123C] mt-1.5">{authNotice.email}</p>
                )}
              </div>
            </div>
            {onResetAuthNotice && (
              <button
                type="button"
                onClick={onResetAuthNotice}
                className="ct-btn-secondary w-full justify-center text-sm rounded-xl"
              >
                Try a different Google account
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={(e) => void handleEmailSubmit(e)} noValidate className="flex flex-col gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-email" className="text-xs font-medium text-[#0A1B2C]">
                Email
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  ref={emailInputRef}
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="next"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (formError) setFormError(null);
                  }}
                  aria-invalid={Boolean(formError && !EMAIL_PATTERN.test(email.trim()))}
                  className="ct-input pl-10 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                />
              </div>
            </div>

            {!isLiveBackend && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-password" className="text-xs font-medium text-[#0A1B2C]">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    ref={passwordInputRef}
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    enterKeyHint="done"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (formError) setFormError(null);
                    }}
                    aria-invalid={Boolean(formError && EMAIL_PATTERN.test(email.trim()) && !password)}
                    className="ct-input pl-10 pr-11 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                  />
                  <button
                    type="button"
                    aria-pressed={showPassword}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-describedby="toggle-password-warning"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-[#33475B] hover:text-[#0A1B2C] hover:bg-[#EFE8D6] cursor-pointer transition-colors"
                  >
                    {showPassword ? (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                  <span id="toggle-password-warning" className="visually-hidden">
                    Warning: this will display your password on the screen.
                  </span>
                </div>
              </div>
            )}

            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            {!isLiveBackend && (
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl mt-1 bg-[#0A1B2C] hover:bg-[#132C45] border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center cursor-pointer transition-colors disabled:opacity-50"
              >
                {submitting ? 'Signing in...' : 'Get Started'}
              </button>
            )}

            <div className="relative flex items-center gap-3 my-1">
              <div className="flex-1 border-t border-dotted border-[#C7BEA7]" aria-hidden="true" />
              <span className="text-[11px] text-[#33475B] shrink-0">Or sign in with</span>
              <div className="flex-1 border-t border-dotted border-[#C7BEA7]" aria-hidden="true" />
            </div>

            {isLiveBackend ? (
              <div className="flex flex-col items-center gap-2">
                <div ref={buttonContainerRef} className="min-h-[44px] flex items-center justify-center" />
                {!gisReady && !gisLoadError && (
                  <p className="text-xs text-[#33475B]">Loading Google Sign-In...</p>
                )}
                {gisLoadError && <p className="text-xs text-[#BE123C]">{gisLoadError}</p>}
              </div>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleLocalGoogleClick()}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#FFFFFF] hover:bg-[#F5F2E9] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] text-sm font-medium inline-flex items-center justify-center gap-2.5 ct-interactive-tile shadow-xs cursor-pointer transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5c-.2 1.2-1 2.3-2 3v2.5h3.2c1.9-1.7 3.1-4.3 3.1-7.3z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 22c2.7 0 5-.9 6.7-2.4l-3.2-2.5c-.9.6-2.1 1-3.5 1-2.7 0-4.9-1.8-5.7-4.3H3v2.6C4.7 19.8 8.1 22 12 22z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M6.3 13.8c-.2-.6-.3-1.2-.3-1.8s.1-1.2.3-1.8V7.6H3C2.4 8.9 2 10.4 2 12s.4 3.1 1 4.4l3.3-2.6z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.9C17 2.9 14.7 2 12 2 8.1 2 4.7 4.2 3 7.6l3.3 2.6c.8-2.5 3-4.3 5.7-4.3z"
                  />
                </svg>
                <span>Continue with Google</span>
              </button>
            )}
          </form>
        )}
        </section>
      </main>

      <footer className="relative z-10 mt-5 text-center">
        <p className="text-xs text-[#243647]">
          Developed by{' '}
          <a
            href="https://roosstudiox.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#0A1B2C] hover:text-[#006BB8] underline decoration-[#5F7082] hover:decoration-[#006BB8] underline-offset-4 transition-colors"
          >
            Roos StudioX
          </a>
        </p>
      </footer>
    </div>
  );
};
