import React, { useEffect, useId, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react';
import vidhyaVidhaiLogo from '../../assets/vidhya-vidhai-logo.png';
import vidhyaVidhaiMark from '../../assets/vidhya-vidhai-mark.png';
import { isAllowlistedSuperAdmin, normalizeEmail } from '../../config/accessControl';
import {
  buildGoogleOAuthRedirectUrl,
  forgetRecentGoogleAccount,
  loadGoogleIdentityScript,
  loadRecentGoogleAccounts,
  parseTeamSetupFromLocation,
  RECENT_GOOGLE_ACCOUNTS_KEY,
  type RecentGoogleAccount,
} from '../../services/authService';

export interface AuthNoticeState {
  kind: 'pending_approval' | 'access_denied';
  email?: string;
  message: string;
}

export interface EmailSignInOutcome {
  ok: boolean;
  code?: string;
  error?: string;
}

export type AuthViewKind =
  | 'login'
  | 'google_auth'
  | 'auth_callback'
  | 'pending_approval'
  | 'access_denied'
  | 'restoring'
  | 'reset_password';

interface AuthGateProps {
  routeKind?: AuthViewKind;
  isLiveBackend: boolean;
  isSupabaseMode?: boolean;
  supabaseGoogleOAuthEnabled?: boolean;
  googleClientId: string;
  isTeamIntakeConnected?: boolean;
  teamIntakeLabel?: string;
  onTeamIntakeConfigured?: () => void;
  onNavigate?: (path: string, replace?: boolean) => void;
  onGoogleTokenSuccess: (idToken: string) => Promise<void>;
  onEmailSignIn: (
    email: string,
    options?: { password?: string; resumeToken?: string },
  ) => Promise<EmailSignInOutcome>;
  onSupabaseGoogleOAuth?: () => Promise<void>;
  onSupabasePasswordSignIn?: (email: string, password: string) => Promise<EmailSignInOutcome>;
  onSupabaseSignUp?: (
    fullName: string,
    email: string,
    password: string,
  ) => Promise<
    EmailSignInOutcome & { requiresEmailConfirmation?: boolean; statusMessage?: string }
  >;
  onSupabaseForgotPassword?: (email: string) => Promise<{ ok: boolean; error?: string }>;
  onSupabaseUpdatePassword?: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  onSignOutNoticeAccount?: () => Promise<void> | void;
  authNotice: AuthNoticeState | null;
  onResetAuthNotice?: () => void;
  oauthProcessing?: boolean;
  oauthError?: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function evaluatePasswordStrength(pw: string) {
  return {
    minLength: pw.length >= 8,
    hasUpper: /[A-Z]/.test(pw),
    hasLower: /[a-z]/.test(pw),
    hasDigit: /\d/.test(pw),
  };
}

function isStrongPassword(pw: string): boolean {
  const s = evaluatePasswordStrength(pw);
  return s.minLength && s.hasUpper && s.hasLower && s.hasDigit;
}

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
  isSupabaseMode = false,
  supabaseGoogleOAuthEnabled = false,
  googleClientId,
  isTeamIntakeConnected = false,
  teamIntakeLabel,
  onTeamIntakeConfigured,
  onNavigate,
  onGoogleTokenSuccess,
  onEmailSignIn,
  onSupabaseGoogleOAuth,
  onSupabasePasswordSignIn,
  onSupabaseSignUp,
  onSupabaseForgotPassword,
  onSupabaseUpdatePassword,
  onSignOutNoticeAccount,
  authNotice,
  onResetAuthNotice,
  oauthProcessing = false,
  oauthError = null,
}) => {
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const loginEmailRef = useRef<HTMLInputElement>(null);
  const loginPasswordRef = useRef<HTMLInputElement>(null);
  const signupNameRef = useRef<HTMLInputElement>(null);
  const signupEmailRef = useRef<HTMLInputElement>(null);
  const signupPasswordRef = useRef<HTMLInputElement>(null);
  const forgotEmailRef = useRef<HTMLInputElement>(null);
  const resetPasswordRef = useRef<HTMLInputElement>(null);
  const resetHeadingRef = useRef<HTMLHeadingElement>(null);
  const authCardHeadingRef = useRef<HTMLHeadingElement>(null);
  const googleEmailRef = useRef<HTMLInputElement>(null);
  const googlePasswordRef = useRef<HTMLInputElement>(null);
  const savedAdminPasswordRef = useRef<HTMLInputElement>(null);
  const teamLinkInputRef = useRef<HTMLInputElement>(null);
  const googleHeadingRef = useRef<HTMLHeadingElement>(null);
  const loginHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousViewRef = useRef<AuthViewKind>(routeKind);
  const focusGoogleEmailOnOpenRef = useRef(false);
  const liveAnnounceTimerRef = useRef<number | null>(null);
  const teamLinkId = useId();
  const teamLinkHintId = useId();
  const teamLinkErrId = useId();
  const teamLinkPanelId = useId();

  const [supabasePanelMode, setSupabasePanelMode] = useState<
    'sign_in' | 'sign_up' | 'forgot_password'
  >('sign_in');
  const [googleOAuthBusy, setGoogleOAuthBusy] = useState(false);

  // Sign-Up state (Supabase mode)
  const [signupFullName, setSignupFullName] = useState('');
  const [signupNameTouched, setSignupNameTouched] = useState(false);
  const [signupEmail, setSignupEmail] = useState('');
  const [signupEmailTouched, setSignupEmailTouched] = useState(false);
  const [signupPassword, setSignupPassword] = useState('');
  const [signupPasswordTouched, setSignupPasswordTouched] = useState(false);
  const [signupSubmitted, setSignupSubmitted] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [signupSubmitting, setSignupSubmitting] = useState(false);
  const [signupServerError, setSignupServerError] = useState<string | null>(null);
  const [signupStatusMessage, setSignupStatusMessage] = useState<string | null>(null);

  // Forgot Password state (Supabase mode)
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotEmailTouched, setForgotEmailTouched] = useState(false);
  const [forgotSubmitted, setForgotSubmitted] = useState(false);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotServerError, setForgotServerError] = useState<string | null>(null);
  const [forgotSuccessMessage, setForgotSuccessMessage] = useState<string | null>(null);

  // Reset Password (/auth/reset-password) state
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetPasswordTouched, setResetPasswordTouched] = useState(false);
  const [resetSubmitted, setResetSubmitted] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetServerError, setResetServerError] = useState<string | null>(null);
  const [resetSuccessMessage, setResetSuccessMessage] = useState<string | null>(null);

  const [gisReady, setGisReady] = useState(false);
  const [gisLoadError, setGisLoadError] = useState<string | null>(null);
  const [teamLinkOpen, setTeamLinkOpen] = useState(false);
  const [teamLinkValue, setTeamLinkValue] = useState('');
  const [teamLinkError, setTeamLinkError] = useState('');
  const [teamLinkSuccess, setTeamLinkSuccess] = useState('');

  const [workspaceEmail, setWorkspaceEmail] = useState('');
  const [workspaceTouched, setWorkspaceTouched] = useState(false);
  const [workspaceSubmitted, setWorkspaceSubmitted] = useState(false);
  const [workspacePassword, setWorkspacePassword] = useState('');
  const [workspacePasswordTouched, setWorkspacePasswordTouched] = useState(false);
  const [workspacePasswordSubmitted, setWorkspacePasswordSubmitted] = useState(false);
  const [workspaceServerPasswordError, setWorkspaceServerPasswordError] = useState<string | null>(null);
  const [showWorkspacePassword, setShowWorkspacePassword] = useState(false);
  const [workspaceSubmitting, setWorkspaceSubmitting] = useState(false);

  const [googleEmail, setGoogleEmail] = useState('');
  const [googleTouched, setGoogleTouched] = useState(false);
  const [googleSubmitted, setGoogleSubmitted] = useState(false);
  const [googlePassword, setGooglePassword] = useState('');
  const [googlePasswordTouched, setGooglePasswordTouched] = useState(false);
  const [googlePasswordSubmitted, setGooglePasswordSubmitted] = useState(false);
  const [googleServerPasswordError, setGoogleServerPasswordError] = useState<string | null>(null);
  const [showGooglePassword, setShowGooglePassword] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  const [selectedSavedAdmin, setSelectedSavedAdmin] = useState<RecentGoogleAccount | null>(null);
  const [savedAdminPassword, setSavedAdminPassword] = useState('');
  const [savedAdminPasswordTouched, setSavedAdminPasswordTouched] = useState(false);
  const [savedAdminPasswordSubmitted, setSavedAdminPasswordSubmitted] = useState(false);
  const [savedAdminServerError, setSavedAdminServerError] = useState<string | null>(null);
  const [showSavedAdminPassword, setShowSavedAdminPassword] = useState(false);
  const [savedAdminSubmitting, setSavedAdminSubmitting] = useState(false);

  const [liveErrorAnnouncement, setLiveErrorAnnouncement] = useState('');

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

  const scheduleLiveAnnouncement = (message: string, delayMs = 0) => {
    if (typeof window === 'undefined') return;
    if (liveAnnounceTimerRef.current !== null) {
      window.clearTimeout(liveAnnounceTimerRef.current);
      liveAnnounceTimerRef.current = null;
    }
    setLiveErrorAnnouncement('');
    if (!message) return;
    if (delayMs <= 0) {
      setLiveErrorAnnouncement(message);
      return;
    }
    liveAnnounceTimerRef.current = window.setTimeout(() => {
      setLiveErrorAnnouncement(message);
    }, delayMs);
  };

  useEffect(() => {
    return () => {
      if (liveAnnounceTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(liveAnnounceTimerRef.current);
      }
    };
  }, []);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorage = (e: StorageEvent) => {
      if (!e.key || e.key === RECENT_GOOGLE_ACCOUNTS_KEY) {
        const latest = loadRecentGoogleAccounts();
        setRecentAccounts(latest);
        if (latest.length === 0) {
          setShowAnotherAccountForm(true);
        }
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Move keyboard/screen-reader focus synchronously when transitioning between dedicated auth views
  useEffect(() => {
    if (previousViewRef.current === activeView) return;
    previousViewRef.current = activeView;
    setSelectedSavedAdmin(null);
    setSavedAdminPassword('');
    setSavedAdminPasswordTouched(false);
    setSavedAdminPasswordSubmitted(false);
    setSavedAdminServerError(null);
    setShowSavedAdminPassword(false);
    scheduleLiveAnnouncement('');
    if (activeView === 'google_auth') {
      setShowAnotherAccountForm(loadRecentGoogleAccounts().length === 0);
      setGoogleTouched(false);
      setGoogleSubmitted(false);
      setGooglePassword('');
      setGooglePasswordTouched(false);
      setGooglePasswordSubmitted(false);
      setGoogleServerPasswordError(null);
      setShowGooglePassword(false);
      googleHeadingRef.current?.focus();
    } else if (activeView === 'login') {
      setWorkspaceTouched(false);
      setWorkspaceSubmitted(false);
      setWorkspacePassword('');
      setWorkspacePasswordTouched(false);
      setWorkspacePasswordSubmitted(false);
      setWorkspaceServerPasswordError(null);
      setShowWorkspacePassword(false);
      setSupabasePanelMode('sign_in');
      loginHeadingRef.current?.focus();
    } else if (activeView === 'reset_password') {
      setResetNewPassword('');
      setResetPasswordTouched(false);
      setResetSubmitted(false);
      setShowResetPassword(false);
      setResetServerError(null);
      setResetSuccessMessage(null);
      resetHeadingRef.current?.focus();
    }
  }, [activeView]);

  useEffect(() => {
    if (showAnotherAccountForm && focusGoogleEmailOnOpenRef.current) {
      focusGoogleEmailOnOpenRef.current = false;
      googleEmailRef.current?.focus();
    }
  }, [showAnotherAccountForm]);

  useEffect(() => {
    if (selectedSavedAdmin) {
      savedAdminPasswordRef.current?.focus();
    }
  }, [selectedSavedAdmin?.email]);

  useEffect(() => {
    if (
      activeView !== 'google_auth' ||
      isSupabaseMode ||
      !isLiveBackend ||
      !googleClientId ||
      authNotice
    ) {
      return;
    }
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
    if (isSupabaseMode && onSupabaseGoogleOAuth) {
      setGoogleOAuthBusy(true);
      void onSupabaseGoogleOAuth().finally(() => {
        setGoogleOAuthBusy(false);
      });
      return;
    }
    const cleanWorkspace = workspaceEmail.trim();
    if (EMAIL_PATTERN.test(cleanWorkspace) && !googleEmail.trim()) {
      setGoogleEmail(cleanWorkspace);
    }
    navigate('/auth/google');
  };

  const handleWorkspaceEmailChange = (nextEmail: string) => {
    const prevNormalized = normalizeEmail(workspaceEmail);
    const nextNormalized = normalizeEmail(nextEmail);
    setWorkspaceEmail(nextEmail);
    setWorkspaceTouched(false);
    setWorkspaceSubmitted(false);
    setWorkspaceServerPasswordError(null);
    scheduleLiveAnnouncement('');
    if (!isLiveBackend && !isSupabaseMode && isAllowlistedSuperAdmin(nextNormalized)) {
      setSelectedSavedAdmin(null);
    }
    if (!isSupabaseMode && prevNormalized !== nextNormalized) {
      setWorkspacePassword('');
      setWorkspacePasswordTouched(false);
      setWorkspacePasswordSubmitted(false);
      setWorkspaceServerPasswordError(null);
      setShowWorkspacePassword(false);
    }
  };

  const handleGoogleEmailChange = (nextEmail: string) => {
    const prevNormalized = normalizeEmail(googleEmail);
    const nextNormalized = normalizeEmail(nextEmail);
    setGoogleEmail(nextEmail);
    setGoogleTouched(false);
    setGoogleSubmitted(false);
    scheduleLiveAnnouncement('');
    if (!isLiveBackend && !isSupabaseMode && isAllowlistedSuperAdmin(nextNormalized)) {
      setSelectedSavedAdmin(null);
    }
    if (prevNormalized !== nextNormalized) {
      setGooglePassword('');
      setGooglePasswordTouched(false);
      setGooglePasswordSubmitted(false);
      setGoogleServerPasswordError(null);
      setShowGooglePassword(false);
    }
  };

  const handleWorkspaceEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWorkspaceSubmitted(true);
    const cleanEmail = workspaceEmail.trim();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      scheduleLiveAnnouncement(
        'Email: Enter an email address in the format name@example.org.',
        500,
      );
      loginEmailRef.current?.focus();
      return;
    }
    if (isSupabaseMode) {
      setWorkspacePasswordSubmitted(true);
      if (!workspacePassword) {
        scheduleLiveAnnouncement('Password: Enter your password.', 500);
        loginPasswordRef.current?.focus();
        return;
      }
      if (!onSupabasePasswordSignIn) return;
      setWorkspaceSubmitting(true);
      setWorkspaceServerPasswordError(null);
      try {
        const outcome = await onSupabasePasswordSignIn(cleanEmail, workspacePassword);
        if (!outcome.ok && outcome.error) {
          setWorkspaceServerPasswordError(outcome.error);
          scheduleLiveAnnouncement(`Sign in failed: ${outcome.error}`, 500);
          window.setTimeout(() => {
            loginPasswordRef.current?.focus();
          }, 0);
        }
      } finally {
        setWorkspaceSubmitting(false);
      }
      return;
    }
    if (isLiveBackend) {
      openDedicatedGoogleAuth();
      return;
    }
    if (isAllowlistedSuperAdmin(cleanEmail)) {
      setWorkspacePasswordSubmitted(true);
      if (!workspacePassword) {
        scheduleLiveAnnouncement('');
        loginPasswordRef.current?.focus();
        return;
      }
      setWorkspaceSubmitting(true);
      try {
        const outcome = await onEmailSignIn(cleanEmail, { password: workspacePassword });
        if (!outcome.ok && (outcome.code === 'PASSWORD_REQUIRED' || outcome.code === 'INVALID_PASSWORD')) {
          const msg =
            outcome.error || 'Incorrect password. Check your password and try again.';
          setWorkspaceServerPasswordError(msg);
          scheduleLiveAnnouncement(`Password: ${msg}`, 500);
          window.setTimeout(() => {
            loginPasswordRef.current?.focus();
          }, 0);
        }
      } finally {
        setWorkspaceSubmitting(false);
      }
      return;
    }
    await executeVerifiedSignIn(cleanEmail);
  };

  const handleSupabaseSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signupSubmitting) return;
    setSignupSubmitted(true);
    setSignupServerError(null);
    setSignupStatusMessage(null);
    const cleanName = signupFullName.trim();
    const cleanEmail = signupEmail.trim();
    if (!cleanName) {
      scheduleLiveAnnouncement('Full name: Enter your full name.', 500);
      signupNameRef.current?.focus();
      return;
    }
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      scheduleLiveAnnouncement(
        'Email: Enter an email address in the format name@example.org.',
        500,
      );
      signupEmailRef.current?.focus();
      return;
    }
    if (!isStrongPassword(signupPassword)) {
      scheduleLiveAnnouncement(
        'Password: Use at least 8 characters with uppercase, lowercase, and a number.',
        500,
      );
      signupPasswordRef.current?.focus();
      return;
    }
    if (!onSupabaseSignUp || signupSubmitting) return;
    setSignupSubmitting(true);
    try {
      const outcome = await onSupabaseSignUp(cleanName, cleanEmail, signupPassword);
      if (!outcome.ok) {
        const msg = outcome.error || 'Unable to create account.';
        setSignupServerError(msg);
        scheduleLiveAnnouncement(`Sign up failed: ${msg}`, 500);
        return;
      }
      if (outcome.statusMessage) {
        setSignupStatusMessage(outcome.statusMessage);
        scheduleLiveAnnouncement(outcome.statusMessage);
      } else if (outcome.requiresEmailConfirmation) {
        setSignupStatusMessage(
          `Account created for ${cleanEmail}. Check your inbox to confirm your email address, then sign in.`,
        );
        scheduleLiveAnnouncement('Account created. Check your email to confirm your address.');
      }
    } finally {
      setSignupSubmitting(false);
    }
  };

  const handleSupabaseForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotSubmitted(true);
    setForgotServerError(null);
    setForgotSuccessMessage(null);
    const cleanEmail = forgotEmail.trim();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      scheduleLiveAnnouncement(
        'Email: Enter an email address in the format name@example.org.',
        500,
      );
      forgotEmailRef.current?.focus();
      return;
    }
    if (!onSupabaseForgotPassword) return;
    setForgotSubmitting(true);
    try {
      const res = await onSupabaseForgotPassword(cleanEmail);
      if (!res.ok) {
        const msg = res.error || 'Could not send reset link right now.';
        setForgotServerError(msg);
        scheduleLiveAnnouncement(msg, 500);
        return;
      }
      const msg =
        'If an account matches that email address, a password reset link has been sent.';
      setForgotSuccessMessage(msg);
      scheduleLiveAnnouncement(msg);
    } finally {
      setForgotSubmitting(false);
    }
  };

  const handleSupabaseResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetSubmitted(true);
    setResetServerError(null);
    setResetSuccessMessage(null);
    if (!isStrongPassword(resetNewPassword)) {
      scheduleLiveAnnouncement(
        'New password: Use at least 8 characters with uppercase, lowercase, and a number.',
        500,
      );
      resetPasswordRef.current?.focus();
      return;
    }
    if (!onSupabaseUpdatePassword) return;
    setResetSubmitting(true);
    try {
      const res = await onSupabaseUpdatePassword(resetNewPassword);
      if (!res.ok) {
        const msg = res.error || 'Unable to update password. Please request a fresh reset link.';
        setResetServerError(msg);
        scheduleLiveAnnouncement(msg, 500);
        return;
      }
      setResetSuccessMessage('Password updated successfully. Redirecting to your workspace...');
      scheduleLiveAnnouncement('Password updated successfully.');
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleGoogleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGoogleSubmitted(true);
    const cleanEmail = googleEmail.trim();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      scheduleLiveAnnouncement('');
      googleEmailRef.current?.focus();
      return;
    }
    if (!isLiveBackend && isAllowlistedSuperAdmin(cleanEmail)) {
      setGooglePasswordSubmitted(true);
      if (!googlePassword) {
        scheduleLiveAnnouncement('');
        googlePasswordRef.current?.focus();
        return;
      }
      setGoogleSubmitting(true);
      try {
        const outcome = await onEmailSignIn(cleanEmail, { password: googlePassword });
        if (!outcome.ok && (outcome.code === 'PASSWORD_REQUIRED' || outcome.code === 'INVALID_PASSWORD')) {
          const msg =
            outcome.error || 'Incorrect password. Check your password and try again.';
          setGoogleServerPasswordError(msg);
          scheduleLiveAnnouncement(`Password: ${msg}`, 500);
          window.setTimeout(() => {
            googlePasswordRef.current?.focus();
          }, 0);
        }
      } finally {
        setGoogleSubmitting(false);
      }
      return;
    }
    await executeVerifiedSignIn(cleanEmail);
  };

  const handleSavedAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSavedAdmin) return;
    setSavedAdminPasswordSubmitted(true);
    if (!savedAdminPassword) {
      scheduleLiveAnnouncement('');
      savedAdminPasswordRef.current?.focus();
      return;
    }
    setSavedAdminSubmitting(true);
    try {
      const outcome = await onEmailSignIn(selectedSavedAdmin.email, {
        password: savedAdminPassword,
      });
      if (!outcome.ok && (outcome.code === 'PASSWORD_REQUIRED' || outcome.code === 'INVALID_PASSWORD')) {
        const msg =
          outcome.error || 'Incorrect password. Check your password and try again.';
        setSavedAdminServerError(msg);
        scheduleLiveAnnouncement(`Password: ${msg}`, 500);
        window.setTimeout(() => {
          savedAdminPasswordRef.current?.focus();
        }, 0);
      }
    } finally {
      setSavedAdminSubmitting(false);
    }
  };

  const handleLiveGoogleOAuthRedirect = (loginHint?: string) => {
    if (!googleClientId) return;
    if (loginHint) setVerifyingAccountEmail(loginHint);
    setVerificationStep('redirecting');
    window.location.assign(buildGoogleOAuthRedirectUrl(googleClientId, loginHint));
  };

  const handleSavedAccountSelect = (account: RecentGoogleAccount) => {
    if (isLiveBackend) {
      handleLiveGoogleOAuthRedirect(account.email);
      return;
    }
    if (isAllowlistedSuperAdmin(account.email)) {
      setSelectedSavedAdmin(account);
      setSavedAdminPassword('');
      setSavedAdminPasswordTouched(false);
      setSavedAdminPasswordSubmitted(false);
      setSavedAdminServerError(null);
      setShowSavedAdminPassword(false);
      scheduleLiveAnnouncement('');
      return;
    }
    setSelectedSavedAdmin(null);
    void executeVerifiedSignIn(account.email);
  };

  const handleForgetAccount = (targetEmail: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = forgetRecentGoogleAccount(targetEmail);
    setRecentAccounts(updated);
    if (selectedSavedAdmin && normalizeEmail(selectedSavedAdmin.email) === normalizeEmail(targetEmail)) {
      setSelectedSavedAdmin(null);
      setSavedAdminPassword('');
      setSavedAdminServerError(null);
    }
    if (updated.length === 0) {
      setShowAnotherAccountForm(true);
    }
  };

  const workspaceClean = workspaceEmail.trim();
  const workspaceError =
    (workspaceTouched || workspaceSubmitted) && !EMAIL_PATTERN.test(workspaceClean)
      ? 'Enter an email address in the format name@example.org.'
      : null;
  const workspaceRequiresPassword =
    isSupabaseMode || (!isLiveBackend && isAllowlistedSuperAdmin(workspaceClean));
  const workspacePasswordError = workspaceRequiresPassword
    ? workspaceServerPasswordError ||
      ((workspacePasswordTouched || workspacePasswordSubmitted) && !workspacePassword
        ? isSupabaseMode
          ? 'Enter your password.'
          : 'Enter your Super Administrator password.'
        : null)
    : null;

  const signupNameError =
    (signupNameTouched || signupSubmitted) && !signupFullName.trim()
      ? 'Enter your full name.'
      : null;
  const signupEmailError =
    (signupEmailTouched || signupSubmitted) && !EMAIL_PATTERN.test(signupEmail.trim())
      ? 'Enter an email address in the format name@example.org.'
      : null;
  const signupStrength = evaluatePasswordStrength(signupPassword);
  const signupPasswordError =
    (signupPasswordTouched || signupSubmitted) && !isStrongPassword(signupPassword)
      ? 'Password must be at least 8 characters and include uppercase, lowercase, and a number.'
      : null;

  const forgotEmailError =
    (forgotEmailTouched || forgotSubmitted) && !EMAIL_PATTERN.test(forgotEmail.trim())
      ? 'Enter an email address in the format name@example.org.'
      : null;

  const resetStrength = evaluatePasswordStrength(resetNewPassword);
  const resetPasswordError =
    (resetPasswordTouched || resetSubmitted) && !isStrongPassword(resetNewPassword)
      ? 'Password must be at least 8 characters and include uppercase, lowercase, and a number.'
      : null;

  const googleClean = googleEmail.trim();
  const googleError =
    (googleTouched || googleSubmitted) && !EMAIL_PATTERN.test(googleClean)
      ? 'Enter an email address in the format name@gmail.com.'
      : null;
  const googleRequiresPassword = !isLiveBackend && isAllowlistedSuperAdmin(googleClean);
  const googlePasswordError = googleRequiresPassword
    ? googleServerPasswordError ||
      ((googlePasswordTouched || googlePasswordSubmitted) && !googlePassword
        ? 'Enter your Super Administrator password.'
        : null)
    : null;

  const savedAdminPasswordError = selectedSavedAdmin
    ? savedAdminServerError ||
      ((savedAdminPasswordTouched || savedAdminPasswordSubmitted) && !savedAdminPassword
        ? 'Enter your Super Administrator password.'
        : null)
    : null;

  const hasSavedSuperAdmin =
    !isLiveBackend && recentAccounts.some((acc) => isAllowlistedSuperAdmin(acc.email));

  const isAuthenticating = verificationStep !== 'idle' || oauthProcessing;

  const handleTeamLinkSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const res = parseTeamSetupFromLocation(teamLinkValue);
    if (!res.applied) {
      const msg =
        res.error || 'Paste the Team Submission Link or code shared by your programme administrator.';
      setTeamLinkError(msg);
      setTeamLinkSuccess('');
      scheduleLiveAnnouncement(msg);
      teamLinkInputRef.current?.focus();
      return;
    }
    setTeamLinkError('');
    setTeamLinkValue('');
    setTeamLinkOpen(false);
    setTeamLinkSuccess('Connected to Central Programme Database');
    onTeamIntakeConfigured?.();
  };

  const renderSavedAdminPasswordForm = () => {
    if (!selectedSavedAdmin || isLiveBackend) return null;
    return (
      <form
        method="post"
        onSubmit={(e) => void handleSavedAdminSubmit(e)}
        noValidate
        aria-labelledby="saved-admin-verify-heading"
        className="mt-1 p-3.5 rounded-xl bg-[#F5F2E9] border border-[#0284C7]/60 flex flex-col gap-3"
      >
        <input
          type="email"
          name="email"
          autoComplete="username"
          value={selectedSavedAdmin.email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="visually-hidden"
        />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3
              id="saved-admin-verify-heading"
              className="text-xs font-medium text-[#0A1B2C] flex items-center gap-1.5"
            >
              <Lock className="w-3.5 h-3.5 text-[#006BB8] shrink-0" aria-hidden="true" />
              <span>Verify password for {selectedSavedAdmin.name}</span>
            </h3>
            <p className="text-[11px] font-mono text-[#243647] truncate mt-0.5">
              {selectedSavedAdmin.email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedSavedAdmin(null);
              setSavedAdminPassword('');
              setSavedAdminServerError(null);
            }}
            className="text-xs font-medium text-[#243647] hover:text-[#0A1B2C] px-2 py-1 rounded-lg hover:bg-[#EFE8D6] cursor-pointer shrink-0"
          >
            Cancel
          </button>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="saved-admin-password" className="text-xs font-medium text-[#0A1B2C]">
            Password <span aria-hidden="true">*</span>
          </label>
          <span id="saved-admin-pw-hint" className="text-xs text-[#33475B]">
            Enter the Super Administrator password for this saved account.
          </span>
          <span id="saved-admin-pw-warning" className="visually-hidden">
            Warning: this will display your password on the screen.
          </span>
          <div className="flex items-stretch gap-2">
            <div className="relative flex-1 min-w-0">
              <Lock
                className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                ref={savedAdminPasswordRef}
                id="saved-admin-password"
                name="password"
                type={showSavedAdminPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                enterKeyHint="done"
                placeholder="Enter password"
                value={savedAdminPassword}
                onChange={(e) => {
                  setSavedAdminPassword(e.target.value);
                  setSavedAdminPasswordTouched(false);
                  setSavedAdminPasswordSubmitted(false);
                  if (savedAdminServerError) setSavedAdminServerError(null);
                  scheduleLiveAnnouncement('');
                }}
                onBlur={() => {
                  setSavedAdminPasswordTouched(true);
                  if (!savedAdminPassword) {
                    scheduleLiveAnnouncement(
                      'Password: Enter your Super Administrator password.',
                      500,
                    );
                  }
                }}
                aria-invalid={Boolean(savedAdminPasswordError)}
                aria-describedby={
                  savedAdminPasswordError
                    ? 'saved-admin-pw-hint saved-admin-pw-error'
                    : 'saved-admin-pw-hint'
                }
                className="ct-input pl-10 rounded-xl bg-[#FFFFFF] border-[#5F7082]"
              />
            </div>
            <button
              type="button"
              aria-pressed={showSavedAdminPassword}
              aria-label={showSavedAdminPassword ? 'Hide password' : 'Show password'}
              aria-describedby="saved-admin-pw-warning"
              onClick={() => setShowSavedAdminPassword((v) => !v)}
              className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-[#FFFFFF] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
            >
              {showSavedAdminPassword ? (
                <EyeOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Eye className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
          </div>
          {savedAdminPasswordError && (
            <div
              id="saved-admin-pw-error"
              className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
            >
              <AlertCircle
                role="img"
                aria-label="Error"
                className="w-4 h-4 shrink-0 mt-0.5"
              />
              <span>{savedAdminPasswordError}</span>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={savedAdminSubmitting}
          className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] disabled:opacity-60 border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
        >
          {savedAdminSubmitting ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : (
            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
          )}
          <span>Sign In</span>
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </button>
      </form>
    );
  };

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
          <span>
            {isSupabaseMode
              ? 'Cloud Database & Auth'
              : isLiveBackend
                ? 'Google Workspace SSO'
                : 'Authorized Workspace'}
          </span>
        </div>
      </header>

      <main className="relative z-10 w-full flex-1 flex items-center justify-center py-2 sm:py-6">
        <div aria-live="polite" className="visually-hidden">
          {liveErrorAnnouncement}
        </div>
        {activeView === 'restoring' ? (
          <section
            aria-labelledby="restoring-heading"
            role="status"
            aria-live="polite"
            className="ct-auth-card w-full max-w-[420px] p-7 sm:p-8 flex flex-col items-center text-center gap-4"
          >
            <img
              src={vidhyaVidhaiLogo}
              alt="Vidhya Vidhai Foundation — Educate, Innovate, Lead"
              width={824}
              height={176}
              decoding="sync"
              className="w-[196px] sm:w-[220px] h-auto object-contain select-none"
            />
            <div className="w-11 h-11 rounded-2xl bg-[#F5F2E9] border border-[#DFD7C2] flex items-center justify-center text-[#006BB8]">
              <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h1 id="restoring-heading" className="text-base font-medium text-[#0A1B2C]">
                Opening your workspace...
              </h1>
              <p className="text-xs text-[#243647]">
                Verifying your signed-in session and loading saved records.
              </p>
            </div>
          </section>
        ) : activeView === 'reset_password' ? (
          <section
            aria-labelledby="reset-password-heading"
            className="ct-auth-card w-full max-w-[448px] p-7 sm:p-8 flex flex-col gap-5"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  if (onSignOutNoticeAccount) {
                    void onSignOutNoticeAccount();
                  } else {
                    navigate('/login', true);
                  }
                }}
                className="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 -ml-2.5 rounded-lg text-xs font-medium text-[#243647] hover:text-[#0A1B2C] hover:bg-[#EFE8D6]/80 cursor-pointer transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Back to sign-in</span>
              </button>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E8F6FF] border border-[#0284C7]/45 text-xs font-medium text-[#006BB8]">
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Password Recovery</span>
              </span>
            </div>

            <div className="flex flex-col items-center text-center gap-2">
              <img
                src={vidhyaVidhaiLogo}
                alt="Vidhya Vidhai Foundation — Educate, Innovate, Lead"
                width={824}
                height={176}
                decoding="sync"
                className="w-[196px] h-auto object-contain select-none"
              />
              <h1
                ref={resetHeadingRef}
                tabIndex={-1}
                id="reset-password-heading"
                className="text-xl font-medium text-[#0A1B2C] tracking-tight outline-none mt-1"
              >
                Set a new password
              </h1>
              <p className="text-xs sm:text-[13px] text-[#243647] leading-relaxed">
                Choose a strong password for your Vidhya Vidhai Career Tours account.
              </p>
            </div>

            <form
              method="post"
              onSubmit={(e) => void handleSupabaseResetSubmit(e)}
              noValidate
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reset-new-password" className="text-xs font-medium text-[#0A1B2C]">
                  New password <span aria-hidden="true">*</span>
                </label>
                <ul
                  id="reset-password-requirements"
                  className="text-xs text-[#33475B] space-y-1 bg-[#F5F2E9] border border-[#DFD7C2] rounded-xl px-3 py-2"
                >
                  <li className={resetStrength.minLength ? 'text-[#047857] font-medium' : ''}>
                    {resetStrength.minLength ? '✓ ' : '• '}At least 8 characters
                  </li>
                  <li className={resetStrength.hasUpper ? 'text-[#047857] font-medium' : ''}>
                    {resetStrength.hasUpper ? '✓ ' : '• '}At least 1 uppercase letter
                  </li>
                  <li className={resetStrength.hasLower ? 'text-[#047857] font-medium' : ''}>
                    {resetStrength.hasLower ? '✓ ' : '• '}At least 1 lowercase letter
                  </li>
                  <li className={resetStrength.hasDigit ? 'text-[#047857] font-medium' : ''}>
                    {resetStrength.hasDigit ? '✓ ' : '• '}At least 1 number
                  </li>
                </ul>
                <span id="reset-pw-warning" className="visually-hidden">
                  Warning: this will display your password on the screen.
                </span>
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Lock
                      className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      ref={resetPasswordRef}
                      id="reset-new-password"
                      name="new-password"
                      type={showResetPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      enterKeyHint="done"
                      placeholder="Enter new password"
                      value={resetNewPassword}
                      onChange={(e) => {
                        setResetNewPassword(e.target.value);
                        setResetPasswordTouched(false);
                        setResetSubmitted(false);
                        if (resetServerError) setResetServerError(null);
                        scheduleLiveAnnouncement('');
                      }}
                      onBlur={() => {
                        setResetPasswordTouched(true);
                        if (!isStrongPassword(resetNewPassword)) {
                          scheduleLiveAnnouncement(
                            'New password: Use at least 8 characters with uppercase, lowercase, and a number.',
                            500,
                          );
                        }
                      }}
                      aria-invalid={Boolean(resetPasswordError)}
                      aria-describedby={
                        resetPasswordError
                          ? 'reset-password-requirements reset-password-error'
                          : 'reset-password-requirements'
                      }
                      className="ct-input pl-10 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                    />
                  </div>
                  <button
                    type="button"
                    aria-pressed={showResetPassword}
                    aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                    aria-describedby="reset-pw-warning"
                    onClick={() => setShowResetPassword((v) => !v)}
                    className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-[#F5F2E9] hover:bg-[#FFFFFF] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                  >
                    {showResetPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
                {resetPasswordError && (
                  <div
                    id="reset-password-error"
                    className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                  >
                    <AlertCircle role="img" aria-label="Error" className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{resetPasswordError}</span>
                  </div>
                )}
              </div>

              {resetServerError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{resetServerError}</span>
                </div>
              )}

              {resetSuccessMessage && (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{resetSuccessMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={resetSubmitting}
                className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] disabled:opacity-60 border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                {resetSubmitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                <span>Update Password</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </form>
          </section>
        ) : activeView === 'pending_approval' ? (
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
                  if (isSupabaseMode && onSignOutNoticeAccount) {
                    void onSignOutNoticeAccount();
                    return;
                  }
                  onResetAuthNotice?.();
                  navigate('/auth/google', true);
                }}
                className="ct-btn-secondary w-full justify-center text-sm rounded-xl"
              >
                {isSupabaseMode
                  ? 'Sign out & use another account'
                  : 'Sign in with a different Google account'}
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
                      'Your account is not currently authorized for this workspace. Contact an Administrator for access.'}
                  </p>
                  {authNotice?.email && (
                    <p className="text-xs font-mono text-[#BE123C] mt-1.5">{authNotice.email}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                {!isSupabaseMode && (
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
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (isSupabaseMode && onSignOutNoticeAccount) {
                      void onSignOutNoticeAccount();
                      return;
                    }
                    onResetAuthNotice?.();
                    navigate('/login', true);
                  }}
                  className="ct-btn-secondary flex-1 justify-center text-sm rounded-xl"
                >
                  {isSupabaseMode ? 'Sign out & use another account' : 'Back to sign-in'}
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
            ) : isSupabaseMode ? (
              supabaseGoogleOAuthEnabled ? (
                <div className="flex flex-col gap-4">
                  <button
                    type="button"
                    disabled={googleOAuthBusy}
                    onClick={() => {
                      if (!onSupabaseGoogleOAuth) return;
                      setGoogleOAuthBusy(true);
                      void onSupabaseGoogleOAuth().finally(() => {
                        setGoogleOAuthBusy(false);
                      });
                    }}
                    className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] disabled:opacity-60 border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center gap-2.5 cursor-pointer transition-colors"
                  >
                    {googleOAuthBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <GoogleEmblem className="w-4 h-4 bg-white rounded-full p-0.5" />
                    )}
                    <span>Continue with Google</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <div className="rounded-xl px-3.5 py-2.5 bg-[#F5F2E9] border border-[#DFD7C2] text-xs leading-relaxed text-[#243647]">
                    <span className="font-medium text-[#0A1B2C]">Verified Workspace Access:</span>{' '}
                    You will be signed in securely with your Google account via Supabase Auth.
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="rounded-xl px-3.5 py-3 bg-[#FFFBEB] border border-[#B45309]/40 text-xs leading-relaxed text-[#92400E]">
                    Google SSO is not enabled on this workspace yet. Please sign in or create your
                    facilitator account with your email and password.
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/login', true)}
                    className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <span>Sign in with Email &amp; Password</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )
            ) : isLiveBackend ? (
              <div className="flex flex-col gap-4">
                {recentAccounts.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h2 className="text-xs font-medium text-[#243647]">
                      Choose a recently signed-in account
                    </h2>
                    <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto pr-0.5">
                      {recentAccounts.map((acc) => (
                        <div
                          key={acc.email}
                          className="group relative flex items-center rounded-xl border border-[#C7BEA7] bg-[#FFFFFF] hover:border-[#0284C7] hover:bg-[#F5F2E9] transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => handleSavedAccountSelect(acc)}
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
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => handleLiveGoogleOAuthRedirect()}
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
                    <div className="flex flex-col gap-2 max-h-[240px] overflow-y-auto pr-0.5">
                      {recentAccounts.map((acc) => {
                        const requiresPassword = isAllowlistedSuperAdmin(acc.email);
                        return (
                          <div
                            key={acc.email}
                            className="group relative flex items-center rounded-xl border border-[#C7BEA7] bg-[#FFFFFF] hover:border-[#0284C7] hover:bg-[#F5F2E9] transition-colors"
                          >
                            <button
                              type="button"
                              onClick={() => handleSavedAccountSelect(acc)}
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
                              {requiresPassword && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E8F6FF] border border-[#0284C7]/35 text-[#006BB8] shrink-0">
                                  <Lock className="w-3 h-3" aria-hidden="true" />
                                  <span>Password</span>
                                </span>
                              )}
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
                        );
                      })}
                    </div>

                    {renderSavedAdminPasswordForm()}

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
                    method="post"
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
                          autoComplete="username"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          enterKeyHint={googleRequiresPassword ? 'next' : 'done'}
                          placeholder="name@vidhyavidhai.org"
                          value={googleEmail}
                          onChange={(e) => handleGoogleEmailChange(e.target.value)}
                          onBlur={() => {
                            setGoogleTouched(true);
                            if (!EMAIL_PATTERN.test(googleEmail.trim())) {
                              scheduleLiveAnnouncement(
                                'Google account email: Enter an email address in the format name@gmail.com.',
                                500,
                              );
                            }
                          }}
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
                          className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                        >
                          <AlertCircle
                            role="img"
                            aria-label="Error"
                            className="w-4 h-4 shrink-0 mt-0.5"
                          />
                          <span>{googleError}</span>
                        </div>
                      )}
                    </div>

                    {googleRequiresPassword && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor="google-account-password"
                            className="text-xs font-medium text-[#0A1B2C]"
                          >
                            Password <span aria-hidden="true">*</span>
                          </label>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E8F6FF] border border-[#0284C7]/35 text-[#006BB8]">
                            <Lock className="w-3 h-3" aria-hidden="true" />
                            <span>Super Admin</span>
                          </span>
                        </div>
                        <span id="google-pw-hint" className="text-xs text-[#33475B]">
                          Enter the Super Administrator password for this account.
                        </span>
                        <span id="google-pw-warning" className="visually-hidden">
                          Warning: this will display your password on the screen.
                        </span>
                        <div className="flex items-stretch gap-2">
                          <div className="relative flex-1 min-w-0">
                            <Lock
                              className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                              aria-hidden="true"
                            />
                            <input
                              ref={googlePasswordRef}
                              id="google-account-password"
                              name="password"
                              type={showGooglePassword ? 'text' : 'password'}
                              required
                              autoComplete="current-password"
                              enterKeyHint="done"
                              placeholder="Enter password"
                              value={googlePassword}
                              onChange={(e) => {
                                setGooglePassword(e.target.value);
                                setGooglePasswordTouched(false);
                                setGooglePasswordSubmitted(false);
                                if (googleServerPasswordError) setGoogleServerPasswordError(null);
                                scheduleLiveAnnouncement('');
                              }}
                              onBlur={() => {
                                setGooglePasswordTouched(true);
                                if (!googlePassword) {
                                  scheduleLiveAnnouncement(
                                    'Password: Enter your Super Administrator password.',
                                    500,
                                  );
                                }
                              }}
                              aria-invalid={Boolean(googlePasswordError)}
                              aria-describedby={
                                googlePasswordError
                                  ? 'google-pw-hint google-pw-error'
                                  : 'google-pw-hint'
                              }
                              className="ct-input pl-10 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                            />
                          </div>
                          <button
                            type="button"
                            aria-pressed={showGooglePassword}
                            aria-label={showGooglePassword ? 'Hide password' : 'Show password'}
                            aria-describedby="google-pw-warning"
                            onClick={() => setShowGooglePassword((v) => !v)}
                            className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-[#F5F2E9] hover:bg-[#FFFFFF] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                          >
                            {showGooglePassword ? (
                              <EyeOff className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <Eye className="w-4 h-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        {googlePasswordError && (
                          <div
                            id="google-pw-error"
                            className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                          >
                            <AlertCircle
                              role="img"
                              aria-label="Error"
                              className="w-4 h-4 shrink-0 mt-0.5"
                            />
                            <span>{googlePasswordError}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={googleSubmitting}
                      className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] disabled:opacity-60 border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      {googleSubmitting ? (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <GoogleEmblem className="w-4 h-4 bg-white rounded-full p-0.5" />
                      )}
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
                  ref={authCardHeadingRef}
                  tabIndex={-1}
                  id="auth-card-heading"
                  className="text-xl font-medium text-[#0A1B2C] tracking-tight outline-none"
                >
                  {isSupabaseMode && supabasePanelMode === 'sign_up'
                    ? 'Create Facilitator account'
                    : isSupabaseMode && supabasePanelMode === 'forgot_password'
                      ? 'Reset your password'
                      : 'Sign in to your workspace'}
                </h2>
                <p className="text-xs sm:text-[13px] text-[#243647] leading-relaxed">
                  {isSupabaseMode && supabasePanelMode === 'sign_up'
                    ? 'Register with your email to access Classroom Data Entry (pre-approved emails activate immediately).'
                    : isSupabaseMode && supabasePanelMode === 'forgot_password'
                      ? 'Enter your email address to request a password reset link, or ask a Super Admin to set a temporary password.'
                      : isSupabaseMode && !supabaseGoogleOAuthEnabled
                        ? 'Sign in with your Vidhya Vidhai portal email and password, or create a facilitator account below.'
                        : 'Authenticate securely with Google SSO or continue with your authorized Vidhya Vidhai email.'}
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
              ) : isSupabaseMode && supabasePanelMode === 'sign_up' ? (
                <form
                  method="post"
                  onSubmit={(e) => void handleSupabaseSignUpSubmit(e)}
                  noValidate
                  className="flex flex-col gap-3.5"
                >
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="signup-fullname" className="text-xs font-medium text-[#0A1B2C]">
                      Full name <span aria-hidden="true">*</span>
                    </label>
                    <input
                      ref={signupNameRef}
                      id="signup-fullname"
                      name="fullname"
                      type="text"
                      required
                      autoComplete="name"
                      enterKeyHint="next"
                      placeholder="Your full name"
                      value={signupFullName}
                      onChange={(e) => {
                        setSignupFullName(e.target.value);
                        setSignupNameTouched(false);
                        setSignupSubmitted(false);
                        if (signupServerError) setSignupServerError(null);
                        scheduleLiveAnnouncement('');
                      }}
                      onBlur={() => {
                        setSignupNameTouched(true);
                        if (!signupFullName.trim()) {
                          scheduleLiveAnnouncement('Full name: Enter your full name.', 500);
                        }
                      }}
                      aria-invalid={Boolean(signupNameError)}
                      aria-describedby={signupNameError ? 'signup-name-error' : undefined}
                      className="ct-input rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                    />
                    {signupNameError && (
                      <div
                        id="signup-name-error"
                        className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                      >
                        <AlertCircle role="img" aria-label="Error" className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{signupNameError}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="signup-email" className="text-xs font-medium text-[#0A1B2C]">
                      Email <span aria-hidden="true">*</span>
                    </label>
                    <span id="signup-email-hint" className="text-xs text-[#33475B]">
                      Format: name@vidhyavidhai.org or name@gmail.com
                    </span>
                    <div className="relative">
                      <Mail
                        className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        ref={signupEmailRef}
                        id="signup-email"
                        name="email"
                        type="email"
                        required
                        autoComplete="username"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        enterKeyHint="next"
                        placeholder="name@vidhyavidhai.org"
                        value={signupEmail}
                        onChange={(e) => {
                          setSignupEmail(e.target.value);
                          setSignupEmailTouched(false);
                          setSignupSubmitted(false);
                          if (signupServerError) setSignupServerError(null);
                          scheduleLiveAnnouncement('');
                        }}
                        onBlur={() => {
                          setSignupEmailTouched(true);
                          if (!EMAIL_PATTERN.test(signupEmail.trim())) {
                            scheduleLiveAnnouncement(
                              'Email: Enter an email address in the format name@example.org.',
                              500,
                            );
                          }
                        }}
                        aria-invalid={Boolean(signupEmailError)}
                        aria-describedby={
                          signupEmailError
                            ? 'signup-email-hint signup-email-error'
                            : 'signup-email-hint'
                        }
                        className="ct-input pl-10 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                      />
                    </div>
                    {signupEmailError && (
                      <div
                        id="signup-email-error"
                        className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                      >
                        <AlertCircle role="img" aria-label="Error" className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{signupEmailError}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="signup-password" className="text-xs font-medium text-[#0A1B2C]">
                      Password <span aria-hidden="true">*</span>
                    </label>
                    <ul
                      id="signup-password-requirements"
                      className="text-xs text-[#33475B] space-y-1 bg-[#F5F2E9] border border-[#DFD7C2] rounded-xl px-3 py-2"
                    >
                      <li className={signupStrength.minLength ? 'text-[#047857] font-medium' : ''}>
                        {signupStrength.minLength ? '✓ ' : '• '}At least 8 characters
                      </li>
                      <li className={signupStrength.hasUpper ? 'text-[#047857] font-medium' : ''}>
                        {signupStrength.hasUpper ? '✓ ' : '• '}At least 1 uppercase letter
                      </li>
                      <li className={signupStrength.hasLower ? 'text-[#047857] font-medium' : ''}>
                        {signupStrength.hasLower ? '✓ ' : '• '}At least 1 lowercase letter
                      </li>
                      <li className={signupStrength.hasDigit ? 'text-[#047857] font-medium' : ''}>
                        {signupStrength.hasDigit ? '✓ ' : '• '}At least 1 number
                      </li>
                    </ul>
                    <span id="signup-pw-warning" className="visually-hidden">
                      Warning: this will display your password on the screen.
                    </span>
                    <div className="flex items-stretch gap-2">
                      <div className="relative flex-1 min-w-0">
                        <Lock
                          className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                          aria-hidden="true"
                        />
                        <input
                          ref={signupPasswordRef}
                          id="signup-password"
                          name="new-password"
                          type={showSignupPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          autoComplete="new-password"
                          enterKeyHint="done"
                          placeholder="Create a strong password"
                          value={signupPassword}
                          onChange={(e) => {
                            setSignupPassword(e.target.value);
                            setSignupPasswordTouched(false);
                            setSignupSubmitted(false);
                            if (signupServerError) setSignupServerError(null);
                            scheduleLiveAnnouncement('');
                          }}
                          onBlur={() => {
                            setSignupPasswordTouched(true);
                            if (!isStrongPassword(signupPassword)) {
                              scheduleLiveAnnouncement(
                                'Password: Use at least 8 characters with uppercase, lowercase, and a number.',
                                500,
                              );
                            }
                          }}
                          aria-invalid={Boolean(signupPasswordError)}
                          aria-describedby={
                            signupPasswordError
                              ? 'signup-password-requirements signup-password-error'
                              : 'signup-password-requirements'
                          }
                          className="ct-input pl-10 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                        />
                      </div>
                      <button
                        type="button"
                        aria-pressed={showSignupPassword}
                        aria-label={showSignupPassword ? 'Hide password' : 'Show password'}
                        aria-describedby="signup-pw-warning"
                        onClick={() => setShowSignupPassword((v) => !v)}
                        className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-[#F5F2E9] hover:bg-[#FFFFFF] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                      >
                        {showSignupPassword ? (
                          <EyeOff className="w-4 h-4" aria-hidden="true" />
                        ) : (
                          <Eye className="w-4 h-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {signupPasswordError && (
                      <div
                        id="signup-password-error"
                        className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                      >
                        <AlertCircle role="img" aria-label="Error" className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{signupPasswordError}</span>
                      </div>
                    )}
                  </div>

                  {signupServerError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{signupServerError}</span>
                    </div>
                  )}

                  {signupStatusMessage && (
                    <div
                      role="status"
                      className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{signupStatusMessage}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={signupSubmitting}
                    className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] disabled:opacity-60 border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    {signupSubmitting && (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    )}
                    <span>Create Account</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <div className="pt-2 border-t border-dotted border-[#C7BEA7] flex items-center justify-between text-xs">
                    <span className="text-[#243647]">Already registered?</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSupabasePanelMode('sign_in');
                        setSignupServerError(null);
                        setSignupStatusMessage(null);
                        authCardHeadingRef.current?.focus();
                      }}
                      className="font-medium text-[#006BB8] hover:underline cursor-pointer"
                    >
                      Back to Sign In
                    </button>
                  </div>
                </form>
              ) : isSupabaseMode && supabasePanelMode === 'forgot_password' ? (
                <form
                  method="post"
                  onSubmit={(e) => void handleSupabaseForgotSubmit(e)}
                  noValidate
                  className="flex flex-col gap-3.5"
                >
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="forgot-email" className="text-xs font-medium text-[#0A1B2C]">
                      Email <span aria-hidden="true">*</span>
                    </label>
                    <span id="forgot-email-hint" className="text-xs text-[#33475B]">
                      Format: name@vidhyavidhai.org or name@gmail.com
                    </span>
                    <div className="relative">
                      <Mail
                        className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                        aria-hidden="true"
                      />
                      <input
                        ref={forgotEmailRef}
                        id="forgot-email"
                        name="email"
                        type="email"
                        required
                        autoComplete="username"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        enterKeyHint="done"
                        placeholder="name@vidhyavidhai.org"
                        value={forgotEmail}
                        onChange={(e) => {
                          setForgotEmail(e.target.value);
                          setForgotEmailTouched(false);
                          setForgotSubmitted(false);
                          if (forgotServerError) setForgotServerError(null);
                          scheduleLiveAnnouncement('');
                        }}
                        onBlur={() => {
                          setForgotEmailTouched(true);
                          if (!EMAIL_PATTERN.test(forgotEmail.trim())) {
                            scheduleLiveAnnouncement(
                              'Email: Enter an email address in the format name@example.org.',
                              500,
                            );
                          }
                        }}
                        aria-invalid={Boolean(forgotEmailError)}
                        aria-describedby={
                          forgotEmailError
                            ? 'forgot-email-hint forgot-email-error'
                            : 'forgot-email-hint'
                        }
                        className="ct-input pl-10 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                      />
                    </div>
                    {forgotEmailError && (
                      <div
                        id="forgot-email-error"
                        className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                      >
                        <AlertCircle role="img" aria-label="Error" className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{forgotEmailError}</span>
                      </div>
                    )}
                  </div>

                  {forgotServerError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{forgotServerError}</span>
                    </div>
                  )}

                  {forgotSuccessMessage && (
                    <div
                      role="status"
                      className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#ECFDF5] border border-[#047857]/35 text-[#047857]"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{forgotSuccessMessage}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={forgotSubmitting}
                    className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] disabled:opacity-60 border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    {forgotSubmitting && (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    )}
                    <span>Send Reset Link</span>
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>

                  <p className="text-xs text-[#33475B] leading-relaxed">
                    Need immediate access? Ask a Super Administrator (Brintha or Karunya) to set a
                    temporary password for your email in{' '}
                    <strong className="font-medium text-[#0A1B2C]">Admin Console → User Management</strong>.
                  </p>

                  <div className="pt-2 border-t border-dotted border-[#C7BEA7] flex items-center justify-between text-xs">
                    <span className="text-[#243647]">Remembered your password?</span>
                    <button
                      type="button"
                      onClick={() => {
                        setSupabasePanelMode('sign_in');
                        setForgotServerError(null);
                        setForgotSuccessMessage(null);
                        authCardHeadingRef.current?.focus();
                      }}
                      className="font-medium text-[#006BB8] hover:underline cursor-pointer"
                    >
                      Back to Sign In
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  {!isSupabaseMode && recentAccounts.length > 0 && (
                    <div
                      role="region"
                      aria-label="Remembered workspace logins"
                      className="flex flex-col gap-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-[#243647]">
                          Saved logins on this browser ({recentAccounts.length})
                        </span>
                        <span className="text-[11px] text-[#33475B]">
                          {hasSavedSuperAdmin ? 'Password required for admins' : 'One-click sign-in'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5 max-h-[196px] overflow-y-auto pr-0.5">
                        {recentAccounts.map((acc) => {
                          const requiresPassword =
                            !isLiveBackend && isAllowlistedSuperAdmin(acc.email);
                          return (
                            <div
                              key={acc.email}
                              className="flex items-center rounded-xl border border-[#C7BEA7] bg-[#FFFFFF] hover:border-[#0284C7] hover:bg-[#F5F2E9] transition-colors"
                            >
                              <button
                                type="button"
                                onClick={() => handleSavedAccountSelect(acc)}
                                className="flex-1 min-w-0 min-h-[46px] px-3 py-2 flex items-center gap-2.5 text-left cursor-pointer rounded-l-xl"
                              >
                                <span
                                  aria-hidden="true"
                                  className="w-7 h-7 rounded-full bg-[#0A1B2C] text-[#FAF8F2] text-[11px] font-medium flex items-center justify-center shrink-0"
                                >
                                  {getInitials(acc.name, acc.email)}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs font-medium text-[#0A1B2C] truncate">
                                    {acc.name}
                                  </span>
                                  <span className="block text-[11px] text-[#243647] truncate">
                                    {acc.email}
                                  </span>
                                </span>
                                {requiresPassword && (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#E8F6FF] border border-[#0284C7]/35 text-[#006BB8] shrink-0">
                                    <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                                    <span>Password</span>
                                  </span>
                                )}
                                <ArrowRight
                                  className="w-3.5 h-3.5 text-[#006BB8] shrink-0"
                                  aria-hidden="true"
                                />
                              </button>
                              <button
                                type="button"
                                aria-label={`Remove saved account ${acc.email}`}
                                onClick={(e) => handleForgetAccount(acc.email, e)}
                                className="mr-1.5 w-7 h-7 rounded-lg flex items-center justify-center text-[#33475B] hover:text-[#BE123C] hover:bg-[#FFF1F2] cursor-pointer transition-colors shrink-0"
                              >
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {renderSavedAdminPasswordForm()}
                    </div>
                  )}

                  {(!isSupabaseMode || supabaseGoogleOAuthEnabled) && (
                    <>
                      {/* Primary Google Sign-In CTA -> redirects cleanly to dedicated /auth/google experience or Supabase Google OAuth */}
                      <button
                        type="button"
                        disabled={googleOAuthBusy}
                        onClick={openDedicatedGoogleAuth}
                        className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-[#FFFFFF] hover:bg-[#F5F2E9] disabled:opacity-60 border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] text-sm font-medium inline-flex items-center justify-between gap-3 ct-interactive-tile shadow-xs cursor-pointer transition-colors"
                      >
                        <span className="inline-flex items-center gap-2.5">
                          {googleOAuthBusy ? (
                            <Loader2 className="w-4 h-4 animate-spin text-[#006BB8]" aria-hidden="true" />
                          ) : (
                            <GoogleEmblem className="w-4 h-4" />
                          )}
                          <span>Continue with Google</span>
                        </span>
                        <ArrowRight className="w-4 h-4 text-[#006BB8] shrink-0" aria-hidden="true" />
                      </button>

                      <div className="relative flex items-center gap-3">
                        <div className="flex-1 border-t border-dotted border-[#C7BEA7]" aria-hidden="true" />
                        <span className="text-xs text-[#33475B] shrink-0">
                          {isSupabaseMode
                            ? 'Or sign in with email & password'
                            : 'Or continue with workspace email'}
                        </span>
                        <div className="flex-1 border-t border-dotted border-[#C7BEA7]" aria-hidden="true" />
                      </div>
                    </>
                  )}

                  <form
                    method="post"
                    onSubmit={(e) => void handleWorkspaceEmailSubmit(e)}
                    noValidate
                    className="flex flex-col gap-3.5"
                  >
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="login-email" className="text-xs font-medium text-[#0A1B2C]">
                        Email <span aria-hidden="true">*</span>
                      </label>
                      <span id="workspace-email-hint" className="text-xs text-[#33475B]">
                        {isSupabaseMode
                          ? 'Format: name@vidhyavidhai.org or name@gmail.com'
                          : 'Format: name@vidhyavidhai.org'}
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
                          enterKeyHint={workspaceRequiresPassword ? 'next' : 'done'}
                          placeholder="name@vidhyavidhai.org"
                          value={workspaceEmail}
                          onChange={(e) => handleWorkspaceEmailChange(e.target.value)}
                          onBlur={() => {
                            setWorkspaceTouched(true);
                            if (!EMAIL_PATTERN.test(workspaceEmail.trim())) {
                              scheduleLiveAnnouncement(
                                'Email: Enter an email address in the format name@example.org.',
                                500,
                              );
                            }
                          }}
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
                          className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                        >
                          <AlertCircle
                            role="img"
                            aria-label="Error"
                            className="w-4 h-4 shrink-0 mt-0.5"
                          />
                          <span>{workspaceError}</span>
                        </div>
                      )}
                    </div>

                    {workspaceRequiresPassword && (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor="login-password"
                            className="text-xs font-medium text-[#0A1B2C]"
                          >
                            Password <span aria-hidden="true">*</span>
                          </label>
                          {isSupabaseMode ? (
                            <button
                              type="button"
                              onClick={() => {
                                setForgotEmail(workspaceEmail.trim());
                                setForgotServerError(null);
                                setForgotSuccessMessage(null);
                                setSupabasePanelMode('forgot_password');
                                authCardHeadingRef.current?.focus();
                              }}
                              className="text-xs font-medium text-[#006BB8] hover:underline cursor-pointer"
                            >
                              Forgot password?
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#E8F6FF] border border-[#0284C7]/35 text-[#006BB8]">
                              <Lock className="w-3 h-3" aria-hidden="true" />
                              <span>Super Admin</span>
                            </span>
                          )}
                        </div>
                        <span id="workspace-password-hint" className="text-xs text-[#33475B]">
                          {isSupabaseMode
                            ? 'Enter your Vidhya Vidhai portal password.'
                            : 'Enter the Super Administrator password for this account.'}
                        </span>
                        <span id="workspace-pw-warning" className="visually-hidden">
                          Warning: this will display your password on the screen.
                        </span>
                        <div className="flex items-stretch gap-2">
                          <div className="relative flex-1 min-w-0">
                            <Lock
                              className="w-4 h-4 text-[#33475B] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                              aria-hidden="true"
                            />
                            <input
                              ref={loginPasswordRef}
                              id="login-password"
                              name="password"
                              type={showWorkspacePassword ? 'text' : 'password'}
                              required
                              autoComplete="current-password"
                              enterKeyHint="done"
                              placeholder="Enter password"
                              value={workspacePassword}
                              onChange={(e) => {
                                setWorkspacePassword(e.target.value);
                                setWorkspacePasswordTouched(false);
                                setWorkspacePasswordSubmitted(false);
                                if (workspaceServerPasswordError) {
                                  setWorkspaceServerPasswordError(null);
                                }
                                scheduleLiveAnnouncement('');
                              }}
                              onBlur={() => {
                                setWorkspacePasswordTouched(true);
                                if (!workspacePassword) {
                                  scheduleLiveAnnouncement(
                                    isSupabaseMode
                                      ? 'Password: Enter your password.'
                                      : 'Password: Enter your Super Administrator password.',
                                    500,
                                  );
                                }
                              }}
                              aria-invalid={Boolean(workspacePasswordError)}
                              aria-describedby={
                                workspacePasswordError
                                  ? 'workspace-password-hint workspace-password-error'
                                  : 'workspace-password-hint'
                              }
                              className="ct-input pl-10 rounded-xl bg-[#F5F2E9] border-[#5F7082] focus:bg-[#FFFFFF]"
                            />
                          </div>
                          <button
                            type="button"
                            aria-pressed={showWorkspacePassword}
                            aria-label={showWorkspacePassword ? 'Hide password' : 'Show password'}
                            aria-describedby="workspace-pw-warning"
                            onClick={() => setShowWorkspacePassword((v) => !v)}
                            className="min-w-[44px] min-h-[44px] px-2.5 rounded-xl bg-[#F5F2E9] hover:bg-[#FFFFFF] border border-[#5F7082] hover:border-[#0284C7] text-[#0A1B2C] inline-flex items-center justify-center cursor-pointer transition-colors shrink-0"
                          >
                            {showWorkspacePassword ? (
                              <EyeOff className="w-4 h-4" aria-hidden="true" />
                            ) : (
                              <Eye className="w-4 h-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        {workspacePasswordError && (
                          <div
                            id="workspace-password-error"
                            className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                          >
                            <AlertCircle
                              role="img"
                              aria-label="Error"
                              className="w-4 h-4 shrink-0 mt-0.5"
                            />
                            <span>{workspacePasswordError}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={workspaceSubmitting}
                      className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-[#0A1B2C] hover:bg-[#132C45] disabled:opacity-60 border border-[#0A1B2C] text-[#FAF8F2] text-sm font-medium shadow-[0_10px_24px_rgba(10,27,44,0.22)] inline-flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    >
                      {workspaceSubmitting && (
                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                      )}
                      <span>{isLiveBackend ? 'Sign In with Google' : 'Sign In'}</span>
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </form>

                  <div className="pt-2 border-t border-dotted border-[#C7BEA7] flex flex-col gap-2">
                    {isSupabaseMode ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-[#243647]">New Facilitator?</span>
                          <button
                            type="button"
                            onClick={() => {
                              setSignupServerError(null);
                              setSignupStatusMessage(null);
                              if (EMAIL_PATTERN.test(workspaceEmail.trim())) {
                                setSignupEmail(workspaceEmail.trim());
                              }
                              setSupabasePanelMode('sign_up');
                              authCardHeadingRef.current?.focus();
                            }}
                            className="px-3 py-1.5 rounded-lg bg-[#E8F6FF] hover:bg-[#DCEFFE] border border-[#0284C7]/45 text-[#006BB8] font-medium cursor-pointer transition-colors"
                          >
                            Create Facilitator account
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-[#047857] font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Connected to Vidhya Vidhai Cloud Database</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          {isLiveBackend || isTeamIntakeConnected ? (
                            <span className="inline-flex items-center gap-1.5 text-[#047857] font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>
                                Connected to Central Programme Database
                                {teamIntakeLabel ? ` · ${teamIntakeLabel}` : ''}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[#92400E] font-medium">
                              Device-only mode until connected
                            </span>
                          )}

                          {!isLiveBackend && (
                            <button
                              type="button"
                              aria-expanded={teamLinkOpen}
                              aria-controls={teamLinkPanelId}
                              onClick={() => {
                                setTeamLinkOpen((v) => !v);
                                setTeamLinkError('');
                              }}
                              className="inline-flex items-center gap-1 font-medium text-[#006BB8] hover:underline cursor-pointer"
                            >
                              <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>
                                {isTeamIntakeConnected
                                  ? 'Update Team Sync Link'
                                  : 'Have a Team Sync Link or Code?'}
                              </span>
                            </button>
                          )}
                        </div>

                        {teamLinkSuccess && !teamLinkOpen && (
                          <p role="status" className="text-xs text-[#047857] font-medium">
                            {teamLinkSuccess}
                          </p>
                        )}

                        {teamLinkOpen && !isLiveBackend && (
                          <form
                            id={teamLinkPanelId}
                            method="post"
                            onSubmit={handleTeamLinkSubmit}
                            noValidate
                            className="p-3 rounded-xl bg-[#F5F2E9] border border-[#C7BEA7] flex flex-col gap-2.5"
                          >
                            <div className="flex flex-col gap-1">
                              <label
                                htmlFor={teamLinkId}
                                className="text-xs font-medium text-[#0A1B2C]"
                              >
                                Team Sync Link or Code
                              </label>
                              <span id={teamLinkHintId} className="text-[11px] text-[#33475B]">
                                Paste the Team Submission Link shared by your programme administrator.
                              </span>
                              <input
                                ref={teamLinkInputRef}
                                id={teamLinkId}
                                name="teamSyncLink"
                                type="text"
                                required
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                                placeholder="Paste https://.../#team_intake=... or code"
                                value={teamLinkValue}
                                onChange={(e) => {
                                  setTeamLinkValue(e.target.value);
                                  if (teamLinkError) setTeamLinkError('');
                                }}
                                aria-invalid={Boolean(teamLinkError)}
                                aria-describedby={
                                  teamLinkError
                                    ? `${teamLinkHintId} ${teamLinkErrId}`
                                    : teamLinkHintId
                                }
                                className="ct-input text-xs bg-[#FFFFFF] border-[#5F7082]"
                              />
                              {teamLinkError && (
                                <div
                                  id={teamLinkErrId}
                                  className="flex items-start gap-1.5 rounded-lg px-2.5 py-1.5 text-xs bg-[#FFF1F2] border border-[#BE123C]/40 text-[#BE123C]"
                                >
                                  <AlertCircle
                                    role="img"
                                    aria-label="Error"
                                    className="w-3.5 h-3.5 shrink-0 mt-0.5"
                                  />
                                  <span>{teamLinkError}</span>
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button type="submit" className="ct-btn-primary text-xs min-h-[36px] px-3 py-1">
                                Connect Device
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setTeamLinkOpen(false);
                                  setTeamLinkError('');
                                }}
                                className="ct-btn-secondary text-xs min-h-[36px] px-3 py-1"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                      </>
                    )}
                  </div>
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
