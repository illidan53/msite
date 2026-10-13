import { LogIn, LogOut, Trash2, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AuthProvider, AuthSession } from "../../shared/types";
import { loginHref } from "./apiClient";
import { useLocale, type Translate } from "./locale";

export function providerLabel(provider: AuthProvider, t: Translate) {
  return provider === "google"
    ? t("Google (Gmail)", "Google（Gmail）")
    : t("Microsoft (Outlook)", "Microsoft（Outlook）");
}

export function PrivacyLink() {
  const { t } = useLocale();
  return (
    <a className="privacy-link" href="/privacy.html">
      {t("Privacy", "隐私说明")}
    </a>
  );
}

export interface AccountNotice {
  kind: "error" | "success";
  text: string;
}

/**
 * Links that start sign-in with each configured provider. `onBeforeSignIn`
 * runs just before the full-page redirect to save what the page showed; the
 * nonce it returns is added to the return URL so only that round trip
 * restores it.
 */
export function SignInOptions({
  providers,
  onBeforeSignIn,
}: {
  providers: AuthProvider[];
  onBeforeSignIn?: () => string | undefined;
}) {
  const { t } = useLocale();
  const returnTo = (nonce?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("login");
    url.searchParams.delete("signin");
    if (nonce) url.searchParams.set("signin", nonce);
    return `${url.pathname}${url.search}`;
  };
  return (
    <div className="sign-in-options">
      {providers.map((provider) => (
        <a
          key={provider}
          className={`sign-in-option ${provider}`}
          href={loginHref(provider, returnTo())}
          onClick={(event) => {
            const nonce = onBeforeSignIn?.();
            // The browser reads href after this handler, at navigation.
            if (nonce) event.currentTarget.href = loginHref(provider, returnTo(nonce));
          }}
        >
          <ProviderMark provider={provider} />
          {t(
            `Continue with ${providerLabel(provider, t)}`,
            `使用 ${providerLabel(provider, t)} 登录`,
          )}
        </a>
      ))}
    </div>
  );
}

function ProviderMark({ provider }: { provider: AuthProvider }) {
  return provider === "google" ? (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  ) : (
    <svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path fill="#F25022" d="M1 1h7.5v7.5H1z" />
      <path fill="#7FBA00" d="M9.5 1H17v7.5H9.5z" />
      <path fill="#00A4EF" d="M1 9.5h7.5V17H1z" />
      <path fill="#FFB900" d="M9.5 9.5H17V17H9.5z" />
    </svg>
  );
}

/**
 * Brand-bar account control. Hidden when the server has no sign-in
 * providers configured.
 */
export function AccountMenu({
  session,
  signingOut,
  notice,
  onSignOut,
  onDeleteData,
  onBeforeSignIn,
  onNoticeDismiss,
}: {
  session: AuthSession | null;
  signingOut: boolean;
  /** The outcome of the last sign-out or delete, shown in the panel. */
  notice: AccountNotice | null;
  onSignOut(): void;
  /** Deletes this account's saved edits and signs out everywhere. */
  onDeleteData(): void;
  onBeforeSignIn?: () => string | undefined;
  /** The panel closed: the notice it showed is done. */
  onNoticeDismiss?: () => void;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  // A notice belongs to an action taken in the panel: keep it in view,
  // and drop it once the panel closes.
  useEffect(() => {
    if (notice) setOpen(true);
  }, [notice]);
  useEffect(() => {
    if (!open && notice) onNoticeDismiss?.();
    // Only closing the panel dismisses; a new notice reopens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Signed out from inside the panel: the focused button is gone, so focus
  // the toggle instead of leaving keyboard users at the top of the page.
  const signedIn = Boolean(session?.user);
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    const lost = !document.activeElement || document.activeElement === document.body;
    if (wasSignedIn.current && !signedIn && open && lost) toggleRef.current?.focus();
    wasSignedIn.current = signedIn;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn]);

  useEffect(() => {
    if (!open) setConfirmingDelete(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        // Escape belongs to whatever widget has focus unless it is this menu.
        if (event.key !== "Escape" || !rootRef.current?.contains(document.activeElement))
          return;
        setOpen(false);
        // Do not strand keyboard focus on a button that just disappeared.
        toggleRef.current?.focus();
      } else if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!session || (!session.user && session.providers.length === 0)) return null;
  const user = session.user;
  const who = user?.email ?? user?.name ?? t("Signed in", "已登录");

  return (
    <div
      className="account-menu"
      ref={rootRef}
      // Tabbing out of the menu closes it (clicks inside never do).
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !rootRef.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={toggleRef}
        type="button"
        className="account-toggle"
        // Phones show only the icon, so the label stays the accessible name.
        aria-label={user ? who : t("Sign in", "登录")}
        aria-expanded={open}
        aria-controls="account-panel"
        onClick={() => setOpen(!open)}
      >
        {user ? (
          <>
            <UserRound size={16} aria-hidden="true" />
            <span className="account-email">{who}</span>
          </>
        ) : (
          <>
            <LogIn size={16} aria-hidden="true" />
            <span className="account-label">{t("Sign in", "登录")}</span>
          </>
        )}
      </button>
      {open && (
        <div
          id="account-panel"
          className="account-panel"
          role="group"
          aria-label={t("Account", "账户")}
        >
          {notice ? (
            <p
              className={`account-notice ${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          ) : null}
          {user ? (
            <>
              <p>
                {t(
                  `Signed in with ${providerLabel(user.provider, t)}`,
                  `已通过 ${providerLabel(user.provider, t)} 登录`,
                )}
                <strong>{who}</strong>
              </p>
              <p className="account-note">
                {t(
                  "Your watchlist edits are saved to this account and only you see them.",
                  "你的板块编辑保存在此账户中，只有你自己能看到。",
                )}
              </p>
              <div className="account-actions">
                <button type="button" disabled={signingOut} onClick={onSignOut}>
                  <LogOut size={15} aria-hidden="true" />
                  {t("Sign out", "退出登录")}
                </button>
                <button
                  type="button"
                  className={`account-delete ${confirmingDelete ? "confirming" : ""}`}
                  aria-describedby={confirmingDelete ? "account-delete-warning" : undefined}
                  disabled={signingOut}
                  onClick={() => {
                    if (!confirmingDelete) {
                      setConfirmingDelete(true);
                      return;
                    }
                    setConfirmingDelete(false);
                    onDeleteData();
                  }}
                >
                  <Trash2 size={15} aria-hidden="true" />
                  {confirmingDelete
                    ? t("Click again to delete", "再点一次确认删除")
                    : t("Delete my data", "删除我的数据")}
                </button>
              </div>
              {confirmingDelete ? (
                <p id="account-delete-warning" className="account-note" aria-live="polite">
                  {t(
                    "This permanently deletes your saved watchlist edits and signs you out on every device.",
                    "这会永久删除你保存的板块编辑，并在所有设备上退出登录。",
                  )}
                </p>
              ) : null}
              <PrivacyLink />
            </>
          ) : (
            <>
              <p className="account-note">
                {t(
                  "Sign in to keep your own version of the watchlists. Only your email and name are used.",
                  "登录后可以保存属于你自己的板块列表。只会使用你的邮箱和姓名。",
                )}
              </p>
              <SignInOptions
                providers={session.providers}
                onBeforeSignIn={onBeforeSignIn}
              />
              <PrivacyLink />
            </>
          )}
        </div>
      )}
    </div>
  );
}
