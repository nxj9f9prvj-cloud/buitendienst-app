import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function RequireAuth({ children }) {
  const { loading, user } = useAuth()

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
  if (!user) return <Navigate to="/login" replace />
  return children
}
