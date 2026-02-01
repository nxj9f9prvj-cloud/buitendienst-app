import React, { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { login, user, loading } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await login(email, password)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err.message || 'Login mislukt')
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#2d1b1b',
          color: '#fef2f2',
        }}
      >
        <div>Loading...</div>
      </div>
    )
  }
  if (user) return <Navigate to="/app" replace />

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#2d1b1b',
        backgroundImage: 'linear-gradient(to bottom, #3d2525 0%, #2d1b1b 100%)',
        padding: '20px',
      }}
    >
      <div
        style={{
          maxWidth: '400px',
          width: '100%',
          backgroundColor: 'rgba(45, 27, 27, 0.6)',
          padding: '32px',
          borderRadius: '12px',
          border: '1px solid rgba(220, 38, 38, 0.2)',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
        }}
      >
        <h1 style={{ fontSize: '28px', fontWeight: 600, marginBottom: '24px', color: '#fef2f2' }}>
          Buitendienst – Login
        </h1>
        {error && (
          <div
            style={{
              color: '#fca5a5',
              marginBottom: '16px',
              padding: '12px',
              backgroundColor: 'rgba(220, 38, 38, 0.15)',
              borderRadius: '6px',
              border: '1px solid rgba(220, 38, 38, 0.3)',
            }}
          >
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            required
            style={{
              padding: '12px',
              fontSize: '16px',
              borderRadius: '6px',
              border: '1px solid rgba(220, 38, 38, 0.3)',
              backgroundColor: 'rgba(45, 27, 27, 0.8)',
              color: '#fef2f2',
              outline: 'none',
            }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Wachtwoord"
            required
            style={{
              padding: '12px',
              fontSize: '16px',
              borderRadius: '6px',
              border: '1px solid rgba(220, 38, 38, 0.3)',
              backgroundColor: 'rgba(45, 27, 27, 0.8)',
              color: '#fef2f2',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              padding: '12px',
              fontSize: '16px',
              fontWeight: 500,
              borderRadius: '6px',
              border: '1px solid rgba(220, 38, 38, 0.4)',
              backgroundColor: 'rgba(220, 38, 38, 0.2)',
              color: '#fef2f2',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              opacity: isSubmitting ? 0.6 : 1,
            }}
          >
            {isSubmitting ? 'Bezig...' : 'Inloggen'}
          </button>
        </form>
      </div>
    </div>
  )
}
