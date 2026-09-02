import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/posts', label: 'Publications', icon: '▤', end: false },
  { to: '/accounts', label: 'Comptes', icon: '◍', end: false },
  { to: '/consignes', label: 'Textes', icon: '✎', end: false },
  { to: '/guide', label: 'Guide', icon: '◎', end: false },
  { to: '/admin', label: 'Admin', icon: '⚙', end: false },
]

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'border border-brand-500/30 bg-brand-500/15 text-mist-100'
      : 'border border-transparent text-mist-500 hover:bg-ink-800 hover:text-mist-100',
  ].join(' ')
}

function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist-600 ${className}`}>
      <Link to="/terms" className="hover:text-mist-300">
        Terms of Service
      </Link>
      <Link to="/privacy" className="hover:text-mist-300">
        Privacy Policy
      </Link>
    </div>
  )
}

export default function Layout() {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-full lg:flex">
      <aside className="hidden border-r border-ink-800 p-4 lg:flex lg:w-60 lg:shrink-0 lg:flex-col">
        <div className="mb-8 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/15 text-sm">
            🚀
          </span>
          <span className="font-bold tracking-tight">BubuPost</span>
        </div>

        <nav className="flex flex-col gap-1">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
              <span className="text-xs opacity-70">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-3 border-t border-ink-800 pt-4">
          <p className="truncate px-2 text-xs text-mist-600">{user?.email}</p>
          <button className="btn btn-ghost w-full" onClick={() => void signOut()}>
            Deconnexion
          </button>
          <LegalLinks className="px-2" />
        </div>
      </aside>

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-ink-800 bg-ink-950/85 px-4 py-3 backdrop-blur lg:hidden">
        <span className="font-bold tracking-tight">BubuPost</span>
        <button className="btn btn-ghost !px-3 !py-1.5" onClick={() => void signOut()}>
          Quitter
        </button>
      </header>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 px-4 pt-6 pb-24 lg:px-8 lg:pb-10">
          <Outlet />
        </main>

        <footer className="border-t border-ink-800 px-4 py-5 lg:px-8">
          <LegalLinks />
        </footer>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-6 gap-1 border-t border-ink-800 bg-ink-950/95 p-2 backdrop-blur lg:hidden">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
            <span className="mx-auto flex flex-col items-center gap-0.5">
              <span className="text-xs opacity-70">{item.icon}</span>
              <span className="text-[11px]">{item.label}</span>
            </span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
