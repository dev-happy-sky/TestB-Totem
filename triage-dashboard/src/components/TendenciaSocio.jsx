"use client";
import React from 'react';
import { calcularTendencia, evaluacionesPrevias } from '../lib/cola';

const formatearFecha = (iso) => {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '' : fecha.toLocaleDateString('es-CL');
};

// historial: undefined = cargando, null = error, [] / lista = cargado.
export default function TendenciaSocio({ estudiante, historial }) {
  if (historial === undefined) {
    return <p className="text-sm text-slate-400">Cargando historial…</p>;
  }
  if (historial === null) {
    return <p role="alert" className="text-sm text-red-600">No se pudo cargar el historial del socio.</p>;
  }

  const previas = evaluacionesPrevias(estudiante, historial);
  if (previas.length === 0) {
    return <p className="text-sm text-slate-400">Primera evaluación registrada de este socio.</p>;
  }
  const tendencia = calcularTendencia(estudiante, historial) || [];

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        Cambio respecto de la evaluación del {formatearFecha(previas[0].fecha)} ({previas.length} anterior{previas.length === 1 ? '' : 'es'})
      </p>
      <ul className="grid grid-cols-3 gap-3">
        {tendencia.map((t) => (
          <li key={t.clave} className="border border-slate-200 p-3 rounded-lg bg-white" aria-label={`Variación de ${t.etiqueta}`}>
            <span className="text-[10px] font-bold text-slate-400 block mb-1 uppercase">{t.etiqueta}</span>
            <span className="text-lg font-bold text-slate-800">{t.actual}</span>
            <span className="text-xs text-slate-400 ml-1">{t.unidad}</span>
            <span className={`block text-xs font-semibold mt-1 ${t.delta === 0 ? 'text-slate-400' : 'text-slate-700'}`}>
              {t.delta === 0 ? 'Sin cambio' : `${t.delta > 0 ? '▲ +' : '▼ '}${t.delta} (antes ${t.anterior})`}
            </span>
          </li>
        ))}
      </ul>
      <details className="mt-3">
        <summary className="text-xs font-semibold text-slate-500 cursor-pointer">Ver evaluaciones anteriores</summary>
        <ul className="mt-2 text-xs text-slate-600 space-y-1">
          {previas.map((p) => (
            <li key={p.idBaseDatos}>
              {formatearFecha(p.fecha)} · {p.nivelFinal || p.iaSugerida} · {p.estadoRevision === 'derivada' ? 'derivada' : p.estado === 'validado' ? 'revisada' : 'pendiente'}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
