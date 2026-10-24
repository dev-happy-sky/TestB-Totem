"use client";
import React from 'react';
import { IconoMancuerna, IconoInicio, IconoPanel } from './iconos';

function Enlace({ destino, icono, texto, vista, onNavegar }) {
  const activo = vista === destino;
  return (
    <button onClick={() => onNavegar && onNavegar(destino)} aria-current={activo ? 'page' : undefined}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition
        ${activo ? 'bg-white/15 text-white' : 'text-white/70 hover:text-white hover:bg-white/10'}`}>
      {icono}<span className="hidden sm:inline">{texto}</span>
    </button>
  );
}

// Barra de navegación superior con identidad Duoc (azul marino + amarillo).
// `vista` marca el enlace activo; `onNavegar(destino)` cambia de pantalla;
// `children` es el espacio derecho (normalmente el menú lateral).
export default function TopNav({ vista = 'inicio', onNavegar, sinSeguridad = false, children }) {
  const navegar = (destino) => () => onNavegar && onNavegar(destino);

  return (
    <header className="sticky top-0 z-30 bg-duoc-700 text-white shadow-md shadow-duoc-900/20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center gap-2 sm:gap-4">
        {/* Logo + nombre */}
        <button onClick={navegar('inicio')} className="flex items-center gap-2.5 shrink-0 group" aria-label="Ir al inicio">
          <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-oro-400 text-duoc-800 group-hover:scale-105 transition">
            <IconoMancuerna className="w-6 h-6" />
          </span>
          <span className="text-lg font-black tracking-tight leading-none">
            TÓTEM<span className="font-light text-oro-400"> FIT</span>
          </span>
        </button>

        {/* Enlaces de navegación */}
        {onNavegar && (
          <nav className="flex items-center gap-1 ml-1 sm:ml-3">
            <Enlace destino="inicio" texto="Inicio" icono={<IconoInicio className="w-4 h-4" />} vista={vista} onNavegar={onNavegar} />
            <Enlace destino="dashboard" texto="Dashboard" icono={<IconoPanel className="w-4 h-4" />} vista={vista} onNavegar={onNavegar} />
          </nav>
        )}

        {/* Lado derecho: aviso sin seguridad + menú */}
        <div className="ml-auto flex items-center gap-3">
          {sinSeguridad && (
            <span className="hidden md:inline text-[11px] font-semibold text-duoc-900 bg-oro-400 rounded-full px-2.5 py-1">
              Seguridad desactivada
            </span>
          )}
          {children}
        </div>
      </div>
    </header>
  );
}
