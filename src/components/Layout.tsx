import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/posts', label: 'Publications', icon: '▤', end: false },
  { to: '/accounts', label: 'Comptes', icon: '◍', end: false },
]

function navClass({ isActive }: { isActive: boolean }) {
  return [
    'flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-brand-500/15 text-mist-100 border border-brand-500/30'
      : 'text-mist-500 hover:text-mist-100 hover:bg-ink-800 border border-transparent',
  ].join(' ')
}

export default function Layout() {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-full lg:flex">
      <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:shrink-0 border-r border-ink-800 p-4">
        <div className="mb-8 flex items-center gap-2 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15 border border-brand-500/30 text-sm">
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

        <div className="mt-auto pt-4 border-t border-ink-800">
          <p className="px-2 pb-2 text-xs text-mist-600 truncate">{user?.email}</p>
          <button className="btn btn-ghost w-full" onClick={() => void signOut()}>
            Deconnexion
          </button>
        </div>
      </aside>

      <header className="lg:hidden sticky top-0 z-20 flex items-center justify-between border-b border-ink-800 bg-ink-950/85 px-4 py-3 backdrop-blur">
        <span className="font-bold tracking-tight">BubuPost</span>
        <button className="btn btn-ghost !py-1.5 !px-3" onClick={() => void signOut()}>
          Quitter
        </button>
      </header>

      <main className="flex-1 min-w-0 px-4 pb-24 pt-6 lg:px-8 lg:pb-10">
        <Outlet />
      </main>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 grid grid-cols-3 gap-1 border-t border-ink-800 bg-ink-950/95 p-2 backdrop-blur">
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
