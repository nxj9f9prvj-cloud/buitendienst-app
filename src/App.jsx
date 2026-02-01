import { BrowserRouter, Routes, Route, Navigate, useLocation, Link } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { LoginPage } from './pages/LoginPage'
import MijnPlanningPage from './modules/buitendienst/MijnPlanningPage'
import PublicBon from './PublicBon'

function RootRedirect() {
  const { user, loading } = useAuth()

  if (loading) return <div style={{ padding: '20px' }}>Loading...</div>
  if (user) return <Navigate to="/app" replace />
  return <Navigate to="/login" replace />
}

function NoMatch() {
  const loc = useLocation()
  return (
    <div style={{ padding: 20, minHeight: '100vh', background: '#f8fafc', color: '#1e293b' }}>
      <p>Pagina niet gevonden: <code>{loc.pathname}</code></p>
      <p><Link to="/">Naar start</Link></p>
      <p><Link to="/login">Naar login</Link></p>
      <p><Link to="/app">Naar planning</Link> (na inloggen)</p>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/app"
            element={
              <RequireAuth>
                <MijnPlanningPage />
              </RequireAuth>
            }
          />
          <Route path="/bon/:token" element={<PublicBon />} />
          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<NoMatch />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
