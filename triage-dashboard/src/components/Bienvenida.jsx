"use client";
import React, { useEffect, useMemo, useState } from 'react';
import TopNav from './TopNav';
import PanelLateral from './PanelLateral';
import { estadoRevision, alertaPendiente } from '../lib/cola';
import { nombreCategoria } from '../lib/ia';
import { IconoAlumnos, IconoReloj, IconoAlerta, IconoCheck, IconoFlecha, IconoPanel } from './iconos';

const COLOR_NIVEL = { A1: 'bg-red-500', A2: 'bg-orange-500', A3: 'bg-yellow-500', A4: 'bg-green-500' };
const nivelDe = (e) => e.nivelFinal || e.iaSugerida;

// Primer nombre a partir del perfil o del usuario/email.
function primerNombre(perfil, usuario) {
  if (perfil?.nombre) return perfil.nombre.trim().split(/\s+/)[0];
  const base = (usuario || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'encargado/a';
}

function Tarjeta({ icono, etiqueta, valor, color, cargando }) {
  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
      <span className={`flex items-center justify-center w-10 h-10 rounded-xl mb-3 ${color}`}>{icono}</span>
      <p className="text-3xl font-black text-duoc-800 leading-none">{cargando ? '–' : valor}</p>
      <p className="text-xs font-semibold text-slate-400 mt-1 uppercase tracking-wide">{etiqueta}</p>
    </div>
  );
}

function alumnosUnicos(evaluaciones) {
  const porSocio = new Map();
  for (const e of evaluaciones) {
    const clave = e.id || e.matricula || e.idUnico;
    if (!clave) continue;
    const fecha = new Date(e.inicioEvaluacion || e.fecha || 0).getTime();
    const previo = porSocio.get(clave);
    if (!previo || fecha >= previo._fecha) porSocio.set(clave, { ...e, _fecha: fecha });
  }
  return [...porSocio.values()].sort((a, b) => b._fecha - a._fecha);
}

// Página de bienvenida para la persona encargada: saludo, indicadores rápidos,
// accesos directos y los últimos alumnos. El botón principal lleva al dashboard.
export default function Bienvenida({ sesion, backendUrl, authHeaders, sinSeguridad = false, vista, onNavegar, onSesionInvalida }) {
  const [evaluaciones, setEvaluaciones] = useState([]);
  const [perfil, setPerfil] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    fetch(`${backendUrl}/api/evaluaciones`, { headers: authHeaders })
      .then((res) => { if (res.status === 401) { onSesionInvalida(); throw new Error('sesión'); } return res.ok ? res.json() : []; })
      .then((data) => { if (activo) setEvaluaciones(Array.isArray(data) ? data : []); })
      .catch(() => { if (activo) setEvaluaciones([]); })
      .finally(() => { if (activo) setCargando(false); });
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sinSeguridad) return undefined;
    let activo = true;
    fetch(`${backendUrl}/api/perfil`, { headers: authHeaders })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (activo && data) setPerfil(data); })
      .catch(() => {});
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alumnos = useMemo(() => alumnosUnicos(evaluaciones), [evaluaciones]);
  const stats = useMemo(() => ({
    alumnos: alumnos.length,
    porValidar: evaluaciones.filter((e) => estadoRevision(e) === 'pendiente').length,
    alertas: evaluaciones.filter(alertaPendiente).length,
    validados: evaluaciones.filter((e) => estadoRevision(e) !== 'pendiente').length,
  }), [evaluaciones, alumnos]);

  const nombre = primerNombre(perfil, sesion.usuario);
  const menu = sinSeguridad ? null : (
    <PanelLateral sesion={sesion} backendUrl={backendUrl} authHeaders={authHeaders}
                  evaluaciones={evaluaciones} onSesionInvalida={onSesionInvalida} onLogout={() => {}} />
  );

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <TopNav vista={vista} onNavegar={onNavegar} sinSeguridad={sinSeguridad}>{menu}</TopNav>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8 space-y-8">
        {/* Hero / saludo */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-duoc-700 via-duoc-700 to-duoc-500 text-white p-8 sm:p-10">
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25">
            <div className="absolute -top-16 -right-10 w-72 h-72 rounded-full bg-oro-400/40 blur-3xl" />
            <div className="absolute bottom-0 -left-16 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
          </div>
          <div className="relative flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="max-w-xl">
              <p className="text-oro-400 font-semibold text-sm">Panel del encargado</p>
              <h1 className="text-3xl sm:text-4xl font-black mt-1">Hola, {nombre} 👋</h1>
              <p className="mt-3 text-white/80 leading-relaxed">
                Aquí tienes un resumen al instante. Revisa lo pendiente, controla las alertas y entra al dashboard cuando quieras el detalle completo.
              </p>
            </div>
            <button onClick={() => onNavegar && onNavegar('dashboard')}
              className="group inline-flex items-center gap-2 bg-oro-400 hover:bg-oro-300 text-duoc-900 font-bold rounded-xl px-5 py-3 shadow-lg shadow-duoc-900/30 transition shrink-0">
              Entrar al dashboard
              <IconoFlecha className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>
        </section>

        {/* Indicadores rápidos */}
        <section>
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">Resumen de hoy</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Tarjeta cargando={cargando} icono={<IconoAlumnos className="w-5 h-5 text-white" />} color="bg-duoc-600" etiqueta="Alumnos registrados" valor={stats.alumnos} />
            <Tarjeta cargando={cargando} icono={<IconoReloj className="w-5 h-5 text-white" />} color="bg-slate-500" etiqueta="Por validar" valor={stats.porValidar} />
            <Tarjeta cargando={cargando} icono={<IconoAlerta className="w-5 h-5 text-white" />} color="bg-red-500" etiqueta="Alertas pendientes" valor={stats.alertas} />
            <Tarjeta cargando={cargando} icono={<IconoCheck className="w-5 h-5 text-white" />} color="bg-green-500" etiqueta="Validados" valor={stats.validados} />
          </div>
        </section>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Accesos rápidos */}
          <section className="lg:col-span-1">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">Accesos rápidos</h2>
            <div className="space-y-3">
              <button onClick={() => onNavegar && onNavegar('dashboard')}
                className="w-full flex items-center gap-4 bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:border-duoc-300 hover:shadow transition text-left">
                <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-duoc-700 text-white shrink-0"><IconoPanel className="w-6 h-6" /></span>
                <span className="flex-1">
                  <span className="block font-bold text-duoc-800">Dashboard de evaluación</span>
                  <span className="block text-sm text-slate-500">Cola, signos vitales y validación</span>
                </span>
                <IconoFlecha className="w-5 h-5 text-slate-300" />
              </button>
              <div className="flex items-center gap-4 bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-oro-400 text-duoc-900 shrink-0"><IconoAlumnos className="w-6 h-6" /></span>
                <span className="flex-1">
                  <span className="block font-bold text-duoc-800">{cargando ? '–' : stats.alumnos} alumnos</span>
                  <span className="block text-sm text-slate-500">Abre el menú ☰ para ver el detalle</span>
                </span>
              </div>
            </div>
          </section>

          {/* Últimos alumnos */}
          <section className="lg:col-span-2">
            <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">Últimos alumnos</h2>
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm divide-y divide-slate-100">
              {cargando ? (
                <p className="p-6 text-sm text-slate-400">Cargando…</p>
              ) : alumnos.length === 0 ? (
                <p className="p-6 text-sm text-slate-400 text-center">Todavía no hay alumnos con evaluaciones.</p>
              ) : (
                alumnos.slice(0, 6).map((a) => {
                  const nivel = nivelDe(a);
                  return (
                    <div key={a.id || a.idUnico} className="flex items-center gap-3 p-4">
                      <span className={`w-9 h-9 shrink-0 rounded-lg text-white font-bold text-sm flex items-center justify-center ${COLOR_NIVEL[nivel] || 'bg-slate-400'}`}>
                        {nivel || '—'}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-duoc-800 text-sm truncate">{a.nombre}</p>
                        <p className="text-xs text-slate-500">{nombreCategoria(nivel)}</p>
                      </div>
                      {estadoRevision(a) === 'pendiente'
                        ? <span className="text-[10px] font-bold bg-oro-400 text-duoc-900 px-2 py-0.5 rounded-full">POR VALIDAR</span>
                        : <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">VALIDADO</span>}
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
