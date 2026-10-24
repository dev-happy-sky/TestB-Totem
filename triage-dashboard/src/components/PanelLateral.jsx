"use client";
import React, { useState, useMemo } from 'react';
import { nombreCategoria } from '../lib/ia';
import { MENSAJE_SIN_RESPUESTA } from '../lib/errores';
import { ENLACES_DUOC } from './enlacesDuoc';
import { IconoExterno, IconoUsuario } from './iconos';

const ETIQUETA_ROL = { admin: 'Administrador', encargado: 'Encargado' };

const mensajeDe = (data) => {
  if (typeof data?.detail === 'string') return data.detail;
  if (Array.isArray(data?.detail) && data.detail[0]?.msg) return data.detail[0].msg.replace(/^Value error, /, '');
  return 'Revisa los datos ingresados.';
};

// Color de la insignia según la categoría de aptitud (A1 riesgo alto → A4 apto).
const COLOR_NIVEL = {
  A1: 'bg-red-500', A2: 'bg-orange-500', A3: 'bg-yellow-500', A4: 'bg-green-500',
};
const nivelDe = (e) => e.nivelFinal || e.iaSugerida;

// Iniciales para el avatar a partir del nombre de usuario.
const iniciales = (texto = '') =>
  texto.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '·';

// Agrupa las evaluaciones por socio (matrícula) y deja la más reciente de cada uno.
function alumnosUnicos(evaluaciones = []) {
  const porSocio = new Map();
  for (const e of evaluaciones) {
    const clave = e.id || e.matricula || e.idUnico;
    if (!clave) continue;
    const fecha = new Date(e.inicioEvaluacion || e.fecha || 0).getTime();
    const previo = porSocio.get(clave);
    if (!previo || fecha >= previo._fecha) porSocio.set(clave, { ...e, _fecha: fecha });
  }
  return [...porSocio.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Fila de navegación del menú principal del panel.
function ItemMenu({ icono, titulo, descripcion, badge, onClick }) {
  return (
    <button onClick={onClick}
            className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 rounded-xl transition">
      <span className="flex items-center justify-center w-10 h-10 rounded-full bg-duoc-50 text-duoc-700 shrink-0">{icono}</span>
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-slate-800 text-sm">{titulo}</span>
        {descripcion && <span className="block text-xs text-slate-400 truncate">{descripcion}</span>}
      </span>
      {badge != null && <span className="text-xs font-bold bg-oro-400 text-duoc-900 rounded-full px-2 py-0.5">{badge}</span>}
      <span aria-hidden className="text-slate-300">›</span>
    </button>
  );
}

// Panel lateral (estilo red social): avatar + perfil, edición y listado de alumnos.
export default function PanelLateral({ sesion, backendUrl, authHeaders, evaluaciones = [], onSesionInvalida, onLogout }) {
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState('menu');   // 'menu' | 'perfil' | 'editar' | 'alumnos'
  const [perfil, setPerfil] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(false);

  const alumnos = useMemo(() => alumnosUnicos(evaluaciones), [evaluaciones]);

  const cerrar = () => { setAbierto(false); setVista('menu'); setError(''); setAviso(''); };

  const cargarPerfil = async (siguiente) => {
    setVista(siguiente);
    setError('');
    setAviso('');
    if (perfil) return;      // ya cargado en esta sesión del panel
    setCargando(true);
    try {
      const res = await fetch(`${backendUrl}/api/perfil`, { headers: authHeaders });
      if (res.status === 401) { onSesionInvalida(); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(mensajeDe(data)); return; }
      setPerfil(data);
      setForm({ nombre: data.nombre, apellido: data.apellido || '', sucursal: data.sucursal || '',
                password_actual: '', password_nueva: '', confirmacion: '' });
    } catch {
      setError(MENSAJE_SIN_RESPUESTA);
    } finally {
      setCargando(false);
    }
  };

  const cambiar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const guardar = async (e) => {
    e.preventDefault();
    setError('');
    setAviso('');
    if (form.password_nueva && form.password_nueva !== form.confirmacion) {
      setError('La confirmación no coincide con la contraseña nueva.');
      return;
    }
    const cuerpo = { nombre: form.nombre, apellido: form.apellido, sucursal: form.sucursal };
    if (form.password_nueva) { cuerpo.password_actual = form.password_actual; cuerpo.password_nueva = form.password_nueva; }
    setCargando(true);
    try {
      const res = await fetch(`${backendUrl}/api/perfil`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify(cuerpo),
      });
      if (res.status === 401) { onSesionInvalida(); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(mensajeDe(data)); return; }
      setPerfil(data);
      setForm((f) => ({ ...f, password_actual: '', password_nueva: '', confirmacion: '' }));
      setAviso('Perfil actualizado.');
    } catch {
      setError(MENSAJE_SIN_RESPUESTA);
    } finally {
      setCargando(false);
    }
  };

  const campo = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-800 outline-none transition focus:border-duoc-500 focus:ring-2 focus:ring-duoc-500/30';
  const etiqueta = 'block text-xs font-semibold text-slate-500 mb-1';
  const nombreMostrado = perfil ? `${perfil.nombre} ${perfil.apellido || ''}`.trim() : sesion.usuario;

  return (
    <>
      {/* Botón hamburguesa (tres líneas) */}
      <button onClick={() => setAbierto(true)} aria-label="Abrir menú" aria-haspopup="dialog" aria-expanded={abierto}
              className="flex items-center gap-1.5 h-10 pl-2.5 pr-2 rounded-lg border border-white/25 bg-white/10 text-white hover:bg-white/20 transition">
        <IconoUsuario className="w-5 h-5" />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5" aria-hidden>
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Fondo oscuro */}
      {abierto && <div className="fixed inset-0 bg-black/40 z-40" onClick={cerrar} aria-hidden />}

      {/* Cajón lateral derecho */}
      <aside role="dialog" aria-modal="true" aria-label="Menú del encargado"
             className={`fixed top-0 right-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col transition-transform duration-300 ${abierto ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Cabecera con avatar (estilo perfil) */}
        <div className="bg-gradient-to-br from-duoc-700 to-duoc-500 text-white p-5">
          <div className="flex justify-end">
            <button onClick={cerrar} aria-label="Cerrar menú" className="text-white/80 hover:text-white text-2xl leading-none">×</button>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 ring-2 ring-white/40 text-xl font-black">
              {iniciales(nombreMostrado)}
            </span>
            <div className="min-w-0">
              <p className="font-bold text-lg truncate">{nombreMostrado}</p>
              <p className="text-white/80 text-sm">{ETIQUETA_ROL[sesion.rol] || sesion.rol}</p>
            </div>
          </div>
        </div>

        {/* Barra de navegación interna (volver) */}
        {vista !== 'menu' && (
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
            <button onClick={() => { setVista('menu'); setError(''); setAviso(''); }}
                    className="flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
              ‹ Volver
            </button>
            <span className="text-sm font-bold text-slate-800 ml-1">
              {vista === 'perfil' ? 'Mi perfil' : vista === 'editar' ? 'Editar perfil' : 'Alumnos registrados'}
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {/* MENÚ PRINCIPAL */}
          {vista === 'menu' && (
            <nav className="p-2 space-y-1">
              <ItemMenu titulo="Mi perfil" descripcion="Ver tus datos de cuenta" onClick={() => cargarPerfil('perfil')}
                        icono={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>} />
              <ItemMenu titulo="Editar perfil" descripcion="Nombre, sucursal y contraseña" onClick={() => cargarPerfil('editar')}
                        icono={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>} />
              <ItemMenu titulo="Alumnos registrados" descripcion="Con sus últimos signos vitales" badge={alumnos.length}
                        onClick={() => { setVista('alumnos'); setError(''); setAviso(''); }}
                        icono={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>} />

              <p className="px-4 pt-3 pb-1 text-[11px] font-bold text-slate-400 uppercase tracking-wide">Accesos Duoc</p>
              {ENLACES_DUOC.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                   className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 rounded-xl transition">
                  <span className="flex items-center justify-center w-10 h-10 rounded-full bg-duoc-50 text-duoc-700 shrink-0"><IconoExterno className="w-5 h-5" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-semibold text-slate-800 text-sm">{l.nombre}</span>
                    <span className="block text-xs text-slate-400 truncate">{l.desc}</span>
                  </span>
                  <span aria-hidden className="text-slate-300">↗</span>
                </a>
              ))}

              <div className="border-t border-slate-100 my-2" />
              <button onClick={() => { cerrar(); onLogout(); }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-red-50 rounded-xl transition text-red-600">
                <span className="flex items-center justify-center w-10 h-10 rounded-full bg-red-50 shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
                </span>
                <span className="font-semibold text-sm">Cerrar sesión</span>
              </button>
            </nav>
          )}

          {/* VER PERFIL */}
          {vista === 'perfil' && (
            <div className="p-5 text-sm text-slate-800 space-y-4">
              {cargando && !perfil && <p className="text-slate-500">Cargando…</p>}
              {error && !perfil && <p className="text-red-600" role="alert">{error}</p>}
              {perfil && (
                <>
                  <dl className="space-y-3">
                    {[['Nombre', `${perfil.nombre} ${perfil.apellido || ''}`.trim()],
                      ['Usuario', perfil.email],
                      ['Rol', ETIQUETA_ROL[perfil.rol] || perfil.rol],
                      ['Sucursal', perfil.sucursal || '—']].map(([t, v]) => (
                      <div key={t} className="flex flex-col">
                        <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{t}</dt>
                        <dd className="text-slate-800">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <button onClick={() => setVista('editar')}
                          className="w-full bg-duoc-700 hover:bg-duoc-800 text-white font-bold rounded-xl py-2.5 transition">
                    Editar perfil
                  </button>
                </>
              )}
            </div>
          )}

          {/* EDITAR PERFIL */}
          {vista === 'editar' && (
            <div className="p-5">
              {cargando && !perfil && <p className="text-slate-500 text-sm">Cargando…</p>}
              {error && !perfil && <p className="text-red-600 text-sm" role="alert">{error}</p>}
              {perfil && form && (
                <form onSubmit={guardar} className="space-y-3 text-sm">
                  <div><label className={etiqueta} htmlFor="pl-nombre">Nombre</label>
                    <input id="pl-nombre" className={campo} value={form.nombre} onChange={cambiar('nombre')} required /></div>
                  <div><label className={etiqueta} htmlFor="pl-apellido">Apellido</label>
                    <input id="pl-apellido" className={campo} value={form.apellido} onChange={cambiar('apellido')} /></div>
                  <div><label className={etiqueta} htmlFor="pl-sucursal">Sucursal</label>
                    <input id="pl-sucursal" className={campo} value={form.sucursal} onChange={cambiar('sucursal')} /></div>
                  <p className="text-xs text-slate-500">Usuario: {perfil.email} · Rol: {ETIQUETA_ROL[perfil.rol] || perfil.rol} (los define un administrador)</p>
                  <fieldset className="border-t border-slate-100 pt-3 space-y-3">
                    <legend className="text-xs font-semibold text-slate-500">Cambiar contraseña (opcional)</legend>
                    <input aria-label="Contraseña actual" type="password" autoComplete="current-password" placeholder="Contraseña actual"
                           className={campo} value={form.password_actual} onChange={cambiar('password_actual')} />
                    <input aria-label="Contraseña nueva" type="password" autoComplete="new-password" placeholder="Contraseña nueva (mín. 8)"
                           className={campo} value={form.password_nueva} onChange={cambiar('password_nueva')} />
                    <input aria-label="Confirmar contraseña nueva" type="password" autoComplete="new-password" placeholder="Repite la contraseña nueva"
                           className={campo} value={form.confirmacion} onChange={cambiar('confirmacion')} />
                  </fieldset>
                  {error && <p className="text-red-600" role="alert">{error}</p>}
                  {aviso && <p className="text-green-700" role="status">{aviso}</p>}
                  <button type="submit" disabled={cargando}
                          className="w-full bg-duoc-700 hover:bg-duoc-800 text-white font-bold rounded-xl py-2.5 transition disabled:opacity-60">
                    {cargando ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ALUMNOS REGISTRADOS */}
          {vista === 'alumnos' && (
            <div className="p-4">
              <div className="flex items-baseline gap-2 mb-3 px-1">
                <span className="text-3xl font-black text-slate-800">{alumnos.length}</span>
                <span className="text-sm text-slate-500">{alumnos.length === 1 ? 'alumno registrado' : 'alumnos registrados'}</span>
              </div>
              {alumnos.length === 0 ? (
                <p className="text-sm text-slate-400 px-1 py-8 text-center">Todavía no hay alumnos con evaluaciones.</p>
              ) : (
                <ul className="space-y-2">
                  {alumnos.map((a) => {
                    const nivel = nivelDe(a);
                    const m = a.mediciones || {};
                    return (
                      <li key={a.id || a.idUnico} className="border border-slate-100 rounded-xl p-3 flex items-center gap-3">
                        <span className={`w-9 h-9 shrink-0 rounded-lg text-white font-bold text-sm flex items-center justify-center ${COLOR_NIVEL[nivel] || 'bg-slate-400'}`}>
                          {nivel || '—'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 text-sm truncate">{a.nombre}</p>
                          <p className="text-xs text-slate-500">{nombreCategoria(nivel)}</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            PA {m.presionSys || '--'}/{m.presionDia || '--'} · FC {m.fcReposo || '--'} · SpO₂ {m.spo2 ?? '--'}% · IMC {m.imc || '--'}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
