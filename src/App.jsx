import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { ErpRoleProvider } from './auth/ErpRoleContext'
import { RequireAuth } from './auth/RequireAuth'
import { useAuth } from './auth/useAuth'
import { LoginPage } from './pages/LoginPage'
import PlanningPageView from './modules/buitendienst/PlanningPageView'
import PublicBon from './PublicBon'
import { usePushNotifications } from './hooks/usePushNotifications'

function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: '20px', color: '#f1f5f9' }}>Laden…</div>
  if (user) return <Navigate to="/app" replace />
  return <Navigate to="/login" replace />
}

function NoMatch() {
  const loc = useLocation()
  return (
    <div style={{ padding: 20, minHeight: '100vh', background: '#0f172a', color: '#f1f5f9' }}>
      <p>Pagina niet gevonden: <code>{loc.pathname}</code></p>
      <p><a href="/login" style={{ color: '#60a5fa' }}>Naar login</a></p>
    </div>
  )
}

/** Initialiseer push-notificaties voor ingelogde gebruikers. */
function PushInit() {
  usePushNotifications()
  return null
}

function App() {
  return (
    <AuthProvider>
      <ErpRoleProvider>
        <PushInit />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/app"
              element={
                <RequireAuth>
                  <PlanningPageView />
                </RequireAuth>
              }
            />
            <Route path="/bon/:token" element={<PublicBon />} />
            <Route path="/" element={<RootRedirect />} />
            <Route path="*" element={<NoMatch />} />
          </Routes>
        </BrowserRouter>
      </ErpRoleProvider>
    </AuthProvider>
  )
}

export default App
