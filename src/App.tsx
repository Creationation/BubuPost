import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Posts from './pages/Posts'
import Accounts from './pages/Accounts'
import Admin from './pages/Admin'
import Guide from './pages/Guide'
import Consignes from './pages/Consignes'
import TikTokCallback from './pages/TikTokCallback'
import MetaCallback from './pages/MetaCallback'
import YoutubeCallback from './pages/YoutubeCallback'
import { Privacy, Terms } from './pages/Legal'

/** Les pages protegees, derriere le login. */
function Private() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="grid min-h-full place-items-center">
        <p className="text-sm text-mist-500">Chargement...</p>
      </div>
    )
  }

  if (!session) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="posts" element={<Posts />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="consignes" element={<Consignes />} />
        <Route path="guide" element={<Guide />} />
        <Route path="admin" element={<Admin />} />
      </Route>
      <Route path="auth/tiktok/callback" element={<TikTokCallback />} />
      <Route path="auth/meta/callback" element={<MetaCallback />} />
      <Route path="auth/youtube/callback" element={<YoutubeCallback />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Publiques : les reviewers des plateformes doivent y acceder sans compte. */}
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/*" element={<Private />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
