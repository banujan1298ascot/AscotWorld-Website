"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Warning, X } from "@phosphor-icons/react/dist/ssr";
import { LogoMark } from "./Logo";

/* -------------------------------------------------------------------------- */
/* Button                                                                     */
/* -------------------------------------------------------------------------- */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--primary)] text-[var(--primary-foreground)] hover:brightness-110 active:brightness-95 shadow-[var(--shadow-card)]",
  secondary:
    "bg-[var(--surface)] text-foreground border border-[var(--border-strong)] hover:bg-[var(--surface-sunken)]",
  ghost: "text-[var(--muted-foreground)] hover:bg-[var(--surface-sunken)] hover:text-foreground",
  danger: "bg-[var(--danger)] text-white hover:brightness-110",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  children,
  disabled,
  ...props
}: ButtonProps) {
  // Height meets the 44px touch minimum at md; sm is for dense toolbar rows
  // where a pointer is the expected input.
  const sizing = size === "sm" ? "h-8 px-2.5 text-[13px] gap-1.5" : "h-11 px-4 text-sm gap-2";
  return (
    <button
      className={`inline-flex items-center justify-center rounded-md font-semibold whitespace-nowrap
        transition-[background-color,color,filter] duration-150 cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none
        ${sizing} ${BUTTON_VARIANTS[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Status pill — colour is always paired with a text label                    */
/* -------------------------------------------------------------------------- */

export function StatusPill({
  label,
  color,
  background,
  icon,
  size = "md",
}: {
  label: string;
  color: string;
  background: string;
  icon?: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold whitespace-nowrap ${
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      }`}
      style={{ color, background }}
    >
      {icon}
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
  /** Adds a hover lift + glow — for cards that act like a link or button. */
  interactive?: boolean;
}

/** Forwards ref and every other div prop (style, listeners, aria-*, ...) so
 *  it can also serve as a dnd-kit draggable/droppable surface — see the MES
 *  pipeline board (src/app/(portal)/mes/page.tsx) for that usage. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { children, className = "", padded = true, interactive = false, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`rounded-lg border border-[var(--border)] bg-[var(--surface)]
        shadow-[var(--shadow-card)] ${padded ? "p-4" : ""} ${interactive ? "card-interactive" : ""} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
});

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-[var(--muted-foreground)] max-w-prose">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 opacity-30">
        <LogoMark size={38} />
      </div>
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-[var(--muted-foreground)]">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Placeholder shown while browser-stored data is read, so screens never flash
 *  a misleading "nothing here" state. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-[var(--surface-sunken)] ${className}`}
      aria-hidden="true"
    />
  );
}

export function Avatar({
  initials,
  size = 32,
  title,
}: {
  initials: string;
  size?: number;
  title?: string;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white select-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: "var(--brand-gradient)",
      }}
      title={title}
      aria-hidden={title ? undefined : "true"}
    >
      {initials}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Form controls                                                              */
/* -------------------------------------------------------------------------- */

const CONTROL_BASE = `w-full rounded-md border border-[var(--border-strong)] bg-[var(--surface)]
  px-3 text-sm text-foreground placeholder:text-[var(--subtle-foreground)]
  transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed`;

export function Field({
  label,
  required,
  error,
  helper,
  children,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  error?: string;
  helper?: string;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-bold text-foreground">
        {label}
        {required ? (
          <span className="ml-0.5 text-[var(--danger)]" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {/* Helper text persists rather than living in a placeholder. */}
      {helper && !error ? (
        <p className="mt-1 text-xs text-[var(--muted-foreground)]">{helper}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-1 text-xs font-semibold text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${CONTROL_BASE} h-11 ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${CONTROL_BASE} h-11 cursor-pointer ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${CONTROL_BASE} py-2.5 leading-relaxed ${className}`} {...props} />;
}

/** Compact select for filter bars, where the label sits inline. */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-[var(--muted-foreground)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 cursor-pointer rounded-md border border-[var(--border-strong)]
          bg-[var(--surface)] px-2 text-[13px] font-medium text-foreground"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Modal                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Built on the native <dialog> element, which brings a focus trap, Escape to
 * close and inert background content without reimplementing any of it.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Clicking the backdrop (the dialog element itself) dismisses.
        if (e.target === ref.current) onClose();
      }}
      className="m-auto w-[min(38rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)]
        bg-[var(--surface)] p-0 text-foreground shadow-[var(--shadow-overlay)]
        backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      {open ? (
        <div className="max-h-[85vh] overflow-y-auto">
          <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-5 py-4">
            <div>
              <h2 className="text-base font-extrabold tracking-tight">{title}</h2>
              {description ? (
                <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">{description}</p>
              ) : null}
            </div>
            <button
              onClick={onClose}
              aria-label="Close dialog"
              className="-mr-1 -mt-1 grid h-9 w-9 shrink-0 cursor-pointer place-items-center
                rounded-md text-[var(--muted-foreground)] transition-colors duration-150
                hover:bg-[var(--surface-sunken)] hover:text-foreground"
            >
              <X size={18} weight="bold" />
            </button>
          </div>

          <div className="px-5 py-4">{children}</div>

          {footer ? (
            <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-5 py-3">
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Read-only notice                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Something went wrong — a refused action, a failed save. Carries the danger
 * colour, an icon and a role of alert, so it reads as a failure rather than
 * as the neutral explanation `PermissionNotice` gives.
 */
export function ErrorNotice({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-[var(--danger)]/40 bg-[var(--danger-bg)]
        px-3 py-2 text-xs font-semibold text-[var(--danger)]"
    >
      <Warning size={15} weight="fill" className="mt-px shrink-0" />
      {message}
    </p>
  );
}

/** Explains *why* controls are unavailable rather than silently hiding them. */
export function PermissionNotice({ message }: { message: string }) {
  return (
    <div
      className="rounded-md border border-[var(--border)] bg-[var(--surface-sunken)]
        px-3 py-2 text-xs font-medium text-[var(--muted-foreground)]"
      role="note"
    >
      {message}
    </div>
  );
}
