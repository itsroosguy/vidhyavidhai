import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Clock, Eye, EyeOff, Lock, LogIn, Mail, ShieldAlert } from 'lucide-react';
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
            theme: 'filled_black',
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
    <main className="ct-auth-stage relative min-h-dvh flex flex-col items-center justify-center p-4 sm:p-6 overflow-hidden">
      {/* Sweeping concentric orbital hairline rings */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden"
      >
        <div className="w-[480px] h-[480px] rounded-full border border-[#E8EFFC]/[0.06]" />
        <div className="absolute w-[740px] h-[740px] rounded-full border border-[#4EBBBB]/[0.10]" />
        <div className="absolute w-[1040px] h-[1040px] rounded-full border border-[#E8EFFC]/[0.04]" />
      </div>

      {/* Top-left workspace mark */}
      <div className="relative z-10 w-full max-w-[420px] mb-5 sm:mb-0 sm:w-auto sm:fixed sm:top-7 sm:left-8 flex items-center gap-2.5">
        <div
          aria-hidden="true"
          className="w-8 h-8 rounded-xl bg-[#101E3C] border border-[#26456F] flex items-center justify-center shadow-[0_6px_18px_rgba(6,11,24,0.4)]"
        >
          <svg
            viewBox="0 0 24 24"
            className="w-4 h-4 text-[#4EBBBB]"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </div>
        <span className="text-sm font-medium text-[#E8EFFC] tracking-tight">
          Career Tours
        </span>
      </div>

      <section
        aria-labelledby="auth-heading"
        className="ct-auth-card relative z-10 w-full max-w-[420px] p-7 sm:p-8 flex flex-col gap-5"
      >
        {/* Top elevated squircle emblem */}
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#162D55] border border-[#26456F] shadow-[0_10px_28px_rgba(6,11,24,0.45),inset_0_1px_0_rgba(232,239,252,0.12)] flex items-center justify-center text-[#4EBBBB] mb-4">
            <LogIn className="w-5 h-5" aria-hidden="true" />
          </div>
          <h1
            id="auth-heading"
            className="text-xl sm:text-[1.45rem] font-medium text-[#E8EFFC] tracking-tight"
          >
            Sign in with email
          </h1>
          <p className="text-xs sm:text-[13px] text-[#A4B7D2] mt-1.5 leading-relaxed max-w-[34ch] text-balance">
            Enter the Career Tours workspace to log classroom data or view programme reports.
          </p>
        </div>

        {authNotice?.kind === 'pending_approval' ? (
          <div
            role="status"
            className="p-4 rounded-2xl bg-[#392A11] border border-[#F2B44D]/45 text-sm text-[#E8EFFC] flex flex-col gap-3"
          >
            <div className="flex items-start gap-2.5">
              <Clock className="w-5 h-5 text-[#F2B44D] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="text-base font-medium text-[#E8EFFC]">Account Pending Approval</h2>
                <p className="text-xs sm:text-sm text-[#A4B7D2] mt-1 leading-relaxed">
                  {authNotice.message}
                </p>
                {authNotice.email && (
                  <p className="text-xs font-mono text-[#F2B44D] mt-1.5">{authNotice.email}</p>
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
            className="p-4 rounded-2xl bg-[#E77B83]/10 border border-[#E77B83]/45 text-sm text-[#E8EFFC] flex flex-col gap-3"
          >
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="w-5 h-5 text-[#E77B83] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <h2 className="text-base font-medium text-[#E8EFFC]">Access Denied</h2>
                <p className="text-xs sm:text-sm text-[#A4B7D2] mt-1 leading-relaxed">
                  {authNotice.message}
                </p>
                {authNotice.email && (
                  <p className="text-xs font-mono text-[#E77B83] mt-1.5">{authNotice.email}</p>
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
              <label htmlFor="login-email" className="text-xs font-medium text-[#A4B7D2]">
                Email
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-[#8294B1] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
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
                  className="ct-input pl-10 rounded-xl"
                />
              </div>
            </div>

            {!isLiveBackend && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-password" className="text-xs font-medium text-[#A4B7D2]">
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-[#8294B1] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
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
                    className="ct-input pl-10 pr-11 rounded-xl"
                  />
                  <button
                    type="button"
                    aria-pressed={showPassword}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-describedby="toggle-password-warning"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg flex items-center justify-center text-[#8294B1] hover:text-[#E8EFFC] hover:bg-[#172B4D] cursor-pointer transition-colors"
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
                className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#E77B83]/10 border border-[#E77B83]/45 text-[#E77B83]"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            {!isLiveBackend && (
              <button
                type="submit"
                disabled={submitting}
                className="ct-btn-primary w-full justify-center rounded-xl mt-1"
              >
                {submitting ? 'Signing in...' : 'Get Started'}
              </button>
            )}

            <div className="relative flex items-center gap-3 my-1">
              <div className="flex-1 border-t border-dotted border-[#26456F]" aria-hidden="true" />
              <span className="text-[11px] text-[#8294B1] shrink-0">Or sign in with</span>
              <div className="flex-1 border-t border-dotted border-[#26456F]" aria-hidden="true" />
            </div>

            {isLiveBackend ? (
              <div className="flex flex-col items-center gap-2">
                <div ref={buttonContainerRef} className="min-h-[44px] flex items-center justify-center" />
                {!gisReady && !gisLoadError && (
                  <p className="text-xs text-[#8294B1]">Loading Google Sign-In...</p>
                )}
                {gisLoadError && <p className="text-xs text-[#E77B83]">{gisLoadError}</p>}
              </div>
            ) : (
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleLocalGoogleClick()}
                className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0C1931] hover:bg-[#162D55] border border-[#26456F] hover:border-[#4EBBBB]/55 text-[#E8EFFC] text-sm font-medium inline-flex items-center justify-center gap-2.5 ct-interactive-tile cursor-pointer transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
                  <path
                    fill="#4EBBBB"
                    d="M21.8 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.5c-.2 1.2-1 2.3-2 3v2.5h3.2c1.9-1.7 3.1-4.3 3.1-7.3z"
                  />
                  <path
                    fill="#48B98A"
                    d="M12 22c2.7 0 5-.9 6.7-2.4l-3.2-2.5c-.9.6-2.1 1-3.5 1-2.7 0-4.9-1.8-5.7-4.3H3v2.6C4.7 19.8 8.1 22 12 22z"
                  />
                  <path
                    fill="#F2B44D"
                    d="M6.3 13.8c-.2-.6-.3-1.2-.3-1.8s.1-1.2.3-1.8V7.6H3C2.4 8.9 2 10.4 2 12s.4 3.1 1 4.4l3.3-2.6z"
                  />
                  <path
                    fill="#E77B83"
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
  );
};
