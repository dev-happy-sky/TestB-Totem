"use client";
import React, { useEffect, useMemo, useState } from 'react';
import TopNav from './TopNav';
import PanelLateral from './PanelLateral';
import { estadoRevision, alertaPendiente, conObservacion, buenaCondicion } from '../lib/cola';
import { nombreCategoria } from '../lib/ia';
import { ENLACES_DUOC } from './enlacesDuoc';
import { IconoFlecha, IconoExterno, IconoNoticias, IconoCheck, IconoAlerta } from './iconos';

const COLOR_NIVEL = { A1: 'bg-red-500', A2: 'bg-orange-500', A3: 'bg-yellow-500', A4: 'bg-green-500' };
const nivelDe = (e) => e.nivelFinal || e.iaSugerida;

function primerNombre(perfil, usuario) {
  if (perfil?.nombre) return `${perfil.nombre} ${perfil.apellido || ''}`.trim();
  const base = (usuario || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : 'encargado/a';
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

function fechaHoy() {
  try {
    return new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return ''; }
}

function Titulo({ children }) {
  return (
    <h2 className="text-sm font-bold text-duoc-800 mb-3 flex items-center gap-2">
      <span className="w-1 h-4 bg-oro-400 rounded-sm" />{children}
    </h2>
  );
}

// Celda de indicador (sobria: número + etiqueta, sin adornos).
function Indicador({ etiqueta, valor, cargando, resaltar = false }) {
  return (
    <div className="px-5 py-4">
      <p className={`text-3xl font-bold leading-none ${resaltar && !cargando && valor > 0 ? 'text-red-600' : 'text-duoc-800'}`}>
        {cargando ? '–' : valor}
      </p>
      <p className="text-xs font-medium text-slate-500 mt-1.5">{etiqueta}</p>
    </div>
  );
}

// Página de bienvenida: estilo sobrio tipo portal Duoc. Noticias y accesos a la
// izquierda; resumen del encargado y últimos alumnos a la derecha.
export default function Bienvenida({ sesion, backendUrl, authHeaders, sinSeguridad = false, vista, onNavegar, onSesionInvalida, onLogout }) {
  const [evaluaciones, setEvaluaciones] = useState([]);
  const [perfil, setPerfil] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [noticias, setNoticias] = useState([]);

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

  // Noticias reales del portal Duoc (ruta propia /api/noticias; si falla, queda vacío y se muestra el enlace).
  useEffect(() => {
    let activo = true;
    fetch('/api/noticias')
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => { if (activo) setNoticias(Array.isArray(data?.items) ? data.items : []); })
      .catch(() => {});
    return () => { activo = false; };
  }, []);

  const alumnos = useMemo(() => alumnosUnicos(evaluaciones), [evaluaciones]);
  const stats = useMemo(() => {
    const buenasList = alumnos.filter(buenaCondicion);
    const obsList = alumnos.filter(conObservacion);
    const cuenta = (lista, nivel) => lista.filter((a) => (a.nivelFinal || a.iaSugerida) === nivel).length;
    return {
      alumnos: alumnos.length,
      porValidar: evaluaciones.filter((e) => estadoRevision(e) === 'pendiente').length,
      alertas: evaluaciones.filter(alertaPendiente).length,
      validados: evaluaciones.filter((e) => estadoRevision(e) !== 'pendiente').length,
      buenas: buenasList.length,
      observacion: obsList.length,
      buenasA4: cuenta(buenasList, 'A4'), buenasA3: cuenta(buenasList, 'A3'),
      obsA1: cuenta(obsList, 'A1'), obsA2: cuenta(obsList, 'A2'),
    };
  }, [evaluaciones, alumnos]);

  const nombre = primerNombre(perfil, sesion.usuario);
  const menu = sinSeguridad ? null : (
    <PanelLateral sesion={sesion} backendUrl={backendUrl} authHeaders={authHeaders}
                  evaluaciones={evaluaciones} onSesionInvalida={onSesionInvalida} onLogout={onLogout} />
  );

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <TopNav vista={vista} onNavegar={onNavegar} sinSeguridad={sinSeguridad}>{menu}</TopNav>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        {/* Encabezado sobrio */}
        <header className="border-b border-slate-200 pb-6 mb-8">
          <p className="text-xs font-semibold text-duoc-600 uppercase tracking-[0.15em]">Panel del encargado</p>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mt-2">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-duoc-800">Bienvenido, {nombre}</h1>
              <p className="text-sm text-slate-500 mt-1 first-letter:uppercase">{fechaHoy()}</p>
            </div>
            <button onClick={() => onNavegar && onNavegar('dashboard')}
              className="inline-flex items-center gap-2 bg-duoc-700 hover:bg-duoc-800 text-white font-semibold rounded-lg px-5 py-2.5 text-sm transition shrink-0">
              Ir al dashboard <IconoFlecha className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Dos grupos de alumnos: buenas condiciones / con observación */}
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          <button onClick={() => onNavegar && onNavegar('dashboard', 'buenas')}
            className="group text-left bg-white rounded-2xl border border-slate-200 p-5 hover:border-green-300 hover:shadow-sm transition">
            <div className="flex items-center justify-between">
              <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-green-50 text-green-600"><IconoCheck className="w-6 h-6" /></span>
              <span className="text-4xl font-bold text-duoc-800">{cargando ? '–' : stats.buenas}</span>
            </div>
            <p className="mt-3 font-bold text-duoc-800">Buenas condiciones</p>
            <p className="text-xs text-slate-500">Alumnos aptos, sin observaciones</p>
            {!cargando && (
              <div className="mt-2 flex gap-1.5">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-100 text-green-700">A4 · {stats.buenasA4}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">A3 · {stats.buenasA3}</span>
              </div>
            )}
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-green-700">
              Ver alumnos <IconoFlecha className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </button>
          <button onClick={() => onNavegar && onNavegar('dashboard', 'observacion')}
            className="group text-left bg-white rounded-2xl border border-slate-200 p-5 hover:border-amber-300 hover:shadow-sm transition">
            <div className="flex items-center justify-between">
              <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-amber-50 text-amber-600"><IconoAlerta className="w-6 h-6" /></span>
              <span className="text-4xl font-bold text-duoc-800">{cargando ? '–' : stats.observacion}</span>
            </div>
            <p className="mt-3 font-bold text-duoc-800">Con observación</p>
            <p className="text-xs text-slate-500">Requieren tu revisión o seguimiento</p>
            {!cargando && (
              <div className="mt-2 flex gap-1.5">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700">A1 · {stats.obsA1}</span>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">A2 · {stats.obsA2}</span>
              </div>
            )}
            <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700">
              Ver alumnos <IconoFlecha className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </button>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* IZQUIERDA: Noticias y accesos Duoc */}
          <aside className="lg:col-span-1 space-y-7 order-2 lg:order-1">
            <section>
              <Titulo>Noticias Duoc</Titulo>
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="bg-duoc-700 px-4 py-2.5 flex items-center gap-2 text-white">
                  <IconoNoticias className="w-5 h-5 text-oro-400" />
                  <span className="font-semibold text-sm">Portal Duoc UC</span>
                </div>
                {noticias.length > 0 ? (
                  <ul className="divide-y divide-slate-100">
                    {noticias.map((n) => (
                      <li key={n.url}>
                        <a href={n.url} target="_blank" rel="noopener noreferrer"
                           className="flex items-start gap-2 p-3 hover:bg-slate-50 transition group">
                          <span aria-hidden className="text-oro-500 mt-0.5 shrink-0">•</span>
                          <span className="flex-1 text-sm text-slate-700 leading-snug line-clamp-2 group-hover:text-duoc-800">{n.titulo}</span>
                          <IconoExterno className="w-3.5 h-3.5 text-slate-300 mt-0.5 shrink-0" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-4 text-sm text-slate-600 leading-relaxed">
                    Revisa las últimas noticias y novedades en el sitio oficial de Duoc UC.
                  </p>
                )}
                <a href="https://www.duoc.cl/noticias/" target="_blank" rel="noopener noreferrer"
                   className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 text-sm font-semibold text-duoc-700 hover:bg-slate-50">
                  Ver todas las noticias <IconoExterno className="w-4 h-4" />
                </a>
              </div>
            </section>

            <section>
              <Titulo>Accesos Duoc</Titulo>
              <div className="space-y-2">
                {ENLACES_DUOC.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3.5 hover:border-duoc-300 hover:shadow-sm transition group">
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-duoc-50 text-duoc-700 shrink-0">
                      <IconoExterno className="w-4 h-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-sm text-duoc-800">{l.nombre}</span>
                      <span className="block text-xs text-slate-500 truncate">{l.desc}</span>
                    </span>
                    <span aria-hidden className="text-slate-300 group-hover:text-duoc-400">↗</span>
                  </a>
                ))}
              </div>
            </section>
          </aside>

          {/* DERECHA: resumen del encargado + últimos alumnos */}
          <div className="lg:col-span-2 space-y-6 order-1 lg:order-2">
            <section className="bg-white rounded-xl border border-slate-200">
              <div className="px-5 py-3 border-b border-slate-100">
                <h2 className="text-sm font-bold text-duoc-800">Resumen de hoy</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100">
                <Indicador etiqueta="Alumnos registrados" valor={stats.alumnos} cargando={cargando} />
                <Indicador etiqueta="Por validar" valor={stats.porValidar} cargando={cargando} />
                <Indicador etiqueta="Alertas pendientes" valor={stats.alertas} cargando={cargando} resaltar />
                <Indicador etiqueta="Validados" valor={stats.validados} cargando={cargando} />
              </div>
            </section>

            <section className="bg-white rounded-xl border border-slate-200">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-sm font-bold text-duoc-800">Últimos alumnos</h2>
                <button onClick={() => onNavegar && onNavegar('dashboard')}
                        className="text-xs font-semibold text-duoc-700 hover:text-duoc-800">Ver todos →</button>
              </div>
              <div className="divide-y divide-slate-100">
                {cargando ? (
                  <p className="p-6 text-sm text-slate-400">Cargando…</p>
                ) : alumnos.length === 0 ? (
                  <p className="p-6 text-sm text-slate-400 text-center">Todavía no hay alumnos con evaluaciones.</p>
                ) : (
                  alumnos.slice(0, 6).map((a) => {
                    const nivel = nivelDe(a);
                    return (
                      <div key={a.id || a.idUnico} className="flex items-center gap-3 px-5 py-3.5">
                        <span className={`w-8 h-8 shrink-0 rounded-md text-white font-bold text-xs flex items-center justify-center ${COLOR_NIVEL[nivel] || 'bg-slate-400'}`}>
                          {nivel || '—'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-duoc-800 text-sm truncate">{a.nombre}</p>
                          <p className="text-xs text-slate-500">{nombreCategoria(nivel)}</p>
                        </div>
                        {estadoRevision(a) === 'pendiente'
                          ? <span className="text-[10px] font-semibold text-duoc-700 bg-duoc-50 border border-duoc-100 px-2 py-0.5 rounded">Por validar</span>
                          : <span className="text-[10px] font-semibold text-green-700 bg-green-50 border border-green-100 px-2 py-0.5 rounded">Validado</span>}
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
