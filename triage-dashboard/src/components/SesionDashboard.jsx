"use client";
import React, { useState, useEffect, useCallback } from 'react';
import DashboardAptitud from './DashboardAptitud';
import { MENSAJE_SIN_RESPUESTA, describirServidor, mensajeErrorLogin } from '../lib/errores';

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://totem-backend-g6yh.onrender.com';
const INACTIVIDAD_MS = 15 * 60 * 1000; // R.174: cierre de sesión tras 15 min sin actividad
const CLAVE_SESION = 'totem_sesion';

export default function SesionDashboard() {
  const [sesion, setSesion] = useState(null);
  const [listo, setListo] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // sessionStorage: el token no sobrevive al cerrar la pestaña (R.173)
  useEffect(() => {
    try {
      const guardada = sessionStorage.getItem(CLAVE_SESION);
      if (guardada) setSesion(JSON.parse(guardada));
    } catch { /* sin almacenamiento disponible */ }
    setListo(true);
  }, []);

  const cerrarSesion = useCallback((mensaje = '') => {
    try { sessionStorage.removeItem(CLAVE_SESION); } catch { /* noop */ }
    setSesion(null);
    setPassword('');
    setError(mensaje);
  }, []);

  useEffect(() => {
    if (!sesion) return;
    let timer;
    const reiniciar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cerrarSesion('Sesión cerrada por inactividad.'), INACTIVIDAD_MS);
    };
    const eventos = ['mousemove', 'keydown', 'click', 'touchstart'];
    eventos.forEach(e => window.addEventListener(e, reiniciar));
    reiniciar();
    return () => {
      clearTimeout(timer);
      eventos.forEach(e => window.removeEventListener(e, reiniciar));
    };
  }, [sesion, cerrarSesion]);

  const iniciarSesion = async (e) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usuario, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(mensajeErrorLogin(res.status, data));
        return;
      }
      const nueva = { token: data.token, rol: data.rol, usuario: data.usuario };
      try { sessionStorage.setItem(CLAVE_SESION, JSON.stringify(nueva)); } catch { /* noop */ }
      setSesion(nueva);
      setPassword('');
    } catch {
      setError(MENSAJE_SIN_RESPUESTA);
    } finally {
      setCargando(false);
    }
  };

  if (!listo) return null;

  if (sesion) {
    return <DashboardAptitud sesion={sesion} onSesionInvalida={() => cerrarSesion('Tu sesión expiró. Ingresa nuevamente.')} onLogout={() => cerrarSesion()} />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <form onSubmit={iniciarSesion} className="w-full max-w-sm bg-white rounded-2xl shadow p-8 space-y-4">
        <h1 className="text-xl font-bold text-slate-800">Panel del encargado</h1>
        <p className="text-sm text-slate-500">Ingresa con tu cuenta autorizada para ver las evaluaciones.</p>
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
          placeholder="Usuario" autoComplete="username"
          value={usuario} onChange={(e) => setUsuario(e.target.value)} required
        />
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-800"
          type="password" placeholder="Contraseña" autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required
        />
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        <button type="submit" disabled={cargando} className="w-full bg-orange-600 text-white font-bold rounded-lg py-2 disabled:opacity-60">
          {cargando ? 'Ingresando…' : 'Ingresar'}
        </button>
        <p className="text-xs text-slate-400 text-center">Servidor: {describirServidor(BACKEND_URL)}</p>
      </form>
    </div>
  );
}
