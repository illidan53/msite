import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { useLocale } from "../../shared/locale";

interface AuthState {
  enabled: boolean;
  clientId: string | null;
  nonce: string | null;
  user: { email: string; owner: boolean } | null;
}
interface GoogleIdentity {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback(response: { credential: string }): void;
    auto_select: boolean;
  }): void;
  renderButton(
    element: HTMLElement,
    options: { theme: string; size: string; locale: string; text: string },
  ): void;
  disableAutoSelect(): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}
let scriptPromise: Promise<void> | undefined;
function loadGoogle() {
  if (window.google) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        scriptPromise = undefined;
        reject(new Error("Google unavailable"));
      };
      document.head.append(script);
    });
  return scriptPromise;
}

export function GoogleAccount() {
  const { t, locale } = useLocale();
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const button = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    setError(false);
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return res.json() as Promise<AuthState>;
      })
      .then((state) => {
        if (alive) setAuth(state);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [open, retry]);
  useEffect(() => {
    if (!open || !auth?.enabled || auth.user || !auth.clientId || !auth.nonce)
      return;
    let alive = true;
    loadGoogle()
      .then(() => {
        if (!alive || !button.current) return;
        const google = window.google!.accounts.id;
        google.initialize({
          client_id: auth.clientId!,
          nonce: auth.nonce!,
          auto_select: false,
          callback: async ({ credential }) => {
            setBusy(true);
            setError(false);
            try {
              const res = await fetch("/api/auth/google", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credential }),
              });
              if (!res.ok) throw new Error();
              window.location.reload(); // Refresh all server-provided permissions together.
            } catch {
              setError(true);
              setBusy(false);
            }
          },
        });
        button.current.replaceChildren();
        google.renderButton(button.current, {
          theme: "outline",
          size: "large",
          locale: locale === "zh" ? "zh_CN" : "en",
          text: "signin_with",
        });
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [auth, open, locale]);
  const logout = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) throw new Error();
      window.google?.accounts.id.disableAutoSelect();
      window.location.reload();
    } catch {
      setError(true);
      setBusy(false);
    }
  };
  return (
    <details
      className="google-account"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {auth?.user ? (
          <UserRound size={16} aria-hidden="true" />
        ) : (
          <LogIn size={16} aria-hidden="true" />
        )}
        {auth?.user
          ? auth.user.owner
            ? t("Site owner", "站长")
            : t("Visitor", "访客")
          : t("Google sign-in", "Google 登录")}
      </summary>
      {open && (
        <div className="google-account-panel" aria-busy={busy}>
          {auth?.user ? (
            <>
              <strong>
                {auth.user.owner
                  ? t("Site owner", "站长")
                  : t("Visitor", "访客")}
              </strong>
              <span className="account-email">{auth.user.email}</span>
              <p>
                {auth.user.owner
                  ? t(
                      "You can manage Owner Focus and run research.",
                      "你可以编辑站长关注并运行研究。",
                    )
                  : t(
                      "This account has viewing access only.",
                      "此账号仅有浏览权限。",
                    )}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void logout()}
              >
                <LogOut size={16} aria-hidden="true" />
                {t("Sign out", "退出登录")}
              </button>
            </>
          ) : (
            <>
              <strong>
                {t("Sign in with Google", "使用 Google 账号登录")}
              </strong>
              <p>
                {t(
                  "The site owner's account unlocks management tools.",
                  "站长账号登录后可使用管理功能。",
                )}
              </p>
              {!auth && !error && (
                <span role="status">{t("Loading…", "正在加载…")}</span>
              )}
              {auth && !auth.enabled && (
                <p role="status">
                  {t(
                    "Google sign-in is awaiting setup. Please try again later.",
                    "Google 登录尚在配置中，请稍后再试。",
                  )}
                </p>
              )}
              <div ref={button} hidden={busy || error} />
              {busy && (
                <span role="status">{t("Signing in…", "正在登录…")}</span>
              )}
            </>
          )}
          {error && (
            <div role="alert">
              <p>
                {t(
                  "Sign-in service unavailable. Please retry.",
                  "登录服务暂时不可用，请重试。",
                )}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAuth(null);
                  setRetry((n) => n + 1);
                }}
              >
                {t("Retry", "重试")}
              </button>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
