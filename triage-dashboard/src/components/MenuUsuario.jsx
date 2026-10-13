"use client";
import React, { useState } from 'react';
import { MENSAJE_SIN_RESPUESTA } from '../lib/errores';

const ETIQUETA_ROL = { admin: 'Administrador', encargado: 'Encargado' };

const mensajeDe = (data) => {
  if (typeof data?.detail === 'string') return data.detail;
  if (Array.isArray(data?.detail) && data.detail[0]?.msg) return data.detail[0].msg.replace(/^Value error, /, '');
  return 'Revisa los datos ingresados.';
};

// Menú del usuario en la cabecera: ver perfil, modificar perfil y cerrar sesión.
export default function MenuUsuario({ sesion, backendUrl, authHeaders, onSesionInvalida, onLogout }) {
  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState(null);          // null | 'ver' | 'editar'
  const [perfil, setPerfil] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(false);

  const cerrarModal = () => { setModo(null); setError(''); setAviso(''); };

  const abrir = async (nuevoModo) => {
    setAbierto(false);
    setError('');
    setAviso('');
    setModo(nuevoModo);
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

  const campo = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-800';
  const etiqueta = 'block text-xs font-semibold text-slate-500 mb-1';

  return (
    <div className="relative">
      <button onClick={() => setAbierto((a) => !a)} aria-haspopup="menu" aria-expanded={abierto}
              className="font-semibold text-slate-700 border border-slate-300 rounded-lg px-3 py-1 bg-white">
        {sesion.usuario} · {sesion.rol} ▾
      </button>
      {abierto && (
        <div role="menu" className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-30 text-sm">
          <button role="menuitem" onClick={() => abrir('ver')} className="block w-full text-left px-3 py-2 hover:bg-slate-50">Ver perfil</button>
          <button role="menuitem" onClick={() => abrir('editar')} className="block w-full text-left px-3 py-2 hover:bg-slate-50">Modificar perfil</button>
          <button role="menuitem" onClick={() => { setAbierto(false); onLogout(); }}
                  className="block w-full text-left px-3 py-2 hover:bg-slate-50 border-t border-slate-100 text-red-600">Cerrar sesión</button>
        </div>
      )}

      {modo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-40">
          <div role="dialog" aria-modal="true" aria-label={modo === 'ver' ? 'Mi perfil' : 'Modificar perfil'}
               className="w-full max-w-md bg-white rounded-2xl shadow p-6 text-sm text-slate-800 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-bold">{modo === 'ver' ? 'Mi perfil' : 'Modificar perfil'}</h2>
              <button onClick={cerrarModal} aria-label="Cerrar ventana" className="text-slate-400 text-xl leading-none">×</button>
            </div>

            {cargando && !perfil && <p className="text-slate-500">Cargando…</p>}
            {error && !perfil && <p className="text-red-600" role="alert">{error}</p>}

            {perfil && modo === 'ver' && (
              <>
                <dl className="grid grid-cols-3 gap-y-2">
                  <dt className="text-slate-500">Nombre</dt><dd className="col-span-2">{perfil.nombre} {perfil.apellido}</dd>
                  <dt className="text-slate-500">Usuario</dt><dd className="col-span-2">{perfil.email}</dd>
                  <dt className="text-slate-500">Rol</dt><dd className="col-span-2">{ETIQUETA_ROL[perfil.rol] || perfil.rol}</dd>
                  <dt className="text-slate-500">Sucursal</dt><dd className="col-span-2">{perfil.sucursal || '—'}</dd>
                </dl>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setModo('editar')} className="bg-orange-600 text-white font-bold rounded-lg px-4 py-2">Modificar perfil</button>
                  <button onClick={cerrarModal} className="border border-slate-300 rounded-lg px-4 py-2">Cerrar</button>
                </div>
              </>
            )}

            {perfil && form && modo === 'editar' && (
              <form onSubmit={guardar} className="space-y-3">
                <div><label className={etiqueta} htmlFor="perfil-nombre">Nombre</label>
                  <input id="perfil-nombre" className={campo} value={form.nombre} onChange={cambiar('nombre')} required /></div>
                <div><label className={etiqueta} htmlFor="perfil-apellido">Apellido</label>
                  <input id="perfil-apellido" className={campo} value={form.apellido} onChange={cambiar('apellido')} /></div>
                <div><label className={etiqueta} htmlFor="perfil-sucursal">Sucursal</label>
                  <input id="perfil-sucursal" className={campo} value={form.sucursal} onChange={cambiar('sucursal')} /></div>
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
                <div className="flex justify-end gap-2">
                  <button type="submit" disabled={cargando} className="bg-orange-600 text-white font-bold rounded-lg px-4 py-2 disabled:opacity-60">
                    {cargando ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button type="button" onClick={cerrarModal} className="border border-slate-300 rounded-lg px-4 py-2">Cerrar</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
