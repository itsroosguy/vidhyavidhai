import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Loader2,
  Mail,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import vidhyaVidhaiLogo from '../../assets/vidhya-vidhai-logo.png';
import vidhyaVidhaiMark from '../../assets/vidhya-vidhai-mark.png';
import {
  buildGoogleOAuthRedirectUrl,
  forgetRecentGoogleAccount,
  loadGoogleIdentityScript,
  loadRecentGoogleAccounts,
  type RecentGoogleAccount,
} from '../../services/authService';

export interface AuthNoticeState {
  kind: 'pending_approval' | 'access_denied';
  email?: string;
  message: string;
}

export type AuthViewKind =
  | 'login'
  | 'google_auth'
  | 'auth_callback'
  | 'pending_approval'
  | 'access_denied';

interface AuthGateProps {
  routeKind?: AuthViewKind;
  isLiveBackend: boolean;
  googleClientId: string;
  onNavigate?: (path: string, replace?: boolean) => void;
  onGoogleTokenSuccess: (idToken: string) => Promise<void>;
  onEmailSignIn: (email: string) => Promise<void>;
  authNotice: AuthNoticeState | null;
  onResetAuthNotice?: () => void;
  oauthProcessing?: boolean;
  oauthError?: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GoogleEmblem: React.FC<{ className?: string }> = ({ className = 'w-4 h-4 shrink-0' }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
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
);

function getInitials(name: string, email: string): string {
  const source = (name || email).trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase() || 'VV';
}

export const AuthGate: React.FC<AuthGateProps> = ({
  routeKind = 'login',
  isLiveBackend,
  googleClientId,
  onNavigate,
  onGoogleTokenSuccess,
  onEmailSignIn,
  authNotice,
  onResetAuthNotice,
  oauthProcessing = false,
  oauthError = null,
}) => {
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const loginEmailRef = useRef<HTMLInputElement>(null);
  const googleEmailRef = useRef<HTMLInputElement>(null);
  const googleHeadingRef = useRef<HTMLHeadingElement>(null);
  const loginHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousViewRef = useRef<AuthViewKind>(routeKind);
  const focusGoogleEmailOnOpenRef = useRef(false);

  const [gisReady, setGisReady] = useState(false);
  const [gisLoadError, setGisLoadError] = useState<string | null>(null);

  const [workspaceEmail, setWorkspaceEmail] = useState('');
  const [workspaceTouched, setWorkspaceTouched] = useState(false);
  const [workspaceSubmitted, setWorkspaceSubmitted] = useState(false);

  const [googleEmail, setGoogleEmail] = useState('');
  const [googleTouched, setGoogleTouched] = useState(false);
  const [googleSubmitted, setGoogleSubmitted] = useState(false);

  const [recentAccounts, setRecentAccounts] = useState<RecentGoogleAccount[]>(() =>
    loadRecentGoogleAccounts(),
  );
  const [showAnotherAccountForm, setShowAnotherAccountForm] = useState<boolean>(
    () => loadRecentGoogleAccounts().length === 0,
  );

  const [verifyingAccountEmail, setVerifyingAccountEmail] = useState<string | null>(null);
  const [verificationStep, setVerificationStep] = useState<
    'idle' | 'authenticating' | 'redirecting'
  >('idle');

  const navigate = (path: string, replace = false) => {
    if (onNavigate) {
      onNavigate(path, replace);
    } else if (typeof window !== 'undefined') {
      if (replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
    }
  };

  const activeView: AuthViewKind =
    authNotice?.kind === 'pending_approval'
      ? 'pending_approval'
      : authNotice?.kind === 'access_denied'
        ? 'access_denied'
        : routeKind;

  useEffect(() => {
    setRecentAccounts(loadRecentGoogleAccounts());
  }, [activeView]);

  // Move keyboard/screen-reader focus synchronously when transitioning between dedicated auth views
  useEffect(() => {
    if (previousViewRef.current === activeView) return;
    previousViewRef.current = activeView;
    if (activeView === 'google_auth') {
      setShowAnotherAccountForm(loadRecentGoogleAccounts().length === 0);
      setGoogleTouched(false);
      setGoogleSubmitted(false);
      googleHeadingRef.current?.focus();
    } else if (activeView === 'login') {
      setWorkspaceTouched(false);
      setWorkspaceSubmitted(false);
      loginHeadingRef.current?.focus();
    }
  }, [activeView]);

  useEffect(() => {
    if (showAnotherAccountForm && focusGoogleEmailOnOpenRef.current) {
      focusGoogleEmailOnOpenRef.current = false;
      googleEmailRef.current?.focus();
    }
  }, [showAnotherAccountForm]);

  useEffect(() => {
    if (activeView !== 'google_auth' || !isLiveBackend || !googleClientId || authNotice) return;
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
              setVerificationStep('authenticating');
              void onGoogleTokenSuccess(response.credential).finally(() => {
                setVerificationStep('idle');
              });
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
        if (active) {
          setGisLoadError(err instanceof Error ? err.message : 'Unable to load Google Sign-In');
        }
      });

    return () => {
      active = false;
    };
  }, [activeView, authNotice, googleClientId, isLiveBackend, onGoogleTokenSuccess]);

  const executeVerifiedSignIn = async (cleanEmail: string) => {
    setVerifyingAccountEmail(cleanEmail);
    setVerificationStep('authenticating');
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      setVerificationStep('redirecting');
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      await onEmailSignIn(cleanEmail);
    } finally {
      setVerificationStep('idle');
      setVerifyingAccountEmail(null);
    }
  };

  const openDedicatedGoogleAuth = () => {
    const cleanWorkspace = workspaceEmail.trim();
    if (EMAIL_PATTERN.test(cleanWorkspace) && !googleEmail.trim()) {
      setGoogleEmail(cleanWorkspace);
    }
    navigate('/auth/google');
  };

  const handleWorkspaceEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWorkspaceSubmitted(true);
    const cleanEmail = workspaceEmail.trim();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      loginEmailRef.current?.focus();
      return;
    }
    if (isLiveBackend) {
      openDedicatedGoogleAuth();
      return;
    }
    await executeVerifiedSignIn(cleanEmail);
  };

  const handleGoogleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGoogleSubmitted(true);
    const cleanEmail = googleEmail.trim();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      googleEmailRef.current?.focus();
      return;
    }
    await executeVerifiedSignIn(cleanEmail);
  };

  const handleLiveGoogleOAuthRedirect = () => {
    if (!googleClientId) return;
    setVerificationStep('redirecting');
    window.location.assign(buildGoogleOAuthRedirectUrl(googleClientId));
  };

  const handleForgetAccount = (targetEmail: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = forgetRecentGoogleAccount(targetEmail);
    setRecentAccounts(updated);
    if (updated.length === 0) {
      setShowAnotherAccountForm(true);
    }
  };

  const workspaceClean = workspaceEmail.trim();
  const workspaceError =
    (workspaceTouched || workspaceSubmitted) && !EMAIL_PATTERN.test(workspaceClean)
      ? 'Enter a valid email address in the format name@example.org.'
      : null;

  const googleClean = googleEmail.trim();
  const googleError =
    (googleTouched || googleSubmitted) && !EMAIL_PATTERN.test(googleClean)
      ? 'Enter a valid Google email address in the format name@gmail.com.'
      : null;

  const isAuthenticating = verificationStep !== 'idle' || oauthProcessing;

  return (
    <div className="ct-auth-stage relative min-h-dvh flex flex-col justify-between p-4 sm:p-6 overflow-x-clip">
      {/* Sweeping concentric orbital hairline rings */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 flex items-center justify-center overflow-hidden"
      >
        <div className="w-[480px] h-[480px] rounded-full border border-[#FFFFFF]/85" />
        <div className="absolute w-[740px] h-[740px] rounded-full border border-[#1EA7FF]/[0.20]" />
        <div className="absolute w-[1040px] h-[1040px] rounded-full border border-[#0A1B2C]/[0.06]" />
      </div>

      {/* Consistent top brand bar matching the authenticated header aesthetic */}
      <header className="relative z-10 w-full max-w-[1040px] mx-auto flex items-center justify-between gap-3 pt-1 pb-4">
        <div className="flex items-center gap-2.5 min-w-0">
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
        <div className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-3 py-1 bg-[#FFFFFF]/90 border border-[#C7BEA7] text-xs font-medium text-[#243647] shrink-0">
          <ShieldCheck className="w-3.5 h-3.5 text-[#006BB8]" aria-hidden="true" />
          <span>{isLiveBackend ? 'Google Workspace SSO' : 'Authorized Workspace'}</span>
        </div>
      </header>

      <main className="relative z-10 w-full flex-1 flex items-center justify-center py-2 sm:py-6">
        {activeView === 'pending_approval' ? (
          <section
            aria-labelledby="pending-heading"
            className="ct-auth-card w-full max-w-[440px] p-7 sm:p-8 flex flex-col gap-5"
          >
            <div className="flex justify-center">
              <img
                src={vidhyaVidhaiLogo}
                alt="Vidhya Vidhai Foundation — Educate, Innovate, Lead"
                width={824}
                height={176}
                decoding="sync"
                className="w-[210px] sm:w-[236px] h-auto object-contain select-none"
              />
            </div>
            <div
              role="status"
              className="p-4 rounded-2xl bg-[#FFFBEB] border border-[#B45309]/40 text-sm text-[#0A1B2C] flex flex-col gap-3"
            >
              <div className="flex items-start gap-2.5">
                <Clock className="w-5 h-5 text-[#B45309] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h1 id="pending-heading" className="text-base font-medium text-[#0A1B2C]">
                    Account Pending Approval
                  </h1>
                  <p className="text-xs sm:text-sm text-[#243647] mt-1 leading-relaxed">
                    {authNotice?.message ||
                      'Your account request is awaiting confirmation by a Programme Administrator.'}
                  </p>
                  {authNotice?.email && (
                    <p className="text-xs font-mono text-[#92400E] mt-1.5">{authNotice.email}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onResetAuthNotice?.();
                  navigate('/auth/google', true);
                }}
                className="ct-btn-secondary w-full justify-center text-sm rounded-xl"
              >
                Sign in with a different Google account
              </button>
            </div>
          </section>
        ) : activeView === 'access_denied' ? (
          <section
            aria-labelledby="denied-heading"
            className="ct-auth-card w-full max-w-[440px] p-7 sm:p-8 flex flex-col gap-5"
          >
            <div className="flex justify-center">
              <img
                src={vidhyaVidhaiLogo}
                alt="Vidhya Vidhai Foundation — Educate, Innovate, Lead"
                width={824}
                height={176}
                decoding="sync"
                className="w-[210px] sm:w-[236px] h-auto object-contain select-none"
              />
            </div>
            <div
              role="alert"
              className="p-4 rounded-2xl bg-[#FFF1F2] border border-[#BE123C]/40 text-sm text-[#0A1B2C] flex flex-col gap-3"
            >
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-5 h-5 text-[#BE123C] shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h1 id="denied-heading" className="text-base font-medium text-[#0A1B2C]">
                    Access Denied
                  </h1>
                  <p className="text-xs sm:text-sm text-[#243647] mt-1 leading-relaxed">
                    {authNotice?.message ||
                      'Your Google account is not currently authorized for this workspace. Contact an Administrator for access.'}
                  </p>
                  {authNotice?.email && (
                    <p className="text-xs font-mono text-[#BE123C] mt-1.5">{authNotice.email}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onResetAuthNotice?.();
                    navigate('/auth/google', true);
                  }}
                  className="ct-btn-secondary flex-1 justify-center text-sm rounded-xl"
                >
                  Try a different Google account
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onResetAuthNotice?.();
                    navigate('/login', true);
                  }}
                  className="ct-btn-secondary justify-center text-sm rounded-xl"
                >
                  Back to sign-in
                </button>
              </div>
            </div>
          </section>
        ) : activeView === 'google_auth' || activeView === 'auth_callback' ? (
          /* Dedicated Full-Page Google SSO Authentication Experience (/auth/google & /auth/callback) */
          <section
            aria-labelledby="google-auth-heading"
            className="ct-auth-card w-full max-w-[468px] p-7 sm:p-9 flex flex-col gap-5"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 -ml-2.5 rounded-lg text-xs font-medium text-[#243647] hover:text-[#0A1B2C] hover:bg-[#EFE8D6]/80 cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Back to sign-in</span>
              </button>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E8F6FF] border border-[#0284C7]/45 text-xs font-medium text-[#006BB8]">
                <GoogleEmblem className="w-3.5 h-3.5" />
                <span>{isLiveBackend ? 'OAuth 2.0 Verified' : 'Google Account SSO'}</span>
              </span>
            </div>

            <div className="flex flex-col items-center text-center pt-1">
              <div className="inline-flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-[#F5F2E9] border border-[#DFD7C2] mb-4">
                <img
                  src={vidhyaVidhaiMark}
                  alt="Vidhya Vidhai Foundation"
                  width={230}
                  height={230}
                  className="w-7 h-7 object-contain select-none"
                />
                <span className="w-px h-5 bg-[#C7BEA7]" aria-hidden="true" />
                <GoogleEmblem className="w-6 h-6" />
              </div>

              <h1
                ref={googleHeadingRef}
                tabIndex={-1}
                id="google-auth-heading"
                className="text-xl sm:text-2xl font-medium text-[#0A1B2C] tracking-tight outline-none"
              >
                {activeView === 'auth_callback'
                  ? 'Completing Google Sign-In'
                  : 'Sign in with Google'}
              </h1>
              <p className="text-xs sm:text-[13px] text-[#243647] mt-1.5 leading-relaxed">
                Continue to{' '}
                <span className="font-medium text-[#0A1B2C] whitespace-nowrap">
                  Vidhya Vidhai Foundation
                </span>{' '}
                ·{' '}
                <span className="font-medium text-[#006BB8] whitespace-nowrap">Career Tours</span>
              </p>
            </div>

            {oauthError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{oauthError}</span>
              </div>
            )}

            {isAuthenticating ? (
              <div
                role="status"
                aria-live="polite"
                className="p-5 rounded-2xl bg-[#F5F2E9] border border-[#DFD7C2] flex flex-col items-center text-center gap-4"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#FFFFFF] border border-[#0284C7]/45 shadow-xs flex items-center justify-center text-[#006BB8]">
                  <Loader2 className="w-6 h-6 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[#0A1B2C]">
                    {verificationStep === 'redirecting'
                      ? 'Redirecting to your workspace...'
                      : 'Verifying Google account permissions...'}
                  </p>
                  {verifyingAccountEmail && (
                    <p className="text-xs font-mono text-[#243647]">{verifyingAccountEmail}</p>
                  )}
                </div>
                <ol className="w-full text-left space-y-2 text-xs text-[#243647] pt-1 border-t border-[#DFD7C2]">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#047857] shrink-0" aria-hidden="true" />
                    <span>Identity validated for Career Tours portal</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 shrink-0 ${
                        verificationStep === 'redirecting' ? 'text-[#047857]' : 'text-[#006BB8]'
                      }`}
                      aria-hidden="true"
                    />
                    <span>
                      {verificationStep === 'redirecting'
                        ? 'Opening authorized dashboard view'
                        : 'Resolving Facilitator / Programme Admin access'}
                    </span>
                  </li>
                </ol>
              </div>
            ) : isLiveBackend ? (
              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={handleLiveGoogleOAuthRedirect}
                  className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center gap-2.5 cursor-pointer transition-colors"
                >
                  <GoogleEmblem className="w-4 h-4 bg-white rounded-full p-0.5" />
                  <span>Sign In with Google Account Chooser</span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>

                <div className="relative flex items-center gap-3">
                  <div className="flex-1 border-t border-dotted border-[#C7BEA7]" aria-hidden="true" />
                  <span className="text-xs text-[#33475B] shrink-0">Or quick Google Sign-In</span>
                  <div className="flex-1 border-t border-dotted border-[#C7BEA7]" aria-hidden="true" />
                </div>

                <div className="flex flex-col items-center gap-2">
                  <div ref={buttonContainerRef} className="min-h-[44px] flex items-center justify-center" />
                  {!gisReady && !gisLoadError && (
                    <p className="text-xs text-[#33475B]">Preparing Google Sign-In button...</p>
                  )}
                  {gisLoadError && (
                    <p className="text-xs text-[#BE123C] text-center">{gisLoadError}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {recentAccounts.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h2 className="text-xs font-medium text-[#243647]">
                      Choose a recently signed-in account
                    </h2>
                    <div className="flex flex-col gap-2">
                      {recentAccounts.map((acc) => (
                        <div
                          key={acc.email}
                          className="group relative flex items-center rounded-xl border border-[#C7BEA7] bg-[#FFFFFF] hover:border-[#0284C7] hover:bg-[#F5F2E9] transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => void executeVerifiedSignIn(acc.email)}
                            className="flex-1 min-w-0 min-h-[54px] px-3.5 py-2.5 flex items-center gap-3 text-left cursor-pointer rounded-l-xl"
                          >
                            <span
                              aria-hidden="true"
                              className="w-9 h-9 rounded-full bg-[#0A1B2C] text-[#FAF8F2] text-xs font-medium flex items-center justify-center shrink-0"
                            >
                              {getInitials(acc.name, acc.email)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-[#0A1B2C] truncate">
                                {acc.name}
                              </span>
                              <span className="block text-xs text-[#243647] truncate">{acc.email}</span>
                            </span>
                            <ArrowRight
                              className="w-4 h-4 text-[#006BB8] shrink-0"
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove saved account ${acc.email}`}
                            onClick={(e) => handleForgetAccount(acc.email, e)}
                            className="mr-2 w-8 h-8 rounded-lg flex items-center justify-center text-[#33475B] hover:text-[#BE123C] hover:bg-[#FFF1F2] cursor-pointer transition-colors shrink-0"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {!showAnotherAccountForm && (
                      <button
                        type="button"
                        onClick={() => {
                          focusGoogleEmailOnOpenRef.current = true;
                          setShowAnotherAccountForm(true);
                        }}
                        className="ct-btn-secondary w-full justify-center text-sm rounded-xl mt-1"
                      >
                        <UserPlus className="w-4 h-4 text-[#006BB8]" aria-hidden="true" />
                        <span>Use another Google account</span>
                      </button>
                    )}
                  </div>
                )}

                {showAnotherAccountForm && (
                  <form
                    onSubmit={(e) => void handleGoogleAccountSubmit(e)}
                    noValidate
                    className="flex flex-col gap-3.5"
                  >
                    <div className="flex flex-col gap-1.5">
                      <label
                        htmlFor="google-account-email"
                        className="text-xs font-medium text-[#0A1B2C]"
                      >
                        Google account email <span aria-hidden="true">*</span>
                      </label>
                      <span id="google-email-hint" className="text-xs text-[#33475B]">
                        Format: you@vidhyavidhai.org or your approved Gmail address.
                      </span>
                      <div className="relative">
                        <Mail
                          className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          ref={googleEmailRef}
                          id="google-account-email"
                          name="email"
                          type="email"
                          required
                          autoComplete="email"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          enterKeyHint="done"
                          placeholder="name@vidhyavidhai.org"
                          value={googleEmail}
                          onChange={(e) => setGoogleEmail(e.target.value)}
                          onBlur={() => setGoogleTouched(true)}
                          aria-invalid={Boolean(googleError)}
                          aria-describedby={
                            googleError ? 'google-email-hint google-email-error' : 'google-email-hint'
                          }
                          className="ct-input pl-10 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                        />
                      </div>
                      {googleError && (
                        <div
                          id="google-email-error"
                          role="alert"
                          className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                        >
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{googleError}</span>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <GoogleEmblem className="w-4 h-4 bg-white rounded-full p-0.5" />
                      <span>Verify &amp; Sign In</span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </form>
                )}

                <div className="rounded-xl px-3.5 py-2.5 bg-[#F5F2E9] border border-[#DFD7C2] text-xs leading-relaxed text-[#243647]">
                  <span className="font-medium text-[#0A1B2C]">Authorized Workspace Access:</span>{' '}
                  Only Vidhya Vidhai accounts approved by your Programme Administrator can access Classroom Entry or Programme Analytics.
                </div>
              </div>
            )}
          </section>
        ) : (
          /* Primary Dedicated Portal Entry Experience (/login & /) */
          <div className="w-full max-w-[920px] grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-[auto_auto] gap-x-8 gap-y-5 items-center">
            {/* Brand & Portal Summary */}
            <section
              aria-labelledby="portal-heading"
              className="lg:col-span-6 lg:col-start-1 lg:row-start-1 lg:self-end flex flex-col gap-3.5 text-center lg:text-left items-center lg:items-start px-1 sm:px-3"
            >
              <img
                src={vidhyaVidhaiLogo}
                alt="Vidhya Vidhai Foundation — Educate, Innovate, Lead"
                width={824}
                height={176}
                fetchPriority="high"
                decoding="sync"
                className="w-[210px] sm:w-[260px] h-auto object-contain select-none"
              />

              <div className="space-y-2 max-w-[46ch]">
                <h1
                  ref={loginHeadingRef}
                  tabIndex={-1}
                  id="portal-heading"
                  className="text-2xl sm:text-[1.85rem] leading-tight font-medium text-[#0A1B2C] tracking-tight outline-none"
                >
                  Career Tours Classroom Portal
                </h1>
                <p className="text-sm text-[#243647] leading-relaxed">
                  Dedicated sign-in for facilitators recording classroom sessions and programme leads managing school reports across Tamil Nadu.
                </p>
              </div>
            </section>

            {/* Primary Authentication Action Card — 2nd on mobile (above fold), right column on desktop */}
            <section
              aria-labelledby="auth-card-heading"
              className="lg:col-span-6 lg:col-start-7 lg:row-start-1 lg:row-span-2 w-full max-w-[432px] mx-auto ct-auth-card p-6 sm:p-8 flex flex-col gap-5"
            >
              <div className="space-y-1">
                <h2
                  id="auth-card-heading"
                  className="text-xl font-medium text-[#0A1B2C] tracking-tight"
                >
                  Sign in to your workspace
                </h2>
                <p className="text-xs sm:text-[13px] text-[#243647] leading-relaxed">
                  Authenticate securely with Google SSO or continue with your authorized Vidhya Vidhai email.
                </p>
              </div>

              {isAuthenticating ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="p-5 rounded-2xl bg-[#F5F2E9] border border-[#DFD7C2] flex flex-col items-center text-center gap-3"
                >
                  <Loader2
                    className="w-6 h-6 text-[#006BB8] animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-medium text-[#0A1B2C]">
                    {verificationStep === 'redirecting'
                      ? 'Redirecting to your workspace...'
                      : 'Verifying workspace access...'}
                  </p>
                  {verifyingAccountEmail && (
                    <p className="text-xs font-mono text-[#243647]">{verifyingAccountEmail}</p>
                  )}
                </div>
              ) : (
                <>
                  {/* Primary Google Sign-In CTA -> redirects cleanly to dedicated /auth/google experience */}
                  <button
                    type="button"
                    onClick={openDedicatedGoogleAuth}
                    className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-[#FFFFFF] hover:bg-[#F5F2E9] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] text-sm font-medium inline-flex items-center justify-between gap-3 ct-interactive-tile shadow-xs cursor-pointer transition-colors"
                  >
                    <span className="inline-flex items-center gap-2.5">
                      <GoogleEmblem className="w-4 h-4" />
                      <span>Continue with Google</span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-[#006BB8] shrink-0" aria-hidden="true" />
                  </button>

                  <div className="relative flex items-center gap-3">
                    <div className="flex-1 border-t border-dotted border-[#C7BEA7]" aria-hidden="true" />
                    <span className="text-xs text-[#33475B] shrink-0">
                      Or continue with workspace email
                    </span>
                    <div className="flex-1 border-t border-dotted border-[#C7BEA7]" aria-hidden="true" />
                  </div>

                  <form
                    onSubmit={(e) => void handleWorkspaceEmailSubmit(e)}
                    noValidate
                    className="flex flex-col gap-3.5"
                  >
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="login-email" className="text-xs font-medium text-[#0A1B2C]">
                        Email <span aria-hidden="true">*</span>
                      </label>
                      <span id="workspace-email-hint" className="text-xs text-[#33475B]">
                        Format: name@vidhyavidhai.org
                      </span>
                      <div className="relative">
                        <Mail
                          className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          ref={loginEmailRef}
                          id="login-email"
                          name="email"
                          type="email"
                          required
                          autoComplete="username"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          enterKeyHint="done"
                          placeholder="name@vidhyavidhai.org"
                          value={workspaceEmail}
                          onChange={(e) => setWorkspaceEmail(e.target.value)}
                          onBlur={() => setWorkspaceTouched(true)}
                          aria-invalid={Boolean(workspaceError)}
                          aria-describedby={
                            workspaceError
                              ? 'workspace-email-hint workspace-email-error'
                              : 'workspace-email-hint'
                          }
                          className="ct-input pl-10 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                        />
                      </div>
                      {workspaceError && (
                        <div
                          id="workspace-email-error"
                          role="alert"
                          className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                        >
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                          <span>{workspaceError}</span>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      <span>{isLiveBackend ? 'Sign In with Google' : 'Sign In'}</span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </form>
                </>
              )}
            </section>

            {/* Programme Capabilities Summary — bottom-left on desktop, below fold on mobile */}
            <div className="lg:col-span-6 lg:col-start-1 lg:row-start-2 lg:self-start w-full max-w-[432px] lg:max-w-none mx-auto grid grid-cols-1 gap-2.5 text-left px-1 sm:px-3">
              <div className="flex items-start gap-3 rounded-xl px-3.5 py-3 bg-[#FFFFFF]/85 border border-[#DFD7C2] shadow-2xs">
                <div className="w-8 h-8 rounded-lg bg-[#E8F6FF] border border-[#0284C7]/35 flex items-center justify-center text-[#006BB8] shrink-0">
                  <ClipboardCheck className="w-4 h-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#0A1B2C]">Facilitator Session Entry</p>
                  <p className="text-xs text-[#243647] mt-0.5">
                    Log Career Tour classes with automated CSAT, ITP, Teacher NPS, and Session ID tracking.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl px-3.5 py-3 bg-[#FFFFFF]/85 border border-[#DFD7C2] shadow-2xs">
                <div className="w-8 h-8 rounded-lg bg-[#F5F2E9] border border-[#C7BEA7] flex items-center justify-center text-[#0A1B2C] shrink-0">
                  <BarChart3 className="w-4 h-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-xs font-medium text-[#0A1B2C]">Role-Scoped Programme Console</p>
                  <p className="text-xs text-[#243647] mt-0.5">
                    Redirects authorized accounts directly into Classroom Entry or Programme Analytics after verification.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 py-3 text-center">
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
