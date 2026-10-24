"use client";
import React, { useState, useEffect, useCallback } from 'react';
import DashboardAptitud from './DashboardAptitud';
import Bienvenida from './Bienvenida';
import { MENSAJE_SIN_RESPUESTA, describirServidor, mensajeErrorLogin } from '../lib/errores';
import { IconoMancuerna, IconoUsuario, IconoCandado, IconoOjo, IconoOjoTachado } from './iconos';

export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://totem-backend-g6yh.onrender.com';
const INACTIVIDAD_MS = 15 * 60 * 1000; // R.174: cierre de sesión tras 15 min sin actividad
const CLAVE_SESION = 'totem_sesion';
// Con el backend sin seguridad (SEGURIDAD_ACTIVA=false) no hay login: el panel se abre directo.
const SESION_ABIERTA = { token: null, rol: 'admin', usuario: 'Sin seguridad' };

// Área autenticada: alterna entre la página de bienvenida (inicio) y el dashboard.
function AppAutenticada({ sesion, sinSeguridad = false, backendUrl, onSesionInvalida, onLogout }) {
  const [vista, setVista] = useState('inicio');   // 'inicio' | 'dashboard'

  if (vista === 'dashboard') {
    return (
      <DashboardAptitud sesion={sesion} sinSeguridad={sinSeguridad}
                        vista={vista} onNavegar={setVista}
                        onSesionInvalida={onSesionInvalida} onLogout={onLogout} />
    );
  }

  const authHeaders = sesion.token ? { Authorization: `Bearer ${sesion.token}` } : {};
  return (
    <Bienvenida sesion={sesion} sinSeguridad={sinSeguridad} backendUrl={backendUrl}
                authHeaders={authHeaders} vista={vista} onNavegar={setVista}
                onSesionInvalida={onSesionInvalida} onLogout={onLogout} />
  );
}

export default function SesionDashboard() {
  const [sesion, setSesion] = useState(null);
  const [listo, setListo] = useState(false);
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const [verClave, setVerClave] = useState(false);
  const [seguridad, setSeguridad] = useState(null);   // null = consultando al backend

  // sessionStorage: el token no sobrevive al cerrar la pestaña (R.173)
  useEffect(() => {
    try {
      const guardada = sessionStorage.getItem(CLAVE_SESION);
      if (guardada) setSesion(JSON.parse(guardada));
    } catch { /* sin almacenamiento disponible */ }
    setListo(true);
  }, []);

  // El backend informa si exige login. Si no responde o no tiene este endpoint (versión antigua), se asume que sí.
  useEffect(() => {
    let activo = true;
    fetch(`${BACKEND_URL}/api/configuracion`)
      .then((res) => (res.ok ? res.json() : {}))
      .then((config) => { if (activo) setSeguridad(config?.seguridad !== false); })
      .catch(() => { if (activo) setSeguridad(true); });
    return () => { activo = false; };
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

  // Mientras se restaura la sesión y se consulta la configuración del backend.
  // Pantalla de carga de marca (no un vacío oscuro): el backend en Render puede
  // tardar en "despertar" (arranque en frío).
  if (!listo || seguridad === null) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] p-6 text-center">
        <span className="flex items-center justify-center w-14 h-14 rounded-2xl bg-duoc-700 text-oro-400 mb-5">
          <IconoMancuerna className="w-7 h-7" />
        </span>
        <span aria-hidden className="w-8 h-8 rounded-full border-[3px] border-duoc-100 border-t-duoc-700 animate-spin" />
        <p className="mt-4 text-slate-600 font-semibold" role="status">Conectando con el servidor…</p>
        <p className="mt-1 text-xs text-slate-400 max-w-xs">
          Si es la primera visita en un rato, el servidor puede tardar unos segundos en responder.
        </p>
      </div>
    );
  }

  if (seguridad === false) {
    return <AppAutenticada sesion={SESION_ABIERTA} sinSeguridad backendUrl={BACKEND_URL}
                           onSesionInvalida={() => {}} onLogout={() => {}} />;
  }

  if (sesion) {
    return <AppAutenticada sesion={sesion} backendUrl={BACKEND_URL}
                           onSesionInvalida={() => cerrarSesion('Tu sesión expiró. Ingresa nuevamente.')}
                           onLogout={() => cerrarSesion()} />;
  }

  return (
    <div className="min-h-screen flex items-stretch bg-[var(--background)]">
      {/* Columna de marca: visible en pantallas medianas y grandes */}
      <aside className="hidden md:flex md:w-1/2 lg:w-[55%] relative overflow-hidden bg-gradient-to-br from-duoc-700 via-duoc-700 to-duoc-500 text-white p-12 flex-col justify-between">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25">
          <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-oro-400/40 blur-3xl" />
          <div className="absolute bottom-0 -left-20 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
        </div>
        <div className="relative flex items-center gap-3">
          <span className="flex items-center justify-center w-11 h-11 rounded-xl bg-oro-400 text-duoc-800">
            <IconoMancuerna className="w-6 h-6" />
          </span>
          <span className="text-lg font-black tracking-tight">TÓTEM<span className="font-light text-oro-400"> FIT</span></span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-black leading-tight">Aptitud física,<br />bajo control.</h2>
          <p className="mt-4 text-white/80 leading-relaxed">
            Revisa las evaluaciones del tótem, valida los signos vitales de tus socios y lleva el seguimiento de cada alumno desde un solo panel.
          </p>
        </div>
        <p className="relative text-xs text-white/60">Panel del encargado · Evaluación de aptitud física</p>
      </aside>

      {/* Columna del formulario */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          {/* Marca compacta para móvil */}
          <div className="md:hidden flex items-center justify-center gap-2 mb-8">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-duoc-700 text-oro-400">
              <IconoMancuerna className="w-5 h-5" />
            </span>
            <span className="text-lg font-black tracking-tight text-duoc-800">TÓTEM<span className="font-light text-duoc-500"> FIT</span></span>
          </div>

          <form onSubmit={iniciarSesion} className="bg-white rounded-2xl shadow-xl shadow-duoc-900/10 border border-slate-100 p-8 space-y-5">
            <div>
              <h1 className="text-2xl font-black text-duoc-800">Bienvenido de vuelta</h1>
              <p className="text-sm text-slate-500 mt-1">Ingresa con tu cuenta autorizada para ver las evaluaciones.</p>
            </div>

            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-1.5">Usuario</span>
              <div className="relative">
                <span aria-hidden className="absolute inset-y-0 left-3 flex items-center text-slate-400"><IconoUsuario className="w-5 h-5" /></span>
                <input
                  className="w-full border border-slate-300 rounded-xl pl-10 pr-3 py-2.5 text-slate-800 placeholder-slate-400 outline-none transition focus:border-duoc-500 focus:ring-2 focus:ring-duoc-500/30"
                  placeholder="tu.correo@ejemplo.com" autoComplete="username"
                  value={usuario} onChange={(e) => setUsuario(e.target.value)} required
                />
              </div>
            </label>

            <label className="block">
              <span className="block text-xs font-semibold text-slate-500 mb-1.5">Contraseña</span>
              <div className="relative">
                <span aria-hidden className="absolute inset-y-0 left-3 flex items-center text-slate-400"><IconoCandado className="w-5 h-5" /></span>
                <input
                  className="w-full border border-slate-300 rounded-xl pl-10 pr-11 py-2.5 text-slate-800 placeholder-slate-400 outline-none transition focus:border-duoc-500 focus:ring-2 focus:ring-duoc-500/30"
                  type={verClave ? 'text' : 'password'} placeholder="••••••••" autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} required
                />
                <button type="button" onClick={() => setVerClave((v) => !v)}
                        aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        className="absolute inset-y-0 right-2 flex items-center px-2 text-slate-400 hover:text-slate-600 rounded-lg">
                  {verClave ? <IconoOjoTachado className="w-5 h-5" /> : <IconoOjo className="w-5 h-5" />}
                </button>
              </div>
            </label>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">{error}</p>
            )}

            <button type="submit" disabled={cargando}
                    className="w-full bg-duoc-700 hover:bg-duoc-800 active:bg-duoc-900 text-white font-bold rounded-xl py-2.5 transition disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-duoc-700/20">
              {cargando ? 'Ingresando…' : 'Ingresar'}
            </button>

            <p className="text-xs text-slate-400 text-center pt-1">Servidor: {describirServidor(BACKEND_URL)}</p>
          </form>
        </div>
      </div>
    </div>
  );
}
