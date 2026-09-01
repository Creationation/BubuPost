import { useEffect } from 'react'
import type { ReactNode } from 'react'

export function Chip({ className = '', children }: { className?: string; children: ReactNode }) {
  return <span className={`chip ${className}`}>{children}</span>
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight lg:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-mist-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Alert({ kind, children }: { kind: 'error' | 'ok' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-bad-600/50 bg-bad-600/10 text-bad-400',
    ok: 'border-ok-600/50 bg-ok-600/10 text-ok-400',
    info: 'border-ink-700 bg-ink-850 text-mist-300',
  }[kind]
  return <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`}>{children}</div>
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="panel px-6 py-14 text-center">
      <div className="mx-auto mb-3 text-2xl opacity-50">{icon}</div>
      <p className="font-semibold">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-md text-sm text-mist-500">{hint}</p>}
    </div>
  )
}

export function Loading({ label = 'Chargement...' }: { label?: string }) {
  return <p className="py-10 text-center text-sm text-mist-500">{label}</p>
}

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-sm">
      <div
        className={`panel my-8 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-ink-800 px-5 py-4">
          <h2 className="font-semibold">{title}</h2>
          <button
            className="rounded-lg px-2 py-1 text-mist-500 hover:bg-ink-800 hover:text-mist-100"
            onClick={onClose}
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

/** Confirmation maison : window.confirm bloque l'onglet et rend mal sur mobile. */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirmer',
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p className="text-sm text-mist-300">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn btn-ghost" onClick={onClose}>
          Annuler
        </button>
        <button
          className={danger ? 'btn btn-danger' : 'btn btn-primary'}
          onClick={() => {
            onConfirm()
            onClose()
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}
